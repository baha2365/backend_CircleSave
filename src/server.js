require('dotenv').config();

const app = require('./app');
const env = require('./config/env');
const { disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { startCronJobs } = require('./services/cronService');
const { startEmailWorker, stopEmailWorker } = require('./services/emailQueueService');
const logger = require('./utils/logger');

let server;

(async () => {
  try {
    await connectRedis();
    logger.info('Redis connected');

    server = app.listen(env.PORT, () => {
      logger.info(`🚀 CircleSave API running on port ${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`📖 Swagger docs: http://localhost:${env.PORT}/docs`);
    });

    if (env.NODE_ENV !== 'test') {
      startEmailWorker(); // BullMQ worker — processes Resend jobs from Redis
      startCronJobs();    // Scheduled debits, late fees, cleanup
    }
  } catch (err) {
    logger.error('Failed to start server', { message: err.message });
    process.exit(1);
  }
})();

async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      await stopEmailWorker();
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