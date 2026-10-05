/**
 * 计算内核单元测试
 *
 * 这一组测试完全不涉及 HTTP 与数据库，直接测最里层的数学能力。
 * 之所以强调这一点：分层做得好的话，最核心、最容易出错的逻辑应当是
 * 「零依赖即可测试」的。如果测一个表达式要先把服务器跑起来，说明分层失败了。
 *
 * 运行：npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/calculator/index.js';

/** 浮点比较辅助：双精度下不该用 === 直接比数值。 */
function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `期望 ${expected}，实际 ${actual}`,
  );
}

/** 断言某个表达式抛出指定错误码。 */
function assertErrorCode(expression, expectedCode, options) {
  assert.throws(
    () => calculate(expression, options),
    (error) => {
      assert.equal(
        error.code,
        expectedCode,
        `表达式 ${JSON.stringify(expression)} 期望错误码 ${expectedCode}，实际 ${error.code}`,
      );
      return true;
    },
  );
}

describe('基础四则运算', () => {
  test('加法', () => {
    assert.equal(calculate('12+8').value, 20);
    assert.equal(calculate('0+0').value, 0);
  });

  test('减法', () => {
    assert.equal(calculate('12-8').value, 4);
    assert.equal(calculate('8-12').value, -4);
  });

  test('乘法', () => {
    assert.equal(calculate('6*7').value, 42);
  });

  test('除法', () => {
    assert.equal(calculate('20/4').value, 5);
    assertClose(calculate('1/8').value, 0.125);
  });

  test('接受前端展示用的 × ÷ 全角符号', () => {
    assert.equal(calculate('12×8').value, 96);
    assert.equal(calculate('100÷4').value, 25);
    assert.equal(calculate('（1＋2）×3').value, 9);
  });
});

describe('运算符优先级与括号', () => {
  test('乘除优先于加减', () => {
    assert.equal(calculate('1 + 2 * 3').value, 7);
    assert.equal(calculate('8 - 3 * 2').value, 2);
    assert.equal(calculate('10 / 2 + 7').value, 12);
  });

  test('括号改变结合顺序', () => {
    assert.equal(calculate('(1 + 2) * 3').value, 9);
    assert.equal(calculate('((2 + 3) * (4 - 1))').value, 15);
    assert.equal(calculate('2 * (3 + (4 - 1))').value, 12);
  });

  test('同级运算符从左到右', () => {
    assert.equal(calculate('10 - 3 - 2').value, 5);
    assert.equal(calculate('100 / 5 / 2').value, 10);
  });
});

describe('一元正负号', () => {
  test('开头的一元负号', () => {
    assert.equal(calculate('-5 + 8').value, 3);
    assert.equal(calculate('+7').value, 7);
  });

  test('运算符后面的一元负号', () => {
    assert.equal(calculate('3 * -2').value, -6);
    assert.equal(calculate('10 - -3').value, 13);
    assert.equal(calculate('8 / -4').value, -2);
  });

  test('连续多个一元符号', () => {
    assert.equal(calculate('--5').value, 5);
    assert.equal(calculate('-(-5)').value, 5);
  });
});

describe('小数与科学计数法', () => {
  test('普通小数', () => {
    assertClose(calculate('0.1 + 0.2').value, 0.3);
    assertClose(calculate('1.5 * 2.4').value, 3.6);
  });

  test('省略整数位或小数位的小数', () => {
    assertClose(calculate('.5 + .5').value, 1);
    assertClose(calculate('1. + 1').value, 2);
  });

  test('科学计数法', () => {
    assert.equal(calculate('2e3').value, 2000);
    assertClose(calculate('1.5e-2').value, 0.015);
  });

  test('浮点噪声被规范化', () => {
    // 0.1+0.2 在双精度下等于 0.30000000000000004，展示层必须把它还原成 0.3
    assert.equal(calculate('0.1 + 0.2').valueText, '0.3');
    assert.equal(calculate('0.3 - 0.1').valueText, '0.2');
    assert.equal(calculate('1.1 * 3').valueText, '3.3');
  });
});

describe('乘方（扩展功能）', () => {
  test('基本乘方', () => {
    assert.equal(calculate('2^10').value, 1024);
  });

  test('右结合：2^3^2 等于 2^(3^2)', () => {
    assert.equal(calculate('2^3^2').value, 512);
  });

  test('负号与乘方的优先级：-2^2 等于 -(2^2)', () => {
    assert.equal(calculate('-2^2').value, -4);
  });

  test('指数可以是负数或括号表达式', () => {
    assertClose(calculate('2^-3').value, 0.125);
    assert.equal(calculate('(-2)^3').value, -8);
  });
});

