const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { applyTrustEvent } = require('./trustService');
const logger = require('../utils/logger');

async function getDashboard() {
  const [totalUsers, totalCircles, activeCircles, totalPayments, revenueResult] = await Promise.all([
    prisma.user.count(),
    prisma.circle.count(),
    prisma.circle.count({ where: { status: 'ACTIVE' } }),
    prisma.payment.count({ where: { status: 'COMPLETED' } }),
    prisma.ledgerEntry.aggregate({
      where: { type: 'PLATFORM_FEE' },
      _sum: { creditAmount: true },
    }),
  ]);

  return {
    totalUsers,
    totalCircles,
    activeCircles,
    completedCircles: await prisma.circle.count({ where: { status: 'COMPLETED' } }),
    totalPayments,
    totalRevenue: parseFloat(revenueResult._sum.creditAmount || 0),
    bannedUsers: await prisma.user.count({ where: { isBanned: true } }),
  };
}

async function listUsers({ cursor, limit = 20, role, search } = {}) {
  const take = Math.min(limit, 100);
  const where = {};
  if (role) where.role = role;
  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, email: true, username: true, role: true,
      trustScore: true, isActive: true, isBanned: true, bannedReason: true,
      createdAt: true,
      _count: { select: { memberships: true, organizedCircles: true } },
    },
  });

  const hasMore = users.length > take;
  const data = hasMore ? users.slice(0, take) : users;
  return { data, meta: { pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take } } };
}

async function getUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: { circle: { select: { id: true, name: true, status: true } } } },
      trustEvents: { orderBy: { createdAt: 'desc' }, take: 10 },
      _count: { select: { payments: true } },
    },
  });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');
  return user;
}

async function banUser(targetUserId, reason, adminId) {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');
  if (user.isBanned) throw ApiError.conflict('User is already banned.', 'USER_ALREADY_BANNED');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { isBanned: true, isActive: false, bannedReason: reason },
    });

    // Revoke all refresh tokens
    await tx.refreshToken.updateMany({
      where: { userId: targetUserId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: { userId: adminId, action: 'USER_BANNED', entity: 'User', entityId: targetUserId, metadata: { reason } },
    });
  });

  logger.info('User banned', { targetUserId, adminId, reason });
}

async function unbanUser(targetUserId, adminId) {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');
  if (!user.isBanned) throw ApiError.conflict('User is not banned.', 'USER_NOT_BANNED');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { isBanned: false, isActive: true, bannedReason: null },
    });
    await tx.auditLog.create({
      data: { userId: adminId, action: 'USER_UNBANNED', entity: 'User', entityId: targetUserId },
    });
  });

  logger.info('User unbanned', { targetUserId, adminId });
}

async function setRole(targetUserId, role, adminId) {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetUserId }, data: { role } });
    await tx.auditLog.create({
      data: { userId: adminId, action: 'USER_ROLE_CHANGED', entity: 'User', entityId: targetUserId, metadata: { oldRole: user.role, newRole: role } },
    });
  });
}

async function listAllCircles({ cursor, limit = 20, status } = {}) {
  const take = Math.min(limit, 100);
  const where = {};
  if (status) where.status = status;

  const circles = await prisma.circle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      organizer: { select: { id: true, username: true } },
      _count: { select: { members: true, payments: true } },
    },
  });

  const hasMore = circles.length > take;
  const data = hasMore ? circles.slice(0, take) : circles;
  return { data, meta: { pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take } } };
}

async function getAuditLogs({ cursor, limit = 50, action, entity, userId } = {}) {
  const take = Math.min(limit, 200);
  const where = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { id: true, username: true, email: true } } },
  });

  const hasMore = logs.length > take;
  const data = hasMore ? logs.slice(0, take) : logs;
  return { data, meta: { pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take } } };
}

module.exports = { getDashboard, listUsers, getUser, banUser, unbanUser, setRole, listAllCircles, getAuditLogs };