# Backend Code Conventions (Calculator Backend Codestyle)

## Sources of the Conventions

The conventions in this document are based on the following public standards, with trade-offs
and refinements made for this project's technology stack:

| Source | Version / Link | Scope Adopted |
| --- | --- | --- |
| **Google JavaScript Style Guide** | https://google.github.io/styleguide/jsguide.html | **Primary basis.** Naming, file structure, import order, comments, language feature restrictions |
| **Node.js Best Practices** | https://github.com/goldbergyoni/nodebestpractices | Project structure layering, error handling, configuration management, security practices |
| **MDN JavaScript Reference** | https://developer.mozilla.org/zh-CN/docs/Web/JavaScript | Confirming language feature semantics |
| **Airbnb JavaScript Style Guide** | https://github.com/airbnb/javascript | Supplementing areas the Google guide does not cover (such as array/object destructuring habits) |
| **Conventional Commits** | https://www.conventionalcommits.org/ | Commit message format |

**Differences from the Google Guide** (every difference is listed explicitly here, to keep the
reader from being confused):

1. **Use ES Modules rather than CommonJS**. When the Google guide was written CommonJS was still
   the mainstream, but Node 22+ supports ESM stably, and keeping module syntax consistent with the
   frontend reduces the mental cost of switching contexts.
2. **Do not require JSDoc type annotations on every function**. This project does not use
   TypeScript: write JSDoc for functions whose parameters are complex or whose contract is not
   obvious (especially in the `calculator/` and `service/` layers); for small, self-evident
   functions write only an explanatory comment, to avoid comment noise.

All comments, documentation, and commit messages in this project are written in English, matching
the language of instruction.

---

## Table of Contents