describe('科学函数与常量（扩展功能）', () => {
  test('常用函数', () => {
    assert.equal(calculate('sqrt(16)').value, 4);
    assert.equal(calculate('abs(-3.5)').value, 3.5);
    assert.equal(calculate('log(1000)').value, 3);
    assert.equal(calculate('fact(5)').value, 120);
    assert.equal(calculate('max(1, 5, 3)').value, 5);
    assertClose(calculate('round(3.14159, 2)').value, 3.14);
  });

  test('常量', () => {
    assertClose(calculate('pi').value, Math.PI);
    assert.equal(calculate('ln(e)').value, 1);
  });

  test('函数名不区分大小写', () => {
    assert.equal(calculate('SQRT(9)').value, 3);
    assertClose(calculate('Pi').value, Math.PI);
  });
});

describe('异常处理', () => {
  test('除以零', () => {
    assertErrorCode('1/0', 'DIVISION_BY_ZERO');
    assertErrorCode('5/(3-3)', 'DIVISION_BY_ZERO');
    assertErrorCode('mod(5, 0)', 'DIVISION_BY_ZERO');
  });

  test('语法不完整', () => {
    assertErrorCode('1+', 'UNEXPECTED_END');
    assertErrorCode('*5', 'UNEXPECTED_TOKEN');
    assertErrorCode('1 2', 'UNEXPECTED_TOKEN');
  });

  test('括号不配对', () => {
    assertErrorCode('(1+2', 'UNBALANCED_PARENTHESIS');
    assertErrorCode('1+2)', 'UNEXPECTED_TOKEN');
    assertErrorCode('()', 'UNEXPECTED_TOKEN');
  });

  test('非法字符', () => {
    assertErrorCode('1 @ 2', 'ILLEGAL_CHARACTER');
    assertErrorCode('1 & 2', 'ILLEGAL_CHARACTER');
  });

  test('未知的函数与常量', () => {
    assertErrorCode('foo(1)', 'UNKNOWN_IDENTIFIER');
    assertErrorCode('xyz', 'UNKNOWN_IDENTIFIER');
    assertErrorCode('eval(1)', 'UNKNOWN_IDENTIFIER');
  });

  test('函数参数个数错误', () => {
    assertErrorCode('sqrt(1, 2)', 'BAD_ARGUMENT_COUNT');
    assertErrorCode('mod(5)', 'BAD_ARGUMENT_COUNT');
  });

  test('数学定义域错误', () => {
    assertErrorCode('sqrt(-1)', 'DOMAIN_ERROR');
    assertErrorCode('ln(0)', 'DOMAIN_ERROR');
    assertErrorCode('log(-5)', 'DOMAIN_ERROR');
    assertErrorCode('asin(2)', 'DOMAIN_ERROR');
    assertErrorCode('tan(pi/2)', 'DOMAIN_ERROR');
  });

  test('结果不是实数或超出可表示范围', () => {
    // (-8)^(1/3) 在实数域有解（-2），但双精度 pow 返回 NaN。
    // 本实现对这类情况报定义域错误，属于有意识的取舍，已在博客中说明。
    assertErrorCode('(-8)^(1/3)', 'DOMAIN_ERROR');
    assertErrorCode('1e308*10', 'RESULT_NOT_FINITE');
    assertErrorCode('9^9^9', 'RESULT_NOT_FINITE');
  });

  test('空表达式与非法类型', () => {
    assertErrorCode('', 'EXPRESSION_REQUIRED');
    assertErrorCode('   ', 'EXPRESSION_REQUIRED');
    assertErrorCode(null, 'EXPRESSION_REQUIRED');
    assertErrorCode(42, 'EXPRESSION_REQUIRED');
  });

  test('超长表达式', () => {
    assertErrorCode('1'.repeat(201), 'EXPRESSION_TOO_LONG');
    assertErrorCode('(1+1)'.repeat(50), 'EXPRESSION_TOO_LONG');
  });

  test('嵌套过深时给出明确错误，而不是栈溢出', () => {
    // 70 层括号：长度 141 字符，未触发长度上限，但超过 MAX_DEPTH(64)
    const tooDeep = '('.repeat(70) + '1' + ')'.repeat(70);
    assertErrorCode(tooDeep, 'EXPRESSION_TOO_DEEP');

    // 60 层在限制之内，应当能正常算出结果，证明限制没有误伤正常使用
    const acceptable = '('.repeat(60) + '1' + ')'.repeat(60);
    assert.equal(calculate(acceptable).value, 1);
  });

  test('自定义长度上限会被遵守', () => {
    assertErrorCode('123456', 'EXPRESSION_TOO_LONG', { maxLength: 5 });
    assert.equal(calculate('12345', { maxLength: 5 }).value, 12345);
  });
});

