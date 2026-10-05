/**
 * History data access layer (Model)
 *
 * This layer is the only place where SQL is written directly. The service / controller layers above only
 * call the functions here and never touch an SQL string. This design has three benefits:
 *   1. switching databases (say from SQLite to MySQL) requires rewriting only this layer;
 *   2. SQL is reviewed in one place, so whether concatenation injection exists is immediately obvious;
 *   3. unit tests can verify the CRUD operations against this layer alone.
 *
 * Every "variable part" that gets concatenated into the SQL (sort field, sort direction) passes whitelist
 * validation, and values themselves always go through bound parameters (the ? placeholder) rather than
 * string concatenation.
 */

import { getDatabase } from '../db/connection.js';

/**
 * Convert a database row (snake_case) into an interface-layer object (camelCase).
 * This mapping looks verbose, but it decouples "database column names" from "API field names":
 * renaming a column later will not ripple into the front end, and the front end will not end up with
 * underscore fields just because of the database style.
 */
function mapRow(row) {
  if (row === undefined) return null;
  return {
    id: Number(row.id),
    expression: row.expression,
    normalizedExpression: row.normalized_expression,
    result: row.result,
    resultText: row.result_text,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
  };
}

/**
 * Escape LIKE wildcards.
 * Without escaping, a user searching for "5%" would be treated by SQL as a fuzzy match "starts with 5",
 * and searching "_" would match any single character, giving results entirely at odds with the user's
 * expectation.
 */
function escapeLikePattern(keyword) {
  return keyword.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Sort field whitelist: maps "the sort modes the front end may choose" to real column names, eliminating SQL injection. */
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',
});

/**
 * Insert one calculation record.
 * @returns {number} the id of the new record
 */
