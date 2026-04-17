/**
 * Statistics Service
 * Builds dashboard metrics from PBX CDR and realtime AMI state.
 */

import logger from '../utils/logger.js';
import pbxDataService from './pbx-data-service.js';
import sipService from './sip-service.js';
import sipLineService from './sip-line-service.js';

class StatisticsService {
  constructor() {
    this.io = null;
    this.timer = null;
  }

  async initialize(io) {
    this.io = io;

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(
      () => this.updateDashboardStatistics(),
      5 * 60 * 1000
    );

    logger.info('Statistics Service initialized');
  }

  async getTodayStatistics(extension = null) {
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);

    return pbxDataService.getAggregatedStatistics({
      startDate,
      endDate: new Date(),
      extension
    });
  }

  async getStatisticsByDateRange(startDate, endDate, extension = null) {
    return pbxDataService.getDailyStatistics(startDate, endDate, extension);
  }

  async getExtensionSummary() {
    const managedExtensions = sipLineService.getManagedExtensions();
    if (!managedExtensions.length) {
      return [];
    }

    return pbxDataService.getExtensionSummary(managedExtensions);
  }

  async getSystemStatistics() {
    const [today, recordingSummary, onlineExtensions, lineStats] = await Promise.all([
      this.getTodayStatistics(),
      pbxDataService.getRecordingSummary(30),
      sipService.getOnlineExtensions(sipLineService.getManagedExtensions()),
      sipLineService.getSIPLineStats()
    ]);

    return {
      today,
      activeCalls: sipService.getActiveCallsCount(),
      onlineExtensions: onlineExtensions.length,
      managedLines: lineStats,
      recordings: recordingSummary
    };
  }

  async updateDashboardStatistics() {
    try {
      const [system, extensionSummary] = await Promise.all([
        this.getSystemStatistics(),
        this.getExtensionSummary()
      ]);

      if (this.io) {
        this.io.to('statistics').emit('statistics:updated', {
          timestamp: new Date().toISOString(),
          system,
          extensionSummary
        });
      }
    } catch (error) {
      logger.error('Failed to update dashboard statistics', {
        error: error.message
      });
    }
  }
}

export default new StatisticsService();
