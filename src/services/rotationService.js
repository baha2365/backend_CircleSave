const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Generate deterministic payout order for circle members.
 *
 * Determinism guarantee: given the same set of member IDs, the order
 * is always the same (lexicographic sort by userId as default).
 * Organizer can shuffle on circle activation (one-time operation).
 *
 * @param {string[]} memberIds - Array of user IDs
 * @returns {string[]} Ordered member IDs
 */
function generateDeterministicOrder(memberIds) {
  return [...memberIds].sort(); // lexicographic sort → deterministic
}

/**
 * Shuffle array using Fisher-Yates (for initial randomization at activation).
 * After activation, order is FROZEN and only swappable via SwapRequest.
 */
function shuffleOrder(memberIds) {
  const arr = [...memberIds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get the full rotation schedule for a circle.
 * Returns members sorted by payoutOrder.
 */
async function getRotation(circleId) {
  const members = await prisma.circleMember.findMany({
    where: { circleId, status: 'APPROVED' },
    include: {
      user: { select: { id: true, username: true, email: true, trustScore: true } },
    },
    orderBy: { payoutOrder: 'asc' },
  });

  return members.map((m) => ({
    memberId: m.id,
    userId: m.userId,
    username: m.user.username,
    payoutOrder: m.payoutOrder,
    hasReceived: m.hasReceived,
    status: m.status,
  }));
}

/**
 * Emergency swap: exchange payout positions between two members.
 *
 * Rules:
 * - Neither member should have already received their payout
 * - Swap must be approved by ORGANIZER or ADMIN
 * - No duplicate positions after swap
 * - Atomic: both position updates happen in single transaction
 *
 * @param {string} circleId
 * @param {string} requesterId - userId of requesting member
 * @param {string} targetMemberId - CircleMember id to swap with
 * @param {string} reason
 * @param {string} approverId - userId of organizer/admin approving
 */
async function createSwapRequest(circleId, requesterId, targetMemberId, reason) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.status !== 'ACTIVE') throw ApiError.badRequest('Circle must be active for swaps.', 'CIRCLE_NOT_ACTIVE');

  // Find requester's membership
  const requesterMembership = await prisma.circleMember.findFirst({
    where: { circleId, userId: requesterId, status: 'APPROVED' },
  });
  if (!requesterMembership) throw ApiError.forbidden('You are not an approved member of this circle.', 'NOT_A_MEMBER');
  if (requesterMembership.hasReceived) throw ApiError.badRequest('You have already received your payout.', 'PAYOUT_RECEIVED');

  // Find target membership
  const targetMembership = await prisma.circleMember.findUnique({ where: { id: targetMemberId } });
  if (!targetMembership || targetMembership.circleId !== circleId)
    throw ApiError.notFound('Target member not found in this circle.', 'TARGET_NOT_FOUND');
  if (targetMembership.hasReceived) throw ApiError.badRequest('Target member has already received their payout.', 'TARGET_PAYOUT_RECEIVED');
  if (targetMembership.userId === requesterId) throw ApiError.badRequest('Cannot swap with yourself.', 'SELF_SWAP');

  // Check no pending swap request exists
  const existingSwap = await prisma.swapRequest.findFirst({
    where: { circleId, requesterId, status: 'PENDING' },
  });
  if (existingSwap) throw ApiError.conflict('You already have a pending swap request.', 'SWAP_PENDING_EXISTS');

  const swap = await prisma.swapRequest.create({
    data: {
      circleId,
      requesterId,
      targetMemberId,
      fromOrder: requesterMembership.payoutOrder,
      toOrder: targetMembership.payoutOrder,
      reason,
      status: 'PENDING',
    },
  });

  logger.info('Swap request created', { swapId: swap.id, circleId, requesterId, targetMemberId });
  return swap;
}

/**
 * Approve a swap request and execute the position exchange.
 */
async function approveSwap(swapId, approverId) {
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: { circle: true },
  });

  if (!swap) throw ApiError.notFound('Swap request not found.', 'SWAP_NOT_FOUND');
  if (swap.status !== 'PENDING') throw ApiError.badRequest('Swap request is not pending.', 'SWAP_NOT_PENDING');
  if (swap.circle.status !== 'ACTIVE') throw ApiError.badRequest('Circle is not active.', 'CIRCLE_NOT_ACTIVE');

  // Find both memberships
  const requesterMembership = await prisma.circleMember.findFirst({
    where: { circleId: swap.circleId, userId: swap.requesterId },
  });
  const targetMembership = await prisma.circleMember.findUnique({
    where: { id: swap.targetMemberId },
  });

  if (!requesterMembership || !targetMembership) {
    throw ApiError.notFound('One or both members not found.', 'MEMBER_NOT_FOUND');
  }

  if (requesterMembership.hasReceived || targetMembership.hasReceived) {
    throw ApiError.badRequest('Cannot swap: a member has already received their payout.', 'PAYOUT_ALREADY_RECEIVED');
  }

  // Execute atomic swap
  await prisma.$transaction([
    prisma.circleMember.update({
      where: { id: requesterMembership.id },
      data: { payoutOrder: swap.toOrder },
    }),
    prisma.circleMember.update({
      where: { id: swap.targetMemberId },
      data: { payoutOrder: swap.fromOrder },
    }),
    prisma.swapRequest.update({
      where: { id: swapId },
      data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: approverId },
    }),
  ]);

  // Audit
  await prisma.auditLog.create({
    data: {
      userId: approverId,
      action: 'SWAP_APPROVED',
      entity: 'SwapRequest',
      entityId: swapId,
      metadata: { fromOrder: swap.fromOrder, toOrder: swap.toOrder },
    },
  });

  logger.info('Swap approved and executed', { swapId, fromOrder: swap.fromOrder, toOrder: swap.toOrder });
  return swap;
}

/**
 * Reject a swap request.
 */
async function rejectSwap(swapId, approverId) {
  const swap = await prisma.swapRequest.findUnique({ where: { id: swapId } });
  if (!swap) throw ApiError.notFound('Swap request not found.', 'SWAP_NOT_FOUND');
  if (swap.status !== 'PENDING') throw ApiError.badRequest('Swap request is not pending.', 'SWAP_NOT_PENDING');

  return prisma.swapRequest.update({
    where: { id: swapId },
    data: { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: approverId },
  });
}

module.exports = {
  generateDeterministicOrder,
  shuffleOrder,
  getRotation,
  createSwapRequest,
  approveSwap,
  rejectSwap,
};