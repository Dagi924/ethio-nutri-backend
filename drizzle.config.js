require('dotenv').config();

/** @type {import('drizzle-kit').Config} */

module.exports = {
  schema: './src/db/schema.js',

  out: './drizzle',

  dialect: 'postgresql',

  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/ethionutri_new',
  },
};