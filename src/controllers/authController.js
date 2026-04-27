const authService = require('../services/authService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

/**
 * POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;
  const user = await authService.register({ email, username, password });
  ApiResponse.created(res, { user }, 'Registration successful. Please log in.');
});

/**
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const result = await authService.login({ email, password }, ip);
  ApiResponse.success(res, result, 'Login successful.');
});

/**
 * POST /api/v1/auth/refresh
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await authService.refreshTokens(refreshToken);
  ApiResponse.success(res, tokens, 'Tokens refreshed successfully.');
});

/**
 * POST /api/v1/auth/logout
 * Requires authentication
 */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken, req.user.id);
  ApiResponse.success(res, null, 'Logged out successfully.');
});

/**
 * POST /api/v1/auth/logout-all
 * Revokes all refresh tokens for the user
 */
const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  ApiResponse.success(res, null, 'All sessions revoked.');
});

/**
 * GET /api/v1/auth/me
 */
const me = asyncHandler(async (req, res) => {
  ApiResponse.success(res, { user: req.user }, 'Current user.');
});

module.exports = { register, login, refresh, logout, logoutAll, me };