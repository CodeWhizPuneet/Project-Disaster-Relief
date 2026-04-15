const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'volunteer', 'admin'],
      default: 'user',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    locationUpdatedAt: {
      type: Date,
      default: null,
    },
    trackingStatus: {
      type: String,
      enum: ['offline', 'available', 'assigned'],
      default: 'offline',
    },
    assignedIncidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Request',
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });
userSchema.index({ role: 1, isAvailable: 1, trackingStatus: 1 });

userSchema.pre('save', async function saveHook() {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = function matchPassword(enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone,
    isAvailable: this.isAvailable,
    trackingStatus: this.trackingStatus,
    assignedIncidentId: this.assignedIncidentId,
    location: this.location,
    locationUpdatedAt: this.locationUpdatedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('User', userSchema);