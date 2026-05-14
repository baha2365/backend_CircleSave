const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../utils/schemas');
const {
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
} = require('../controllers/authController');

// ── Public routes (rate limited) ───────────────────────────────────────────

/** Register → triggers verification email */
router.post('/register', authRateLimiter, validate({ body: registerSchema }), register);

/** Submit the 6-digit code from the verification email */
router.post('/verify-email', authRateLimiter, validate({ body: verifyEmailSchema }), verifyEmail);

/** Request a new verification code (if the old one expired) */
router.post('/resend-verification', authRateLimiter, validate({ body: resendVerificationSchema }), resendVerification);

/** Login — blocked if email not verified */
router.post('/login', authRateLimiter, validate({ body: loginSchema }), login);

/** Refresh access token */
router.post('/refresh', validate({ body: refreshSchema }), refresh);

/** Request a password reset code via email */
router.post('/forgot-password', authRateLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);

/** Submit reset code + new password */
router.post('/reset-password', authRateLimiter, validate({ body: resetPasswordSchema }), resetPassword);

// ── Protected routes (require valid token + verified email) ────────────────

router.post('/logout', authenticate, validate({ body: logoutSchema }), logout);
router.post('/logout-all', authenticate, logoutAll);
router.get('/me', authenticate, me);

// ── Admin observability ────────────────────────────────────────────────────

/** View BullMQ email queue stats (waiting / active / completed / failed) */
router.get('/email-queue-status', authenticate, requireRole('ADMIN'), emailQueueStatus);

module.exports = router;