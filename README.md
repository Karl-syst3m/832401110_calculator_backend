# Calculator System · Backend (Calculator Backend)

The **back-end service** of a front-end/back-end separated calculator system. It handles expression validation, parsing, evaluation, and error handling,
as well as the persistence and retrieval of calculation history. All numeric computation happens here; the front end does not take part in any calculation.

> This project is the back-end part of the first assignment of the software engineering course, "Front-End/Back-End Separated Calculator System".
> See the companion project `calculator_frontend` for the front-end repository.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Runtime Requirements](#runtime-requirements)
- [Installation](#installation)
- [Starting the Service](#starting-the-service)
- [Configuration](#configuration)
- [Database Initialization](#database-initialization)
- [Front-End / Back-End Connection](#front-end--back-end-connection)
- [API Reference](#api-reference)
- [Response Conventions](#response-conventions)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Design Notes](#design-notes)
- [FAQ](#faq)

---

## Features

### Required Features

| Feature | Description | Implementation Location |
| --- | --- | --- |
| Basic calculation | The four operations: addition, subtraction, multiplication, division | `src/calculator/evaluator.js` |
| Compound expressions | Operator precedence, parentheses, unary plus/minus, decimals | `src/calculator/parser.js` |
| History records | Every successful calculation is written to the SQLite database | `src/service/calculator.service.js` |
| Record deletion | Delete a specific record by id; clearing everything is also supported | `src/service/history.service.js` |
| Error handling | Invalid expressions, division by zero, domain errors, result overflow | `src/calculator/errors.js` |
| Unified responses | Standardized response bodies and HTTP status codes | `src/middleware/errorHandler.js` |

### Extended Features

| Feature | Description |
| --- | --- |
| Scientific calculation | `sqrt` `abs` `sin` `cos` `tan` `asin` `acos` `atan` `ln` `log` `log2` `exp` `pow` `hypot` `sign` `mod` `round` `floor` `ceil` `min` `max` `fact`, the constants `pi` `e` `tau`, and the exponentiation operator `^` |
| Base conversion | Conversion between any bases from 2 to 36; the integer part uses BigInt to guarantee exactness |
| Unit conversion | 8 categories in total: length, mass, area, volume, time, data, speed, temperature |
| History search | Fuzzy search by expression or result text (LIKE wildcards are already escaped) |
| Pagination | `page` / `pageSize`, with an upper bound on `pageSize` to prevent memory exhaustion |
| Sorting | Sort by time, result, or id; fields go through whitelist validation |
| Favorites | Mark frequently used calculation records |
| Statistics | Total record count, today's calculations, average, most frequent expression, and so on, all aggregated by SQL |
| Health check | Used for deployment verification and front-end status indication |

---

## Tech Stack

| Layer | Choice | Description |
| --- | --- | --- |
| Runtime | Node.js ≥ 22.5.0 | Requires the built-in `node:sqlite` module |
| Web framework | Express 4 | One of the back-end frameworks permitted by the course |
| Database | SQLite (the built-in `node:sqlite` module) | Zero configuration, zero native compilation |
| Testing | `node:test` + `node:assert` | Built into Node; no third-party test framework |
| Module format | ES Module (`import` / `export`) | Modern style kept consistent with the front end |

**Express is the only runtime dependency.** The database driver is a Node built-in module, so
`npm install` does not trigger any native module compilation. This is a deliberate engineering trade-off in this project; for the reasoning see
[Design Notes](#design-notes).

---

## Runtime Requirements

- **Node.js ≥ 22.5.0** (`node:sqlite` is available from this version onward; 22 LTS or 24 is recommended)
- Operating system: Windows / macOS / Linux all work
- No separate database service needs to be installed

Check the Node version:

```bash
node -v
```

If the version is lower than 22.5.0, the service prints a clear message at startup. Installing Node 22 or 24 with [nvm](https://github.com/nvm-sh/nvm)
([nvm-windows](https://github.com/coreybutler/nvm-windows) on Windows) is recommended:

```bash
nvm install 22
nvm use 22
```

---

## Installation

```bash
cd calculator_backend
npm install
```

After installation only `express` and a few of its dependencies are present, and no native module is compiled.

---

## Starting the Service

```bash
# Production mode
npm start

# Development mode (automatically restarts on file changes)
npm run dev
```

After a successful start the terminal prints:

```
2026-10-04T16:53:47.000Z [INFO] [db] Database opened: /path/to/data/calculator.sqlite
2026-10-04T16:53:47.010Z [INFO] [server] Calculator backend started: http://127.0.0.1:5000
2026-10-04T16:53:47.010Z [INFO] [server] Health check: http://127.0.0.1:5000/api/health
```

Verify that the service is healthy:

```bash
curl http://127.0.0.1:5000/api/health
```

Expected response:

```json
{
  "success": true,
  "service": "calculator-backend",
  "status": "ok",
  "database": "ok",
  "historyCount": 0,
  "uptimeSeconds": 5,
  "nodeVersion": "v22.20.0",
  "timestamp": "2026-10-04T16:53:52.000Z"
}
```

---

## Configuration

All configuration is supplied through **environment variables**, each with a sensible default, so local development can start with zero configuration.
The defaults are defined together in `src/config/index.js`.

| Environment Variable | Default Value | Description |
| --- | --- | --- |
| `PORT` | `5000` | Port the service listens on |
| `HOST` | `127.0.0.1` | Listen address. In production it is recommended to keep the loopback address and let nginx serve external traffic as the reverse proxy |
| `NODE_ENV` | `development` | When set to `production`, 500 errors no longer return the raw error message |
| `DB_FILE` | `<project root>/data/calculator.sqlite` | Path to the SQLite data file; set it to `:memory:` to use an in-memory database |
| `CORS_ORIGINS` | see below | Origins allowed for CORS, comma-separated; leave it empty for same-origin deployment |
| `BODY_LIMIT` | `64kb` | Maximum request body size |
| `LOG_LEVEL` | `info` | Log level: `error` / `warn` / `info` / `debug` |
| `MAX_EXPRESSION_LENGTH` | `200` | Maximum length of a single expression |

Default value of `CORS_ORIGINS`:

```
http://localhost:5500,http://127.0.0.1:5500,http://localhost:8080,http://127.0.0.1:8080
```

Usage example:

```bash
# Linux / macOS
PORT=8080 DB_FILE=/var/lib/calculator/calculator.sqlite npm start

# Windows PowerShell
$env:PORT=8080; $env:DB_FILE="C:\data\calculator.sqlite"; npm start
```

> **About CORS**: if nginx serves the front-end pages and `/api` under the same domain (the recommended
> approach), the browser will not issue cross-origin requests, so `CORS_ORIGINS` can stay at its default with no extra configuration.

---

## Database Initialization

**No manual initialization is required.** The service runs an idempotent table-creation statement on every startup:

- The data file is created automatically when it does not exist
- The `data/` directory is created automatically when it does not exist
- Nothing is changed when the tables already exist

To inspect the table schema on its own:

```bash
npm run init-db
```

Example output:

```
Database initialization complete
  File path: /path/to/data/calculator.sqlite
  Tables:    calculation_history
  Indexes:   idx_history_created_at, idx_history_expression, idx_history_favorite

calculation_history table schema:
  id                      INTEGER  PRIMARY KEY
  expression              TEXT     NOT NULL
  normalized_expression   TEXT     NOT NULL
  result                  REAL     NOT NULL
  result_text             TEXT     NOT NULL
  is_favorite             INTEGER  NOT NULL
  created_at              TEXT     NOT NULL
```

### Table Design Notes

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Primary key, auto-increment. The delete endpoint uses it to locate a record |
| `expression` | TEXT | The user's raw input, preserved as-is for echo-back |
| `normalized_expression` | TEXT | The normalized expression (`×` → `*`), which makes troubleshooting easier |
| `result` | REAL | The numeric result, used for statistical aggregation |
| `result_text` | TEXT | The text result; this is authoritative for display |
| `is_favorite` | INTEGER | Favorite flag (0/1), an extended feature |
| `created_at` | TEXT | Calculation time, in ISO 8601 UTC format |

> **Why store both `result` and `result_text`?**
> SQLite's `REAL` is a double-precision float, and reading it back into JavaScript loses mantissa
> precision for magnitudes such as `1e18`. `result_text` is the formatted string, identical to what the interface displayed at the moment of calculation.
> Convention: **use `result_text` for display and `result` for statistics**.

### Sample Data (Optional)

Demonstrating the history list, search, and pagination requires some data:

```bash
npm run seed          # Insert about 27 sample records covering various cases
npm run seed:clear    # Clear all records
```

> Before taking screenshots for the final demonstration, it is recommended to run `npm run seed:clear` and then generate records through real manual
> operations—screenshots should come from actual use, not from preloaded data.

---

## Front-End / Back-End Connection

```
Browser (front end :5500)
        │  HTTP / JSON
        │  POST /api/calculate  { "expression": "1+2*3" }
        ▼
Back-end service (Express :5000)
        │  SQL
        ▼
SQLite database (data/calculator.sqlite)
```

The front end reaches the back end through an environment-dependent address; the rule is determined by `src/js/config.js` in the front-end repository:

| Front-End Runtime Mode | Request Address |
| --- | --- |
| Local development (`http://127.0.0.1:5500`) | `http://127.0.0.1:5000/api` |
| nginx same-origin deployment | `/api` (relative path, no CORS) |
| Other | Can be temporarily overridden with `?api=http://host:port/api` |

**Local integration steps:**

1. Start the back end in terminal A: `cd calculator_backend && npm start`
2. Start the front end in terminal B: `cd calculator_frontend && npm run dev`
3. Open `http://127.0.0.1:5500` in the browser
4. The status indicator in the top-right corner of the page header should show a green "Backend OK · N records"

---

## API Reference

All endpoints share the prefix `/api`.

### `GET /api/health` — Health Check

No parameters. Returns the service and database status.

```json
{
  "success": true,
  "service": "calculator-backend",
  "status": "ok",
  "database": "ok",
  "historyCount": 12,
  "uptimeSeconds": 305,
  "nodeVersion": "v24.15.0",
  "timestamp": "2026-10-04T16:53:52.000Z"
}
```

### `POST /api/calculate` — Evaluate an Expression

**Request body**

```json
{ "expression": "(1+2)*3" }
```

**Success response `201 Created`**

```json
{
  "success": true,
  "id": 12,
  "expression": "(1+2)*3",
  "normalizedExpression": "(1+2)*3",
  "result": 9,
  "resultText": "9",
  "createdAt": "2026-10-04T16:53:52.000Z"
}
```

**Failure response `400 Bad Request`**

```json
{
  "success": false,
  "code": "DIVISION_BY_ZERO",
  "message": "Division by zero is not allowed.",
  "detail": { "operation": "Division", "dividend": 1, "divisor": 0 }
}
```

> It returns `201` rather than `200`: besides computing the result, this request also **created a history
> record** as a new resource and returned its `id`. By HTTP semantics, producing a new resource should use `201 Created`.

### `GET /api/history` — Query History Records

**Query parameters**

| Parameter | Type | Default Value | Description |
| --- | --- | --- | --- |
| `page` | integer | `1` | Page number, starting from 1 |
| `pageSize` | integer | `20` | Records per page, maximum 100 (higher values are clamped to 100) |
| `keyword` | string | empty | Keyword, matched against the expression or the result text |
| `favoriteOnly` | boolean | `false` | Show favorites only; pass `true` or `1` |
| `sortBy` | string | `createdAt` | Sort field: `createdAt` / `result` / `id` |
| `order` | string | `desc` | Sort direction: `asc` / `desc` |

**Success response `200 OK`**

```json
{
  "success": true,
  "items": [
    {
      "id": 12,
      "expression": "(1+2)*3",
      "normalizedExpression": "(1+2)*3",
      "result": 9,
      "resultText": "9",
      "isFavorite": false,
      "createdAt": "2026-10-04T16:53:52.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "filters": { "keyword": "", "favoriteOnly": false, "sortBy": "createdAt", "order": "desc" }
}
```

### `GET /api/history/stats` — Summary Statistics

```json
{
  "success": true,
  "stats": {
    "total": 27,
    "favorites": 3,
    "today": 12,
    "distinctExpressions": 23,
    "averageResult": 92.02,
    "firstAt": "2026-10-04T16:53:59.358Z",
    "latestAt": "2026-10-04T16:55:04.079Z",
    "mostFrequentExpression": "(1+2)*3",
    "mostFrequentCount": 2,
    "timezone": "UTC"
  }
}
```

> `today` is counted by the **UTC day boundary**, so the response body carries a `timezone` field that makes the convention explicit.

### `DELETE /api/history/:id` — Delete a Specific Record

**Success response `200 OK`**

```json
{ "success": true, "id": 12, "deleted": 1 }
```

**Record does not exist `404 Not Found`**

```json
{
  "success": false,
  "code": "HISTORY_NOT_FOUND",
  "message": "History record with id 999999 does not exist.",
  "detail": { "id": 999999 }
}
```

> When a record does not exist it returns 404 rather than pretending to succeed. Otherwise the front end deleting a nonexistent id
> would believe it had been deleted when in fact nothing happened—this kind of "false success" is the hardest to debug.

### `DELETE /api/history` — Clear All Records

```json
{ "success": true, "deleted": 27 }
```

### `PATCH /api/history/:id/favorite` — Toggle Favorite

**Request body** (may be omitted; when omitted, the value is treated as a toggle)

```json
{ "isFavorite": true }
```

**Success response `200 OK`**

```json
{ "success": true, "item": { "id": 12, "isFavorite": true, "...": "..." } }
```

### `GET /api/convert/units` — Query the Supported Unit List

Returns all conversion categories and units, for the front end to render its dropdowns.

```json
{
  "success": true,
  "categories": [
    {
      "key": "temperature",
      "label": "Temperature",
      "kind": "affine",
      "units": [
        { "key": "c", "label": "Celsius" },
        { "key": "f", "label": "Fahrenheit" },
        { "key": "k", "label": "Kelvin" }
      ]
    }
  ]
}
```

### `POST /api/convert/base` — Base Conversion

**Request body**

```json
{ "value": "ff", "fromBase": 16, "toBase": 10 }
```

**Response**

```json
{ "success": true, "input": "ff", "fromBase": 16, "toBase": 10, "output": "255", "decimalValue": "255" }
```

### `POST /api/convert/unit` — Unit Conversion

**Request body**

```json
{ "category": "temperature", "from": "c", "to": "f", "value": 100 }
```

**Response**

```json
{ "success": true, "category": "temperature", "from": "c", "to": "f", "input": 100, "output": 212, "outputText": "212" }
```

---

## Response Conventions

### Status Codes

| Status Code | Usage Scenario |
| --- | --- |
| `200 OK` | Successful query, successful deletion |
| `201 Created` | Calculation succeeded and a history record was created |
| `204 No Content` | CORS preflight request (`OPTIONS`) |
| `400 Bad Request` | Invalid expression, invalid parameter, or a request body that is not valid JSON |
| `404 Not Found` | Record does not exist, endpoint path does not exist |
| `413 Payload Too Large` | Request body exceeds the limit |
| `500 Internal Server Error` | Unexpected server-side exception |
| `503 Service Unavailable` | The health check found the database unavailable |

### Error Codes

The `code` in the response body is a stable, machine-readable identifier that the front end uses for message localization.

| Error Code | Meaning |
| --- | --- |
| `EXPRESSION_REQUIRED` | The `expression` field is missing or empty |
| `EXPRESSION_TOO_LONG` | The expression exceeds the maximum length |
| `EXPRESSION_TOO_DEEP` | Parenthesis nesting exceeds 64 levels |
| `ILLEGAL_CHARACTER` | An unrecognizable character appears (`detail.position` gives its position) |
| `UNEXPECTED_TOKEN` | A token is in the wrong position (for example `1+2)`) |
| `UNEXPECTED_END` | The expression ends prematurely (for example `1+`) |
| `UNBALANCED_PARENTHESIS` | Parentheses are not balanced |
| `UNKNOWN_IDENTIFIER` | Unknown function or constant name |
| `BAD_ARGUMENT_COUNT` | Wrong number of function arguments |
| `DIVISION_BY_ZERO` | Division by zero |
| `DOMAIN_ERROR` | Domain error (such as `sqrt(-1)`, `ln(0)`) |
| `RESULT_NOT_FINITE` | The result is outside the representable double-precision range |
| `INVALID_HISTORY_ID` | The history record id is not a positive integer |
| `HISTORY_NOT_FOUND` | No record exists with the specified id |
| `INVALID_PAGINATION` | Invalid pagination parameter |
| `MALFORMED_JSON` | The request body is not valid JSON |
| `INVALID_BASE_CONVERSION` | Invalid base conversion parameter |
| `INVALID_UNIT_CONVERSION` | Invalid unit conversion parameter |
| `ROUTE_NOT_FOUND` | The requested endpoint path does not exist |
| `INTERNAL_ERROR` | Internal server error |

---

## Project Structure

```
calculator_backend/
├── src/
│   ├── server.js                 # Entry point: connect to the database, create tables, listen on the port, graceful shutdown
│   ├── app.js                    # Express app assembly (middleware and route ordering)
│   ├── config/
│   │   └── index.js              # Centralized configuration (environment variables -> config object)
│   ├── calculator/               # ★ Calculation core: depends on neither HTTP nor the database
│   │   ├── index.js              # Facade for the calculation pipeline: calculate()
│   │   ├── tokenizer.js          # Lexical analysis: characters -> tokens
│   │   ├── parser.js             # Syntax analysis: recursive descent, tokens -> abstract syntax tree
│   │   ├── evaluator.js          # Evaluation: syntax tree -> numeric value (function whitelist)
│   │   ├── format.js             # Numeric normalization and formatting
│   │   └── errors.js             # Calculation domain errors and error codes
│   ├── db/
│   │   ├── connection.js         # Database connection, PRAGMA settings
│   │   └── schema.js             # Table-creation statements and indexes
│   ├── model/
│   │   └── history.model.js      # Data access layer: the only place where SQL is written
│   ├── service/                  # Business orchestration
│   │   ├── calculator.service.js # Calculate first, persist only after success
│   │   ├── history.service.js    # Pagination validation, 404 determination, favorite toggling
│   │   └── conversion.service.js # Base conversion, unit conversion
│   ├── controller/               # Handles HTTP input and output only
│   │   ├── calculator.controller.js
│   │   ├── history.controller.js
│   │   ├── conversion.controller.js
│   │   └── health.controller.js
│   ├── middleware/
│   │   ├── cors.js               # CORS whitelist
│   │   ├── requestLogger.js      # Request logging
│   │   └── errorHandler.js       # Unified error handling and status code mapping
│   ├── routes/
│   │   └── index.js              # Route table
│   ├── data/
│   │   └── units.js              # Static definition table for unit conversion
│   └── utils/
│       └── logger.js             # Minimal structured logging
├── tests/
│   ├── calculator.test.js        # Unit tests for the calculation core (including security tests)
│   └── api.test.js               # API integration tests
├── scripts/
│   ├── init-db.js                # Inspect/initialize the table schema
│   └── seed.js                   # Sample data
├── data/                         # Database file generated at runtime (not committed)
├── package.json
├── codestyle.md
└── README.md
```

### Layering and Dependency Direction

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator (pure computation, no external dependencies)
```

Dependencies may only point from top to bottom. `calculator/` knows neither HTTP nor the database,
so it can be tested on its own without the server—which is also why it can be covered quickly by more than 60 unit tests.

---

## Testing

```bash
npm test
```

It uses Node's built-in test runner, so no test framework needs to be installed.

**Test coverage:**

| Test File | Number of Cases | Coverage |
| --- | --- | --- |
| `tests/calculator.test.js` | about 60 | The four arithmetic operations, precedence, parentheses, unary plus/minus, decimals, scientific notation, exponentiation, scientific functions, all error branches, security (prototype-chain attacks, malicious payloads) |
| `tests/api.test.js` | about 60 | Success and failure paths of every endpoint, status codes, error codes, pagination boundaries, database-authenticity checks, CORS |

**Two tests deserve special attention:**

1. **`No eval / new Function calls exist in the source`**
   It reads the source of `src/calculator/*.js` line by line (skipping comment lines),
   mechanically guaranteeing that nobody can quietly add `eval` back later. This is more reliable than manual review.

2. **`Prototype-chain properties cannot impersonate whitelist entries`**
   This test stems from a real defect that was fixed: the original implementation was written as `CONSTANTS[name] !== undefined`,
   so the input `constructor` would hit `Object.prototype.constructor` on the prototype chain,
   bypassing the "unknown identifier" check. The fix was to change every whitelist lookup to `Object.hasOwn`.
   The test covers 8 names including `constructor` / `toString` / `valueOf` / `__proto__`.

---

## Design Notes

### 1. Why hand-write an expression parser instead of using a third-party library?

The assignment explicitly **prohibits arbitrary code execution mechanisms such as `eval` / `exec`**. On top of that there were three options:

| Option | Assessment |
| --- | --- |
| `eval` / `new Function` | **Prohibited**. It would execute user input as a program, and a single `process.exit()` could bring the service down |
| A third-party math library (such as `mathjs`) | Legal, but it also brings in assignment, units, matrices, and other capabilities, giving an attack surface far larger than a calculator needs |
| **A hand-written recursive descent parser** | **The choice for this project**. The grammar is the code, the structure is clear, it is testable, and the attack surface equals one whitelist |

**The heart of recursive descent is making the code structure isomorphic to mathematical notation**, with each grammar production corresponding to one function:

```
expression     := additive
additive       := multiplicative ( ("+" | "-") multiplicative )*
multiplicative := unary ( ("*" | "/") unary )*
unary          := ("+" | "-") unary | power
power          := primary ( "^" unary )?
primary        := NUMBER | IDENTIFIER | IDENTIFIER "(" arguments ")" | "(" expression ")"
```

Three precedence details that are easy to get wrong:

- `-2^2` should equal `-4` (exponentiate first, then negate) → `unary` must sit **above** `power`;
- `2^3^2` should equal `512` (right-associative) → the exponent part of `power` recursively calls `unary`;
- `2^-3` should be legal (equal to `0.125`) → the exponent must use `unary` rather than `primary` so that it can consume the minus sign.

The three constrain one another and must hold at the same time, which is the main value of implementing this ourselves rather than calling a library.

### 2. Why use `node:sqlite` instead of `better-sqlite3`?

`better-sqlite3` is a **native module**; installing it downloads a prebuilt binary that must match Node's ABI version.
When it does not match, it falls back to a local build that requires Python and a C++ toolchain—the most classic failure point in Node project deployment.

`node:sqlite` is a built-in module from Node 22.5 onward, with zero installation and zero compilation.
For a course assignment that requires "the teaching assistant can get it running by following the README",
reducing environment risk to zero matters more than pursuing ecosystem maturity.

The two APIs are highly similar in shape (`prepare` / `run` / `get` / `all`),
so if a version constraint ever forces a switch back to `better-sqlite3`, the changes stay confined to the `src/model/` layer.

### 3. Why is the HTTP status code mapping kept separately in the error-handling middleware?

The `CalculatorError` defined in `calculator/errors.js` carries only `code` / `message` / `detail`
and **deliberately does not include an HTTP status code**. The reasons:

- The calculation core can be tested and reused independently of HTTP (switching to a CLI or gRPC later requires no changes);
- "Which error should return 400 versus 404" is a decision of the API layer, and concentrating it in one table makes it easier to review.

The mapping table lives in `CALCULATOR_ERROR_STATUS` in `src/middleware/errorHandler.js`.

### 4. Numeric Precision: The Trade-Off of 12 Significant Digits

Under IEEE-754 double precision, `0.1 + 0.2` equals `0.30000000000000004`.
Displaying that directly makes people think the calculation is wrong.

The approach is to round the result to **12 significant digits**:

- 12 digits is far below the roughly 15.95 significant digits of double precision, so for the vast majority of expressions no precision the user cares about is lost;
- It is also large enough to preserve the meaningful information in results such as `1/3 = 0.333333333333`.

This is a trade-off **oriented toward human reading** rather than a pursuit of complete mathematical exactness.
Truly exact decimal arithmetic would require bringing in an implementation such as `decimal.js`, which would be over-engineering for a course assignment.
See `src/calculator/format.js` for the implementation.

### 5. BigInt for Base Conversion of Large Integers

JavaScript's `Number` can only represent integers up to 2^53 exactly.
A 16-digit hexadecimal number (such as `ffffffffffffffff`) is far beyond that range,
and converting it with `Number` yields a wrong result with the last digits flattened.

`parseInBase` therefore uses `BigInt` to accumulate the integer part digit by digit, guaranteeing exactness at any length:

```
ffffffffffffffff (16) -> 18446744073709551615 (10)
```

The fractional part is still handled in double precision—fractional conversion is inherently approximate (`0.1` is an infinite repeating fraction in binary),
and representing it with finite precision is standard industry practice.

---

## FAQ

### Startup error `Cannot find module 'node:sqlite'`

The Node version is below 22.5.0. Run `node -v` to confirm, then upgrade Node (22 LTS or 24 is recommended).

### Port already in use `EADDRINUSE`

Start on a different port:

```bash
# Linux / macOS
PORT=5001 npm start

# Windows PowerShell
$env:PORT=5001; npm start
```

### The front-end page shows "Cannot connect to the back-end service"

1. Confirm the back end is running: `curl http://127.0.0.1:5000/api/health`
2. Confirm the port matches the convention in the front end's `src/js/config.js` (5000 by default)
3. If the front end is deployed on another domain, check whether `CORS_ORIGINS` includes that origin

### History records are empty

The database is empty the first time the service starts, so one successful calculation must be performed first.
Failed calculations (such as `1/0`) are not written to history, and this is intentional—the assignment requires that every **successful** calculation be written to the database.
If demo data needs to be generated in one go, run `npm run seed`.

### Resetting the database

Stop the service and delete the data file; it is recreated automatically on the next startup:

```bash
rm -f data/calculator.sqlite data/calculator.sqlite-wal data/calculator.sqlite-shm
```

---

## Related Documentation

- [codestyle.md](./codestyle.md) — Coding style (based on the Google JavaScript Style Guide)
- Front-end repository: `calculator_frontend`
