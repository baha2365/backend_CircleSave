const circleService = require('../services/circleService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createCircle = asyncHandler(async (req, res) => {
  const circle = await circleService.createCircle(req.user.id, req.body);
  ApiResponse.created(res, { circle }, 'Circle created successfully.');
});

const listMyCircles = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const result = await circleService.listMyCircles(req.user.id, { cursor, limit: Number(limit) || 20 });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const joinCircle = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  const result = await circleService.joinCircle(req.user.id, inviteCode);
  ApiResponse.created(res, result, 'Join request submitted. Awaiting organizer approval.');
});

const getCircle = asyncHandler(async (req, res) => {
  const circle = await circleService.getCircle(req.params.id, req.user.id);
  ApiResponse.success(res, { circle });
});

const activateCircle = asyncHandler(async (req, res) => {
  const circle = await circleService.activateCircle(req.params.id, req.user.id, req.body.startDate);
  ApiResponse.success(res, { circle }, 'Circle activated successfully.');
});

const dissolveCircle = asyncHandler(async (req, res) => {
  await circleService.dissolveCircle(req.params.id, req.user.id);
  ApiResponse.success(res, null, 'Circle dissolved.');
});

const approveMember = asyncHandler(async (req, res) => {
  const member = await circleService.approveMember(req.params.id, req.params.memberId, req.user.id);
  ApiResponse.success(res, { member }, 'Member approved.');
});

const rejectMember = asyncHandler(async (req, res) => {
  await circleService.rejectMember(req.params.id, req.params.memberId, req.user.id);
  ApiResponse.success(res, null, 'Member rejected.');
});

module.exports = { createCircle, listMyCircles, joinCircle, getCircle, activateCircle, dissolveCircle, approveMember, rejectMember };