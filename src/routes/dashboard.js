const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { calculateDailyFastingRule } = require('../services/fasting_engine');
const { memoryDb } = require('../db');

// GET /api/v1/dashboard/summary
router.get('/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let profile = memoryDb.profiles.find(p => p.userId === userId) || {
      fastingPractice: 'orthodox',
      healthConditions: [],
      dailyCalorieTarget: 2000,
      dailyProteinTarget: 60,
      dailyCarbsTarget: 220,
      dailyFatsTarget: 50,
      dailyWaterTarget: 2.5
    };

    const fastingCycle = await calculateDailyFastingRule(profile);

    const userLogs = memoryDb.foodLogs.filter(l => l.userId === userId);
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;
    let totalWater = 0.0;

    if (userLogs.length > 0) {
      totalCalories = userLogs.reduce((acc, l) => acc + (l.calories || 0), 0);
      totalProtein = Math.round(userLogs.reduce((acc, l) => acc + (l.proteinGrams || 0), 0));
      totalCarbs = Math.round(userLogs.reduce((acc, l) => acc + (l.carbsGrams || 0), 0));
      totalFats = Math.round(userLogs.reduce((acc, l) => acc + (l.fatsGrams || 0), 0));
      totalWater = Math.round((userLogs.reduce((acc, l) => acc + (l.waterMl || 0), 0) / 1000) * 10) / 10;
    }

    const alerts = [];
    if (userLogs.length > 0 && totalProtein < (profile.dailyProteinTarget || 60) * 0.5) {
      alerts.push({
        id: 'alert-protein-1',
        title: 'Protein Intake Low',
        message: 'You are below 50% of your daily protein target. Consider adding Shiro Tegabino or lentils.',
        severity: 'warning'
      });
    }

    const isVeganToday = fastingCycle.isVeganRequired;

    const aiSuggestedMeal = {
      title: isVeganToday ? 'Shiro Tegabino & Teff Injera' : 'Doro Wat & Quinoa',
      titleAmharic: isVeganToday ? 'ሽሮ ተጋቢኖ' : 'ዶሮ ወጥ',
      description: isVeganToday
        ? 'High-protein chickpea claypot stew paired with iron-rich Teff Injera.'
        : 'A modern twist on a heritage classic. High protein to meet your targets.',
      calories: 450,
      tags: ['450 kcal', isVeganToday ? '100% Plant-Based' : 'High Protein', 'Iron Rich'],
      imageUrl: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80',
      actionLogAvailable: true
    };

    res.json({
      currentCycle: {
        title: fastingCycle.title,
        dayText: 'Wednesday Fast Day 3',
        description: fastingCycle.ruleDescription,
        allowedBadge: fastingCycle.allowedTodayText,
        fastingEndsTime: fastingCycle.fastingEndsTime
      },
      nutritionMetrics: {
        caloriesEaten: Math.round(totalCalories),
        calorieTarget: profile.dailyCalorieTarget || 2000,
        proteinGrams: totalProtein,
        proteinTarget: profile.dailyProteinTarget || 60,
        carbsGrams: totalCarbs,
        carbsTarget: profile.dailyCarbsTarget || 220,
        fatsGrams: totalFats,
        fatsTarget: profile.dailyFatsTarget || 50,
        waterLiters: totalWater,
        waterTarget: profile.dailyWaterTarget || 2.5
      },
      alerts,
      aiSuggestedMeal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/analytics/trends?period=weekly
router.get('/analytics/trends', authenticateToken, (req, res) => {
  res.json({
    period: req.query.period || 'weekly',
    weeklyCalorieAverage: 1850,
    proteinComplianceRate: '88%',
    ironComplianceRate: '72%',
    fastingAdherenceDays: 7,
    dailyTrends: [
      { day: 'Mon', calories: 1920, protein: 62, ironMg: 14.5 },
      { day: 'Tue', calories: 1840, protein: 58, ironMg: 18.2 },
      { day: 'Wed (Fast)', calories: 1780, protein: 54, ironMg: 16.8 },
      { day: 'Thu', calories: 1980, protein: 68, ironMg: 15.0 },
      { day: 'Fri (Fast)', calories: 1800, protein: 56, ironMg: 17.5 },
      { day: 'Sat', calories: 2050, protein: 70, ironMg: 13.8 },
      { day: 'Sun', calories: 1900, protein: 65, ironMg: 16.2 }
    ]
  });
});

// GET /api/v1/analytics/deficiency-alerts
router.get('/analytics/deficiency-alerts', authenticateToken, (req, res) => {
  res.json({
    deficienciesDetected: [
      { id: 'd-1', nutrient: 'Iron', riskLevel: 'Moderate', recommendation: 'Increase Red Teff Injera, Misir Wat, and Gomen intake.' },
      { id: 'd-2', nutrient: 'Vitamin B12', riskLevel: 'Low-to-Moderate (Tsom Fasting)', recommendation: 'Take B12 supplement on extended Tsom fast days.' }
    ]
  });
});

module.exports = router;
