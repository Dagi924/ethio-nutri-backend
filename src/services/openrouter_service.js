const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * ============================================================
 * ETHIONUTRI AI - OPENROUTER SERVICE
 * ============================================================
 *
 * Supports:
 *   1. AI meal-plan generation
 *   2. AI nutrition chatbot
 *   3. AI Ethiopian food image recognition
 *
 * Strategy:
 *   - OpenRouter free router first
 *   - Current explicit free-model fallbacks
 *   - Retry other models when one fails
 *   - Never invent a food-recognition result when vision fails
 *
 * ============================================================
 */

/**
 * ============================================================
 * FREE MODELS
 * ============================================================
 *
 * `openrouter/free` is kept first because OpenRouter can select
 * an available free model automatically.
 *
 * The explicit models below are current free-model IDs.
 *
 * ============================================================
 */

const FREE_MODELS = [
  'openrouter/free',

  // Current free fallback models
  'qwen/qwen3.8-27b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'inclusionai/ling-3.0-flash-vl:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

/**
 * Image-capable free models.
 *
 * Keep the free router first. It can select an available
 * model with image understanding.
 */
const IMAGE_MODELS = [
  'openrouter/free',
  'qwen/qwen3.8-27b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'inclusionai/ling-3.0-flash-vl:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

/**
 * ============================================================
 * OPENROUTER API
 * ============================================================
 */

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

/**
 * ============================================================
 * API KEY
 * ============================================================
 */

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    return null;
  }

  if (key === 'your_openrouter_api_key_here') {
    return null;
  }

  return key.trim();
}

/**
 * ============================================================
 * HEADERS
 * ============================================================
 */

function getHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',

    // Change this when deploying to production.
    'HTTP-Referer': 'http://localhost:3000',

    'X-Title': 'EthioNutri AI',
  };
}

/**
 * ============================================================
 * JSON CLEANER
 * ============================================================
 *
 * AI models sometimes return:
 *
 * ```json
 * {...}
 * ```
 *
 * instead of raw JSON.
 *
 * This function extracts the actual JSON object.
 * ============================================================
 */

function cleanJsonResponse(content) {
  if (!content) {
    throw new Error('AI returned an empty response');
  }

  let text = String(content).trim();

  // Remove markdown fences.
  text = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Remove possible leading/trailing whitespace.
  text = text.trim();

  const firstBrace = text.indexOf('{');

  if (firstBrace === -1) {
    throw new Error('No JSON object found in AI response');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;

      if (depth === 0) {
        return text.substring(firstBrace, i + 1);
      }
    }
  }

  throw new Error('Incomplete JSON object returned by AI');
}

/**
 * ============================================================
 * OPENROUTER CALL
 * ============================================================
 */

async function callOpenRouter({
  messages,
  temperature = 0.5,
  maxTokens = 1000,
  timeout = 30000,
  models = FREE_MODELS,
}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is missing or invalid'
    );
  }

  let lastError = null;

  /**
   * Remove duplicate model IDs while preserving order.
   */
  const uniqueModels = [
    ...new Set(
      Array.isArray(models) && models.length
        ? models
        : FREE_MODELS
    ),
  ];

  for (const model of uniqueModels) {
    try {
      console.log(
        `[EthioNutri AI] Trying OpenRouter model: ${model}`
      );

      const requestBody = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      /**
       * IMPORTANT:
       *
       * We intentionally do NOT send `response_format`
       * here.
       *
       * Some free OpenRouter models/providers do not support
       * structured response_format even though they support
       * normal JSON instructions.
       *
       * We instead force JSON through the prompt and parse it
       * ourselves using cleanJsonResponse().
       */

      const response = await axios.post(
        OPENROUTER_URL,
        requestBody,
        {
          headers: getHeaders(apiKey),
          timeout,
        }
      );

      const content =
        response.data?.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(
          `Model ${model} returned an empty response`
        );
      }

      console.log(
        `[EthioNutri AI] SUCCESS using model: ${model}`
      );

      return {
        model,
        content,
        raw: response.data,
      };
    } catch (error) {
      lastError = error;

      const errorData =
        error?.response?.data || error?.message;

      console.warn(
        `[EthioNutri AI] Model failed: ${model}`,
        errorData
      );

      continue;
    }
  }

  throw (
    lastError ||
    new Error('All OpenRouter models failed')
  );
}

