require('dotenv').config();

const swaggerUi = require('swagger-ui-express');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const env = require('./config/env');
const { globalRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');

// future routes
// const { userRouter, circleRouter, paymentRouter, adminRouter } = require('./routes');

const app = express();


// Security headers
app.use(helmet());


// CORS
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(','),
    credentials: true,
  })
);


// Logging
if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}


// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Global rate limiter
app.use(globalRateLimiter);


// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
  });
});


// API routes
app.use(`/api/${env.API_VERSION}/auth`, authRoutes);


// future routes
/*
app.use(`/api/${env.API_VERSION}/users`, userRouter);
app.use(`/api/${env.API_VERSION}/circles`, circleRouter);
app.use(`/api/${env.API_VERSION}/payments`, paymentRouter);
app.use(`/api/${env.API_VERSION}/admin`, adminRouter);
*/

const YAML = require('yamljs');
const swaggerDocument = YAML.load('./openapi.yaml');

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));


// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});


// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;