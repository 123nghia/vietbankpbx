/**
 * Call Manager Service - Manages call lifecycle and orchestration
 */

import logger from '../utils/logger.js';
import sipService from './sip-service.js';
import databaseService from './database-service.js';

class CallManager {
  constructor() {
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    logger.info('Call Manager initialized');
  }

  /**
   * Initiate auto-dial
   */
  async autoDial(fromExtension, toNumber, metadata = {}) {
    try {
      const callId = await sipService.makeCall(fromExtension, toNumber, metadata);
      
      logger.info('Auto-dial initiated', {
        callId,
        fromExtension,
        toNumber
      });

      return {
        callId,
        status: 'initiated',
        fromExtension,
        toNumber
      };
    } catch (error) {
      logger.error('Auto-dial failed', {
        error: error.message,
        fromExtension,
        toNumber
      });
      throw error;
    }
  }

  /**
   * Get call history with filtering
   */
  async getCallHistory(filters = {}) {
    try {
      let query = `
        SELECT 
          CallId, FromExtension, ToExtension, ToNumber, Direction, Status,
          StartTime, EndTime, Duration, WaitTime, RecordingId, Metadata
        FROM CallLogs
        WHERE 1=1
      `;
      
      const params = {};

      if (filters.extension) {
        query += ` AND (FromExtension = @extension OR ToExtension = @extension)`;
        params.extension = filters.extension;
      }

      if (filters.direction) {
        query += ` AND Direction = @direction`;
        params.direction = filters.direction;
      }

      if (filters.status) {
        query += ` AND Status = @status`;
        params.status = filters.status;
      }

      if (filters.startDate) {
        query += ` AND StartTime >= @startDate`;
        params.startDate = filters.startDate;
      }

      if (filters.endDate) {
        query += ` AND StartTime <= @endDate`;
        params.endDate = filters.endDate;
      }

      query += ` ORDER BY StartTime DESC`;
      query += ` OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
      
      params.offset = filters.offset || 0;
      params.limit = filters.limit || 100;

      const totalQuery = `
        SELECT COUNT(*) as total FROM CallLogs WHERE 1=1
        ${filters.extension ? ` AND (FromExtension = @extension OR ToExtension = @extension)` : ''}
        ${filters.direction ? ` AND Direction = @direction` : ''}
        ${filters.status ? ` AND Status = @status` : ''}
        ${filters.startDate ? ` AND StartTime >= @startDate` : ''}
        ${filters.endDate ? ` AND StartTime <= @endDate` : ''}
      `;

      const [calls, totalResult] = await Promise.all([
        databaseService.query(query, params),
        databaseService.query(totalQuery, params)
      ]);

      return {
        calls,
        total: totalResult[0]?.total || 0,
        limit: filters.limit || 100,
        offset: filters.offset || 0
      };
    } catch (error) {
      logger.error('Failed to get call history', { error: error.message });
      throw error;
    }
  }

  /**
   * Get single call details
   */
  async getCallDetails(callId) {
    try {
      const result = await databaseService.query(`
        SELECT 
          CallId, FromExtension, ToExtension, ToNumber, Direction, Status,
          StartTime, EndTime, Duration, WaitTime, RecordingId, Metadata
        FROM CallLogs
        WHERE CallId = @callId
      `, { callId });

      if (!result || result.length === 0) {
        throw { statusCode: 404, message: 'Call not found' };
      }

      const call = result[0];

      // Get associated recording if exists
      if (call.RecordingId) {
        const recordings = await databaseService.query(`
          SELECT RecordingId, FilePath, FileSize, FileFormat, Duration
          FROM Recordings
          WHERE RecordingId = @recordingId
        `, { recordingId: call.RecordingId });

        if (recordings.length > 0) {
          call.recording = recordings[0];
        }
      }

      return call;
    } catch (error) {
      logger.error('Failed to get call details', {
        error: error.message,
        callId
      });
      throw error;
    }
  }

  /**
   * End call
   */
  async endCall(callId, reason = 'normal') {
    try {
      const call = await this.getCallDetails(callId);
      
      await sipService.updateCallStatus(callId, 'completed', {
        reason,
        duration: call.Duration
      });

      logger.info('Call ended', { callId, reason });

      return { success: true, callId };
    } catch (error) {
      logger.error('Failed to end call', {
        error: error.message,
        callId
      });
      throw error;
    }
  }
}

export default new CallManager();
