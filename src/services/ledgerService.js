const { prisma } = require('../config/database');
const { Decimal } = require('@prisma/client/runtime/library');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Account names used in the double-entry ledger.
 * Every debit has exactly one matching credit.
 */
const ACCOUNTS = {
  MEMBER_WALLET: 'MEMBER_WALLET',    // member's virtual wallet
  CIRCLE_POOL:   'CIRCLE_POOL',      // the shared pot
  PLATFORM:      'PLATFORM_RESERVE', // CircleSave revenue
  LATE_FEE:      'LATE_FEE_INCOME',  // late fee revenue
};

/**
 * Get the current circle pool balance from the last ledger entry.
 * O(1) — we store running balance on each row.
 */
async function getCircleBalance(circleId, tx = prisma) {
  const last = await tx.ledgerEntry.findFirst({
    where: { circleId },
    orderBy: { createdAt: 'desc' },
    select: { balanceAfter: true },
  });
  return last ? parseFloat(last.balanceAfter) : 0;
}

/**
 * Record a contribution payment in the ledger.
 * Creates ONE double-entry row: member_wallet → circle_pool.
 *
 * Must be called INSIDE a prisma.$transaction.
 *
 * @param {Object} tx         - Prisma transaction client
 * @param {string} circleId
 * @param {string} paymentId
 * @param {number} amount
 * @param {string} currency
 * @param {string} description
 */
async function recordContribution(tx, circleId, paymentId, amount, currency, description) {
  _assertPositive(amount);
  const balanceBefore = await getCircleBalance(circleId, tx);
  const balanceAfter = balanceBefore + amount;

  return tx.ledgerEntry.create({
    data: {
      circleId,
      paymentId,
      type: 'CONTRIBUTION',
      description,
      debitAmount: amount,
      creditAmount: amount,           // debit === credit — invariant
      currency,
      debitAccount: ACCOUNTS.MEMBER_WALLET,
      creditAccount: ACCOUNTS.CIRCLE_POOL,
      balanceAfter,
    },
  });
}

/**
 * Record a payout to a member: circle_pool → member_wallet.
 */
async function recordPayout(tx, circleId, paymentId, amount, currency, description) {
  _assertPositive(amount);
  const balanceBefore = await getCircleBalance(circleId, tx);
  const balanceAfter = balanceBefore - amount;

  if (balanceAfter < -0.01) {
    throw ApiError.badRequest('Insufficient circle pool balance for payout.', 'LEDGER_INSUFFICIENT_FUNDS');
  }

  return tx.ledgerEntry.create({
    data: {
      circleId,
      paymentId,
      type: 'PAYOUT',
      description,
      debitAmount: amount,
      creditAmount: amount,
      currency,
      debitAccount: ACCOUNTS.CIRCLE_POOL,
      creditAccount: ACCOUNTS.MEMBER_WALLET,
      balanceAfter,
    },
  });
}

/**
 * Record a late fee: member_wallet → late_fee_income.
 */
async function recordLateFee(tx, circleId, paymentId, amount, currency, description) {
  _assertPositive(amount);
  const balanceBefore = await getCircleBalance(circleId, tx);
  // Late fees go to platform — pool balance unchanged
  return tx.ledgerEntry.create({
    data: {
      circleId,
      paymentId,
      type: 'LATE_FEE',
      description,
      debitAmount: amount,
      creditAmount: amount,
      currency,
      debitAccount: ACCOUNTS.MEMBER_WALLET,
      creditAccount: ACCOUNTS.LATE_FEE,
      balanceAfter: balanceBefore, // pool not affected
    },
  });
}

/**
 * Record a platform fee: circle_pool → platform_reserve.
 */
async function recordPlatformFee(tx, circleId, paymentId, amount, currency, description) {
  _assertPositive(amount);
  const balanceBefore = await getCircleBalance(circleId, tx);
  const balanceAfter = balanceBefore - amount;

  return tx.ledgerEntry.create({
    data: {
      circleId,
      paymentId,
      type: 'PLATFORM_FEE',
      description,
      debitAmount: amount,
      creditAmount: amount,
      currency,
      debitAccount: ACCOUNTS.CIRCLE_POOL,
      creditAccount: ACCOUNTS.PLATFORM,
      balanceAfter,
    },
  });
}

/**
 * Verify ledger integrity: for every entry, debit === credit.
 * Also verifies running balance is consistent.
 * Returns { balanced, errors }.
 */
async function verifyLedgerBalance(circleId) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { circleId },
    orderBy: { createdAt: 'asc' },
  });

  const errors = [];
  let runningBalance = 0;

  for (const entry of entries) {
    const debit = parseFloat(entry.debitAmount);
    const credit = parseFloat(entry.creditAmount);

    // Invariant 1: debit == credit
    if (Math.abs(debit - credit) > 0.001) {
      errors.push({
        entryId: entry.id,
        issue: `Debit (${debit}) ≠ Credit (${credit})`,
      });
    }

    // Recompute running balance
    if (entry.creditAccount === ACCOUNTS.CIRCLE_POOL) runningBalance += credit;
    if (entry.debitAccount === ACCOUNTS.CIRCLE_POOL) runningBalance -= debit;

    // Invariant 2: running balance matches stored balanceAfter (for pool-affecting entries)
    const storedBalance = parseFloat(entry.balanceAfter);
    if (['CONTRIBUTION', 'PAYOUT', 'PLATFORM_FEE'].includes(entry.type)) {
      if (Math.abs(storedBalance - runningBalance) > 0.01) {
        errors.push({
          entryId: entry.id,
          issue: `Running balance mismatch: computed ${runningBalance.toFixed(2)}, stored ${storedBalance.toFixed(2)}`,
        });
      }
    }
  }

  return {
    balanced: errors.length === 0,
    entryCount: entries.length,
    currentBalance: runningBalance,
    errors,
  };
}

/**
 * Get paginated ledger entries for a circle.
 */
async function getCircleLedger(circleId, { cursor, limit = 20, type } = {}) {
  const take = Math.min(limit, 100);

  const where = { circleId };
  if (type) where.type = type;

  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      payment: { select: { id: true, amount: true, status: true, userId: true } },
    },
  });

  const hasMore = entries.length > take;
  const data = hasMore ? entries.slice(0, take) : entries;

  return {
    data,
    meta: {
      pagination: {
        hasMore,
        nextCursor: hasMore ? data[data.length - 1].id : null,
        limit: take,
      },
    },
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function _assertPositive(amount) {
  if (!amount || amount <= 0) {
    throw ApiError.badRequest('Ledger amount must be positive.', 'LEDGER_INVALID_AMOUNT');
  }
}

module.exports = {
  ACCOUNTS,
  getCircleBalance,
  recordContribution,
  recordPayout,
  recordLateFee,
  recordPlatformFee,
  verifyLedgerBalance,
  getCircleLedger,
};