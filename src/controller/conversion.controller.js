/**
 * 换算接口控制器（扩展功能）。
 */

import * as conversionService from '../service/conversion.service.js';

/** POST /api/convert/base —— 进制换算 */
export function convertBase(req, res, next) {
  try {
    const body = req.body ?? {};
    const result = conversionService.convertBase({
      value: body.value,
      fromBase: body.fromBase,
      toBase: body.toBase,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** POST /api/convert/unit —— 单位换算 */
export function convertUnit(req, res, next) {
  try {
    const body = req.body ?? {};
    const result = conversionService.convertUnit({
      category: body.category,
      from: body.from,
      to: body.to,
      value: body.value,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/convert/units —— 返回支持的类别与单位清单
 * 前端用它渲染下拉框，从而保证「换算规则」只有后端这一个事实来源。
 */
export function listUnits(req, res, next) {
  try {
    res.status(200).json({ success: true, ...conversionService.listUnits() });
  } catch (error) {
    next(error);
  }
}

export default { convertBase, convertUnit, listUnits };
