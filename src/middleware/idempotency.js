const { getRedisClient } = require('../config/redis');
const CONSTANTS = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Idempotency middleware for payment endpoints.
 *
 * Flow:
 * 1. Read Idempotency-Key header (required)
 * 2. Check Redis for cached response → return cached if found
 * 3. Process request normally
 * 4. Cache response in Redis for TTL duration
 *
 * The idempotency key must be a UUID provided by the client.
 */
const idempotency = async (req, res, next) => {
  const key = req.headers['idempotency-key'];

  if (!key) {
    return next(
      ApiError.badRequest(
        'Idempotency-Key header is required for this endpoint.',
        'IDEMPOTENCY_KEY_MISSING'
      )
    );
  }

  // Validate key format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(key)) {
    return next(
      ApiError.badRequest('Idempotency-Key must be a valid UUID v4.', 'IDEMPOTENCY_KEY_INVALID')
    );
  }

  const redisKey = `idempotency:${req.user?.id}:${key}`;
  const redis = getRedisClient();

  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      const { statusCode, body } = JSON.parse(cached);
      logger.info('Idempotency cache hit', { key, userId: req.user?.id });
      res.set('X-Idempotency-Replayed', 'true');
      return res.status(statusCode).json(body);
    }
  } catch (err) {
    logger.warn('Idempotency Redis read error:', { message: err.message });
    // fail open
  }

  // Attach key to request for service layer
  req.idempotencyKey = key;
  req.idempotencyRedisKey = redisKey;

  // Monkey-patch res.json to cache the response
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    try {
      if (res.statusCode < 500) {
        await redis.setex(
          redisKey,
          CONSTANTS.IDEMPOTENCY_TTL_SECONDS,
          JSON.stringify({ statusCode: res.statusCode, body })
        );
      }
    } catch (err) {
      logger.warn('Idempotency Redis write error:', { message: err.message });
    }
    return originalJson(body);
  };

  next();
};

module.exports = { idempotency };