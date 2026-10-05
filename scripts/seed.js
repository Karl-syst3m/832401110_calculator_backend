/**
 * 示例数据脚本（可选）。
 *
 * 用途：生成一批覆盖各种情况的计算记录，方便演示历史列表、搜索、分页与统计功能。
 * 它**不是**服务运行的必需步骤，正式演示前请先运行 `npm run seed:clear` 清干净，
 * 再用真实的手工操作生成记录——演示截图应当来自真实操作，而不是预置数据。
 *
 * 用法：
 *   npm run seed          插入示例数据（会先清空现有记录）
 *   npm run seed:clear    清空全部记录
 */

import { initDatabase, getDatabase, closeDatabase } from '../src/db/connection.js';
import { applySchema } from '../src/db/schema.js';
import { calculateAndRecord } from '../src/service/calculator.service.js';
import config from '../src/config/index.js';

/** 覆盖作业演示要点的一组表达式。 */
const SAMPLE_EXPRESSIONS = [
  '12+8', '100-37', '6*7', '20/4',
  '0.1+0.2', '1.5*2.4', '3.14*2',
  '1+2*3', '(1+2)*3', '10/2+7', '8-3*2',
  '-5+8', '3*-2', '2*(3+4)-5',
  'sqrt(16)', '2^10', 'ln(e)', 'abs(-3.5)',
  'log(1000)', 'fact(5)', 'max(1,5,3)', 'round(3.14159,2)',
  '100+200', '1000/10', '7*6', '9-15', '2.5+2.5',
];

initDatabase({ file: config.database.file });
applySchema(getDatabase());

const clearOnly = process.argv.includes('--clear');

const deleted = getDatabase().prepare('DELETE FROM calculation_history').run().changes;
console.log(`已清空原有记录：${deleted} 条`);

if (!clearOnly) {
  let inserted = 0;
  let failed = 0;
  for (const expression of SAMPLE_EXPRESSIONS) {
    try {
      calculateAndRecord(expression);
      inserted += 1;
    } catch (error) {
      failed += 1;
      console.warn(`  跳过 ${expression}：${error.message}`);
    }
  }
  console.log(`已插入示例记录：${inserted} 条（失败 ${failed} 条）`);
}

const total = getDatabase().prepare('SELECT COUNT(*) AS total FROM calculation_history').get().total;
console.log(`当前记录总数：${total} 条`);

closeDatabase();
