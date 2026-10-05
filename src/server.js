/**
 * Service entry point.
 *
 * Startup order:
 *   1. open the database connection;
 *   2. create the tables (idempotent, executed on every startup);
 *   3. assemble the Express application;
 *   4. listen on the port;
 *   5. register the graceful shutdown handling.
 *
 * Why is table creation part of the startup flow instead of a separate initialization script?
 * Because SQLite's CREATE TABLE IF NOT EXISTS is itself idempotent, running it at startup means
 * the project comes up within the three steps "clone the repository -> npm install -> npm start",
 * without the teaching assistant having to remember one extra initialization command.
 * The README still provides npm run init-db for verifying the table schema on its own.
 */

import process from 'node:process';
import config from './config/index.js';
import { createApp } from './app.js';
import { initDatabase, getDatabase, closeDatabase } from './db/connection.js';
import { applySchema } from './db/schema.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server', config.log.level);

/** How many connections one process keeps at a time at most; beyond this it refuses, so that connections cannot be slowly drained. */
const MAX_CONNECTIONS = 256;

function bootstrap() {
  // ---- 1 & 2. Database ----
  initDatabase({ file: config.database.file });
  applySchema(getDatabase());

  // ---- 3 & 4. HTTP service ----
  const app = createApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : config.server.port;
    logger.info(`Calculator backend started: http://${config.server.host}:${actualPort}`);
    logger.info(`Health check: http://${config.server.host}:${actualPort}/api/health`);
    logger.info(`Database file: ${config.database.file}`);
  });
  server.maxConnections = MAX_CONNECTIONS;

  // ---- 5. Graceful shutdown ----
  // After a stop signal arrives: stop accepting new connections first, wait for in-flight
  // requests to finish, then close the database.
  // systemd sends SIGTERM by default when stopping a service; only by completing this flow
  // does the history record currently being written not get lost.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown…`);

    server.close(() => {
      closeDatabase();
      logger.info('Exited safely');
      process.exit(0);
    });

    // Fallback: if some request still has not finished within 10 seconds (for example a client
    // holding a long connection open without sending data), force the exit, so that systemd does
    // not wait too long and then SIGKILL the process before the database has been written back.
    setTimeout(() => {
      logger.warn('Graceful shutdown timed out; forcing the process to end');
      closeDatabase();
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // If an uncaught exception is left unattended, the process ends up in a "half-dead" state.
  // Here we log it and exit, leaving systemd's Restart=always to bring up a clean process.
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.stack ?? error.message}`);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });

  return server;
}

bootstrap();

export default bootstrap;
