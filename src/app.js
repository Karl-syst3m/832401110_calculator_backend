/**
 * Express application assembly.
 *
 * This module is only responsible for "mounting middleware and routes in the correct order";
 * it does not start the listener. Keeping the construction of the app separate from listen()
 * lets integration tests receive the app object directly and start the service on a random
 * port (see tests/api.test.js), instead of having to fight over a fixed port.
 *
 * The middleware order is deliberate; from top to bottom it is:
 *   1. corsMiddleware   — preflight requests must short-circuit as early as possible, without
 *                         entering the JSON parsing and business logic that follow;
 *   2. requestLogger    — register it as early as possible so it can cover the elapsed time
 *                         of every middleware that follows;
 *   3. express.json()   — parse the request body (the size limit is configured in config);
 *   4. /api routes      — business logic;
 *   5. notFoundHandler  — nothing matched a route, so construct a 404;
 *   6. errorHandler     — must be last, because Express only honors the four-argument error
 *                         handler that was registered last.
 */

import express from 'express';
import config from './config/index.js';
import { router } from './routes/index.js';
import { corsMiddleware } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

/**
 * Create an Express application instance.
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Disable the X-Powered-By response header. It tells every visitor "this is Express",
  // which helps an attacker look up known vulnerabilities by framework version.
  // Disabling it costs nothing.
  app.disable('x-powered-by');

  // Deployed behind nginx, the real client IP lives in X-Forwarded-For.
  // Only with trust proxy enabled does req.ip return the real IP rather than 127.0.0.1.
  app.set('trust proxy', true);

  app.use(corsMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: config.server.bodyLimit }));

  app.use('/api', router);

  // Visiting the root path returns a plain-language line so that after deployment
  // the service can be confirmed alive by hand.
  app.get('/', (req, res) => {
    res.json({
      success: true,
      service: 'calculator-backend',
      message: 'The backend of the front-end/back-end separated calculator system is running. The API prefix is /api and the health check is at /api/health.',
      apiPrefix: '/api',
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
