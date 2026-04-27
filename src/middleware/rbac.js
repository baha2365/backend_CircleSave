const ApiError = require('../utils/ApiError');

/**
 * Factory: require that req.user has one of the specified roles.
 * Must be used AFTER authenticate middleware.
 *
 * Usage:
 *   router.get('/admin/users', authenticate, requireRole('ADMIN'), handler)
 *   router.post('/circles', authenticate, requireRole('ORGANIZER', 'ADMIN'), handler)
 *
 * @param {...string} roles - Allowed role(s)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required.', 'AUTH_MISSING'));
  }

  if (!roles.includes(req.user.role)) {
    return next(
      ApiError.forbidden(
        `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
        'RBAC_INSUFFICIENT_ROLE'
      )
    );
  }

  next();
};

/**
 * Require that the authenticated user owns a resource OR has admin role.
 * @param {string} ownerIdField - Field name in req.params or req.body containing owner's userId
 */
const requireOwnerOrAdmin = (getOwnerId) => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required.', 'AUTH_MISSING'));
  }

  const ownerId = typeof getOwnerId === 'function' ? getOwnerId(req) : req.params[getOwnerId];

  if (req.user.role === 'ADMIN' || req.user.id === ownerId) {
    return next();
  }

  next(ApiError.forbidden('You do not have permission to access this resource.', 'RBAC_NOT_OWNER'));
};

module.exports = { requireRole, requireOwnerOrAdmin };