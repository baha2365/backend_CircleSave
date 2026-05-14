const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

let redisClient;

function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          logger.error('Redis: Max retries reached. Giving up.');
          return null;
        }
        return Math.min(times * 200, 3000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error('Redis error:', { message: err.message }));
    redisClient.on('close', () => logger.warn('Redis connection closed'));
  }
  return redisClient;
}

async function connectRedis() {
  const client = getRedisClient();
  await client.connect();
  return client;
}

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// Returns a FRESH connection for BullMQ — never reuse the shared client
function createBullMQConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,   // ← BullMQ hard requirement
    enableReadyCheck: false,      // ← also recommended for BullMQ
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 200, 3000);
    },
  });
}

module.exports = { getRedisClient, connectRedis, disconnectRedis, createBullMQConnection };