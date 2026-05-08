const { prisma } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Trust Score Algorithm
 *
 * Score range: 0–100 (starts at 100 for new users)
 * Events and their deltas:
 *
 *  ON_TIME_PAYMENT    +2.0   (reliable behavior)
 *  EARLY_PAYMENT      +3.0   (extra reliable)
 *  LATE_PAYMENT       −5.0   (negative signal)
 *  PARTIAL_PAYMENT    −3.0   (partial contribution)
 *  DEFAULT            −20.0  (serious breach of trust)
 *  SWAP_GRANTED       +1.0   (flexible / community-minded)
 *  CIRCLE_COMPLETED   +10.0  (went the distance)
 *  CIRCLE_DISSOLVED   −5.0   (contributed to dissolution)
 *  ORGANIZER_BONUS    +5.0   (successfully ran a circle)
 *
 * Cross-circle impact: if a user defaults in one circle,
 * all overlapping circles (where they are also a member)
 * see a reduced trust signal applied to the organizer's
 * risk assessment (stored as metadata on the TrustEvent).
 */

const TRUST_DELTAS = {
  ON_TIME_PAYMENT: 2.0,
  EARLY_PAYMENT: 3.0,
  LATE_PAYMENT: -5.0,
  PARTIAL_PAYMENT: -3.0,
  DEFAULT: -20.0,
  SWAP_GRANTED: 1.0,
  CIRCLE_COMPLETED: 10.0,
  CIRCLE_DISSOLVED: -5.0,
  ORGANIZER_BONUS: 5.0,
};

const MIN_SCORE = 0;
const MAX_SCORE = 100;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply a trust event to a user and persist it.
 *
 * @param {string} userId
 * @param {string} eventType  - one of the keys in TRUST_DELTAS
 * @param {string|null} circleId
 * @param {Object} metadata   - optional extra context
 * @returns {Object} { scoreAfter, delta }
 */
async function applyTrustEvent(userId, eventType, circleId = null, metadata = {}) {
  const delta = TRUST_DELTAS[eventType];
  if (delta === undefined) {
    throw new Error(`Unknown trust event type: ${eventType}`);
  }

  // Fetch current score in a transaction to avoid races
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, trustScore: true },
    });

    if (!user) throw new Error(`User ${userId} not found`);

    const newScore = clamp(user.trustScore + delta, MIN_SCORE, MAX_SCORE);

    await tx.user.update({
      where: { id: userId },
      data: { trustScore: newScore },
    });

    const event = await tx.trustEvent.create({
      data: {
        userId,
        circleId,
        eventType,
        delta,
        scoreAfter: newScore,
        metadata,
      },
    });

    return { scoreAfter: newScore, delta, event };
  });

  logger.info('Trust event applied', {
    userId,
    eventType,
    delta,
    scoreAfter: result.scoreAfter,
    circleId,
  });

  return result;
}

/**
 * Cross-circle impact: when a user defaults, penalise their
 * trust score in ALL circles they participate in and notify
 * the affected organizers.
 *
 * In a full graph-database implementation this would traverse
 * a "social graph" of overlapping members. Here we implement
 * the same logic using PostgreSQL self-joins on CircleMember.
 *
 * @param {string} defaultingUserId
 * @param {string} sourceCircleId  - where the default happened
 */
async function propagateCrossCircleDefault(defaultingUserId, sourceCircleId) {
  // Find all OTHER active circles this user is a member of
  const overlappingMemberships = await prisma.circleMember.findMany({
    where: {
      userId: defaultingUserId,
      circleId: { not: sourceCircleId },
      status: 'ACTIVE',
    },
    include: {
      circle: { select: { id: true, name: true, organizerId: true } },
    },
  });

  if (overlappingMemberships.length === 0) return;

  logger.info('Cross-circle default propagation', {
    userId: defaultingUserId,
    affectedCircles: overlappingMemberships.map((m) => m.circleId),
  });

  // Apply a milder penalty per overlapping circle (-5 instead of -20)
  for (const membership of overlappingMemberships) {
    await applyTrustEvent(defaultingUserId, 'DEFAULT', membership.circleId, {
      propagatedFrom: sourceCircleId,
      crossCircleImpact: true,
      note: `Defaulted in circle ${sourceCircleId}, impact propagated here`,
    });

    // Notify the organizer of each affected circle
    await prisma.notification.create({
      data: {
        userId: membership.circle.organizerId,
        circleId: membership.circleId,
        type: 'CROSS_CIRCLE_DEFAULT_ALERT',
        title: 'Member Default Alert',
        body: `A member in your circle "${membership.circle.name}" has defaulted in another circle. Their trust score has been reduced.`,
        metadata: { affectedUserId: defaultingUserId, sourceCircleId },
      },
    });
  }
}

/**
 * Get trust history for a user (paginated).
 *
 * @param {string} userId
 * @param {{ cursor?: string, limit?: number }} options
 */
async function getTrustHistory(userId, { cursor, limit = 20 } = {}) {
  const take = Math.min(limit, 50);

  const events = await prisma.trustEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = events.length > take;
  const data = hasMore ? events.slice(0, take) : events;

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

/**
 * Compute a risk tier label from a trust score.
 * Useful for display and for organizer decisions.
 */
function getTrustTier(score) {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 60) return 'FAIR';
  if (score >= 40) return 'POOR';
  return 'HIGH_RISK';
}

module.exports = {
  applyTrustEvent,
  propagateCrossCircleDefault,
  getTrustHistory,
  getTrustTier,
  TRUST_DELTAS,
};