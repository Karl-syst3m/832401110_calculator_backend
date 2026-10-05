/**
 * 数据库初始化脚本。
 *
 * 服务启动时会自动建表，因此正常流程下并不需要单独执行这个脚本。
 * 它存在的意义是「单独验证表结构」：
 *   助教或开发者想确认数据库里到底建了哪些表、哪些索引时，
 *   跑一次 `npm run init-db` 就能看到结果，不必真的启动 HTTP 服务。
 */

import config from '../src/config/index.js';
import { initDatabase, getDatabase, closeDatabase } from '../src/db/connection.js';
import { applySchema } from '../src/db/schema.js';

const database = initDatabase({ file: config.database.file });
applySchema(database);

const tables = getDatabase()
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

const indexes = getDatabase()
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

console.log('数据库初始化完成');
console.log(`  文件路径: ${config.database.file}`);
console.log(`  数据表:   ${tables.map((row) => row.name).join(', ') || '（无）'}`);
console.log(`  索引:     ${indexes.map((row) => row.name).join(', ') || '（无）'}`);

// 打印表结构，便于核对字段是否与设计一致
console.log('\ncalculation_history 表结构:');
for (const column of getDatabase().prepare('PRAGMA table_info(calculation_history)').all()) {
  const flags = [
    column.pk ? 'PRIMARY KEY' : '',
    column.notnull ? 'NOT NULL' : '',
  ].filter(Boolean).join(' ');
  console.log(`  ${column.name.padEnd(24)} ${column.type.padEnd(8)} ${flags}`);
}

closeDatabase();
