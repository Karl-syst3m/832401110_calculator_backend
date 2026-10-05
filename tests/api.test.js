/**
 * 接口集成测试
 *
 * 这一组测试在真实的 HTTP 服务器上跑，用真实的 HTTP 请求打接口，
 * 数据库用内存模式（:memory:）以避免污染开发数据并保证每个测试文件互相隔离。
 *
 * 覆盖重点：
 *   1. 四个必需功能的完整链路（计算 / 复合表达式 / 历史 / 删除）；
 *   2. 历史记录确实落在数据库里（不是进程内缓存）——通过「重新查询」验证；
 *   3. 状态码与错误码是否符合约定；
 *   4. 参数校验能否挡住畸形输入。
 *
 * 注意：环境变量必须在 import 业务模块之前设置，
 * 因为 config 模块在首次导入时就会读取 process.env。
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

/** 发一个 JSON 请求并解析响应。 */
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

/** 清空历史，让每个测试从已知状态开始。 */
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

describe('GET /api/health —— 健康检查', () => {
  test('服务与数据库均正常时返回 200', async () => {
    const { status, body } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.database, 'ok');
    assert.equal(body.service, 'calculator-backend');
    assert.equal(typeof body.uptimeSeconds, 'number');
  });
});

describe('POST /api/calculate —— 功能一：基础计算', () => {
  test('加法返回结果，且结果由后端算出', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '12+8' });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.expression, '12+8');
    assert.equal(body.result, 20);
    assert.equal(body.resultText, '20');
    // 返回了 id 说明记录已经入库，这是后端起作用的直接证据
    assert.ok(Number.isInteger(body.id) && body.id > 0);
  });

  test('四种基本运算都能正确计算', async () => {
    const cases = [
      ['12+8', 20],
      ['12-8', 4],
      ['6*7', 42],
      ['20/4', 5],
    ];
    for (const [expression, expected] of cases) {
      const { status, body } = await api('POST', '/api/calculate', { expression });
      assert.equal(status, 201, `表达式 ${expression} 应当成功`);
      assert.equal(body.result, expected, `表达式 ${expression} 结果错误`);
    }
  });

  test('小数计算', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1.5*2.4' });
    assert.equal(body.resultText, '3.6');
  });
});

describe('POST /api/calculate —— 功能二：复合表达式', () => {
  test('运算符优先级', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1 + 2 * 3' });
    assert.equal(body.result, 7);
  });

  test('括号改变优先级', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '(1+2)*3' });
    assert.equal(body.result, 9);
  });

  test('一元正负号', async () => {
    const negative = await api('POST', '/api/calculate', { expression: '-5 + 8' });
    assert.equal(negative.body.result, 3);
    const multiplied = await api('POST', '/api/calculate', { expression: '3 * -2' });
    assert.equal(multiplied.body.result, -6);
  });

  test('前端传来的 × ÷ 会被后端正确解释', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '12×8÷3' });
    assert.equal(body.result, 32);
    // 归一化后的表达式会回显，便于排查「界面显示 × 实际算的是什么」
    assert.equal(body.normalizedExpression, '12*8/3');
  });
});

describe('POST /api/calculate —— 异常处理', () => {
  test('除以零返回 400 与明确错误码', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '1/0' });
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DIVISION_BY_ZERO');
    assert.ok(body.message.length > 0);
  });

  test('非法表达式返回 400', async () => {
    const cases = [
      ['1+', 'UNEXPECTED_END'],
      ['(1+2', 'UNBALANCED_PARENTHESIS'],
      ['1 @ 2', 'ILLEGAL_CHARACTER'],
      ['sqrt(-1)', 'DOMAIN_ERROR'],
    ];
    for (const [expression, code] of cases) {
      const { status, body } = await api('POST', '/api/calculate', { expression });
      assert.equal(status, 400, `表达式 ${expression} 应当返回 400`);
      assert.equal(body.code, code, `表达式 ${expression} 错误码不符`);
    }
  });

  test('非法字符会带上出错位置', async () => {
    const { body } = await api('POST', '/api/calculate', { expression: '1 @ 2' });
    assert.equal(body.detail.position, 3);
    assert.equal(body.detail.character, '@');
  });

  test('缺少 expression 字段返回 400（前端无法绕过后端计算）', async () => {
    const { status, body } = await api('POST', '/api/calculate', {});
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_REQUIRED');
  });

  test('expression 类型不对也返回 400', async () => {
    const numeric = await api('POST', '/api/calculate', { expression: 42 });
    assert.equal(numeric.status, 400);
    assert.equal(numeric.body.code, 'EXPRESSION_REQUIRED');

    const array = await api('POST', '/api/calculate', { expression: [1, 2] });
    assert.equal(array.status, 400);
  });

  test('空表达式返回 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '   ' });
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_REQUIRED');
  });

  test('超长表达式返回 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', { expression: '1'.repeat(300) });
    assert.equal(status, 400);
    assert.equal(body.code, 'EXPRESSION_TOO_LONG');
  });

  test('请求体不是合法 JSON 时返回 400', async () => {
    const { status, body } = await api('POST', '/api/calculate', '{不是JSON');
    assert.equal(status, 400);
    assert.equal(body.code, 'MALFORMED_JSON');
  });
});

