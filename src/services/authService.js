const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/database');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

// ── Password ───────────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── JWT ────────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );
}

const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      type: 'refresh',
      jti: uuidv4(), // unique ID per token
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Refresh token expired. Please log in again.', 'AUTH_REFRESH_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid refresh token.', 'AUTH_REFRESH_INVALID');
  }
}

function getRefreshTokenExpiry() {
  // Parse "7d" → Date 7 days from now
  const match = env.JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [, amount, unit] = match;
  const multipliers = { d: 86400, h: 3600, m: 60, s: 1 };
  return new Date(Date.now() + Number(amount) * multipliers[unit] * 1000);
}

// ── Register ───────────────────────────────────────────────────────────────

async function register({ email, username, password }) {
  // Check uniqueness
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  if (existing) {
    const field = existing.email === email ? 'email' : 'username';
    throw ApiError.conflict(`A user with this ${field} already exists.`, 'AUTH_DUPLICATE_USER');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      role: 'MEMBER',
    },
    select: { id: true, email: true, username: true, role: true, trustScore: true, createdAt: true },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'USER_REGISTERED',
      entity: 'User',
      entityId: user.id,
      metadata: { email, username },
    },
  });

  logger.info('User registered', { userId: user.id, email });
  return user;
}

// ── Login ──────────────────────────────────────────────────────────────────

async function login({ email, password }, ip) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
  }

  if (user.isBanned) {
    throw ApiError.forbidden(`Account banned: ${user.bannedReason || 'Policy violation'}`, 'AUTH_ACCOUNT_BANNED');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('Account is inactive.', 'AUTH_ACCOUNT_INACTIVE');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Persist refresh token


await prisma.refreshToken.create({
  data: {
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiry(),
  },
});

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'USER_LOGIN',
      entity: 'User',
      entityId: user.id,
      ip,
      metadata: { email },
    },
  });

  logger.info('User logged in', { userId: user.id, email });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      trustScore: user.trustScore,
    },
  };
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refreshTokens(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { select: { id: true, email: true, username: true, role: true, isActive: true, isBanned: true } } },
  });

  if (!storedToken || storedToken.revoked) {
    throw ApiError.unauthorized('Refresh token is invalid or has been revoked.', 'AUTH_REFRESH_REVOKED');
  }

  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.update({ where: { id: storedToken.id }, data: { revoked: true, revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token expired. Please log in again.', 'AUTH_REFRESH_EXPIRED');
  }

  if (!storedToken.user.isActive || storedToken.user.isBanned) {
    throw ApiError.forbidden('Account is suspended.', 'AUTH_ACCOUNT_SUSPENDED');
  }

  // Rotate: revoke old, issue new
  const newAccessToken = generateAccessToken(storedToken.user);
  const newRefreshToken = generateRefreshToken(storedToken.user);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: storedToken.id }, data: { revoked: true, revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: getRefreshTokenExpiry(),
      },
    })
  ]);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ── Logout ─────────────────────────────────────────────────────────────────

async function logout(refreshToken, userId) {
  if (!refreshToken) {
    throw ApiError.badRequest('Refresh token required for logout.', 'AUTH_REFRESH_MISSING');
  }

  const token = await prisma.refreshToken.findFirst({
    where: {
      tokenHash: hashToken(refreshToken),
      userId
    }
  });

  if (token) {
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'USER_LOGOUT',
      entity: 'User',
      entityId: userId,
    },
  });

  logger.info('User logged out', { userId });
}

// ── Logout all (security) ──────────────────────────────────────────────────

async function logoutAll(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true, revokedAt: new Date() },
  });
  logger.info('User logged out all sessions', { userId });
}

module.exports = {
  register,
  login,
  logout,
  logoutAll,
  refreshTokens,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
};