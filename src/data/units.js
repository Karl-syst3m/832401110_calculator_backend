/**
 * 单位换算的静态定义表。
 *
 * 放在独立的 data 文件里，理由是这属于「配置数据」而不是「逻辑」：
 * 增加一个单位不应该需要读业务代码，而且这张表可以被接口直接吐给前端
 * （GET /api/convert/units），前端据此渲染下拉框，避免前后端各维护一份单位清单而失同步。
 *
 * 两种换算模型：
 *   1. factor 型（长度、质量、面积……）：所有单位都能表示成「1 个该单位等于多少个基准单位」，
 *      换算即 value * fromFactor / toFactor。这是最简单也最不容易错的形式。
 *   2. affine 型（温度）：摄氏度与华氏度之间是「乘系数再加偏移」的仿射关系，
 *      不存在一个共同的「零点倍数」，因此必须给出双向函数。
 *      把温度单独建模，而不是硬塞进 factor 模型，是为了不写出错误的换算。
 */

/** factor 型单位表：值 = 1 该单位等于多少基准单位。 */
export const UNIT_CATEGORIES = Object.freeze({
  length: {
    kind: 'factor',
    label: '长度',
    base: 'm',
    units: {
      nm: { factor: 1e-9, label: '纳米' },
      um: { factor: 1e-6, label: '微米' },
      mm: { factor: 0.001, label: '毫米' },
      cm: { factor: 0.01, label: '厘米' },
      dm: { factor: 0.1, label: '分米' },
      m: { factor: 1, label: '米' },
      km: { factor: 1000, label: '千米' },
      in: { factor: 0.0254, label: '英寸' },
      ft: { factor: 0.3048, label: '英尺' },
      yd: { factor: 0.9144, label: '码' },
      mi: { factor: 1609.344, label: '英里' },
      nmi: { factor: 1852, label: '海里' },
    },
  },

  mass: {
    kind: 'factor',
    label: '质量',
    base: 'kg',
    units: {
      mg: { factor: 1e-6, label: '毫克' },
      g: { factor: 0.001, label: '克' },
      kg: { factor: 1, label: '千克' },
      t: { factor: 1000, label: '吨' },
      oz: { factor: 0.028349523125, label: '盎司' },
      lb: { factor: 0.45359237, label: '磅' },
      jin: { factor: 0.5, label: '斤' },
    },
  },

  area: {
    kind: 'factor',
    label: '面积',
    base: 'm2',
    units: {
      cm2: { factor: 0.0001, label: '平方厘米' },
      m2: { factor: 1, label: '平方米' },
      km2: { factor: 1e6, label: '平方千米' },
      ha: { factor: 10000, label: '公顷' },
      mu: { factor: 666.6666666666666, label: '亩' },
      acre: { factor: 4046.8564224, label: '英亩' },
      ft2: { factor: 0.09290304, label: '平方英尺' },
    },
  },

  volume: {
    kind: 'factor',
    label: '体积',
    base: 'l',
    units: {
      ml: { factor: 0.001, label: '毫升' },
      l: { factor: 1, label: '升' },
      m3: { factor: 1000, label: '立方米' },
      gal: { factor: 3.785411784, label: '加仑(美)' },
      qt: { factor: 0.946352946, label: '夸脱(美)' },
    },
  },

  time: {
    kind: 'factor',
    label: '时间',
    base: 's',
    units: {
      ms: { factor: 0.001, label: '毫秒' },
      s: { factor: 1, label: '秒' },
      min: { factor: 60, label: '分钟' },
      h: { factor: 3600, label: '小时' },
      d: { factor: 86400, label: '天' },
      wk: { factor: 604800, label: '周' },
    },
  },

  data: {
    kind: 'factor',
    label: '数据',
    base: 'B',
    units: {
      b: { factor: 0.125, label: '比特' },
      B: { factor: 1, label: '字节' },
      KiB: { factor: 1024, label: 'KiB' },
      MiB: { factor: 1024 ** 2, label: 'MiB' },
      GiB: { factor: 1024 ** 3, label: 'GiB' },
      TiB: { factor: 1024 ** 4, label: 'TiB' },
    },
  },

  speed: {
    kind: 'factor',
    label: '速度',
    base: 'm/s',
    units: {
      'm/s': { factor: 1, label: '米每秒' },
      'km/h': { factor: 1 / 3.6, label: '千米每小时' },
      mph: { factor: 0.44704, label: '英里每小时' },
      kn: { factor: 0.5144444444444445, label: '节' },
    },
  },

  /**
   * 温度：仿射型。
   * toBase 统一换算到摄氏度，fromBase 从摄氏度换出去。
   * 这样任意两个单位之间的换算都可以拆成「先到基准，再从基准出去」，无需两两组合。
   */
  temperature: {
    kind: 'affine',
    label: '温度',
    base: 'c',
    units: {
      c: { label: '摄氏度', toBase: (v) => v, fromBase: (v) => v },
      f: { label: '华氏度', toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
      k: { label: '开尔文', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    },
  },
});

export default UNIT_CATEGORIES;