/**
 * ============================================================
 * PARAMETER EXTRACTION
 * ============================================================
 */

function extractParams(arg1, arg2) {
  let profile = {};

  let fastingRule = {
    title: 'Standard Fast',
    isVeganRequired: false,
  };

  if (arg1 && typeof arg1 === 'object') {
    if (arg1.profile) {
      profile = arg1.profile;

      fastingRule =
        arg1.fastingRule || fastingRule;
    } else {
      profile = arg1;

      fastingRule =
        arg2 || fastingRule;
    }
  }

  return {
    profile,
    fastingRule,
  };
}

/**
 * ============================================================
 * 1. GENERATE MEAL PLAN
 * ============================================================
 */

async function generateMealPlanWithAI(arg1, arg2) {
  const {
    profile,
    fastingRule,
  } = extractParams(arg1, arg2);

  const isVegan =
    Boolean(fastingRule.isVeganRequired);

  const promptText = `
You are EthioNutri AI, an expert nutrition assistant
specializing in Ethiopian traditional foods and fasting.

Generate a personalized 7-day Ethiopian meal plan.

USER PROFILE:

Fasting Practice:
${profile.fastingPractice || 'Orthodox Christian'}

Strict Vegan Required:
${isVegan}

Health Conditions:
${JSON.stringify(
  profile.healthConditions || []
)}

Daily Calories:
${profile.dailyCalorieTarget || 2000} kcal

Daily Protein:
${profile.dailyProteinTarget || 60} g

Dietary Restrictions:
${JSON.stringify(
  profile.dietaryRestrictions || []
)}

IMPORTANT RULES:

1. Respect the user's fasting practice.
2. Respect vegan requirements when fasting.
3. Use Ethiopian foods whenever appropriate.
4. Include teff, injera, shiro, misir, gomen,
   beans, chickpeas, lentils, telba and other
   appropriate Ethiopian foods.
5. Do not include animal products during strict
   vegan fasting days.
6. Consider calories and protein targets.
7. Do not invent medical diagnoses.
8. Nutritional values are estimates.
9. Return ONLY valid JSON.
10. Do not use markdown.
11. Do not use code fences.

Return exactly this structure:

{
  "summary": "7-Day Personalized Ethiopian Meal Plan",
  "planDays": [
    {
      "day": "Monday",
      "isFasting": false,
      "meals": [
        {
          "mealType": "breakfast",
          "foodName": "Kinche with spiced oil",
          "calories": 320,
          "proteinGrams": 8,
          "carbsGrams": 45,
          "fatsGrams": 6,
          "ironMg": 3.5
        },
        {
          "mealType": "lunch",
          "foodName": "Doro Wat with Teff Injera",
          "calories": 580,
          "proteinGrams": 36,
          "carbsGrams": 60,
          "fatsGrams": 14,
          "ironMg": 8.5
        },
        {
          "mealType": "dinner",
          "foodName": "Atkilt Wat with Injera",
          "calories": 360,
          "proteinGrams": 9,
          "carbsGrams": 65,
          "fatsGrams": 5,
          "ironMg": 4.2
        }
      ]
    }
  ]
}

The planDays array MUST contain 7 days.
`;

  const apiKey = getApiKey();

  /**
   * If OpenRouter is not configured, use local meal plan.
   */
  if (!apiKey) {
    console.warn(
      '[EthioNutri AI] API key unavailable. Using local fallback.'
    );

    return mealPlanFallback(isVegan);
  }

  try {
    const result = await callOpenRouter({
      messages: [
        {
          role: 'system',
          content:
            'You are EthioNutri AI. Return valid JSON only.',
        },
        {
          role: 'user',
          content: promptText,
        },
      ],

      temperature: 0.3,
      maxTokens: 5000,
      timeout: 40000,
      models: FREE_MODELS,
    });

    try {
      const cleaned =
        cleanJsonResponse(result.content);

      const parsed =
        JSON.parse(cleaned);

      if (
        parsed &&
        Array.isArray(parsed.planDays) &&
        parsed.planDays.length === 7
      ) {
        console.log(
          `[EthioNutri AI] Meal plan generated using ${result.model}`
        );

        return parsed;
      }

      throw new Error(
        'AI returned JSON but meal plan structure is invalid'
      );
    } catch (jsonError) {
      console.warn(
        '[EthioNutri AI] Invalid meal-plan JSON:',
        jsonError.message
      );

      /**
       * Retry with every model except the model that
       * produced the invalid response.
       */
      const retryModels =
        FREE_MODELS.filter(
          model => model !== result.model
        );

      try {
        const retryResult =
          await callOpenRouter({
            messages: [
              {
                role: 'system',
                content:
                  'Return ONLY valid JSON. No markdown. No explanations.',
              },
              {
                role: 'user',
                content: promptText,
              },
            ],

            temperature: 0.2,
            maxTokens: 5000,
            timeout: 40000,
            models: retryModels,
          });

        const retryCleaned =
          cleanJsonResponse(
            retryResult.content
          );

        const retryParsed =
          JSON.parse(retryCleaned);

        if (
          retryParsed &&
          Array.isArray(retryParsed.planDays) &&
          retryParsed.planDays.length === 7
        ) {
          console.log(
            `[EthioNutri AI] Meal plan retry succeeded using ${retryResult.model}`
          );

          return retryParsed;
        }

        throw new Error(
          'Retry returned invalid meal-plan structure'
        );
      } catch (retryError) {
        console.warn(
          '[EthioNutri AI] All meal-plan JSON retries failed:',
          retryError.message
        );
      }
    }
  } catch (error) {
    console.error(
      '[EthioNutri AI] Meal plan API failed:',
      error?.response?.data || error.message
    );
  }

  /**
   * Last resort only.
   */
  console.warn(
    '[EthioNutri AI] Using local meal-plan fallback.'
  );

  return mealPlanFallback(isVegan);
}

