const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/database');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const {
  enqueueVerificationEmail,
  enqueuePasswordResetEmail,
} = require('./emailQueueService');

const SALT_ROUNDS = 12;
const CODE_EXPIRY_MINUTES = 15;

// ── Helpers ────────────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generate a random 6-digit numeric code */
function generateOTPCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function codeExpiryDate() {
  return new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
}

// ── JWT ────────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh', jti: uuidv4() },
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
  const match = env.JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [, amount, unit] = match;
  const multipliers = { d: 86400, h: 3600, m: 60, s: 1 };
  return new Date(Date.now() + Number(amount) * multipliers[unit] * 1000);
}

// ── REGISTER ───────────────────────────────────────────────────────────────

async function register({ email, username, password }) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  if (existing) {
    const field = existing.email === email ? 'email' : 'username';
    throw ApiError.conflict(`A user with this ${field} already exists.`, 'AUTH_DUPLICATE_USER');
  }

  const passwordHash = await hashPassword(password);
  const code = generateOTPCode();

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      role: 'MEMBER',
      isVerified: false,
      verificationToken: code,
      verificationTokenExpiry: codeExpiryDate(),
    },
    select: {
      id: true, email: true, username: true, role: true,
      trustScore: true, isVerified: true, createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'USER_REGISTERED',
      entity: 'User',
      entityId: user.id,
      metadata: { email, username },
    },
  });

  // Queue verification email (async — API responds immediately)
  await enqueueVerificationEmail(email, username, code);

  logger.info('User registered — verification email queued', { userId: user.id, email });
  return user;
}

// ── VERIFY EMAIL ───────────────────────────────────────────────────────────

async function verifyEmail({ email, code }) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw ApiError.notFound('No account found with this email.', 'AUTH_USER_NOT_FOUND');
  }

  if (user.isVerified) {
    throw ApiError.conflict('This account is already verified.', 'AUTH_ALREADY_VERIFIED');
  }

  if (!user.verificationToken || user.verificationToken !== code) {
    throw ApiError.badRequest('Invalid verification code.', 'AUTH_INVALID_CODE');
  }

  if (user.verificationTokenExpiry < new Date()) {
    throw ApiError.badRequest(
      'Verification code has expired. Request a new one.',
      'AUTH_CODE_EXPIRED'
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: true,
      verificationToken: null,
      verificationTokenExpiry: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'EMAIL_VERIFIED',
      entity: 'User',
      entityId: user.id,
    },
  });

  logger.info('Email verified', { userId: user.id, email });
  return { message: 'Email verified successfully. You can now log in.' };
}

// ── RESEND VERIFICATION CODE ───────────────────────────────────────────────

async function resendVerificationCode({ email }) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Return generic message to prevent email enumeration
    return { message: 'If this email exists, a new code has been sent.' };
  }

  if (user.isVerified) {
    throw ApiError.conflict('This account is already verified.', 'AUTH_ALREADY_VERIFIED');
  }

  const code = generateOTPCode();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      verificationToken: code,
      verificationTokenExpiry: codeExpiryDate(),
    },
  });

  await enqueueVerificationEmail(email, user.username, code);

  logger.info('Verification code resent', { userId: user.id, email });
  return { message: 'If this email exists, a new code has been sent.' };
}

// ── LOGIN ──────────────────────────────────────────────────────────────────

async function login({ email, password }, ip) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
  }

  if (user.isBanned) {
    throw ApiError.forbidden(
      `Account banned: ${user.bannedReason || 'Policy violation'}`,
      'AUTH_ACCOUNT_BANNED'
    );
  }

  if (!user.isActive) {
    throw ApiError.forbidden('Account is inactive.', 'AUTH_ACCOUNT_INACTIVE');
  }

  // ── Block unverified users ──────────────────────────────────────────────
  if (!user.isVerified) {
    throw ApiError.forbidden(
      'Please verify your email before logging in. Check your inbox for the verification code.',
      'AUTH_EMAIL_NOT_VERIFIED'
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: getRefreshTokenExpiry(),
    },
  });

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
      isVerified: user.isVerified,
    },
  };
}

// ── REFRESH ────────────────────────────────────────────────────────────────

async function refreshTokens(refreshToken) {
  verifyRefreshToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: {
      user: {
        select: {
          id: true, email: true, username: true,
          role: true, isActive: true, isBanned: true, isVerified: true,
        },
      },
    },
  });

  if (!storedToken || storedToken.revoked) {
    throw ApiError.unauthorized(
      'Refresh token is invalid or has been revoked.',
      'AUTH_REFRESH_REVOKED'
    );
  }

  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true, revokedAt: new Date() },
    });
    throw ApiError.unauthorized('Refresh token expired. Please log in again.', 'AUTH_REFRESH_EXPIRED');
  }

  if (!storedToken.user.isActive || storedToken.user.isBanned) {
    throw ApiError.forbidden('Account is suspended.', 'AUTH_ACCOUNT_SUSPENDED');
  }

  // Rotate — revoke old, issue new
  const newAccessToken = generateAccessToken(storedToken.user);
  const newRefreshToken = generateRefreshToken(storedToken.user);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true, revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
  ]);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ── LOGOUT ─────────────────────────────────────────────────────────────────

async function logout(refreshToken, userId) {
  if (!refreshToken) {
    throw ApiError.badRequest('Refresh token required for logout.', 'AUTH_REFRESH_MISSING');
  }

  const token = await prisma.refreshToken.findFirst({
    where: { tokenHash: hashToken(refreshToken), userId },
  });

  if (token) {
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  await prisma.auditLog.create({
    data: { userId, action: 'USER_LOGOUT', entity: 'User', entityId: userId },
  });

  logger.info('User logged out', { userId });
}

async function logoutAll(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true, revokedAt: new Date() },
  });
  logger.info('All sessions revoked', { userId });
}

// ── FORGOT PASSWORD ────────────────────────────────────────────────────────

async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always return the same generic message — prevents email enumeration
  if (!user || !user.isVerified) {
    return { message: 'If this email exists, a password reset code has been sent.' };
  }

  const code = generateOTPCode();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: code,
      passwordResetTokenExpiry: codeExpiryDate(),
    },
  });

  await enqueuePasswordResetEmail(email, user.username, code);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'User',
      entityId: user.id,
      metadata: { email },
    },
  });

  logger.info('Password reset code sent', { userId: user.id, email });
  return { message: 'If this email exists, a password reset code has been sent.' };
}

// ── RESET PASSWORD ─────────────────────────────────────────────────────────

async function resetPassword({ email, code, newPassword }) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw ApiError.badRequest('Invalid or expired reset code.', 'AUTH_INVALID_RESET_CODE');
  }

  if (!user.passwordResetToken || user.passwordResetToken !== code) {
    throw ApiError.badRequest('Invalid or expired reset code.', 'AUTH_INVALID_RESET_CODE');
  }

  if (user.passwordResetTokenExpiry < new Date()) {
    throw ApiError.badRequest(
      'Reset code has expired. Request a new one.',
      'AUTH_RESET_CODE_EXPIRED'
    );
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    });

    // Revoke all existing refresh tokens — force re-login everywhere
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        entity: 'User',
        entityId: user.id,
      },
    });
  });

  logger.info('Password reset completed', { userId: user.id, email });
  return { message: 'Password reset successfully. Please log in with your new password.' };
}

// ── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  register,
  verifyEmail,
  resendVerificationCode,
  login,
  logout,
  logoutAll,
  refreshTokens,
  forgotPassword,
  resetPassword,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
};