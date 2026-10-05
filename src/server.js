/**
 * 服务入口。
 *
 * 启动顺序：
 *   1. 打开数据库连接；
 *   2. 建表（幂等，每次启动都执行）；
 *   3. 装配 Express 应用；
 *   4. 监听端口；
 *   5. 注册优雅退出处理。
 *
 * 为什么建表放在启动流程里而不是单独的初始化脚本？
 * 因为 SQLite 的 CREATE TABLE IF NOT EXISTS 本身幂等，放在启动时执行可以让
 * 「克隆仓库 -> npm install -> npm start」三步之内跑起来，不需要助教额外记住
 * 一条初始化命令。README 里仍然提供了 npm run init-db 供单独验证表结构使用。
 */

import process from 'node:process';
import config from './config/index.js';
import { createApp } from './app.js';
import { initDatabase, getDatabase, closeDatabase } from './db/connection.js';
import { applySchema } from './db/schema.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server', config.log.level);

/** 一个进程最多同时保留多少条连接，超过即拒绝，防止连接被慢慢耗尽。 */
const MAX_CONNECTIONS = 256;

function bootstrap() {
  // ---- 1 & 2. 数据库 ----
  initDatabase({ file: config.database.file });
  applySchema(getDatabase());

  // ---- 3 & 4. HTTP 服务 ----
  const app = createApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : config.server.port;
    logger.info(`计算器后端已启动: http://${config.server.host}:${actualPort}`);
    logger.info(`健康检查: http://${config.server.host}:${actualPort}/api/health`);
    logger.info(`数据库文件: ${config.database.file}`);
  });
  server.maxConnections = MAX_CONNECTIONS;

  // ---- 5. 优雅退出 ----
  // 收到停止信号后：先停止接受新连接，等在途请求处理完，再关数据库。
  // systemd 停止服务时默认发 SIGTERM，走完这个流程才不会丢掉正在写入的那条历史记录。
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，开始优雅退出…`);

    server.close(() => {
      closeDatabase();
      logger.info('已安全退出');
      process.exit(0);
    });

    // 兜底：如果 10 秒内还有请求没结束（例如某个客户端挂着长连接不发数据），
    // 强制退出，避免 systemd 等太久后直接 SIGKILL 导致数据库没来得及回写。
    setTimeout(() => {
      logger.warn('优雅退出超时，强制结束进程');
      closeDatabase();
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 未捕获异常若放任不管，进程会处于「半死不活」状态。
  // 这里记录日志后退出，交给 systemd 的 Restart=always 拉起一个干净进程。
  process.on('uncaughtException', (error) => {
    logger.error(`未捕获异常: ${error.stack ?? error.message}`);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`未处理的 Promise 拒绝: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });

  return server;
}

bootstrap();

export default bootstrap;