/**
 * ============================================================
 * MEAL PLAN FALLBACK
 * ============================================================
 */

function mealPlanFallback(isVegan) {
  return {
    summary:
      'EthioNutri Clinical Heritage Fasting Plan',

    planDays: [
      {
        day: 'Monday',
        isFasting: false,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Teff Genfo with plant oil',
            calories: 320,
            proteinGrams: 8,
            carbsGrams: 45,
            fatsGrams: 6,
            ironMg: 3.5,
          },

          {
            mealType: 'lunch',
            foodName: isVegan
              ? 'Shiro Tegabino with Teff Injera'
              : 'Doro Wat & Injera',
            calories: 540,
            proteinGrams: 32,
            carbsGrams: 62,
            fatsGrams: 12,
            ironMg: 8.5,
          },

          {
            mealType: 'dinner',
            foodName:
              'Misir Wat & Kik Alicha with Red Teff Injera',
            calories: 380,
            proteinGrams: 14,
            carbsGrams: 64,
            fatsGrams: 5,
            ironMg: 6.2,
          },
        ],
      },

      {
        day: 'Tuesday',
        isFasting: false,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Firfir with Egg',
            calories: 380,
            proteinGrams: 16,
            carbsGrams: 48,
            fatsGrams: 12,
            ironMg: 4.0,
          },

          {
            mealType: 'lunch',
            foodName:
              'Tibs with Teff Injera',
            calories: 560,
            proteinGrams: 35,
            carbsGrams: 58,
            fatsGrams: 16,
            ironMg: 6.8,
          },

          {
            mealType: 'dinner',
            foodName:
              'Gomen & Lentils with Injera',
            calories: 400,
            proteinGrams: 18,
            carbsGrams: 65,
            fatsGrams: 7,
            ironMg: 8.0,
          },
        ],
      },

      {
        day: 'Wednesday (Tsom)',
        isFasting: true,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Telba Fitfit',
            calories: 290,
            proteinGrams: 9,
            carbsGrams: 48,
            fatsGrams: 5,
            ironMg: 3.0,
          },

          {
            mealType: 'lunch',
            foodName:
              'Shiro Tegabino with Teff Injera & Gomen',
            calories: 480,
            proteinGrams: 18,
            carbsGrams: 75,
            fatsGrams: 9,
            ironMg: 13.5,
          },

          {
            mealType: 'dinner',
            foodName:
              'Misir Wat & Atkilt Wat with Injera',
            calories: 390,
            proteinGrams: 16,
            carbsGrams: 65,
            fatsGrams: 6,
            ironMg: 8.4,
          },
        ],
      },

      {
        day: 'Thursday',
        isFasting: false,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Genfo with Yogurt',
            calories: 350,
            proteinGrams: 12,
            carbsGrams: 50,
            fatsGrams: 8,
            ironMg: 3.5,
          },

          {
            mealType: 'lunch',
            foodName:
              'Doro Wat & Teff Injera',
            calories: 580,
            proteinGrams: 36,
            carbsGrams: 60,
            fatsGrams: 14,
            ironMg: 8.5,
          },

          {
            mealType: 'dinner',
            foodName:
              'Fosolia & Gomen with Injera',
            calories: 390,
            proteinGrams: 15,
            carbsGrams: 68,
            fatsGrams: 6,
            ironMg: 7.2,
          },
        ],
      },

      {
        day: 'Friday (Tsom)',
        isFasting: true,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Bulla Porridge',
            calories: 260,
            proteinGrams: 7,
            carbsGrams: 46,
            fatsGrams: 4,
            ironMg: 2.8,
          },

          {
            mealType: 'lunch',
            foodName:
              'Shiro Wat & Kik Alicha with Brown Teff Injera',
            calories: 460,
            proteinGrams: 19,
            carbsGrams: 70,
            fatsGrams: 8,
            ironMg: 12.0,
          },

          {
            mealType: 'dinner',
            foodName:
              'Suf Fitfit & Gomen',
            calories: 370,
            proteinGrams: 13,
            carbsGrams: 56,
            fatsGrams: 8,
            ironMg: 7.8,
          },
        ],
      },

      {
        day: 'Saturday',
        isFasting: false,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Chechebsa',
            calories: 400,
            proteinGrams: 10,
            carbsGrams: 52,
            fatsGrams: 15,
            ironMg: 3.8,
          },

          {
            mealType: 'lunch',
            foodName:
              'Kitfo & Injera',
            calories: 620,
            proteinGrams: 38,
            carbsGrams: 55,
            fatsGrams: 24,
            ironMg: 7.0,
          },

          {
            mealType: 'dinner',
            foodName:
              'Vegetable Alicha & Injera',
            calories: 360,
            proteinGrams: 12,
            carbsGrams: 62,
            fatsGrams: 6,
            ironMg: 6.5,
          },
        ],
      },

      {
        day: 'Sunday',
        isFasting: false,

        meals: [
          {
            mealType: 'breakfast',
            foodName:
              'Kinche with Milk',
            calories: 330,
            proteinGrams: 11,
            carbsGrams: 48,
            fatsGrams: 8,
            ironMg: 3.0,
          },

          {
            mealType: 'lunch',
            foodName:
              'Doro Wat with Teff Injera',
            calories: 580,
            proteinGrams: 36,
            carbsGrams: 60,
            fatsGrams: 14,
            ironMg: 8.5,
          },

          {
            mealType: 'dinner',
            foodName:
              'Misir Wat & Gomen with Injera',
            calories: 400,
            proteinGrams: 17,
            carbsGrams: 65,
            fatsGrams: 7,
            ironMg: 8.0,
          },
        ],
      },
    ],
  };
}

