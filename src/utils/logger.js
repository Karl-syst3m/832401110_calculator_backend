/**
 * 极简结构化日志。
 *
 * 为什么不用 winston / pino？
 * 本项目的日志需求只有「打时间、级别、模块、消息」，为此引入一个几百 KB 的依赖
 * 并不划算。作业的技术复杂度不是评分重点，能用二十行说清楚的事就不要引库。
 * 将来若需要日志切割、上报，再换 pino 也只是替换这一个文件。
 */

import process from 'node:process';

/** 数值越小越严重，用来做「当前级别以下不输出」的过滤。 */
const LEVEL_WEIGHT = { error: 0, warn: 1, info: 2, debug: 3 };

function shouldLog(level, configuredLevel) {
  const current = LEVEL_WEIGHT[configuredLevel] ?? LEVEL_WEIGHT.info;
  const target = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;
  return target <= current;
}

/**
 * 创建一个带作用域名的 logger。
 * @param {string} scope 模块名，会体现在每条日志里，方便定位来源
 * @param {string} [level] 最低输出级别
 */
export function createLogger(scope, level = 'info') {
  const write = (stream, logLevel, message, extra) => {
    if (!shouldLog(logLevel, level)) return;
    const line = `${new Date().toISOString()} [${logLevel.toUpperCase()}] [${scope}] ${message}`;
    if (extra === undefined) {
      stream.write(`${line}\n`);
    } else {
      stream.write(`${line} ${JSON.stringify(extra)}\n`);
    }
  };

  return {
    error: (message, extra) => write(process.stderr, 'error', message, extra),
    warn: (message, extra) => write(process.stderr, 'warn', message, extra),
    info: (message, extra) => write(process.stdout, 'info', message, extra),
    debug: (message, extra) => write(process.stdout, 'debug', message, extra),
  };
}

export default createLogger;
