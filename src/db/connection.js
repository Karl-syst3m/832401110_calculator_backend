/**
 * Database connection management
 *
 * This uses the node:sqlite module built into Node.js 22.5 and later, rather than better-sqlite3 from npm.
 * The choice deserves explanation:
 *   1. better-sqlite3 is a native module; installation must match the Node ABI to download a prebuilt
 *      binary, and if it cannot match, it falls back to a local build that needs a Python + C++ toolchain —
 *      the most common place beginners' deployments fall over;
 *   2. node:sqlite is a built-in module with zero installation and zero compilation, so the README only
 *      needs to say "Node >= 22.5", and when the teaching assistant runs npm install on the code it
 *      definitely will not get stuck on compilation;
 *   3. the two have highly similar API shapes (prepare / run / get / all), so if a future Node version
 *      constraint forces a switch back to better-sqlite3, the changes stay confined to the model layer.
 *
 * In the whole project only this one file holds the database handle directly; all other code obtains it
 * through getDatabase(). The purpose is to give "when the connection is opened and when it is closed" a
 * single source of truth.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db', process.env.LOG_LEVEL ?? 'info');

/** In-memory mode constant; tests use it to obtain a completely isolated database. */
export const IN_MEMORY = ':memory:';

/** @type {DatabaseSync | null} */
let database = null;

/**
 * Open the database and apply the necessary PRAGMA settings.
 *
 * @param {object} options
 * @param {string} options.file SQLite file path, or ':memory:'
 * @returns {DatabaseSync}
 */
export function initDatabase({ file }) {
  if (database !== null) {
    return database;
  }

  if (file !== IN_MEMORY) {
    // SQLite does not create directories automatically, so on the first run the data/ directory may not exist yet.
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  database = new DatabaseSync(file);

  // WAL (Write-Ahead Logging): reads no longer block writes, and vice versa.
  // For an application that alternates frequently between "query history" and "insert history" the gain is clear.
  // In-memory databases do not support WAL and SQLite silently ignores it, so no branch is needed.
  database.exec('PRAGMA journal_mode = WAL;');
  // NORMAL already guarantees that a crash loses no data in WAL mode, and it saves one fsync compared with FULL, so writes are faster.
  database.exec('PRAGMA synchronous = NORMAL;');
  // When a lock is encountered, wait up to 5 seconds before reporting an error, so momentary concurrency does not immediately throw SQLITE_BUSY.
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA foreign_keys = ON;');

  logger.info(`Database opened: ${file}`);
  return database;
}

/**
 * Get the current connection. Calling this before initialization is a programming error, so it throws
 * rather than returning null; that way the problem surfaces immediately at startup instead of turning
 * into an inexplicable TypeError inside some request.
 */
export function getDatabase() {
  if (database === null) {
    throw new Error('The database has not been initialized; call initDatabase() first.');
  }
  return database;
}

/** Close the connection. Called before the process exits, ensuring WAL content is written back to the main database file. */
export function closeDatabase() {
  if (database === null) return;
  database.close();
  database = null;
  logger.info('Database connection closed');
}

export default initDatabase;