describe('历史记录 —— 功能三：持久化与查询', () => {
  test('计算成功后能查到对应记录', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+2' });
    await api('POST', '/api/calculate', { expression: '5*8' });
    await api('POST', '/api/calculate', { expression: '(2+3)*4' });

    const { status, body } = await api('GET', '/api/history');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.total, 3);
    assert.equal(body.items.length, 3);

    // 默认按时间倒序，最后算的排在最前
    assert.equal(body.items[0].expression, '(2+3)*4');
    assert.equal(body.items[0].result, 20);

    // 每条记录都必须包含作业要求的三要素：表达式、结果、时间
    for (const item of body.items) {
      assert.equal(typeof item.expression, 'string');
      assert.equal(typeof item.result, 'number');
      assert.equal(typeof item.resultText, 'string');
      assert.ok(!Number.isNaN(Date.parse(item.createdAt)), 'createdAt 应当是合法的 ISO 时间');
      assert.equal(typeof item.id, 'number');
    }
  });

  test('失败的计算不写入历史', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+1' });
    await api('POST', '/api/calculate', { expression: '1/0' });
    await api('POST', '/api/calculate', { expression: 'badexpr' });

    const { body } = await api('GET', '/api/history');
    assert.equal(body.total, 1, '只有成功的计算才应该入库');
    assert.equal(body.items[0].expression, '1+1');
  });

  test('历史来自数据库：直接查库能对上接口返回的数据', async () => {
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

  test('分页', async () => {
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

    // 翻页不应该出现重复记录
    const firstIds = firstPage.body.items.map((item) => item.id);
    const lastIds = lastPage.body.items.map((item) => item.id);
    assert.equal(firstIds.filter((id) => lastIds.includes(id)).length, 0);
  });

  test('关键词搜索', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '100+200' });
    await api('POST', '/api/calculate', { expression: '3*3' });
    await api('POST', '/api/calculate', { expression: '1000/10' });

    const { body } = await api('GET', '/api/history?keyword=100');
    assert.equal(body.total, 2);
  });

  test('分页参数非法时返回 400', async () => {
    const negative = await api('GET', '/api/history?page=-1');
    assert.equal(negative.status, 400);
    assert.equal(negative.body.code, 'INVALID_PAGINATION');

    const notANumber = await api('GET', '/api/history?page=abc');
    assert.equal(notANumber.status, 400);

    const zeroSize = await api('GET', '/api/history?pageSize=0');
    assert.equal(zeroSize.status, 400);
  });

  test('pageSize 被强制限制在上限内', async () => {
    await resetHistory();
    await api('POST', '/api/calculate', { expression: '1+1' });

    const { body } = await api('GET', '/api/history?pageSize=100000');
    assert.equal(body.pageSize, 100, 'pageSize 应当被压到配置的上限 100');
  });
});

