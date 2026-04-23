const express = require('express');
const { getRoute } = require('../controllers/routeController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);
router.post('/', authorize('admin', 'volunteer', 'user'), getRoute);

module.exports = router;
