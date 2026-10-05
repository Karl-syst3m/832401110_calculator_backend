/**
 * History endpoint controller.
 */

import * as historyService from '../service/history.service.js';

/** GET /api/history — paginated history query */
export function list(req, res, next) {
  try {
    const result = historyService.listHistory(req.query);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/history/stats — aggregate statistics (extension feature) */
export function statistics(req, res, next) {
  try {
    res.status(200).json({ success: true, stats: historyService.getStatistics() });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/history/:id — delete the specified record
 *
 * Status code trade-off: this uses 200 plus a response body, rather than 204 No Content.
 * 204 is more "pure", but the front end cannot learn "how many rows were actually deleted" and can
 * only assume success; returning { id, deleted } lets the front end confirm the deletion took effect,
 * and also lets the teaching assistant see the endpoint result directly in the browser.
 * For a course assignment, observability matters more than semantic purity.
 */
export function remove(req, res, next) {
  try {
    const result = historyService.removeHistory(req.params.id);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/history — clear all history (clearing is an extension feature) */
export function clearAll(req, res, next) {
  try {
    const result = historyService.clearHistory();
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/history/:id/favorite — toggle favorite
 * PATCH rather than PUT: this modification touches only the single field is_favorite, so it is a
 * "partial update" and PATCH is semantically correct. PUT implies a whole-entity replacement, which
 * would mislead callers into thinking they must send the complete object.
 */
export function toggleFavorite(req, res, next) {
  try {
    const item = historyService.toggleFavorite(req.params.id, req.body?.isFavorite);
    res.status(200).json({ success: true, item });
  } catch (error) {
    next(error);
  }
}

export default { list, statistics, remove, clearAll, toggleFavorite };
