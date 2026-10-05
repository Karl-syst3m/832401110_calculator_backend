/**
 * Centralized configuration.
 *
 * Design notes: "everything that comes from the environment" is funneled into one module, and all
 * other code reads values through `config` instead of touching process.env directly. The benefits are:
 *   1. default values live in exactly one place, so local development needs no configuration at all to start;
 *   2. deployment only changes environment variables, never code;
 *   3. tests can construct a configuration object and inject it, without polluting the real environment variables.
 */

import path from 'node:path';
import process from 'node:process';

/** Project root directory (src/config/index.js -> two levels up) */
const projectRoot = path.resolve(import.meta.dirname, '..', '..');

/** Parse a string such as "5500,http://localhost:5500" into an array. */
function parseList(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  /** Runtime environment: development | production | test */
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  /** Absolute path of the project root directory */
  projectRoot,

  server: {
    port: parseInteger(process.env.PORT, 5000),
    /**
     * When only the loopback address is listened on, the outside world cannot connect directly
     * and must go through the nginx reverse proxy. Defaulting to 127.0.0.1 in production is the
     * safer posture: the backend is not exposed to the public internet directly.
     */
    host: process.env.HOST ?? '127.0.0.1',
    /** Maximum size of a single request body. Expressions are short, so 64kb is more than enough, and it also blocks oversized-request attacks. */
    bodyLimit: process.env.BODY_LIMIT ?? '64kb',
  },

  database: {
    /**
     * SQLite data file path. By default it sits in the project's data/ directory,
     * which .gitignore already excludes; the database is a runtime artifact and should not be committed.
     */
    file: process.env.DB_FILE ?? path.join(projectRoot, 'data', 'calculator.sqlite'),
  },

  cors: {
    /**
     * Whitelist of origins allowed to make cross-origin requests.
     * In production it is recommended to have nginx serve the front end and /api from the same
     * origin; then the browser never issues a cross-origin request at all and the whitelist can
     * stay empty. In development the front end serves static files from http://localhost:5500,
     * so it must be allowed explicitly.
     */
    allowedOrigins: parseList(process.env.CORS_ORIGINS, [
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
    ]),
  },

  log: {
    level: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'error' : 'info'),
  },

  /** Business rules: the maximum length of a single expression. */
  calculator: {
    maxExpressionLength: parseInteger(process.env.MAX_EXPRESSION_LENGTH, 200),
    /** Maximum number of records allowed per page when paginating history, so the front end cannot fill memory by passing pageSize=100000. */
    maxPageSize: 100,
    defaultPageSize: 20,
  },
};

export default config;