- [1. Files and Directories](#1-files-and-directories)
- [2. Naming Conventions](#2-naming-conventions)
- [3. Formatting](#3-formatting)
- [4. Modules and Imports](#4-modules-and-imports)
- [5. Comment Conventions](#5-comment-conventions)
- [6. Language Feature Restrictions](#6-language-feature-restrictions)
- [7. Error Handling](#7-error-handling)
- [8. Security Conventions](#8-security-conventions)
- [9. Async and Database](#9-async-and-database)
- [10. Layered Architecture Constraints](#10-layered-architecture-constraints)
- [11. Git Commit Conventions](#11-git-commit-conventions)
- [12. Pre-Commit Checklist](#12-pre-commit-checklist)

---

## 1. Files and Directories

### 1.1 File Names

- **All lowercase, with words separated by hyphens or dots**. Do not use camelCase, to avoid a
  clash between `UserModel.js` and `usermodel.js` on case-insensitive filesystems
  (the Windows and macOS defaults).
- A **responsibility suffix** reflects the file's role and makes it easy to locate a file by name:

```
history.model.js        # data access layer
history.service.js      # business layer
history.controller.js   # API layer
errorHandler.js         # middleware
calculator.test.js      # tests
dev-server.mjs          # standalone executable script
```

### 1.2 Directory Organization

Split by **responsibility** rather than by **technical type**. Related code for the same feature
sits next to each other, instead of putting all functions in one directory and all constants in
another:

```
src/
├── calculator/     computation core (pure logic, no IO)
├── db/             database connection and table schema
├── model/          data access
├── service/        business orchestration
├── controller/     HTTP input/output
├── middleware/     middleware
├── routes/         route table
├── data/           static configuration data
└── utils/          generic utilities with no business meaning
```

### 1.3 One Primary Responsibility per File

A single file should preferably not exceed 400 lines. When it goes over, first consider whether
multiple responsibilities have been mixed together, rather than simply splitting the file into
`xxx-part1.js`.

---

## 2. Naming Conventions

### 2.1 Naming Style Overview

| Object | Style | Example |
| --- | --- | --- |
| Variables, functions | `lowerCamelCase` | `expressionInput`, `calculateAndRecord` |
| Classes | `UpperCamelCase` | `CalculatorError`, `AppError` |
| Constants (module-level immutable values) | `UPPER_SNAKE_CASE` | `MAX_DEPTH`, `SIGNIFICANT_DIGITS` |
| Module-level private variables | **Do not use** the `_` prefix; use non-exporting instead | See 2.3 |
| Database fields | `snake_case` | `normalized_expression` |
| API JSON fields | `lowerCamelCase` | `normalizedExpression` |
| Booleans | Start with `is` / `has` / `can` / `should` | `isFavorite`, `hasFraction` |
| Event handler functions | `handle` + event name | `handleKeypadClick` |
| Test descriptions | English, describing behavior rather than implementation | `'division by zero returns 400 with a specific error code'` |

### 2.2 Names Must Carry Information

```javascript
// ✅ Good: the name says what it is and what its unit is
const requestTimeoutMs = 10000;
const HISTORY_PAGE_SIZE_MAX = 100;

// ❌ Bad: names like data, info, temp, flag convey no information at all
const data = await fetch(url);
const flag = true;
```

> Exception: inside very short local scopes (such as a `map` callback), short names like `x` and `item` are allowed.

### 2.3 Private Members

Do not use a `_` prefix to mark something private. Non-exported variables in module scope are
private by nature:

```javascript
// ✅ Export only what is needed; leave the rest in module scope
const INTERNAL_CACHE = new Map();
export function getFromCache(key) { /* ... */ }
```

For fields inside a class that genuinely need to be hidden, use `#` private fields (native
ECMAScript syntax).

### 2.4 Mapping Between Database Fields and API Fields

The database uses `snake_case` and the API uses `lowerCamelCase`; **the conversion happens only in
the model layer**:

```javascript
// src/model/history.model.js
function mapRow(row) {
  return {
    id: Number(row.id),
    normalizedExpression: row.normalized_expression,  // snake -> camel
    isFavorite: row.is_favorite === 1,                // 0/1 -> boolean
  };
}
```

This way the frontend never sees underscore fields, and changing a database column name does not
ripple out to the frontend either.

---

## 3. Formatting

### 3.1 Indentation and Line Width

- Indent with **2 spaces** (as the Google guide specifies, no tabs).
- A single line must not exceed **100 characters**. When it does, wrap at a semantic boundary
  rather than hard-breaking in the middle of an operator.

### 3.2 Semicolons

**Semicolons are mandatory.** JavaScript's automatic semicolon insertion (ASI) produces
unexpected results in the following cases:

```javascript
// ❌ Dangerous: this is parsed as return; followed by a standalone expression
return
  { value: 1 }

// ✅ Correct
return { value: 1 };
```

### 3.3 Quotes

- Use **single quotes** consistently throughout the code.
- When a string contains a single quote, use a template literal rather than escaping it:

```javascript
const message = `History id must be a positive integer, received "${rawId}".`;
```

### 3.4 Trailing Commas

**Keep trailing commas** in multi-line arrays and objects. This way, when an item is added to or
removed from the end, the Git diff shows only a one-line change instead of two:

```javascript
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',          // <- trailing comma
});
```

### 3.5 Blank Lines

- Between functions: 1 blank line
- Between logical sections: 1 blank line
- At end of file: 1 newline character (to avoid the diff showing `\ No newline at end of file`)
- **No more than 1 consecutive blank line**

---

## 4. Modules and Imports

### 4.1 Use ES Modules

```javascript
// ✅
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function calculate() {}

// ❌ Do not mix in CommonJS
const path = require('path');
```

### 4.2 Import Order

Group imports in the following order, with one blank line between groups. Identify built-in
modules explicitly with the `node:` prefix:

```javascript
// 1. Node built-in modules (must carry the node: prefix)
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// 2. Third-party dependencies
import express from 'express';

// 3. Project-internal modules (top to bottom along the dependency direction)
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { insertHistory } from '../model/history.model.js';
```

> What the `node:` prefix does: it tells built-in modules apart at a glance from an npm package
> that happens to share the name, and it prevents being hijacked by a third-party package with the same name.

### 4.3 Imports Must Include the File Extension

ESM requires relative imports to spell out the `.js` suffix:

```javascript
import { calculate } from './calculator/index.js';   // ✅
import { calculate } from './calculator';            // ❌ fails at runtime
```

### 4.4 Circular Dependencies Are Forbidden

The dependency direction must be one-way:

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator
```

If two modules import each other, that means the division of responsibilities is wrong; the shared
part should be extracted into a lower layer.

---

## 5. Comment Conventions

### 5.1 Comments Explain "Why", Not "What"

This is the single most important comment convention in this project.

```javascript
// ❌ Worthless: the code already says this clearly
// increment i by 1
i += 1;

// ✅ Worthwhile: it explains a non-obvious trade-off
// 12 digits is far below the roughly 15.95 significant decimal digits of a double, so it
// loses no precision for the vast majority of expressions, and is large enough to retain
// the meaningful information in results such as 1/3 = 0.333333333333.
const SIGNIFICANT_DIGITS = 12;
```

### 5.2 When to Use JSDoc

Cases where JSDoc is **mandatory**:

- Exported functions whose parameters or return value are not intuitively obvious
- Functions that throw exceptions (write `@throws`)
- Class constructors

Cases where it is **not required**: self-evident small utility functions and internal callbacks.

```javascript
/**
 * Computes a mathematical expression.
 *
 * @param {unknown} rawExpression the raw expression sent from the frontend
 * @param {object} [options]
 * @param {number} [options.maxLength] maximum length
 * @returns {{value: number, valueText: string, ast: object}}
 * @throws {CalculatorError} thrown when the expression is invalid or cannot be computed
 */
export function calculate(rawExpression, options = {}) { /* ... */ }
```

### 5.3 Security-Related Code Must Document the Reason

Any defensive code must state **what it is defending against**, otherwise later readers will treat
it as a redundant check and delete it:

```javascript
// You must test with Object.hasOwn; testing only !== undefined is not enough.
// Reason: CONSTANTS is a plain object, and properties such as constructor / toString
// hang on its prototype chain. Reading the value directly would let the input
// "constructor" hit a prototype-chain property and bypass the whitelist check.
const value = Object.hasOwn(CONSTANTS, node.name) ? CONSTANTS[node.name] : undefined;
```

### 5.4 TODO Markers

Mark unfinished items uniformly with a leading `TODO:` and state the reason:

```javascript
// TODO: support switching between radian and degree mode; this requires adding a toggle
// in the frontend and passing it through to the API
```

---

## 6. Language Feature Restrictions

### 6.1 Strictly Forbidden Features

| Feature | Reason |
| --- | --- |
| `eval()` / `new Function()` | **Explicitly forbidden by the assignment.** It executes user input as code, which is an injection vulnerability |
| `child_process` running concatenated commands | Risk of command injection |
| `node:vm` | Cannot provide a genuinely safe sandbox and is easy to escape |
| `var` | Function scoping readily causes hoisting problems; use `const` / `let` |
| `==` / `!=` | Implicit type coercion readily produces surprises; use `===` / `!==` |
| `with` | Disallowed in strict mode and its scoping is unclear |
| Directly modifying built-in prototypes | Pollutes the global environment and contaminates every dependency |
| Synchronous blocking IO (such as `fs.readFileSync`) on the request path | Blocks the event loop and drags down concurrency |

This project uses one **automated test** to guarantee that `eval`-style calls never come back:

```javascript
// tests/calculator.test.js
test('no eval / new Function calls exist in the source', async () => {
  // read src/calculator/*.js line by line (skipping comment lines) and assert
  // that eval / new Function never appears
});
```

### 6.2 Preferred Constructs

```javascript
// ✅ Prefer const; use let only when reassignment is needed; never use var
const items = [];

// ✅ Destructuring
const { position, character } = error.detail;

// ✅ Optional chaining and nullish coalescing
const message = error?.message ?? 'Unknown error';

// ✅ Template literals
const url = `${baseUrl}/api/history`;

// ✅ Object.hasOwn to test own properties (replacing obj.hasOwnProperty)
if (Object.hasOwn(TABLE, key)) { /* ... */ }

// ✅ Immutable array methods
const doubled = numbers.map((n) => n * 2);
```

### 6.3 Use `Object.hasOwn` When Looking Up Tables

This is a **mandatory rule** in this project, because a real defect has already come out of it
once:

```javascript
// ❌ Wrong: the input "constructor" hits Object.prototype.constructor on the prototype chain
const spec = FUNCTIONS[name];
if (spec !== undefined) { /* the function was used as a number */ }

// ✅ Correct
const spec = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
if (spec === undefined) { /* correct handling of an unknown identifier */ }
```

Scope of application: everywhere a plain object is looked up with user input or an external
parameter as the key.

---

## 7. Error Handling

### 7.1 Error Layering

| Error class | Location | Meaning | Carries an HTTP status code |
| --- | --- | --- | --- |
| `CalculatorError` | `src/calculator/errors.js` | The expression itself is problematic | **No** (deliberate) |
| `AppError` | `src/errors/appError.js` | Resource does not exist, invalid parameter | Yes |

The computation core does not carry HTTP semantics, so that it can be tested and reused
independently of HTTP.

### 7.2 Centrally Managed Status Code Mapping

The **only** place where the mapping lives is `src/middleware/errorHandler.js`. Do not judge the
error type and assemble the response yourself inside a controller:

```javascript
// ❌ Wrong: every controller assembles its own version, so the format will diverge sooner or later
export function calculate(req, res) {
  try {
    /* ... */
  } catch (error) {
    res.status(400).json({ error: error.message });   // missing the code field
  }
}

// ✅ Correct: hand it to the unified error-handling middleware
export function calculate(req, res, next) {
  try {
    /* ... */
  } catch (error) {
    next(error);
  }
}
```

### 7.3 Error Codes Use Constants, Not Bare Strings

```javascript
// ✅
import { ErrorCodes } from './errors.js';
throw new CalculatorError(ErrorCodes.DIVISION_BY_ZERO, 'Division by zero is not allowed.');

// ❌ A typo raises no error; it only shows up at runtime as a "strange error code"
throw new CalculatorError('DIVISON_BY_ZERO', '...');
```

### 7.4 Error Response Format Must Be Uniform

```json
{
  "success": false,
  "code": "DIVISION_BY_ZERO",
  "message": "Division by zero is not allowed.",
  "detail": { "dividend": 1, "divisor": 0 }
}
```

- `code`: a stable, machine-readable identifier that the frontend uses to localize the message
- `message`: an English explanation aimed at the API caller
- `detail`: optional additional context (error position, function name, expected value, etc.);
  omit the field when it is empty

### 7.5 Do Not Swallow Exceptions

```javascript
// ❌ An empty catch is forbidden
try {
  doSomething();
} catch (error) {}

// ✅ At minimum log it, or state explicitly why it can be ignored
try {
  window.localStorage.setItem(key, value);
} catch {
  // In private mode localStorage is unavailable; degrading to not persisting is
  // enough, and there is no need to abort the flow
}
```

### 7.6 500 Errors Must Not Leak Internal Information

In a production environment with `NODE_ENV=production`, the 500 response body returns only a
generic message; the original error information (which may contain file paths or SQL statements)
goes only to the log:

```javascript
config.isProduction ? {} : { originalMessage: error.message }
```

---

## 8. Security Conventions

### 8.1 Always Use Parameter Binding for SQL

```javascript
// ✅ Parameter binding
db.prepare('SELECT * FROM calculation_history WHERE id = ?').get(id);

// ❌ String concatenation (SQL injection)
db.prepare(`SELECT * FROM calculation_history WHERE id = ${id}`).get();
```

The **only exception** is the sort field name and the sort direction — these cannot be bound with
placeholders. The approach is **whitelist validation**:

```javascript
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',
});
const column = Object.hasOwn(SORTABLE_COLUMNS, sortBy)
  ? SORTABLE_COLUMNS[sortBy]
  : SORTABLE_COLUMNS.createdAt;
```

### 8.2 LIKE Wildcards Must Be Escaped

```javascript
// Without escaping, a user searching for "5%" is treated as a fuzzy match for
// "starts with 5"
function escapeLikePattern(keyword) {
  return keyword.replace(/[\\%_]/g, (match) => `\\${match}`);
}
// Use it together with ESCAPE '\' in SQL
```

### 8.3 Trust No Client Input

- Clamp pagination `pageSize` to the maximum on the server side (`Math.min(raw, maxPageSize)`)
- Put an upper bound on expression length and nesting depth
- Put an upper bound on request body size (`bodyLimit`)
- Types must be validated (reject outright when `typeof rawExpression !== 'string'`)

### 8.4 Do Not Execute User Input

This is the core security constraint of this project. Every user-controllable identifier
(function name, constant name, unit name, category name) may only be used for **table lookup**; if
the lookup misses, it is rejected. There is no path anywhere that "fetches a function dynamically
by name".

### 8.5 Turn Off Framework Fingerprinting

```javascript
app.disable('x-powered-by');   // do not tell attackers this is Express
```

### 8.6 CORS Whitelist, Not Wildcards

```javascript
// ✅ Echo the specific origin
res.setHeader('Access-Control-Allow-Origin', origin);
res.setHeader('Vary', 'Origin');   // prevent a cache from serving site A's response to site B

// ❌ Wildcard: any website can bring the user's browser along to call this endpoint
res.setHeader('Access-Control-Allow-Origin', '*');
```

---

## 9. Async and Database

### 9.1 A Single Global Database Connection

Across the whole project, only `src/db/connection.js` holds the database handle; the remaining code
obtains it through `getDatabase()`. This gives "when the connection is opened and when it is
closed" a single source of truth.

### 9.2 Throw on Uninitialized State, Do Not Return `null`

```javascript
export function getDatabase() {
  if (database === null) {
    throw new Error('The database has not been initialized; call initDatabase() first.');
  }
  return database;
}
```

Returning `null` would defer the problem into some request, where it turns into an unexplained
`TypeError`; throwing directly makes it surface immediately during startup.

### 9.3 Write Operations Must Care About the Number of Affected Rows

```javascript
const deleted = statement.run(id).changes;
if (deleted === 0) {
  // the record does not exist — this should be a 404, not a silent success
  throw new AppError(AppErrorCodes.HISTORY_NOT_FOUND, `...`, { status: 404 });
}
```

### 9.4 Graceful Shutdown

The database connection must be closed before the process exits, so that the WAL contents are
written back to the main database file:

```javascript
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

At the same time, set a fallback timeout (10 seconds), so that one hung connection does not cause
systemd to SIGKILL the process in the end.

### 9.5 Store Times Uniformly as ISO 8601 UTC

```javascript
const createdAt = new Date().toISOString();   // ✅
```

The frontend renders it in the user's time zone. If it were stored in the server's local time
zone, the day of a daylight-saving-time switch would be ambiguous.

---

## 10. Layered Architecture Constraints

### 10.1 Dependency Direction

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator
```

**Only top-down dependencies are allowed, and the reverse is forbidden.** The specific
prohibitions:

| Layer | Prohibited |
| --- | --- |
| `calculator/` | Forbidden to import `db/`, `model/`, `express`, `node:http` |
| `model/` | Forbidden to import `express`; forbidden to deal with HTTP concepts (status codes, request objects) |
| `service/` | Forbidden to write SQL directly; must go through `model/` |
| `controller/` | Forbidden to write business rules; forbidden to access the database directly |

### 10.2 Layer Responsibilities at a Glance

| Layer | What it should do | What it should not do |
| --- | --- | --- |
| `calculator/` | Lexing, parsing, evaluation, number formatting | Know that HTTP or a database exists |
| `model/` | SQL, row-to-object mapping | Pagination validity checks, business rules |
| `service/` | Business rules, transaction orchestration, error semantics | Assemble HTTP responses |
| `controller/` | Read the request, call the service, emit output per the convention | Write try/catch and assemble error responses (leave that to the middleware) |

---

## 11. Git Commit Conventions

Adopt the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

<optional body: explain why the change is made this way>
```

**Types**

| Type | Meaning |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting adjustments (no effect on logic) |
| `refactor` | Refactoring (neither fixes a bug nor adds a feature) |
| `test` | Test-related |
| `chore` | Build, dependencies, configuration |

**Example**

```
feat(calculator): support unary sign and right-associative exponentiation

The unary sign sits above power, so that -2^2 yields -4;
power's exponent recursively calls unary, so that 2^3^2 is right-associative to 512, and 2^-3 is valid.
```

**Requirements**

- Write descriptions in English, in the imperative mood, no more than 50 characters
- One commit does one thing only
- Do not commit `node_modules/`, `data/`, or `.env`

---

## 12. Pre-Commit Checklist

The following commands should all pass:

```bash
node --check src/server.js     # syntax check
npm test                        # all tests pass
```

Confirm each item:

- [ ] No leftover `console.log` in `src/` (all logging goes through `utils/logger.js`)
- [ ] No `eval` / `new Function` / `child_process`
- [ ] All SQL uses parameter binding; the dynamic part (the sort field) passes whitelist validation
- [ ] Plain-object lookups use `Object.hasOwn`
- [ ] New error codes have been registered in `ErrorCodes` or `AppErrorCodes`
- [ ] New error codes have a status code annotated in the mapping table in `errorHandler.js`
- [ ] New endpoints have been added to the API documentation in `README.md`
- [ ] Every exported function has a description of its responsibility; non-obvious trade-offs state the reason
- [ ] Sensitive information (keys, passwords, real IPs) is not hardcoded
- [ ] The data files in `data/` have not been `git add`ed
