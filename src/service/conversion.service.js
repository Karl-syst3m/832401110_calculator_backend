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
import { CalculatorError, ErrorCodes } from '../calculator/errors.js';
import { UNIT_CATEGORIES } from '../data/units.js';
import { formatNumber } from '../calculator/format.js';

/** Allowed base range. 2 to 36 is the upper limit supported by "using 0-9 plus a-z". */
const MIN_BASE = 2;
const MAX_BASE = 36;

/** The valid digit characters of each base. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Digit budget for the fraction part when the expansion does not terminate in the target base (0.1 in
 * binary, for example). It is a floor, not a hard cap: an identity conversion never truncates, see
 * fractionToString.
 */
const DEFAULT_MAX_FRACTION_DIGITS = 16;

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

  // A number has at most one decimal point. Destructuring the split and keeping only the first two
  // segments would silently discard the rest, so malformed input such as "1.2.3" used to come back as a
  // successful conversion of "1.2"; it is rejected explicitly instead.
  const segments = body.split('.');
  if (segments.length > 2) {
    throw new AppError(
      AppErrorCodes.INVALID_BASE_CONVERSION,
      `"${rawValue}" is not a valid number: it contains more than one decimal point.`,
      { status: 400, detail: { value: rawValue } },
    );
  }
  const [integerPart = '', fractionPart = ''] = segments;
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

  // Fraction part, exact rational form (value = numerator / denominator). The digit-by-digit conversion to
  // the target base uses this instead of the floating-point value, so that no digit is ever produced by
  // rounding error. The invariant numerator < denominator always holds: the digit sum is at most
  // base^n - 1 for a denominator of base^n.
  let fractionNumerator = 0n;
  let fractionDenominator = 1n;
  for (const char of fractionPart) {
    fractionNumerator = fractionNumerator * bigBase + BigInt(DIGITS.indexOf(char));
    fractionDenominator *= bigBase;
  }

  // Fraction part as a Number, used only for the informative decimalValue: the positional sum is always
  // below 1 (each term is smaller than base^-i), so unlike the integer part it cannot overflow to Infinity.
  let fractionValue = 0;
  for (let i = 0; i < fractionPart.length; i += 1) {
    fractionValue += DIGITS.indexOf(fractionPart[i]) / base ** (i + 1);
  }

  return {
    negative,
    integerValue,
    fractionValue,
    fractionNumerator,
    fractionDenominator,
    fractionDigits: fractionPart.length,
    hasFraction: fractionPart !== '',
  };
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
 * The fraction is carried as an exact rational and the arithmetic is done with BigInt. That is a
 * correctness fix, not merely a precision one: with double arithmetic `Math.floor(current * base)` can
 * round up to exactly `base`, and `DIGITS[base]` is one character past the end of the digit alphabet —
 * which is how base 16 emitted the invalid digit "g" (and base 2 emitted "2"). Because the remainder is
 * always smaller than the denominator, `digit = (remainder * base) / denominator` is at most base - 1 by
 * construction, and the loop ends when the remainder is exactly zero, so a final digit is never fabricated.
 *
 * @param {bigint} numerator the fraction numerator (value = numerator / denominator)
 * @param {bigint} denominator the fraction denominator
 * @param {number} base the target base
 * @param {number} maxDigits the maximum number of digits to output, preventing an infinite loop (such as 0.1 to binary)
 */
function fractionToString(numerator, denominator, base, maxDigits) {
  let result = '';
  let remainder = numerator;
  const bigBase = BigInt(base);
  for (let i = 0; i < maxDigits && remainder > 0n; i += 1) {
    remainder *= bigBase;
    const digit = Number(remainder / denominator);
    result += DIGITS[digit];
    remainder %= denominator;
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
  if (parsed.hasFraction && parsed.fractionNumerator > 0n) {
    // The digit budget is never smaller than the source fraction, so an identity conversion
    // (fromBase === toBase) always terminates before the cap and round-trips unchanged, while a
    // non-terminating expansion (0.1 to binary) is truncated at the budget instead of being padded.
    const maxDigits = Math.max(DEFAULT_MAX_FRACTION_DIGITS, parsed.fractionDigits);
    const fractionText = fractionToString(
      parsed.fractionNumerator,
      parsed.fractionDenominator,
      targetBase,
      maxDigits,
    );
    if (fractionText !== '') {
      output = `${output}.${fractionText}`;
    }
  }
  if (parsed.negative && !(parsed.integerValue === 0n && parsed.fractionNumerator === 0n)) {
    output = `-${output}`;
  }

  // The integer part is arbitrary-precision BigInt, but decimalValue has to be a double: a 300-digit
  // hexadecimal input has no finite decimal representation. Returning Infinity would contradict itself in
  // the response body (JSON serialises Infinity as null while outputText says "Infinity"), so a result that
  // does not fit is rejected exactly the way the calculation kernel rejects one.
  const decimalValue = (parsed.negative ? -1 : 1)
    * (Number(parsed.integerValue) + parsed.fractionValue);
  if (!Number.isFinite(decimalValue)) {
    throw new CalculatorError(
      ErrorCodes.RESULT_NOT_FINITE,
      'The result is out of the representable numeric range.',
      { input: String(value), fromBase: sourceBase, toBase: targetBase },
    );
  }

  return {
    input: String(value),
    fromBase: sourceBase,
    toBase: targetBase,
    output,
    // The decimal value is also given, so the user can check it and keep calculating.
    decimalValue: formatNumber(decimalValue),
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

  // Mirror convertBase's strictness. Calling Number(value) directly would silently turn "" and null into 0
  // and true into 1, so an empty or missing value used to come back as a successful conversion of zero.
  // Only an actual number or a non-empty numeric string is accepted.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new AppError(
      AppErrorCodes.INVALID_UNIT_CONVERSION,
      'Field "value" is required and must be a number or a numeric string.',
      { status: 400, detail: { receivedType: value === null ? 'null' : typeof value } },
    );
  }

  const valueText = typeof value === 'string' ? value.trim() : null;
  if (valueText === '') {
    throw new AppError(
      AppErrorCodes.INVALID_UNIT_CONVERSION,
      'Field "value" must not be empty.',
      { status: 400 },
    );
  }

  const numericValue = typeof value === 'number' ? value : Number(valueText);
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

  // Same guard as the calculation kernel: 1e308 metres in nanometres overflows a double, and answering 200
  // with output: null next to outputText: "Infinity" would be a self-contradictory response body.
  if (!Number.isFinite(result)) {
    throw new CalculatorError(
      ErrorCodes.RESULT_NOT_FINITE,
      'The result is out of the representable numeric range.',
      { category, from, to, value: numericValue },
    );
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
