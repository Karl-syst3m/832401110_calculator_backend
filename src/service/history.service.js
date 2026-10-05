/**
 * 历史记录服务。
 *
 * 这一层在 model（纯数据访问）与 controller（纯 HTTP）之间承担「业务规则」：
 *   - 分页参数怎么算是合法的；
 *   - 删除一个不存在的记录算不算错误（我们定义算，返回 404）；
 *   - 返回给前端的分页元信息包含哪些字段。
 * 把这类判断集中在 service，controller 可以薄到只剩一行调用。
 */

import { AppError, AppErrorCodes } from '../errors/appError.js';
import * as historyModel from '../model/history.model.js';
import config from '../config/index.js';

const VALID_SORT_FIELDS = new Set(['createdAt', 'result', 'id']);
const VALID_ORDERS = new Set(['asc', 'desc']);

/** 把字符串解析成整数，失败返回 null。 */
function parseIntStrict(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

/**
 * 解析并校验历史记录 id。
 * id 必须是不小于 1 的整数，其余一律视为「参数非法」而不是「记录不存在」，
 * 因为前者是调用方写错了，后者是调用方写对了但数据没了，两种情况的处理方式不同。
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
 * 分页查询历史记录。
 * @param {object} query Express 的 req.query
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

  // 上限校验很关键：若允许 pageSize=1000000，一次请求就能把整表读进内存。
  // 服务端必须自己兜住这个边界，不能信任前端传来的值。
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
    // 回显生效的查询条件，前端可以据此确认「我的筛选被服务端接受了吗」。
    filters: { keyword, favoriteOnly, sortBy, order },
  };
}

/**
 * 删除指定 id 的历史记录。
 * 记录不存在时抛 404，而不是静默返回成功——否则前端删一个不存在的 id
 * 会以为删掉了，实际什么也没发生，属于「假成功」，是最难排查的一类问题。
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

/** 清空全部历史。返回被删除的条数，便于前端提示「已清空 N 条」。 */
export function clearHistory() {
  const deleted = historyModel.deleteAllHistory();
  return { deleted };
}

/** 切换收藏状态，返回更新后的整条记录。 */
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

  // 未显式传入目标状态时按「取反」处理，方便前端只用一个按钮来回切。
  const target = typeof nextState === 'boolean' ? nextState : !existing.isFavorite;
  historyModel.setFavorite(id, target);
  return historyModel.findHistoryById(id);
}

/** 汇总统计。 */
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
