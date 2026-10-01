const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const { generateTokens } = require('../middleware/auth');
const { db } = require('../db');

const {
  users,
  profiles,
} = require('../db/schema');

const { eq } = require('drizzle-orm');


// ============================================================
// POST /api/v1/auth/register
// ============================================================

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      phone,
      role,

      fastingPractice,
      healthConditions,
      language,
      theme,
      notificationsEnabled,

      age,
      gender,
      weightKg,
      targetWeightKg,
      heightCm,
      goal,
      budgetLevel,

      dailyCalorieTarget,
      dailyProteinTarget,
      dailyCarbsTarget,
      dailyFatsTarget,
      dailyWaterTarget,
    } = req.body;


    // --------------------------------------------------------
    // Validate required fields
    // --------------------------------------------------------

    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Email, password, and name are required',
      });
    }


    const normalizedEmail = email.trim().toLowerCase();


    // --------------------------------------------------------
    // Check if user already exists in PostgreSQL
    // --------------------------------------------------------

    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingUsers.length > 0) {
      return res.status(400).json({
        error: 'User with this email already exists',
      });
    }


    // --------------------------------------------------------
    // Hash password
    // --------------------------------------------------------

    const passwordHash = await bcrypt.hash(password, 12);


    // --------------------------------------------------------
    // INSERT USER INTO REAL POSTGRESQL DATABASE
    // --------------------------------------------------------

    const insertedUsers = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        phone: phone || null,
        passwordHash,
        name: name.trim(),
        role: role || 'user',
        isPremium: false,
        paymentStatus: 'free_tier',
      })
      .returning();


    const newUser = insertedUsers[0];


    if (!newUser) {
      throw new Error('User was not created');
    }


    // --------------------------------------------------------
    // INSERT PROFILE INTO REAL POSTGRESQL DATABASE
    // --------------------------------------------------------

    const insertedProfiles = await db
      .insert(profiles)
      .values({
        userId: newUser.id,

        fastingPractice:
          fastingPractice || 'orthodox',

        healthConditions:
          healthConditions || [],

        language:
          language || 'en',

        theme:
          theme || 'light',

        notificationsEnabled:
          notificationsEnabled ?? true,

        age:
          age ?? 28,

        gender:
          gender || 'other',

        weightKg:
          weightKg ?? 68,

        targetWeightKg:
          targetWeightKg ?? 65,

        heightCm:
          heightCm ?? 172,

        goal:
          goal || 'lose_weight',

        budgetLevel:
          budgetLevel || 'medium',

        dailyCalorieTarget:
          dailyCalorieTarget ?? 2000,

        dailyProteinTarget:
          dailyProteinTarget ?? 60,

        dailyCarbsTarget:
          dailyCarbsTarget ?? 220,

        dailyFatsTarget:
          dailyFatsTarget ?? 50,

        dailyWaterTarget:
          dailyWaterTarget ?? 2.5,

        onboardingCompleted: true,
      })
      .returning();


    const newProfile = insertedProfiles[0];


    // --------------------------------------------------------
    // Generate JWT tokens
    // --------------------------------------------------------

    const tokens = generateTokens({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });


    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.status(201).json({
      message: 'User registered successfully',

      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        isPremium: newUser.isPremium,
        paymentStatus: newUser.paymentStatus,
      },

      profile: newProfile,

      ...tokens,
    });

  } catch (err) {

    console.error('REGISTER ERROR:', err);

    return res.status(500).json({
      error: err.message || 'Registration failed',
    });
  }
});


// ============================================================
// POST /api/v1/auth/login
// ============================================================

router.post('/login', async (req, res) => {
  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
      });
    }


    const normalizedEmail = email.trim().toLowerCase();


    // --------------------------------------------------------
    // FETCH USER FROM POSTGRESQL
    // --------------------------------------------------------

    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);


    if (result.length === 0) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }


    const user = result[0];


    // --------------------------------------------------------
    // Compare password
    // --------------------------------------------------------

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );


    if (!passwordMatches) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }


    // --------------------------------------------------------
    // Fetch profile from PostgreSQL
    // --------------------------------------------------------

    const profileResult = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);


    const profile = profileResult[0] || null;


    // --------------------------------------------------------
    // Generate tokens
    // --------------------------------------------------------

    const tokens = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });


    // --------------------------------------------------------
    // Response
    // --------------------------------------------------------

    return res.json({

      message: 'Login successful',

      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isPremium: user.isPremium,
        paymentStatus: user.paymentStatus,
      },

      profile,

      ...tokens,
    });

  } catch (err) {

    console.error('LOGIN ERROR:', err);

    return res.status(500).json({
      error: err.message || 'Login failed',
    });
  }
});


// ============================================================
// POST /api/v1/auth/refresh
// ============================================================

router.post('/refresh', (req, res) => {

  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      error: 'Refresh token is required',
    });
  }

  try {

    const { verifyRefreshToken } = require('../middleware/auth');

    const decoded = verifyRefreshToken(refreshToken);

    const tokens = generateTokens({
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    });

    return res.json(tokens);

  } catch (error) {

    return res.status(401).json({
      error: 'Invalid or expired refresh token',
    });
  }
});


module.exports = router;