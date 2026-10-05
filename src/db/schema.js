/**
 * 数据库表结构
 *
 * 表设计说明（对应作业要求的 calculation_history: id / expression / result / created_at）：
 *
 * | 字段                  | 为什么需要它                                                     |
 * |-----------------------|------------------------------------------------------------------|
 * | id                    | 主键，作业要求「按 id 删除指定记录」，前端也用它做列表 key          |
 * | expression            | 用户原始输入，保留原样以便回显「我当时算的是什么」                  |
 * | normalized_expression | 归一化后的表达式（× 变 * 等），排查问题时能看出实际参与计算的是什么 |
 * | result                | 数值型结果，供统计（平均值等）使用                                |
 * | result_text           | 文本型结果，专门解决大数精度问题，理由见下                        |
 * | is_favorite           | 收藏标记，扩展功能                                                |
 * | created_at            | 计算时间，作业要求字段，同时是默认排序键                           |
 *
 * 为什么 result 和 result_text 要同时存？
 * SQLite 的 REAL 是 8 字节双精度浮点，本身能存下 2^53 以上的整数，但一旦读回 JavaScript
 * 就会经过一次 double 转换。对于 1e18 这种量级，数值本身已经超出安全整数范围，
 * 直接显示 REAL 会得到一个尾数被抹平的数字（如 1152921504610000000）。
 * 而 result_text 是我们用 formatNumber 精心格式化后的字符串，与计算当刻的展示完全一致。
 * 因此约定：**展示一律用 result_text，统计计算一律用 result**，两者各司其职。
 *
 * 索引说明：
 *   - created_at DESC：历史列表默认按时间倒序分页，这是最高频的查询路径；
 *   - expression：关键词搜索与「最常用表达式」统计都会用到；
 *   - is_favorite：收藏筛选。
 * 索引不是越多越好，写入时要同步维护，这里只建了确实会被查询用到的三列。
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS calculation_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  expression            TEXT    NOT NULL,
  normalized_expression TEXT    NOT NULL,
  result                REAL    NOT NULL,
  result_text           TEXT    NOT NULL,
  is_favorite           INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  created_at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_created_at
  ON calculation_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_expression
  ON calculation_history (expression);

CREATE INDEX IF NOT EXISTS idx_history_favorite
  ON calculation_history (is_favorite);
`;

/**
 * 建表。使用 IF NOT EXISTS，因此重复执行是幂等的，
 * 服务每次启动都会调用一次，无需单独的「初始化数据库」步骤。
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function applySchema(db) {
  db.exec(SCHEMA_SQL);
}

export default applySchema;