describe('历史记录 —— 功能四：删除', () => {
  test('删除指定 id 的记录', async () => {
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

    // 前端重新查询，应当只剩 2 条，且被删的那条真的不在库里
    const after = await api('GET', '/api/history');
    assert.equal(after.body.total, 2);
    assert.equal(
      after.body.items.some((item) => item.id === first.body.id),
      false,
    );

    const row = getDatabase()
      .prepare('SELECT COUNT(*) AS total FROM calculation_history WHERE id = ?')
      .get(first.body.id);
    assert.equal(Number(row.total), 0, '数据库里应当确实被删掉了');
  });

  test('删除不存在的 id 返回 404', async () => {
    const { status, body } = await api('DELETE', '/api/history/999999');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'HISTORY_NOT_FOUND');
  });

  test('id 非法时返回 400 而不是 404', async () => {
    const notANumber = await api('DELETE', '/api/history/abc');
    assert.equal(notANumber.status, 400);
    assert.equal(notANumber.body.code, 'INVALID_HISTORY_ID');

    const negative = await api('DELETE', '/api/history/-5');
    assert.equal(negative.status, 400);
  });

  test('清空全部历史', async () => {
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

describe('扩展功能：收藏与统计', () => {
  test('切换收藏状态', async () => {
    await resetHistory();
    const created = await api('POST', '/api/calculate', { expression: '4+4' });
    const id = created.body.id;

    const toggledOn = await api('PATCH', `/api/history/${id}/favorite`, { isFavorite: true });
    assert.equal(toggledOn.status, 200);
    assert.equal(toggledOn.body.item.isFavorite, true);

    const toggledOff = await api('PATCH', `/api/history/${id}/favorite`, { isFavorite: false });
    assert.equal(toggledOff.body.item.isFavorite, false);

    // 不传目标状态时应当取反
    const implicit = await api('PATCH', `/api/history/${id}/favorite`);
    assert.equal(implicit.body.item.isFavorite, true);
  });

  test('收藏不存在的记录返回 404', async () => {
    const { status } = await api('PATCH', '/api/history/999999/favorite');
    assert.equal(status, 404);
  });

  test('统计接口', async () => {
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

  test('空库时统计不报错', async () => {
    await resetHistory();
    const { status, body } = await api('GET', '/api/history/stats');
    assert.equal(status, 200);
    assert.equal(body.stats.total, 0);
    assert.equal(body.stats.averageResult, null);
  });
});

describe('扩展功能：进制换算', () => {
  test('十进制转二进制', async () => {
    const { status, body } = await api('POST', '/api/convert/base', {
      value: '10',
      fromBase: 10,
      toBase: 2,
    });
    assert.equal(status, 200);
    assert.equal(body.output, '1010');
  });

  test('十进制转十六进制', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: '1234',
      fromBase: 10,
      toBase: 16,
    });
    assert.equal(body.output, '4d2');
  });

  test('十六进制转十进制', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: 'ff',
      fromBase: 16,
      toBase: 10,
    });
    assert.equal(body.output, '255');
  });

  test('大整数不丢精度（BigInt 而非 Number）', async () => {
    // 2^64 在 Number 下无法精确表示，必须靠 BigInt
    const { body } = await api('POST', '/api/convert/base', {
      value: 'ffffffffffffffff',
      fromBase: 16,
      toBase: 10,
    });
    assert.equal(body.output, '18446744073709551615');
  });

  test('二进制小数转换', async () => {
    const { body } = await api('POST', '/api/convert/base', {
      value: '0.101',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(body.output, '0.625');
  });

  test('负数与非法数字', async () => {
    const negative = await api('POST', '/api/convert/base', {
      value: '-101',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(negative.body.output, '-5');

    // 二进制里没有数字 9
    const invalid = await api('POST', '/api/convert/base', {
      value: '129',
      fromBase: 2,
      toBase: 10,
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_BASE_CONVERSION');
  });

  test('进制越界返回 400', async () => {
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

describe('扩展功能：单位换算', () => {
  test('长度换算', async () => {
    const { status, body } = await api('POST', '/api/convert/unit', {
      category: 'length',
      from: 'km',
      to: 'm',
      value: 1.5,
    });
    assert.equal(status, 200);
    assert.equal(body.outputText, '1500');
  });

  test('温度换算是仿射变换，不是简单乘法', async () => {
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

  test('未知类别或单位返回 400', async () => {
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

  test('单位清单接口供前端渲染下拉框', async () => {
    const { status, body } = await api('GET', '/api/convert/units');
    assert.equal(status, 200);
    assert.ok(body.categories.length >= 5);

    const temperature = body.categories.find((category) => category.key === 'temperature');
    assert.equal(temperature.kind, 'affine');
    assert.ok(temperature.units.some((unit) => unit.key === 'c'));
  });
});

describe('接口约定', () => {
  test('未知路由返回 404', async () => {
    const { status, body } = await api('GET', '/api/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
  });

  test('根路径返回服务说明', async () => {
    const { status, body } = await api('GET', '/');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.apiPrefix, '/api');
  });

  test('成功与失败响应都带 success 标志位', async () => {
    const ok = await api('POST', '/api/calculate', { expression: '1+1' });
    assert.equal(ok.body.success, true);

    const fail = await api('POST', '/api/calculate', { expression: '1/0' });
    assert.equal(fail.body.success, false);
  });

  test('响应包含 CORS 预检支持', async () => {
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

  test('非白名单来源不会拿到 CORS 许可头', async () => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example.com' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