export function insertHistory({ expression, normalizedExpression, result, resultText, createdAt }) {
  const statement = getDatabase().prepare(`
    INSERT INTO calculation_history
      (expression, normalized_expression, result, result_text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = statement.run(expression, normalizedExpression, result, resultText, createdAt);
  return Number(info.lastInsertRowid);
}

/** Look up a single record by id; returns null when it does not exist. */
export function findHistoryById(id) {
  const statement = getDatabase().prepare(
    'SELECT * FROM calculation_history WHERE id = ? LIMIT 1',
  );
  return mapRow(statement.get(id));
}

/**
 * Paginated history query.
 *
 * @param {object} query
 * @param {number} query.page page number, starting from 1
 * @param {number} query.pageSize records per page
 * @param {string} [query.keyword] keyword, matching the expression or the result text
 * @param {boolean} [query.favoriteOnly] favorites only
 * @param {'createdAt'|'result'|'id'} [query.sortBy] sort field
 * @param {'asc'|'desc'} [query.order] sort direction
 * @returns {{items: Array<object>, total: number}}
 */
export function findHistory({
  page,
  pageSize,
  keyword = '',
  favoriteOnly = false,
  sortBy = 'createdAt',
  order = 'desc',
}) {
  const conditions = [];
  const params = [];

  if (keyword !== '') {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    conditions.push(`(expression LIKE ? ESCAPE '\\' OR result_text LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern);
  }

  if (favoriteOnly) {
    conditions.push('is_favorite = 1');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Object.hasOwn is used rather than taking the value and then testing for emptiness: if sortBy were passed
  // as "constructor", taking the value directly would hit the Object constructor on the prototype chain and
  // concatenate it into the SQL as a legal column name.
  // Although the service layer already blocks this once with a Set whitelist, a second layer of defense is
  // placed here so that the model is equally safe when called on its own.
  const column = Object.hasOwn(SORTABLE_COLUMNS, sortBy)
    ? SORTABLE_COLUMNS[sortBy]
    : SORTABLE_COLUMNS.createdAt;
  const direction = order === 'asc' ? 'ASC' : 'DESC';

  const database = getDatabase();

  // The total count and the current page's data are split into two queries, rather than using a trick such
  // as SQL_CALC_FOUND_ROWS: SQLite does not have the latter, and writing them separately is more
  // straightforward semantically, at the cost of only one cheap COUNT.
  const countRow = database
    .prepare(`SELECT COUNT(*) AS total FROM calculation_history ${whereClause}`)
    .get(...params);
  const total = Number(countRow.total);

  // Second layer of defense for the offset (the service already rejects an out-of-range page): SQLite binds
  // LIMIT/OFFSET as int64, so an offset beyond that range makes the driver raise SQLITE_MISMATCH
  // ("datatype mismatch"), an exception unrelated to the caller's actual mistake. Clamping keeps the
  // statement valid; an offset past the end of the table yields an empty page either way.
  const rawOffset = (page - 1) * pageSize;
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0
    ? rawOffset
    : Number.MAX_SAFE_INTEGER;
  const rows = database
    .prepare(`
      SELECT * FROM calculation_history
      ${whereClause}
      ORDER BY ${column} ${direction}, id ${direction}
      LIMIT ? OFFSET ?
    `)
    // The secondary sort key is fixed to id: created_at is only precise to the millisecond, and if
    // multiple records within the same millisecond are not ordered deterministically, paginating could
    // show the same record twice or skip one.
    .all(...params, pageSize, offset);

  return { items: rows.map(mapRow), total };
}

/**
 * Delete the record with the given id.
 * @returns {number} the number of rows actually deleted (0 means the record does not exist)
 */
export function deleteHistoryById(id) {
  const statement = getDatabase().prepare('DELETE FROM calculation_history WHERE id = ?');
  return Number(statement.run(id).changes);
}

/**
 * Clear all history.
 * @returns {number} the number of rows deleted
 */
export function deleteAllHistory() {
  const statement = getDatabase().prepare('DELETE FROM calculation_history');
  return Number(statement.run().changes);
}

/**
 * Set the favorite state.
 * @returns {number} the number of affected rows
 */
export function setFavorite(id, isFavorite) {
  const statement = getDatabase().prepare(
    'UPDATE calculation_history SET is_favorite = ? WHERE id = ?',
  );
  return Number(statement.run(isFavorite ? 1 : 0, id).changes);
}

/**
 * Aggregate statistics.
 *
 * Note: created_at is stored in UTC, so "number of calculations today" is counted by the UTC day
 * boundary.
 * This is a conscious trade-off — counting by the server's local time zone would be ambiguous on a
 * daylight-saving transition day, whereas stating UTC explicitly at least gives predictable behavior.
 * The endpoint's return value carries a timezone field to make this clear.
 */
export function getStatistics() {
  const database = getDatabase();
  const todayUtc = new Date().toISOString().slice(0, 10);

  const summary = database
    .prepare(`
      SELECT
        COUNT(*)                                              AS total,
        SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END)      AS favorites,
        SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END) AS today,
        COUNT(DISTINCT expression)                            AS distinctExpressions,
        AVG(result)                                           AS averageResult,
        MIN(created_at)                                       AS firstAt,
        MAX(created_at)                                       AS latestAt
      FROM calculation_history
    `)
    .get(todayUtc);

  const mostFrequent = database
    .prepare(`
      SELECT expression, COUNT(*) AS occurrences
      FROM calculation_history
      GROUP BY expression
      ORDER BY occurrences DESC, expression ASC
      LIMIT 1
    `)
    .get();

  return {
    total: Number(summary.total ?? 0),
    favorites: Number(summary.favorites ?? 0),
    today: Number(summary.today ?? 0),
    distinctExpressions: Number(summary.distinctExpressions ?? 0),
    averageResult: summary.averageResult === null ? null : Number(summary.averageResult),
    firstAt: summary.firstAt ?? null,
    latestAt: summary.latestAt ?? null,
    mostFrequentExpression: mostFrequent === undefined ? null : mostFrequent.expression,
    mostFrequentCount: mostFrequent === undefined ? 0 : Number(mostFrequent.occurrences),
    timezone: 'UTC',
  };
}

export default {
  insertHistory,
  findHistoryById,
  findHistory,
  deleteHistoryById,
  deleteAllHistory,
  setFavorite,
  getStatistics,
};
