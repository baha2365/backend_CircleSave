const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { applyTrustEvent } = require('./trustService');
const env = require('../config/env');

// ─────────────────────────────────────────────────────────────────────────────
// CREATE CIRCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ANY authenticated user can create a circle.
 *
 * The user who creates the circle becomes its organizer — this is tracked via
 * circle.organizerId, NOT via a global role change on the User record.
 *
 * This means:
 *   - User A creates Circle X  → A is the organizer of X only
 *   - User A joins Circle Y    → A is just a regular member of Y
 *   - User B joins Circle X    → B is a regular member of X
 *
 * The organizer can approve/reject members, activate, dissolve, and release
 * payouts for their own circles. They have no special power over other circles.
 */
async function createCircle(userId, data) {
  const { name, description, contributionAmount, currency, maxMembers, frequencyDays, startDate } = data;

  // Enforce per-user circle limit
  const activeCount = await prisma.circle.count({
    where: { organizerId: userId, status: { in: ['PENDING', 'ACTIVE'] } },
  });

  if (activeCount >= env.MAX_CIRCLES_PER_USER) {
    throw ApiError.conflict(
      `You have reached the maximum of ${env.MAX_CIRCLES_PER_USER} active circles as organizer.`,
      'CIRCLE_LIMIT_EXCEEDED'
    );
  }

  const circle = await prisma.$transaction(async (tx) => {
    // Create the circle — the caller becomes its organizer
    const c = await tx.circle.create({
      data: {
        name,
        description,
        contributionAmount,
        currency: currency || 'USD',
        maxMembers,
        frequencyDays,
        organizerId: userId,   // ← creator is organizer, tracked per-circle only
        totalRounds: maxMembers,
        startDate: startDate ? new Date(startDate) : null,
        currentMembers: 1,
      },
    });

    // Auto-enroll the creator as the first APPROVED member
    await tx.circleMember.create({
      data: {
        circleId: c.id,
        userId,
        status: 'APPROVED',
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CIRCLE_CREATED',
        entity: 'Circle',
        entityId: c.id,
        metadata: { name, maxMembers, contributionAmount },
      },
    });

    return c;
  });

  logger.info('Circle created', { circleId: circle.id, organizerId: userId });
  return circle;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER — is the caller the organizer of this circle OR a global admin?
// ─────────────────────────────────────────────────────────────────────────────

async function isOrganizerOrAdmin(circle, userId) {
  if (circle.organizerId === userId) return true;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === 'ADMIN';
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST MY CIRCLES
// ─────────────────────────────────────────────────────────────────────────────

async function listMyCircles(userId, { cursor, limit = 20 } = {}) {
  const take = Math.min(limit, 50);

  const memberships = await prisma.circleMember.findMany({
    where: { userId, status: { in: ['APPROVED', 'ACTIVE', 'PENDING'] } },
    select: { circleId: true },
  });
  const memberCircleIds = memberships.map((m) => m.circleId);

  const circles = await prisma.circle.findMany({
    where: {
      OR: [{ organizerId: userId }, { id: { in: memberCircleIds } }],
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      organizer: { select: { id: true, username: true, trustScore: true } },
      _count: { select: { members: true } },
    },
  });

  const hasMore = circles.length > take;
  const data = hasMore ? circles.slice(0, take) : circles;

  // Tell the frontend whether the current user is the organizer of each circle
  const annotated = data.map((c) => ({
    ...c,
    isOrganizer: c.organizerId === userId,
  }));

  return {
    data: annotated,
    meta: {
      pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOIN CIRCLE
// ─────────────────────────────────────────────────────────────────────────────

async function joinCircle(userId, inviteCode) {
  const circle = await prisma.circle.findUnique({
    where: { inviteCode },
    include: {
      _count: {
        select: { members: { where: { status: { in: ['APPROVED', 'ACTIVE', 'PENDING'] } } } },
      },
    },
  });

  if (!circle) {
    throw ApiError.notFound('Circle not found. Check your invite code.', 'CIRCLE_NOT_FOUND');
  }

  if (circle.status !== 'PENDING') {
    throw ApiError.conflict('This circle is no longer accepting new members.', 'CIRCLE_NOT_ACCEPTING');
  }

  if (circle._count.members >= circle.maxMembers) {
    throw ApiError.conflict('This circle is full.', 'CIRCLE_FULL');
  }

  // The organizer is already enrolled on creation — block them from joining again
  if (circle.organizerId === userId) {
    throw ApiError.conflict(
      'You are the organizer of this circle and are already enrolled.',
      'CIRCLE_ALREADY_MEMBER'
    );
  }

  const existing = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId: circle.id, userId } },
  });

  if (existing) {
    if (existing.status === 'REJECTED') {
      throw ApiError.forbidden('Your application was previously rejected.', 'CIRCLE_MEMBER_REJECTED');
    }
    throw ApiError.conflict('You are already a member of this circle.', 'CIRCLE_ALREADY_MEMBER');
  }

  const member = await prisma.$transaction(async (tx) => {
    const m = await tx.circleMember.create({
      data: { circleId: circle.id, userId, status: 'PENDING' },
    });

    // Notify the organizer
    await tx.notification.create({
      data: {
        userId: circle.organizerId,
        circleId: circle.id,
        type: 'MEMBER_JOIN_REQUEST',
        title: 'New Join Request',
        body: `A new member has requested to join "${circle.name}". Review and approve.`,
        metadata: { memberId: m.id, userId },
      },
    });

    return m;
  });

  logger.info('User requested to join circle', { userId, circleId: circle.id });
  return { member, circle: { id: circle.id, name: circle.name } };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET CIRCLE
// ─────────────────────────────────────────────────────────────────────────────

async function getCircle(circleId, userId) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      organizer: { select: { id: true, username: true, trustScore: true } },
      members: {
        where: { status: { not: 'REJECTED' } },
        include: { user: { select: { id: true, username: true, trustScore: true } } },
        orderBy: { position: 'asc' },
      },
      rotationSlots: { orderBy: { round: 'asc' } },
      _count: { select: { payments: true } },
    },
  });

  if (!circle) {
    throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  }

  const isMember = circle.members.some((m) => m.userId === userId);
  const isOrganizer = circle.organizerId === userId;

  if (!isMember && !isOrganizer) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'ADMIN') {
      throw ApiError.forbidden('You do not have access to this circle.', 'CIRCLE_ACCESS_DENIED');
    }
  }

  return { ...circle, isOrganizer };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE CIRCLE
