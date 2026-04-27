const { Prisma } = require('@prisma/client');
const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Global Express error handler.
 * Maps different error types to standardized JSON responses.
 * MUST be the last middleware registered in app.js.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  // ── Prisma Errors ──────────────────────────────────────────────────────

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        // Unique constraint violation
        const fields = err.meta?.target?.join(', ') || 'field';
        error = ApiError.conflict(`Duplicate value for: ${fields}`, 'DB_UNIQUE_CONSTRAINT');
        break;
      }
      case 'P2025':
        // Record not found
        error = ApiError.notFound('Record not found.', 'DB_RECORD_NOT_FOUND');
        break;
      case 'P2003':
        error = ApiError.badRequest('Foreign key constraint failed.', 'DB_FOREIGN_KEY');
        break;
      default:
        error = ApiError.internal(`Database error: ${err.code}`);
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    error = ApiError.badRequest('Database validation error.', 'DB_VALIDATION');
  }

  // ── Zod Validation (should be caught by validate middleware, but just in case) ──

  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
    error = ApiError.unprocessable('Validation failed.', 'VALIDATION_ERROR', details);
  }

  // ── JWT Errors ──────────────────────────────────────────────────────────

  if (err.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid token.', 'AUTH_INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Token expired.', 'AUTH_TOKEN_EXPIRED');
  }

  // ── Normalize to ApiError ───────────────────────────────────────────────

  if (!(error instanceof ApiError)) {
    logger.error('Unhandled error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
    error = ApiError.internal('An unexpected error occurred. Please try again.');
  }

  // ── Log all >= 500 errors ───────────────────────────────────────────────

  if (error.statusCode >= 500) {
    logger.error('Server Error:', {
      statusCode: error.statusCode,
      message: error.message,
      path: req.path,
      method: req.method,
      stack: env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }

  const response = {
    success: false,
    error: {
      code: error.errorCode,
      message: error.message,
    },
  };

  if (error.details && error.details.length > 0) {
    response.error.details = error.details;
  }

  if (env.NODE_ENV !== 'production' && error.statusCode >= 500) {
    response.error.stack = error.stack;
  }

  res.status(error.statusCode).json(response);
};

module.exports = { errorHandler };