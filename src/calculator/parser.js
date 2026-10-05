/**
 * Parsing (Parser) — recursive descent
 *
 * Why hand-written recursive descent, rather than:
 *   - Using eval / new Function: explicitly forbidden by the assignment; they execute user input as
 *     program code, so a single `process.exit()` can take the service down — a textbook injection vulnerability.
 *   - Using shunting-yard: it computes correctly too, but it only produces a postfix sequence, which
 *     makes it awkward to separate "syntax errors" from "mathematical errors" before evaluation, and
 *     awkward to extend with function calls later.
 *   - Pulling in a third-party library (such as mathjs): legal and convenient, but `mathjs` also
 *     supports assignment, units, matrices and more, an attack surface far larger than a calculator needs.
 *
 * The greatest benefit of recursive descent is that "the grammar is the code": each function below
 * corresponds one-to-one to a grammar production, the code structure matches how mathematics is
 * written, and a reviewer can check correctness directly against the grammar.
 *
 * Grammar (EBNF, earlier means lower precedence):
 *
 *   expression   := additive
 *   additive     := multiplicative ( ("+" | "-") multiplicative )*
 *   multiplicative := unary ( ("*" | "/") unary )*
 *   unary        := ("+" | "-") unary | power
 *   power        := primary ( "^" unary )?
 *   primary      := NUMBER
 *                 | IDENTIFIER
 *                 | IDENTIFIER "(" arguments ")"
 *                 | "(" expression ")"
 *   arguments    := expression ( "," expression )*
 *
 * Three precedence trade-offs that are easy to get wrong and need special explanation:
 *
 * 1) Binding of the minus sign and exponentiation: -2^2 should equal -4 (the power is computed first,
 *    then the negation), so unary sits above power, i.e. unary consumes the minus sign first and hands
 *    the rest to power.
 *
 * 2) Right associativity of exponentiation: 2^3^2 should equal 2^9 = 512, so the exponent part of
 *    power calls unary recursively rather than primary, which lets it keep consuming the next ^ to the right.
 *
 * 3) Exponents may carry a minus sign: 2^-3 should be legal (equal to 0.125).
 *    It is precisely because power's exponent uses unary that "-3" can be parsed correctly; primary would not do it.
 */

import { CalculatorError, ErrorCodes } from './errors.js';
import { tokenize, TokenType } from './tokenizer.js';

/**
 * Maximum nesting depth of parentheses / unary signs.
 * The depth of recursion is proportional to the nesting level in the input; without a limit, a request
 * with "((" repeated a hundred thousand times would blow up the call stack (a stack overflow is an
 * availability problem).
 * 64 levels is far beyond any normal expression, so limiting it does not affect real use.
 */
const MAX_DEPTH = 64;

/**
 * Parse an expression into an abstract syntax tree (AST).
 *
 * Why not evaluate while parsing?
 * Because once separated, "is the expression legal" can be tested independently of numeric values;
 * and the evaluation stage receives a structured tree, so a domain problem such as sqrt(-1) can be
 * pinpointed to "which function, which argument", a completely different quality of error report.
 *
 * @param {string} source an already normalized expression
 * @returns {object} AST root node
 * @throws {CalculatorError}
 */
