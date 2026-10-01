const { getRamadanDateRange } = require('./ramadan_service');

/**
 * Fasting Rules Engine
 * Computes daily fasting rules based on user profile settings & liturgical calendar.
 */

async function calculateDailyFastingRule(userProfile, dateObj = new Date()) {
  const practice = userProfile?.fastingPractice || 'orthodox';
  const dayOfWeek = dateObj.getDay(); // 0 = Sun, 3 = Wed, 5 = Fri
  const dateStr = dateObj.toISOString().split('T')[0];

  if (practice === 'orthodox') {
    const isWednesday = dayOfWeek === 3;
    const isFriday = dayOfWeek === 5;

    if (isWednesday || isFriday) {
      const fastTitle = isWednesday ? 'Wednesday Fast' : 'Friday Fast';
      return {
        practice: 'orthodox',
        title: fastTitle,
        titleAmharic: isWednesday ? 'ረቡዕ ጾም' : 'አርብ ጾም',
        dayNumber: 3,
        isVeganRequired: true,
        fastingEndsTime: '3:00 PM (9 ሰዓት)',
        ruleDescription: 'Adhering to strict plant-based guidelines. Complete exclusion of meat, dairy, eggs, and animal fats.',
        allowedTodayText: '100% Plant-Based (Tsom)',
        tips: [
          { title: 'Protein Focus', desc: 'Combine Shiro (chickpeas) with Injera (teff) for a complete amino acid profile today.' },
          { title: 'B12 & Micronutrients', desc: 'Consider fortified plant milks or B12 supplementation during extended fasting.' }
        ]
      };
    }

    return {
      practice: 'orthodox',
      title: 'Non-Fasting Day',
      titleAmharic: 'የጾም ቀን አይደለም',
      isVeganRequired: false,
      fastingEndsTime: 'N/A',
      ruleDescription: 'Standard heritage nutrition day. Balanced protein, healthy fats, and complex carbohydrates allowed.',
      allowedTodayText: 'All Heritage Foods Allowed',
      tips: [
        { title: 'Iron Balance', desc: 'Incorporate lean meats or eggs alongside vitamin C rich greens (Gomen).' }
      ]
    };
  }

  if (practice === 'ramadan') {
    const ramadanInfo = await getRamadanDateRange(dateObj.getFullYear());
    return {
      practice: 'ramadan',
      title: 'Ramadan Daily Fast',
      titleAmharic: 'የረመዳን ጾም',
      isVeganRequired: false,
      fastingEndsTime: 'Sunset (Iftar)',
      ruleDescription: 'Abstain from food and water from sunrise (Suhoor) until sunset (Iftar). Focus on complex carbs during Suhoor and gentle rehydration during Iftar.',
      allowedTodayText: 'Suhoor & Iftar Optimized',
      tips: [
        { title: 'Suhoor Sustained Energy', desc: 'Consume Teff Genfo, dates, and ample water before dawn.' },
        { title: 'Iftar Gentle Recovery', desc: 'Break fast with water, dates, and warm Shiro or soups before heavy meals.' }
      ]
    };
  }

  return {
    practice: practice || 'custom',
    title: 'Custom Intermittent Fasting',
    titleAmharic: 'መደበኛ አመጋገብ',
    isVeganRequired: false,
    fastingEndsTime: '16:8 Window',
    ruleDescription: 'Standard daily nutrition tracking based on your custom profile goals.',
    allowedTodayText: 'Custom Targets Active',
    tips: [
      { title: 'Hydration Target', desc: 'Aim for at least 2.5L of water throughout your eating window.' }
    ]
  };
}

module.exports = { calculateDailyFastingRule };
