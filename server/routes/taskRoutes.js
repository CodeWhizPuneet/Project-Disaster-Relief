const express = require('express');
const {
  createTask,
  getAllTasks,
  getMyTasks,
  updateTaskStatus,
  getAssignmentSuggestions,
  autoAssignNearestVolunteer,
} = require('../controllers/taskController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', authorize('admin'), getAllTasks);
router.post('/', authorize('admin'), createTask);
router.post('/auto-assign/:requestId', authorize('admin'), autoAssignNearestVolunteer);
router.get('/suggestions/:requestId', authorize('admin'), getAssignmentSuggestions);
router.get('/my-tasks', authorize('volunteer'), getMyTasks);
router.patch('/:id/status', authorize('volunteer'), updateTaskStatus);

module.exports = router;