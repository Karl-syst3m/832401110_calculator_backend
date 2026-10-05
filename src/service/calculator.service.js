/**
 * Calculation service: chaining "pure calculation" and "persisting to the database" together.
 *
 * Layering intent:
 *   calculator/  does mathematics only, and does not know the database exists
 *   service/     orchestrates the business flow (calculate first, persist only on success)
 *   controller/  handles only the HTTP input/output shape
 *
 * Why must it be "persist only on success"?
 * The assignment requires "every successful calculation is stored in the database". If the record went in
 * first and the calculation came second, a failed expression would also occupy a history row, and the
 * front end's history list would fill up with error records, which neither meets the requirement nor looks good.
 */

import calculate from '../calculator/index.js';
import { insertHistory } from '../model/history.model.js';
import config from '../config/index.js';

/**
 * Evaluate an expression and write the successful result into the history records.
 *
 * @param {unknown} rawExpression the expression sent by the front end
 * @returns {object} the persisted record (including the generated id)
 * @throws {import('../calculator/errors.js').CalculatorError}
 */
export function calculateAndRecord(rawExpression) {
  // Step one: pure calculation. A failure throws CalculatorError directly, and the persistence below never runs.
  const outcome = calculate(rawExpression, {
    maxLength: config.calculator.maxExpressionLength,
  });

  // Step two: persist.
  // The timestamp is generated on the server rather than accepted from the front end, avoiding client
  // forgery / time zone confusion and making "calculation time" faithfully reflect the moment the server
  // processed it. It is stored uniformly as ISO 8601 UTC.
  const createdAt = new Date().toISOString();
  const id = insertHistory({
    expression: outcome.expression,
    normalizedExpression: outcome.normalizedExpression,
    result: outcome.value,
    resultText: outcome.valueText,
    createdAt,
  });

  return {
    id,
    expression: outcome.expression,
    normalizedExpression: outcome.normalizedExpression,
    result: outcome.value,
    resultText: outcome.valueText,
    createdAt,
  };
}

export default { calculateAndRecord };
