/**
 * Health Check Routes
 */

import express from 'express';
import fs from 'fs';
import { ApiResponse } from '../utils/response.js';
import logger from '../utils/logger.js';
import sipService from '../services/sip-service.js';
import pbxDataService from '../services/pbx-data-service.js';
import pbxConfigService from '../services/pbx-config-service.js';

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', (req, res) => {
  try {
    res.json(ApiResponse.success({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: 'FreePBX PBX Adapter',
      version: '1.0.0'
    }, 'Service is healthy'));
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json(ApiResponse.error('Health check failed'));
  }
});

/**
 * GET /api/health/detailed
 * Detailed health check with dependencies
 */
router.get('/detailed', async (req, res) => {
  try {
    const recordingRoot = pbxConfigService.getRecordingRoot();
    const checks = {
      cdrDatabase: pbxDataService.pool ? 'connected' : 'disconnected',
      ami: sipService.isConnected() ? 'connected' : 'disconnected',
      recordingRoot,
      recordingRootAccessible: fs.existsSync(recordingRoot),
      timestamp: new Date().toISOString()
    };

    res.json(ApiResponse.success(checks, 'Detailed health check'));
  } catch (error) {
    logger.error('Detailed health check failed', { error: error.message });
    res.status(500).json(ApiResponse.error('Detailed health check failed'));
  }
});

export default router;
