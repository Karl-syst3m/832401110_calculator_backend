/**
 * Database table schema
 *
 * Table design notes (corresponding to the assignment's required calculation_history: id / expression / result / created_at):
 *
 * | Field                 | Why it is needed                                                             |
 * |-----------------------|------------------------------------------------------------------------------|
 * | id                    | Primary key; the assignment requires "delete the specified record by id", and the front end also uses it as the list key |
 * | expression            | The user's original input, kept as-is so we can echo back "what I was calculating at the time" |
 * | normalized_expression | The normalized expression (× turned into * and so on), so that when troubleshooting one can see what actually took part in the computation |
 * | result                | The numeric result, used by statistics (averages and so on)                   |
 * | result_text           | The textual result, specifically solving the large-number precision problem; the reasoning is below |
 * | is_favorite           | Favorite flag, an extension feature                                           |
 * | created_at            | Computation time, a field required by the assignment, and also the default sort key |
 *
 * Why store both result and result_text?
 * SQLite's REAL is an 8-byte double-precision float; it can itself hold integers above 2^53, but as soon
 * as it is read back into JavaScript it goes through a double conversion. At a magnitude like 1e18 the
 * value is already beyond the safe integer range, so displaying REAL directly yields a number whose
 * mantissa has been flattened (such as 1152921504610000000).
 * result_text, by contrast, is the string we carefully formatted with formatNumber, identical to what was
 * displayed at the moment of computation.
 * Hence the convention: **display always uses result_text, statistical computation always uses result**,
 * each doing its own job.
 *
 * Index notes:
 *   - created_at DESC: the history list paginates by time descending by default, which is the most frequent query path;
 *   - expression: keyword search and the "most frequently used expression" statistic both use it;
 *   - is_favorite: favorite filtering.
 * More indexes are not better; each must be maintained on write as well, so only the three columns that
 * are genuinely used by queries are created here.
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
 * Create the tables. It uses IF NOT EXISTS, so repeated execution is idempotent;
 * the service calls it once on every startup, with no separate "initialize the database" step.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function applySchema(db) {
  db.exec(SCHEMA_SQL);
}

export default applySchema;
