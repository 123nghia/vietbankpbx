/**
 * Call Management Routes
 */

import express from 'express';
import { ApiResponse } from '../utils/response.js';
import { validate, validationSchemas } from '../utils/validation.js';
import logger from '../utils/logger.js';
import callManager from '../services/call-manager.js';

export default function createCallRoutes(io) {
  const router = express.Router();

  /**
   * POST /api/calls/auto-dial
   * Initiate auto-dial (outbound call)
   * 
   * Body:
   * {
   *   "fromExtension": "101",
   *   "toNumber": "+84912345678",
   *   "metadata": { "reason": "sales", "customerId": 123 }
   * }
   */
  router.post('/auto-dial', async (req, res) => {
    try {
      const validated = validate(req.body, validationSchemas.autoDial);
      
      const result = await callManager.autoDial(
        validated.fromExtension,
        validated.toNumber,
        validated.metadata
      );

      res.json(ApiResponse.success(result, 'Auto-dial initiated successfully'));
    } catch (error) {
      logger.error('Auto-dial error', { error: error.message, body: req.body });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(
        error.message || 'Auto-dial failed',
        error.details
      ));
    }
  });

  /**
   * GET /api/calls/history
   * Get call history with filtering
   * 
   * Query parameters:
   * - extension: Filter by extension
   * - direction: inbound|outbound|internal
   * - status: completed|missed|failed|abandoned
   * - startDate: ISO date string
   * - endDate: ISO date string
   * - limit: Results per page (default: 100)
   * - offset: Pagination offset (default: 0)
   */
  router.get('/history', async (req, res) => {
    try {
      const filters = {
        extension: req.query.extension,
        direction: req.query.direction,
        status: req.query.status,
        startDate: req.query.startDate ? new Date(req.query.startDate) : null,
        endDate: req.query.endDate ? new Date(req.query.endDate) : null,
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0
      };

      const result = await callManager.getCallHistory(filters);
      res.json(ApiResponse.paginated(
        result.calls,
        result.total,
        result.limit,
        result.offset
      ));
    } catch (error) {
      logger.error('Get call history error', { error: error.message });
      res.status(500).json(ApiResponse.error('Failed to fetch call history'));
    }
  });

  /**
   * GET /api/calls/:callId
   * Get single call details
   */
  router.get('/:callId', async (req, res) => {
    try {
      const call = await callManager.getCallDetails(req.params.callId);
      res.json(ApiResponse.success(call, 'Call details retrieved'));
    } catch (error) {
      logger.error('Get call details error', {
        error: error.message,
        callId: req.params.callId
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * POST /api/calls/:callId/end
   * End a call
   * 
   * Body:
   * {
   *   "reason": "normal" | "timeout" | "error"
   * }
   */
  router.post('/:callId/end', async (req, res) => {
    try {
      const result = await callManager.endCall(
        req.params.callId,
        req.body.reason || 'normal'
      );
      res.json(ApiResponse.success(result, 'Call ended successfully'));
    } catch (error) {
      logger.error('End call error', {
        error: error.message,
        callId: req.params.callId
      });
      res.status(500).json(ApiResponse.error('Failed to end call'));
    }
  });

  /**
   * GET /api/calls/active/count
   * Get count of active calls
   */
  router.get('/active/count', async (req, res) => {
    try {
      // This would be implemented in call-manager
      res.json(ApiResponse.success({
        activeCallsCount: 0,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      logger.error('Get active calls count error', { error: error.message });
      res.status(500).json(ApiResponse.error('Failed to get active calls count'));
    }
  });

  return router;
}
