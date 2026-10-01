const { pgTable, uuid, varchar, text, integer, doublePrecision, boolean, timestamp, jsonb } = require('drizzle-orm/pg-core');

// 1. Users Table
const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  phone: varchar('phone', { length: 50 }),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).default('user').notNull(), // 'user', 'nutritionist', 'admin'
  isPremium: boolean('is_premium').default(false).notNull(),
  paymentStatus: varchar('payment_status', { length: 50 }).default('free_tier').notNull(), // 'unpaid', 'free_tier', 'active_premium'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Profiles Table
const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  fastingPractice: varchar('fasting_practice', { length: 100 }).default('orthodox'), // 'orthodox', 'ramadan', 'custom', 'none'
  healthConditions: jsonb('health_conditions').default([]), // ['diabetes', 'hypertension', 'anemia', 'pregnancy', 'gluten-sensitive']
  language: varchar('language', { length: 20 }).default('en'),
  theme: varchar('theme', { length: 20 }).default('light'),
  notificationsEnabled: boolean('notifications_enabled').default(true),
  age: integer('age').default(28),
  gender: varchar('gender', { length: 20 }).default('other'),
  weightKg: doublePrecision('weight_kg').default(68.0),
  targetWeightKg: doublePrecision('target_weight_kg').default(65.0),
  heightCm: doublePrecision('height_cm').default(172.0),
  goal: varchar('goal', { length: 50 }).default('lose_weight'), // 'lose_weight', 'gain_weight', 'maintain_weight', 'gain_muscle'
  budgetLevel: varchar('budget_level', { length: 50 }).default('medium'), // 'economy', 'medium', 'premium'
  dailyCalorieTarget: integer('daily_calorie_target').default(2000),
  dailyProteinTarget: integer('daily_protein_target').default(60),
  dailyCarbsTarget: integer('daily_carbs_target').default(220),
  dailyFatsTarget: integer('daily_fats_target').default(50),
  dailyWaterTarget: doublePrecision('daily_water_target').default(2.5),
  onboardingCompleted: boolean('onboarding_completed').default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Foods Database Table (FAO Ethiopian Food Composition Data)
const foods = pgTable('foods', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nameAmharic: varchar('name_amharic', { length: 255 }),
  category: varchar('category', { length: 100 }).default('General'), // 'Grains', 'Legumes', 'Stews', 'Vegetables', 'Beverages'
  caloriesPer100g: doublePrecision('calories_per_100g').notNull(),
  proteinGrams: doublePrecision('protein_grams').notNull(),
  carbsGrams: doublePrecision('carbs_grams').notNull(),
  fatsGrams: doublePrecision('fats_grams').notNull(),
  ironMg: doublePrecision('iron_mg').default(0),
  zincMg: doublePrecision('zinc_mg').default(0),
  calciumMg: doublePrecision('calcium_mg').default(0),
  b12Mcg: doublePrecision('b12_mcg').default(0),
  isVegan: boolean('is_vegan').default(true),
  isTraditional: boolean('is_traditional').default(true),
  faoReference: text('fao_reference'),
});

// 4. Food Logs Table
const foodLogs = pgTable('food_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  foodName: varchar('food_name', { length: 255 }).notNull(),
  portionGrams: doublePrecision('portion_grams').default(100),
  calories: doublePrecision('calories').notNull(),
  proteinGrams: doublePrecision('protein_grams').default(0),
  carbsGrams: doublePrecision('carbs_grams').default(0),
  fatsGrams: doublePrecision('fats_grams').default(0),
  waterMl: doublePrecision('water_ml').default(0),
  logType: varchar('log_type', { length: 50 }).default('manual'), // 'manual', 'scan', 'voice', 'water'
  loggedAt: timestamp('logged_at').defaultNow().notNull(),
});

// 5. Fasting Schedules & Calendar Table
const fastingSchedules = pgTable('fasting_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  fastType: varchar('fast_type', { length: 100 }).notNull(), // 'Wednesday Fast', 'Friday Fast', 'Abiy Tsom', 'Ramadan'
  date: varchar('date', { length: 20 }).notNull(), // YYYY-MM-DD
  isVeganRequired: boolean('is_vegan_required').default(true),
  allowedDescription: text('allowed_description'),
  fastingEndsTime: varchar('fasting_ends_time', { length: 50 }).default('3:00 PM'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. AI Meal Plans Table
const mealPlans = pgTable('meal_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  weekIdentifier: varchar('week_identifier', { length: 50 }).notNull(), // '2026-W34'
  planData: jsonb('plan_data').notNull(), // Array of days with breakfast, lunch, dinner, snacks
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});

// 7. Grocery Items Table
const groceryItems = pgTable('grocery_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).default('Pantry'),
  quantity: varchar('quantity', { length: 100 }).default('1 kg'),
  estimatedPriceEtb: doublePrecision('estimated_price_etb').default(100),
  isChecked: boolean('is_checked').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Exercise Logs Table
const exerciseLogs = pgTable('exercise_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  workoutName: varchar('workout_name', { length: 255 }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  caloriesBurned: doublePrecision('calories_burned').notNull(),
  intensity: varchar('intensity', { length: 50 }).default('Moderate'),
  loggedAt: timestamp('logged_at').defaultNow().notNull(),
});

// 9. Nutritionists Table
const nutritionists = pgTable('nutritionists', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  bio: text('bio'),
  specializations: jsonb('specializations').default(['Heritage Fasting Nutrition', 'Diabetes Management']),
  credentials: varchar('credentials', { length: 255 }).default('MSc Clinical Nutrition, EPHI Certified'),
  hourlyRateEtb: doublePrecision('hourly_rate_etb').default(800.0),
  isApproved: boolean('is_approved').default(true),
});

// 10. Appointments Table
const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  nutritionistId: uuid('nutritionist_id').references(() => nutritionists.id, { onDelete: 'cascade' }).notNull(),
  scheduledAt: timestamp('scheduled_at').notNull(),
  status: varchar('status', { length: 50 }).default('confirmed'), // 'scheduled', 'confirmed', 'completed', 'cancelled'
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 11. Supervision Messages Table
const supervisionMessages = pgTable('supervision_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  nutritionistId: uuid('nutritionist_id').references(() => nutritionists.id, { onDelete: 'cascade' }).notNull(),
  senderRole: varchar('sender_role', { length: 50 }).notNull(), // 'user', 'nutritionist'
  message: text('message').notNull(),
  mediaUrl: text('media_url'),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
});

// 12. Payments Table (Chapa Integration)
const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  txRef: varchar('tx_ref', { length: 255 }).notNull().unique(),
  amountEtb: doublePrecision('amount_etb').notNull(),
  status: varchar('status', { length: 50 }).default('pending'), // 'pending', 'success', 'failed'
  paymentMethod: varchar('payment_method', { length: 50 }).default('chapa'),
  rawResponse: jsonb('raw_response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

module.exports = {
  users,
  profiles,
  foods,
  foodLogs,
  fastingSchedules,
  mealPlans,
  groceryItems,
  exerciseLogs,
  nutritionists,
  appointments,
  supervisionMessages,
  payments,
};
