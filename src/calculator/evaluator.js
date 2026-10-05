/**
 * 求值（Evaluator）
 *
 * 输入是 parser 产出的 AST，输出是一个双精度浮点数。
 * 这一层负责所有「只跟数值有关」的判断：除零、定义域、参数个数、结果溢出。
 *
 * 安全边界说明：
 * FUNCTIONS 与 CONSTANTS 是两张白名单表。标识符先在这一层被查表，
 * 表里没有就直接报错，**不存在任何「按名字动态取函数」的路径**。
 * 这跟 eval 的本质区别在于：用户输入只被用来「查表」，永远不会被当作代码执行，
 * 所以即便有人提交 sqrt(1) 之外的任何怪异输入，能触及的也只是这张表里的纯数学函数。
 */

import { CalculatorError, ErrorCodes } from './errors.js';

/**
 * 构造定义域错误。单独抽出来是因为定义域错误在这张表里出现得非常频繁，
 * 集中一处可以让每个函数体保持一行，便于通读。
 */
function domainError(name, args) {
  return new CalculatorError(
    ErrorCodes.DOMAIN_ERROR,
    `Function "${name}" is not defined for the given argument(s).`,
    { function: name, arguments: args },
  );
}

function divisionByZero(operation, dividend, divisor) {
  return new CalculatorError(
    ErrorCodes.DIVISION_BY_ZERO,
    `${operation} by zero is not allowed.`,
    { operation, dividend, divisor },
  );
}

/** 支持的数学常量。 */
export const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
});

/**
 * 支持的函数白名单。
 * 每个条目声明参数个数区间（minArgs/maxArgs）与一个纯函数 apply。
 * 把参数个数写进表里，是为了让「函数名存在但参数写错」也给出明确错误，
 * 而不是算出 NaN 让用户去猜。
 */
export const FUNCTIONS = Object.freeze({
  abs: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.abs(x) },

  sqrt: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x < 0) throw domainError('sqrt', [x]);
      return Math.sqrt(x);
    },
  },

  cbrt: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.cbrt(x) },

  sin: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.sin(x) },
  cos: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.cos(x) },
  tan: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      // tan 在 pi/2 处没有定义。双精度下 Math.cos(Math.PI/2) 约为 6.1e-17 而非精确 0，
      // 直接算会得到一个 1.6e16 量级的荒唐数字。这里显式拦截，报定义域错误。
      if (Math.abs(Math.cos(x)) < 1e-12) throw domainError('tan', [x]);
      return Math.tan(x);
    },
  },
  asin: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x < -1 || x > 1) throw domainError('asin', [x]);
      return Math.asin(x);
    },
  },
  acos: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x < -1 || x > 1) throw domainError('acos', [x]);
      return Math.acos(x);
    },
  },
  atan: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.atan(x) },

  ln: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x <= 0) throw domainError('ln', [x]);
      return Math.log(x);
    },
  },
  log: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x <= 0) throw domainError('log', [x]);
      return Math.log10(x);
    },
  },
  log10: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x <= 0) throw domainError('log10', [x]);
      return Math.log10(x);
    },
  },
  log2: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (x <= 0) throw domainError('log2', [x]);
      return Math.log2(x);
    },
  },

  exp: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.exp(x) },
  pow: { minArgs: 2, maxArgs: 2, apply: ([a, b]) => a ** b },
  hypot: { minArgs: 1, maxArgs: 8, apply: (args) => Math.hypot(...args) },
  sign: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.sign(x) },

  mod: {
    minArgs: 2,
    maxArgs: 2,
    apply: ([a, b]) => {
      if (b === 0) throw divisionByZero('Modulo', a, b);
      return a % b;
    },
  },

  round: {
    minArgs: 1,
    maxArgs: 2,
    apply: ([x, digits = 0]) => {
      if (!Number.isInteger(digits)) throw domainError('round', [x, digits]);
      const factor = 10 ** digits;
      return Math.round(x * factor) / factor;
    },
  },
  floor: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.floor(x) },
  ceil: { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.ceil(x) },

  min: { minArgs: 1, maxArgs: 8, apply: (args) => Math.min(...args) },
  max: { minArgs: 1, maxArgs: 8, apply: (args) => Math.max(...args) },

  fact: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([x]) => {
      if (!Number.isInteger(x) || x < 0) throw domainError('fact', [x]);
      // 170! 约为 7.26e306，是双精度能表示的最大阶乘；171! 直接溢出为 Infinity。
      // 与其返回 Infinity 让上层困惑，不如在这里就说清楚原因。
      if (x > 170) {
        throw new CalculatorError(
          ErrorCodes.RESULT_NOT_FINITE,
          'Function "fact" exceeds the representable numeric range.',
          { function: 'fact', argument: x },
        );
      }
      let result = 1;
      for (let i = 2; i <= x; i += 1) result *= i;
      return result;
    },
  },
});

/**
 * 递归求值 AST。
 * @param {object} node
 * @returns {number}
 */
export function evaluate(node) {
  switch (node.type) {
    case 'Number':
      return node.value;

    case 'Constant': {
      // 必须用 Object.hasOwn 判断「这是不是表里自己的键」，不能只判断 !== undefined。
      // 原因：CONSTANTS 是普通对象，它的原型链上挂着 constructor / toString / valueOf 等属性。
      // 若写成 `CONSTANTS[name] !== undefined`，那么输入 "constructor" 会命中
      // Object.prototype.constructor（一个函数），从而绕过「未知标识符」检查，
      // 把一个函数当成数值继续参与计算。这类漏洞属于原型链查找陷阱。
      const value = Object.hasOwn(CONSTANTS, node.name) ? CONSTANTS[node.name] : undefined;
      if (value === undefined) {
        throw new CalculatorError(
          ErrorCodes.UNKNOWN_IDENTIFIER,
          `Unknown identifier "${node.name}".`,
          { identifier: node.name },
        );
      }
      return value;
    }

    case 'Unary': {
      const value = evaluate(node.operand);
      return node.op === '-' ? -value : value;
    }

    case 'Binary': {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) throw divisionByZero('Division', left, right);
          return left / right;
        case '^':
          return left ** right;
        default:
          throw new Error(`Unsupported binary operator: ${node.op}`);
      }
    }

    case 'Call': {
      // 同理，函数白名单也必须用 Object.hasOwn 做归属判断。
      // 否则 "constructor(1)" 会拿到原型链上的构造函数，随后在 spec.apply 处抛 TypeError，
      // 把一个本该返回 400 的用户输入错误变成 500 服务端错误。
      const spec = Object.hasOwn(FUNCTIONS, node.name) ? FUNCTIONS[node.name] : undefined;
      if (spec === undefined) {
        throw new CalculatorError(
          ErrorCodes.UNKNOWN_IDENTIFIER,
          `Unknown function "${node.name}".`,
          { identifier: node.name },
        );
      }

      const actualCount = node.args.length;
      if (actualCount < spec.minArgs || actualCount > spec.maxArgs) {
        const expected =
          spec.minArgs === spec.maxArgs ? `${spec.minArgs}` : `${spec.minArgs} to ${spec.maxArgs}`;
        throw new CalculatorError(
          ErrorCodes.BAD_ARGUMENT_COUNT,
          `Function "${node.name}" expects ${expected} argument(s) but received ${actualCount}.`,
          { function: node.name, expected, actual: actualCount },
        );
      }

      // 参数从左到右求值，保持与数学书写顺序一致。
      return spec.apply(node.args.map(evaluate));
    }

    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

export default evaluate;
