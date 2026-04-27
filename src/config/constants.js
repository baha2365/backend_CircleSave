const env = require('./env');

const CONSTANTS = {
  // Circle limits
  MAX_CIRCLES_PER_USER: env.MAX_CIRCLES_PER_USER,
  MAX_MEMBERS_PER_CIRCLE: 20,
  MIN_MEMBERS_PER_CIRCLE: 2,

  // Payment
  PAYMENT_GRACE_DAYS: env.PAYMENT_GRACE_DAYS,
  LATE_FEE_PERCENT_PER_DAY: env.LATE_FEE_PERCENT_PER_DAY, // 0.5% per day
  MAX_LATE_FEE_PERCENT: 15, // cap at 15% of original amount
  DEFAULT_DETECTION_DAYS: env.DEFAULT_DETECTION_DAYS, // 30 days overdue → DEFAULTED

  // Platform
  PLATFORM_FEE_PERCENT: env.PLATFORM_FEE_PERCENT, // 2%
  PLATFORM_ACCOUNT: 'platform:circlesave',

  // Trust scoring
  TRUST_DEFAULT_SCORE: 100,
  TRUST_ON_TIME_PAYMENT: +2,
  TRUST_LATE_PAYMENT: -5,
  TRUST_PARTIAL_PAYMENT: -3,
  TRUST_DEFAULT: -25,
  TRUST_FULL_CIRCLE_COMPLETION: +10,
  TRUST_MIN_TO_JOIN: 50, // minimum trust score to join a circle

  // Idempotency
  IDEMPOTENCY_TTL_SECONDS: 86400, // 24 hours

  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // JWT
  ACCESS_TOKEN_EXPIRES_IN: env.JWT_ACCESS_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN: env.JWT_REFRESH_EXPIRES_IN,

  // Ledger account prefixes
  ACCOUNT_MEMBER: 'member',
  ACCOUNT_CIRCLE: 'circle',
  ACCOUNT_PLATFORM: 'platform:circlesave',
  ACCOUNT_ESCROW: 'escrow',
};

module.exports = CONSTANTS;