// ─────────────────────────────────────────────────────────────────────────────

async function activateCircle(circleId, userId, startDate) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      members: {
        where: { status: 'APPROVED' },
        orderBy: { joinedAt: 'asc' }, // deterministic order = join time
      },
    },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  if (!(await isOrganizerOrAdmin(circle, userId))) {
    throw ApiError.forbidden(
      'Only the circle organizer can activate this circle.',
      'NOT_CIRCLE_ORGANIZER'
    );
  }

  if (circle.status !== 'PENDING') {
    throw ApiError.conflict(`Circle is already ${circle.status}.`, 'CIRCLE_NOT_PENDING');
  }

  if (circle.members.length < 2) {
    throw ApiError.badRequest(
      'Circle needs at least 2 approved members to activate.',
      'CIRCLE_INSUFFICIENT_MEMBERS'
    );
  }

  const activationDate = startDate ? new Date(startDate) : new Date();
  const nextPaymentDate = new Date(activationDate);
  nextPaymentDate.setDate(nextPaymentDate.getDate() + circle.frequencyDays);

  await prisma.$transaction(async (tx) => {
    await tx.circle.update({
      where: { id: circleId },
      data: {
        status: 'ACTIVE',
        startDate: activationDate,
        nextPaymentDate,
        currentRound: 1,
        totalRounds: circle.members.length,
        currentMembers: circle.members.length,
      },
    });

    // Assign positions in join-date order (deterministic rotation)
    for (let i = 0; i < circle.members.length; i++) {
      await tx.circleMember.update({
        where: { id: circle.members[i].id },
        data: { status: 'ACTIVE', position: i + 1 },
      });
    }

    // Create one RotationSlot per round
    for (let round = 1; round <= circle.members.length; round++) {
      const recipient = circle.members[round - 1];
      await tx.rotationSlot.create({
        data: { circleId, round, memberId: recipient.id },
      });
    }

    // Schedule debits for round 1
    for (const member of circle.members) {
      await tx.scheduledDebit.create({
        data: {
          circleId,
          memberId: member.id,
          round: 1,
          amount: circle.contributionAmount,
          scheduledFor: nextPaymentDate,
          idempotencyKey: `circle-${circleId}-round-1-member-${member.id}`,
        },
      });
    }

    // Notify all members
    for (const member of circle.members) {
      await tx.notification.create({
        data: {
          userId: member.userId,
          circleId,
          type: 'CIRCLE_ACTIVATED',
          title: `${circle.name} is now active!`,
          body: `Your circle has started. First payment due: ${nextPaymentDate.toLocaleDateString()}. Your payout position: #${member.position + 1}`,
          metadata: { round: 1, dueDate: nextPaymentDate },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CIRCLE_ACTIVATED',
        entity: 'Circle',
        entityId: circleId,
        metadata: { memberCount: circle.members.length, startDate: activationDate },
      },
    });
  });

  logger.info('Circle activated', { circleId, memberCount: circle.members.length });
  return prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      rotationSlots: true,
      members: { include: { user: { select: { id: true, username: true } } } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DISSOLVE CIRCLE
// ─────────────────────────────────────────────────────────────────────────────

async function dissolveCircle(circleId, userId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  if (!(await isOrganizerOrAdmin(circle, userId))) {
    throw ApiError.forbidden(
      'Only the circle organizer can dissolve this circle.',
      'NOT_CIRCLE_ORGANIZER'
    );
  }

  if (circle.status === 'COMPLETED' || circle.status === 'DISSOLVED') {
    throw ApiError.conflict(`Circle is already ${circle.status}.`, 'CIRCLE_ALREADY_ENDED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.circle.update({ where: { id: circleId }, data: { status: 'DISSOLVED' } });

    await tx.scheduledDebit.updateMany({
      where: { circleId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });

    const members = await tx.circleMember.findMany({
      where: { circleId, status: 'ACTIVE' },
      select: { userId: true },
    });

    for (const m of members) {
      await tx.notification.create({
        data: {
          userId: m.userId,
          circleId,
          type: 'CIRCLE_DISSOLVED',
          title: 'Circle Dissolved',
          body: `The circle "${circle.name}" has been dissolved by the organizer.`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CIRCLE_DISSOLVED',
        entity: 'Circle',
        entityId: circleId,
      },
    });
  });

  await applyTrustEvent(userId, 'CIRCLE_DISSOLVED', circleId, { reason: 'organizer_dissolved' });
  logger.info('Circle dissolved', { circleId, userId });
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE / REJECT MEMBER
// ─────────────────────────────────────────────────────────────────────────────

async function approveMember(circleId, memberId, userId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  if (!(await isOrganizerOrAdmin(circle, userId))) {
    throw ApiError.forbidden(
      'Only the circle organizer can approve members.',
      'NOT_CIRCLE_ORGANIZER'
    );
  }

  if (circle.status !== 'PENDING') {
    throw ApiError.conflict('Cannot approve members after circle activation.', 'CIRCLE_NOT_PENDING');
  }

  const member = await prisma.circleMember.findFirst({ where: { id: memberId, circleId } });
  if (!member) throw ApiError.notFound('Member not found.', 'MEMBER_NOT_FOUND');
  if (member.status !== 'PENDING') {
    throw ApiError.conflict(`Member is already ${member.status}.`, 'MEMBER_NOT_PENDING');
  }

  const approvedCount = await prisma.circleMember.count({
    where: { circleId, status: 'APPROVED' },
  });
  if (approvedCount >= circle.maxMembers) {
    throw ApiError.conflict('Circle is already full.', 'CIRCLE_FULL');
  }

  await prisma.$transaction(async (tx) => {
    await tx.circleMember.update({ where: { id: memberId }, data: { status: 'APPROVED' } });
    await tx.circle.update({
      where: { id: circleId },
      data: { currentMembers: { increment: 1 } },
    });
    await tx.notification.create({
      data: {
        userId: member.userId,
        circleId,
        type: 'MEMBER_APPROVED',
        title: 'Application Approved!',
        body: `You have been approved to join "${circle.name}".`,
      },
    });
  });

  logger.info('Member approved', { memberId, circleId });
  return prisma.circleMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, username: true } } },
  });
}

async function rejectMember(circleId, memberId, userId) {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');

  if (!(await isOrganizerOrAdmin(circle, userId))) {
    throw ApiError.forbidden(
      'Only the circle organizer can reject members.',
      'NOT_CIRCLE_ORGANIZER'
    );
  }

  const member = await prisma.circleMember.findFirst({ where: { id: memberId, circleId } });
  if (!member) throw ApiError.notFound('Member not found.', 'MEMBER_NOT_FOUND');
  if (member.status !== 'PENDING') {
    throw ApiError.conflict(`Member is already ${member.status}.`, 'MEMBER_NOT_PENDING');
  }

  await prisma.$transaction(async (tx) => {
    await tx.circleMember.update({ where: { id: memberId }, data: { status: 'REJECTED' } });
    await tx.notification.create({
      data: {
        userId: member.userId,
        circleId,
        type: 'MEMBER_REJECTED',
        title: 'Application Not Approved',
        body: `Your request to join "${circle.name}" was not approved.`,
      },
    });
  });

  logger.info('Member rejected', { memberId, circleId });
}

module.exports = {
  createCircle,
  listMyCircles,
  joinCircle,
  getCircle,
  activateCircle,
  dissolveCircle,
  approveMember,
  rejectMember,
};