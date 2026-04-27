const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { recordContribution, recordPenalty } = require('./ledgerService');
const { applyTrustDelta } = require('./trustService');
const { calculatePartialPenalty, calculateLateFee } = require('./penaltyService');
const logger = require('../utils/logger');

/**
 * Payment state machine transitions:
 *
 * PENDING  → PARTIAL  (paid > 0 && paid < amount)
 * PENDING  → PAID     (paid === amount, within grace)
 * PENDING  → LATE     (past grace period, not fully paid)
 * PARTIAL  → PAID     (subsequent payment completes balance)
 * PARTIAL  → LATE     (past grace period)
 * LATE     → PAID     (finally paid, with penalties)
 * LATE     → DEFAULTED (30+ days overdue)
 * PAID     → PAID     (terminal, no change)
 * DEFAULTED→ DEFAULTED (terminal, no change)
 */

/**
 * Submit a payment for a circle contribution.
 * Idempotent: same idempotency key → same response, never double-charge.
 *
 * @param {string} userId - Paying member's user ID
 * @param {Object} data
 * @param {string} data.circleId
 * @param {string} data.scheduleId - PaymentSchedule ID for this cycle
 * @param {number} data.amount - Amount being paid NOW (may be partial)
 * @param {string} data.idempotencyKey - Client-provided UUID
 */
async function submitPayment(userId, { circleId, scheduleId, amount, idempotencyKey }) {
  // Verify membership
  const membership = await prisma.circleMember.findFirst({
    where: { userId, circleId, status: 'APPROVED' },
  });
  if (!membership) throw ApiError.forbidden('You are not an approved member of this circle.', 'NOT_A_MEMBER');

  // Verify circle is active
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle || circle.status !== 'ACTIVE') {
    throw ApiError.badRequest('Circle is not active.', 'CIRCLE_NOT_ACTIVE');
  }

  // Verify schedule exists and belongs to circle
  const schedule = await prisma.paymentSchedule.findFirst({
    where: { id: scheduleId, circleId },
  });
  if (!schedule) throw ApiError.notFound('Payment schedule not found.', 'SCHEDULE_NOT_FOUND');

  // Idempotency: find existing payment with this key
  const existingByKey = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existingByKey) {
    logger.info('Idempotent payment returned', { idempotencyKey });
    return { payment: existingByKey, idempotent: true };
  }

  // Find or create payment record for this user + schedule
  let payment = await prisma.payment.findFirst({
    where: { userId, scheduleId, circleId },
  });

  if (payment) {
    // Existing payment: apply additional payment
    if (['PAID', 'DEFAULTED'].includes(payment.status)) {
      throw ApiError.conflict('This payment is already settled or defaulted.', 'PAYMENT_SETTLED');
    }
    return applyAdditionalPayment(payment, amount, circle, idempotencyKey);
  }

  // New payment
  const expectedAmount = Number(circle.amount);
  const paidAmount = Math.min(Number(amount), expectedAmount);

  const { fee: lateFee, isInGracePeriod } = calculateLateFee(expectedAmount, schedule.dueDate);
  const isFullyPaid = paidAmount >= expectedAmount;
  const isLate = lateFee > 0 && !isInGracePeriod;

  let status;
  if (isFullyPaid && !isLate) status = 'PAID';
  else if (isFullyPaid && isLate) status = 'PAID'; // paid late but fully
  else status = 'PARTIAL';

  const result = await prisma.$transaction(async (tx) => {
    const newPayment = await tx.payment.create({
      data: {
        userId,
        circleId,
        scheduleId,
        amount: expectedAmount,
        paidAmount,
        status,
        idempotencyKey,
        dueDate: schedule.dueDate,
        paidAt: new Date(),
      },
    });

    // Apply late fee penalty if applicable
    if (isLate) {
      await tx.penalty.create({
        data: {
          paymentId: newPayment.id,
          amount: lateFee,
          reason: `LATE_PAYMENT`,
          daysLate: Math.floor((new Date() - schedule.dueDate) / (24 * 60 * 60 * 1000)),
        },
      });
    }

    // Apply partial payment penalty
    if (!isFullyPaid) {
      const { penalty } = calculatePartialPenalty(expectedAmount, paidAmount);
      if (penalty > 0) {
        await tx.penalty.create({
          data: {
            paymentId: newPayment.id,
            amount: penalty,
            reason: `PARTIAL_PAYMENT: paid ${paidAmount} of ${expectedAmount}`,
            daysLate: 0,
          },
        });
      }
    }

    // Double-entry ledger
    await recordContribution(tx, {
      circleId,
      memberId: userId,
      amount: paidAmount,
      paymentId: newPayment.id,
    });

    return newPayment;
  });

  // Update trust score (outside transaction)
  if (isFullyPaid && !isLate) {
    await applyTrustDelta(userId, CONSTANTS.TRUST_ON_TIME_PAYMENT, 'On-time payment', circleId);
  } else if (!isFullyPaid) {
    await applyTrustDelta(userId, CONSTANTS.TRUST_PARTIAL_PAYMENT, 'Partial payment', circleId);
  }

  // Notify member
  await prisma.notification.create({
    data: {
      userId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: `Your payment of ${paidAmount} for circle "${circle.name}" has been recorded.`,
      metadata: { paymentId: result.id, circleId, amount: paidAmount, status },
    },
  });

  logger.info('Payment submitted', { paymentId: result.id, userId, circleId, status, amount: paidAmount });
  return { payment: result, idempotent: false };
}

