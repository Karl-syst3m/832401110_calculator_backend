/**
 * Express 应用装配。
 *
 * 这里只负责「按正确顺序装上中间件和路由」，不启动监听。
 * 把 app 的构造与 listen 分开，是为了让集成测试可以直接拿到 app 对象，
 * 在随机端口上起服务（见 tests/api.test.js），而不必去抢固定端口。
 *
 * 中间件顺序是有讲究的，从上到下依次是：
 *   1. corsMiddleware   —— 预检请求要尽早短路，不进入后面的 JSON 解析与业务逻辑；
 *   2. requestLogger    —— 尽早注册，才能覆盖到后面所有中间件的耗时；
 *   3. express.json()   —— 解析请求体（限流上限配置在 config 里）；
 *   4. /api 路由        —— 业务逻辑；
 *   5. notFoundHandler  —— 路由都没匹配上，构造 404；
 *   6. errorHandler     —— 必须放在最后，Express 只认注册顺序最后的四参错误处理函数。
 */

import express from 'express';
import config from './config/index.js';
import { router } from './routes/index.js';
import { corsMiddleware } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

/**
 * 创建 Express 应用实例。
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // 关掉 X-Powered-By 响应头。它会把「这是 Express」告诉每一个访问者，
  // 便于攻击者按框架版本去查已知漏洞。关掉它成本为零。
  app.disable('x-powered-by');

  // 部署在 nginx 之后，真实客户端 IP 在 X-Forwarded-For 里。
  // 打开 trust proxy 后，req.ip 才会返回真实 IP 而不是 127.0.0.1。
  app.set('trust proxy', true);

  app.use(corsMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: config.server.bodyLimit }));

  app.use('/api', router);

  // 访问根路径时给一句人话，方便部署后手动确认服务活着。
  app.get('/', (req, res) => {
    res.json({
      success: true,
      service: 'calculator-backend',
      message: '前后端分离计算器系统后端已运行。接口前缀为 /api，健康检查位于 /api/health。',
      apiPrefix: '/api',
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
