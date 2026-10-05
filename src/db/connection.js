/**
 * 数据库连接管理
 *
 * 这里用的是 Node.js 22.5 起内置的 node:sqlite 模块，而不是 npm 上的 better-sqlite3。
 * 这个选择值得说明：
 *   1. better-sqlite3 是原生模块，安装时要匹配 Node ABI 下载预编译包，
 *      匹配不上就回落本地编译，需要 Python + C++ 构建工具链，是新手部署最常见的翻车点；
 *   2. node:sqlite 是内置模块，零安装、零编译，README 里写「Node >= 22.5」即可，
 *      助教拿到代码 npm install 一定不会卡在编译上；
 *   3. 两者的 API 形态高度相似（prepare / run / get / all），
 *      将来若因 Node 版本限制要换回 better-sqlite3，改动集中在 model 一层。
 *
 * 全项目只有这一个文件直接持有数据库句柄，其余代码通过 getDatabase() 获取，
 * 目的是让「连接何时建立、何时关闭」这件事有唯一的事实来源。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db', process.env.LOG_LEVEL ?? 'info');

/** 内存模式常量，写测试时用它换取完全隔离的数据库。 */
export const IN_MEMORY = ':memory:';

/** @type {DatabaseSync | null} */
let database = null;

/**
 * 打开数据库并应用必要的 PRAGMA 设置。
 *
 * @param {object} options
 * @param {string} options.file SQLite 文件路径，或 ':memory:'
 * @returns {DatabaseSync}
 */
export function initDatabase({ file }) {
  if (database !== null) {
    return database;
  }

  if (file !== IN_MEMORY) {
    // SQLite 不会自动创建目录，首次运行时 data/ 目录可能还不存在。
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  database = new DatabaseSync(file);

  // WAL（Write-Ahead Logging）：读操作不再阻塞写操作，反之亦然。
  // 对一个「查询历史 + 插入历史」频繁交替的应用来说收益明显。
  // 内存库不支持 WAL，SQLite 会静默忽略，因此无需分支处理。
  database.exec('PRAGMA journal_mode = WAL;');
  // NORMAL 在 WAL 模式下已能保证崩溃不丢数据，同时比 FULL 少一次 fsync，写更快。
  database.exec('PRAGMA synchronous = NORMAL;');
  // 遇到锁时最多等 5 秒再报错，避免瞬时并发直接抛 SQLITE_BUSY。
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA foreign_keys = ON;');

  logger.info(`数据库已打开: ${file}`);
  return database;
}

/**
 * 获取当前连接。未初始化就调用属于编程错误，直接抛异常而不是返回 null，
 * 这样问题会在启动阶段立刻暴露，而不是在某个请求里变成一句莫名其妙的 TypeError。
 */
export function getDatabase() {
  if (database === null) {
    throw new Error('数据库尚未初始化，请先调用 initDatabase()。');
  }
  return database;
}

/** 关闭连接。进程退出前调用，确保 WAL 内容回写主库文件。 */
export function closeDatabase() {
  if (database === null) return;
  database.close();
  database = null;
  logger.info('数据库连接已关闭');
}

export default initDatabase;
