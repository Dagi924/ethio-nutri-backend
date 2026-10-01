require('dotenv').config();

const app = require('./src/app');
const { testDatabaseConnection } = require('./src/db');

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

async function startServer() {
  try {
    await testDatabaseConnection();

    app.listen(PORT, HOST, () => {
      console.log('=======================================================');
      console.log(' EthioNutri AI Express Backend Server is running!');
      console.log(` Server listening on ${HOST}:${PORT}`);
      console.log(` Health Check: /api/v1/health`);
      console.log(' Database: PostgreSQL + Drizzle ORM');
      console.log(' Fasting Rules Engine: Ethiopian Orthodox (Tsom) & Ramadan');
      console.log(' OpenRouter AI & Chapa Payment Gateway Ready');
      console.log('=======================================================');
    });

  } catch (error) {
    console.error('Server startup aborted because database connection failed.');
    console.error(error);
    process.exit(1);
  }
}

startServer();