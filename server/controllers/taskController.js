const Task = require('../models/Task');
const Request = require('../models/Request');
const User = require('../models/User');
const { haversineDistanceKm } = require('../utils/geo');
const { cancelDispatch } = require('../services/dispatchService');

const setVolunteerAssignmentState = async ({ volunteerId, incidentId, isAssigned }) => {
  return User.findByIdAndUpdate(
    volunteerId,
    {
      isAvailable: !isAssigned,
      trackingStatus: isAssigned ? 'assigned' : 'available',
      assignedIncidentId: isAssigned ? incidentId : null,
    },
    { returnDocument: 'after' }
  ).select('isAvailable trackingStatus assignedIncidentId location locationUpdatedAt');
};

const mapVolunteerStatusPayload = (volunteerId, volunteerState) => {
  const coordinates = volunteerState?.location?.coordinates;
  return {
    volunteerId,
    available: volunteerState?.isAvailable,
    trackingStatus: volunteerState?.trackingStatus,
    incidentId: volunteerState?.assignedIncidentId || null,
    location:
      Array.isArray(coordinates) && coordinates.length === 2
        ? {
            lat: coordinates[1],
            lng: coordinates[0],
          }
        : null,
    locationUpdatedAt: volunteerState?.locationUpdatedAt || null,
  };
};

const createTask = async (req, res) => {
  try {
    const { requestId, volunteerId, notes, estimatedArrival } = req.body;

    const volunteer = await User.findOne({ _id: volunteerId, role: 'volunteer', isAvailable: true });
    if (!volunteer) {
      return res.status(400).json({ success: false, message: 'Volunteer is unavailable or not found' });
    }

    const request = await Request.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      { status: 'assigned' },
      { returnDocument: 'after' }
    );

    if (!request) {
      return res.status(409).json({
        success: false,
        message: 'Request is already assigned or does not exist',
      });
    }

    const task = await Task.create({ requestId, volunteerId, notes, estimatedArrival });

    request.assignedTask = task._id;
    await request.save();

    const volunteerState = await setVolunteerAssignmentState({
      volunteerId,
      incidentId: request._id,
      isAssigned: true,
    });

    // Cancel any pending auto-dispatch timer for this incident
    cancelDispatch(String(requestId));

    const populated = await task.populate([
      { path: 'requestId' },
      { path: 'volunteerId', select: 'name phone email trackingStatus assignedIncidentId' },
    ]);

    const incidentRoom = `incident_${request._id}`;

    req.io.to(`user_${volunteerId}`).emit('task_assigned', {
      taskId: task._id,
      incidentId: request._id,
      request: { type: request.type, urgency: request.urgency, location: request.location },
    });

    req.io.to(`user_${request.submittedBy}`).emit('sos_assigned', {
      message: 'A volunteer has been assigned to your request',
      taskId: task._id,
      incidentId: request._id,
    });

    req.io.to('staff').emit('volunteer_assignment_updated', {
      volunteerId,
      incidentId: request._id,
      isAvailable: false,
    });

    req.io.to('staff').emit('volunteer_status_update', mapVolunteerStatusPayload(volunteerId, volunteerState));

    req.io.to(incidentRoom).emit('incident_assignment_updated', {
      incidentId: request._id,
      volunteerId,
      userId: request.submittedBy,
    });

    return res.status(201).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAllTasks = async (req, res) => {
  try {
    const tasks = await Task.find()
      .populate('requestId')
      .populate('volunteerId', 'name phone email trackingStatus assignedIncidentId')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getMyTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ volunteerId: req.user._id })
      .populate('requestId')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateTaskStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const normalizedStatus = status === 'en_route' ? 'in_progress' : status;

    const task = await Task.findOne({
      _id: req.params.id,
      volunteerId: req.user._id,
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found or not yours' });
    }

    task.status = normalizedStatus;
    if (notes) task.notes = notes;

    let linkedRequestStatus = null;

    if (normalizedStatus === 'completed') {
      task.completedAt = new Date();
      linkedRequestStatus = 'resolved';
      await Request.findByIdAndUpdate(task.requestId, { status: linkedRequestStatus }, { returnDocument: 'after' });
      const volunteerState = await setVolunteerAssignmentState({
        volunteerId: task.volunteerId,
        incidentId: task.requestId,
        isAssigned: false,
      });

      req.io.to('staff').emit(
        'volunteer_status_update',
        mapVolunteerStatusPayload(task.volunteerId, volunteerState)
      );
    } else if (normalizedStatus === 'in_progress') {
      linkedRequestStatus = 'in_progress';
      await Request.findByIdAndUpdate(task.requestId, { status: linkedRequestStatus }, { returnDocument: 'after' });
    }

    await task.save();

    req.io.emit('status_updated', {
      taskId: task._id,
      requestId: task.requestId,
      status: task.status,
    });

    if (linkedRequestStatus) {
      req.io.emit('request_status_updated', {
        requestId: task.requestId,
        status: linkedRequestStatus,
      });
    }

    if (normalizedStatus === 'completed') {
      const request = await Request.findById(task.requestId);
      if (request) {
        req.io.to(`user_${request.submittedBy}`).emit('sos_resolved', {
          message: 'Your request has been marked as resolved. Stay safe.',
        });
      }
    }

    return res.json({ success: true, data: task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAssignmentSuggestions = async (req, res) => {
  try {
    const { requestId } = req.params;
    const limit = Number(req.query.limit || 5);

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const volunteers = await User.find({ role: 'volunteer', isAvailable: true })
      .select('name email phone location isAvailable trackingStatus')
      .lean();

    const incidentCoords = request.location.coordinates;

    const ranked = volunteers
      .map(vol => {
        const coords = vol.location?.coordinates;
        const hasLocation =
          Array.isArray(coords) &&
          coords.length === 2 &&
          Number.isFinite(coords[0]) &&
          Number.isFinite(coords[1]) &&
          !(coords[0] === 0 && coords[1] === 0);

        return {
          ...vol,
          hasLiveLocation: hasLocation,
          distanceKm: hasLocation ? Number(haversineDistanceKm(coords, incidentCoords).toFixed(2)) : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    return res.json({
      success: true,
      incidentId: requestId,
      count: ranked.length,
      data: ranked,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const autoAssignNearestVolunteer = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await Request.findById(requestId);
    if (!request || request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request is not available for assignment' });
    }

    const volunteers = await User.find({ role: 'volunteer', isAvailable: true })
      .select('location')
      .lean();

    if (!volunteers.length) {
      return res.status(404).json({ success: false, message: 'No available volunteers found' });
    }

    const nearest = volunteers
      .map(vol => ({
        _id: vol._id,
        distanceKm:
          Array.isArray(vol.location?.coordinates) &&
          vol.location.coordinates.length === 2 &&
          Number.isFinite(vol.location.coordinates[0]) &&
          Number.isFinite(vol.location.coordinates[1]) &&
          !(vol.location.coordinates[0] === 0 && vol.location.coordinates[1] === 0)
            ? haversineDistanceKm(vol.location.coordinates, request.location.coordinates)
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    if (!nearest || !Number.isFinite(nearest.distanceKm)) {
      return res.status(400).json({
        success: false,
        message: 'No available volunteers with live location found for auto-assignment',
      });
    }

    req.body.requestId = requestId;
    req.body.volunteerId = nearest._id;

    return createTask(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createTask,
  getAllTasks,
  getMyTasks,
  updateTaskStatus,
  getAssignmentSuggestions,
  autoAssignNearestVolunteer,
};
