const express = require('express');
const router = express.Router();
const { eq, and } = require('drizzle-orm');

const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');
const { profiles, mealPlans, groceryItems } = require('../db/schema');

function getWeekIdentifier(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNumber = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

// ============================================================
// GET /api/v1/meal-plans/weekly?week=current
// ============================================================
router.get('/meal-plans/weekly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestedWeek =
      !req.query.week || req.query.week === 'current'
        ? getWeekIdentifier()
        : String(req.query.week);

    // 1. Check existing plan in PostgreSQL
    const existing = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekIdentifier, requestedWeek)))
      .limit(1);

    if (existing.length > 0) {
      return res.status(200).json({
        message: 'Meal plan retrieved successfully',
        plan: existing[0],
      });
    }

    // 2. Fetch profile from PostgreSQL
    const profileResult = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const profile = profileResult[0] || { fastingPractice: 'orthodox', goal: 'maintain_weight' };

    // 3. AI Fasting generation with safety fallback
    let aiResult;
    try {
      const { generateMealPlanWithAI } = require('../services/openrouter_service');
      const { calculateDailyFastingRule } = require('../services/fasting_engine');
      const fastingRule = await calculateDailyFastingRule(profile).catch(() => ({ fasting: false }));
      aiResult = await generateMealPlanWithAI({ profile, fastingRule, userId });
    } catch (_) {}

    if (!aiResult || !aiResult.planDays) {
      aiResult = {
        summary: 'Balanced Ethiopian Heritage & Fasting Plan',
        planDays: [
          {
            day: 'Monday',
            isFasting: false,
            meals: [
              { mealType: 'breakfast', foodName: 'Kinche with olive oil', calories: 320, proteinGrams: 8, carbsGrams: 45, fatsGrams: 6, ironMg: 3.5 },
              { mealType: 'lunch', foodName: 'Doro Wat with Teff Injera', calories: 580, proteinGrams: 36, carbsGrams: 60, fatsGrams: 14, ironMg: 8.5 },
              { mealType: 'dinner', foodName: 'Atkilt Wat with Injera', calories: 360, proteinGrams: 9, carbsGrams: 65, fatsGrams: 5, ironMg: 4.2 },
            ],
          },
          {
            day: 'Wednesday',
            isFasting: true,
            meals: [
              { mealType: 'breakfast', foodName: 'Oatmeal with Flaxseed (Telba)', calories: 290, proteinGrams: 9, carbsGrams: 48, fatsGrams: 5, ironMg: 3.0 },
              { mealType: 'lunch', foodName: 'Shiro Tegabino with Teff Injera', calories: 480, proteinGrams: 18, carbsGrams: 75, fatsGrams: 9, ironMg: 13.5 },
              { mealType: 'dinner', foodName: 'Gomen Wat with Suf Fitfit', calories: 390, proteinGrams: 12, carbsGrams: 55, fatsGrams: 8, ironMg: 7.8 },
            ],
          },
          {
            day: 'Friday',
            isFasting: true,
            meals: [
              { mealType: 'breakfast', foodName: 'Roasted Barley (Kolo) with Spiced Tea', calories: 240, proteinGrams: 7, carbsGrams: 42, fatsGrams: 4, ironMg: 2.8 },
              { mealType: 'lunch', foodName: 'Misir Wat with Teff Injera', calories: 450, proteinGrams: 20, carbsGrams: 68, fatsGrams: 7, ironMg: 12.0 },
              { mealType: 'dinner', foodName: 'Defen Misir & Fosolia with Injera', calories: 380, proteinGrams: 16, carbsGrams: 60, fatsGrams: 6, ironMg: 8.4 },
            ],
          },
        ],
      };
    }

    // 4. Save to PostgreSQL
    const [inserted] = await db
      .insert(mealPlans)
      .values({
        userId,
        weekIdentifier: requestedWeek,
        planData: aiResult,
      })
      .returning();

    return res.status(201).json({
      message: 'New personalized meal plan generated',
      plan: inserted,
    });
  } catch (err) {
    console.error('GET WEEKLY MEAL PLAN ERROR:', err);
    return res.status(500).json({ error: 'Failed to retrieve meal plan', details: err.message });
  }
});

// ============================================================
// POST /api/v1/meal-plans/generate
// ============================================================
router.post('/meal-plans/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const weekIdentifier = getWeekIdentifier();

    const profileResult = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    const profile = profileResult[0] || { fastingPractice: 'orthodox', goal: 'maintain_weight' };

    let aiResult;
    try {
      const { generateMealPlanWithAI } = require('../services/openrouter_service');
      const { calculateDailyFastingRule } = require('../services/fasting_engine');
      const fastingRule = await calculateDailyFastingRule(profile).catch(() => ({ fasting: false }));
      aiResult = await generateMealPlanWithAI({ profile, fastingRule, userId });
    } catch (_) {}

    if (!aiResult || !aiResult.planDays) {
      aiResult = {
        summary: 'Personalized Ethiopian Fasting Plan',
        planDays: [
          {
            day: 'Wednesday',
            isFasting: true,
            meals: [{ mealType: 'lunch', foodName: 'Shiro Wat with Teff Injera', calories: 450, proteinGrams: 16 }],
          },
          {
            day: 'Friday',
            isFasting: true,
            meals: [{ mealType: 'lunch', foodName: 'Misir Wat with Gomen & Teff Injera', calories: 460, proteinGrams: 19 }],
          },
        ],
      };
    }

    await db.delete(mealPlans).where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekIdentifier, weekIdentifier)));

    const [inserted] = await db
      .insert(mealPlans)
      .values({
        userId,
        weekIdentifier,
        planData: aiResult,
      })
      .returning();

    return res.status(201).json({
      message: 'New personalized meal plan generated',
      plan: inserted,
    });
  } catch (err) {
    console.error('GENERATE MEAL PLAN ERROR:', err);
    return res.status(500).json({ error: 'Failed to generate meal plan', details: err.message });
  }
});

