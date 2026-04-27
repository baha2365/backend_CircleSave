const circleService = require('../services/circleService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createCircle = asyncHandler(async (req, res) => {
  const circle = await circleService.createCircle(req.user.id, req.body);
  ApiResponse.created(res, { circle }, 'Circle created successfully.');
});

const getCircle = asyncHandler(async (req, res) => {
  const circle = await circleService.getCircle(req.params.id, req.user.id);
  ApiResponse.success(res, { circle });
});

const listMyCircles = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const { data, pagination } = await circleService.listUserCircles(req.user.id, { cursor, limit });
  ApiResponse.paginated(res, data, pagination);
});

const joinCircle = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  const result = await circleService.joinCircle(req.user.id, inviteCode);
  ApiResponse.created(res, result, 'Join request submitted. Awaiting organizer approval.');
});

const approveMember = asyncHandler(async (req, res) => {
  const { id: circleId, memberId } = req.params;
  const member = await circleService.approveMember(circleId, memberId, req.user.id);
  ApiResponse.success(res, { member }, 'Member approved.');
});

const rejectMember = asyncHandler(async (req, res) => {
  const { id: circleId, memberId } = req.params;
  const member = await circleService.rejectMember(circleId, memberId, req.user.id);
  ApiResponse.success(res, { member }, 'Member rejected.');
});

const activateCircle = asyncHandler(async (req, res) => {
  const { randomizeOrder } = req.body;
  const circle = await circleService.activateCircle(req.params.id, req.user.id, { randomizeOrder });
  ApiResponse.success(res, { circle }, 'Circle activated successfully.');
});

const dissolveCircle = asyncHandler(async (req, res) => {
  await circleService.dissolveCircle(req.params.id, req.user.id);
  ApiResponse.success(res, null, 'Circle dissolved.');
});

module.exports = {
  createCircle,
  getCircle,
  listMyCircles,
  joinCircle,
  approveMember,
  rejectMember,
  activateCircle,
  dissolveCircle,
};