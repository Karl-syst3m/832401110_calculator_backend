/**
 * Static definition table for unit conversion.
 *
 * It lives in a separate data file because this is "configuration data" rather than "logic":
 * adding a unit should not require reading business code, and this table can be handed straight to the front
 * end by an endpoint (GET /api/convert/units), which renders the dropdowns from it, avoiding the front end
 * and backend each maintaining a unit list that drifts out of sync.
 *
 * Two conversion models:
 *   1. the factor model (length, mass, area, …): every unit can be expressed as "how many base units 1 of
 *      that unit equals", and conversion is value * fromFactor / toFactor. This is the simplest and least
 *      error-prone form.
 *   2. the affine model (temperature): Celsius and Fahrenheit have a "multiply by a coefficient then add an
 *      offset" affine relationship, with no common "multiple of a zero point", so two-way functions must be
 *      given.
 *      Modeling temperature separately, rather than forcing it into the factor model, is what keeps us from
 *      writing an incorrect conversion.
 */

/** factor-model unit table: the value is how many base units 1 of that unit equals. */
export const UNIT_CATEGORIES = Object.freeze({
  length: {
    kind: 'factor',
    label: 'Length',
    base: 'm',
    units: {
      nm: { factor: 1e-9, label: 'Nanometer' },
      um: { factor: 1e-6, label: 'Micrometer' },
      mm: { factor: 0.001, label: 'Millimeter' },
      cm: { factor: 0.01, label: 'Centimeter' },
      dm: { factor: 0.1, label: 'Decimeter' },
      m: { factor: 1, label: 'Meter' },
      km: { factor: 1000, label: 'Kilometer' },
      in: { factor: 0.0254, label: 'Inch' },
      ft: { factor: 0.3048, label: 'Foot' },
      yd: { factor: 0.9144, label: 'Yard' },
      mi: { factor: 1609.344, label: 'Mile' },
      nmi: { factor: 1852, label: 'Nautical mile' },
    },
  },

  mass: {
    kind: 'factor',
    label: 'Mass',
    base: 'kg',
    units: {
      mg: { factor: 1e-6, label: 'Milligram' },
      g: { factor: 0.001, label: 'Gram' },
      kg: { factor: 1, label: 'Kilogram' },
      t: { factor: 1000, label: 'Tonne' },
      oz: { factor: 0.028349523125, label: 'Ounce' },
      lb: { factor: 0.45359237, label: 'Pound' },
      jin: { factor: 0.5, label: 'Jin' },
    },
  },

  area: {
    kind: 'factor',
    label: 'Area',
    base: 'm2',
    units: {
      cm2: { factor: 0.0001, label: 'Square centimeter' },
      m2: { factor: 1, label: 'Square meter' },
      km2: { factor: 1e6, label: 'Square kilometer' },
      ha: { factor: 10000, label: 'Hectare' },
      mu: { factor: 666.6666666666666, label: 'Mu' },
      acre: { factor: 4046.8564224, label: 'Acre' },
      ft2: { factor: 0.09290304, label: 'Square foot' },
    },
  },

  volume: {
    kind: 'factor',
    label: 'Volume',
    base: 'l',
    units: {
      ml: { factor: 0.001, label: 'Milliliter' },
      l: { factor: 1, label: 'Liter' },
      m3: { factor: 1000, label: 'Cubic meter' },
      gal: { factor: 3.785411784, label: 'Gallon (US)' },
      qt: { factor: 0.946352946, label: 'Quart (US)' },
    },
  },

  time: {
    kind: 'factor',
    label: 'Time',
    base: 's',
    units: {
      ms: { factor: 0.001, label: 'Millisecond' },
      s: { factor: 1, label: 'Second' },
      min: { factor: 60, label: 'Minute' },
      h: { factor: 3600, label: 'Hour' },
      d: { factor: 86400, label: 'Day' },
      wk: { factor: 604800, label: 'Week' },
    },
  },

  data: {
    kind: 'factor',
    label: 'Data',
    base: 'B',
    units: {
      b: { factor: 0.125, label: 'Bit' },
      B: { factor: 1, label: 'Byte' },
      KiB: { factor: 1024, label: 'KiB' },
      MiB: { factor: 1024 ** 2, label: 'MiB' },
      GiB: { factor: 1024 ** 3, label: 'GiB' },
      TiB: { factor: 1024 ** 4, label: 'TiB' },
    },
  },

  speed: {
    kind: 'factor',
    label: 'Speed',
    base: 'm/s',
    units: {
      'm/s': { factor: 1, label: 'Meters per second' },
      'km/h': { factor: 1 / 3.6, label: 'Kilometers per hour' },
      mph: { factor: 0.44704, label: 'Miles per hour' },
      kn: { factor: 0.5144444444444445, label: 'Knot' },
    },
  },

  /**
   * Temperature: affine model.
   * toBase converts uniformly to Celsius, and fromBase converts out of Celsius.
   * That way conversion between any two units can be split into "to the base first, then out of the base",
   * with no need for pairwise combinations.
   */
  temperature: {
    kind: 'affine',
    label: 'Temperature',
    base: 'c',
    units: {
      c: { label: 'Celsius', toBase: (v) => v, fromBase: (v) => v },
      f: { label: 'Fahrenheit', toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
      k: { label: 'Kelvin', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    },
  },
});

export default UNIT_CATEGORIES;
