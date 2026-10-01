const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { memoryDb } = require('../db');

// GET /api/v1/exercise/plan
router.get('/plan', authenticateToken, (req, res) => {
  res.json({
    fastingAdaptedPlan: {
      intensityLevel: 'Gentle / Active Recovery (Adapted to Fasting)',
      recommendedWorkouts: [
        { id: 'w-1', name: 'Post-Iftar / Post-Fast Evening Walk', durationMinutes: 30, targetCalories: 120, notes: 'Ideal low-glycemic exercise' },
        { id: 'w-2', name: 'Gentle Mobility & Stretching', durationMinutes: 20, targetCalories: 80, notes: 'Promotes blood circulation without muscle stress' },
        { id: 'w-3', name: 'Core & Posture Routine', durationMinutes: 15, targetCalories: 90, notes: 'Perform 1 hour after breaking fast' }
      ]
    }
  });
});

// POST /api/v1/exercise/log
router.post('/log', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { workoutName, durationMinutes, caloriesBurned, intensity } = req.body;

  const newLog = {
    id: `e-${Date.now()}`,
    userId,
    workoutName: workoutName || 'Evening Walking & Stretching',
    durationMinutes: durationMinutes || 30,
    caloriesBurned: caloriesBurned || 120,
    intensity: intensity || 'Moderate',
    loggedAt: new Date()
  };

  memoryDb.exerciseLogs.push(newLog);

  res.status(201).json({ message: 'Workout logged successfully', log: newLog });
});

module.exports = router;