// ============================================================
// GET /api/v1/grocery/list
// ============================================================
router.get('/grocery/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let items = await db.select().from(groceryItems).where(eq(groceryItems.userId, userId));

    if (items.length === 0) {
      const defaultItems = [
        { userId, name: 'Chickpea Flour (Shiro Powder)', category: 'Legumes', quantity: '2.5 kg', estimatedPriceEtb: 320, isChecked: false },
        { userId, name: 'Nech Teff Grain', category: 'Grains', quantity: '5.0 kg', estimatedPriceEtb: 780, isChecked: true },
        { userId, name: 'Berbere Spice Blend', category: 'Spices', quantity: '500 g', estimatedPriceEtb: 190, isChecked: false },
        { userId, name: 'Red Lentils (Misir)', category: 'Legumes', quantity: '2.0 kg', estimatedPriceEtb: 260, isChecked: false },
        { userId, name: 'Sunflower Seeds (Suf for Fitfit)', category: 'Seeds', quantity: '1.0 kg', estimatedPriceEtb: 160, isChecked: false },
        { userId, name: 'Flaxseeds (Telba)', category: 'Seeds', quantity: '500 g', estimatedPriceEtb: 120, isChecked: false },
      ];

      items = await db.insert(groceryItems).values(defaultItems).returning();
    }

    const estimatedTotal = items.reduce((acc, i) => acc + Number(i.estimatedPriceEtb || 0), 0);

    return res.status(200).json({
      totalItems: items.length,
      estimatedTotalEtb: Math.round(estimatedTotal * 100) / 100,
      items,
    });
  } catch (err) {
    console.error('GET GROCERY LIST ERROR:', err);
    return res.status(500).json({ error: 'Failed to retrieve grocery list', details: err.message });
  }
});

// ============================================================
// POST /api/v1/grocery/generate
// ============================================================
router.post('/grocery/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const weekIdentifier = getWeekIdentifier();

    const plans = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekIdentifier, weekIdentifier)))
      .limit(1);

    let generatedItems = [];
    if (plans.length > 0) {
      try {
        const { generateGroceryListWithAI } = require('../services/openrouter_service');
        if (typeof generateGroceryListWithAI === 'function') {
          generatedItems = await generateGroceryListWithAI(plans[0].planData);
        }
      } catch (_) {}
    }

    if (!Array.isArray(generatedItems) || generatedItems.length === 0) {
      generatedItems = [
        { name: 'Shiro Powder (Chickpea)', category: 'Legumes', quantity: '3 kg', estimatedPriceEtb: 360 },
        { name: 'Nech Teff Grain (Whole Grain)', category: 'Grains', quantity: '6 kg', estimatedPriceEtb: 920 },
        { name: 'Red Lentils (Misir)', category: 'Legumes', quantity: '2.5 kg', estimatedPriceEtb: 310 },
        { name: 'Berbere Spices', category: 'Spices', quantity: '500 g', estimatedPriceEtb: 190 },
        { name: 'Fresh Gomen (Collard Greens)', category: 'Vegetables', quantity: '2 kg', estimatedPriceEtb: 90 },
        { name: 'Flaxseeds (Telba)', category: 'Seeds', quantity: '500 g', estimatedPriceEtb: 130 },
      ];
    }

    await db.delete(groceryItems).where(eq(groceryItems.userId, userId));

    const values = generatedItems.map((item) => ({
      userId,
      name: item.name,
      category: item.category || 'General',
      quantity: item.quantity || '1 unit',
      estimatedPriceEtb: Number(item.estimatedPriceEtb || 100),
      isChecked: false,
    }));

    const inserted = await db.insert(groceryItems).values(values).returning();
    const estimatedTotal = inserted.reduce((acc, i) => acc + Number(i.estimatedPriceEtb || 0), 0);

    return res.status(201).json({
      message: 'Grocery list generated from active meal plan',
      totalItems: inserted.length,
      estimatedTotalEtb: Math.round(estimatedTotal * 100) / 100,
      items: inserted,
    });
  } catch (err) {
    console.error('GENERATE GROCERY ERROR:', err);
    return res.status(500).json({ error: 'Failed to generate grocery list', details: err.message });
  }
});

// ============================================================
// PATCH /api/v1/grocery/items/:id
// ============================================================
router.patch('/grocery/items/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const itemId = req.params.id;
    const { isChecked, quantity } = req.body;

    const updateData = {};
    if (typeof isChecked === 'boolean') updateData.isChecked = isChecked;
    if (quantity !== undefined) updateData.quantity = String(quantity);

    const [updated] = await db
      .update(groceryItems)
      .set(updateData)
      .where(and(eq(groceryItems.id, itemId), eq(groceryItems.userId, userId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Grocery item not found' });
    }

    return res.status(200).json({ message: 'Grocery item updated', item: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update grocery item', details: err.message });
  }
});

// ============================================================
// DELETE /api/v1/grocery/items/:id
// ============================================================
router.delete('/grocery/items/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const itemId = req.params.id;

    const [deleted] = await db
      .delete(groceryItems)
      .where(and(eq(groceryItems.id, itemId), eq(groceryItems.userId, userId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: 'Grocery item not found' });
    }

    return res.status(200).json({ message: 'Grocery item deleted', item: deleted });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete grocery item', details: err.message });
  }
});

module.exports = router;