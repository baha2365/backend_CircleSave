require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const { globalRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const { userRouter, circleRouter, paymentRouter, adminRouter } = require('./routes/index');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

// ── Request logging ───────────────────────────────────────────────────────
if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Global rate limiter ───────────────────────────────────────────────────
app.use(globalRateLimiter);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CircleSave API is running',
    version: env.API_VERSION,
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API routes ────────────────────────────────────────────────────────────
const apiPrefix = `/api/${env.API_VERSION}`;

app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/users`, userRouter);
app.use(`${apiPrefix}/circles`, circleRouter);
app.use(`${apiPrefix}/payments`, paymentRouter);
app.use(`${apiPrefix}/admin`, adminRouter);

// ── Swagger / OpenAPI docs ────────────────────────────────────────────────
try {
  const swaggerDocument = YAML.load('./openapi.yaml');
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customSiteTitle: 'CircleSave API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));
} catch (err) {
  console.warn('Could not load openapi.yaml for Swagger UI:', err.message);
}

// ── 404 handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  });
});

// ── Global error handler (must be last) ──────────────────────────────────
app.use(errorHandler);

module.exports = app;