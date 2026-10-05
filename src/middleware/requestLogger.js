/**
 * 请求日志中间件。
 *
 * 记录「方法 + 路径 + 状态码 + 耗时」，一行一条。
 * 这四样东西是排查接口问题的最小充分信息：
 *   - 状态码异常 -> 看是不是请求本身有问题；
 *   - 耗时突增   -> 看是不是数据库慢查询。
 *
 * 用 res.on('finish') 而不是在 next() 之后打日志，是因为必须等到响应真正发完
 * 才能拿到最终状态码。
 */

import { createLogger } from '../utils/logger.js';
import config from '../config/index.js';

const logger = createLogger('http', config.log.level);

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`;
    if (res.statusCode >= 500) {
      logger.error(message);
    } else if (res.statusCode >= 400) {
      logger.debug(message);
    } else {
      logger.info(message);
    }
  });

  next();
}

export default requestLogger;
