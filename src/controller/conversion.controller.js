/**
 * Conversion endpoint controllers (extension features).
 */

import * as conversionService from '../service/conversion.service.js';

/** POST /api/convert/base — base conversion */
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

/** POST /api/convert/unit — unit conversion */
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
 * GET /api/convert/units — return the supported categories and units
 * The front end uses it to render the dropdowns, which guarantees that "conversion rules" have the
 * backend as their single source of truth.
 */
export function listUnits(req, res, next) {
  try {
    res.status(200).json({ success: true, ...conversionService.listUnits() });
  } catch (error) {
    next(error);
  }
}

export default { convertBase, convertUnit, listUnits };
