/**
 * Statistics & Reporting Routes
 */

import express from 'express';
import { ApiResponse } from '../utils/response.js';
import logger from '../utils/logger.js';
import statisticsService from '../services/statistics-service.js';
import sipService from '../services/sip-service.js';

const router = express.Router();

/**
 * GET /api/statistics/today
 * Get today's statistics
 * 
 * Query parameters:
 * - extension: Filter by specific extension
 */
router.get('/today', async (req, res) => {
  try {
    const extension = req.query.extension || null;
    const stats = await statisticsService.getTodayStatistics(extension);

    res.json(ApiResponse.success(stats, 'Today statistics retrieved'));
  } catch (error) {
    logger.error('Get today statistics error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch today statistics'));
  }
});

/**
 * GET /api/statistics/range
 * Get statistics for date range
 * 
 * Query parameters:
 * - startDate: ISO date string (required)
 * - endDate: ISO date string (required)
 * - extension: Filter by specific extension (optional)
 */
router.get('/range', async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate) {
      return res.status(400).json(
        ApiResponse.error('startDate and endDate are required')
      );
    }

    const startDate = new Date(req.query.startDate);
    const endDate = new Date(req.query.endDate);
    const extension = req.query.extension || null;

    const stats = await statisticsService.getStatisticsByDateRange(
      startDate,
      endDate,
      extension
    );

    res.json(ApiResponse.success(stats, 'Date range statistics retrieved'));
  } catch (error) {
    logger.error('Get statistics by date range error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch statistics'));
  }
});

/**
 * GET /api/statistics/extensions
 * Get summary statistics by extension (last 30 days)
 */
router.get('/extensions', async (req, res) => {
  try {
    const stats = await statisticsService.getExtensionSummary();

    res.json(ApiResponse.success(stats, 'Extension summary statistics retrieved'));
  } catch (error) {
    logger.error('Get extension summary error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch extension statistics'));
  }
});

/**
 * GET /api/statistics/system
 * Get system wide statistics
 */
router.get('/system', async (req, res) => {
  try {
    const stats = await statisticsService.getSystemStatistics();

    res.json(ApiResponse.success(stats, 'System statistics retrieved'));
  } catch (error) {
    logger.error('Get system statistics error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch system statistics'));
  }
});

/**
 * GET /api/statistics/extensions/online
 * Get list of currently online extensions
 */
router.get('/extensions/online', async (req, res) => {
  try {
    const extensions = await sipService.getOnlineExtensions();

    res.json(ApiResponse.success({
      count: extensions.length,
      extensions
    }, 'Online extensions retrieved'));
  } catch (error) {
    logger.error('Get online extensions error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch online extensions'));
  }
});

export default router;
