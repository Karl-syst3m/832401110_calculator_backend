/**
 * 计算接口控制器。
 *
 * 控制器的职责被刻意压缩到最小：把请求体交给 service，把 service 的结果
 * 按约定的响应格式吐出去，异常一律 next(err) 交给统一错误处理中间件。
 * 不在这里写 try/catch 拼错误响应，是因为一旦每个 controller 都自己拼，
 * 响应格式迟早会出现不一致（有的带 code，有的不带）。
 */

import { calculateAndRecord } from '../service/calculator.service.js';

/**
 * POST /api/calculate
 *
 * 请求体：{ "expression": "(1+2)*3" }
 *
 * 为什么返回 201 而不是 200？
 * 这次请求除了「算出一个数」之外，还**创建了一条历史记录**这个新资源，
 * 并且返回了它的 id。按 HTTP 语义，产生了新资源就应当用 201 Created。
 * 作业也明确鼓励为成功请求选取恰当的状态码。
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
