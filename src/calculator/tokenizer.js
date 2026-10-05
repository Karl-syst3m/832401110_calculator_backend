/**
 * 词法分析（Lexer / Tokenizer）
 *
 * 职责：把一串原始字符切成有意义的「记号」（token）序列，并记录每个记号在原串中的位置，
 * 这样报错时才能告诉用户「第几个字符有问题」，而不是笼统地说「表达式非法」。
 *
 * 这一层只认识「数字、运算符、括号、逗号、标识符」，
 * 至于这些记号怎么组合才合法，交给语法分析（parser.js）判断。
 * 这是编译原理里经典的关注点分离：错别字和病句由不同的阶段负责。
 */

import { CalculatorError, ErrorCodes } from './errors.js';

/** 记号类型枚举。 */
export const TokenType = Object.freeze({
  NUMBER: 'NUMBER',
  OPERATOR: 'OPERATOR',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  IDENTIFIER: 'IDENTIFIER',
  EOF: 'EOF',
});

/**
 * 全角 / 排版符号到 ASCII 的一对一映射。
 *
 * 为什么必须是一对一？
 * 因为报错位置是按字符下标给出的，一对多替换（如 "÷" -> "/ " ）会让下标整体错位，
 * 用户看到的「第 5 个字符有问题」就指向了错误的地方。
 * 下面每一项都满足「长度 1 换长度 1」，所以替换后下标依旧可靠。
 *
 * 前端界面上显示的是 × ÷，用户也可能直接从别处粘贴全角字符，
 * 因此在进入词法分析前统一归一化，比在 tokenizer 里到处判断特殊符号要干净得多。
 */
const SYMBOL_ALIASES = new Map([
  ['×', '*'], ['∗', '*'], ['＊', '*'], ['·', '*'], ['⋅', '*'],
  ['÷', '/'], ['／', '/'],
  ['−', '-'], ['–', '-'], ['—', '-'],
  ['＋', '+'],
  ['＾', '^'],
  ['（', '('], ['）', ')'],
  ['，', ','],
  ['　', ' '],
]);

/**
 * 把表达式归一化为 ASCII 形式。
 * @param {string} source
 * @returns {string}
 */
export function normalizeExpression(source) {
  let result = '';
  for (const char of source) {
    result += SYMBOL_ALIASES.get(char) ?? char;
  }
  return result;
}

const isDigit = (char) => char >= '0' && char <= '9';
const isIdentifierStart = (char) =>
  (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
const isIdentifierPart = (char) => isIdentifierStart(char) || isDigit(char);
const isWhitespace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r';

/** 合法的二元运算符字符。 */
const OPERATOR_CHARS = '+-*/^';

/**
 * 把归一化后的表达式切成记号序列。
 *
 * @param {string} source 已经过 normalizeExpression 处理的表达式
 * @returns {Array<{type: string, text: string, start: number, value?: number|string}>}
 * @throws {CalculatorError} 遇到非法字符时抛出
 */
export function tokenize(source) {
  const tokens = [];
  const length = source.length;
  let index = 0;

  while (index < length) {
    const char = source[index];

    // 空白只起分隔作用，不产生记号。
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    // ---- 数字 ----
    // 支持三种写法：整数 "12"、纯小数 ".5"、带小数 "1.5"、科学计数法 "1.5e-3"
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const start = index;

      while (index < length && isDigit(source[index])) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (index < length && isDigit(source[index])) index += 1;
      }

      // 科学计数法：只有 "e/E 后面确实跟着数字" 才当作指数消费。
      // 这一判断很关键：常量 e（自然对数底数）也存在，若不加条件，
      // 表达式 "2e" 会被误读成「2 乘以 10 的若干次方」而丢掉 e 的含义。
      // 我们的取舍是：2e3 解释为 2000；2e 解释为数字 2 后跟标识符 e（随后由语法分析报错）。
      if (source[index] === 'e' || source[index] === 'E') {
        let cursor = index + 1;
        if (source[cursor] === '+' || source[cursor] === '-') cursor += 1;
        if (isDigit(source[cursor])) {
          cursor += 1;
          while (cursor < length && isDigit(source[cursor])) cursor += 1;
          index = cursor;
        }
      }

      const text = source.slice(start, index);
      tokens.push({ type: TokenType.NUMBER, text, start, value: Number(text) });
      continue;
    }

    // ---- 括号与逗号 ----
    if (char === '(') {
      tokens.push({ type: TokenType.LPAREN, text: char, start: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: TokenType.RPAREN, text: char, start: index });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: TokenType.COMMA, text: char, start: index });
      index += 1;
      continue;
    }

    // ---- 二元运算符 ----
    if (OPERATOR_CHARS.includes(char)) {
      tokens.push({ type: TokenType.OPERATOR, text: char, start: index, value: char });
      index += 1;
      continue;
    }

    // ---- 标识符（函数名或常量名）----
    if (isIdentifierStart(char)) {
      const start = index;
      while (index < length && isIdentifierPart(source[index])) index += 1;
      tokens.push({ type: TokenType.IDENTIFIER, text: source.slice(start, index), start });
      continue;
    }

    // ---- 其余一律非法 ----
    // 这里直接把位置换算成「从 1 开始」的人类习惯说法，减少前端再做加法。
    throw new CalculatorError(
      ErrorCodes.ILLEGAL_CHARACTER,
      `Unexpected character "${char}" at position ${index + 1}.`,
      { position: index + 1, character: char },
    );
  }

  // 追加结束标记。有了它，语法分析不必反复做边界判断。
  tokens.push({ type: TokenType.EOF, text: '', start: length });
  return tokens;
}

export default tokenize;
