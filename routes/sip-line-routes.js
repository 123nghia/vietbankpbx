/**
 * SIP Line Management Routes
 * Admin endpoints for creating and managing SIP extensions
 */

import express from 'express';
import { ApiResponse } from '../utils/response.js';
import { validate, validationSchemas } from '../utils/validation.js';
import logger from '../utils/logger.js';
import sipLineService from '../services/sip-line-service.js';
import { isAdmin, isAuthenticated, getUserId, adminAuthMiddleware, authMiddleware } from '../utils/permission.js';

export default function createSIPLineRoutes(io) {
  const router = express.Router();

  /**
   * POST /api/sip/create
   * Create new SIP line (extension)
   * Only admin
   * 
   * Body:
   * {
   *   "extension": "102",
   *   "displayName": "Nhân Viên A",
   *   "password": "secure_password",
   *   "secret": "sip_secret",
   *   "accountCode": "dept001",
   *   "mailboxEmail": "nhan.vien.a@company.com",
   *   "context": "from-internal",
   *   "createdByUserId": "admin-id"
   * }
   */
  router.post('/create', async (req, res) => {
    try {
      // Admin permission check
      if (!isAdmin(req)) {
        logger.warn(`Unauthorized SIP line creation attempt by user: ${getUserId(req)}`);
        return res.status(403).json(
          ApiResponse.error('Only administrators can create SIP lines', 403)
        );
      }

      const {
        extension,
        displayName,
        password,
        secret,
        accountCode,
        mailboxEmail,
        context,
        createdByUserId
      } = req.body;

      // Validate required fields
      if (!extension || !displayName || !password) {
        return res.status(400).json(
          ApiResponse.error(
            'Required fields: extension, displayName, password',
            [
              { field: 'extension', message: 'Extension is required' },
              { field: 'displayName', message: 'Display name is required' },
              { field: 'password', message: 'Password is required' }
            ]
          )
        );
      }

      const result = await sipLineService.createSIPLine({
        extension,
        displayName,
        password,
        secret,
        accountCode,
        mailboxEmail,
        context,
        createdByUserId: createdByUserId || 'system'
      });

      res.status(201).json(
        ApiResponse.success(result, 'SIP line created successfully')
      );
    } catch (error) {
      logger.error('Create SIP line error', { error: error.message });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * DELETE /api/sip/:extension
   * Delete SIP line (soft delete)
   * Only admin
   * 
   * Query:
   * - deletedByUserId: User ID performing deletion
   */
  router.delete('/:extension', async (req, res) => {
    try {
      // Admin permission check
      if (!isAdmin(req)) {
        logger.warn(`Unauthorized SIP line deletion attempt by user: ${getUserId(req)}`);
        return res.status(403).json(
          ApiResponse.error('Only administrators can delete SIP lines', 403)
        );
      }

      const deletedByUserId = getUserId(req) || 'system';

      const result = await sipLineService.deleteSIPLine(
        req.params.extension,
        deletedByUserId
      );

      res.json(ApiResponse.success(result, 'SIP line deleted successfully'));
    } catch (error) {
      logger.error('Delete SIP line error', {
        error: error.message,
        extension: req.params.extension
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * GET /api/sip/list
   * Get all SIP lines
   * 
   * Query parameters:
   * - extension: Filter by extension
   * - status: active|inactive
   * - isActive: true|false
   * - limit: Results per page (default: 100)
   * - offset: Pagination offset (default: 0)
   */
  router.get('/list', async (req, res) => {
    try {
      const filters = {
        extension: req.query.extension,
        status: req.query.status,
        isActive: req.query.isActive === 'true' ? true : (req.query.isActive === 'false' ? false : undefined),
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0
      };

      const result = await sipLineService.getSIPLines(filters);

      res.json(
        ApiResponse.paginated(
          result.lines,
          result.total,
          result.limit,
          result.offset
        )
      );
    } catch (error) {
      logger.error('Get SIP lines error', { error: error.message });
      res.status(500).json(ApiResponse.error('Failed to fetch SIP lines'));
    }
  });

  /**
   * GET /api/sip/:extension
   * Get single SIP line details
   */
  router.get('/:extension', async (req, res) => {
    try {
      const line = await sipLineService.getSIPLineByExtension(req.params.extension);
      res.json(ApiResponse.success(line, 'SIP line details retrieved'));
    } catch (error) {
      logger.error('Get SIP line error', {
        error: error.message,
        extension: req.params.extension
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * PUT /api/sip/:extension
   * Update SIP line
   * Only admin
   * 
   * Body:
   * {
   *   "displayName": "New Name",
   *   "password": "new_password",
   *   "accountCode": "new_code",
   *   "mailboxEmail": "new@email.com",
   *   "status": "active"
   * }
   */
  router.put('/:extension', async (req, res) => {
    try {
      // Admin permission check
      if (!isAdmin(req)) {
        logger.warn(`Unauthorized SIP line update attempt by user: ${getUserId(req)}`);
        return res.status(403).json(
          ApiResponse.error('Only administrators can update SIP lines', 403)
        );
      }

      const result = await sipLineService.updateSIPLine(
        req.params.extension,
        req.body
      );

      res.json(ApiResponse.success(result, 'SIP line updated successfully'));
    } catch (error) {
      logger.error('Update SIP line error', {
        error: error.message,
        extension: req.params.extension
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * GET /api/sip/stats/overview
   * Get SIP line statistics
   */
  router.get('/stats/overview', async (req, res) => {
    try {
      const stats = await sipLineService.getSIPLineStats();
      res.json(ApiResponse.success(stats, 'SIP line statistics retrieved'));
    } catch (error) {
      logger.error('Get SIP stats error', { error: error.message });
      res.status(500).json(ApiResponse.error('Failed to fetch statistics'));
    }
  });

  /**
   * POST /api/sip/:extension/activate
   * Activate SIP line
   * Only admin
   */
  router.post('/:extension/activate', async (req, res) => {
    try {
      // Admin permission check
      if (!isAdmin(req)) {
        logger.warn(`Unauthorized SIP line activation attempt by user: ${getUserId(req)}`);
        return res.status(403).json(
          ApiResponse.error('Only administrators can activate SIP lines', 403)
        );
      }

      const result = await sipLineService.activateSIPLine(req.params.extension);
      res.json(ApiResponse.success(result, 'SIP line activated'));
    } catch (error) {
      logger.error('Activate SIP line error', {
        error: error.message,
        extension: req.params.extension
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  /**
   * POST /api/sip/:extension/deactivate
   * Deactivate SIP line
   * Only admin
   */
  router.post('/:extension/deactivate', async (req, res) => {
    try {
      // Admin permission check
      if (!isAdmin(req)) {
        logger.warn(`Unauthorized SIP line deactivation attempt by user: ${getUserId(req)}`);
        return res.status(403).json(
          ApiResponse.error('Only administrators can deactivate SIP lines', 403)
        );
      }

      const result = await sipLineService.deactivateSIPLine(req.params.extension);
      res.json(ApiResponse.success(result, 'SIP line deactivated'));
    } catch (error) {
      logger.error('Deactivate SIP line error', {
        error: error.message,
        extension: req.params.extension
      });
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error(error.message));
    }
  });

  return router;
}
