/**
 * Lexical analysis (Lexer / Tokenizer)
 *
 * Responsibility: cut a raw character string into a meaningful sequence of "tokens", and record each
 * token's position in the original string, so that an error report can tell the user "which
 * character is the problem" instead of vaguely saying "the expression is illegal".
 *
 * This layer only recognizes "numbers, operators, parentheses, commas, identifiers";
 * how those tokens may legally be combined is left to parsing (parser.js).
 * This is the classic separation of concerns in compiler theory: misspellings and malformed
 * sentences are the responsibility of different stages.
 */

import { CalculatorError, ErrorCodes } from './errors.js';

/** Token type enumeration. */
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
 * One-to-one mapping from full-width / typographic symbols to ASCII.
 *
 * Why must it be one-to-one?
 * Because error positions are reported as character indices, and a one-to-many replacement
 * (such as "÷" -> "/ ") would shift every index afterward, so the user's "position 5 is the
 * problem" would point at the wrong place.
 * Every entry below satisfies "one character replaced by one character", so indices remain
 * reliable after normalization.
 *
 * The front-end interface displays × and ÷, and users may also paste full-width characters from
 * elsewhere, so normalizing uniformly before lexical analysis is far cleaner than testing for
 * special symbols all over the tokenizer.
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
 * Normalize an expression into ASCII form.
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

/** Legal binary operator characters. */
const OPERATOR_CHARS = '+-*/^';

/**
 * Cut a normalized expression into a token sequence.
 *
 * @param {string} source an expression already processed by normalizeExpression
 * @returns {Array<{type: string, text: string, start: number, value?: number|string}>}
 * @throws {CalculatorError} thrown when an illegal character is encountered
 */
export function tokenize(source) {
  const tokens = [];
  const length = source.length;
  let index = 0;

  while (index < length) {
    const char = source[index];

    // Whitespace only separates; it produces no token.
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    // ---- Numbers ----
    // Three notations are supported: the integer "12", the pure fraction ".5", the decimal "1.5",
    // and scientific notation "1.5e-3"
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const start = index;

      while (index < length && isDigit(source[index])) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (index < length && isDigit(source[index])) index += 1;
      }

      // Scientific notation: consume it as an exponent only when "e/E is actually followed by digits".
      // This test is crucial: the constant e (the base of natural logarithms) also exists, so
      // without the condition the expression "2e" would be misread as "2 times some power of ten"
      // and the meaning of e would be lost.
      // Our trade-off is: 2e3 is interpreted as 2000; 2e is interpreted as the number 2 followed by
      // the identifier e (which parsing then reports as an error).
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

    // ---- Parentheses and commas ----
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

    // ---- Binary operators ----
    if (OPERATOR_CHARS.includes(char)) {
      tokens.push({ type: TokenType.OPERATOR, text: char, start: index, value: char });
      index += 1;
      continue;
    }

    // ---- Identifiers (function names or constant names) ----
    if (isIdentifierStart(char)) {
      const start = index;
      while (index < length && isIdentifierPart(source[index])) index += 1;
      tokens.push({ type: TokenType.IDENTIFIER, text: source.slice(start, index), start });
      continue;
    }

    // ---- Everything else is illegal ----
    // The position is converted here straight into the human convention of "starting from 1",
    // sparing the front end from doing the addition again.
    throw new CalculatorError(
      ErrorCodes.ILLEGAL_CHARACTER,
      `Unexpected character "${char}" at position ${index + 1}.`,
      { position: index + 1, character: char },
    );
  }

  // Append the end marker. With it, parsing does not have to repeat boundary checks.
  tokens.push({ type: TokenType.EOF, text: '', start: length });
  return tokens;
}

export default tokenize;
