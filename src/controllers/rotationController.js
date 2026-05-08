const rotationService = require('../services/rotationService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getRotation = asyncHandler(async (req, res) => {
  const result = await rotationService.getRotation(req.params.circleId, req.user.id);
  ApiResponse.success(res, result);
});

const createSwapRequest = asyncHandler(async (req, res) => {
  const swap = await rotationService.createSwapRequest(req.params.circleId, req.user.id, req.body);
  ApiResponse.created(res, { swap }, 'Swap request submitted.');
});

const getSwapRequests = asyncHandler(async (req, res) => {
  const swaps = await rotationService.getSwapRequests(req.params.circleId, req.user.id);
  ApiResponse.success(res, { swaps });
});

const approveSwap = asyncHandler(async (req, res) => {
  const swap = await rotationService.approveSwap(req.params.circleId, req.params.swapId, req.user.id);
  ApiResponse.success(res, { swap }, 'Swap approved.');
});

const rejectSwap = asyncHandler(async (req, res) => {
  const swap = await rotationService.rejectSwap(req.params.circleId, req.params.swapId, req.user.id);
  ApiResponse.success(res, { swap }, 'Swap rejected.');
});

const releasePayout = asyncHandler(async (req, res) => {
  const result = await rotationService.releasePayout(
    req.params.circleId,
    req.body.memberId,
    req.user.id,
    req.body.notes
  );
  ApiResponse.success(res, result, 'Payout released successfully.');
});

module.exports = { getRotation, createSwapRequest, getSwapRequests, approveSwap, rejectSwap, releasePayout };