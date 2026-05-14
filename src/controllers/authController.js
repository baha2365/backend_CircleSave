const authService = require('../services/authService');
const { getQueueStatus } = require('../services/emailQueueService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

/** POST /api/v1/auth/register */
const register = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;
  const user = await authService.register({ email, username, password });
  ApiResponse.created(
    res,
    { user },
    'Registration successful. A 6-digit verification code has been sent to your email.'
  );
});

/** POST /api/v1/auth/verify-email */
const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const result = await authService.verifyEmail({ email, code });
  ApiResponse.success(res, null, result.message);
});

/** POST /api/v1/auth/resend-verification */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.resendVerificationCode({ email });
  ApiResponse.success(res, null, result.message);
});

/** POST /api/v1/auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const result = await authService.login({ email, password }, ip);
  ApiResponse.success(res, result, 'Login successful.');
});

/** POST /api/v1/auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await authService.refreshTokens(refreshToken);
  ApiResponse.success(res, tokens, 'Tokens refreshed successfully.');
});

/** POST /api/v1/auth/logout  (requires authentication) */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken, req.user.id);
  ApiResponse.success(res, null, 'Logged out successfully.');
});

/** POST /api/v1/auth/logout-all */
const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  ApiResponse.success(res, null, 'All sessions revoked.');
});

/** GET /api/v1/auth/me */
const me = asyncHandler(async (req, res) => {
  ApiResponse.success(res, { user: req.user }, 'Current user.');
});

/** POST /api/v1/auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.forgotPassword({ email });
  ApiResponse.success(res, null, result.message);
});

/** POST /api/v1/auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  ApiResponse.success(res, null, result.message);
});

/** GET /api/v1/auth/email-queue-status  (admin observability) */
const emailQueueStatus = asyncHandler(async (req, res) => {
  const status = await getQueueStatus();
  ApiResponse.success(res, status, 'Email queue status.');
});

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  forgotPassword,
  resetPassword,
  emailQueueStatus,
};