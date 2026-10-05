/**
 * Evaluation
 *
 * The input is the AST produced by the parser, and the output is a double-precision float.
 * This layer is responsible for every judgment that is "purely about numbers": division by zero,
 * domain, argument count, and result overflow.
 *
 * Security boundary notes:
 * FUNCTIONS and CONSTANTS are two whitelist tables. Identifiers are looked up in these tables at
 * this layer first; anything absent from a table is reported as an error immediately, and **there
 * is no path anywhere that "fetches a function dynamically by name"**.
 * The essential difference from eval is this: user input is only ever used to "look up a table",
 * never executed as code, so even if someone submits any bizarre input other than sqrt(1), all they
 * can reach are the pure mathematical functions in that table.
 */

import { CalculatorError, ErrorCodes } from './errors.js';

/**
 * Construct a domain error. It is extracted separately because domain errors occur extremely
 * often in this table, and centralizing them lets every function body stay on one line, which
 * makes it easier to read through.
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

/** Supported mathematical constants. */
export const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
});

/**
 * Whitelist of supported functions.
 * Each entry declares an argument count interval (minArgs/maxArgs) and a pure function apply.
 * Writing the argument counts into the table is what lets "the function name exists but the
 * arguments are wrong" also produce a clear error, instead of computing NaN and leaving the user
 * to guess.
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
      // tan is undefined at pi/2. In double precision Math.cos(Math.PI/2) is about 6.1e-17
      // rather than exactly 0, so computing it directly yields an absurd number on the order of
      // 1.6e16. We intercept it explicitly and report a domain error.
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
      // 170! is about 7.26e306, the largest factorial a double can represent; 171! simply
      // overflows to Infinity. Rather than returning Infinity and confusing the layer above,
      // it is better to state the reason clearly here.
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
 * Recursively evaluate an AST.
 * @param {object} node
 * @returns {number}
 */
export function evaluate(node) {
  switch (node.type) {
    case 'Number':
      return node.value;

    case 'Constant': {
      // Object.hasOwn must be used to test "is this the table's own key", not just !== undefined.
      // The reason: CONSTANTS is an ordinary object, and its prototype chain carries constructor /
      // toString / valueOf and so on. Written as `CONSTANTS[name] !== undefined`, the input
      // "constructor" would hit Object.prototype.constructor (a function), bypass the unknown
      // identifier check, and treat a function as a number in the following computation.
      // This class of vulnerability is the prototype chain lookup trap.
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
      // Likewise, the function whitelist must use Object.hasOwn for the ownership test.
      // Otherwise "constructor(1)" would fetch the constructor from the prototype chain and then
      // throw a TypeError at spec.apply, turning a user input error that should return 400 into a
      // 500 server error.
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

      // Arguments are evaluated left to right, matching the order in which mathematics is written.
      return spec.apply(node.args.map(evaluate));
    }

    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

export default evaluate;
