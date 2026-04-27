/**
 * Standardized API error class.
 * Used by error handler middleware to produce consistent JSON error responses.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message - Human-readable error message
   * @param {string} [errorCode] - Machine-readable error code (e.g. AUTH_INVALID_CREDENTIALS)
   * @param {Array}  [details] - Optional field-level validation errors
   */
  constructor(statusCode, message, errorCode = null, details = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode || `HTTP_${statusCode}`;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  // ── Factories ──────────────────────────────────────────────────────────

  static badRequest(message = 'Bad Request', errorCode = 'BAD_REQUEST', details = []) {
    return new ApiError(400, message, errorCode, details);
  }

  static unauthorized(message = 'Unauthorized', errorCode = 'UNAUTHORIZED') {
    return new ApiError(401, message, errorCode);
  }

  static forbidden(message = 'Forbidden', errorCode = 'FORBIDDEN') {
    return new ApiError(403, message, errorCode);
  }

  static notFound(message = 'Not Found', errorCode = 'NOT_FOUND') {
    return new ApiError(404, message, errorCode);
  }

  static conflict(message = 'Conflict', errorCode = 'CONFLICT') {
    return new ApiError(409, message, errorCode);
  }

  static unprocessable(message = 'Unprocessable Entity', errorCode = 'VALIDATION_ERROR', details = []) {
    return new ApiError(422, message, errorCode, details);
  }

  static tooManyRequests(message = 'Too Many Requests', errorCode = 'RATE_LIMIT_EXCEEDED') {
    return new ApiError(429, message, errorCode);
  }

  static internal(message = 'Internal Server Error', errorCode = 'INTERNAL_ERROR') {
    return new ApiError(500, message, errorCode);
  }
}

module.exports = ApiError;