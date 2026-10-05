/**
 * 接口层（HTTP）自身产生的错误。
 *
 * 与 CalculatorError 的分工：
 *   - CalculatorError：表达式本身有问题，属于「用户输入非法」，需要告诉用户哪里错了；
 *   - AppError：请求的资源不存在、分页参数非法、JSON 格式错误等，属于「调用方式有问题」。
 *
 * 这里带上 status，是因为这些错误天然就属于某个 HTTP 语义，
 * 而计算内核的错误不应该背负 HTTP 概念。
 */
export class AppError extends Error {
  /**
   * @param {string} code 稳定的错误码
   * @param {string} message 面向接口调用者的英文说明
   * @param {object} [options]
   * @param {number} [options.status] HTTP 状态码
   * @param {object} [options.detail] 附加上下文
   */
  constructor(code, message, { status = 400, detail = {} } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** 接口层错误码，与计算内核的错误码分开维护，避免语义混淆。 */
export const AppErrorCodes = Object.freeze({
  /** 请求体不是合法 JSON */
  MALFORMED_JSON: 'MALFORMED_JSON',
  /** 分页参数非法 */
  INVALID_PAGINATION: 'INVALID_PAGINATION',
  /** 历史记录 id 非法（不是正整数） */
  INVALID_HISTORY_ID: 'INVALID_HISTORY_ID',
  /** 指定 id 的历史记录不存在 */
  HISTORY_NOT_FOUND: 'HISTORY_NOT_FOUND',
  /** 请求的路径不存在 */
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  /** 进制换算参数非法 */
  INVALID_BASE_CONVERSION: 'INVALID_BASE_CONVERSION',
  /** 单位换算参数非法 */
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  /** 服务内部错误 */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export default AppError;
