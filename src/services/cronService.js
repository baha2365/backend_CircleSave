const cron = require('node-cron');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { processDefault } = require('./paymentService');

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS SCHEDULED DEBITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs every hour. Picks up ScheduledDebits that are due and haven't been
 * processed yet. The idempotencyKey guarantees that even if this runs
 * concurrently or retries, each debit is attempted at most once per key.
 *
 * In a production system this would integrate with a real payment gateway.
 * Here we simulate successful processing and create the payment record.
 */
async function processScheduledDebits() {
  logger.info('[CRON] Processing scheduled debits...');

  const now = new Date();

  // Fetch all SCHEDULED debits that are due and haven't exceeded max retries
  const dueDebits = await prisma.scheduledDebit.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledFor: { lte: now },
      retryCount: { lt: 3 },
    },
    include: {
      circle: true,
    },
    take: 100, // process in batches
  });

  logger.info(`[CRON] Found ${dueDebits.length} scheduled debits to process`);

  for (const debit of dueDebits) {
    await processSingleDebit(debit);
  }

  // Retry previously FAILED debits (exponential backoff)
  const retryDebits = await prisma.scheduledDebit.findMany({
    where: {
      status: 'FAILED',
      nextRetryAt: { lte: now },
      retryCount: { lt: 3 },
    },
    include: { circle: true },
    take: 50,
  });

  logger.info(`[CRON] Found ${retryDebits.length} failed debits to retry`);
  for (const debit of retryDebits) {
    await processSingleDebit(debit);
  }
}

