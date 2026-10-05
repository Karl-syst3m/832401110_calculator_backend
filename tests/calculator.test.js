/**
 * Calculation kernel unit tests
 *
 * This group of tests does not touch HTTP or the database at all; it tests the innermost mathematical
 * capability directly.
 * The reason for stressing this: with good layering, the most central and most error-prone logic should be
 * testable with zero dependencies. If testing a single expression required starting the server first, the
 * layering would have failed.
 *
 * Run: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/calculator/index.js';

/** Floating-point comparison helper: values should not be compared directly with === in double precision. */
function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${expected}, got ${actual}`,
  );
}

/** Assert that an expression throws the specified error code. */
function assertErrorCode(expression, expectedCode, options) {
  assert.throws(
    () => calculate(expression, options),
    (error) => {
      assert.equal(
        error.code,
        expectedCode,
        `Expression ${JSON.stringify(expression)} expected error code ${expectedCode}, got ${error.code}`,
      );
      return true;
    },
  );
}

describe('Basic arithmetic', () => {
  test('addition', () => {
    assert.equal(calculate('12+8').value, 20);
    assert.equal(calculate('0+0').value, 0);
  });

  test('subtraction', () => {
    assert.equal(calculate('12-8').value, 4);
    assert.equal(calculate('8-12').value, -4);
  });

  test('multiplication', () => {
    assert.equal(calculate('6*7').value, 42);
  });

  test('division', () => {
    assert.equal(calculate('20/4').value, 5);
    assertClose(calculate('1/8').value, 0.125);
  });

  test('accepts the full-width × and ÷ symbols used for front-end display', () => {
    assert.equal(calculate('12×8').value, 96);
    assert.equal(calculate('100÷4').value, 25);
    assert.equal(calculate('（1＋2）×3').value, 9);
  });
});

describe('Operator precedence and parentheses', () => {
  test('multiplication and division take precedence over addition and subtraction', () => {
    assert.equal(calculate('1 + 2 * 3').value, 7);
    assert.equal(calculate('8 - 3 * 2').value, 2);
    assert.equal(calculate('10 / 2 + 7').value, 12);
  });

  test('parentheses change the order of association', () => {
    assert.equal(calculate('(1 + 2) * 3').value, 9);
    assert.equal(calculate('((2 + 3) * (4 - 1))').value, 15);
    assert.equal(calculate('2 * (3 + (4 - 1))').value, 12);
  });

  test('operators of equal precedence associate left to right', () => {
    assert.equal(calculate('10 - 3 - 2').value, 5);
    assert.equal(calculate('100 / 5 / 2').value, 10);
  });
});

describe('Unary plus and minus signs', () => {
  test('a leading unary minus sign', () => {
    assert.equal(calculate('-5 + 8').value, 3);
    assert.equal(calculate('+7').value, 7);
  });

  test('a unary minus sign after an operator', () => {
    assert.equal(calculate('3 * -2').value, -6);
    assert.equal(calculate('10 - -3').value, 13);
    assert.equal(calculate('8 / -4').value, -2);
  });

  test('several consecutive unary signs', () => {
    assert.equal(calculate('--5').value, 5);
    assert.equal(calculate('-(-5)').value, 5);
  });
});

describe('Decimals and scientific notation', () => {
  test('ordinary decimals', () => {
    assertClose(calculate('0.1 + 0.2').value, 0.3);
    assertClose(calculate('1.5 * 2.4').value, 3.6);
  });

  test('decimals with the integer part or fraction part omitted', () => {
    assertClose(calculate('.5 + .5').value, 1);
    assertClose(calculate('1. + 1').value, 2);
  });

  test('scientific notation', () => {
    assert.equal(calculate('2e3').value, 2000);
    assertClose(calculate('1.5e-2').value, 0.015);
  });

  test('floating-point noise is normalized', () => {
    // 0.1+0.2 equals 0.30000000000000004 in double precision, and the display layer must restore it to 0.3
    assert.equal(calculate('0.1 + 0.2').valueText, '0.3');
    assert.equal(calculate('0.3 - 0.1').valueText, '0.2');
    assert.equal(calculate('1.1 * 3').valueText, '3.3');
  });
});

describe('Exponentiation (extension feature)', () => {
  test('basic exponentiation', () => {
    assert.equal(calculate('2^10').value, 1024);
  });

  test('right associativity: 2^3^2 equals 2^(3^2)', () => {
    assert.equal(calculate('2^3^2').value, 512);
  });

  test('precedence of the minus sign and exponentiation: -2^2 equals -(2^2)', () => {
    assert.equal(calculate('-2^2').value, -4);
  });

  test('the exponent may be negative or a parenthesized expression', () => {
    assertClose(calculate('2^-3').value, 0.125);
    assert.equal(calculate('(-2)^3').value, -8);
  });
});

describe('Scientific functions and constants (extension feature)', () => {
  test('common functions', () => {
    assert.equal(calculate('sqrt(16)').value, 4);
    assert.equal(calculate('abs(-3.5)').value, 3.5);
    assert.equal(calculate('log(1000)').value, 3);
    assert.equal(calculate('fact(5)').value, 120);
    assert.equal(calculate('max(1, 5, 3)').value, 5);
    assertClose(calculate('round(3.14159, 2)').value, 3.14);
  });

  test('constants', () => {
    assertClose(calculate('pi').value, Math.PI);
    assert.equal(calculate('ln(e)').value, 1);
  });

  test('function names are case-insensitive', () => {
    assert.equal(calculate('SQRT(9)').value, 3);
    assertClose(calculate('Pi').value, Math.PI);
  });
});

describe('Error handling', () => {
  test('division by zero', () => {
    assertErrorCode('1/0', 'DIVISION_BY_ZERO');
    assertErrorCode('5/(3-3)', 'DIVISION_BY_ZERO');
    assertErrorCode('mod(5, 0)', 'DIVISION_BY_ZERO');
  });

  test('incomplete syntax', () => {
    assertErrorCode('1+', 'UNEXPECTED_END');
    assertErrorCode('*5', 'UNEXPECTED_TOKEN');
    assertErrorCode('1 2', 'UNEXPECTED_TOKEN');
  });

  test('unbalanced parentheses', () => {
    assertErrorCode('(1+2', 'UNBALANCED_PARENTHESIS');
    assertErrorCode('1+2)', 'UNEXPECTED_TOKEN');
    assertErrorCode('()', 'UNEXPECTED_TOKEN');
  });

  test('illegal characters', () => {
    assertErrorCode('1 @ 2', 'ILLEGAL_CHARACTER');
    assertErrorCode('1 & 2', 'ILLEGAL_CHARACTER');
  });

  test('unknown functions and constants', () => {
    assertErrorCode('foo(1)', 'UNKNOWN_IDENTIFIER');
    assertErrorCode('xyz', 'UNKNOWN_IDENTIFIER');
    assertErrorCode('eval(1)', 'UNKNOWN_IDENTIFIER');
  });

  test('wrong number of function arguments', () => {
    assertErrorCode('sqrt(1, 2)', 'BAD_ARGUMENT_COUNT');
    assertErrorCode('mod(5)', 'BAD_ARGUMENT_COUNT');
  });

  test('mathematical domain errors', () => {
    assertErrorCode('sqrt(-1)', 'DOMAIN_ERROR');
    assertErrorCode('ln(0)', 'DOMAIN_ERROR');
    assertErrorCode('log(-5)', 'DOMAIN_ERROR');
    assertErrorCode('asin(2)', 'DOMAIN_ERROR');
    assertErrorCode('tan(pi/2)', 'DOMAIN_ERROR');
  });

  test('the result is not a real number or exceeds the representable range', () => {
    // (-8)^(1/3) has a solution over the reals (-2), but double-precision pow returns NaN.
    // This implementation reports a domain error for such cases; that is a conscious trade-off, explained in the blog.
    assertErrorCode('(-8)^(1/3)', 'DOMAIN_ERROR');
    assertErrorCode('1e308*10', 'RESULT_NOT_FINITE');
    assertErrorCode('9^9^9', 'RESULT_NOT_FINITE');
  });

  test('empty expressions and illegal types', () => {
    assertErrorCode('', 'EXPRESSION_REQUIRED');
    assertErrorCode('   ', 'EXPRESSION_REQUIRED');
    assertErrorCode(null, 'EXPRESSION_REQUIRED');
    assertErrorCode(42, 'EXPRESSION_REQUIRED');
  });

  test('over-long expressions', () => {
    assertErrorCode('1'.repeat(201), 'EXPRESSION_TOO_LONG');
    assertErrorCode('(1+1)'.repeat(50), 'EXPRESSION_TOO_LONG');
  });

  test('excessive nesting gives a clear error rather than a stack overflow', () => {
    // 70 levels of parentheses: 141 characters long, so the length limit is not triggered, but MAX_DEPTH (64) is exceeded
    const tooDeep = '('.repeat(70) + '1' + ')'.repeat(70);
    assertErrorCode(tooDeep, 'EXPRESSION_TOO_DEEP');

    // 60 levels is within the limit and should compute normally, proving the limit does not harm legitimate use
    const acceptable = '('.repeat(60) + '1' + ')'.repeat(60);
    assert.equal(calculate(acceptable).value, 1);
  });

  test('a custom length limit is respected', () => {
    assertErrorCode('123456', 'EXPRESSION_TOO_LONG', { maxLength: 5 });
    assert.equal(calculate('12345', { maxLength: 5 }).value, 12345);
  });
});

describe('Security: no eval / exec is used', () => {
  test('there is no eval / new Function call in the source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const calculatorDir = path.resolve(import.meta.dirname, '..', 'src', 'calculator');
    const files = fs.readdirSync(calculatorDir).filter((name) => name.endsWith('.js'));

    for (const file of files) {
      const source = fs.readFileSync(path.join(calculatorDir, file), 'utf8');
      // Check line by line, skipping comment lines, so that a comment explaining "this implementation does not
      // use eval" is not mistaken for a violation
      const codeLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));

      for (const line of codeLines) {
        assert.ok(
          !/\beval\s*\(/.test(line),
          `${file} contains an eval call: ${line.trim()}`,
        );
        assert.ok(
          !/new\s+Function\s*\(/.test(line),
          `${file} contains a new Function call: ${line.trim()}`,
        );
        assert.ok(
          !/child_process|node:vm|\bvm\./.test(line),
          `${file} contains a possible arbitrary code execution entry point: ${line.trim()}`,
        );
      }
    }
  });

  test('malicious input is rejected as an ordinary syntax error and never executed', () => {
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
            `Payload ${payload} returned an unexpected error code ${error.code}`,
          );
          return true;
        },
      );
    }
  });

  test('prototype chain properties cannot impersonate whitelist entries (Object.hasOwn regression test)', () => {
    // The origin of this test:
    // The initial implementation was written as `CONSTANTS[name] !== undefined`, so "constructor" hit
    // Object.prototype.constructor, bypassed the unknown identifier check, and returned a function as a numeric value.
    // The fix is that every whitelist lookup goes through Object.hasOwn.
    // The names below are all properties that really exist on JavaScript's object prototype chain,
    // and they must be rejected as "unknown identifiers" rather than parsed into something strange.
    const prototypeNames = [
      'constructor', 'toString', 'valueOf', 'hasOwnProperty',
      'isPrototypeOf', 'propertyIsEnumerable', '__proto__', '__defineGetter__',
    ];

    for (const name of prototypeNames) {
      // Used as a constant
      assertErrorCode(name, 'UNKNOWN_IDENTIFIER');
      // Used as a function call (this one used to throw a TypeError and become a 500)
      assertErrorCode(`${name}(1)`, 'UNKNOWN_IDENTIFIER');
      // Used as part of an expression
      assertErrorCode(`1 + ${name}`, 'UNKNOWN_IDENTIFIER');
    }
  });

  test('prototype chain properties cannot impersonate units or unit categories', async () => {
    const { convertUnit } = await import('../src/service/conversion.service.js');
    const { AppError } = await import('../src/errors/appError.js');

    // A category name colliding with a prototype chain property
    assert.throws(
      () => convertUnit({ category: 'constructor', from: 'm', to: 'km', value: 1 }),
      (error) => error instanceof AppError && error.code === 'INVALID_UNIT_CONVERSION',
    );
    // A unit name colliding with a prototype chain property
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
