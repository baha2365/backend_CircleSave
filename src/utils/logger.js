const winston = require('winston');
const env = require('../config/env');

const { combine, timestamp, json, errors, colorize, simple } = winston.format;

/**
 * Redact sensitive fields from log metadata.
 */
const redactSensitive = winston.format((info) => {
  if (info.headers) {
    const h = { ...info.headers };
    if (h.authorization) h.authorization = '[REDACTED]';
    if (h.cookie) h.cookie = '[REDACTED]';
    info.headers = h;
  }
  if (info.password) info.password = '[REDACTED]';
  if (info.passwordHash) info.passwordHash = '[REDACTED]';
  if (info.token) info.token = '[REDACTED]';
  return info;
});

const transports = [
  new winston.transports.Console({
    format:
      env.NODE_ENV === 'production'
        ? combine(timestamp(), redactSensitive(), errors({ stack: true }), json())
        : combine(colorize(), simple()),
  }),
];

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(timestamp(), redactSensitive(), errors({ stack: true }), json()),
  transports,
  exitOnError: false,
});

module.exports = logger;