/**
 * Standardized API response envelope.
 * All successful responses use this format:
 * { success: true, data: {...}, meta: {...} }
 */
class ApiResponse {
  constructor(statusCode, data = null, message = 'Success', meta = null) {
    this.success = statusCode < 400;
    this.message = message;
    if (data !== null) this.data = data;
    if (meta !== null) this.meta = meta;
  }

  static success(res, data = null, message = 'Success', statusCode = 200, meta = null) {
    return res.status(statusCode).json(new ApiResponse(statusCode, data, message, meta));
  }

  static created(res, data = null, message = 'Created successfully') {
    return res.status(201).json(new ApiResponse(201, data, message));
  }

  static noContent(res) {
    return res.status(204).send();
  }

  static paginated(res, data, pagination) {
    return res.status(200).json({
      success: true,
      message: 'Success',
      data,
      meta: { pagination },
    });
  }
}

module.exports = ApiResponse;