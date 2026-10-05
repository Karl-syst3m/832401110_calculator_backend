/**
 * Errors produced by the interface layer (HTTP) itself.
 *
 * Division of labor with CalculatorError:
 *   - CalculatorError: the expression itself is problematic, i.e. "the user's input is illegal", and the user must be told where it is wrong;
 *   - AppError: the requested resource does not exist, the pagination parameters are illegal, the JSON is malformed and so on, i.e. "the way it was called is problematic".
 *
 * The status is carried here because these errors inherently belong to some HTTP semantics, whereas errors
 * from the calculation kernel should not bear HTTP concepts.
 */
export class AppError extends Error {
  /**
   * @param {string} code stable error code
   * @param {string} message English explanation aimed at the API caller
   * @param {object} [options]
   * @param {number} [options.status] HTTP status code
   * @param {object} [options.detail] additional context
   */
  constructor(code, message, { status = 400, detail = {} } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Interface-layer error codes, maintained separately from the calculation kernel's codes to avoid semantic confusion. */
export const AppErrorCodes = Object.freeze({
  /** The request body is not valid JSON */
  MALFORMED_JSON: 'MALFORMED_JSON',
  /** The pagination parameters are illegal */
  INVALID_PAGINATION: 'INVALID_PAGINATION',
  /** The history id is illegal (not a positive integer) */
  INVALID_HISTORY_ID: 'INVALID_HISTORY_ID',
  /** No history record exists with the given id */
  HISTORY_NOT_FOUND: 'HISTORY_NOT_FOUND',
  /** The requested path does not exist */
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  /** The base conversion parameters are illegal */
  INVALID_BASE_CONVERSION: 'INVALID_BASE_CONVERSION',
  /** The unit conversion parameters are illegal */
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  /** Internal service error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export default AppError;
