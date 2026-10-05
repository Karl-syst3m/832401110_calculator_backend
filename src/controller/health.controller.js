/**
 * 健康检查接口。
 *
 * 部署时非常有用：nginx 反代配好之后，用一个 GET /api/health 就能确认
 * 「后端进程活着、数据库能读、版本对不对」，不必去翻日志。
 * 作业要求「部署后验证可访问性」，这个接口就是验证手段本身。
 */

import { getDatabase } from '../db/connection.js';

const startedAt = Date.now();

export function health(req, res) {
  let databaseStatus = 'ok';
  let historyCount = null;

  try {
    // 真的去查一次库，而不是只检查连接对象是否存在。
    // 只有真正执行一条 SQL，才能确认文件没损坏、权限没问题。
    const row = getDatabase().prepare('SELECT COUNT(*) AS total FROM calculation_history').get();
    historyCount = Number(row.total);
  } catch (error) {
    databaseStatus = `error: ${error.message}`;
  }

  const healthy = databaseStatus === 'ok';
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: 'calculator-backend',
    status: healthy ? 'ok' : 'degraded',
    database: databaseStatus,
    historyCount,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  });
}

export default { health };
