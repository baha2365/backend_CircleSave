const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { generateDeterministicOrder } = require('./rotationService');
const { applyTrustDelta } = require('./trustService');
const logger = require('../utils/logger');

/**
 * Create a new savings circle (ORGANIZER role required).
 */
async function createCircle(organizerId, { name, description, amount, duration, maxMembers }) {
  // Enforce max circles per user limit
  const activeCircles = await prisma.circle.count({
    where: {
      ownerId: organizerId,
      status: { in: ['DRAFT', 'ACTIVE'] },
    },
  });

  if (activeCircles >= CONSTANTS.MAX_CIRCLES_PER_USER) {
    throw ApiError.badRequest(
      `Maximum ${CONSTANTS.MAX_CIRCLES_PER_USER} active circles per user.`,
      'CIRCLE_LIMIT_EXCEEDED'
    );
  }

  const circle = await prisma.$transaction(async (tx) => {
    const c = await tx.circle.create({
      data: {
        ownerId: organizerId,
        name,
        description,
        amount,
        duration,
        maxMembers: maxMembers || CONSTANTS.MAX_MEMBERS_PER_CIRCLE,
        status: 'DRAFT',
      },
    });

    // Add organizer as first member automatically
    await tx.circleMember.create({
      data: {
        userId: organizerId,
        circleId: c.id,
        payoutOrder: 1,
        status: 'APPROVED',
      },
    });

    await tx.auditLog.create({
      data: {
        userId: organizerId,
        action: 'CIRCLE_CREATED',
        entity: 'Circle',
        entityId: c.id,
        metadata: { name, amount: String(amount), duration },
      },
    });

    return c;
  });

  logger.info('Circle created', { circleId: circle.id, organizerId });
  return circle;
}

/**
 * Join a circle via invite code.
 */
async function joinCircle(userId, inviteCode) {
  const circle = await prisma.circle.findUnique({ where: { inviteCode } });
  if (!circle) throw ApiError.notFound('Invalid invite code.', 'INVITE_CODE_INVALID');
  if (circle.status !== 'DRAFT') throw ApiError.badRequest('Circle is no longer accepting new members.', 'CIRCLE_NOT_ACCEPTING');

  // Check user not already a member
  const existing = await prisma.circleMember.findFirst({
    where: { userId, circleId: circle.id },
  });
  if (existing) throw ApiError.conflict('You are already in this circle.', 'ALREADY_A_MEMBER');

  // Check capacity
  const memberCount = await prisma.circleMember.count({
    where: { circleId: circle.id, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (memberCount >= circle.maxMembers) throw ApiError.badRequest('Circle is full.', 'CIRCLE_FULL');

  // Check trust score
  const { isEligibleToJoin, hasCrossCircleDefault } = require('./trustService');
  const { eligible, reason } = await isEligibleToJoin(userId);
  if (!eligible) throw ApiError.forbidden(reason, 'TRUST_SCORE_TOO_LOW');

  const hasDefault = await hasCrossCircleDefault(userId);
  if (hasDefault) throw ApiError.forbidden('You have an outstanding default in another circle.', 'CROSS_CIRCLE_DEFAULT');

  const membership = await prisma.circleMember.create({
    data: {
      userId,
      circleId: circle.id,
      payoutOrder: memberCount + 1, // tentative order, recalculated on activation
      status: 'PENDING',
    },
  });

  logger.info('Member joined circle', { userId, circleId: circle.id });
  return { membership, circle };
}

/**
 * Organizer approves a pending membership.
 */
async function approveMember(circleId, memberId, organizerId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.ownerId !== organizerId) throw ApiError.forbidden('Only the organizer can approve members.', 'NOT_ORGANIZER');
  if (circle.status !== 'DRAFT') throw ApiError.badRequest('Circle is not in DRAFT status.', 'CIRCLE_NOT_DRAFT');

  const member = await prisma.circleMember.findUnique({ where: { id: memberId } });
  if (!member || member.circleId !== circleId) throw ApiError.notFound('Member not found.', 'MEMBER_NOT_FOUND');
  if (member.status !== 'PENDING') throw ApiError.badRequest('Member is not in PENDING status.', 'MEMBER_NOT_PENDING');

  const updated = await prisma.circleMember.update({
    where: { id: memberId },
    data: { status: 'APPROVED' },
    include: { user: { select: { id: true, username: true, email: true } } },
  });

  // Notify member
  await prisma.notification.create({
    data: {
      userId: member.userId,
      type: 'MEMBER_APPROVED',
      title: 'Circle Membership Approved',
      message: `You have been approved to join circle "${circle.name}".`,
      metadata: { circleId },
    },
  });

  return updated;
}

/**
 * Organizer rejects a pending membership.
 */
async function rejectMember(circleId, memberId, organizerId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.ownerId !== organizerId) throw ApiError.forbidden('Only the organizer can reject members.', 'NOT_ORGANIZER');

  const member = await prisma.circleMember.findUnique({ where: { id: memberId } });
  if (!member || member.circleId !== circleId) throw ApiError.notFound('Member not found.', 'MEMBER_NOT_FOUND');

  const updated = await prisma.circleMember.update({
    where: { id: memberId },
    data: { status: 'REJECTED' },
  });

  await prisma.notification.create({
    data: {
      userId: member.userId,
      type: 'MEMBER_REJECTED',
      title: 'Circle Application Rejected',
      message: `Your application to join circle "${circle.name}" was not approved.`,
      metadata: { circleId },
    },
  });

  return updated;
}

/**
 * Activate a circle: freeze membership, assign deterministic payout order,
 * generate payment schedules for all cycles.
 */
async function activateCircle(circleId, organizerId, { randomizeOrder = false } = {}) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: { members: { where: { status: 'APPROVED' }, include: { user: true } } },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.ownerId !== organizerId) throw ApiError.forbidden('Only the organizer can activate the circle.', 'NOT_ORGANIZER');
  if (circle.status !== 'DRAFT') throw ApiError.badRequest('Circle must be in DRAFT status to activate.', 'CIRCLE_NOT_DRAFT');

  const approvedMembers = circle.members;
  if (approvedMembers.length < CONSTANTS.MIN_MEMBERS_PER_CIRCLE) {
    throw ApiError.badRequest(
      `Minimum ${CONSTANTS.MIN_MEMBERS_PER_CIRCLE} approved members required.`,
      'INSUFFICIENT_MEMBERS'
    );
  }

  const { shuffleOrder } = require('./rotationService');
  const memberIds = approvedMembers.map((m) => m.userId);
  const orderedIds = randomizeOrder ? shuffleOrder(memberIds) : generateDeterministicOrder(memberIds);

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + circle.duration);

  await prisma.$transaction(async (tx) => {
    // Update payout orders
    for (let i = 0; i < orderedIds.length; i++) {
      const member = approvedMembers.find((m) => m.userId === orderedIds[i]);
      await tx.circleMember.update({
        where: { id: member.id },
        data: { payoutOrder: i + 1 },
      });
    }

    // Generate payment schedules (one per cycle/month)
    const scheduleData = [];
    for (let cycle = 1; cycle <= circle.duration; cycle++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + cycle);

      // Recipient for this cycle = member with payoutOrder === cycle
      const recipientIndex = (cycle - 1) % approvedMembers.length;
      const recipientMember = approvedMembers.find(
        (m) => m.userId === orderedIds[recipientIndex]
      );

      scheduleData.push({
        circleId,
        dueDate,
        cycleNumber: cycle,
        payoutToId: recipientMember?.id || null,
      });
    }

    await tx.paymentSchedule.createMany({ data: scheduleData });

    // Activate circle
    await tx.circle.update({
      where: { id: circleId },
      data: { status: 'ACTIVE', startDate, endDate, currentCycle: 1 },
    });

    await tx.auditLog.create({
      data: {
        userId: organizerId,
        action: 'CIRCLE_ACTIVATED',
        entity: 'Circle',
        entityId: circleId,
        metadata: { memberCount: approvedMembers.length, duration: circle.duration },
      },
    });
  });

  logger.info('Circle activated', { circleId, memberCount: approvedMembers.length });
  return prisma.circle.findUnique({
    where: { id: circleId },
    include: { members: { include: { user: { select: { id: true, username: true } } } } },
  });
}

