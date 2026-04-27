const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
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

circleRouter.post(
  '/',
  requireRole('ORGANIZER', 'ADMIN'),
  validate({ body: schemas.createCircleSchema }),
  circleCtrl.createCircle
);
circleRouter.get('/', circleCtrl.listMyCircles);
circleRouter.post('/join', validate({ body: schemas.joinCircleSchema }), circleCtrl.joinCircle);
circleRouter.get('/:id', circleCtrl.getCircle);
circleRouter.post(
  '/:id/activate',
  requireRole('ORGANIZER', 'ADMIN'),
  validate({ body: schemas.activateCircleSchema }),
  circleCtrl.activateCircle
);
circleRouter.post(
  '/:id/dissolve',
  requireRole('ORGANIZER', 'ADMIN'),
  circleCtrl.dissolveCircle
);
circleRouter.patch(
  '/:id/members/:memberId/approve',
  requireRole('ORGANIZER', 'ADMIN'),
  circleCtrl.approveMember
);
circleRouter.patch(
  '/:id/members/:memberId/reject',
  requireRole('ORGANIZER', 'ADMIN'),
  circleCtrl.rejectMember
);

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
circleRouter.patch(
  '/:circleId/rotation/swaps/:swapId/approve',
  requireRole('ORGANIZER', 'ADMIN'),
  rotationCtrl.approveSwap
);
circleRouter.patch(
  '/:circleId/rotation/swaps/:swapId/reject',
  requireRole('ORGANIZER', 'ADMIN'),
  rotationCtrl.rejectSwap
);
circleRouter.post(
  '/:circleId/payout',
  requireRole('ORGANIZER', 'ADMIN'),
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