async function processSingleDebit(debit) {
  try {
    // Mark as PROCESSING first (optimistic lock)
    const updated = await prisma.scheduledDebit.updateMany({
      where: { id: debit.id, status: { in: ['SCHEDULED', 'FAILED'] } },
      data: { status: 'PROCESSING', attemptedAt: new Date() },
    });

    if (updated.count === 0) {
      // Already picked up by another worker
      return;
    }

    // ── SIMULATE PAYMENT GATEWAY CALL ────────────────────────────────────
    // In production: call Stripe/Kaspi/etc. with debit.idempotencyKey
    // The idempotency key ensures the gateway won't double-charge on retries.
    const paymentSucceeded = await simulatePaymentGateway(debit);
    // ─────────────────────────────────────────────────────────────────────

    if (paymentSucceeded) {
      await prisma.$transaction(async (tx) => {
        await tx.scheduledDebit.update({
          where: { id: debit.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        // Create the payment record
        await tx.payment.create({
          data: {
            circleId: debit.circleId,
            memberId: debit.memberId,
            userId: (await tx.circleMember.findUnique({ where: { id: debit.memberId }, select: { userId: true } })).userId,
            round: debit.round,
            dueAmount: debit.amount,
            amount: debit.amount,
            currency: debit.circle.currency,
            status: 'COMPLETED',
            paymentMethod: 'AUTO_DEBIT',
            idempotencyKey: debit.idempotencyKey,
            processedAt: new Date(),
          },
        });
      });

      logger.info('[CRON] Debit processed successfully', { debitId: debit.id });
    } else {
      const nextRetry = new Date(Date.now() + Math.pow(2, debit.retryCount) * 60 * 60 * 1000); // exponential backoff
      await prisma.scheduledDebit.update({
        where: { id: debit.id },
        data: {
          status: 'FAILED',
          retryCount: { increment: 1 },
          nextRetryAt: nextRetry,
          failureReason: 'Payment gateway declined',
        },
      });

      // After 3 failures, mark as default
      if (debit.retryCount + 1 >= 3) {
        await processDefault(debit.memberId, debit.circleId, debit.round);
        logger.warn('[CRON] Member defaulted after 3 failed attempts', { memberId: debit.memberId });
      }
    }
  } catch (err) {
    logger.error('[CRON] Error processing debit', { debitId: debit.id, error: err.message });
    await prisma.scheduledDebit.update({
      where: { id: debit.id },
      data: { status: 'FAILED', failureReason: err.message, retryCount: { increment: 1 } },
    }).catch(() => {}); // don't throw — keep processing other debits
  }
}

/**
 * Simulates a payment gateway call.
 * In production, replace with real API call.
 * Returns true 90% of the time (simulating success rate).
 */
async function simulatePaymentGateway(debit) {
  // Simulate async gateway call
  await new Promise((r) => setTimeout(r, 10));
  // In dev/test, always succeed. In production, this hits the real gateway.
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATE AND APPLY LATE FEES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs daily at midnight. Checks all active circles for overdue payments
 * and applies late fee accrual to PARTIAL payments.
 */
async function calculateAndApplyLateFees() {
  logger.info('[CRON] Calculating late fees...');
  const { calculateLateFee } = require('./paymentService');
  const ledgerService = require('./ledgerService');

  const now = new Date();

  // Find all active circles with an overdue nextPaymentDate
  const overdueCircles = await prisma.circle.findMany({
    where: {
      status: 'ACTIVE',
      nextPaymentDate: { lt: now },
    },
  });

  for (const circle of overdueCircles) {
    // Find members with PARTIAL payments this round
    const partialPayments = await prisma.payment.findMany({
      where: {
        circleId: circle.id,
        round: circle.currentRound,
        status: 'PARTIAL',
      },
      include: { member: true },
    });

    for (const payment of partialPayments) {
      const { lateFee } = calculateLateFee(
        parseFloat(payment.remainingAmount),
        circle.nextPaymentDate,
        now
      );

      if (lateFee > 0) {
        try {
          await prisma.$transaction(async (tx) => {
            await ledgerService.recordLateFee(
              tx, circle.id, payment.id, lateFee, circle.currency,
              `Daily late fee accrual on partial payment (round ${circle.currentRound})`
            );

            await tx.notification.create({
              data: {
                userId: payment.userId,
                circleId: circle.id,
                type: 'LATE_FEE_APPLIED',
                title: 'Late Fee Applied',
                body: `A late fee of ${lateFee.toFixed(2)} ${circle.currency} has been applied to your outstanding balance.`,
                metadata: { lateFee, remaining: payment.remainingAmount },
              },
            });
          });
        } catch (err) {
          logger.error('[CRON] Failed to apply late fee', { paymentId: payment.id, error: err.message });
        }
      }
    }
  }

  logger.info('[CRON] Late fee calculation complete');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP EXPIRED IDEMPOTENCY KEYS
// ─────────────────────────────────────────────────────────────────────────────

async function cleanupExpiredIdempotencyKeys() {
  const deleted = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (deleted.count > 0) {
    logger.info(`[CRON] Cleaned up ${deleted.count} expired idempotency keys`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START ALL CRON JOBS
// ─────────────────────────────────────────────────────────────────────────────

function startCronJobs() {
  // Process scheduled debits — every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await processScheduledDebits();
    } catch (err) {
      logger.error('[CRON] processScheduledDebits failed', { error: err.message });
    }
  });

  // Calculate late fees — every day at 00:05 UTC
  cron.schedule('5 0 * * *', async () => {
    try {
      await calculateAndApplyLateFees();
    } catch (err) {
      logger.error('[CRON] calculateAndApplyLateFees failed', { error: err.message });
    }
  });

  // Cleanup expired idempotency keys — every day at 03:00 UTC
  cron.schedule('0 3 * * *', async () => {
    try {
      await cleanupExpiredIdempotencyKeys();
    } catch (err) {
      logger.error('[CRON] cleanupExpiredIdempotencyKeys failed', { error: err.message });
    }
  });

  logger.info('[CRON] All cron jobs started');
}

module.exports = {
  startCronJobs,
  processScheduledDebits,
  calculateAndApplyLateFees,
  cleanupExpiredIdempotencyKeys,
};