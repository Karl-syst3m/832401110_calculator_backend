/**
 * 进制换算与单位换算服务。
 *
 * 一个重要的架构决策：**这两种换算都放在后端**。
 *
 * 原因有两层：
 *   1. 作业明确要求「核心计算必须在后端完成，前端不得直接算出结果」。
 *      进制换算本身就是一次数值计算（1234 -> 4D2），如果放在前端做，
 *      就成了「前端算完只让后端存一下」的变体，与要求相抵触。
 *   2. 把换算规则收敛到后端一张表（data/units.js），前端只负责渲染下拉框，
 *      改动换算表不需要发版前端，也不会出现前后端规则不一致。
 *
 * 代价是每次换算多一次网络往返。对一个交互频率很低的功能来说完全可以接受，
 * 而「规则单一事实来源」带来的收益更大。
 */

import { AppError, AppErrorCodes } from '../errors/appError.js';
import { UNIT_CATEGORIES } from '../data/units.js';
import { formatNumber } from '../calculator/format.js';

/** 允许的进制范围。2 到 36 是「用 0-9 加 a-z 表示」所支持的上限。 */
const MIN_BASE = 2;
const MAX_BASE = 36;

/** 各进制的合法数字字符。 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * 校验进制取值。
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
 * 把任意进制的字符串转成 BigInt 整数部分 + 小数部分数值。
 *
 * 为什么整数部分用 BigInt？
 * JavaScript 的 Number 只能精确表示 2^53 以内的整数。十六进制的 7 位数字
 * （如 FFFFFFF）就已是 268435455，尚在安全范围内；但用户输入长一点就会越界，
 * 出现「转换结果末位是 0」的错误。BigInt 是任意精度，从根上避免这个问题。
 *
 * 小数部分仍用 Number 处理：小数换算本来就是近似值（如 0.1 在二进制里是无限循环），
 * 用有限精度表示是行业通行做法，刻意保留到 12 位有效数字。
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

  // 归一化全角小数点，方便用户从别处粘贴。
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

  // 整数部分：逐位累加，BigInt 保证任意长度都精确。
  let integerValue = 0n;
  const bigBase = BigInt(base);
  for (const char of integerPart) {
    integerValue = integerValue * bigBase + BigInt(DIGITS.indexOf(char));
  }

  // 小数部分：按位权折算成 Number。
  let fractionValue = 0;
  for (let i = 0; i < fractionPart.length; i += 1) {
    fractionValue += DIGITS.indexOf(fractionPart[i]) / base ** (i + 1);
  }

  return { negative, integerValue, fractionValue, hasFraction: fractionPart !== '' };
}

/** 把整数部分按目标进制输出为字符串。 */
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
 * 小数部分转目标进制：乘基取整法。
 *
 * 以 0.625 转二进制为例：
 *   0.625*2 = 1.25 -> 取整 1，余 0.25
 *   0.25*2  = 0.5  -> 取整 0，余 0.5
 *   0.5*2   = 1.0  -> 取整 1，余 0
 * 得到 .101，验证：1/2 + 0/4 + 1/8 = 0.625 ✓
 *
 * @param {number} fraction 0 到 1 之间的小数
 * @param {number} base 目标进制
 * @param {number} maxDigits 最多输出的位数，防止无限循环（如 0.1 转二进制）
 */
function fractionToString(fraction, base, maxDigits = 16) {
  let result = '';
  let current = fraction;
  for (let i = 0; i < maxDigits && current > 0; i += 1) {
    current *= base;
    const digit = Math.floor(current);
    result += DIGITS[digit];
    current -= digit;
    // 双精度误差会让 current 变成一个极小的非零值，产生无意义的尾随位，
    // 这里用 1e-12 作为「已经归零」的判定阈值。
    if (current < 1e-12) break;
  }
  return result;
}

/**
 * 进制换算。
 *
 * @param {object} input
 * @param {string} input.value 待换算的数值字符串
 * @param {number} input.fromBase 源进制
 * @param {number} input.toBase 目标进制
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
    // 同时给出十进制数值，方便用户核对与继续计算。
    decimalValue: formatNumber(
      (parsed.negative ? -1 : 1) * (Number(parsed.integerValue) + parsed.fractionValue),
    ),
  };
}

/**
 * 单位换算。
 *
 * @param {object} input
 * @param {string} input.category 类别，如 length / temperature
 * @param {string} input.from 源单位
 * @param {string} input.to 目标单位
 * @param {number} input.value 待换算的数值
 */
export function convertUnit({ category, from, to, value }) {
  // 同 evaluator 里的处理：查表前必须确认键是表自己的，避免命中原型链属性。
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
    // 温度：先换到基准单位（摄氏度），再从基准换出去。
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

/** 返回全部换算类别与单位，供前端渲染下拉框。 */
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