describe('安全性：不使用 eval / exec', () => {
  test('源码中不存在 eval / new Function 调用', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const calculatorDir = path.resolve(import.meta.dirname, '..', 'src', 'calculator');
    const files = fs.readdirSync(calculatorDir).filter((name) => name.endsWith('.js'));

    for (const file of files) {
      const source = fs.readFileSync(path.join(calculatorDir, file), 'utf8');
      // 逐行检查，并跳过注释行，避免把说明「本实现不使用 eval」的注释误判为违规
      const codeLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));

      for (const line of codeLines) {
        assert.ok(
          !/\beval\s*\(/.test(line),
          `${file} 中出现了 eval 调用：${line.trim()}`,
        );
        assert.ok(
          !/new\s+Function\s*\(/.test(line),
          `${file} 中出现了 new Function 调用：${line.trim()}`,
        );
        assert.ok(
          !/child_process|node:vm|\bvm\./.test(line),
          `${file} 中出现了可能的任意代码执行入口：${line.trim()}`,
        );
      }
    }
  });

  test('恶意输入被当作普通语法错误拒绝，不会被执行', () => {
    const attacks = [
      'process.exit()',
      'require("fs")',
      'globalThis',
      'this.constructor.constructor("return 1")()',
      '1;process.exit(1)',
      '1)//',
      '${1+1}',
      '`1+1`',
    ];
    for (const payload of attacks) {
      assert.throws(
        () => calculate(payload),
        (error) => {
          assert.ok(
            ['ILLEGAL_CHARACTER', 'UNEXPECTED_TOKEN', 'UNKNOWN_IDENTIFIER', 'UNEXPECTED_END'].includes(error.code),
            `载荷 ${payload} 返回了意外错误码 ${error.code}`,
          );
          return true;
        },
      );
    }
  });

  test('原型链属性不能冒充白名单条目（Object.hasOwn 回归测试）', () => {
    // 这段测试的由来：
    // 最初的实现写成 `CONSTANTS[name] !== undefined`，于是 "constructor" 命中
    // Object.prototype.constructor，绕过未知标识符检查，把一个函数当作数值返回。
    // 修复方式是所有白名单查表一律走 Object.hasOwn。
    // 下面这些名字都是 JavaScript 对象原型链上真实存在的属性，
    // 它们必须被当作「未知标识符」拒绝，而不是被解析成什么奇怪的东西。
    const prototypeNames = [
      'constructor', 'toString', 'valueOf', 'hasOwnProperty',
      'isPrototypeOf', 'propertyIsEnumerable', '__proto__', '__defineGetter__',
    ];

    for (const name of prototypeNames) {
      // 作为常量使用
      assertErrorCode(name, 'UNKNOWN_IDENTIFIER');
      // 作为函数调用使用（这一条曾经会抛出 TypeError 变成 500）
      assertErrorCode(`${name}(1)`, 'UNKNOWN_IDENTIFIER');
      // 作为表达式的一部分使用
      assertErrorCode(`1 + ${name}`, 'UNKNOWN_IDENTIFIER');
    }
  });

  test('原型链属性不能冒充单位或单位类别', async () => {
    const { convertUnit } = await import('../src/service/conversion.service.js');
    const { AppError } = await import('../src/errors/appError.js');

    // 类别名撞上原型链属性
    assert.throws(
      () => convertUnit({ category: 'constructor', from: 'm', to: 'km', value: 1 }),
      (error) => error instanceof AppError && error.code === 'INVALID_UNIT_CONVERSION',
    );
    // 单位名撞上原型链属性
    assert.throws(
      () => convertUnit({ category: 'length', from: 'constructor', to: 'km', value: 1 }),
      (error) => error instanceof AppError && error.code === 'INVALID_UNIT_CONVERSION',
    );
    assert.throws(
      () => convertUnit({ category: 'length', from: 'm', to: 'toString', value: 1 }),
      (error) => error instanceof AppError && error.code === 'INVALID_UNIT_CONVERSION',
    );
  });
});
