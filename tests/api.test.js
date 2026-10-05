/**
 * API integration tests
 *
 * This group of tests runs against a real HTTP server, hitting the endpoints with real HTTP requests, and
 * uses in-memory mode (:memory:) for the database to avoid polluting development data and to guarantee that
 * each test file is isolated from the others.
 *
 * Coverage focus:
 *   1. the full path of the four required features (calculation / compound expressions / history / deletion);
 *   2. history records really land in the database (not an in-process cache) — verified by "querying again";
 *   3. whether status codes and error codes match the conventions;
 *   4. whether parameter validation blocks malformed input.
 *
 * Note: environment variables must be set before importing the business modules, because the config module
 * reads process.env the first time it is imported.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DB_FILE = ':memory:';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const { createApp } = await import('../src/app.js');
const { initDatabase, getDatabase, closeDatabase } = await import('../src/db/connection.js');
const { applySchema } = await import('../src/db/schema.js');

let server;
let baseUrl;

/** Send a JSON request and parse the response. */
async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let payload = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, body: payload };
}

/** Clear history so each test starts from a known state. */
async function resetHistory() {
  await api('DELETE', '/api/history');
}

before(async () => {
  initDatabase({ file: ':memory:' });
  applySchema(getDatabase());
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
  closeDatabase();
});

describe('GET /api/health — health check', () => {
  test('returns 200 when the service and database are both healthy', async () => {
    const { status, body } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.database, 'ok');
    assert.equal(body.service, 'calculator-backend');
    assert.equal(typeof body.uptimeSeconds, 'number');
  });
});

describe('POST /api/calculate — Feature 1: basic calculation', () => {
  test('addition returns a result, and the result is computed by the backend', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '12+8' });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.expression, '12+8');
    assert.equal(body.result, 20);
    assert.equal(body.resultText, '20');
    // An id was returned, which means the record has been persisted — direct evidence that the backend is doing the work
    assert.ok(Number.isInteger(body.id) && body.id > 0);
  });

  test('all four basic operations compute correctly', async () => {
    const cases = [
      ['12+8', 20],
      ['12-8', 4],
      ['6*7', 42],
      ['20/4', 5],
    ];
    for (const [expression, expected] of cases) {
      const { status, body } = await api('POST', '/api/calculate', { expression });
      assert.equal(status, 201, `Expression ${expression} should succeed`);
      assert.equal(body.result, expected, `Expression ${expression} produced a wrong result`);
    }
  });

  test('decimal calculation', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1.5*2.4' });
    assert.equal(body.resultText, '3.6');
  });
});

describe('POST /api/calculate — Feature 2: compound expressions', () => {
  test('operator precedence', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1 + 2 * 3' });
    assert.equal(body.result, 7);
  });

  test('parentheses change precedence', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '(1+2)*3' });
    assert.equal(body.result, 9);
  });

  test('unary plus and minus signs', async () => {
    const negative = await api('POST', '/api/calculate', { expression: '-5 + 8' });
    assert.equal(negative.body.result, 3);
    const multiplied = await api('POST', '/api/calculate', { expression: '3 * -2' });
    assert.equal(multiplied.body.result, -6);
  });

  test('the × and ÷ sent by the front end are interpreted correctly by the backend', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '12×8÷3' });
    assert.equal(body.result, 32);
    // The normalized expression is echoed back, making it easy to troubleshoot "the interface shows ×, what is actually computed"
    assert.equal(body.normalizedExpression, '12*8/3');
  });
});

