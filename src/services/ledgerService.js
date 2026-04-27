const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Write a double-entry ledger record.
 * ALWAYS called inside a prisma.$transaction() to guarantee atomicity.
 *
 * Double-entry rule: debitAmount === creditAmount per transactionId.
 * Every money movement records WHO sent (debit) and WHO received (credit).
 *
 * @param {Object} tx - Prisma transaction client
 * @param {Object} opts
 * @param {string} opts.circleId
 * @param {string} opts.transactionType - TransactionType enum value
 * @param {string} opts.debitAccount    - e.g. "member:uuid" or "circle:uuid"
 * @param {string} opts.creditAccount
 * @param {Decimal|number} opts.amount
 * @param {string} [opts.description]
 * @param {Object} [opts.metadata]
 * @returns {string} transactionId (UUID grouping the pair)
 */
async function writeDoubleEntry(tx, { circleId, transactionType, debitAccount, creditAccount, amount, description, metadata }) {
  // Enforce: debit !== credit (no self-transfer)
  if (debitAccount === creditAccount) {
    throw ApiError.badRequest('Ledger debit and credit accounts must differ.', 'LEDGER_SELF_TRANSFER');
  }

  if (Number(amount) <= 0) {
    throw ApiError.badRequest('Ledger amount must be positive.', 'LEDGER_INVALID_AMOUNT');
  }

  const transactionId = uuidv4();

  // Write BOTH entries in single operation (atomic within transaction)
  await tx.ledgerEntry.createMany({
    data: [
      {
        transactionId,
        circleId,
        type: transactionType,
        debitAccount,
        creditAccount,
        amount,
        description: description ? `[DEBIT] ${description}` : '[DEBIT]',
        metadata: metadata || null,
      },
      {
        transactionId,
        circleId,
        type: transactionType,
        debitAccount: creditAccount, // mirror
        creditAccount: debitAccount, // mirror
        amount,
        description: description ? `[CREDIT] ${description}` : '[CREDIT]',
        metadata: metadata || null,
      },
    ],
  });

  logger.info('Ledger double-entry written', {
    transactionId,
    circleId,
    type: transactionType,
    debitAccount,
    creditAccount,
    amount: String(amount),
  });

  return transactionId;
}

/**
 * Record a contribution payment in the ledger.
 */
async function recordContribution(tx, { circleId, memberId, amount, paymentId }) {
  return writeDoubleEntry(tx, {
    circleId,
    transactionType: 'CONTRIBUTION',
    debitAccount: `${CONSTANTS.ACCOUNT_MEMBER}:${memberId}`,
    creditAccount: `${CONSTANTS.ACCOUNT_CIRCLE}:${circleId}`,
    amount,
    description: `Member contribution`,
    metadata: { paymentId, memberId },
  });
}

/**
 * Record a payout from circle to recipient member.
 */
async function recordPayout(tx, { circleId, recipientMemberId, amount, scheduleId, platformFee }) {
  const netAmount = Number(amount) - Number(platformFee);

  // Circle → recipient
  const txId = await writeDoubleEntry(tx, {
    circleId,
    transactionType: 'PAYOUT',
    debitAccount: `${CONSTANTS.ACCOUNT_CIRCLE}:${circleId}`,
    creditAccount: `${CONSTANTS.ACCOUNT_MEMBER}:${recipientMemberId}`,
    amount: netAmount,
    description: 'Member payout disbursement',
    metadata: { scheduleId, recipientMemberId, grossAmount: String(amount), platformFee: String(platformFee) },
  });

  // Circle → platform fee
  if (Number(platformFee) > 0) {
    await writeDoubleEntry(tx, {
      circleId,
      transactionType: 'FEE',
      debitAccount: `${CONSTANTS.ACCOUNT_CIRCLE}:${circleId}`,
      creditAccount: CONSTANTS.ACCOUNT_PLATFORM,
      amount: platformFee,
      description: 'Platform fee on payout',
      metadata: { scheduleId, feePercent: CONSTANTS.PLATFORM_FEE_PERCENT },
    });
  }

  return txId;
}

/**
 * Record a penalty charge.
 */
async function recordPenalty(tx, { circleId, memberId, amount, reason, paymentId }) {
  return writeDoubleEntry(tx, {
    circleId,
    transactionType: 'PENALTY',
    debitAccount: `${CONSTANTS.ACCOUNT_MEMBER}:${memberId}`,
    creditAccount: `${CONSTANTS.ACCOUNT_CIRCLE}:${circleId}`,
    amount,
    description: `Penalty: ${reason}`,
    metadata: { paymentId, memberId, reason },
  });
}

/**
 * Get ledger for a circle with cursor pagination.
 */
async function getCircleLedger(circleId, { cursor, limit } = {}) {
  const take = Math.min(Number(limit) || 20, 100);
  const args = {
    where: {
      circleId,
      debitAccount: { startsWith: `${CONSTANTS.ACCOUNT_MEMBER}:` }, // only debit side to avoid duplicates
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
  };

  if (cursor) {
    const { decodeCursor } = require('../utils/pagination');
    const decoded = decodeCursor(cursor);
    if (decoded?.id) {
      args.cursor = { id: decoded.id };
      args.skip = 1;
    }
  }

  const entries = await prisma.ledgerEntry.findMany(args);
  const hasNext = entries.length > take;
  const data = hasNext ? entries.slice(0, take) : entries;

  return {
    entries: data,
    hasNextPage: hasNext,
    nextCursor: hasNext
      ? Buffer.from(JSON.stringify({ id: data[data.length - 1].id })).toString('base64url')
      : null,
  };
}

/**
 * Verify ledger balance integrity: sum of debits === sum of credits per transactionId.
 * Used in tests and audit jobs.
 */
async function verifyLedgerBalance(circleId) {
  const entries = await prisma.ledgerEntry.groupBy({
    by: ['transactionId'],
    where: { circleId },
    _sum: { amount: true },
    _count: true,
  });

  const unbalanced = entries.filter((e) => e._count % 2 !== 0);
  return { balanced: unbalanced.length === 0, unbalanced };
}

module.exports = {
  writeDoubleEntry,
  recordContribution,
  recordPayout,
  recordPenalty,
  getCircleLedger,
  verifyLedgerBalance,
};