/**
 * Dissolve a circle (admin or organizer).
 */
async function dissolveCircle(circleId, userId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.status === 'COMPLETED' || circle.status === 'DISSOLVED') {
    throw ApiError.badRequest('Circle is already closed.', 'CIRCLE_ALREADY_CLOSED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.circle.update({
      where: { id: circleId },
      data: { status: 'DISSOLVED' },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CIRCLE_DISSOLVED',
        entity: 'Circle',
        entityId: circleId,
      },
    });
  });

  logger.info('Circle dissolved', { circleId, userId });
}

/**
 * Get circle detail with members.
 */
async function getCircle(circleId, requesterId) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      owner: { select: { id: true, username: true, email: true } },
      members: {
        where: { status: { not: 'REJECTED' } },
        include: { user: { select: { id: true, username: true, trustScore: true } } },
        orderBy: { payoutOrder: 'asc' },
      },
    },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  // Verify requester is a member or admin
  const isMember = circle.members.some((m) => m.userId === requesterId);
  const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { role: true } });
  if (!isMember && requester?.role !== 'ADMIN') {
    throw ApiError.forbidden('You are not a member of this circle.', 'NOT_A_MEMBER');
  }

  return circle;
}

/**
 * List circles accessible to a user (paginated).
 */
async function listUserCircles(userId, { cursor, limit } = {}) {
  const { buildCursorArgs, buildPaginationMeta } = require('../utils/pagination');
  const { args, take } = buildCursorArgs({ cursor, limit });

  const circles = await prisma.circle.findMany({
    ...args,
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId, status: 'APPROVED' } } },
      ],
    },
    include: {
      owner: { select: { id: true, username: true } },
      _count: { select: { members: { where: { status: 'APPROVED' } } } },
    },
  });

  return buildPaginationMeta(circles, take);
}

module.exports = {
  createCircle,
  joinCircle,
  approveMember,
  rejectMember,
  activateCircle,
  dissolveCircle,
  getCircle,
  listUserCircles,
};