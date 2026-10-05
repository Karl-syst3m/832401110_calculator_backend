/**
 * History service.
 *
 * This layer carries the "business rules" between the model (pure data access) and the controller (pure HTTP):
 *   - how pagination parameters are computed legally;
 *   - whether deleting a nonexistent record counts as an error (we define it as one, returning 404);
 *   - which fields the pagination metadata returned to the front end contains.
 * Centralizing judgments like these in the service lets the controller stay thin enough to be a single call.
 */

import { AppError, AppErrorCodes } from '../errors/appError.js';
import * as historyModel from '../model/history.model.js';
import config from '../config/index.js';

const VALID_SORT_FIELDS = new Set(['createdAt', 'result', 'id']);
const VALID_ORDERS = new Set(['asc', 'desc']);

/** Parse a string into an integer, returning null on failure. */
function parseIntStrict(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

/**
 * Parse and validate a history id.
 * The id must be an integer no smaller than 1; anything else is treated as "illegal parameter" rather than
 * "record not found", because the former means the caller wrote it wrong while the latter means the caller
 * wrote it right but the data is gone, and the two are handled differently.
 */
export function parseHistoryId(rawId) {
  const id = parseIntStrict(rawId);
  if (id === null || id < 1) {
    throw new AppError(
      AppErrorCodes.INVALID_HISTORY_ID,
      `History id must be a positive integer, received "${rawId}".`,
      { status: 400, detail: { received: rawId } },
    );
  }
  return id;
}

/**
 * Paginated history query.
 * @param {object} query Express's req.query
 */
export function listHistory(query = {}) {
  const rawPage = query.page === undefined ? 1 : parseIntStrict(query.page);
  if (rawPage === null || rawPage < 1) {
    throw new AppError(
      AppErrorCodes.INVALID_PAGINATION,
      'Query parameter "page" must be a positive integer.',
      { status: 400, detail: { page: query.page } },
    );
  }

  const rawPageSize = query.pageSize === undefined ? config.calculator.defaultPageSize : parseIntStrict(query.pageSize);
  if (rawPageSize === null || rawPageSize < 1) {
    throw new AppError(
      AppErrorCodes.INVALID_PAGINATION,
      'Query parameter "pageSize" must be a positive integer.',
      { status: 400, detail: { pageSize: query.pageSize } },
    );
  }

  // The upper bound check is crucial: if pageSize=1000000 were allowed, a single request could read the
  // entire table into memory. The server must hold this boundary itself and cannot trust values from the front end.
  const pageSize = Math.min(rawPageSize, config.calculator.maxPageSize);

  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  const favoriteOnly = query.favoriteOnly === 'true' || query.favoriteOnly === '1';
  const sortBy = VALID_SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';
  const order = VALID_ORDERS.has(String(query.order).toLowerCase())
    ? String(query.order).toLowerCase()
    : 'desc';

  const { items, total } = historyModel.findHistory({
    page: rawPage,
    pageSize,
    keyword,
    favoriteOnly,
    sortBy,
    order,
  });

  return {
    items,
    total,
    page: rawPage,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    // Echo back the effective query conditions, so the front end can confirm "were my filters accepted by the server".
    filters: { keyword, favoriteOnly, sortBy, order },
  };
}

/**
 * Delete the history record with the given id.
 * When the record does not exist, throw 404 rather than silently returning success — otherwise the front end
 * deleting a nonexistent id would believe it was deleted when nothing happened, a "fake success" that is one
 * of the hardest classes of problem to troubleshoot.
 */
export function removeHistory(rawId) {
  const id = parseHistoryId(rawId);
  const deleted = historyModel.deleteHistoryById(id);
  if (deleted === 0) {
    throw new AppError(
      AppErrorCodes.HISTORY_NOT_FOUND,
      `History record with id ${id} does not exist.`,
      { status: 404, detail: { id } },
    );
  }
  return { id, deleted };
}

/** Clear all history. Returns the number of deleted rows so the front end can say "cleared N records". */
export function clearHistory() {
  const deleted = historyModel.deleteAllHistory();
  return { deleted };
}

/** Toggle the favorite state and return the whole updated record. */
export function toggleFavorite(rawId, nextState) {
  const id = parseHistoryId(rawId);
  const existing = historyModel.findHistoryById(id);
  if (existing === null) {
    throw new AppError(
      AppErrorCodes.HISTORY_NOT_FOUND,
      `History record with id ${id} does not exist.`,
      { status: 404, detail: { id } },
    );
  }

  // When no target state is passed explicitly, treat it as "negate", so the front end can toggle back and
  // forth with a single button.
  const target = typeof nextState === 'boolean' ? nextState : !existing.isFavorite;
  historyModel.setFavorite(id, target);
  return historyModel.findHistoryById(id);
}

/** Aggregate statistics. */
export function getStatistics() {
  return historyModel.getStatistics();
}

export default {
  listHistory,
  removeHistory,
  clearHistory,
  toggleFavorite,
  getStatistics,
  parseHistoryId,
};
