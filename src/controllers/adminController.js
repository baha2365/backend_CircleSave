const { prisma } = require('../config/database');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { buildCursorArgs, buildPaginationMeta } = require('../utils/pagination');

const listUsers = asyncHandler(async (req, res) => {
  const { cursor, limit, role } = req.query;
  const { args, take } = buildCursorArgs({ cursor, limit });
  const where = role ? { role } : {};
  const users = await prisma.user.findMany({
    ...args,
    where,
    select: { id: true, email: true, username: true, role: true, trustScore: true, isBanned: true, createdAt: true },
  });
  const { data, pagination } = buildPaginationMeta(users, take);
  ApiResponse.paginated(res, data, pagination);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, username: true, role: true, trustScore: true, isBanned: true, bannedReason: true, createdAt: true },
  });
  if (!user) throw ApiError.notFound('User not found.', 'USER_NOT_FOUND');
  ApiResponse.success(res, { user });
});

const banUser = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isBanned: true, bannedReason: reason },
    select: { id: true, email: true, isBanned: true, bannedReason: true },
  });
  await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: 'USER_BANNED',
      entity: 'User',
      entityId: req.params.id,
      metadata: { reason },
    },
  });
  ApiResponse.success(res, { user }, 'User banned.');
});

const unbanUser = asyncHandler(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isBanned: false, bannedReason: null },
    select: { id: true, email: true, isBanned: true },
  });
  ApiResponse.success(res, { user }, 'User unbanned.');
});

const setRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const valid = ['MEMBER', 'ORGANIZER', 'ADMIN'];
  if (!valid.includes(role)) throw ApiError.badRequest(`Role must be one of: ${valid.join(', ')}`, 'INVALID_ROLE');
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, email: true, role: true },
  });
  ApiResponse.success(res, { user }, 'Role updated.');
});

const getAuditLogs = asyncHandler(async (req, res) => {
  const { cursor, limit, entity, action } = req.query;
  const { args, take } = buildCursorArgs({ cursor, limit });
  const where = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;
  const logs = await prisma.auditLog.findMany({ ...args, where });
  const { data, pagination } = buildPaginationMeta(logs, take);
  ApiResponse.paginated(res, data, pagination);
});

const listAllCircles = asyncHandler(async (req, res) => {
  const { cursor, limit, status } = req.query;
  const { args, take } = buildCursorArgs({ cursor, limit });
  const where = status ? { status } : {};
  const circles = await prisma.circle.findMany({
    ...args,
    where,
    include: { owner: { select: { id: true, username: true } }, _count: { select: { members: true } } },
  });
  const { data, pagination } = buildPaginationMeta(circles, take);
  ApiResponse.paginated(res, data, pagination);
});

const getDashboard = asyncHandler(async (req, res) => {
  const [totalUsers, totalCircles, totalPayments, defaultedPayments] = await Promise.all([
    prisma.user.count(),
    prisma.circle.count(),
    prisma.payment.count(),
    prisma.payment.count({ where: { status: 'DEFAULTED' } }),
  ]);

  ApiResponse.success(res, {
    stats: { totalUsers, totalCircles, totalPayments, defaultedPayments },
  });
});

module.exports = { listUsers, getUser, banUser, unbanUser, setRole, getAuditLogs, listAllCircles, getDashboard };