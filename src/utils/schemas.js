const { z } = require('zod');

// ── Auth Schemas ──────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),

  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address')
    .toLowerCase()
    .trim(),

  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),

  phone: z
    .string()
    .regex(/^\+?[1-9]\d{6,14}$/, 'Invalid phone number format')
    .optional(),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address')
    .toLowerCase()
    .trim(),

  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .min(1, 'Refresh token is required'),
});

// ── User Schemas ──────────────────────────────────────────────────────────────

const updateMeSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be at most 100 characters')
      .trim()
      .optional(),

    phone: z
      .string()
      .regex(/^\+?[1-9]\d{6,14}$/, 'Invalid phone number format')
      .optional(),

    avatarUrl: z.string().url('Invalid avatar URL').optional(),
  })
  .strict();

// ── Circle Schemas ────────────────────────────────────────────────────────────

const createCircleSchema = z.object({
  name: z
    .string({ required_error: 'Circle name is required' })
    .min(3, 'Name must be at least 3 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),

  description: z.string().max(500, 'Description must be at most 500 characters').trim().optional(),

  contributionAmount: z
    .number({ required_error: 'Contribution amount is required' })
    .positive('Contribution amount must be positive')
    .multipleOf(0.01, 'Contribution amount must have at most 2 decimal places'),

  currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('USD'),

  maxMembers: z
    .number({ required_error: 'Max members is required' })
    .int('Max members must be an integer')
    .min(2, 'Circle must have at least 2 members')
    .max(50, 'Circle cannot have more than 50 members'),

  frequencyDays: z
    .number({ required_error: 'Frequency is required' })
    .int('Frequency must be an integer')
    .min(7, 'Frequency must be at least 7 days')
    .max(365, 'Frequency cannot exceed 365 days'),

  startDate: z
    .string({ required_error: 'Start date is required' })
    .datetime({ message: 'Start date must be a valid ISO datetime' })
    .optional(),
});

const joinCircleSchema = z.object({
  inviteCode: z
    .string({ required_error: 'Invite code is required' })
    .min(1, 'Invite code is required')
    .trim(),
});

const activateCircleSchema = z.object({
  startDate: z
    .string()
    .datetime({ message: 'Start date must be a valid ISO datetime' })
    .optional(),
});

// ── Rotation / Swap Schemas ───────────────────────────────────────────────────

const createSwapSchema = z.object({
  requestedPosition: z
    .number({ required_error: 'Requested position is required' })
    .int('Position must be an integer')
    .positive('Position must be a positive integer'),

  reason: z.string().max(300, 'Reason must be at most 300 characters').trim().optional(),
});

const releasePayoutSchema = z.object({
  memberId: z
    .string({ required_error: 'Member ID is required' })
    .uuid('Member ID must be a valid UUID'),

  notes: z.string().max(300, 'Notes must be at most 300 characters').trim().optional(),
});

// ── Payment Schemas ───────────────────────────────────────────────────────────

const submitPaymentSchema = z.object({
  circleId: z
    .string({ required_error: 'Circle ID is required' })
    .uuid('Circle ID must be a valid UUID'),

  amount: z
    .number({ required_error: 'Amount is required' })
    .positive('Amount must be positive')
    .multipleOf(0.01, 'Amount must have at most 2 decimal places'),

  currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('USD'),

  paymentMethod: z
    .enum(['BANK_TRANSFER', 'CARD', 'CASH', 'MOBILE_MONEY'], {
      errorMap: () => ({ message: 'Invalid payment method' }),
    })
    .optional(),

  reference: z
    .string()
    .max(200, 'Reference must be at most 200 characters')
    .trim()
    .optional(),
});

// ── Admin Schemas ─────────────────────────────────────────────────────────────

const banUserSchema = z.object({
  reason: z
    .string({ required_error: 'Ban reason is required' })
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason must be at most 500 characters')
    .trim(),
});

const setRoleSchema = z.object({
  role: z.enum(['MEMBER', 'ORGANIZER', 'ADMIN'], {
    required_error: 'Role is required',
    errorMap: () => ({ message: 'Role must be one of: MEMBER, ORGANIZER, ADMIN' }),
  }),
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Auth
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,

  // User
  updateMeSchema,

  // Circle
  createCircleSchema,
  joinCircleSchema,
  activateCircleSchema,

  // Rotation
  createSwapSchema,
  releasePayoutSchema,

  // Payment
  submitPaymentSchema,

  // Admin
  banUserSchema,
  setRoleSchema,
};