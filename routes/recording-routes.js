/**
 * Recording Management Routes
 */

import express from 'express';
import { ApiResponse } from '../utils/response.js';
import { validate, validationSchemas } from '../utils/validation.js';
import logger from '../utils/logger.js';
import recordingService from '../services/recording-service.js';

const router = express.Router();

/**
 * GET /api/recordings
 * Get recordings list with filtering
 * 
 * Query parameters:
 * - extension: Filter by extension
 * - direction: inbound|outbound|internal
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - limit: Results per page (default: 50)
 * - offset: Pagination offset (default: 0)
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      extension: req.query.extension,
      direction: req.query.direction,
      startDate: req.query.startDate ? new Date(req.query.startDate) : null,
      endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };

    const result = await recordingService.getRecordings(filters);
    res.json(ApiResponse.paginated(
      result.recordings,
      result.total,
      result.limit,
      result.offset
    ));
  } catch (error) {
    logger.error('Get recordings error', { error: error.message });
    res.status(500).json(ApiResponse.error('Failed to fetch recordings'));
  }
});

/**
 * GET /api/recordings/:recordingId
 * Get single recording details
 */
router.get('/:recordingId', async (req, res) => {
  try {
    const recording = await recordingService.getRecording(req.params.recordingId);
    res.json(ApiResponse.success(recording, 'Recording details retrieved'));
  } catch (error) {
    logger.error('Get recording details error', {
      error: error.message,
      recordingId: req.params.recordingId
    });
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json(ApiResponse.error(error.message));
  }
});

/**
 * GET /api/recordings/:recordingId/download
 * Download recording file
 */
router.get('/:recordingId/download', async (req, res) => {
  try {
    const recording = await recordingService.getRecording(req.params.recordingId);
    const stream = recordingService.getRecordingStream(req.params.recordingId, recording);

    res.setHeader('Content-Type', `audio/${recording.FileFormat}`);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${recording.RecordingId}.${recording.FileFormat}"`
    );
    res.setHeader('Content-Length', recording.FileSize);

    stream.pipe(res);

    logger.info('Recording downloaded', {
      recordingId: req.params.recordingId
    });
  } catch (error) {
    logger.error('Download recording error', {
      error: error.message,
      recordingId: req.params.recordingId
    });
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json(ApiResponse.error(error.message));
  }
});

/**
 * POST /api/recordings/:recordingId/register
 * Register new recording (called by FreePBX/Asterisk)
 * 
 * Body:
 * {
 *   "callId": "uuid",
 *   "filename": "recording-file.wav",
 *   "fromExtension": "101",
 *   "toExtension": "102",
 *   "toNumber": "+84912345678",
 *   "direction": "outbound",
 *   "duration": 120
 * }
 */
router.post('/:recordingId/register', async (req, res) => {
  try {
    const {
      callId,
      filename,
      fromExtension,
      toExtension,
      toNumber,
      direction,
      duration
    } = req.body;

    const result = await recordingService.registerRecording(
      req.params.recordingId,
      callId,
      filename,
      fromExtension,
      toExtension,
      toNumber,
      direction,
      duration
    );

    res.json(ApiResponse.success(result, 'Recording registered successfully'));
  } catch (error) {
    logger.error('Register recording error', {
      error: error.message,
      recordingId: req.params.recordingId
    });
    res.status(500).json(ApiResponse.error('Failed to register recording'));
  }
});

/**
 * DELETE /api/recordings/:recordingId
 * Delete recording
 */
router.delete('/:recordingId', async (req, res) => {
  try {
    const result = await recordingService.deleteRecording(req.params.recordingId);
    res.json(ApiResponse.success(result, 'Recording deleted successfully'));
  } catch (error) {
    logger.error('Delete recording error', {
      error: error.message,
      recordingId: req.params.recordingId
    });
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json(ApiResponse.error(error.message));
  }
});

export default router;
