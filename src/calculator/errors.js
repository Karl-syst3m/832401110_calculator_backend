/**
 * Domain errors of the calculation kernel.
 *
 * Design notes (this layer deliberately "knows nothing about HTTP"):
 * The calculation kernel is only responsible for answering "what is wrong with this expression",
 * and it expresses the kind of error through code.
 * Whether a given kind of error should return 400 or 404 is a decision of the interface layer,
 * mapped in the errorHandler middleware.
 * The payoff is that the calculation module can be tested on its own without HTTP, and it will
 * not need changes if the protocol is swapped in the future (say to gRPC or a CLI).
 */
export class CalculatorError extends Error {
  /**
   * @param {string} code stable error code; the front end uses it to localize the copy
   * @param {string} message English explanation aimed at the API caller
   * @param {object} [detail] additional context, such as the error position or the function name
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CalculatorError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Table of error code constants.
 * Constants instead of bare strings avoid typos on the one hand, and on the other make
 * "which errors does the system support" visible at a glance, so the front end can implement
 * localized messages against this table.
 */
export const ErrorCodes = Object.freeze({
  /** The request has no expression field, or it is an empty string */
  EXPRESSION_REQUIRED: 'EXPRESSION_REQUIRED',
  /** The expression is longer than the limit */
  EXPRESSION_TOO_LONG: 'EXPRESSION_TOO_LONG',
  /** Parentheses are nested too deeply, preventing a maliciously crafted input from blowing up the call stack */
  EXPRESSION_TOO_DEEP: 'EXPRESSION_TOO_DEEP',
  /** A character that does not belong to the expression character set appeared */
  ILLEGAL_CHARACTER: 'ILLEGAL_CHARACTER',
  /** A token appeared at a syntactic position where it does not belong */
  UNEXPECTED_TOKEN: 'UNEXPECTED_TOKEN',
  /** The expression ended where an operand was required, for example "1+" */
  UNEXPECTED_END: 'UNEXPECTED_END',
  /** Parentheses are not balanced */
  UNBALANCED_PARENTHESIS: 'UNBALANCED_PARENTHESIS',
  /** Unknown function name or constant name */
  UNKNOWN_IDENTIFIER: 'UNKNOWN_IDENTIFIER',
  /** Wrong number of function arguments */
  BAD_ARGUMENT_COUNT: 'BAD_ARGUMENT_COUNT',
  /** Division by zero */
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
  /** Mathematical domain error, for example sqrt(-1) or ln(0) */
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  /** The result is outside the range representable by a double, or it is not a real number */
  RESULT_NOT_FINITE: 'RESULT_NOT_FINITE',
});

export default ErrorCodes;
