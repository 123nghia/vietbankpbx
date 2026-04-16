/**
 * Standard API Response Formatter
 */

export class ApiResponse {
  constructor(success = true, data = null, message = null, error = null) {
    this.success = success;
    this.data = data;
    this.message = message;
    this.error = error;
    this.timestamp = new Date().toISOString();
  }

  static success(data, message = 'Success') {
    return new ApiResponse(true, data, message);
  }

  static error(message = 'Error', error = null, data = null) {
    return new ApiResponse(false, data, message, error);
  }

  static paginated(items, total, limit, offset) {
    return new ApiResponse(true, {
      items,
      pagination: {
        total,
        limit,
        offset,
        totalPages: Math.ceil(total / limit)
      }
    }, 'Success');
  }
}

export default ApiResponse;
