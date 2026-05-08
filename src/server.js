require('dotenv').config();

const app = require('./app');
const env = require('./config/env');
const { disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { startCronJobs } = require('./services/cronService');
const logger = require('./utils/logger');

let server;

(async () => {
  try {
    // Connect Redis
    await connectRedis();
    logger.info('Redis connected');

    // Start HTTP server
    server = app.listen(env.PORT, () => {
      logger.info(`🚀 CircleSave API running on port ${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`📖 Swagger docs: http://localhost:${env.PORT}/docs`);
    });

    // Start cron jobs (only in non-test environments)
    if (env.NODE_ENV !== 'test') {
      startCronJobs();
    }
  } catch (err) {
    logger.error('Failed to start server', { message: err.message });
    process.exit(1);
  }
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('Server shut down cleanly.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});