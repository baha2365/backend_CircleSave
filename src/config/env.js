const { z } = require('zod');

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Rate Limiting
  RATE_LIMIT_AUTH_MAX: z.string().default('5').transform(Number),
  RATE_LIMIT_AUTH_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_GLOBAL_MAX: z.string().default('100').transform(Number),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.string().default('60000').transform(Number),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3001'),

  // Business
  PLATFORM_FEE_PERCENT: z.string().default('2').transform(Number),
  LATE_FEE_PERCENT_PER_DAY: z.string().default('0.5').transform(Number),
  PAYMENT_GRACE_DAYS: z.string().default('5').transform(Number),
  MAX_CIRCLES_PER_USER: z.string().default('3').transform(Number),
  DEFAULT_DETECTION_DAYS: z.string().default('30').transform(Number),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

let env;

try {
  env = envSchema.parse(process.env);
} catch (err) {
  console.error('❌ Invalid environment configuration:');
  if (err.errors) {
    err.errors.forEach((e) => {
      console.error(`  - ${e.path.join('.')}: ${e.message}`);
    });
  }
  process.exit(1);
}

module.exports = env;