const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Calculate late fee for a payment.
 *
 * Formula:
 *   fee = principal × (LATE_FEE_PERCENT_PER_DAY / 100) × daysLate
 *   capped at MAX_LATE_FEE_PERCENT of principal
 *
 * Grace period: PAYMENT_GRACE_DAYS days after due date → no fee.
 *
 * @param {Decimal|number} amount - Original payment amount
 * @param {Date} dueDate - Payment due date
 * @param {Date} [checkDate] - Date to check against (default: now)
 * @returns {{ fee: number, daysLate: number, isInGracePeriod: boolean }}
 */
function calculateLateFee(amount, dueDate, checkDate = new Date()) {
  const principal = Number(amount);
  const due = new Date(dueDate);
  const check = new Date(checkDate);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysOverdue = Math.floor((check - due) / msPerDay);

  if (daysOverdue <= 0) {
    return { fee: 0, daysLate: 0, isInGracePeriod: false };
  }

  if (daysOverdue <= CONSTANTS.PAYMENT_GRACE_DAYS) {
    return { fee: 0, daysLate: daysOverdue, isInGracePeriod: true };
  }

  const effectiveDays = daysOverdue - CONSTANTS.PAYMENT_GRACE_DAYS;
  const rawFee = principal * (CONSTANTS.LATE_FEE_PERCENT_PER_DAY / 100) * effectiveDays;
  const maxFee = principal * (CONSTANTS.MAX_LATE_FEE_PERCENT / 100);
  const fee = Math.min(rawFee, maxFee);

  return {
    fee: Math.round(fee * 100) / 100, // round to 2 decimal places
    daysLate: daysOverdue,
    isInGracePeriod: false,
  };
}

/**
 * Calculate prorated partial payment penalty.
 * When a member pays less than the full amount.
 *
 * Formula:
 *   shortfall = expected - paid
 *   penalty = shortfall × 0.05 (5% of shortfall)
 *
 * @param {number} expected - Expected payment amount
 * @param {number} paid - Actual paid amount
 * @returns {{ penalty: number, shortfall: number, percentPaid: number }}
 */
function calculatePartialPenalty(expected, paid) {
  const shortfall = Math.max(0, Number(expected) - Number(paid));
  const percentPaid = Number(paid) / Number(expected);

  if (shortfall <= 0) return { penalty: 0, shortfall: 0, percentPaid: 1 };

  const penalty = Math.round(shortfall * 0.05 * 100) / 100; // 5% of shortfall
  return { penalty, shortfall: Math.round(shortfall * 100) / 100, percentPaid };
}

/**
 * Apply late fee to a payment record.
 * Creates a Penalty record and updates payment status.
 *
 * @param {string} paymentId
 * @param {Date} [checkDate]
 */
async function applyLateFee(paymentId, checkDate = new Date()) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { penalties: true },
  });

  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  if (['PAID', 'DEFAULTED'].includes(payment.status)) return null;

  const { fee, daysLate, isInGracePeriod } = calculateLateFee(payment.amount, payment.dueDate, checkDate);

  if (fee <= 0 || isInGracePeriod) return null;

  // Don't double-apply the same late fee type
  const existingLateFee = payment.penalties.find((p) => p.reason.startsWith('LATE_FEE'));
  if (existingLateFee) return null;

  const penalty = await prisma.$transaction(async (tx) => {
    const p = await tx.penalty.create({
      data: {
        paymentId,
        amount: fee,
        reason: `LATE_FEE: ${daysLate} days late`,
        daysLate,
      },
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'LATE' },
    });

    return p;
  });

  logger.info('Late fee applied', { paymentId, fee, daysLate });
  return penalty;
}

/**
 * Summarize all penalties for a payment.
 */
async function getPaymentPenaltySummary(paymentId) {
  const penalties = await prisma.penalty.findMany({ where: { paymentId } });
  const total = penalties.reduce((sum, p) => sum + Number(p.amount), 0);
  return { penalties, totalPenalties: Math.round(total * 100) / 100 };
}

module.exports = {
  calculateLateFee,
  calculatePartialPenalty,
  applyLateFee,
  getPaymentPenaltySummary,
};