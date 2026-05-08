const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const ledgerService = require('./ledgerService');
const { applyTrustEvent, propagateCrossCircleDefault } = require('./trustService');
const env = require('../config/env');

// ─────────────────────────────────────────────────────────────────────────────
// LATE FEE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the late fee for an overdue payment.
 * Prorated: fee accrues per day past grace period.
 *
 * Formula: amount × LATE_FEE_PERCENT_PER_DAY × daysLate
 * Grace period: PAYMENT_GRACE_DAYS (default 5)
 *
 * @param {number} amount      - original due amount
 * @param {Date}   dueDate     - when payment was due
 * @param {Date}   [asOf]      - calculate as of this date (default: now)
 * @returns {{ daysLate, daysChargeable, lateFee }}
 */
function calculateLateFee(amount, dueDate, asOf = new Date()) {
  const daysLate = Math.floor((asOf - new Date(dueDate)) / (1000 * 60 * 60 * 24));

  if (daysLate <= 0) {
    return { daysLate: 0, daysChargeable: 0, lateFee: 0 };
  }

  const daysChargeable = Math.max(0, daysLate - env.PAYMENT_GRACE_DAYS);
  const lateFee = Math.round(amount * (env.LATE_FEE_PERCENT_PER_DAY / 100) * daysChargeable * 100) / 100;

  return { daysLate, daysChargeable, lateFee };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT PAYMENT  (partial payment state machine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a payment for a circle round.
 *
 * State machine:
 *   PENDING → (amount >= dueAmount + fees) → COMPLETED
 *   PENDING → (0 < amount < due)           → PARTIAL
 *   PENDING → failure                       → FAILED
 *
 * Atomicity: the ledger entry, payment record, and member update are
 * committed in a single DB transaction. Overselling is impossible.
 */
async function submitPayment(userId, { circleId, amount, currency, paymentMethod, reference }) {
  // Resolve membership
  const member = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    include: { circle: true },
  });

  if (!member || member.status !== 'ACTIVE') {
    throw ApiError.forbidden('You are not an active member of this circle.', 'MEMBER_NOT_ACTIVE');
  }

  const circle = member.circle;
  if (circle.status !== 'ACTIVE') {
    throw ApiError.conflict('This circle is not currently active.', 'CIRCLE_NOT_ACTIVE');
  }

  const currentRound = circle.currentRound;
  const dueAmount = parseFloat(circle.contributionAmount);

  // Check for an existing payment this round
  const existingPayment = await prisma.payment.findFirst({
    where: { memberId: member.id, circleId, round: currentRound, status: { in: ['COMPLETED', 'PROCESSING'] } },
  });
  if (existingPayment) {
    throw ApiError.conflict('You have already paid for this round.', 'PAYMENT_ALREADY_MADE');
  }

  // Calculate late fee based on nextPaymentDate
  const { lateFee, daysLate } = calculateLateFee(dueAmount, circle.nextPaymentDate);

  const totalDue = dueAmount + lateFee;
  const platformFee = Math.round(parseFloat(amount) * (env.PLATFORM_FEE_PERCENT / 100) * 100) / 100;

  // Determine payment status
  const isPartial = amount < totalDue;
  const remainingAmount = isPartial ? Math.round((totalDue - amount) * 100) / 100 : 0;
  const paymentStatus = isPartial ? 'PARTIAL' : 'COMPLETED';

  const payment = await prisma.$transaction(async (tx) => {
    // 1. Create payment record
    const p = await tx.payment.create({
      data: {
        circleId,
        memberId: member.id,
        userId,
        round: currentRound,
        dueAmount,
        amount,
        currency: currency || circle.currency,
        status: paymentStatus,
        paymentMethod,
        reference,
        lateFee,
        platformFee,
        isPartial,
        remainingAmount,
        processedAt: new Date(),
      },
    });

    // 2. Record contribution in double-entry ledger
    await ledgerService.recordContribution(
      tx, circleId, p.id, amount, currency || circle.currency,
      `Round ${currentRound} contribution from member ${member.id}`
    );

    // 3. Record late fee if applicable
    if (lateFee > 0) {
      await ledgerService.recordLateFee(
        tx, circleId, p.id, lateFee, currency || circle.currency,
        `Late fee: ${daysLate} days late (${env.PAYMENT_GRACE_DAYS} day grace period)`
      );
    }

    // 4. Record platform fee
    if (platformFee > 0) {
      await ledgerService.recordPlatformFee(
        tx, circleId, p.id, platformFee, currency || circle.currency,
        `Platform fee (${env.PLATFORM_FEE_PERCENT}%) for payment ${p.id}`
      );
    }

    // 5. Update member totals
    await tx.circleMember.update({
      where: { id: member.id },
      data: {
        totalPaid: { increment: amount },
        ...(lateFee > 0 ? { latePayments: { increment: 1 } } : {}),
      },
    });

    // 6. Mark scheduled debit as completed
    await tx.scheduledDebit.updateMany({
      where: {
        circleId,
        memberId: member.id,
        round: currentRound,
        status: { in: ['SCHEDULED', 'FAILED'] },
      },
      data: { status: isPartial ? 'FAILED' : 'COMPLETED', completedAt: isPartial ? null : new Date() },
    });

    // 7. Send notification
    await tx.notification.create({
      data: {
        userId,
        circleId,
        type: isPartial ? 'PARTIAL_PAYMENT_RECEIVED' : 'PAYMENT_RECEIVED',
        title: isPartial ? 'Partial Payment Recorded' : 'Payment Received ✓',
        body: isPartial
          ? `Payment of ${amount} received. Remaining balance: ${remainingAmount} ${circle.currency}. Please complete before payout.`
          : `Full payment of ${amount} ${circle.currency} for round ${currentRound} confirmed.`,
        metadata: { amount, lateFee, remainingAmount, round: currentRound },
      },
    });

    return p;
  });

  // Trust score update (outside transaction)
  if (!isPartial) {
    const eventType = lateFee > 0 ? 'LATE_PAYMENT' : 'ON_TIME_PAYMENT';
    await applyTrustEvent(userId, eventType, circleId, { round: currentRound, lateFee });
  } else {
    await applyTrustEvent(userId, 'PARTIAL_PAYMENT', circleId, { round: currentRound, paid: amount, remaining: remainingAmount });
  }

  logger.info('Payment submitted', { paymentId: payment.id, userId, circleId, amount, status: paymentStatus });
  return payment;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET MY PAYMENTS  (cursor-based pagination)
// ─────────────────────────────────────────────────────────────────────────────

async function getMyPayments(userId, { cursor, limit = 20, circleId, status } = {}) {
  const take = Math.min(limit, 50);
  const where = { userId };
  if (circleId) where.circleId = circleId;
  if (status) where.status = status;

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      circle: { select: { id: true, name: true, currency: true } },
    },
  });

  const hasMore = payments.length > take;
  const data = hasMore ? payments.slice(0, take) : payments;

  return {
    data,
    meta: {
      pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET CIRCLE PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────

async function getCirclePayments(circleId, { cursor, limit = 20, round, status } = {}) {
  const take = Math.min(limit, 100);
  const where = { circleId };
  if (round) where.round = parseInt(round);
  if (status) where.status = status;

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, username: true } },
      member: { select: { id: true, position: true } },
    },
  });

  const hasMore = payments.length > take;
  const data = hasMore ? payments.slice(0, take) : payments;

  return {
    data,
    meta: {
      pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS DEFAULT  (called by cron when member fails to pay)
// ─────────────────────────────────────────────────────────────────────────────

async function processDefault(memberId, circleId, round) {
  const member = await prisma.circleMember.findUnique({ where: { id: memberId }, include: { circle: true } });
  if (!member) return;

  await prisma.$transaction(async (tx) => {
    await tx.circleMember.update({
      where: { id: memberId },
      data: { missedPayments: { increment: 1 }, status: member.missedPayments >= 2 ? 'DEFAULTED' : 'ACTIVE' },
    });

    if (member.missedPayments >= 2) {
      await tx.notification.create({
        data: {
          userId: member.userId,
          circleId,
          type: 'MEMBER_DEFAULTED',
          title: 'Account Flagged',
          body: `You have missed ${member.missedPayments + 1} payments in "${member.circle.name}". Your account has been flagged.`,
        },
      });

      // Notify organizer
      await tx.notification.create({
        data: {
          userId: member.circle.organizerId,
          circleId,
          type: 'MEMBER_DEFAULTED',
          title: 'Member Default',
          body: `A member has defaulted after ${member.missedPayments + 1} missed payments.`,
          metadata: { memberId, userId: member.userId },
        },
      });
    }
  });

  // Apply trust penalty
  if (member.missedPayments >= 2) {
    await applyTrustEvent(member.userId, 'DEFAULT', circleId, { round, missedPayments: member.missedPayments + 1 });
    await propagateCrossCircleDefault(member.userId, circleId);
  } else {
    await applyTrustEvent(member.userId, 'LATE_PAYMENT', circleId, { round });
  }
}

module.exports = {
  submitPayment,
  getMyPayments,
  getCirclePayments,
  calculateLateFee,
  processDefault,
};