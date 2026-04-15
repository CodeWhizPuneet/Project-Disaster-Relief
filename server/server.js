const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const connectDB = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Request = require('./models/Request');

const app = express();
const server = http.createServer(app);

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = clientUrl
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  transports: ['websocket', 'polling'],
});

const resolveSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake.headers?.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.split(' ')[1];
  }

  return null;
};

io.use(async (socket, next) => {
  try {
    const token = resolveSocketToken(socket);
    if (!token) return next(new Error('Socket authentication failed: missing token'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return next(new Error('Socket authentication failed: user not found'));

    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error('Socket authentication failed'));
  }
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many auth attempts. Please try again later.' },
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/requests', require('./routes/requestRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/resources', require('./routes/resourceRoutes'));
app.use('/api/users', require('./routes/userRoutes'));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Disaster Relief API is running',
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

const canAccessIncident = async ({ user, incidentId }) => {
  if (user.role === 'admin') return true;

  const incident = await Request.findById(incidentId).select('submittedBy');
  if (!incident) return false;

  if (user.role === 'user' && String(incident.submittedBy) === String(user._id)) {
    return true;
  }

  if (user.role === 'volunteer') {
    const task = await Task.findOne({
      requestId: incidentId,
      volunteerId: user._id,
      status: { $in: ['assigned', 'accepted', 'en_route'] },
    }).select('_id');

    return Boolean(task);
  }

  return false;
};

io.on('connection', (socket) => {
  const safeUser = socket.user?.toSafeObject ? socket.user.toSafeObject() : socket.user;
  console.log(`Socket connected: ${socket.id} (${safeUser?.email || 'unknown'})`);

  if (safeUser?._id) {
    socket.join(`user_${safeUser._id}`);
  }

  if (safeUser?.role === 'admin' || safeUser?.role === 'volunteer') {
    socket.join('staff');
  }

  socket.on('join_room', ({ room }) => {
    if (!room) return;
    socket.join(room);
  });

  socket.on('join_user_room', ({ userId }) => {
    if (!userId || String(userId) !== String(safeUser?._id)) return;
    socket.join(`user_${userId}`);
  });

  socket.on('join_incident_room', async ({ incidentId }) => {
    if (!incidentId) return;
    const allowed = await canAccessIncident({ user: safeUser, incidentId });
    if (!allowed) return;
    socket.join(`incident_${incidentId}`);
  });

  socket.on('volunteer_available', async ({ volunteerId, available }) => {
    if (safeUser?.role !== 'volunteer' && safeUser?.role !== 'admin') return;
    if (!volunteerId || String(volunteerId) !== String(safeUser?._id)) return;

    await User.findByIdAndUpdate(volunteerId, {
      isAvailable: Boolean(available),
      trackingStatus: Boolean(available) ? 'available' : 'offline',
      assignedIncidentId: Boolean(available) ? null : safeUser.assignedIncidentId || null,
    });

    io.to('staff').emit('volunteer_status_update', { volunteerId, available: Boolean(available) });
  });

  socket.on('volunteerLocationUpdate', async ({ incidentId, latitude, longitude, status }) => {
    if (safeUser?.role !== 'volunteer') return;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const coords = [Number(longitude), Number(latitude)];
    const effectiveStatus = status || (incidentId ? 'assigned' : 'available');

    await User.findByIdAndUpdate(safeUser._id, {
      location: { type: 'Point', coordinates: coords },
      locationUpdatedAt: new Date(),
      trackingStatus: effectiveStatus,
      isAvailable: effectiveStatus === 'available',
      assignedIncidentId: incidentId || null,
    });

    const payload = {
      volunteerId: safeUser._id,
      incidentId: incidentId || null,
      location: { lat: Number(latitude), lng: Number(longitude) },
      timestamp: new Date().toISOString(),
      status: effectiveStatus,
    };

    io.to('staff').emit('volunteer_location_updated', payload);

    if (incidentId) {
      const allowed = await canAccessIncident({ user: safeUser, incidentId });
      if (!allowed) return;

      socket.join(`incident_${incidentId}`);
      io.to(`incident_${incidentId}`).emit('volunteer_location_updated', payload);
    }
  });

  socket.on('userLocationUpdate', async ({ incidentId, latitude, longitude }) => {
    if (safeUser?.role !== 'user') return;
    if (!incidentId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const allowed = await canAccessIncident({ user: safeUser, incidentId });
    if (!allowed) return;

    const coords = [Number(longitude), Number(latitude)];

    await User.findByIdAndUpdate(safeUser._id, {
      location: { type: 'Point', coordinates: coords },
      locationUpdatedAt: new Date(),
      trackingStatus: 'assigned',
      assignedIncidentId: incidentId,
    });

    const payload = {
      userId: safeUser._id,
      incidentId,
      location: { lat: Number(latitude), lng: Number(longitude) },
      timestamp: new Date().toISOString(),
    };

    socket.join(`incident_${incidentId}`);

    io.to('staff').emit('user_location_updated', payload);
    io.to(`incident_${incidentId}`).emit('user_location_updated', payload);
  });

  socket.on('assignVolunteer', async ({ incidentId, volunteerId }) => {
    if (safeUser?.role !== 'admin') return;
    if (!incidentId || !volunteerId) return;

    io.to(`user_${volunteerId}`).emit('incident_assignment_signal', { incidentId });

    const incident = await Request.findById(incidentId).select('submittedBy');
    if (incident?.submittedBy) {
      io.to(`user_${incident.submittedBy}`).emit('incident_assignment_signal', { incidentId });
    }
  });

  socket.on('disconnect', async (reason) => {
    if (safeUser?.role === 'volunteer') {
      await User.findByIdAndUpdate(safeUser._id, {
        trackingStatus: safeUser.assignedIncidentId ? 'assigned' : 'offline',
      });
    }

    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error(error.message || 'Failed to start server');
    process.exit(1);
  }
};

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  server.close(() => process.exit(0));
});

startServer();