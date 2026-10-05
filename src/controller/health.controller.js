/**
 * Health check endpoint.
 *
 * Extremely useful during deployment: once the nginx reverse proxy is configured, a single
 * GET /api/health confirms "the backend process is alive, the database is readable, the version is
 * right", with no need to dig through logs.
 * The assignment requires "verify accessibility after deployment", and this endpoint is the
 * verification means itself.
 */

import { getDatabase } from '../db/connection.js';

const startedAt = Date.now();

export function health(req, res) {
  let databaseStatus = 'ok';
  let historyCount = null;

  try {
    // Actually query the database once, rather than only checking whether a connection object exists.
    // Only by truly executing a SQL statement can we confirm the file is not damaged and permissions are fine.
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
