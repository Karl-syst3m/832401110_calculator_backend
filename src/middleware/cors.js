/**
 * 跨域（CORS）中间件。
 *
 * 为什么手写而不用 cors 包？
 * 本项目的需求只有「按白名单放行来源 + 处理预检请求」两件事，二十行就能说清楚。
 * 引一个依赖反而会让读者去翻它的文档，而这份代码本身是要在博客里讲解的。
 *
 * 生产环境的建议姿态：
 * 让 nginx 把前端静态文件与 /api 放在同一个域名下，浏览器根本不会发起跨域请求，
 * 此时白名单留空即可，这是最省事也最安全的做法。
 * 只有在「前端独立部署在另一个源」时才需要配置 CORS_ORIGINS。
 *
 * 安全要点：只有命中白名单才回 Access-Control-Allow-Origin，且回显具体来源
 * 而不是通配符 *。若回 *，任何网站都能带着用户浏览器来调用本接口。
 */

import config from '../config/index.js';

/** 允许跨域请求携带的请求头。 */
const ALLOWED_HEADERS = 'Content-Type';
/** 允许跨域请求使用的方法。 */
const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS';
/** 预检结果缓存时间（秒），减少 OPTIONS 请求次数。 */
const MAX_AGE_SECONDS = '600';

export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (typeof origin === 'string' && config.cors.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
    // Vary: Origin 告诉各级缓存「响应随 Origin 变化」。
    // 缺了它，CDN 可能把给 A 站的响应缓存后返回给 B 站，造成跨域泄漏。
    res.setHeader('Vary', 'Origin');
  }

  // 预检请求到此为止，不必进入业务逻辑。
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

export default corsMiddleware;
