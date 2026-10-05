/**
 * 路由表。
 *
 * 所有接口统一挂在 /api 前缀下（在 app.js 里挂载），这样 nginx 只需要
 * 一条 location /api/ 规则就能把接口请求转发给后端，其余请求走静态文件。
 *
 * 接口清单：
 *   GET    /api/health                 健康检查
 *   POST   /api/calculate              计算表达式并写入历史
 *   GET    /api/history                分页查询历史（支持 keyword / favoriteOnly / sortBy / order）
 *   GET    /api/history/stats          汇总统计
 *   DELETE /api/history/:id            删除指定历史记录
 *   DELETE /api/history                清空全部历史
 *   PATCH  /api/history/:id/favorite   切换收藏
 *   GET    /api/convert/units          查询支持的单位类别
 *   POST   /api/convert/base           进制换算
 *   POST   /api/convert/unit           单位换算
 *
 * 注册顺序注意：/history/stats 必须写在 /history/:id 这类带参数的路由之前，
 * 否则 "stats" 会被当作 :id 的值匹配进去。本文件里没有 GET /history/:id，
 * 因此当前不受影响，但保持「静态路径优先」的顺序习惯可以避免将来踩坑。
 */

import { Router } from 'express';
import * as calculatorController from '../controller/calculator.controller.js';
import * as historyController from '../controller/history.controller.js';
import * as conversionController from '../controller/conversion.controller.js';
import * as healthController from '../controller/health.controller.js';

export const router = Router();

// ---- 基础设施 ----
router.get('/health', healthController.health);

// ---- 核心：计算 ----
router.post('/calculate', calculatorController.calculate);

// ---- 历史记录 ----
router.get('/history/stats', historyController.statistics);
router.get('/history', historyController.list);
router.delete('/history', historyController.clearAll);
router.patch('/history/:id/favorite', historyController.toggleFavorite);
router.delete('/history/:id', historyController.remove);

// ---- 扩展：换算 ----
router.get('/convert/units', conversionController.listUnits);
router.post('/convert/base', conversionController.convertBase);
router.post('/convert/unit', conversionController.convertUnit);

export default router;
