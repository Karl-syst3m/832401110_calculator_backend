/**
 * Route table.
 *
 * Every endpoint is mounted uniformly under the /api prefix (mounted in app.js), so nginx needs only one
 * location /api/ rule to forward API requests to the backend, while all other requests go to static files.
 *
 * Endpoint list:
 *   GET    /api/health                 health check
 *   POST   /api/calculate              evaluate an expression and write it to history
 *   GET    /api/history                paginated history query (supports keyword / favoriteOnly / sortBy / order)
 *   GET    /api/history/stats          aggregate statistics
 *   DELETE /api/history/:id            delete the specified history record
 *   DELETE /api/history                clear all history
 *   PATCH  /api/history/:id/favorite   toggle favorite
 *   GET    /api/convert/units          query the supported unit categories
 *   POST   /api/convert/base           base conversion
 *   POST   /api/convert/unit           unit conversion
 *
 * Registration order note: /history/stats must be written before parameterized routes such as
 * /history/:id, otherwise "stats" would be matched as the value of :id. This file has no GET /history/:id,
 * so it is currently unaffected, but keeping the "static paths first" ordering habit avoids tripping over
 * this in the future.
 */

import { Router } from 'express';
import * as calculatorController from '../controller/calculator.controller.js';
import * as historyController from '../controller/history.controller.js';
import * as conversionController from '../controller/conversion.controller.js';
import * as healthController from '../controller/health.controller.js';

export const router = Router();

// ---- Infrastructure ----
router.get('/health', healthController.health);

// ---- Core: calculation ----
router.post('/calculate', calculatorController.calculate);

// ---- History ----
router.get('/history/stats', historyController.statistics);
router.get('/history', historyController.list);
router.delete('/history', historyController.clearAll);
router.patch('/history/:id/favorite', historyController.toggleFavorite);
router.delete('/history/:id', historyController.remove);

// ---- Extension: conversion ----
router.get('/convert/units', conversionController.listUnits);
router.post('/convert/base', conversionController.convertBase);
router.post('/convert/unit', conversionController.convertUnit);

export default router;
