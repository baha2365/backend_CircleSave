const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole, requireCircleOrganizer } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { idempotency } = require('../middleware/idempotency');
const { paymentRateLimiter } = require('../middleware/rateLimiter');
const schemas = require('../utils/schemas');

// Controllers
const circleCtrl = require('../controllers/circleController');
const paymentCtrl = require('../controllers/paymentController');
const rotationCtrl = require('../controllers/rotationController');
const ledgerCtrl = require('../controllers/ledgerController');
const userCtrl = require('../controllers/userController');
const adminCtrl = require('../controllers/adminController');

// ── User routes ────────────────────────────────────────────────────────────
const userRouter = express.Router();
userRouter.use(authenticate);
userRouter.get('/me', userCtrl.getMe);
userRouter.patch('/me', validate({ body: schemas.updateMeSchema }), userCtrl.updateMe);
userRouter.get('/me/trust-history', userCtrl.getMyTrustHistory);
userRouter.get('/me/notifications', userCtrl.getMyNotifications);
userRouter.patch('/me/notifications/read-all', userCtrl.markNotificationsRead);
userRouter.get('/me/payments', paymentCtrl.getMyPayments);

// ── Circle routes ─────────────────────────────────────────────────────────
const circleRouter = express.Router();
circleRouter.use(authenticate);

// ✅ ANY authenticated user can create a circle.
//    The creator is stored as organizerId on the Circle record.
//    No global role change — organizer status is per-circle only.
circleRouter.post(
  '/',
  validate({ body: schemas.createCircleSchema }),
  circleCtrl.createCircle
);

circleRouter.get('/', circleCtrl.listMyCircles);

// Any authenticated member can request to join
circleRouter.post('/join', validate({ body: schemas.joinCircleSchema }), circleCtrl.joinCircle);

// Any member can view their circle
circleRouter.get('/:id', circleCtrl.getCircle);

// The following routes require the caller to be the circle's organizer
// (checked inside the service via circle.organizerId === req.user.id)
// ADMIN can also perform these actions via the requireCircleOrganizer helper
circleRouter.post(
  '/:id/activate',
  validate({ body: schemas.activateCircleSchema }),
  circleCtrl.activateCircle
);

circleRouter.post('/:id/dissolve', circleCtrl.dissolveCircle);

circleRouter.patch('/:id/members/:memberId/approve', circleCtrl.approveMember);
circleRouter.patch('/:id/members/:memberId/reject', circleCtrl.rejectMember);

// Circle payments (nested)
circleRouter.get('/:circleId/payments', paymentCtrl.getCirclePayments);

// Circle rotation
circleRouter.get('/:circleId/rotation', rotationCtrl.getRotation);
circleRouter.post(
  '/:circleId/rotation/swap',
  validate({ body: schemas.createSwapSchema }),
  rotationCtrl.createSwapRequest
);
circleRouter.get('/:circleId/rotation/swaps', rotationCtrl.getSwapRequests);
circleRouter.patch('/:circleId/rotation/swaps/:swapId/approve', rotationCtrl.approveSwap);
circleRouter.patch('/:circleId/rotation/swaps/:swapId/reject', rotationCtrl.rejectSwap);
circleRouter.post(
  '/:circleId/payout',
  validate({ body: schemas.releasePayoutSchema }),
  rotationCtrl.releasePayout
);

// Circle ledger
circleRouter.get('/:circleId/ledger', ledgerCtrl.getCircleLedger);
circleRouter.get('/:circleId/ledger/verify', requireRole('ADMIN'), ledgerCtrl.verifyLedgerBalance);

// ── Payment routes ────────────────────────────────────────────────────────
const paymentRouter = express.Router();
paymentRouter.use(authenticate);
paymentRouter.post(
  '/',
  paymentRateLimiter,
  idempotency,
  validate({ body: schemas.submitPaymentSchema }),
  paymentCtrl.submitPayment
);

// ── Admin routes ──────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authenticate, requireRole('ADMIN'));

adminRouter.get('/dashboard', adminCtrl.getDashboard);
adminRouter.get('/users', adminCtrl.listUsers);
adminRouter.get('/users/:id', adminCtrl.getUser);
adminRouter.patch('/users/:id/ban', validate({ body: schemas.banUserSchema }), adminCtrl.banUser);
adminRouter.patch('/users/:id/unban', adminCtrl.unbanUser);
adminRouter.patch('/users/:id/role', validate({ body: schemas.setRoleSchema }), adminCtrl.setRole);
adminRouter.get('/circles', adminCtrl.listAllCircles);
adminRouter.get('/audit-logs', adminCtrl.getAuditLogs);

module.exports = { userRouter, circleRouter, paymentRouter, adminRouter };