/**
 * 历史记录数据访问层（Model）
 *
 * 这一层是唯一直接书写 SQL 的地方。上层 service / controller 只调用这里的函数，
 * 不接触任何 SQL 字符串。这样设计有三个好处：
 *   1. 换数据库（例如从 SQLite 迁到 MySQL）只需重写这一层；
 *   2. SQL 集中审查，是否存在拼接注入一目了然；
 *   3. 单元测试可以针对这一层单独验证增删改查。
 *
 * 所有会拼接进 SQL 的「可变部分」（排序字段、排序方向）都经过白名单校验，
 * 值本身一律走参数绑定（? 占位符），不做字符串拼接。
 */

import { getDatabase } from '../db/connection.js';

/**
 * 把数据库行（snake_case）转换成接口层的对象（camelCase）。
 * 这层映射看起来啰嗦，但它把「数据库列名」和「API 字段名」解耦了：
 * 将来改列名不会波及前端，前端也不会因为数据库风格而出现下划线字段。
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
 * 转义 LIKE 通配符。
 * 如果不转义，用户搜索 "5%" 会被 SQL 当成「以 5 开头」的模糊匹配，
 * 搜 "_" 更是会匹配任意单字符，结果与用户预期完全不符。
 */
function escapeLikePattern(keyword) {
  return keyword.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** 排序字段白名单：把「前端可选的排序方式」映射到真实列名，杜绝 SQL 注入。 */
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',
});

/**
 * 插入一条计算记录。
 * @returns {number} 新记录的 id
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

/** 按 id 查询单条记录，不存在返回 null。 */
export function findHistoryById(id) {
  const statement = getDatabase().prepare(
    'SELECT * FROM calculation_history WHERE id = ? LIMIT 1',
  );
  return mapRow(statement.get(id));
}

/**
 * 分页查询历史记录。
 *
 * @param {object} query
 * @param {number} query.page 页码，从 1 开始
 * @param {number} query.pageSize 每页条数
 * @param {string} [query.keyword] 关键词，匹配表达式或结果文本
 * @param {boolean} [query.favoriteOnly] 只看收藏
 * @param {'createdAt'|'result'|'id'} [query.sortBy] 排序字段
 * @param {'asc'|'desc'} [query.order] 排序方向
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
  // 用 Object.hasOwn 而不是直接取值后判断空：若 sortBy 传成 "constructor"，
  // 直接取值会命中原型链上的 Object 构造函数，被当成合法列名拼进 SQL。
  // 虽然 service 层已用 Set 白名单拦过一次，这里再做一层自己的防御，
  // 保证 model 被单独调用时同样安全。
  const column = Object.hasOwn(SORTABLE_COLUMNS, sortBy)
    ? SORTABLE_COLUMNS[sortBy]
    : SORTABLE_COLUMNS.createdAt;
  const direction = order === 'asc' ? 'ASC' : 'DESC';

  const database = getDatabase();

  // 总数与当页数据分成两条查询，而不是用 SQL_CALC_FOUND_ROWS 之类的技巧：
  // SQLite 没有后者，而且分开写语义更直白，代价只是一次廉价的 COUNT。
  const countRow = database
    .prepare(`SELECT COUNT(*) AS total FROM calculation_history ${whereClause}`)
    .get(...params);
  const total = Number(countRow.total);

  const offset = (page - 1) * pageSize;
  const rows = database
    .prepare(`
      SELECT * FROM calculation_history
      ${whereClause}
      ORDER BY ${column} ${direction}, id ${direction}
      LIMIT ? OFFSET ?
    `)
    // 次级排序键固定用 id：created_at 只精确到毫秒，同毫秒的多条记录若不定序，
    // 翻页时可能出现同一条记录重复出现或被跳过。
    .all(...params, pageSize, offset);

  return { items: rows.map(mapRow), total };
}

/**
 * 删除指定 id 的记录。
 * @returns {number} 实际删除的行数（0 表示记录不存在）
 */
export function deleteHistoryById(id) {
  const statement = getDatabase().prepare('DELETE FROM calculation_history WHERE id = ?');
  return Number(statement.run(id).changes);
}

/**
 * 清空全部历史。
 * @returns {number} 删除的行数
 */
export function deleteAllHistory() {
  const statement = getDatabase().prepare('DELETE FROM calculation_history');
  return Number(statement.run().changes);
}

/**
 * 设置收藏状态。
 * @returns {number} 影响的行数
 */
export function setFavorite(id, isFavorite) {
  const statement = getDatabase().prepare(
    'UPDATE calculation_history SET is_favorite = ? WHERE id = ?',
  );
  return Number(statement.run(isFavorite ? 1 : 0, id).changes);
}

/**
 * 汇总统计。
 *
 * 说明：created_at 以 UTC 存储，因此「今日计算次数」按 UTC 日界统计。
 * 这是一个有意识的取舍——按服务器本地时区统计会在夏令时切换日出现歧义，
 * 而明示 UTC 至少行为可预测。接口返回值里会带上 timezone 字段说明这一点。
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