describe('POST /api/calculate — error handling', () => {
  test('division by zero returns 400 with an explicit error code', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '1/0' });
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DIVISION_BY_ZERO');
    assert.ok(body.message.length > 0);
  });

  test('illegal expressions return 400', async () => {
    const cases = [
      ['1+', 'UNEXPECTED_END'],
      ['(1+2', 'UNBALANCED_PARENTHESIS'],
      ['1 @ 2', 'ILLEGAL_CHARACTER'],
      ['sqrt(-1)', 'DOMAIN_ERROR'],
    ];
    for (const [expression, code] of cases) {
      const { status, body } = await api('POST', '/api/calculate', { expression });
      assert.equal(status, 400, `Expression ${expression} should return 400`);
      assert.equal(body.code, code, `Expression ${expression} returned a mismatched error code`);
    }
  });

  test('an illegal character carries its error position', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1 @ 2' });
    assert.equal(body.detail.position, 3);
    assert.equal(body.detail.character, '@');
  });

  test('a missing expression field returns 400 (the front end cannot bypass backend computation)', async () => {
    const { status, body } = await api('POST', '/api/calculate', {});
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_REQUIRED');
  });

  test('a wrong expression type also returns 400', async () => {
    const numeric = await api('POST', '/api/calculate', { expression: 42 });
    assert.equal(numeric.status, 400);
    assert.equal(numeric.body.code, 'EXPRESSION_REQUIRED');

    const array = await api('POST', '/api/calculate', { expression: [1, 2] });
    assert.equal(array.status, 400);
  });

  test('an empty expression returns 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '   ' });
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_REQUIRED');
  });

  test('an over-long expression returns 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '1'.repeat(300) });
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_TOO_LONG');
  });

  test('a request body that is not valid JSON returns 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', '{not JSON');
    assert.equal(status, 400);
    assert.equal(body.code, 'MALFORMED_JSON');
  });
});

describe('History — Feature 3: persistence and queries', () => {
  test('after a successful calculation the matching record can be found', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+2' });
    await api('POST', '/api/calculate', { expression: '5*8' });
    await api('POST', '/api/calculate', { expression: '(2+3)*4' });

    const { status, body } = await api('GET', '/api/history');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.total, 3);
    assert.equal(body.items.length, 3);

    // Time descending by default, so the most recently computed one comes first
    assert.equal(body.items[0].expression, '(2+3)*4');
    assert.equal(body.items[0].result, 20);

    // Every record must contain the three elements required by the assignment: expression, result, time
    for (const item of body.items) {
      assert.equal(typeof item.expression, 'string');
      assert.equal(typeof item.result, 'number');
      assert.equal(typeof item.resultText, 'string');
      assert.ok(!Number.isNaN(Date.parse(item.createdAt)), 'createdAt should be a valid ISO timestamp');
      assert.equal(typeof item.id, 'number');
    }
  });

  test('a failed calculation is not written to history', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+1' });
    await api('POST', '/api/calculate', { expression: '1/0' });
    await api('POST', '/api/calculate', { expression: 'badexpr' });

    const { body } = await api('GET', '/api/history');
    assert.equal(body.total, 1, 'Only successful calculations should be persisted');
    assert.equal(body.items[0].expression, '1+1');
  });

  test('history comes from the database: a direct query matches the data returned by the endpoint', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '7*6' });

    const apiResult = await api('GET', '/api/history');
    const row = getDatabase()
      .prepare('SELECT * FROM calculation_history ORDER BY id DESC LIMIT 1')
      .get();

    assert.equal(row.expression, '7*6');
    assert.equal(row.result, 42);
    assert.equal(Number(row.id), apiResult.body.items[0].id);
  });

  test('pagination', async () => {
    await resetHistory();
    for (let i = 1; i <= 25; i += 1) {
      await api('POST', '/api/calculate', { expression: `${i}+0` });
    }

    const firstPage = await api('GET', '/api/history?page=1&pageSize=10');
    assert.equal(firstPage.body.items.length, 10);
    assert.equal(firstPage.body.total, 25);
    assert.equal(firstPage.body.totalPages, 3);

    const lastPage = await api('GET', '/api/history?page=3&pageSize=10');
    assert.equal(lastPage.body.items.length, 5);

    // Paging must not produce duplicate records
    const firstIds = firstPage.body.items.map((item) => item.id);
    const lastIds = lastPage.body.items.map((item) => item.id);
    assert.equal(firstIds.filter((id) => lastIds.includes(id)).length, 0);
  });

  test('keyword search', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '100+200' });
    await api('POST', '/api/calculate', { expression: '3*3' });
    await api('POST', '/api/calculate', { expression: '1000/10' });

    const { body } = await api('GET', '/api/history?keyword=100');
    assert.equal(body.total, 2);
  });

  test('illegal pagination parameters return 400', async () => {
    const negative = await api('GET', '/api/history?page=-1');
    assert.equal(negative.status, 400);
    assert.equal(negative.body.code, 'INVALID_PAGINATION');

    const notANumber = await api('GET', '/api/history?page=abc');
    assert.equal(notANumber.status, 400);

    const zeroSize = await api('GET', '/api/history?pageSize=0');
    assert.equal(zeroSize.status, 400);
  });

  test('pageSize is forced within the upper limit', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+1' });

    const { body } = await api('GET', '/api/history?pageSize=100000');
    assert.equal(body.pageSize, 100, 'pageSize should be clamped to the configured maximum of 100');
  });
});

