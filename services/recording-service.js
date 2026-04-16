/**
 * Recording Service - Manages call recordings
 */

import logger from '../utils/logger.js';
import databaseService from './database-service.js';
import fs from 'fs';
import path from 'path';

class RecordingService {
  constructor() {
    this.recordingPath = process.env.RECORDING_STORAGE_PATH || '/app/recordings';
  }

  async initialize() {
    // Ensure recording directory exists
    if (!fs.existsSync(this.recordingPath)) {
      fs.mkdirSync(this.recordingPath, { recursive: true });
      logger.info('Recording directory created', { path: this.recordingPath });
    }
    logger.info('Recording Service initialized');
  }

  /**
   * Register new recording
   */
  async registerRecording(
    recordingId,
    callId,
    filename,
    fromExtension,
    toExtension,
    toNumber,
    direction,
    duration
  ) {
    try {
      const filePath = path.join(this.recordingPath, filename);
      const fileSize = fs.statSync(filePath).size;
      const fileFormat = path.extname(filename).substring(1);

      await databaseService.query(`
        INSERT INTO Recordings (
          RecordingId, CallId, FilePath, FileSize, FileFormat, Duration,
          FromExtension, ToExtension, ToNumber, Direction, RecordedAt
        ) VALUES (
          @recordingId, @callId, @filePath, @fileSize, @fileFormat, @duration,
          @fromExtension, @toExtension, @toNumber, @direction, GETUTCDATE()
        )
      `, {
        recordingId,
        callId,
        filePath,
        fileSize,
        fileFormat,
        duration,
        fromExtension,
        toExtension,
        toNumber,
        direction
      });

      // Update call with recording reference
      await databaseService.query(`
        UPDATE CallLogs SET RecordingId = @recordingId WHERE CallId = @callId
      `, {
        recordingId,
        callId
      });

      logger.info('Recording registered', {
        recordingId,
        callId,
        filename
      });

      return {
        recordingId,
        callId,
        filePath,
        fileSize,
        duration
      };
    } catch (error) {
      logger.error('Failed to register recording', {
        error: error.message,
        recordingId,
        callId
      });
      throw error;
    }
  }

  /**
   * Get recordings list with filtering
   */
  async getRecordings(filters = {}) {
    try {
      let query = `
        SELECT 
          RecordingId, CallId, FilePath, FileSize, FileFormat, Duration,
          FromExtension, ToExtension, ToNumber, Direction, RecordedAt
        FROM Recordings
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

      if (filters.startDate) {
        query += ` AND RecordedAt >= @startDate`;
        params.startDate = filters.startDate;
      }

      if (filters.endDate) {
        query += ` AND RecordedAt <= @endDate`;
        params.endDate = filters.endDate;
      }

      query += ` ORDER BY RecordedAt DESC`;
      query += ` OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

      params.offset = filters.offset || 0;
      params.limit = filters.limit || 50;

      const totalQuery = `
        SELECT COUNT(*) as total FROM Recordings WHERE 1=1
        ${filters.extension ? ` AND (FromExtension = @extension OR ToExtension = @extension)` : ''}
        ${filters.direction ? ` AND Direction = @direction` : ''}
        ${filters.startDate ? ` AND RecordedAt >= @startDate` : ''}
        ${filters.endDate ? ` AND RecordedAt <= @endDate` : ''}
      `;

      const [recordings, totalResult] = await Promise.all([
        databaseService.query(query, params),
        databaseService.query(totalQuery, params)
      ]);

      return {
        recordings,
        total: totalResult[0]?.total || 0,
        limit: filters.limit || 50,
        offset: filters.offset || 0
      };
    } catch (error) {
      logger.error('Failed to get recordings', { error: error.message });
      throw error;
    }
  }

  /**
   * Get single recording details
   */
  async getRecording(recordingId) {
    try {
      const result = await databaseService.query(`
        SELECT 
          RecordingId, CallId, FilePath, FileSize, FileFormat, Duration,
          FromExtension, ToExtension, ToNumber, Direction, RecordedAt
        FROM Recordings
        WHERE RecordingId = @recordingId
      `, { recordingId });

      if (!result || result.length === 0) {
        throw { statusCode: 404, message: 'Recording not found' };
      }

      return result[0];
    } catch (error) {
      logger.error('Failed to get recording', {
        error: error.message,
        recordingId
      });
      throw error;
    }
  }

  /**
   * Delete recording
   */
  async deleteRecording(recordingId) {
    try {
      const recording = await this.getRecording(recordingId);

      // Delete physical file
      if (fs.existsSync(recording.FilePath)) {
        fs.unlinkSync(recording.FilePath);
      }

      // Delete database record
      await databaseService.query(`
        DELETE FROM Recordings WHERE RecordingId = @recordingId
      `, { recordingId });

      logger.info('Recording deleted', { recordingId });

      return { success: true, recordingId };
    } catch (error) {
      logger.error('Failed to delete recording', {
        error: error.message,
        recordingId
      });
      throw error;
    }
  }

  /**
   * Get recording file stream
   */
  getRecordingStream(recordingId, recording) {
    try {
      if (!fs.existsSync(recording.FilePath)) {
        throw { statusCode: 404, message: 'Recording file not found' };
      }

      return fs.createReadStream(recording.FilePath);
    } catch (error) {
      logger.error('Failed to get recording stream', {
        error: error.message,
        recordingId
      });
      throw error;
    }
  }
}

export default new RecordingService();
