const paymentService = require('../services/paymentService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const submitPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.submitPayment(req.user.id, req.body);
  ApiResponse.created(res, { payment }, 'Payment submitted successfully.');
});

const getMyPayments = asyncHandler(async (req, res) => {
  const { cursor, limit, circleId, status } = req.query;
  const result = await paymentService.getMyPayments(req.user.id, { cursor, limit: Number(limit) || 20, circleId, status });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const getCirclePayments = asyncHandler(async (req, res) => {
  const { cursor, limit, round, status } = req.query;
  const result = await paymentService.getCirclePayments(req.params.circleId, { cursor, limit: Number(limit) || 20, round, status });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

module.exports = { submitPayment, getMyPayments, getCirclePayments };