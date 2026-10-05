/**
 * 计算内核的领域错误。
 *
 * 设计说明（这一层刻意「不知道 HTTP」）：
 * 计算内核只负责回答「这个表达式哪里不对」，用 code 表达错误的种类。
 * 至于每种错误该回 400 还是 404，是接口层的决策，放在 errorHandler 中间件里映射。
 * 这样做的收益是：计算模块可以脱离 HTTP 单独测试，也不会因为将来换协议
 * （比如换成 gRPC 或 CLI）而需要改动。
 */
export class CalculatorError extends Error {
  /**
   * @param {string} code 稳定的错误码，前端据此做文案本地化
   * @param {string} message 面向接口调用者的英文说明
   * @param {object} [detail] 附加上下文，例如出错位置、函数名
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CalculatorError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 错误码常量表。
 * 用常量而不是裸字符串，一方面避免拼写错误，另一方面让「系统支持哪些错误」
 * 一眼可见，前端也可以对照这张表实现中文提示。
 */
export const ErrorCodes = Object.freeze({
  /** 请求里没有 expression 字段，或者它是空字符串 */
  EXPRESSION_REQUIRED: 'EXPRESSION_REQUIRED',
  /** 表达式长度超过上限 */
  EXPRESSION_TOO_LONG: 'EXPRESSION_TOO_LONG',
  /** 括号嵌套过深，防止恶意构造把调用栈打爆 */
  EXPRESSION_TOO_DEEP: 'EXPRESSION_TOO_DEEP',
  /** 出现了不属于表达式字符集的字符 */
  ILLEGAL_CHARACTER: 'ILLEGAL_CHARACTER',
  /** 语法位置上出现了一个不该出现的记号 */
  UNEXPECTED_TOKEN: 'UNEXPECTED_TOKEN',
  /** 表达式在需要操作数的位置结束了，例如 "1+" */
  UNEXPECTED_END: 'UNEXPECTED_END',
  /** 括号不配对 */
  UNBALANCED_PARENTHESIS: 'UNBALANCED_PARENTHESIS',
  /** 未知的函数名或常量名 */
  UNKNOWN_IDENTIFIER: 'UNKNOWN_IDENTIFIER',
  /** 函数参数个数不对 */
  BAD_ARGUMENT_COUNT: 'BAD_ARGUMENT_COUNT',
  /** 除以零 */
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
  /** 数学定义域错误，例如 sqrt(-1)、ln(0) */
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  /** 结果超出双精度可表示范围，或不是实数 */
  RESULT_NOT_FINITE: 'RESULT_NOT_FINITE',
});

export default ErrorCodes;
