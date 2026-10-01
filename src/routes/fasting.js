const express = require('express');
const router = express.Router();
const { eq, and } = require('drizzle-orm');

const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');
const { profiles, fastingSchedules } = require('../db/schema');

// ============================================================
// GET /api/v1/fasting/today
// ============================================================
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().getDay(); // 0 = Sun, 3 = Wed, 5 = Fri

    // 1. Fetch user profile from PostgreSQL
    const profileResult = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const profile = profileResult[0] || { fastingPractice: 'orthodox' };
    const isOrthodox = profile.fastingPractice === 'orthodox';

    // Wednesday (3) and Friday (5) are fasting days in Ethiopian Orthodox tradition
    const isTodayFasting = isOrthodox && (dayOfWeek === 3 || dayOfWeek === 5);
    const fastTitle = isTodayFasting
      ? (dayOfWeek === 3 ? 'Wednesday Fast (Tsome Dihnet)' : 'Friday Fast (Tsome Dihnet)')
      : 'Non-Fasting Day';

    const fastTitleAmharic = isTodayFasting
      ? (dayOfWeek === 3 ? 'ረቡዕ ጾም' : 'ዓርብ ጾም')
      : 'የማይጾምበት ቀን';

    // 2. Fetch or save today's fasting schedule
    let schedule = await db
      .select()
      .from(fastingSchedules)
      .where(and(eq(fastingSchedules.userId, userId), eq(fastingSchedules.date, today)))
      .limit(1);

    if (schedule.length === 0) {
      const [newSchedule] = await db
        .insert(fastingSchedules)
        .values({
          userId,
          date: today,
          fastType: fastTitle,
          isVeganRequired: isTodayFasting,
          allowedDescription: isTodayFasting
            ? 'Strict plant-based Ethiopian dishes (Shiro, Misir, Gomen, Kik, Fosolia, Teff Injera). No dairy, meat, or eggs.'
            : 'All traditional Ethiopian foods and balanced heritage meals permitted.',
          fastingEndsTime: isTodayFasting ? '3:00 PM (9 ሰዓት)' : 'N/A',
        })
        .returning();
      schedule = [newSchedule];
    }

    return res.status(200).json({
      success: true,
      date: today,
      isFasting: isTodayFasting,
      activeFast: {
        title: fastTitle,
        titleAmharic: fastTitleAmharic,
        fastingEnds: isTodayFasting ? '3:00 PM (9 ሰዓት)' : 'N/A',
        dietaryRule: isTodayFasting ? 'Strict Vegan (ጾም)' : 'Regular Dietary Balance',
        isVeganRequired: isTodayFasting,
        allowedDescription: schedule[0]?.allowedDescription || 'Plant-based heritage meals.',
      },
      nutritionTips: [
        {
          id: 'tip-1',
          title: 'Plant Protein Synergy',
          category: 'Amino Acid Profile',
          description: 'Combine Shiro (chickpeas) with 100% Teff Injera for a complete essential amino acid profile.',
        },
        {
          id: 'tip-2',
          title: 'Iron & Vitamin C Pairings',
          category: 'Micronutrients',
          description: 'Pair Red Teff and Misir Wat with Gomen (vitamin C) to boost plant iron absorption by up to 300%.',
        },
      ],
    });
  } catch (err) {
    console.error('GET FASTING TODAY ERROR:', err);
    return res.status(500).json({ error: 'Failed to retrieve fasting status', details: err.message });
  }
});

// ============================================================
// GET /api/v1/fasting/calendar?month=10&year=2026
// ============================================================
router.get('/calendar', authenticateToken, async (req, res) => {
  try {
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthName = `${monthNames[month - 1] || 'Current Month'} ${year}`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const fastingDays = [];
    const events = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      if (dayOfWeek === 3) {
        fastingDays.push(day);
        events.push({ date: dateStr, title: 'Wednesday Fast (ረቡዕ ጾም)', type: 'orthodox' });
      } else if (dayOfWeek === 5) {
        fastingDays.push(day);
        events.push({ date: dateStr, title: 'Friday Fast (ዓርብ ጾም)', type: 'orthodox' });
      }
    }

    return res.status(200).json({
      month,
      year,
      monthName,
      currentSelectedDay: new Date().getDate(),
      fastingDays,
      events,
    });
  } catch (err) {
    console.error('GET FASTING CALENDAR ERROR:', err);
    return res.status(500).json({ error: 'Failed to retrieve fasting calendar', details: err.message });
  }
});

// ============================================================
// POST /api/v1/fasting/reminders
// ============================================================
router.post('/reminders', authenticateToken, (req, res) => {
  try {
    const { reminderTime, enabled } = req.body;
    return res.status(200).json({
      message: 'Break-fast reminder scheduled successfully',
      reminder: {
        reminderTime: reminderTime || '15:00',
        enabled: enabled !== undefined ? Boolean(enabled) : true,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to set reminder', details: err.message });
  }
});

module.exports = router;