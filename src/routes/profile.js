const express = require('express');
const router = express.Router();
const { eq } = require('drizzle-orm');

const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');
const { users, profiles } = require('../db/schema');

// GET /api/v1/user/profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user from PostgreSQL database
    const userResult = await db
      .select({
        id: users.id,
        email: users.email,
        phone: users.phone,
        name: users.name,
        role: users.role,
        isPremium: users.isPremium,
        paymentStatus: users.paymentStatus,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch profile from PostgreSQL database
    const profileResult = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    return res.status(200).json({
      success: true,
      user: userResult[0],
      profile: profileResult[0] || null,
    });
  } catch (err) {
    console.error('Profile retrieval error:', err);
    return res.status(500).json({
      error: 'Failed to retrieve user profile',
      details: err.message,
    });
  }
});

// PUT /api/v1/user/profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = { updatedAt: new Date() };

    const allowedFields = [
      'fastingPractice',
      'healthConditions',
      'language',
      'theme',
      'notificationsEnabled',
      'age',
      'gender',
      'weightKg',
      'targetWeightKg',
      'heightCm',
      'goal',
      'budgetLevel',
      'dailyCalorieTarget',
      'dailyProteinTarget',
      'dailyCarbsTarget',
      'dailyFatsTarget',
      'dailyWaterTarget',
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const existing = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    let updatedProfile;
    if (existing.length > 0) {
      [updatedProfile] = await db
        .update(profiles)
        .set(updateData)
        .where(eq(profiles.userId, userId))
        .returning();
    } else {
      [updatedProfile] = await db
        .insert(profiles)
        .values({
          userId,
          ...updateData,
          onboardingCompleted: true,
        })
        .returning();
    }

    return res.status(200).json({
      message: 'Profile updated successfully',
      profile: updatedProfile,
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({
      error: 'Failed to update user profile',
      details: err.message,
    });
  }
});

module.exports = router;