const adminService = require('../services/adminService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboard();
  ApiResponse.success(res, stats);
});

const listUsers = asyncHandler(async (req, res) => {
  const { cursor, limit, role, search } = req.query;
  const result = await adminService.listUsers({ cursor, limit: Number(limit) || 20, role, search });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUser(req.params.id);
  ApiResponse.success(res, { user });
});

const banUser = asyncHandler(async (req, res) => {
  await adminService.banUser(req.params.id, req.body.reason, req.user.id);
  ApiResponse.success(res, null, 'User banned.');
});

const unbanUser = asyncHandler(async (req, res) => {
  await adminService.unbanUser(req.params.id, req.user.id);
  ApiResponse.success(res, null, 'User unbanned.');
});

const setRole = asyncHandler(async (req, res) => {
  await adminService.setRole(req.params.id, req.body.role, req.user.id);
  ApiResponse.success(res, null, 'Role updated.');
});

const listAllCircles = asyncHandler(async (req, res) => {
  const { cursor, limit, status } = req.query;
  const result = await adminService.listAllCircles({ cursor, limit: Number(limit) || 20, status });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const getAuditLogs = asyncHandler(async (req, res) => {
  const { cursor, limit, action, entity, userId } = req.query;
  const result = await adminService.getAuditLogs({ cursor, limit: Number(limit) || 50, action, entity, userId });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

module.exports = { getDashboard, listUsers, getUser, banUser, unbanUser, setRole, listAllCircles, getAuditLogs };