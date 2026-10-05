/**
 * 计算模块的统一入口（门面 / Facade）
 *
 * 对外只暴露一个 calculate 函数，把「归一化 -> 词法 -> 语法 -> 求值 -> 规范化」
 * 这条流水线封装起来。上层（service 层）不需要知道内部有几个阶段。
 *
 * 之所以把入口单独放一个文件，而不是让 service 直接 import parser 和 evaluator：
 * 这样将来若要在流水线中间插入新阶段（比如度/弧度模式、变量表），
 * 只需要改这一个文件，调用方不受影响。
 */

import { CalculatorError, ErrorCodes } from './errors.js';
import { normalizeExpression } from './tokenizer.js';
import { parse } from './parser.js';
import { evaluate } from './evaluator.js';
import { normalizeNumber, formatNumber } from './format.js';

/** 表达式长度的默认上限。 */
export const DEFAULT_MAX_EXPRESSION_LENGTH = 200;

/**
 * 计算一个数学表达式。
 *
 * @param {unknown} rawExpression 前端传来的原始表达式
 * @param {object} [options]
 * @param {number} [options.maxLength] 长度上限
 * @returns {{expression: string, normalizedExpression: string, value: number, valueText: string, ast: object}}
 * @throws {CalculatorError}
 */
export function calculate(rawExpression, options = {}) {
  const maxLength = options.maxLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;

  // ---- 1. 输入类型与长度校验 ----
  // 放在最前面，因为后面的阶段都假设拿到的是一个字符串。
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

  // ---- 2. 归一化：全角符号、× ÷ 等统一为 ASCII ----
  const normalized = normalizeExpression(trimmed);

  // ---- 3. 语法分析 ----
  const ast = parse(normalized);

  // ---- 4. 求值 ----
  const raw = evaluate(ast);

  // ---- 5. 结果健全性检查 ----
  // 这两种情况必须区分开，因为它们对用户意味着完全不同的东西：
  //   NaN    -> 这个式子根本没有实数解，例如 (-8)^(1/3)
  //   ±Inf  -> 有解但超出了双精度能表示的范围，例如 1e308*10
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
