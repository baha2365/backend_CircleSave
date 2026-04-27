const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');

/**
 * Validate request against a Zod schema.
 * Returns 422 with field-level errors on failure.
 *
 * @param {Object} schemas
 * @param {ZodSchema} [schemas.body]   - Schema for req.body
 * @param {ZodSchema} [schemas.params] - Schema for req.params
 * @param {ZodSchema} [schemas.query]  - Schema for req.query
 */
const validate = (schemas) => (req, res, next) => {
  const errors = [];

  for (const [location, schema] of Object.entries(schemas)) {
    if (!schema) continue;

    const result = schema.safeParse(req[location]);
    if (!result.success) {
      const fieldErrors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
        location,
      }));
      errors.push(...fieldErrors);
    } else {
      req[location] = result.data; // replace with coerced/transformed values
    }
  }

  if (errors.length > 0) {
    return next(
      ApiError.unprocessable('Validation failed. Check the details for field-level errors.', 'VALIDATION_ERROR', errors)
    );
  }

  next();
};

module.exports = { validate };