/**
 * ============================================================
 * 2. AI CHATBOT
 * ============================================================
 */

async function sendAiChatPrompt(
  promptMessage,
  userProfile = {}
) {
  const apiKey = getApiKey();

  if (!apiKey) {
    return chatFallback();
  }

  const systemPrompt = `
You are EthioNutri AI, an expert nutrition assistant
specializing in Ethiopian traditional foods and fasting.

Fasting Practice:
${userProfile.fastingPractice || 'Orthodox'}

Health Goal:
${userProfile.goal || 'General Health'}

Dietary Restrictions:
${JSON.stringify(
  userProfile.dietaryRestrictions || []
)}

Health Conditions:
${JSON.stringify(
  userProfile.healthConditions || []
)}

Give practical, concise and culturally relevant advice.

Prefer appropriate Ethiopian foods such as:
- Teff
- Injera
- Shiro
- Misir
- Gomen
- Beans
- Chickpeas
- Lentils
- Telba
- Fosolia
- Kik Alicha

Respect fasting requirements.

Do not invent medical diagnoses.
Do not claim that food can cure diseases.
When a question requires professional medical
attention, recommend a qualified healthcare professional.
`;

  try {
    const result =
      await callOpenRouter({
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },

          {
            role: 'user',
            content:
              typeof promptMessage === 'string'
                ? promptMessage
                : JSON.stringify(promptMessage),
          },
        ],

        temperature: 0.6,
        maxTokens: 700,
        timeout: 30000,
        models: FREE_MODELS,
      });

    return result.content;
  } catch (error) {
    console.error(
      '[EthioNutri AI] Chat completely failed:',
      error?.response?.data || error.message
    );

    return chatFallback();
  }
}

