/**
 * Calculator endpoint controller.
 *
 * The controller's responsibility is deliberately compressed to the minimum: hand the request body to
 * the service, emit the service's result in the agreed response format, and pass every exception to the
 * unified error handling middleware via next(err).
 * No try/catch is written here to assemble error responses, because once every controller assembles its
 * own, the response format will sooner or later become inconsistent (some carrying code, some not).
 */

import { calculateAndRecord } from '../service/calculator.service.js';

/**
 * POST /api/calculate
 *
 * Request body: { "expression": "(1+2)*3" }
 *
 * Why return 201 instead of 200?
 * Besides "computing a number", this request also **creates a new resource**, a history record, and
 * returns its id. Under HTTP semantics, producing a new resource should use 201 Created.
 * The assignment also explicitly encourages choosing an appropriate status code for successful requests.
 */
export function calculate(req, res, next) {
  try {
    const record = calculateAndRecord(req.body?.expression);
    res.status(201).json({
      success: true,
      id: record.id,
      expression: record.expression,
      normalizedExpression: record.normalizedExpression,
      result: record.result,
      resultText: record.resultText,
      createdAt: record.createdAt,
    });
  } catch (error) {
    next(error);
  }
}

export default { calculate };
