const ledgerService = require('../services/ledgerService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getCircleLedger = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const result = await ledgerService.getCircleLedger(req.params.circleId, { cursor, limit });
  ApiResponse.paginated(res, result.entries, {
    hasNextPage: result.hasNextPage,
    nextCursor: result.nextCursor,
    count: result.entries.length,
  });
});

const verifyLedgerBalance = asyncHandler(async (req, res) => {
  const result = await ledgerService.verifyLedgerBalance(req.params.circleId);
  ApiResponse.success(res, result, result.balanced ? 'Ledger is balanced.' : 'Ledger imbalance detected!');
});

module.exports = { getCircleLedger, verifyLedgerBalance };