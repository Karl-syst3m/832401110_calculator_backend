/**
 * Request logging middleware.
 *
 * It records "method + path + status code + elapsed time", one line each.
 * These four things are the minimum sufficient information for troubleshooting an endpoint:
 *   - an abnormal status code -> check whether the request itself is the problem;
 *   - a sudden jump in elapsed time -> check whether a slow database query is the problem.
 *
 * res.on('finish') is used rather than logging after next(), because the final status code is only
 * available once the response has actually finished being sent.
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
