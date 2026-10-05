/**
 * 统一错误处理中间件。
 *
 * 这是整个后端唯一把「领域错误码」翻译成「HTTP 状态码」的地方。
 * 计算内核只管用 code 描述问题，接口层在这里决定它对应哪个状态码。
 *
 * 集中处理的收益：
 *   - 所有错误响应格式必然一致（success / code / message / detail）；
 *   - 新增一种错误码只需在这里补一行映射；
 *   - 500 类错误的堆栈只写日志、不回传给客户端，避免泄露服务器路径与依赖版本。
 */

import { CalculatorError, ErrorCodes } from '../calculator/errors.js';
import { AppError, AppErrorCodes } from '../errors/appError.js';
import { createLogger } from '../utils/logger.js';
import config from '../config/index.js';

const logger = createLogger('error', config.log.level);

/**
 * 计算错误码 -> HTTP 状态码。
 *
 * 为什么这些全部映射成 400 而不是 422？
 * 422 Unprocessable Entity 在语义上更精确（「语法没问题但内容不合法」），
 * 但作业给出的示例是 400 Bad Request，且分域错误与语法错误对调用方而言
 * 处理方式完全相同（把 message 展示给用户即可），因此统一用 400，
 * 让前端只需要记住「4xx = 用户输入问题」这一条规则。
 * 需要精确区分时，读响应体里的 code 字段即可。
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

/** 组装统一的错误响应体。detail 为空时不下发该字段，避免出现 detail: {} 这种噪音。 */
function buildErrorBody(code, message, detail) {
  const body = { success: false, code, message };
  if (detail !== null && typeof detail === 'object' && Object.keys(detail).length > 0) {
    body.detail = detail;
  }
  return body;
}

/** 未匹配到任何路由时，构造一个 404 并交给 errorHandler。 */
export function notFoundHandler(req, res, next) {
  next(
    new AppError(
      AppErrorCodes.ROUTE_NOT_FOUND,
      `Route ${req.method} ${req.originalUrl} does not exist.`,
      { status: 404 },
    ),
  );
}

/** Express 错误处理中间件必须是四个参数，缺一不可。 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  // 响应头已发出说明错误发生在「已经开始写响应」之后，
  // 此时无法再改状态码，只能把控制权交回 Express 让它关闭连接。
  if (res.headersSent) {
    logger.error(`响应已开始发送后发生异常: ${error.message}`);
    next(error);
    return;
  }

  // ---- 1. express.json() 抛出的 JSON 解析错误 ----
  if (error instanceof SyntaxError && 'body' in error) {
    logger.debug(`请求体不是合法 JSON: ${req.method} ${req.originalUrl}`);
    res
      .status(400)
      .json(buildErrorBody(AppErrorCodes.MALFORMED_JSON, 'Request body is not valid JSON.', {}));
    return;
  }

  // ---- 2. 请求体超限 ----
  if (error.type === 'entity.too.large') {
    logger.debug(`请求体超过上限: ${req.method} ${req.originalUrl}`);
    res
      .status(413)
      .json(buildErrorBody(AppErrorCodes.MALFORMED_JSON, 'Request body is too large.', {}));
    return;
  }

  // ---- 3. 计算领域错误 ----
  if (error instanceof CalculatorError) {
    const status = CALCULATOR_ERROR_STATUS[error.code] ?? 400;
    // 用 debug 级别：用户在计算器上按错键是高频且完全正常的操作，
    // 按 warn 记录会让日志被刷屏，反而淹没真正的异常。
    logger.debug(`计算错误 ${error.code}: ${error.message}`);
    res.status(status).json(buildErrorBody(error.code, error.message, error.detail));
    return;
  }

  // ---- 4. 接口层错误（分页非法、找不到记录等）----
  if (error instanceof AppError) {
    logger.debug(`接口错误 ${error.code}: ${error.message}`);
    res.status(error.status).json(buildErrorBody(error.code, error.message, error.detail));
    return;
  }

  // ---- 5. 兜底：未预期的异常 ----
  logger.error(`未处理异常: ${error.stack ?? error.message}`);
  res.status(500).json(
    buildErrorBody(
      AppErrorCodes.INTERNAL_ERROR,
      'Internal server error.',
      // 生产环境不下发原始错误信息，防止泄露文件路径、SQL 语句等内部细节；
      // 开发环境保留，方便本机调试。
      config.isProduction ? {} : { originalMessage: error.message },
    ),
  );
}

export default errorHandler;
