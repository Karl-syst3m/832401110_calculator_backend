/**
 * Sample data script (optional).
 *
 * Purpose: generate a batch of calculation records covering various situations, to make demonstrating the
 * history list, search, pagination and statistics convenient.
 * It is **not** a required step for the service to run; before a formal demonstration, run
 * `npm run seed:clear` first to clean up, then generate records through real manual use — demonstration
 * screenshots should come from real operation, not from preset data.
 *
 * Usage:
 *   npm run seed          insert sample data (existing records are cleared first)
 *   npm run seed:clear    clear all records
 */

import { initDatabase, getDatabase, closeDatabase } from '../src/db/connection.js';
import { applySchema } from '../src/db/schema.js';
import { calculateAndRecord } from '../src/service/calculator.service.js';
import config from '../src/config/index.js';

/** A set of expressions covering the assignment's demonstration points. */
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
console.log(`Cleared existing records: ${deleted}`);

if (!clearOnly) {
  let inserted = 0;
  let failed = 0;
  for (const expression of SAMPLE_EXPRESSIONS) {
    try {
      calculateAndRecord(expression);
      inserted += 1;
    } catch (error) {
      failed += 1;
      console.warn(`  Skipping ${expression}: ${error.message}`);
    }
  }
  console.log(`Inserted sample records: ${inserted} (failed: ${failed})`);
}

const total = getDatabase().prepare('SELECT COUNT(*) AS total FROM calculation_history').get().total;
console.log(`Current total records: ${total}`);

closeDatabase();
