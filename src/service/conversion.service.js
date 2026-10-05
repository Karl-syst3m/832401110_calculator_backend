/**
 * Base conversion and unit conversion service.
 *
 * An important architectural decision: **both conversions live in the backend**.
 *
 * There are two layers to the reason:
 *   1. The assignment explicitly requires "core computation must be completed in the backend; the front end
 *      must not compute the result directly". Base conversion is itself a numeric computation (1234 -> 4D2),
 *      so doing it in the front end would become a variant of "the front end computes and just lets the
 *      backend store it", which conflicts with the requirement.
 *   2. Funneling the conversion rules into one table in the backend (data/units.js) leaves the front end
 *      responsible only for rendering the dropdowns; changing the conversion table requires no front-end
 *      release, and the front end and backend can never disagree about the rules.
 *
 * The cost is one extra network round trip per conversion. For a feature used at a very low frequency that is
 * entirely acceptable, and the benefit of a "single source of truth for the rules" is greater.
 */

import { AppError, AppErrorCodes } from '../errors/appError.js';
import { UNIT_CATEGORIES } from '../data/units.js';
import { formatNumber } from '../calculator/format.js';

/** Allowed base range. 2 to 36 is the upper limit supported by "using 0-9 plus a-z". */
const MIN_BASE = 2;
const MAX_BASE = 36;

/** The valid digit characters of each base. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Validate a base value.
 */
function validateBase(value, fieldName) {
  const base = Number(value);
  if (!Number.isInteger(base) || base < MIN_BASE || base > MAX_BASE) {
    throw new AppError(
      AppErrorCodes.INVALID_BASE_CONVERSION,
      `Field "${fieldName}" must be an integer between ${MIN_BASE} and ${MAX_BASE}.`,
      { status: 400, detail: { field: fieldName, received: value } },
    );
  }
  return base;
}

/**
 * Convert a string in any base into a BigInt integer part plus a numeric fraction part.
 *
 * Why use BigInt for the integer part?
 * JavaScript's Number can only represent integers up to 2^53 exactly. Seven hexadecimal digits
 * (such as FFFFFFF) already equal 268435455, still within the safe range; but a slightly longer user input
 * goes out of range and produces the error "the last digit of the conversion result is 0". BigInt has
 * arbitrary precision, eliminating the problem at the root.
 *
 * The fraction part is still handled with Number: fractional conversion is approximate by nature (0.1 is an
 * infinite repeating fraction in binary), and representing it with finite precision is standard industry
 * practice; it is deliberately kept to 12 significant digits.
 */
function parseInBase(rawValue, base) {
  const text = rawValue.trim().toLowerCase();

  if (text === '') {
    throw new AppError(
      AppErrorCodes.INVALID_BASE_CONVERSION,
      'Field "value" must not be empty.',
      { status: 400 },
    );
  }

  let negative = false;
  let body = text;
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1);
  } else if (body.startsWith('+')) {
    body = body.slice(1);
  }

  // Normalize full-width decimal points, so users can paste from elsewhere.
  body = body.replace('。', '.').replace('．', '.');

  const [integerPart = '', fractionPart = ''] = body.split('.');
  if (integerPart === '' && fractionPart === '') {
    throw new AppError(
      AppErrorCodes.INVALID_BASE_CONVERSION,
      `"${rawValue}" is not a valid number.`,
      { status: 400, detail: { value: rawValue } },
    );
  }

  const validChars = DIGITS.slice(0, base);

  const checkDigits = (segment, segmentName) => {
    for (const char of segment) {
      if (!validChars.includes(char)) {
        throw new AppError(
          AppErrorCodes.INVALID_BASE_CONVERSION,
          `Digit "${char}" is not valid in base ${base} (allowed: ${validChars}).`,
          { status: 400, detail: { digit: char, base, segment: segmentName } },
        );
      }
    }
  };
  checkDigits(integerPart, 'integer');
  checkDigits(fractionPart, 'fraction');

  // Integer part: accumulate digit by digit; BigInt guarantees exactness at any length.
  let integerValue = 0n;
  const bigBase = BigInt(base);
  for (const char of integerPart) {
    integerValue = integerValue * bigBase + BigInt(DIGITS.indexOf(char));
  }

  // Fraction part: convert to Number according to positional weight.
  let fractionValue = 0;
  for (let i = 0; i < fractionPart.length; i += 1) {
    fractionValue += DIGITS.indexOf(fractionPart[i]) / base ** (i + 1);
  }

  return { negative, integerValue, fractionValue, hasFraction: fractionPart !== '' };
}

/** Output the integer part as a string in the target base. */
function bigIntToString(value, base) {
  if (value === 0n) return '0';
  let result = '';
  const bigBase = BigInt(base);
  let current = value;
  while (current > 0n) {
    const digit = Number(current % bigBase);
    result = DIGITS[digit] + result;
    current /= bigBase;
  }
  return result;
}

