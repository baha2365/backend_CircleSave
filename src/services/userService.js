const { prisma } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { getTrustHistory, getTrustTier } = require('./trustService');

async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, username: true, role: true,
      trustScore: true, phone: true, avatarUrl: true,
      isActive: true, createdAt: true,
      _count: { select: { memberships: true, organizedCircles: true } },
    },
  });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');
  return { ...user, trustTier: getTrustTier(user.trustScore) };
}

async function updateMe(userId, data) {
  const { username, phone, avatarUrl } = data;

  if (username) {
    const existing = await prisma.user.findFirst({ where: { username, id: { not: userId } } });
    if (existing) throw ApiError.conflict('Username already taken.', 'USERNAME_TAKEN');
  }

  return prisma.user.update({
    where: { id: userId },
    data: { ...(username && { username }), ...(phone && { phone }), ...(avatarUrl && { avatarUrl }) },
    select: { id: true, email: true, username: true, role: true, trustScore: true, phone: true, avatarUrl: true },
  });
}

async function getMyTrustHistory(userId, query) {
  return getTrustHistory(userId, query);
}

async function getMyNotifications(userId, { cursor, limit = 20, unreadOnly } = {}) {
  const take = Math.min(limit, 50);
  const where = { userId };
  if (unreadOnly === 'true') where.isRead = false;

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = notifications.length > take;
  const data = hasMore ? notifications.slice(0, take) : notifications;

  return {
    data,
    meta: { pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1].id : null, limit: take } },
  };
}

async function markNotificationsRead(userId) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { markedRead: count };
}

module.exports = { getMe, updateMe, getMyTrustHistory, getMyNotifications, markNotificationsRead };