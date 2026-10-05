/**
 * Unified error handling middleware.
 *
 * This is the only place in the whole backend that translates "domain error codes" into "HTTP status codes".
 * The calculation kernel only describes the problem with a code; the interface layer decides which status
 * code it corresponds to, here.
 *
 * The payoff of centralized handling:
 *   - every error response format is necessarily consistent (success / code / message / detail);
 *   - adding a new error code requires only one more mapping line here;
 *   - stacks of 500-class errors are written to the log only and never sent back to the client, avoiding
 *     leaks of server paths and dependency versions.
 */

import { CalculatorError, ErrorCodes } from '../calculator/errors.js';
import { AppError, AppErrorCodes } from '../errors/appError.js';
import { createLogger } from '../utils/logger.js';
import config from '../config/index.js';

const logger = createLogger('error', config.log.level);

/**
 * Calculation error code -> HTTP status code.
 *
 * Why map these all to 400 instead of 422?
 * 422 Unprocessable Entity is semantically more precise ("the syntax is fine but the content is not
 * legal"), but the example given by the assignment is 400 Bad Request, and domain errors and syntax
 * errors are handled in exactly the same way by the caller (just show the message to the user), so 400
 * is used uniformly, leaving the front end to remember only one rule: "4xx = a problem with user input".
 * When an exact distinction is needed, read the code field in the response body.
 */
const CALCULATOR_ERROR_STATUS = Object.freeze({
  [ErrorCodes.EXPRESSION_REQUIRED]: 400,
  [ErrorCodes.EXPRESSION_TOO_LONG]: 400,
  [ErrorCodes.EXPRESSION_TOO_DEEP]: 400,
  [ErrorCodes.ILLEGAL_CHARACTER]: 400,
  [ErrorCodes.UNEXPECTED_TOKEN]: 400,
  [ErrorCodes.UNEXPECTED_END]: 400,
  [ErrorCodes.UNBALANCED_PARENTHESIS]: 400,
  [ErrorCodes.UNKNOWN_IDENTIFIER]: 400,
  [ErrorCodes.BAD_ARGUMENT_COUNT]: 400,
  [ErrorCodes.DIVISION_BY_ZERO]: 400,
  [ErrorCodes.DOMAIN_ERROR]: 400,
  [ErrorCodes.RESULT_NOT_FINITE]: 400,
});

/** Assemble the unified error response body. When detail is empty the field is not sent, avoiding noise such as detail: {}. */
function buildErrorBody(code, message, detail) {
  const body = { success: false, code, message };
  if (detail !== null && typeof detail === 'object' && Object.keys(detail).length > 0) {
    body.detail = detail;
  }
  return body;
}

/** When no route matched, construct a 404 and hand it to errorHandler. */
export function notFoundHandler(req, res, next) {
  next(
    new AppError(
      AppErrorCodes.ROUTE_NOT_FOUND,
      `Route ${req.method} ${req.originalUrl} does not exist.`,
      { status: 404 },
    ),
  );
}

/** An Express error handling middleware must have four parameters; none may be missing. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  // If the response headers have already been sent, the error happened after "the response started being
  // written". The status code can no longer be changed then, so control can only be handed back to Express
  // to let it close the connection.
  if (res.headersSent) {
    logger.error(`An exception occurred after the response started being sent: ${error.message}`);
    next(error);
    return;
  }

  // ---- 1. JSON parse errors thrown by express.json() ----
  if (error instanceof SyntaxError && 'body' in error) {
    logger.debug(`Request body is not valid JSON: ${req.method} ${req.originalUrl}`);
    res
      .status(400)
      .json(buildErrorBody(AppErrorCodes.MALFORMED_JSON, 'Request body is not valid JSON.', {}));
    return;
  }

  // ---- 2. Request body over the limit ----
  if (error.type === 'entity.too.large') {
    logger.debug(`Request body exceeds the limit: ${req.method} ${req.originalUrl}`);
    res
      .status(413)
      .json(buildErrorBody(AppErrorCodes.MALFORMED_JSON, 'Request body is too large.', {}));
    return;
  }

  // ---- 3. Calculation domain errors ----
  if (error instanceof CalculatorError) {
    const status = CALCULATOR_ERROR_STATUS[error.code] ?? 400;
    // Use the debug level: a user pressing the wrong key on a calculator is a high-frequency and entirely
    // normal operation, and logging it at warn would flood the logs and drown out genuine exceptions.
    logger.debug(`Calculation error ${error.code}: ${error.message}`);
    res.status(status).json(buildErrorBody(error.code, error.message, error.detail));
    return;
  }

  // ---- 4. Interface-layer errors (illegal pagination, record not found, and so on) ----
  if (error instanceof AppError) {
    logger.debug(`Interface error ${error.code}: ${error.message}`);
    res.status(error.status).json(buildErrorBody(error.code, error.message, error.detail));
    return;
  }

  // ---- 5. Fallback: unexpected exceptions ----
  logger.error(`Unhandled exception: ${error.stack ?? error.message}`);
  res.status(500).json(
    buildErrorBody(
      AppErrorCodes.INTERNAL_ERROR,
      'Internal server error.',
      // In production the original error message is not sent, preventing leaks of file paths, SQL statements
      // and other internal details; in development it is kept for convenient local debugging.
      config.isProduction ? {} : { originalMessage: error.message },
    ),
  );
}

export default errorHandler;
