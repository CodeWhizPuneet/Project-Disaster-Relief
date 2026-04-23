const Request = require('../models/Request');
const { startAutoDispatch } = require('../services/dispatchService');
const { findNearestRoadPoint } = require('../utils/geo');

const toIncidentObject = (requestDoc) => {
  const base = typeof requestDoc?.toObject === 'function' ? requestDoc.toObject() : requestDoc;
  return {
    ...base,
    entityType: 'incident',
    requestId: base?._id,
  };
};

const createRequest = async (req, res) => {
  try {
    const { type, urgency, description, location, numberOfPeople } = req.body;

    if (!location || typeof location.lng !== 'number' || typeof location.lat !== 'number') {
      return res.status(400).json({ success: false, message: 'Valid location (lat/lng) is required' });
    }

    const newRequest = await Request.create({
      submittedBy: req.user._id,
      type,
      urgency: urgency || 'medium',
      description,
      location: {
        type: 'Point',
        coordinates: [Number(location.lng), Number(location.lat)],
        address: location.address || '',
      },
      numberOfPeople: numberOfPeople || 1,
    });

    const populated = await newRequest.populate('submittedBy', 'name phone');

    req.io.to('staff').emit('new_request', {
      entityType: 'incident',
      _id: populated._id,
      requestId: populated._id,
      type: populated.type,
      urgency: populated.urgency,
      description: populated.description,
      location: populated.location,
      routeLocation: populated.routeLocation || null,
      roadSnap: populated.roadSnap || null,
      submittedBy: populated.submittedBy,
      numberOfPeople: populated.numberOfPeople,
      status: populated.status,
      priorityScore: populated.priorityScore,
      createdAt: populated.createdAt,
    });

    // Road-snap + auto-dispatch run concurrently in background — non-blocking
    const [snapLat, snapLng] = [location.lat, location.lng];

    Promise.all([
      // 1. Find nearest road point and persist it
      findNearestRoadPoint(snapLat, snapLng).then(async (snap) => {
        const routeCoords = [snap.lng, snap.lat]; // GeoJSON [lng, lat]
        await Request.findByIdAndUpdate(newRequest._id, {
          routeLocation: { type: 'Point', coordinates: routeCoords },
          roadSnap: {
            distanceMeters: snap.distanceMeters,
            roadName: snap.roadName,
            snapped: snap.distanceMeters > 0,
          },
        });
        // Notify staff with updated road-snap data (volunteers may not be assigned yet)
        req.io.to('staff').emit('incident_road_snap_updated', {
          incidentId: newRequest._id,
          routeLocation: { lat: snap.lat, lng: snap.lng },
          roadSnap: {
            distanceMeters: snap.distanceMeters,
            roadName: snap.roadName,
            snapped: snap.distanceMeters > 0,
          },
        });
      }).catch((err) => console.error('[roadSnap] Error:', err.message)),

      // 2. Auto-dispatch nearest volunteers
      startAutoDispatch(newRequest, req.io).catch((err) =>
        console.error('[dispatch] Auto-dispatch error:', err.message)
      ),
    ]);

    return res.status(201).json({ success: true, data: toIncidentObject(populated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getRequests = async (req, res) => {
  try {
    const { status, type, urgency, limit = 50 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (type) filter.type = type;
    if (urgency) filter.urgency = urgency;

    if (req.user.role === 'user') {
      filter.submittedBy = req.user._id;
    }

    const requests = await Request.find(filter)
      .populate('submittedBy', 'name phone')
      .populate('assignedTask')
      .sort({ priorityScore: -1, createdAt: -1 })
      .limit(Number(limit));

    return res.json({
      success: true,
      count: requests.length,
      data: requests.map(toIncidentObject),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('submittedBy', 'name phone email')
      .populate({ path: 'assignedTask', populate: { path: 'volunteerId', select: 'name phone' } });

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (req.user.role === 'user' && String(request.submittedBy?._id || request.submittedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this request' });
    }

    return res.json({ success: true, data: toIncidentObject(request) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateRequestStatus = async (req, res) => {
  try {
    const request = await Request.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    req.io.emit('request_status_updated', {
      requestId: request._id,
      status: request.status,
    });

    return res.json({ success: true, data: toIncidentObject(request) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getNearbyRequests = async (req, res) => {
  try {
    const { lng, lat, radius = 10000 } = req.query;

    const requests = await Request.find({
      status: { $in: ['pending', 'assigned'] },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
          $maxDistance: Number(radius),
        },
      },
    }).populate('submittedBy', 'name phone');

    return res.json({
      success: true,
      count: requests.length,
      data: requests.map(toIncidentObject),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getStats = async (req, res) => {
  try {
    const stats = await Request.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const byType = await Request.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]);

    const totalToday = await Request.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    });

    return res.json({ success: true, data: { byStatus: stats, byType, totalToday } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createRequest,
  getRequests,
  getRequest,
  updateRequestStatus,
  getNearbyRequests,
  getStats,
};