const CONSTANTS = require('../config/constants');

/**
 * Encode a cursor object to a Base64 string.
 * @param {Object} payload - { id, createdAt }
 */
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a Base64 cursor string to an object.
 * @param {string} cursor
 */
function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Build Prisma cursor pagination arguments.
 * @param {Object} options
 * @param {string} [options.cursor] - Encoded cursor from previous page
 * @param {number} [options.limit]  - Items per page
 * @param {string} [options.orderBy] - Field to order by (default: createdAt)
 * @param {'asc'|'desc'} [options.direction] - Order direction (default: desc)
 */
function buildCursorArgs({ cursor, limit, orderBy = 'createdAt', direction = 'desc' } = {}) {
  const take = Math.min(Number(limit) || CONSTANTS.DEFAULT_PAGE_SIZE, CONSTANTS.MAX_PAGE_SIZE);
  const args = {
    take: take + 1, // fetch one extra to detect next page
    orderBy: { [orderBy]: direction },
  };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded?.id) {
      args.cursor = { id: decoded.id };
      args.skip = 1; // skip the cursor row itself
    }
  }

  return { args, take };
}

/**
 * Build pagination metadata from query results.
 * @param {Array} items - Raw results (take + 1 items)
 * @param {number} take - Requested page size
 * @param {string} [orderBy] - Cursor field
 */
function buildPaginationMeta(items, take, orderBy = 'createdAt') {
  const hasNextPage = items.length > take;
  const data = hasNextPage ? items.slice(0, take) : items;

  let nextCursor = null;
  if (hasNextPage && data.length > 0) {
    const lastItem = data[data.length - 1];
    nextCursor = encodeCursor({ id: lastItem.id, [orderBy]: lastItem[orderBy] });
  }

  return {
    data,
    pagination: {
      hasNextPage,
      nextCursor,
      count: data.length,
    },
  };
}

module.exports = { encodeCursor, decodeCursor, buildCursorArgs, buildPaginationMeta };