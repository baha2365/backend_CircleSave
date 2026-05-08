const userService = require('../services/userService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getMe = asyncHandler(async (req, res) => {
  const user = await userService.getMe(req.user.id);
  ApiResponse.success(res, { user });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await userService.updateMe(req.user.id, req.body);
  ApiResponse.success(res, { user }, 'Profile updated.');
});

const getMyTrustHistory = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const result = await userService.getMyTrustHistory(req.user.id, { cursor, limit: Number(limit) || 20 });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const getMyNotifications = asyncHandler(async (req, res) => {
  const { cursor, limit, unreadOnly } = req.query;
  const result = await userService.getMyNotifications(req.user.id, { cursor, limit: Number(limit) || 20, unreadOnly });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  const result = await userService.markNotificationsRead(req.user.id);
  ApiResponse.success(res, result, 'All notifications marked as read.');
});

module.exports = { getMe, updateMe, getMyTrustHistory, getMyNotifications, markNotificationsRead };