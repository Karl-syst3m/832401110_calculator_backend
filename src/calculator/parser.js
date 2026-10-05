/**
 * 语法分析（Parser）——递归下降法
 *
 * 为什么选手写递归下降，而不是：
 *   - 用 eval / new Function：作业明令禁止，它们会把用户输入当程序代码执行，
 *     一句 `process.exit()` 就能把服务打垮，属于典型的注入漏洞。
 *   - 用 shunting-yard（调度场算法）：也能算对，但它只产出后缀序列，
 *     不便于在求值前区分「语法错误」和「数学错误」，也不便于将来扩展函数调用。
 *   - 引第三方库（如 mathjs）：合法且省事，但 `mathjs` 会顺带支持赋值、单位、
 *     矩阵等能力，攻击面远大于一个计算器所需。
 *
 * 递归下降的最大好处是「文法即代码」：下面每个函数一一对应一条文法产生式，
 * 代码结构和数学书写习惯同形，评审者可以直接对照文法检查正确性。
 *
 * 文法（EBNF，越靠前优先级越低）：
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
 * 三处容易写错、需要特别说明的优先级取舍：
 *
 * 1) 负号与乘方的结合：-2^2 应当等于 -4（先算幂再取负），
 *    所以 unary 在 power 之上，即 unary 先吃掉负号，再把剩下的交给 power。
 *
 * 2) 幂的右结合：2^3^2 应当等于 2^9 = 512，所以 power 的指数部分递归调用 unary
 *    而不是 primary，这让它继续向右吃掉下一个 ^。
 *
 * 3) 指数允许带负号：2^-3 应当合法（等于 0.125）。
 *    正因为 power 的指数用了 unary，"-3" 才能被正确解析；若用 primary 就做不到。
 */

import { CalculatorError, ErrorCodes } from './errors.js';
import { tokenize, TokenType } from './tokenizer.js';

/**
 * 括号/一元符号的最大嵌套深度。
 * 递归下降的深度正比于输入里嵌套层数，不设上限的话，
 * 一个 "((" 重复十万次的请求就能把调用栈打爆（栈溢出属于可用性问题）。
 * 64 层远超任何正常算式，因此限制它不会影响真实使用。
 */
const MAX_DEPTH = 64;

/**
 * 把表达式解析为抽象语法树（AST）。
 *
 * 为什么不边解析边求值？
 * 因为分离之后，「表达式合不合法」这件事可以脱离数值单独测试；
 * 而且求值阶段拿到的是一棵结构化的树，遇到 sqrt(-1) 这类定义域问题
 * 能精确定位到「哪个函数、哪个参数」，报错质量完全不同。
 *
 * @param {string} source 已经过归一化的表达式
 * @returns {object} AST 根节点
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
      // 一元正号在数学上恒等，但保留节点可以让 AST 忠实反映用户输入，
      // 也便于将来做「表达式回显」。求值时会自然简化。
      return { type: 'Unary', op: token.value, operand };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek().type === TokenType.OPERATOR && peek().value === '^') {
      advance();
      // 指数位置调用 parseUnary：既实现右结合，又允许 2^-3 这种写法。
      const exponent = parseUnary();
      return { type: 'Binary', op: '^', left: base, right: exponent };
    }
    return base;
  }

  function parseArguments() {
    const args = [];
    if (peek().type === TokenType.RPAREN) {
      return args; // 空参数列表，例如 random()；参数个数是否合法交给求值阶段判断
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
      // 不额外包一层分组节点：括号只影响结合顺序，结构上已由树形体现。
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

      // 不带括号的标识符一律当常量处理，是否认识它由求值阶段判断。
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

  // 解析必须恰好消耗完整串。剩下记号说明表达式在合法前缀之后还有多余内容，
  // 例如 "1+2)" 或 "1 2"。这类错误若被忽略，用户会拿到一个「看起来对」的结果。
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