/**
 * ============================================================
 * CHAT FALLBACK
 * ============================================================
 */

function chatFallback() {
  return `
For Ethiopian fasting, good plant-protein choices include
shiro, misir, beans, chickpeas and lentils paired with
teff injera.

For iron, combine legumes and leafy greens such as gomen
with vitamin-C-rich foods such as lemon and fresh vegetables.

For personalized nutrition advice, your calorie, protein,
health and dietary requirements should be considered.
`;
}

/**
 * ============================================================
 * 3. IMAGE INPUT HANDLING
 * ============================================================
 *
 * This is important because your Express route currently
 * passes:
 *
 *     req.file.path
 *
 * That is a FILESYSTEM PATH, not base64.
 *
 * The old service incorrectly treated the path as if it were
 * base64:
 *
 *     data:image/jpeg;base64,/some/file/path
 *
 * which cannot work.
 *
 * This function supports:
 *
 *   - HTTP URL
 *   - HTTPS URL
 *   - data:image/... URL
 *   - local filesystem path
 *   - raw base64
 *
 * ============================================================
 */

function imageInputToDataUrl(imageInput) {
  if (!imageInput) {
    throw new Error('No image supplied');
  }

  const value = String(imageInput).trim();

  if (!value) {
    throw new Error('Image input is empty');
  }

  /**
   * Already a remote image URL.
   */
  if (
    value.startsWith('http://') ||
    value.startsWith('https://')
  ) {
    return value;
  }

  /**
   * Already a data URL.
   */
  if (value.startsWith('data:image/')) {
    return value;
  }

  /**
   * If multer gave us a local filesystem path,
   * convert that file to base64.
   */
  if (fs.existsSync(value)) {
    const buffer = fs.readFileSync(value);

    const extension =
      path.extname(value).toLowerCase();

    let mimeType = 'image/jpeg';

    if (extension === '.png') {
      mimeType = 'image/png';
    } else if (extension === '.webp') {
      mimeType = 'image/webp';
    } else if (extension === '.gif') {
      mimeType = 'image/gif';
    } else if (
      extension === '.jpg' ||
      extension === '.jpeg'
    ) {
      mimeType = 'image/jpeg';
    }

    return `data:${mimeType};base64,${buffer.toString(
      'base64'
    )}`;
  }

  /**
   * Otherwise assume the value is raw base64.
   *
   * This allows callers to pass base64 directly.
   */
  return `data:image/jpeg;base64,${value}`;
}

/**
 * ============================================================
 * 4. AI IMAGE MEAL SCANNING
 * ============================================================
 */

