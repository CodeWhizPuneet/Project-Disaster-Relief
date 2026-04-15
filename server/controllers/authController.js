const { validationResult } = require('express-validator');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');

const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, role, phone } = req.body;

  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists with this email' });
    }

    const requestedRole = role === 'volunteer' ? 'volunteer' : 'user';

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      role: requestedRole,
      phone: phone ? String(phone).trim() : '',
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isPasswordValid = await user.matchPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id, user.role);

    return res.json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  return res.json({ success: true, user: req.user });
};

const updateAvailability = async (req, res) => {
  try {
    const isAvailable = Boolean(req.body.isAvailable);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        isAvailable,
        trackingStatus: isAvailable ? 'available' : 'offline',
        assignedIncidentId: isAvailable ? null : req.user.assignedIncidentId || null,
      },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateAvailability,
};
