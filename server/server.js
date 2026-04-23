const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const connectDB = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Request = require('./models/Request');
const { cancelDispatch, claimRequest } = require('./services/dispatchService');

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
app.use('/api/route', require('./routes/routeRoutes'));
app.use('/route', require('./routes/routeRoutes'));

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
      status: { $in: ['assigned', 'accepted', 'in_progress', 'en_route'] },
    }).select('_id');

    return Boolean(task);
  }

  return false;
};

const hasActiveVolunteerTask = async (volunteerId) => {
  const task = await Task.findOne({
    volunteerId,
    status: { $in: ['assigned', 'accepted', 'in_progress', 'en_route'] },
  }).select('requestId status');

  return task;
};

const isValidCoordinate = (value) => Number.isFinite(value) && Math.abs(value) <= 180;

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

    const activeTask = await hasActiveVolunteerTask(safeUser._id);
    if (activeTask && Boolean(available)) return;

    const effectiveAvailable = activeTask ? false : Boolean(available);
    const updatedVolunteer = await User.findByIdAndUpdate(
      volunteerId,
      {
        isAvailable: effectiveAvailable,
        trackingStatus: activeTask ? 'assigned' : effectiveAvailable ? 'available' : 'offline',
        assignedIncidentId: activeTask ? activeTask.requestId : null,
      },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    ).select('isAvailable trackingStatus assignedIncidentId location locationUpdatedAt');

    if (!updatedVolunteer) return;

    io.to('staff').emit('volunteer_status_update', {
      volunteerId,
      available: updatedVolunteer.isAvailable,
      trackingStatus: updatedVolunteer.trackingStatus,
      incidentId: updatedVolunteer.assignedIncidentId,
      location: Array.isArray(updatedVolunteer.location?.coordinates)
        ? {
            lat: updatedVolunteer.location.coordinates[1],
            lng: updatedVolunteer.location.coordinates[0],
          }
        : null,
      locationUpdatedAt: updatedVolunteer.locationUpdatedAt,
    });
  });

  socket.on('volunteerLocationUpdate', async ({ incidentId, latitude, longitude, status }) => {
    if (safeUser?.role !== 'volunteer') return;
    if (!isValidCoordinate(latitude) || !isValidCoordinate(longitude)) return;

    const activeTask = await hasActiveVolunteerTask(safeUser._id);
    const effectiveIncidentId = incidentId || activeTask?.requestId?.toString() || null;

    if (!incidentId && activeTask) {
      incidentId = activeTask.requestId.toString();
    }

    if (incidentId && activeTask && String(activeTask.requestId) !== String(incidentId)) {
      return;
    }

    if (incidentId && !activeTask) {
      return;
    }

    const coords = [Number(longitude), Number(latitude)];
    const effectiveStatus = activeTask ? 'assigned' : status || (effectiveIncidentId ? 'assigned' : 'available');

    await User.findByIdAndUpdate(safeUser._id, {
      location: { type: 'Point', coordinates: coords },
      locationUpdatedAt: new Date(),
      trackingStatus: effectiveStatus,
      isAvailable: effectiveStatus === 'available',
      assignedIncidentId: effectiveIncidentId,
    });

    const payload = {
      volunteerId: safeUser._id,
      incidentId: effectiveIncidentId,
      location: { lat: Number(latitude), lng: Number(longitude) },
      timestamp: new Date().toISOString(),
      status: effectiveStatus,
    };

    io.to('staff').emit('volunteer_location_updated', payload);

    if (effectiveIncidentId) {
      const allowed = await canAccessIncident({ user: safeUser, incidentId: effectiveIncidentId });
      if (!allowed) return;

      socket.join(`incident_${effectiveIncidentId}`);
      io.to(`incident_${effectiveIncidentId}`).emit('volunteer_location_updated', payload);
    }
  });

  socket.on('userLocationUpdate', async ({ incidentId, latitude, longitude }) => {
    if (safeUser?.role !== 'user') return;
    if (!incidentId || !isValidCoordinate(latitude) || !isValidCoordinate(longitude)) return;

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

  // ── Auto-dispatch: volunteer accepts a dispatched SOS ────────────────────
  /**
   * First-accept-wins: the first volunteer to emit this event atomically claims
   * the request. All others receive 'dispatch_already_assigned'.
   */
  socket.on('volunteer_accept_dispatch', async ({ requestId }) => {
    if (safeUser?.role !== 'volunteer') return;
    if (!requestId) return;

    const volunteerId = safeUser._id;

    try {
      // Step 1: Atomically claim the request — only succeeds if status is still 'pending'
      const request = await claimRequest(requestId);

      if (!request) {
        // Another volunteer beat us to it
        socket.emit('dispatch_already_assigned', { requestId });
        console.log(`[dispatch] Race lost by volunteer ${volunteerId} for incident ${requestId}`);
        return;
      }

      // Step 2: Check volunteer is not already on a critical task
      const existingTask = await Task.findOne({
        volunteerId,
        status: { $in: ['assigned', 'accepted', 'in_progress', 'en_route'] },
      }).select('_id').lean();

      // (Volunteer may still accept even if busy — dispatchService already filtered by urgency)
      // But we don't allow two active assigned tasks
      if (existingTask) {
        // Roll back — un-claim request
        await Request.findByIdAndUpdate(requestId, { status: 'pending' });
        socket.emit('dispatch_already_assigned', { requestId });
        console.log(`[dispatch] Volunteer ${volunteerId} already has an active task — rolled back`);
        return;
      }

      // Step 3: Create the Task document
      const task = await Task.create({ requestId, volunteerId });

      // Step 4: Link task to request
      await Request.findByIdAndUpdate(requestId, { assignedTask: task._id });

      // Step 5: Update volunteer state
      const volunteerState = await User.findByIdAndUpdate(
        volunteerId,
        {
          isAvailable: false,
          trackingStatus: 'assigned',
          assignedIncidentId: request._id,
        },
        { returnDocument: 'after' }
      ).select('isAvailable trackingStatus assignedIncidentId location locationUpdatedAt name phone');

      // Step 6: Cancel any remaining dispatch timers
      cancelDispatch(String(requestId));

      // Step 7: Notify the accepting volunteer (task_assigned mirrors existing flow)
      socket.join(`incident_${request._id}`);
      socket.emit('task_assigned', {
        taskId: task._id,
        incidentId: request._id,
        request: { type: request.type, urgency: request.urgency, location: request.location },
      });

      // Step 8: Notify the victim
      io.to(`user_${request.submittedBy}`).emit('sos_assigned', {
        message: `A volunteer has accepted your ${request.type} request. Help is on the way!`,
        taskId: task._id,
        incidentId: request._id,
      });

      // Step 9: Notify admin
      io.to('staff').emit('volunteer_assignment_updated', {
        volunteerId,
        incidentId: request._id,
        isAvailable: false,
        source: 'auto_dispatch',
      });

      if (volunteerState) {
        const coords = volunteerState.location?.coordinates;
        io.to('staff').emit('volunteer_status_update', {
          volunteerId,
          available: volunteerState.isAvailable,
          trackingStatus: volunteerState.trackingStatus,
          incidentId: volunteerState.assignedIncidentId,
          location: Array.isArray(coords) && coords.length === 2
            ? { lat: coords[1], lng: coords[0] } : null,
          locationUpdatedAt: volunteerState.locationUpdatedAt,
        });
      }

      // Step 10: Notify incident room (victim + any admins watching)
      io.to(`incident_${request._id}`).emit('incident_assignment_updated', {
        incidentId: request._id,
        volunteerId,
        userId: request.submittedBy,
      });

      console.log(`[dispatch] Volunteer ${volunteerId} accepted incident ${requestId} ✅`);
    } catch (err) {
      console.error('[dispatch] Error in volunteer_accept_dispatch:', err.message);
      socket.emit('dispatch_error', { requestId, message: 'Assignment failed. Please try again.' });
    }
  });

  // ── Auto-dispatch: volunteer rejects a dispatched SOS ───────────────────
  socket.on('volunteer_reject_dispatch', ({ requestId }) => {
    if (safeUser?.role !== 'volunteer') return;
    if (!requestId) return;
    // Server-side we simply log. dispatchService already handles fallback via timeout.
    console.log(`[dispatch] Volunteer ${safeUser._id} rejected incident ${requestId}`);
    // Optionally: track rejection count and fire next round early
    // For now, timeout handles progression automatically
  });

  socket.on('disconnect', async (reason) => {
    if (safeUser?.role === 'volunteer') {
      const activeTask = await hasActiveVolunteerTask(safeUser._id);
      const updated = await User.findByIdAndUpdate(
        safeUser._id,
        {
          isAvailable: !activeTask,
          trackingStatus: activeTask ? 'assigned' : 'offline',
          assignedIncidentId: activeTask ? activeTask.requestId : null,
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      ).select('isAvailable trackingStatus assignedIncidentId');

      if (updated) {
        io.to('staff').emit('volunteer_status_update', {
          volunteerId: safeUser._id,
          available: updated.isAvailable,
          trackingStatus: updated.trackingStatus,
          incidentId: updated.assignedIncidentId,
        });
      }
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