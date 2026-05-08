const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Idempotency middleware for payment and mutation endpoints.
 *
 * Reads the `Idempotency-Key` header. If we have seen this key before
 * (and it hasn't expired), we return the cached response directly without
 * re-executing the handler. This prevents double-charges on retried requests.
 *
 * After the handler runs successfully, we cache the response for 24 hours.
 *
 * Usage:
 *   router.post('/payments', authenticate, idempotency, handler)
 */
const idempotency = async (req, res, next) => {
  const key = req.headers['idempotency-key'];

  if (!key) {
    // Key is optional; if absent, pass through with no caching
    return next();
  }

  if (key.length > 255) {
    return next(ApiError.badRequest('Idempotency-Key must be 255 characters or fewer.', 'IDEMPOTENCY_KEY_TOO_LONG'));
  }

  const userId = req.user?.id || 'anonymous';

  try {
    // Check for an existing response with this key
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: `${userId}:${key}` },
    });

    if (existing) {
      if (existing.expiresAt > new Date()) {
        logger.info('Idempotency cache hit', { key, userId });
        // Replay the original response
        return res.status(existing.statusCode).json(existing.response);
      }
      // Expired — delete and allow re-processing
      await prisma.idempotencyKey.delete({ where: { key: `${userId}:${key}` } });
    }
  } catch (err) {
    // If DB lookup fails, pass through — never block legitimate requests
    logger.warn('Idempotency DB lookup failed, passing through', { message: err.message });
    return next();
  }

  // Intercept res.json to capture the response for caching
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    // Only cache successful responses (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        await prisma.idempotencyKey.upsert({
          where: { key: `${userId}:${key}` },
          create: {
            key: `${userId}:${key}`,
            userId,
            response: body,
            statusCode: res.statusCode,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
          },
          update: {
            response: body,
            statusCode: res.statusCode,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        logger.warn('Failed to cache idempotency response', { message: err.message });
      }
    }
    return originalJson(body);
  };

  next();
};

module.exports = { idempotency };