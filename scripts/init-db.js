/**
 * Database initialization script.
 *
 * The service creates the tables automatically on startup, so under the normal flow this script does not
 * need to be run separately.
 * Its reason to exist is "verifying the table schema on its own":
 *   when the teaching assistant or a developer wants to confirm exactly which tables and indexes were
 *   created in the database, running `npm run init-db` once shows the result, without actually starting the
 *   HTTP service.
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

console.log('Database initialization complete');
console.log(`  File path: ${config.database.file}`);
console.log(`  Tables:    ${tables.map((row) => row.name).join(', ') || '(none)'}`);
console.log(`  Indexes:   ${indexes.map((row) => row.name).join(', ') || '(none)'}`);

// Print the table schema so the fields can be checked against the design
console.log('\ncalculation_history table schema:');
for (const column of getDatabase().prepare('PRAGMA table_info(calculation_history)').all()) {
  const flags = [
    column.pk ? 'PRIMARY KEY' : '',
    column.notnull ? 'NOT NULL' : '',
  ].filter(Boolean).join(' ');
  console.log(`  ${column.name.padEnd(24)} ${column.type.padEnd(8)} ${flags}`);
}

closeDatabase();
