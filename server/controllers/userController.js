const User = require('../models/User');

const getVolunteers = async (req, res) => {
  try {
    const volunteers = await User.find({ role: 'volunteer' })
      .select('name email phone isAvailable trackingStatus assignedIncidentId location locationUpdatedAt createdAt')
      .sort({ isAvailable: -1, createdAt: -1 });

    return res.json({ success: true, count: volunteers.length, data: volunteers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = role ? { role } : {};

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const setUserAvailability = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isAvailable: Boolean(req.body.isAvailable) },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, data: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const promoteToAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'User is already an admin' });
    }

    user.role = 'admin';
    await user.save();

    return res.json({
      success: true,
      message: `${user.email} promoted to admin`,
      data: user.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getVolunteers,
  getAllUsers,
  setUserAvailability,
  promoteToAdmin,
};