/**
 * Call Manager Service
 * Orchestrates CRM-facing call APIs on top of PBX services.
 */

import logger from '../utils/logger.js';
import sipService from './sip-service.js';
import pbxDataService from './pbx-data-service.js';
import sipLineService from './sip-line-service.js';

class CallManager {
  constructor() {
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    logger.info('Call Manager initialized');
  }

  async autoDial(fromExtension, toNumber, metadata = {}) {
    const line = await sipLineService.getSIPLineByExtension(fromExtension);

    if (line.status !== 'active') {
      throw {
        statusCode: 409,
        message: `Managed line ${fromExtension} is not active`
      };
    }

    if (
      metadata.employeeId &&
      line.assignment?.employeeId &&
      String(metadata.employeeId) !== String(line.assignment.employeeId)
    ) {
      throw {
        statusCode: 409,
        message: `Managed line ${fromExtension} is assigned to employee ${line.assignment.employeeId}`
      };
    }

    const mergedMetadata = {
      ...metadata,
      employeeId: metadata.employeeId || line.assignment?.employeeId || null,
      employeeName: metadata.employeeName || line.assignment?.employeeName || null,
      employeeCode: metadata.employeeCode || line.assignment?.employeeCode || null
    };

    const callId = await sipService.makeCall(fromExtension, toNumber, mergedMetadata);

    logger.info('Auto-dial initiated', {
      callId,
      fromExtension,
      toNumber,
      employeeId: mergedMetadata.employeeId || null
    });

    return {
      callId,
      status: 'initiated',
      fromExtension,
      toNumber,
      employeeId: mergedMetadata.employeeId || null
    };
  }

  async getCallHistory(filters = {}) {
    try {
      return await pbxDataService.getCallHistory(filters);
    } catch (error) {
      logger.error('Failed to get call history', { error: error.message });
      throw error;
    }
  }

  async getCallDetails(callId) {
    try {
      const activeCall = sipService.getCallSnapshot(callId);
      if (activeCall) {
        return activeCall;
      }

      return await pbxDataService.getCallDetails(callId);
    } catch (error) {
      logger.error('Failed to get call details', {
        error: error.message,
        callId
      });
      throw error;
    }
  }

  async endCall(callId, reason = 'normal') {
    try {
      const result = await sipService.endCall(callId, reason);

      logger.info('Call end requested', { callId, reason });

      return result;
    } catch (error) {
      logger.error('Failed to end call', {
        error: error.message,
        callId
      });
      throw error;
    }
  }

  getActiveCalls() {
    return sipService.getActiveCalls();
  }

  getActiveCallsCount() {
    return sipService.getActiveCallsCount();
  }
}

export default new CallManager();
