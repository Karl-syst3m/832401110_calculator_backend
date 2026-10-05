/**
 * Cross-origin (CORS) middleware.
 *
 * Why hand-write it instead of using the cors package?
 * This project's requirements are only two things — "allow origins by whitelist + handle preflight
 * requests" — which twenty lines can explain clearly.
 * Pulling in a dependency would instead send readers to dig through its documentation, and this code is
 * itself meant to be explained in a blog post.
 *
 * Recommended posture in production:
 * Have nginx serve the front-end static files and /api under the same domain, so the browser never
 * issues a cross-origin request at all and an empty whitelist is enough; that is both the least
 * trouble and the safest approach.
 * CORS_ORIGINS only needs configuring when "the front end is deployed independently on another origin".
 *
 * Key security point: Access-Control-Allow-Origin is returned only when the whitelist matches, and it
 * echoes the specific origin rather than the wildcard *. If it returned *, any website could bring a
 * user's browser along to call this API.
 */

import config from '../config/index.js';

/** Request headers allowed to be carried on cross-origin requests. */
const ALLOWED_HEADERS = 'Content-Type';
/** Methods allowed on cross-origin requests. */
const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS';
/** Cache time of the preflight result (seconds), reducing the number of OPTIONS requests. */
const MAX_AGE_SECONDS = '600';

export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (typeof origin === 'string' && config.cors.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
    // Vary: Origin tells caches at every level that "the response varies with Origin".
    // Without it, a CDN might cache the response meant for site A and return it to site B, causing a
    // cross-origin leak.
    res.setHeader('Vary', 'Origin');
  }

  // The preflight request ends here and need not enter the business logic.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

export default corsMiddleware;
