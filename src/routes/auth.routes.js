const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} = require('../utils/schemas');
const { register, login, refresh, logout, logoutAll, me } = require('../controllers/authController');

/**
 * @swagger POST /auth/register
 * Rate limited: 5 per minute per IP
 */
router.post('/register', authRateLimiter, validate({ body: registerSchema }), register);

/**
 * @swagger POST /auth/login
 * Rate limited: 5 per minute per IP
 */
router.post('/login', authRateLimiter, validate({ body: loginSchema }), login);

/**
 * @swagger POST /auth/refresh
 */
router.post('/refresh', validate({ body: refreshSchema }), refresh);

/**
 * @swagger POST /auth/logout
 * Requires: authenticated
 */
router.post('/logout', authenticate, validate({ body: logoutSchema }), logout);

/**
 * @swagger POST /auth/logout-all
 * Revokes all sessions
 */
router.post('/logout-all', authenticate, logoutAll);

/**
 * @swagger GET /auth/me
 * Returns current authenticated user
 */
router.get('/me', authenticate, me);

module.exports = router;