const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const dashboardRoutes = require('./routes/dashboard');
const fastingRoutes = require('./routes/fasting');
const foodsRoutes = require('./routes/foods');
const aiRoutes = require('./routes/ai');
const mealPlansRoutes = require('./routes/meal_plans');
const exerciseRoutes = require('./routes/exercise');
const supervisionRoutes = require('./routes/supervision');
const paymentsRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();

// ============================================================
// CORS CONFIGURATION
// ============================================================

const isDevelopment = process.env.NODE_ENV !== 'production';

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
];

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header:
      // Flutter mobile, Postman, curl, server-to-server, etc.
      if (!origin) {
        return callback(null, true);
      }

      // Development:
      // Allow localhost / 127.0.0.1 on ANY port.
      if (isDevelopment) {
        const isLocalhost =
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

        if (isLocalhost) {
          return callback(null, true);
        }
      }

      // Production / explicitly configured origins
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`CORS blocked origin: ${origin}`);

      return callback(
        new Error('Origin not allowed by CORS')
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Timezone',
      'X-City',
      'X-Latitude',
      'X-Longitude',
    ],
  })
);

// ============================================================
// BODY PARSING
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'EthioNutri AI Backend API Server',
    version: '1.0.0',
    documentation: '/api/v1',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'connected',
    version: '1.0.0',
  });
});

// ============================================================
// V1 API ROUTES
// ============================================================

app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/user', profileRoutes);

app.use('/api/v1', dashboardRoutes);

app.use('/api/v1/fasting', fastingRoutes);

app.use('/api/v1', foodsRoutes);

app.use('/api/v1/ai', aiRoutes);

app.use('/api/v1', mealPlansRoutes);

app.use('/api/v1/exercise', exerciseRoutes);

app.use('/api/v1/supervision', supervisionRoutes);

app.use('/api/v1/payments', paymentsRoutes);

app.use('/api/v1/admin', adminRoutes);
const videoAppointmentRoutes =
  require('./routes/video_appointment_routes');

app.use(
  '/api/v1',
  videoAppointmentRoutes
);
// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error('API Server Error:', err);

  res.status(500).json({
    error: err.message || 'Internal Server Error',
  });
});

module.exports = app;