describe('History — Feature 4: deletion', () => {
  test('delete the record with the given id', async () => {
    await resetHistory();
    const first = await api('POST', '/api/calculate', { expression: '1+1' });
    await api('POST', '/api/calculate', { expression: '2+2' });
    await api('POST', '/api/calculate', { expression: '3+3' });

    const before = await api('GET', '/api/history');
    assert.equal(before.body.total, 3);

    const deletion = await api('DELETE', `/api/history/${first.body.id}`);
    assert.equal(deletion.status, 200);
    assert.equal(deletion.body.success, true);
    assert.equal(deletion.body.deleted, 1);

    // The front end queries again and should see only 2 left, with the deleted one truly gone from the database
    const after = await api('GET', '/api/history');
    assert.equal(after.body.total, 2);
    assert.equal(
      after.body.items.some((item) => item.id === first.body.id),
      false,
    );

    const row = getDatabase()
      .prepare('SELECT COUNT(*) AS total FROM calculation_history WHERE id = ?')
      .get(first.body.id);
    assert.equal(Number(row.total), 0, 'The row should really be deleted from the database');
  });

  test('deleting a nonexistent id returns 404', async () => {
    const { status, body } = await api('DELETE', '/api/history/999999');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'HISTORY_NOT_FOUND');
  });

  test('an illegal id returns 400 rather than 404', async () => {
    const notANumber = await api('DELETE', '/api/history/abc');
    assert.equal(notANumber.status, 400);
    assert.equal(notANumber.body.code, 'INVALID_HISTORY_ID');

    const negative = await api('DELETE', '/api/history/-5');
    assert.equal(negative.status, 400);
  });

  test('clear all history', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+1' });
    await api('POST', '/api/calculate', { expression: '2+2' });

    const cleared = await api('DELETE', '/api/history');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.deleted, 2);

    const after = await api('GET', '/api/history');
    assert.equal(after.body.total, 0);
  });
});

describe('Extension features: favorites and statistics', () => {
  test('toggle the favorite state', async () => {
    await resetHistory();
    const created = await api('POST', '/api/calculate', { expression: '4+4' });
    const id = created.body.id;

    const toggledOn = await api('PATCH', `/api/history/${id}/favorite`, { isFavorite: true });
    assert.equal(toggledOn.status, 200);
    assert.equal(toggledOn.body.item.isFavorite, true);

    const toggledOff = await api('PATCH', `/api/history/${id}/favorite`, { isFavorite: false });
    assert.equal(toggledOff.body.item.isFavorite, false);

    // When no target state is passed, it should negate
    const implicit = await api('PATCH', `/api/history/${id}/favorite`);
    assert.equal(implicit.body.item.isFavorite, true);
  });

  test('favoriting a nonexistent record returns 404', async () => {
    const { status } = await api('PATCH', '/api/history/999999/favorite');
    assert.equal(status, 404);
  });

  test('statistics endpoint', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '10+10' });
    await api('POST', '/api/calculate', { expression: '10+10' });
    await api('POST', '/api/calculate', { expression: '2*3' });

    const { status, body } = await api('GET', '/api/history/stats');
    assert.equal(status, 200);
    assert.equal(body.stats.total, 3);
    assert.equal(body.stats.today, 3);
    assert.equal(body.stats.distinctExpressions, 2);
    assert.equal(body.stats.mostFrequentExpression, '10+10');
    assert.equal(body.stats.mostFrequentCount, 2);
    assert.equal(body.stats.timezone, 'UTC');
  });

  test('statistics do not error on an empty database', async () => {
    await resetHistory();
    const { status, body } = await api('GET', '/api/history/stats');
    assert.equal(status, 200);
    assert.equal(body.stats.total, 0);
    assert.equal(body.stats.averageResult, null);
  });
});

