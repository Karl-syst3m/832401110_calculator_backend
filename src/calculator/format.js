/**
 * 数值规范化与格式化
 *
 * 要解决的核心问题：IEEE-754 双精度浮点数的十进制表示不精确。
 * 最出名的例子是 0.1 + 0.2 === 0.30000000000000004。
 * 如果原样返回给用户，界面上就会出现这个「明显算错了」的结果，
 * 而这其实是浮点数的正常行为，不是计算错误。
 *
 * 处理策略（需要说明取舍）：
 * 把结果四舍五入到 12 位有效数字。
 *   - 12 位远小于双精度的 ~15.95 位有效数字，所以对绝大多数算式不会损失用户关心的精度；
 *   - 又足够大，能保留 1/3 = 0.333333333333 这类结果的有效信息。
 * 这是一个「面向人类阅读」的取舍，而不是追求「数学上完全精确」。
 * 真正的精确十进制运算需要引入 decimal.js 之类的实现，对一个课程作业而言是过度设计。
 */

/** 保留的有效数字位数。 */
export const SIGNIFICANT_DIGITS = 12;

/** 超过这个量级就用科学计数法显示，否则整数会长到无法阅读。 */
const EXPONENTIAL_UPPER_BOUND = 1e15;

/** 低于这个量级也用科学计数法，否则会出现 0.000000001 这类难读的写法。 */
const EXPONENTIAL_LOWER_BOUND = 1e-9;

/**
 * 把浮点噪声抹掉，得到「用户期望看到的那个数」。
 * @param {number} value
 * @returns {number}
 */
export function normalizeNumber(value) {
  if (!Number.isFinite(value)) return value;
  // 显式处理 0：一是 toPrecision 对 0 无意义，二是为了把 -0 归一成 0，
  // 避免界面上出现 "-0" 这种看起来很怪的输出。
  if (value === 0) return 0;
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/** 去掉科学计数法尾数里无意义的尾随零：1.50000000000e+18 -> 1.5e+18 */
function trimExponential(text) {
  const [mantissa, exponent] = text.split('e');
  if (!mantissa.includes('.')) return text;
  const trimmed = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  return `${trimmed}e${exponent}`;
}

/**
 * 把数值转成用于展示和入库的字符串。
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