async function analyzeMealImageWithAI(
  imageBase64OrUrl,
  userProfile = {}
) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn(
      '[EthioNutri AI] OpenRouter API key unavailable.'
    );

    return visionFallback();
  }

  if (!imageBase64OrUrl) {
    console.warn(
      '[EthioNutri AI] No image supplied.'
    );

    return visionFallback();
  }

  try {
    /**
     * Convert whatever the caller supplied into a valid
     * OpenRouter image URL.
     */
    const imageUrl =
      imageInputToDataUrl(imageBase64OrUrl);

    const result =
      await callOpenRouter({
        models: IMAGE_MODELS,

        messages: [
          {
            role: 'system',

            content: `
You are EthioNutri AI, an Ethiopian food recognition
and nutrition assistant.

Analyze the provided food image.

Your job is to identify the food as accurately as
possible from visible evidence.

IMPORTANT:
- Do not pretend to know something that cannot be seen.
- If the exact dish cannot be identified, use a cautious
  generic food description.
- Do not invent certainty.
- Nutritional values are estimates.
- Portion size must be estimated from the image when possible.
- If multiple foods are visible, describe the main meal.
- Consider Ethiopian foods such as injera, shiro, misir,
  doro wat, tibs, gomen, kik alicha, beans, chickpeas,
  lentils and other Ethiopian dishes.

Return ONLY valid JSON.

Do not use markdown.
Do not use code fences.

Return exactly this structure:

{
  "foodName": "",
  "portionGrams": 0,
  "calories": 0,
  "proteinGrams": 0,
  "carbsGrams": 0,
  "fatsGrams": 0,
  "ironMg": 0,
  "isVegan": false,
  "description": ""
}

All numeric nutrition fields MUST be numbers.

If the food cannot be confidently identified,
use a cautious name such as "Unidentified Ethiopian dish"
and explain the uncertainty in the description.
`,
          },

          {
            role: 'user',

            content: [
              {
                type: 'text',

                text: `
Identify the food in this image.

User fasting practice:
${
  userProfile.fastingPractice ||
  'Unknown'
}

Return valid JSON only.
`,
              },

              {
                type: 'image_url',

                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],

        temperature: 0.2,
        maxTokens: 700,
        timeout: 60000,
      });

    /**
     * Parse the model response.
     */
    const cleaned =
      cleanJsonResponse(result.content);

    const parsed =
      JSON.parse(cleaned);

    /**
     * Validate the result.
     */
    if (
      !parsed ||
      typeof parsed !== 'object'
    ) {
      throw new Error(
        'Image analysis did not return an object'
      );
    }

    if (
      !parsed.foodName ||
      typeof parsed.foodName !== 'string'
    ) {
      throw new Error(
        'Image analysis did not return foodName'
      );
    }

    /**
     * Normalize numeric values.
     *
     * Some models may return numbers as strings.
     */
    parsed.portionGrams =
      Number(parsed.portionGrams) || 0;

    parsed.calories =
      Number(parsed.calories) || 0;

    parsed.proteinGrams =
      Number(parsed.proteinGrams) || 0;

    parsed.carbsGrams =
      Number(parsed.carbsGrams) || 0;

    parsed.fatsGrams =
      Number(parsed.fatsGrams) || 0;

    parsed.ironMg =
      Number(parsed.ironMg) || 0;

    parsed.isVegan =
      Boolean(parsed.isVegan);

    parsed.description =
      parsed.description
        ? String(parsed.description)
        : '';

    console.log(
      `[EthioNutri AI] Image analysis succeeded using ${result.model}`
    );

    return parsed;
  } catch (error) {
    console.error(
      '[EthioNutri AI] Vision analysis failed:',
      error?.response?.data || error.message
    );

    return visionFallback();
  }
}

/**
 * ============================================================
 * VISION FALLBACK
 * ============================================================
 *
 * IMPORTANT:
 *
 * We DO NOT return a fake Shiro/Injera meal here.
 *
 * The old fallback made every failed scan appear to recognize
 * Shiro Tegabino & Teff Injera even when the AI never analyzed
 * the image.
 *
 * Instead, tell the frontend/backend that recognition failed.
 * ============================================================
 */

function visionFallback() {
  return {
    foodName: 'Food could not be identified',

    portionGrams: 0,

    calories: 0,

    proteinGrams: 0,

    carbsGrams: 0,

    fatsGrams: 0,

    ironMg: 0,

    isVegan: false,

    description:
      'AI food recognition was unavailable. No nutritional values were estimated from the image.',

    aiUnavailable: true,
  };
}

/**
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  generateMealPlanWithAI,
  sendAiChatPrompt,
  analyzeMealImageWithAI,
};