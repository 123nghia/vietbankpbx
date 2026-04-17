/**
 * SIP Line Management Service
 * Keeps track of PBX extensions that CRM is allowed to use and assign.
 */

import logger from '../utils/logger.js';
import lineStoreService from './line-store-service.js';
import sipService from './sip-service.js';

class SIPLineService {
  constructor() {
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    await lineStoreService.initialize();
    logger.info('SIP Line Service initialized');
  }

  async createSIPLine(createRequest) {
    const extension = String(createRequest.extension);

    try {
      const liveState = await sipService.getExtensionState(extension).catch(() => null);

      const line = lineStoreService.createManagedLine({
        extension,
        displayName: createRequest.displayName || extension,
        endpointTech: createRequest.endpointTech,
        hintContext: createRequest.hintContext,
        dialContext: createRequest.dialContext,
        status: createRequest.status || 'active',
        metadata: {
          note: createRequest.note || null,
          ...createRequest.metadata
        },
        createdByUserId: createRequest.createdByUserId || 'system'
      });

      const payload = {
        ...line,
        liveState
      };

      this.emit('sip:line-created', payload);

      logger.info('Managed SIP line registered', {
        extension,
        lineId: line.lineId
      });

      return payload;
    } catch (error) {
      logger.error('Failed to register managed SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  async deleteSIPLine(extension, deletedByUserId) {
    const line = lineStoreService.deleteManagedLine(extension, deletedByUserId);

    this.emit('sip:line-deleted', {
      extension: String(extension),
      lineId: line.lineId
    });

    return {
      success: true,
      extension: String(extension),
      lineId: line.lineId,
      message: 'Managed SIP line removed'
    };
  }

  async getSIPLines(filters = {}) {
    const result = lineStoreService.getManagedLines(filters);
    const states = await Promise.all(
      result.lines.map((line) =>
        sipService.getExtensionState(line.extension).catch(() => ({
          extension: line.extension,
          status: 'unknown',
          statusCode: -1,
          rawStatus: 'Unknown',
          hint: null,
          device: null,
          lastUpdate: new Date().toISOString()
        }))
      )
    );

    const lines = result.lines.map((line) => {
      const liveState = states.find((state) => state.extension === line.extension) || null;
      return {
        ...line,
        liveState
      };
    });

    return {
      lines,
      total: result.total,
      limit: result.limit,
      offset: result.offset
    };
  }

  async getSIPLineByExtension(extension) {
    const line = lineStoreService.getManagedLine(extension);

    if (!line) {
      throw {
        statusCode: 404,
        message: `Managed line ${extension} not found`
      };
    }

    const liveState = await sipService.getExtensionState(extension).catch(() => null);

    return {
      ...line,
      liveState
    };
  }

  async updateSIPLine(extension, updateRequest) {
    const line = lineStoreService.updateManagedLine(extension, {
      displayName: updateRequest.displayName,
      endpointTech: updateRequest.endpointTech,
      hintContext: updateRequest.hintContext,
      dialContext: updateRequest.dialContext,
      status: updateRequest.status,
      metadata: updateRequest.metadata
    });

    const liveState = await sipService.getExtensionState(extension).catch(() => null);

    this.emit('sip:line-updated', {
      extension: String(extension),
      ...updateRequest
    });

    return {
      success: true,
      line: {
        ...line,
        liveState
      }
    };
  }

  async getSIPLineStats() {
    const lines = lineStoreService.getManagedLines({
      limit: 10000,
      offset: 0
    }).lines;

    const liveStates = await sipService.getOnlineExtensions(lines.map((line) => line.extension));

    return {
      totalLines: lines.length,
      activeLines: lines.filter((line) => line.status === 'active').length,
      inactiveLines: lines.filter((line) => line.status !== 'active').length,
      assignedLines: lines.filter((line) => Boolean(line.assignment?.employeeId)).length,
      onlineLines: liveStates.length
    };
  }

  async activateSIPLine(extension) {
    const line = lineStoreService.updateManagedLine(extension, {
      status: 'active'
    });

    this.emit('sip:line-activated', {
      extension: String(extension)
    });

    return {
      success: true,
      extension: String(extension),
      status: line.status
    };
  }

  async deactivateSIPLine(extension) {
    const line = lineStoreService.updateManagedLine(extension, {
      status: 'inactive'
    });

    this.emit('sip:line-deactivated', {
      extension: String(extension)
    });

    return {
      success: true,
      extension: String(extension),
      status: line.status
    };
  }

  async assignSIPLine(extension, assignment) {
    const line = lineStoreService.assignLine(extension, assignment);
    const liveState = await sipService.getExtensionState(extension).catch(() => null);

    this.emit('sip:line-assigned', {
      extension: String(extension),
      assignment: line.assignment
    });

    return {
      success: true,
      line: {
        ...line,
        liveState
      }
    };
  }

  async unassignSIPLine(extension) {
    const line = lineStoreService.unassignLine(extension);
    const liveState = await sipService.getExtensionState(extension).catch(() => null);

    this.emit('sip:line-unassigned', {
      extension: String(extension)
    });

    return {
      success: true,
      line: {
        ...line,
        liveState
      }
    };
  }

  getManagedExtensions() {
    return lineStoreService.getManagedExtensions();
  }

  emit(eventName, payload) {
    if (!this.io) {
      return;
    }

    this.io.to('sip').emit(eventName, {
      ...payload,
      timestamp: new Date().toISOString()
    });
  }
}

export default new SIPLineService();
