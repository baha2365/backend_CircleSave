const paymentService = require('../services/paymentService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const submitPayment = asyncHandler(async (req, res) => {
  const { circleId, scheduleId, amount } = req.body;
  const idempotencyKey = req.idempotencyKey;

  const result = await paymentService.submitPayment(req.user.id, {
    circleId,
    scheduleId,
    amount,
    idempotencyKey,
  });

  if (result.idempotent) {
    return ApiResponse.success(res, { payment: result.payment }, 'Idempotent response: payment already processed.');
  }

  ApiResponse.created(res, { payment: result.payment }, 'Payment submitted successfully.');
});

const getCirclePayments = asyncHandler(async (req, res) => {
  const { cursor, limit, status } = req.query;
  const { data, pagination } = await paymentService.getCirclePayments(
    req.params.circleId,
    { cursor, limit, status }
  );
  ApiResponse.paginated(res, data, pagination);
});

const getMyPayments = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const { data, pagination } = await paymentService.getUserPayments(req.user.id, { cursor, limit });
  ApiResponse.paginated(res, data, pagination);
});

module.exports = { submitPayment, getCirclePayments, getMyPayments };