/**
 * Apply additional payment to an existing partial payment.
 */
async function applyAdditionalPayment(existingPayment, additionalAmount, circle, newIdempotencyKey) {
  const expectedAmount = Number(existingPayment.amount);
  const alreadyPaid = Number(existingPayment.paidAmount);
  const remaining = expectedAmount - alreadyPaid;
  const paying = Math.min(Number(additionalAmount), remaining);
  const newPaidTotal = alreadyPaid + paying;
  const isFullyPaid = newPaidTotal >= expectedAmount;

  const updated = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id: existingPayment.id },
      data: {
        paidAmount: newPaidTotal,
        status: isFullyPaid ? 'PAID' : 'PARTIAL',
        paidAt: isFullyPaid ? new Date() : existingPayment.paidAt,
        idempotencyKey: newIdempotencyKey, // update key for idempotency tracking
      },
    });

    // Additional ledger entry for this partial installment
    await recordContribution(tx, {
      circleId: existingPayment.circleId,
      memberId: existingPayment.userId,
      amount: paying,
      paymentId: payment.id,
    });

    return payment;
  });

  if (isFullyPaid) {
    await applyTrustDelta(existingPayment.userId, CONSTANTS.TRUST_ON_TIME_PAYMENT, 'Completed partial payment', existingPayment.circleId);
  }

  return { payment: updated, idempotent: false };
}

/**
 * Get all payments for a circle (paginated).
 */
async function getCirclePayments(circleId, { cursor, limit, status } = {}) {
  const { buildCursorArgs, buildPaginationMeta } = require('../utils/pagination');
  const { args, take } = buildCursorArgs({ cursor, limit });

  const where = { circleId };
  if (status) where.status = status;

  const payments = await prisma.payment.findMany({
    ...args,
    where,
    include: {
      user: { select: { id: true, username: true } },
      schedule: { select: { cycleNumber: true, dueDate: true } },
      penalties: true,
    },
  });

  return buildPaginationMeta(payments, take);
}

/**
 * Get a user's payment history across all circles.
 */
async function getUserPayments(userId, { cursor, limit } = {}) {
  const { buildCursorArgs, buildPaginationMeta } = require('../utils/pagination');
  const { args, take } = buildCursorArgs({ cursor, limit });

  const payments = await prisma.payment.findMany({
    ...args,
    where: { userId },
    include: {
      circle: { select: { id: true, name: true } },
      schedule: { select: { cycleNumber: true, dueDate: true } },
      penalties: true,
    },
  });

  return buildPaginationMeta(payments, take);
}

module.exports = {
  submitPayment,
  getCirclePayments,
  getUserPayments,
};