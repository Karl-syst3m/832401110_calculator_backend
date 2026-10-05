/**
 * Unified entry point of the calculation module (Facade)
 *
 * It exposes a single calculate function to the outside and wraps up the pipeline
 * "normalization -> lexical analysis -> parsing -> evaluation -> normalization".
 * The layer above (the service layer) does not need to know how many stages there are inside.
 *
 * The reason the entry point lives in its own file, rather than letting the service import the
 * parser and evaluator directly: if a new stage ever needs to be inserted in the middle of the
 * pipeline (say degree/radian mode, or a variable table), only this one file changes and callers
 * are unaffected.
 */

import { CalculatorError, ErrorCodes } from './errors.js';
import { normalizeExpression } from './tokenizer.js';
import { parse } from './parser.js';
import { evaluate } from './evaluator.js';
import { normalizeNumber, formatNumber } from './format.js';

/** Default upper limit on expression length. */
export const DEFAULT_MAX_EXPRESSION_LENGTH = 200;

/**
 * Evaluate a mathematical expression.
 *
 * @param {unknown} rawExpression the raw expression sent by the front end
 * @param {object} [options]
 * @param {number} [options.maxLength] length limit
 * @returns {{expression: string, normalizedExpression: string, value: number, valueText: string, ast: object}}
 * @throws {CalculatorError}
 */
export function calculate(rawExpression, options = {}) {
  const maxLength = options.maxLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;

  // ---- 1. Input type and length validation ----
  // Placed first, because the later stages all assume they receive a string.
  if (typeof rawExpression !== 'string') {
    throw new CalculatorError(
      ErrorCodes.EXPRESSION_REQUIRED,
      'Field "expression" is required and must be a string.',
      { receivedType: rawExpression === null ? 'null' : typeof rawExpression },
    );
  }

  const trimmed = rawExpression.trim();
  if (trimmed === '') {
    throw new CalculatorError(
      ErrorCodes.EXPRESSION_REQUIRED,
      'Field "expression" must not be empty.',
      {},
    );
  }

  if (trimmed.length > maxLength) {
    throw new CalculatorError(
      ErrorCodes.EXPRESSION_TOO_LONG,
      `Expression must not exceed ${maxLength} characters.`,
      { maxLength, actualLength: trimmed.length },
    );
  }

  // ---- 2. Normalization: full-width symbols, × ÷ and so on are unified to ASCII ----
  const normalized = normalizeExpression(trimmed);

  // ---- 3. Parsing ----
  const ast = parse(normalized);

  // ---- 4. Evaluation ----
  const raw = evaluate(ast);

  // ---- 5. Result sanity check ----
  // These two cases must be distinguished, because they mean completely different things to the user:
  //   NaN    -> the expression simply has no real solution, for example (-8)^(1/3)
  //   ±Inf   -> there is a solution but it exceeds what a double can represent, for example 1e308*10
  if (Number.isNaN(raw)) {
    throw new CalculatorError(
      ErrorCodes.DOMAIN_ERROR,
      'The expression has no real-number result.',
      { expression: normalized },
    );
  }
  if (!Number.isFinite(raw)) {
    throw new CalculatorError(
      ErrorCodes.RESULT_NOT_FINITE,
      'The result is out of the representable numeric range.',
      { expression: normalized },
    );
  }

  const value = normalizeNumber(raw);
  return {
    expression: trimmed,
    normalizedExpression: normalized,
    value,
    valueText: formatNumber(value),
    ast,
  };
}

export { CalculatorError, ErrorCodes } from './errors.js';
export default calculate;
