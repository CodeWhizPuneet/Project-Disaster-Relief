const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Request',
      required: true,
    },
    volunteerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'in_progress', 'en_route', 'completed', 'cancelled'],
      default: 'assigned',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    estimatedArrival: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

taskSchema.index({ volunteerId: 1, status: 1 });

module.exports = mongoose.model('Task', taskSchema);
