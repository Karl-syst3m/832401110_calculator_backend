/**
 * Numeric normalization and formatting
 *
 * The core problem being solved: the decimal representation of IEEE-754 double-precision floats is
 * inexact. The most famous example is 0.1 + 0.2 === 0.30000000000000004.
 * Returning that to the user as-is would put this "obviously miscalculated" result on screen, even
 * though it is normal floating-point behavior and not a computation error.
 *
 * Handling strategy (this trade-off needs to be stated):
 * Round the result to 12 significant digits.
 *   - 12 digits is far fewer than the ~15.95 significant digits of a double, so for the vast majority
 *     of expressions it loses no precision the user cares about;
 *   - and it is large enough to preserve the meaningful information of results such as
 *     1/3 = 0.333333333333.
 * This is a trade-off "oriented toward human readability", not a pursuit of "mathematically exact"
 * behavior. Truly exact decimal arithmetic would require pulling in something like decimal.js, which
 * is over-engineering for a course assignment.
 */

/** Number of significant digits to keep. */
export const SIGNIFICANT_DIGITS = 12;

/** Above this magnitude, scientific notation is used for display; otherwise integers grow too long to read. */
const EXPONENTIAL_UPPER_BOUND = 1e15;

/** Below this magnitude, scientific notation is used as well; otherwise unreadable forms like 0.000000001 appear. */
const EXPONENTIAL_LOWER_BOUND = 1e-9;

/**
 * Wipe away floating-point noise to obtain "the number the user expects to see".
 * @param {number} value
 * @returns {number}
 */
export function normalizeNumber(value) {
  if (!Number.isFinite(value)) return value;
  // Handle 0 explicitly: first, toPrecision is meaningless for 0; second, this normalizes -0 to 0,
  // avoiding the odd-looking "-0" output on screen.
  if (value === 0) return 0;
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/** Strip meaningless trailing zeros from the mantissa of scientific notation: 1.50000000000e+18 -> 1.5e+18 */
function trimExponential(text) {
  const [mantissa, exponent] = text.split('e');
  if (!mantissa.includes('.')) return text;
  const trimmed = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  return `${trimmed}e${exponent}`;
}

/**
 * Convert a number into the string used for display and for storage.
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
  const normalized = normalizeNumber(value);
  if (normalized === 0) return '0';

  const abs = Math.abs(normalized);
  if (abs >= EXPONENTIAL_UPPER_BOUND || abs < EXPONENTIAL_LOWER_BOUND) {
    return trimExponential(normalized.toExponential(SIGNIFICANT_DIGITS - 1));
  }
  return String(normalized);
}
