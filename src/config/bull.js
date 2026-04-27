const Bull = require('bull');
const env = require('./env');

const queues = {};

/**
 * Get or create a named Bull queue.
 * @param {string} name - Queue name
 * @returns {Bull.Queue}
 */
function getQueue(name) {
  if (!queues[name]) {
    queues[name] = new Bull(name, {
      redis: env.REDIS_URL,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return queues[name];
}

const QUEUES = {
  PAYMENT_REMINDER: 'payment-reminder',
  LATE_FEE: 'late-fee',
  PAYOUT_RELEASE: 'payout-release',
  DEFAULT_DETECTION: 'default-detection',
  NOTIFICATION: 'notification',
};

async function closeAllQueues() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

module.exports = { getQueue, QUEUES, closeAllQueues };