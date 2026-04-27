const { RateLimiterRedis } = require('rate-limiter-flexible');
const { getRedisClient } = require('../config/redis');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Create a Redis-backed sliding window rate limiter middleware.
 *
 * @param {Object} options
 * @param {number} options.points  - Max requests per window
 * @param {number} options.duration - Window size in seconds
 * @param {string} options.keyPrefix - Redis key prefix (e.g. 'auth_login')
 */
function createRateLimiter({ points, duration, keyPrefix }) {
  let limiter;

  const getLimiter = () => {
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: getRedisClient(),
        keyPrefix,
        points,
        duration,
        blockDuration: duration, // block for the same window after limit
      });
    }
    return limiter;
  };

  return async (req, res, next) => {
    const key = req.ip;
    try {
      await getLimiter().consume(key);
      next();
    } catch (err) {
      if (err.msBeforeNext !== undefined) {
        const retryAfter = Math.ceil(err.msBeforeNext / 1000);
        res.set('Retry-After', String(retryAfter));
        res.set('X-RateLimit-Limit', String(points));
        res.set('X-RateLimit-Remaining', '0');
        res.set('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + retryAfter));
        return next(
          ApiError.tooManyRequests(
            `Too many requests. Retry after ${retryAfter} seconds.`,
            'RATE_LIMIT_EXCEEDED'
          )
        );
      }
      logger.error('Rate limiter error:', { message: err.message });
      next(); // fail open on Redis errors — never block legitimate users
    }
  };
}

// ── Pre-built limiters ─────────────────────────────────────────────────────

/** Auth endpoints: max 5 attempts per minute per IP */
const authRateLimiter = createRateLimiter({
  points: env.RATE_LIMIT_AUTH_MAX,
  duration: Math.ceil(env.RATE_LIMIT_AUTH_WINDOW_MS / 1000),
  keyPrefix: 'rl_auth',
});

/** Global API rate limiter: 100 requests/minute */
const globalRateLimiter = createRateLimiter({
  points: env.RATE_LIMIT_GLOBAL_MAX,
  duration: Math.ceil(env.RATE_LIMIT_GLOBAL_WINDOW_MS / 1000),
  keyPrefix: 'rl_global',
});

/** Payment endpoints: stricter limit */
const paymentRateLimiter = createRateLimiter({
  points: 20,
  duration: 60,
  keyPrefix: 'rl_payment',
});

module.exports = { createRateLimiter, authRateLimiter, globalRateLimiter, paymentRateLimiter };