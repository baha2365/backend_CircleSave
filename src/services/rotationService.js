const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const ledgerService = require('./ledgerService');
const { applyTrustEvent } = require('./trustService');
const env = require('../config/env');

// ─────────────────────────────────────────────────────────────────────────────
// GET ROTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the full rotation schedule for a circle.
 * Each slot shows who is scheduled to receive the payout that round.
 */
async function getRotation(circleId, userId) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      members: {
        where: { status: { in: ['APPROVED', 'ACTIVE'] } },
        include: { user: { select: { id: true, username: true, trustScore: true } } },
        orderBy: { position: 'asc' },
      },
      rotationSlots: { orderBy: { round: 'asc' } },
    },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  // Verify requester is a member or organizer
  const isMember = circle.members.some((m) => m.userId === userId);
  if (!isMember && circle.organizerId !== userId) {
    throw ApiError.forbidden('You do not have access to this circle.', 'CIRCLE_ACCESS_DENIED');
  }

  // Enrich rotation slots with member info
  const memberMap = Object.fromEntries(circle.members.map((m) => [m.id, m]));
  const slots = circle.rotationSlots.map((slot) => ({
    ...slot,
    recipient: slot.memberId ? memberMap[slot.memberId] : null,
    isCurrent: slot.round === circle.currentRound,
  }));

  return { circle: { id: circle.id, name: circle.name, currentRound: circle.currentRound, status: circle.status }, slots };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE SWAP REQUEST  (emergency position bump)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A member can request to swap their rotation position with another member.
 * Common use case: medical emergency → bump up to receive payout sooner.
 */
async function createSwapRequest(circleId, userId, { requestedPosition, reason }) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.status !== 'ACTIVE') throw ApiError.conflict('Swaps are only allowed in active circles.', 'CIRCLE_NOT_ACTIVE');

  // Get requester's membership
  const requester = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
  });
  if (!requester || requester.status !== 'ACTIVE') {
    throw ApiError.forbidden('You are not an active member of this circle.', 'MEMBER_NOT_ACTIVE');
  }
  if (requester.hasReceived) {
    throw ApiError.conflict('You have already received your payout.', 'MEMBER_ALREADY_RECEIVED');
  }

  // Validate requested position
  const totalMembers = await prisma.circleMember.count({ where: { circleId, status: 'ACTIVE' } });
  if (requestedPosition < 1 || requestedPosition > totalMembers) {
    throw ApiError.badRequest(`Requested position must be between 1 and ${totalMembers}.`, 'INVALID_POSITION');
  }
  if (requestedPosition === requester.position) {
    throw ApiError.badRequest('Requested position is the same as your current position.', 'SAME_POSITION');
  }

  // Only allow swapping to a future position (can't go back to a round already paid)
  if (requestedPosition < circle.currentRound) {
    throw ApiError.badRequest('Cannot swap to a position in a round that has already been paid.', 'POSITION_ALREADY_PAID');
  }

  // Check for existing pending swap from this member
  const existingSwap = await prisma.swapRequest.findFirst({
    where: { circleId, requesterId: requester.id, status: 'PENDING' },
  });
  if (existingSwap) {
    throw ApiError.conflict('You already have a pending swap request.', 'SWAP_ALREADY_PENDING');
  }

  const swap = await prisma.$transaction(async (tx) => {
    const s = await tx.swapRequest.create({
      data: {
        circleId,
        requesterId: requester.id,
        currentPosition: requester.position,
        requestedPosition,
        reason,
      },
    });

    // Notify organizer
    await tx.notification.create({
      data: {
        userId: circle.organizerId,
        circleId,
        type: 'SWAP_REQUESTED',
        title: 'Swap Request',
        body: `A member has requested to swap from position #${requester.position} to #${requestedPosition}. Reason: ${reason || 'Not specified'}`,
        metadata: { swapId: s.id, memberId: requester.id },
      },
    });

    return s;
  });

  return swap;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET SWAP REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

