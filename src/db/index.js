const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const schema = require('./schema');
const { FAO_ETHIOPIAN_FOODS } = require('./fao_seed_data');

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/ethionutri_new';

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
});

const db = drizzle(pool, { schema });

/**
 * Test PostgreSQL connection when server starts
 */
async function testDatabaseConnection() {
  try {
    const result = await pool.query(
      'SELECT current_database(), current_user'
    );

    console.log('=======================================================');
    console.log(' PostgreSQL Database Connected Successfully');
    console.log(` Database: ${result.rows[0].current_database}`);
    console.log(` User: ${result.rows[0].current_user}`);
    console.log(' ORM: Drizzle');
    console.log('=======================================================');
  } catch (error) {
    console.error('=======================================================');
    console.error(' PostgreSQL Database Connection FAILED');
    console.error(error.message);
    console.error('=======================================================');
    throw error;
  }
}

/**
 * In-memory data is kept ONLY for static/demo data.
 *
 * IMPORTANT:
 * Users, profiles, food logs, payments, etc.
 * should NOT use this for permanent storage.
 */
const memoryDb = {
  foods: [
    ...FAO_ETHIOPIAN_FOODS.map((f, i) => ({
      id: `fao-${i + 1}`,
      ...f,
    })),
  ],

  foodLogs: [
    {
      id: 'log-1',
      userId: 'user-demo-1',
      foodName: 'Shiro Wat & Teff Injera',
      portionGrams: 250,
      calories: 450,
      proteinGrams: 18,
      carbsGrams: 75,
      fatsGrams: 8,
      waterMl: 0,
      logType: 'manual',
      loggedAt: new Date(),
    },
    {
      id: 'log-2',
      userId: 'user-demo-1',
      foodName: 'Suf Fitfit',
      portionGrams: 180,
      calories: 320,
      proteinGrams: 12,
      carbsGrams: 45,
      fatsGrams: 10,
      waterMl: 0,
      logType: 'manual',
      loggedAt: new Date(),
    },
  ],
};

module.exports = {
  db,
  pool,
  schema,
  memoryDb,
  FAO_ETHIOPIAN_FOODS,
  testDatabaseConnection,
};