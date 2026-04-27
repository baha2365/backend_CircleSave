const rotationService = require('../services/rotationService');
const payoutService = require('../services/payoutService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { prisma } = require('../config/database');

const getRotation = asyncHandler(async (req, res) => {
  const rotation = await rotationService.getRotation(req.params.circleId);
  ApiResponse.success(res, { rotation });
});

const createSwapRequest = asyncHandler(async (req, res) => {
  const { targetMemberId, reason } = req.body;
  const swap = await rotationService.createSwapRequest(
    req.params.circleId,
    req.user.id,
    targetMemberId,
    reason
  );
  ApiResponse.created(res, { swap }, 'Swap request submitted. Awaiting organizer approval.');
});

const approveSwap = asyncHandler(async (req, res) => {
  const swap = await rotationService.approveSwap(req.params.swapId, req.user.id);
  ApiResponse.success(res, { swap }, 'Swap approved and executed.');
});

const rejectSwap = asyncHandler(async (req, res) => {
  const swap = await rotationService.rejectSwap(req.params.swapId, req.user.id);
  ApiResponse.success(res, { swap }, 'Swap rejected.');
});

const getSwapRequests = asyncHandler(async (req, res) => {
  const swaps = await prisma.swapRequest.findMany({
    where: { circleId: req.params.circleId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  ApiResponse.success(res, { swaps });
});

const releasePayout = asyncHandler(async (req, res) => {
  const { cycleNumber } = req.body;
  const result = await payoutService.releasePayout(req.params.circleId, cycleNumber, req.user.id);
  ApiResponse.success(res, result, `Payout for cycle ${cycleNumber} released.`);
});

module.exports = { getRotation, createSwapRequest, approveSwap, rejectSwap, getSwapRequests, releasePayout };