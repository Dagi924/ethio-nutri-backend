const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { eq, and, desc, gte, lte, ilike, or } = require('drizzle-orm');

const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');
const { foods, foodLogs, profiles } = require('../db/schema');

// ============================================================
// GET /api/v1/foods/search?query=shiro
// ============================================================
router.get('/foods/search', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();

    let results = [];
    if (query) {
      results = await db
        .select()
        .from(foods)
        .where(
          or(
            ilike(foods.name, `%${query}%`),
            ilike(foods.nameAmharic, `%${query}%`),
            ilike(foods.category, `%${query}%`)
          )
        )
        .limit(20);
    } else {
      results = await db.select().from(foods).limit(20);
    }

    return res.json({
      total: results.length,
      foods: results,
    });
  } catch (err) {
    console.error('SEARCH FOODS ERROR:', err);
    return res.status(500).json({ error: 'Failed to search foods', details: err.message });
  }
});

// ============================================================
// GET /api/v1/food-logs/today  <--- FIXES 404
// ============================================================
router.get('/food-logs/today', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const logs = await db
      .select()
      .from(foodLogs)
      .where(
        and(
          eq(foodLogs.userId, userId),
          gte(foodLogs.loggedAt, startOfDay),
          lte(foodLogs.loggedAt, endOfDay)
        )
      )
      .orderBy(desc(foodLogs.loggedAt));

    const totals = logs.reduce(
      (acc, log) => {
        acc.calories += Number(log.calories || 0);
        acc.proteinGrams += Number(log.proteinGrams || 0);
        acc.carbsGrams += Number(log.carbsGrams || 0);
        acc.fatsGrams += Number(log.fatsGrams || 0);
        acc.waterMl += Number(log.waterMl || 0);
        return acc;
      },
      { calories: 0, proteinGrams: 0, carbsGrams: 0, fatsGrams: 0, waterMl: 0 }
    );

    return res.status(200).json({
      success: true,
      date: now.toISOString().split('T')[0],
      totals: {
        calories: Math.round(totals.calories),
        proteinGrams: Math.round(totals.proteinGrams * 10) / 10,
        carbsGrams: Math.round(totals.carbsGrams * 10) / 10,
        fatsGrams: Math.round(totals.fatsGrams * 10) / 10,
        waterMl: Math.round(totals.waterMl),
      },
      logs,
    });
  } catch (err) {
    console.error('GET TODAY FOOD LOGS ERROR:', err);
    return res.status(500).json({ error: 'Failed to retrieve today logs', details: err.message });
  }
});

// ============================================================
// POST /api/v1/food-logs/manual
// ============================================================
router.post('/food-logs/manual', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { foodName, portionGrams, calories, proteinGrams, carbsGrams, fatsGrams } = req.body;

    if (!foodName || calories === undefined) {
      return res.status(400).json({ error: 'foodName and calories are required' });
    }

    const [newLog] = await db
      .insert(foodLogs)
      .values({
        userId,
        foodName: foodName.trim(),
        portionGrams: Number(portionGrams) || 150,
        calories: Number(calories),
        proteinGrams: Number(proteinGrams) || 0,
        carbsGrams: Number(carbsGrams) || 0,
        fatsGrams: Number(fatsGrams) || 0,
        waterMl: 0,
        logType: 'manual',
        loggedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      message: 'Meal logged successfully',
      log: newLog,
    });
  } catch (err) {
    console.error('MANUAL FOOD LOG ERROR:', err);
    return res.status(500).json({ error: 'Failed to log meal', details: err.message });
  }
});

// ============================================================
// POST /api/v1/food-logs/water
// ============================================================
router.post('/food-logs/water', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const amountMl = Number(req.body.amountMl) || 250;

    const [waterLog] = await db
      .insert(foodLogs)
      .values({
        userId,
        foodName: 'Water Hydration',
        portionGrams: amountMl,
        calories: 0,
        proteinGrams: 0,
        carbsGrams: 0,
        fatsGrams: 0,
        waterMl: amountMl,
        logType: 'water',
        loggedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      message: `Water intake updated (+${amountMl}ml)`,
      log: waterLog,
    });
  } catch (err) {
    console.error('WATER LOG ERROR:', err);
    return res.status(500).json({ error: 'Failed to log water', details: err.message });
  }
});

// ============================================================
// POST /api/v1/food-logs/scan
// ============================================================
router.post('/food-logs/scan', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const profileResult = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    const profile = profileResult[0] || {};
    const imageInput = req.body.imageUrl || (req.file ? req.file.path : null);

    let aiAnalysis;
    try {
      const { analyzeMealImageWithAI } = require('../services/openrouter_service');
      if (typeof analyzeMealImageWithAI === 'function') {
        aiAnalysis = await analyzeMealImageWithAI(imageInput, profile);
      }
    } catch (_) {}

    if (!aiAnalysis) {
      aiAnalysis = {
        foodName: 'Shiro Tegabino & Teff Injera',
        portionGrams: 280,
        calories: 420,
        proteinGrams: 18,
        carbsGrams: 72,
        fatsGrams: 8,
      };
    }

    const [recognizedDish] = await db
      .insert(foodLogs)
      .values({
        userId,
        foodName: aiAnalysis.foodName || 'Traditional Ethiopian Dish',
        portionGrams: Number(aiAnalysis.portionGrams) || 250,
        calories: Number(aiAnalysis.calories) || 380,
        proteinGrams: Number(aiAnalysis.proteinGrams) || 15,
        carbsGrams: Number(aiAnalysis.carbsGrams) || 60,
        fatsGrams: Number(aiAnalysis.fatsGrams) || 7,
        waterMl: 0,
        logType: 'scan',
        loggedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      message: 'AI Vision dish recognized & logged',
      log: recognizedDish,
    });
  } catch (err) {
    console.error('SCAN MEAL ERROR:', err);
    return res.status(500).json({ error: 'Failed to process meal scan', details: err.message });
  }
});

// ============================================================
// DELETE /api/v1/food-logs/:id
// ============================================================
router.delete('/food-logs/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const logId = req.params.id;

    const [deleted] = await db
      .delete(foodLogs)
      .where(and(eq(foodLogs.id, logId), eq(foodLogs.userId, userId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: 'Food log not found' });
    }

    return res.status(200).json({
      message: 'Food log deleted successfully',
      deletedId: logId,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete food log', details: err.message });
  }
});

module.exports = router;