export function parse(source) {
  const tokens = tokenize(source);
  const length = tokens.length;
  let position = 0;
  let depth = 0;

  const peek = () => tokens[position];
  const advance = () => tokens[position++];

  const enterDepth = () => {
    depth += 1;
    if (depth > MAX_DEPTH) {
      throw new CalculatorError(
        ErrorCodes.EXPRESSION_TOO_DEEP,
        `Expression is nested too deeply (limit: ${MAX_DEPTH}).`,
        { maxDepth: MAX_DEPTH },
      );
    }
  };
  const leaveDepth = () => {
    depth -= 1;
  };

  function parseExpression() {
    return parseAdditive();
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek().type === TokenType.OPERATOR && (peek().value === '+' || peek().value === '-')) {
      const operator = advance().value;
      const right = parseMultiplicative();
      left = { type: 'Binary', op: operator, left, right };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (peek().type === TokenType.OPERATOR && (peek().value === '*' || peek().value === '/')) {
      const operator = advance().value;
      const right = parseUnary();
      left = { type: 'Binary', op: operator, left, right };
    }
    return left;
  }

  function parseUnary() {
    const token = peek();
    if (token.type === TokenType.OPERATOR && (token.value === '+' || token.value === '-')) {
      advance();
      enterDepth();
      const operand = parseUnary();
      leaveDepth();
      // The unary plus sign is mathematically an identity, but keeping the node lets the AST faithfully
      // reflect the user's input and makes "expression echo" easier in the future. Evaluation simplifies it naturally.
      return { type: 'Unary', op: token.value, operand };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek().type === TokenType.OPERATOR && peek().value === '^') {
      advance();
      // The exponent position calls parseUnary: this both implements right associativity and allows
      // the 2^-3 form.
      const exponent = parseUnary();
      return { type: 'Binary', op: '^', left: base, right: exponent };
    }
    return base;
  }

  function parseArguments() {
    const args = [];
    if (peek().type === TokenType.RPAREN) {
      return args; // Empty argument list, as in random(); whether the count is legal is left to the evaluation stage
    }
    args.push(parseExpression());
    while (peek().type === TokenType.COMMA) {
      advance();
      args.push(parseExpression());
    }
    return args;
  }

  function parsePrimary() {
    const token = peek();

    if (token.type === TokenType.NUMBER) {
      advance();
      return { type: 'Number', value: token.value, text: token.text };
    }

    if (token.type === TokenType.LPAREN) {
      advance();
      enterDepth();
      const inner = parseExpression();
      leaveDepth();
      if (peek().type !== TokenType.RPAREN) {
        throw new CalculatorError(
          ErrorCodes.UNBALANCED_PARENTHESIS,
          'Missing closing parenthesis ")".',
          { position: peek().start + 1 },
        );
      }
      advance();
      // No extra grouping node is wrapped around it: parentheses only affect the order of association,
      // which the tree structure already expresses.
      return inner;
    }

    if (token.type === TokenType.IDENTIFIER) {
      advance();
      const name = token.text.toLowerCase();

      if (peek().type === TokenType.LPAREN) {
        advance();
        enterDepth();
        const args = parseArguments();
        leaveDepth();
        if (peek().type !== TokenType.RPAREN) {
          throw new CalculatorError(
            ErrorCodes.UNBALANCED_PARENTHESIS,
            `Missing closing parenthesis for function "${name}".`,
            { position: peek().start + 1, function: name },
          );
        }
        advance();
        return { type: 'Call', name, args };
      }

      // Any identifier without parentheses is treated as a constant; whether it is known is decided by the evaluation stage.
      return { type: 'Constant', name };
    }

    if (token.type === TokenType.EOF) {
      throw new CalculatorError(
        ErrorCodes.UNEXPECTED_END,
        'Expression ended unexpectedly; an operand is missing.',
        { position: token.start + 1 },
      );
    }

    throw new CalculatorError(
      ErrorCodes.UNEXPECTED_TOKEN,
      `Unexpected token "${token.text}" at position ${token.start + 1}.`,
      { position: token.start + 1, token: token.text },
    );
  }

  const ast = parseExpression();

  // Parsing must consume exactly the whole string. Leftover tokens mean the expression has extra
  // content after a legal prefix, for example "1+2)" or "1 2". If such an error were ignored, the user
  // would get a result that "looks right".
  if (peek().type !== TokenType.EOF) {
    const token = peek();
    throw new CalculatorError(
      ErrorCodes.UNEXPECTED_TOKEN,
      `Unexpected token "${token.text}" at position ${token.start + 1}.`,
      { position: token.start + 1, token: token.text },
    );
  }

  return ast;
}

export default parse;
