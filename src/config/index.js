/**
 * 集中式配置。
 *
 * 设计说明：把「所有来自环境的东西」收敛到一个模块，其余代码一律通过
 * `config` 取值，不再直接读 process.env。这样做的好处是：
 *   1. 默认值只有一处，本地开发无需任何配置即可启动；
 *   2. 部署时只改环境变量，不用改代码；
 *   3. 测试可以直接构造一份配置对象注入，不必污染真实环境变量。
 */

import path from 'node:path';
import process from 'node:process';

/** 项目根目录（src/config/index.js -> 上溯两级） */
const projectRoot = path.resolve(import.meta.dirname, '..', '..');

/** 把 "5500,http://localhost:5500" 这类字符串解析成数组。 */
function parseList(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  /** 运行环境：development | production | test */
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  /** 项目根目录绝对路径 */
  projectRoot,

  server: {
    port: parseInteger(process.env.PORT, 5000),
    /**
     * 只监听回环地址时，外部无法直连，必须经由 nginx 反向代理访问。
     * 生产环境默认 127.0.0.1 是更安全的姿态：后端不直接暴露公网。
     */
    host: process.env.HOST ?? '127.0.0.1',
    /** 单次请求体上限。表达式很短，64kb 已绰绰有余，同时挡掉超大请求体攻击。 */
    bodyLimit: process.env.BODY_LIMIT ?? '64kb',
  },

  database: {
    /**
     * SQLite 数据文件路径。默认放在项目的 data/ 目录下，
     * 该目录已在 .gitignore 中排除，数据库属于运行时产物，不应提交。
     */
    file: process.env.DB_FILE ?? path.join(projectRoot, 'data', 'calculator.sqlite'),
  },

  cors: {
    /**
     * 允许跨域访问的来源白名单。
     * 生产环境建议让 nginx 把前端与 /api 放在同一个源下，此时浏览器根本不会发起跨域请求，
     * 白名单留空即可。开发环境前端用 http://localhost:5500 起静态服务，需要显式放行。
     */
    allowedOrigins: parseList(process.env.CORS_ORIGINS, [
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
    ]),
  },

  log: {
    level: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'error' : 'info'),
  },

  /** 业务规则：单个表达式的最大长度。 */
  calculator: {
    maxExpressionLength: parseInteger(process.env.MAX_EXPRESSION_LENGTH, 200),
    /** 历史记录分页时每页允许的最大条数，防止前端传个 pageSize=100000 把内存打满。 */
    maxPageSize: 100,
    defaultPageSize: 20,
  },
};

export default config;
