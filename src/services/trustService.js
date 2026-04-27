const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Apply a trust score delta to a user.
 * Records the event in TrustEvent table for auditing.
 *
 * @param {string} userId
 * @param {number} scoreChange - Positive (reward) or negative (penalty)
 * @param {string} reason - Human-readable reason
 * @param {string} [circleId]
 * @param {Object} [tx] - Optional Prisma transaction client
 */
async function applyTrustDelta(userId, scoreChange, reason, circleId = null, tx = null) {
  const client = tx || prisma;

  // Get current score
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { trustScore: true },
  });

  if (!user) return;

  const newScore = Math.max(0, Math.min(100, user.trustScore + scoreChange));

  await client.$transaction(async (t) => {
    await t.user.update({
      where: { id: userId },
      data: { trustScore: newScore },
    });

    await t.trustEvent.create({
      data: {
        userId,
        scoreChange,
        reason,
        circleId,
        metadata: {
          previousScore: user.trustScore,
          newScore,
        },
      },
    });
  });

  logger.info('Trust score updated', { userId, scoreChange, reason, newScore });
  return newScore;
}

/**
 * Calculate trust score from historical behavior.
 * Called when rebuilding a user's score from scratch.
 *
 * Algorithm:
 * - Start at 100
 * - On-time payment: +2 per payment
 * - Late payment: -5 per occurrence
 * - Partial payment: -3 per occurrence
 * - Default: -25 per default
 * - Circle completion (member): +10 per completed circle
 *
 * Cross-circle effect: defaults in any circle affect eligibility in ALL circles.
 */
async function recomputeTrustScore(userId) {
  const events = await prisma.trustEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });

  const score = events.reduce((acc, e) => Math.max(0, Math.min(100, acc + e.scoreChange)), 100);
  return score;
}

/**
 * Get user trust events history (graph-based reputation timeline).
 */
async function getTrustHistory(userId) {
  return prisma.trustEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      scoreChange: true,
      reason: true,
      circleId: true,
      createdAt: true,
      metadata: true,
    },
  });
}

/**
 * Check if a user is eligible to join a circle.
 * Minimum trust score enforced.
 */
async function isEligibleToJoin(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trustScore: true, isActive: true, isBanned: true },
  });

  if (!user || !user.isActive || user.isBanned) return { eligible: false, reason: 'Account suspended' };
  if (user.trustScore < CONSTANTS.TRUST_MIN_TO_JOIN) {
    return {
      eligible: false,
      reason: `Trust score ${user.trustScore} is below minimum ${CONSTANTS.TRUST_MIN_TO_JOIN}`,
    };
  }

  return { eligible: true };
}

/**
 * Check if a user is in default across ANY circle (cross-circle trust graph).
 * If a user defaulted in one circle, it reflects in their eligibility for others.
 */
async function hasCrossCircleDefault(userId) {
  const defaults = await prisma.payment.count({
    where: { userId, status: 'DEFAULTED' },
  });
  return defaults > 0;
}

module.exports = {
  applyTrustDelta,
  recomputeTrustScore,
  getTrustHistory,
  isEligibleToJoin,
  hasCrossCircleDefault,
};