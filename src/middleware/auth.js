const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { prisma } = require('../config/database');

/**
 * Verify Bearer JWT access token.
 * Attaches decoded user payload to req.user.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authentication required. Provide a Bearer token.', 'AUTH_MISSING_TOKEN');
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token expired. Please refresh.', 'AUTH_TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid access token.', 'AUTH_INVALID_TOKEN');
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id: true, email: true, username: true, role: true, isActive: true, isBanned: true },
  });

  if (!user) {
    throw ApiError.unauthorized('User not found.', 'AUTH_USER_NOT_FOUND');
  }

  if (!user.isActive || user.isBanned) {
    throw ApiError.forbidden('Account is suspended or banned.', 'AUTH_ACCOUNT_SUSPENDED');
  }

  req.user = user;
  next();
});

module.exports = { authenticate };