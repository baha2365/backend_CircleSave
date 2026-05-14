const { Queue, Worker } = require('bullmq');
const { getRedisClient } = require('../config/redis');
const emailService = require('./emailService');
const logger = require('../utils/logger');
const { createBullMQConnection } = require('../config/redis');  // ← changed import


const QUEUE_NAME = 'email';

let emailQueue;
let emailWorker;

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE  (producer side — used by services to enqueue emails)
// ─────────────────────────────────────────────────────────────────────────────

function getEmailQueue() {
  if (!emailQueue) {
    emailQueue = new Queue(QUEUE_NAME, {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s → 10s → 20s
        removeOnComplete: 50,  // keep last 50 completed jobs for observability
        removeOnFail: 100,     // keep last 100 failed jobs for debugging
      },
    });

    emailQueue.on('error', (err) => {
      logger.error('[EMAIL QUEUE] Queue error', { message: err.message });
    });
  }
  return emailQueue;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENQUEUE HELPERS  (called by services — fire-and-forget pattern)
// ─────────────────────────────────────────────────────────────────────────────

async function enqueueVerificationEmail(to, username, code) {
  const queue = getEmailQueue();
  const job = await queue.add('send-verification', { to, username, code }, { priority: 1 });
  logger.info('[EMAIL QUEUE] Verification email queued', { jobId: job.id, to });
  return job.id;
}

async function enqueuePasswordResetEmail(to, username, code) {
  const queue = getEmailQueue();
  const job = await queue.add('send-password-reset', { to, username, code }, { priority: 1 });
  logger.info('[EMAIL QUEUE] Password reset email queued', { jobId: job.id, to });
  return job.id;
}

async function enqueuePayoutEmail(to, username, data) {
  const queue = getEmailQueue();
  const job = await queue.add('send-payout-notification', { to, username, data });
  logger.info('[EMAIL QUEUE] Payout email queued', { jobId: job.id, to });
  return job.id;
}

async function enqueuePaymentConfirmationEmail(to, username, data) {
  const queue = getEmailQueue();
  const job = await queue.add('send-payment-confirmation', { to, username, data });
  logger.info('[EMAIL QUEUE] Payment confirmation email queued', { jobId: job.id, to });
  return job.id;
}

async function enqueueTrustScoreEmail(to, username, data) {
  const queue = getEmailQueue();
  const job = await queue.add('send-trust-score-update', { to, username, data });
  logger.info('[EMAIL QUEUE] Trust score email queued', { jobId: job.id, to });
  return job.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER  (consumer side — processes jobs from Redis, calls Resend)
// ─────────────────────────────────────────────────────────────────────────────

function startEmailWorker() {
  emailWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { name, data } = job;
      logger.info('[EMAIL WORKER] Processing job', { jobId: job.id, name });

      switch (name) {
        case 'send-verification':
          await emailService.sendVerificationEmail(data.to, data.username, data.code);
          break;

        case 'send-password-reset':
          await emailService.sendPasswordResetEmail(data.to, data.username, data.code);
          break;

        case 'send-payout-notification':
          await emailService.sendPayoutReleasedEmail(data.to, data.username, data.data);
          break;

        case 'send-payment-confirmation':
          await emailService.sendPaymentConfirmationEmail(data.to, data.username, data.data);
          break;

        case 'send-trust-score-update':
          await emailService.sendTrustScoreUpdateEmail(data.to, data.username, data.data);
          break;

        default:
          logger.warn('[EMAIL WORKER] Unknown job type', { name });
      }
    },
    {
      connection: createBullMQConnection(),
      concurrency: 5, // process up to 5 emails simultaneously
    }
  );

  emailWorker.on('completed', (job) => {
    logger.info('[EMAIL WORKER] Job completed', { jobId: job.id, name: job.name });
  });

  emailWorker.on('failed', (job, err) => {
    logger.error('[EMAIL WORKER] Job failed', {
      jobId: job?.id,
      name: job?.name,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  emailWorker.on('error', (err) => {
    logger.error('[EMAIL WORKER] Worker error', { message: err.message });
  });

  logger.info('[EMAIL WORKER] Email worker started (concurrency: 5)');
  return emailWorker;
}

async function stopEmailWorker() {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE STATUS  (for admin observability endpoint)
// ─────────────────────────────────────────────────────────────────────────────

async function getQueueStatus() {
  const queue = getEmailQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

module.exports = {
  getEmailQueue,
  startEmailWorker,
  stopEmailWorker,
  getQueueStatus,
  enqueueVerificationEmail,
  enqueuePasswordResetEmail,
  enqueuePayoutEmail,
  enqueuePaymentConfirmationEmail,
  enqueueTrustScoreEmail,
};