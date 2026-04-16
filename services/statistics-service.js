/**
 * Statistics Service - Generates call and system statistics
 */

import logger from '../utils/logger.js';
import databaseService from './database-service.js';

class StatisticsService {
  constructor() {
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    
    // Update statistics every 5 minutes
    setInterval(() => this.updateDailyStatistics(), 5 * 60 * 1000);
    
    logger.info('Statistics Service initialized');
  }

  /**
   * Get today's statistics
   */
  async getTodayStatistics(extension = null) {
    try {
      let query = `
        SELECT 
          COUNT(*) as TotalCalls,
          SUM(CASE WHEN Direction = 'inbound' THEN 1 ELSE 0 END) as InboundCalls,
          SUM(CASE WHEN Direction = 'outbound' THEN 1 ELSE 0 END) as OutboundCalls,
          SUM(CASE WHEN Direction = 'internal' THEN 1 ELSE 0 END) as InternalCalls,
          SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) as CompletedCalls,
          SUM(CASE WHEN Status = 'missed' THEN 1 ELSE 0 END) as MissedCalls,
          SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) as FailedCalls,
          SUM(CASE WHEN RecordingId IS NOT NULL THEN 1 ELSE 0 END) as RecordedCalls,
          AVG(CAST(Duration as FLOAT)) as AverageDuration,
          SUM(Duration) as TotalDuration,
          AVG(CAST(WaitTime as FLOAT)) as AverageWaitTime
        FROM CallLogs
        WHERE CAST(StartTime AS DATE) = CAST(GETUTCDATE() AS DATE)
      `;

      const params = {};

      if (extension) {
        query += ` AND (FromExtension = @extension OR ToExtension = @extension)`;
        params.extension = extension;
      }

      const result = await databaseService.query(query, params);
      return result[0] || {};
    } catch (error) {
      logger.error('Failed to get today statistics', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  /**
   * Get statistics for date range
   */
  async getStatisticsByDateRange(startDate, endDate, extension = null) {
    try {
      let query = `
        SELECT 
          CAST(StartTime AS DATE) as Date,
          Extension,
          COUNT(*) as TotalCalls,
          SUM(CASE WHEN Direction = 'inbound' THEN 1 ELSE 0 END) as InboundCalls,
          SUM(CASE WHEN Direction = 'outbound' THEN 1 ELSE 0 END) as OutboundCalls,
          SUM(CASE WHEN Direction = 'internal' THEN 1 ELSE 0 END) as InternalCalls,
          SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) as CompletedCalls,
          SUM(CASE WHEN Status = 'missed' THEN 1 ELSE 0 END) as MissedCalls,
          SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) as FailedCalls,
          SUM(CASE WHEN RecordingId IS NOT NULL THEN 1 ELSE 0 END) as RecordedCalls,
          AVG(CAST(Duration as FLOAT)) as AverageDuration,
          SUM(Duration) as TotalDuration,
          AVG(CAST(WaitTime as FLOAT)) as AverageWaitTime
        FROM CallLogs
        WHERE StartTime >= @startDate AND StartTime < @endDate
      `;

      const params = {
        startDate,
        endDate
      };

      if (extension) {
        query += ` AND (FromExtension = @extension OR ToExtension = @extension)`;
        params.extension = extension;
      }

      query += ` GROUP BY CAST(StartTime AS DATE), Extension ORDER BY Date DESC`;

      return await databaseService.query(query, params);
    } catch (error) {
      logger.error('Failed to get statistics by date range', {
        error: error.message,
        startDate,
        endDate,
        extension
      });
      throw error;
    }
  }

  /**
   * Get extension summary statistics
   */
  async getExtensionSummary() {
    try {
      const stats = await databaseService.query(`
        SELECT 
          COALESCE(FromExtension, ToExtension) as Extension,
          COUNT(*) as TotalCalls,
          SUM(CASE WHEN Direction = 'inbound' THEN 1 ELSE 0 END) as InboundCalls,
          SUM(CASE WHEN Direction = 'outbound' THEN 1 ELSE 0 END) as OutboundCalls,
          SUM(CASE WHEN Direction = 'internal' THEN 1 ELSE 0 END) as InternalCalls,
          SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) as CompletedCalls,
          SUM(CASE WHEN Status = 'missed' THEN 1 ELSE 0 END) as MissedCalls,
          SUM(CASE WHEN RecordingId IS NOT NULL THEN 1 ELSE 0 END) as RecordedCalls,
          AVG(CAST(Duration as FLOAT)) as AverageDuration,
          SUM(Duration) as TotalDuration
        FROM CallLogs
        WHERE StartTime >= DATEADD(DAY, -30, CAST(GETUTCDATE() AS DATE))
        GROUP BY COALESCE(FromExtension, ToExtension)
        ORDER BY TotalCalls DESC
      `);

      return stats;
    } catch (error) {
      logger.error('Failed to get extension summary', { error: error.message });
      throw error;
    }
  }

  /**
   * Get system wide statistics
   */
  async getSystemStatistics() {
    try {
      const [today, onlineExtensions, totalRecordings] = await Promise.all([
        this.getTodayStatistics(),
        databaseService.query(`
          SELECT COUNT(*) as OnlineCount FROM OnlineExtensions 
          WHERE OnlineSince > DATEADD(MINUTE, -5, GETUTCDATE())
        `),
        databaseService.query(`
          SELECT 
            COUNT(*) as TotalRecordings,
            SUM(FileSize) as TotalStorageUsed,
            AVG(Duration) as AverageRecordingDuration
          FROM Recordings
          WHERE RecordedAt >= DATEADD(DAY, -30, GETUTCDATE())
        `)
      ]);

      return {
        today,
        onlineExtensions: onlineExtensions[0]?.OnlineCount || 0,
        recordings: totalRecordings[0] || {}
      };
    } catch (error) {
      logger.error('Failed to get system statistics', { error: error.message });
      throw error;
    }
  }

  /**
   * Update daily statistics (called every 5 minutes)
   */
  async updateDailyStatistics() {
    try {
      const stats = await this.getExtensionSummary();
      
      // Broadcast to connected clients
      this.io.to('statistics').emit('statistics:updated', {
        timestamp: new Date().toISOString(),
        extensionSummary: stats
      });

      logger.debug('Daily statistics updated');
    } catch (error) {
      logger.error('Failed to update daily statistics', { error: error.message });
    }
  }
}

export default new StatisticsService();
