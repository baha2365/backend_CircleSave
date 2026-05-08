const ledgerService = require('../services/ledgerService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getCircleLedger = asyncHandler(async (req, res) => {
  const { cursor, limit, type } = req.query;
  const result = await ledgerService.getCircleLedger(req.params.circleId, {
    cursor,
    limit: Number(limit) || 20,
    type,
  });
  ApiResponse.paginated(res, result.data, result.meta.pagination);
});

const verifyLedgerBalance = asyncHandler(async (req, res) => {
  const result = await ledgerService.verifyLedgerBalance(req.params.circleId);
  ApiResponse.success(res, result, result.balanced ? 'Ledger is balanced.' : 'Ledger integrity issues found.');
});

module.exports = { getCircleLedger, verifyLedgerBalance };