describe('Extension features: base conversion', () => {
  test('decimal to binary', async () => {
    const { status, body } = await api('POST', '/api/convert/base', {
      value: '10',
      fromBase: 10,
      toBase: 2,
    });
    assert.equal(status, 200);
    assert.equal(body.output, '1010');
  });

  test('decimal to hexadecimal', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: '1234',
      fromBase: 10,
      toBase: 16,
    });
    assert.equal(body.output, '4d2');
  });

  test('hexadecimal to decimal', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: 'ff',
      fromBase: 16,
      toBase: 10,
    });
    assert.equal(body.output, '255');
  });

  test('large integers lose no precision (BigInt rather than Number)', async () => {
    // 2^64 cannot be represented exactly with Number, so BigInt is required
    const { body } = await api('POST', '/api/convert/base', {
      value: 'ffffffffffffffff',
      fromBase: 16,
      toBase: 10,
    });
    assert.equal(body.output, '18446744073709551615');
  });

  test('binary fraction conversion', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: '0.101',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(body.output, '0.625');
  });

  test('negative numbers and illegal digits', async () => {
    const negative = await api('POST', '/api/convert/base', {
      value: '-101',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(negative.body.output, '-5');

    // There is no digit 9 in binary
    const invalid = await api('POST', '/api/convert/base', {
      value: '129',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_BASE_CONVERSION');
  });

  test('an out-of-range base returns 400', async () => {
    const tooSmall = await api('POST', '/api/convert/base', {
      value: '1', fromBase: 1, toBase: 10,
    });
    assert.equal(tooSmall.status, 400);

    const tooBig = await api('POST', '/api/convert/base', {
      value: '1', fromBase: 10, toBase: 37,
    });
    assert.equal(tooBig.status, 400);
  });
});

describe('Extension features: unit conversion', () => {
  test('length conversion', async () => {
    const { status, body } = await api('POST', '/api/convert/unit', {
      category: 'length',
      from: 'km',
      to: 'm',
      value: 1.5,
    });
    assert.equal(status, 200);
    assert.equal(body.outputText, '1500');
  });

  test('temperature conversion is an affine transform, not simple multiplication', async () => {
    const freezing = await api('POST', '/api/convert/unit', {
      category: 'temperature', from: 'c', to: 'f', value: 0,
    });
    assert.equal(freezing.body.output, 32);

    const boiling = await api('POST', '/api/convert/unit', {
      category: 'temperature', from: 'c', to: 'f', value: 100,
    });
    assert.equal(boiling.body.output, 212);

    const toKelvin = await api('POST', '/api/convert/unit', {
      category: 'temperature', from: 'c', to: 'k', value: 0,
    });
    assert.equal(toKelvin.body.output, 273.15);
  });

  test('an unknown category or unit returns 400', async () => {
    const badCategory = await api('POST', '/api/convert/unit', {
      category: 'nonsense', from: 'a', to: 'b', value: 1,
    });
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.body.code, 'INVALID_UNIT_CONVERSION');

    const badUnit = await api('POST', '/api/convert/unit', {
      category: 'length', from: 'parsec', to: 'm', value: 1,
    });
    assert.equal(badUnit.status, 400);
  });

  test('the unit list endpoint feeds the front-end dropdowns', async () => {
    const { status, body } = await api('GET', '/api/convert/units');
    assert.equal(status, 200);
    assert.ok(body.categories.length >= 5);

    const temperature = body.categories.find((category) => category.key === 'temperature');
    assert.equal(temperature.kind, 'affine');
    assert.ok(temperature.units.some((unit) => unit.key === 'c'));
  });
});

describe('API conventions', () => {
  test('an unknown route returns 404', async () => {
    const { status, body } = await api('GET', '/api/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
  });

  test('the root path returns the service description', async () => {
    const { status, body } = await api('GET', '/');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.apiPrefix, '/api');
  });

  test('both success and failure responses carry the success flag', async () => {
    const ok = await api('POST', '/api/calculate', { expression: '1+1' });
    assert.equal(ok.body.success, true);

    const fail = await api('POST', '/api/calculate', { expression: '1/0' });
    assert.equal(fail.body.success, false);
  });

  test('responses include CORS preflight support', async () => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5500' },
    });
    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:5500',
    );
  });

  test('a non-whitelisted origin does not receive the CORS allow header', async () => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example.com' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