async function getSwapRequests(circleId, userId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  const isMember = await prisma.circleMember.findUnique({ where: { circleId_userId: { circleId, userId } } });
  if (!isMember && circle.organizerId !== userId) {
    throw ApiError.forbidden('Access denied.', 'CIRCLE_ACCESS_DENIED');
  }

  return prisma.swapRequest.findMany({
    where: { circleId },
    include: {
      requester: { include: { user: { select: { id: true, username: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE SWAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approve a swap: exchange positions between the requester and whoever
 * currently holds the requested position. Also updates the RotationSlot.
 *
 * This is the "emergency swap" complexity requirement.
 */
async function approveSwap(circleId, swapId, organizerId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.organizerId !== organizerId) throw ApiError.forbidden('Only organizer can approve swaps.', 'NOT_ORGANIZER');

  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: { requester: true },
  });
  if (!swap || swap.circleId !== circleId) throw ApiError.notFound('Swap request not found.', 'SWAP_NOT_FOUND');
  if (swap.status !== 'PENDING') throw ApiError.conflict(`Swap is already ${swap.status}.`, 'SWAP_NOT_PENDING');

  // Find the member currently at the requested position
  const targetMember = await prisma.circleMember.findFirst({
    where: { circleId, position: swap.requestedPosition, status: 'ACTIVE' },
  });
  if (!targetMember) throw ApiError.notFound('No member found at the requested position.', 'TARGET_NOT_FOUND');

  if (targetMember.hasReceived) {
    throw ApiError.conflict('The target member has already received their payout. Cannot swap.', 'TARGET_ALREADY_RECEIVED');
  }

  await prisma.$transaction(async (tx) => {
    // Swap positions between the two members
    const requesterOldPos = swap.currentPosition;
    const targetOldPos = swap.requestedPosition;

    await tx.circleMember.update({ where: { id: swap.requester.id }, data: { position: targetOldPos } });
    await tx.circleMember.update({ where: { id: targetMember.id }, data: { position: requesterOldPos } });

    // Update rotation slots
    const requesterSlot = await tx.rotationSlot.findFirst({ where: { circleId, memberId: swap.requester.id } });
    const targetSlot = await tx.rotationSlot.findFirst({ where: { circleId, memberId: targetMember.id } });

    if (requesterSlot && targetSlot) {
      await tx.rotationSlot.update({ where: { id: requesterSlot.id }, data: { round: targetSlot.round } });
      await tx.rotationSlot.update({ where: { id: targetSlot.id }, data: { round: requesterSlot.round } });
    }

    // Approve swap
    await tx.swapRequest.update({
      where: { id: swapId },
      data: { status: 'APPROVED', approvedById: organizerId, approvedAt: new Date() },
    });

    // Notify both parties
    await tx.notification.create({
      data: {
        userId: swap.requester.userId,
        circleId,
        type: 'SWAP_APPROVED',
        title: 'Swap Approved!',
        body: `Your position swap to #${swap.requestedPosition} was approved.`,
      },
    });
    await tx.notification.create({
      data: {
        userId: targetMember.userId,
        circleId,
        type: 'SWAP_AFFECTED',
        title: 'Your Position Changed',
        body: `Your payout position was changed from #${targetOldPos} to #${requesterOldPos} due to an emergency swap.`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: organizerId,
        action: 'SWAP_APPROVED',
        entity: 'SwapRequest',
        entityId: swapId,
        metadata: { from: requesterOldPos, to: targetOldPos },
      },
    });
  });

  // Trust bonus to requester (community flexibility)
  await applyTrustEvent(swap.requester.userId, 'SWAP_GRANTED', circleId);

  logger.info('Swap approved', { swapId, circleId });
  return prisma.swapRequest.findUnique({ where: { id: swapId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// REJECT SWAP
// ─────────────────────────────────────────────────────────────────────────────

async function rejectSwap(circleId, swapId, organizerId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.organizerId !== organizerId) throw ApiError.forbidden('Only organizer can reject swaps.', 'NOT_ORGANIZER');

  const swap = await prisma.swapRequest.findUnique({ where: { id: swapId } });
  if (!swap || swap.circleId !== circleId) throw ApiError.notFound('Swap request not found.', 'SWAP_NOT_FOUND');
  if (swap.status !== 'PENDING') throw ApiError.conflict(`Swap is already ${swap.status}.`, 'SWAP_NOT_PENDING');

  await prisma.$transaction(async (tx) => {
    await tx.swapRequest.update({
      where: { id: swapId },
      data: { status: 'REJECTED', approvedById: organizerId, approvedAt: new Date() },
    });

    const requester = await tx.circleMember.findUnique({ where: { id: swap.requesterId } });
    if (requester) {
      await tx.notification.create({
        data: {
          userId: requester.userId,
          circleId,
          type: 'SWAP_REJECTED',
          title: 'Swap Request Declined',
          body: `Your position swap request was not approved by the organizer.`,
        },
      });
    }
  });

  return prisma.swapRequest.findUnique({ where: { id: swapId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// RELEASE PAYOUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Organizer manually releases the payout to the member scheduled for the
 * current round. Records double-entry ledger entry.
 */
async function releasePayout(circleId, targetMemberId, organizerId, notes) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: { members: { where: { status: 'ACTIVE' } } },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.organizerId !== organizerId) throw ApiError.forbidden('Only organizer can release payouts.', 'NOT_ORGANIZER');
  if (circle.status !== 'ACTIVE') throw ApiError.conflict('Circle is not active.', 'CIRCLE_NOT_ACTIVE');

  // Find current round's rotation slot
  const currentSlot = await prisma.rotationSlot.findUnique({
    where: { circleId_round: { circleId, round: circle.currentRound } },
  });
  if (!currentSlot) throw ApiError.notFound('Rotation slot not found for current round.', 'SLOT_NOT_FOUND');
  if (currentSlot.isPaid) throw ApiError.conflict('Payout for this round has already been released.', 'PAYOUT_ALREADY_RELEASED');
  if (currentSlot.memberId !== targetMemberId) {
    throw ApiError.badRequest(
      'The specified member is not scheduled to receive the payout this round.',
      'WRONG_PAYOUT_RECIPIENT'
    );
  }

  const recipient = await prisma.circleMember.findUnique({ where: { id: targetMemberId } });
  if (!recipient) throw ApiError.notFound('Member not found.', 'MEMBER_NOT_FOUND');

  // Calculate payout amount = contributionAmount × number of ACTIVE members
  const activeMembers = circle.members.filter((m) => m.status === 'ACTIVE').length;
  const payoutAmount = parseFloat(circle.contributionAmount) * activeMembers;
  const platformFee = payoutAmount * (env.PLATFORM_FEE_PERCENT / 100);
  const netPayout = payoutAmount - platformFee;

  const isLastRound = circle.currentRound === circle.totalRounds;
  const nextRound = circle.currentRound + 1;
  const nextPaymentDate = new Date();
  nextPaymentDate.setDate(nextPaymentDate.getDate() + circle.frequencyDays);

  await prisma.$transaction(async (tx) => {
    // Mark slot as paid
    await tx.rotationSlot.update({
      where: { id: currentSlot.id },
      data: { isPaid: true, payoutAmount: netPayout, payoutDate: new Date(), notes },
    });

    // Mark member as received
    await tx.circleMember.update({
      where: { id: targetMemberId },
      data: { hasReceived: true, receivedAt: new Date() },
    });

    // Record double-entry ledger entries
    const pool = await ledgerService.getCircleBalance(circleId, tx);

    // Platform fee entry
    if (platformFee > 0) {
      await ledgerService.recordPlatformFee(
        tx, circleId, null, platformFee, circle.currency,
        `Platform fee for round ${circle.currentRound} payout`
      );
    }

    // Payout entry
    await ledgerService.recordPayout(
      tx, circleId, null, netPayout, circle.currency,
      `Round ${circle.currentRound} payout to member ${targetMemberId}`
    );

    // Advance circle state
    if (isLastRound) {
      await tx.circle.update({ where: { id: circleId }, data: { status: 'COMPLETED', currentRound: nextRound } });
    } else {
      await tx.circle.update({
        where: { id: circleId },
        data: { currentRound: nextRound, nextPaymentDate },
      });

      // Schedule debits for the next round
      for (const member of circle.members) {
        if (member.status === 'ACTIVE') {
          await tx.scheduledDebit.create({
            data: {
              circleId,
              memberId: member.id,
              round: nextRound,
              amount: circle.contributionAmount,
              scheduledFor: nextPaymentDate,
              idempotencyKey: `circle-${circleId}-round-${nextRound}-member-${member.id}`,
            },
          });
        }
      }
    }

    // Notify recipient
    await tx.notification.create({
      data: {
        userId: recipient.userId,
        circleId,
        type: 'PAYOUT_RELEASED',
        title: 'You received your payout! 🎉',
        body: `${netPayout.toFixed(2)} ${circle.currency} has been released to you for round ${circle.currentRound}.`,
        metadata: { amount: netPayout, currency: circle.currency, round: circle.currentRound },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: organizerId,
        action: 'PAYOUT_RELEASED',
        entity: 'Circle',
        entityId: circleId,
        metadata: { round: circle.currentRound, amount: netPayout, recipientId: targetMemberId },
      },
    });
  });

  // Trust reward for recipient completing a round
  await applyTrustEvent(recipient.userId, 'ON_TIME_PAYMENT', circleId, { round: circle.currentRound, type: 'payout_received' });

  if (isLastRound) {
    // Bonus for completing the full circle
    for (const m of circle.members) {
      await applyTrustEvent(m.userId, 'CIRCLE_COMPLETED', circleId);
    }
    await applyTrustEvent(organizerId, 'ORGANIZER_BONUS', circleId);
    logger.info('Circle completed!', { circleId });
  }

  logger.info('Payout released', { circleId, round: circle.currentRound, amount: netPayout });
  return { round: circle.currentRound, amount: netPayout, currency: circle.currency, isLastRound };
}

module.exports = {
  getRotation,
  createSwapRequest,
  getSwapRequests,
  approveSwap,
  rejectSwap,
  releasePayout,
};