/**
 * Convert the fraction part to the target base: the multiply-by-base-and-take-the-integer method.
 *
 * Taking 0.625 to binary as an example:
 *   0.625*2 = 1.25 -> take integer 1, remainder 0.25
 *   0.25*2  = 0.5  -> take integer 0, remainder 0.5
 *   0.5*2   = 1.0  -> take integer 1, remainder 0
 * This gives .101; verification: 1/2 + 0/4 + 1/8 = 0.625 ✓
 *
 * @param {number} fraction a fraction between 0 and 1
 * @param {number} base the target base
 * @param {number} maxDigits the maximum number of digits to output, preventing an infinite loop (such as 0.1 to binary)
 */
function fractionToString(fraction, base, maxDigits = 16) {
  let result = '';
  let current = fraction;
  for (let i = 0; i < maxDigits && current > 0; i += 1) {
    current *= base;
    const digit = Math.floor(current);
    result += DIGITS[digit];
    current -= digit;
    // Double-precision error turns current into an extremely small nonzero value, producing meaningless
    // trailing digits; 1e-12 is used here as the threshold for "already zero".
    if (current < 1e-12) break;
  }
  return result;
}

/**
 * Base conversion.
 *
 * @param {object} input
 * @param {string} input.value the numeric string to convert
 * @param {number} input.fromBase the source base
 * @param {number} input.toBase the target base
 */
export function convertBase({ value, fromBase, toBase }) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(
      AppErrorCodes.INVALID_BASE_CONVERSION,
      'Field "value" is required and must be a string or number.',
      { status: 400, detail: { receivedType: typeof value } },
    );
  }

  const sourceBase = validateBase(fromBase, 'fromBase');
  const targetBase = validateBase(toBase, 'toBase');

  const parsed = parseInBase(String(value), sourceBase);

  let output = bigIntToString(parsed.integerValue, targetBase);
  if (parsed.hasFraction && parsed.fractionValue > 0) {
    const fractionText = fractionToString(parsed.fractionValue, targetBase);
    if (fractionText !== '') {
      output = `${output}.${fractionText}`;
    }
  }
  if (parsed.negative && !(parsed.integerValue === 0n && parsed.fractionValue === 0)) {
    output = `-${output}`;
  }

  return {
    input: String(value),
    fromBase: sourceBase,
    toBase: targetBase,
    output,
    // The decimal value is also given, so the user can check it and keep calculating.
    decimalValue: formatNumber(
      (parsed.negative ? -1 : 1) * (Number(parsed.integerValue) + parsed.fractionValue),
    ),
  };
}

/**
 * Unit conversion.
 *
 * @param {object} input
 * @param {string} input.category the category, such as length / temperature
 * @param {string} input.from the source unit
 * @param {string} input.to the target unit
 * @param {number} input.value the value to convert
 */
export function convertUnit({ category, from, to, value }) {
  // Same handling as in the evaluator: before looking up a table, confirm the key belongs to the table
  // itself, avoiding hits on prototype chain properties.
  if (!Object.hasOwn(UNIT_CATEGORIES, category)) {
    throw new AppError(
      AppErrorCodes.INVALID_UNIT_CONVERSION,
      `Unknown unit category "${category}".`,
      { status: 400, detail: { category, supported: Object.keys(UNIT_CATEGORIES) } },
    );
  }
  const spec = UNIT_CATEGORIES[category];

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new AppError(
      AppErrorCodes.INVALID_UNIT_CONVERSION,
      'Field "value" must be a finite number.',
      { status: 400, detail: { value } },
    );
  }

  if (!Object.hasOwn(spec.units, from) || !Object.hasOwn(spec.units, to)) {
    const unknown = Object.hasOwn(spec.units, from) ? to : from;
    throw new AppError(
      AppErrorCodes.INVALID_UNIT_CONVERSION,
      `Unknown unit "${unknown}" in category "${category}".`,
      { status: 400, detail: { category, from, to, supported: Object.keys(spec.units) } },
    );
  }

  const fromUnit = spec.units[from];
  const toUnit = spec.units[to];

  let result;
  if (spec.kind === 'affine') {
    // Temperature: convert to the base unit (Celsius) first, then out of the base.
    result = toUnit.fromBase(fromUnit.toBase(numericValue));
  } else {
    result = (numericValue * fromUnit.factor) / toUnit.factor;
  }

  return {
    category,
    from,
    to,
    input: numericValue,
    output: result,
    outputText: formatNumber(result),
  };
}

/** Return every conversion category and unit, for the front end to render the dropdowns. */
export function listUnits() {
  const categories = Object.entries(UNIT_CATEGORIES).map(([key, spec]) => ({
    key,
    label: spec.label,
    kind: spec.kind,
    base: spec.base,
    units: Object.entries(spec.units).map(([unitKey, unitSpec]) => ({
      key: unitKey,
      label: unitSpec.label,
    })),
  }));
  return { categories };
}

export default { convertBase, convertUnit, listUnits };
