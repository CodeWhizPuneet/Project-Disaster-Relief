const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['food', 'water', 'medical', 'rescue', 'shelter'],
      required: [true, 'Request type is required'],
    },
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
      address: {
        type: String,
        trim: true,
      },
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in_progress', 'resolved', 'cancelled'],
      default: 'pending',
    },
    photoUrl: {
      type: String,
      default: '',
    },
    assignedTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    // Priority score computed at creation (urgency + time factor)
    priorityScore: {
      type: Number,
      default: 0,
    },
    numberOfPeople: {
      type: Number,
      default: 1,
    },
    // Auto-dispatch tracking — set by dispatchService, never by client
    dispatchState: {
      round: { type: Number, default: 0 },
      lastDispatchedAt: { type: Date, default: null },
      dispatchedCount: { type: Number, default: 0 },
      escalatedToAdmin: { type: Boolean, default: false },
    },

    /**
     * routeLocation — road-snapped point computed at SOS creation via OSRM.
     * Google Maps navigation uses this as destination instead of raw actualLocation,
     * ensuring routing always succeeds even for off-road GPS positions.
     * Falls back to the original location coords if OSRM is unreachable.
     */
    routeLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],  // [longitude, latitude]
        default: null,
      },
    },
    roadSnap: {
      distanceMeters: { type: Number, default: 0 },  // gap between GPS and road
      roadName: { type: String, default: '' },
      snapped: { type: Boolean, default: false },      // false = fallback used
    },
  },
  { timestamps: true }
);

// 2dsphere index for geospatial queries ($near, $geoWithin)
requestSchema.index({ location: '2dsphere' });
requestSchema.index({ status: 1, createdAt: -1 });

// Calculate priority score before saving
requestSchema.pre('save', function () {
  const urgencyWeight = { low: 1, medium: 2, high: 3, critical: 4 };
  this.priorityScore = (urgencyWeight[this.urgency] || 1) * 10;
});

module.exports = mongoose.model('Request', requestSchema);
