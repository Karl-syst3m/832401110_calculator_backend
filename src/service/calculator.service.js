/**
 * 计算服务：把「纯计算」和「落库」串起来。
 *
 * 分层意图：
 *   calculator/  只做数学，不知道数据库存在
 *   service/     编排业务流程（先算，成功了再存）
 *   controller/  只处理 HTTP 的输入输出形态
 *
 * 为什么必须「算成功才存」？
 * 作业要求「每次成功的计算都存入数据库」。若先入库再计算，失败的表达式
 * 也会占一条历史，前端的历史列表里就会出现一堆报错记录，既不符合要求也影响观感。
 */

import calculate from '../calculator/index.js';
import { insertHistory } from '../model/history.model.js';
import config from '../config/index.js';

/**
 * 计算表达式并把成功结果写入历史记录。
 *
 * @param {unknown} rawExpression 前端传来的表达式
 * @returns {object} 已落库的记录（含生成的 id）
 * @throws {import('../calculator/errors.js').CalculatorError}
 */
export function calculateAndRecord(rawExpression) {
  // 第一步：纯计算。失败会直接抛出 CalculatorError，后面的落库不会执行。
  const outcome = calculate(rawExpression, {
    maxLength: config.calculator.maxExpressionLength,
  });

  // 第二步：落库。
  // 时间戳在服务端生成而不是接收前端传来的值，避免客户端伪造/时区错乱，
  // 也让「计算时间」忠实反映服务端处理的时刻。统一以 ISO 8601 UTC 存储。
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
