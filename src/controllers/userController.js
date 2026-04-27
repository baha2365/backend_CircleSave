const { prisma } = require('../config/database');
const { getTrustHistory } = require('../services/trustService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const getMe = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      trustScore: true,
      isActive: true,
      createdAt: true,
      _count: { select: { memberships: true, ownedCircles: true } },
    },
  });
  ApiResponse.success(res, { user });
});

const updateMe = asyncHandler(async (req, res) => {
  const { username } = req.body;

  // Check uniqueness
  if (username) {
    const existing = await prisma.user.findFirst({
      where: { username, NOT: { id: req.user.id } },
    });
    if (existing) throw ApiError.conflict('Username already taken.', 'USERNAME_TAKEN');
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { ...(username && { username }) },
    select: { id: true, email: true, username: true, role: true, trustScore: true },
  });
  ApiResponse.success(res, { user }, 'Profile updated.');
});

const getMyTrustHistory = asyncHandler(async (req, res) => {
  const events = await getTrustHistory(req.user.id);
  ApiResponse.success(res, { events });
});

const getMyNotifications = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const { buildCursorArgs, buildPaginationMeta } = require('../utils/pagination');
  const { args, take } = buildCursorArgs({ cursor, limit });

  const notifications = await prisma.notification.findMany({
    ...args,
    where: { userId: req.user.id },
  });

  const { data, pagination } = buildPaginationMeta(notifications, take);
  ApiResponse.paginated(res, data, pagination);
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });
  ApiResponse.success(res, null, 'All notifications marked as read.');
});

module.exports = { getMe, updateMe, getMyTrustHistory, getMyNotifications, markNotificationsRead };