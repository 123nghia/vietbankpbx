/**
 * Local managed line store.
 * Keeps CRM-to-extension assignments on the PBX adapter host.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import pbxConfigService from './pbx-config-service.js';

class LineStoreService {
  constructor() {
    this.storePath = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.storePath = pbxConfigService.getManagedLineStorePath();
    pbxConfigService.ensureManagedLineStoreDirectory();

    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, JSON.stringify({ lines: [] }, null, 2), 'utf8');
    }

    this.initialized = true;
    logger.info('Managed line store initialized', {
      storePath: this.storePath
    });
  }

  readStore() {
    const content = fs.readFileSync(this.storePath, 'utf8');
    return JSON.parse(content || '{"lines":[]}');
  }

  writeStore(store) {
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf8');
  }

  getManagedLines(filters = {}) {
    const store = this.readStore();
    let lines = store.lines.filter((line) => !line.deleted);

    if (filters.extension) {
      const needle = String(filters.extension).toLowerCase();
      lines = lines.filter((line) => line.extension.toLowerCase().includes(needle));
    }

    if (filters.status) {
      lines = lines.filter((line) => line.status === filters.status);
    }

    if (filters.isAssigned !== undefined) {
      lines = lines.filter((line) => Boolean(line.assignment?.employeeId) === filters.isAssigned);
    }

    if (filters.employeeId) {
      lines = lines.filter((line) => line.assignment?.employeeId === filters.employeeId);
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 100;

    return {
      lines: lines.slice(offset, offset + limit),
      total: lines.length,
      offset,
      limit
    };
  }

  getManagedLine(extension) {
    const store = this.readStore();
    return store.lines.find((line) => !line.deleted && line.extension === String(extension)) || null;
  }

  createManagedLine(data) {
    const store = this.readStore();
    const extension = String(data.extension);

    if (store.lines.some((line) => !line.deleted && line.extension === extension)) {
      throw {
        statusCode: 409,
        message: `Extension ${extension} is already managed`
      };
    }

    const line = {
      lineId: uuidv4(),
      extension,
      displayName: data.displayName || extension,
      endpointTech: data.endpointTech || pbxConfigService.getEndpointTechnology(),
      hintContext: data.hintContext || pbxConfigService.getHintContext(),
      dialContext: data.dialContext || pbxConfigService.getDialContext(),
      status: data.status || 'active',
      assignment: data.assignment || null,
      metadata: data.metadata || {},
      createdByUserId: data.createdByUserId || 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false
    };

    store.lines.push(line);
    this.writeStore(store);
    return line;
  }

  updateManagedLine(extension, patch = {}) {
    const store = this.readStore();
    const line = store.lines.find((item) => !item.deleted && item.extension === String(extension));

    if (!line) {
      throw {
        statusCode: 404,
        message: `Managed line ${extension} not found`
      };
    }

    const allowedFields = [
      'displayName',
      'endpointTech',
      'hintContext',
      'dialContext',
      'status',
      'metadata'
    ];

    for (const field of allowedFields) {
      if (patch[field] !== undefined) {
        line[field] = patch[field];
      }
    }

    line.updatedAt = new Date().toISOString();
    this.writeStore(store);
    return line;
  }

  deleteManagedLine(extension, deletedByUserId = 'system') {
    const store = this.readStore();
    const line = store.lines.find((item) => !item.deleted && item.extension === String(extension));

    if (!line) {
      throw {
        statusCode: 404,
        message: `Managed line ${extension} not found`
      };
    }

    line.deleted = true;
    line.deletedAt = new Date().toISOString();
    line.deletedByUserId = deletedByUserId;
    line.updatedAt = line.deletedAt;

    this.writeStore(store);
    return line;
  }

  assignLine(extension, assignment = {}) {
    const store = this.readStore();
    const line = store.lines.find((item) => !item.deleted && item.extension === String(extension));

    if (!line) {
      throw {
        statusCode: 404,
        message: `Managed line ${extension} not found`
      };
    }

    if (!assignment.employeeId) {
      throw {
        statusCode: 400,
        message: 'employeeId is required'
      };
    }

    line.assignment = {
      employeeId: String(assignment.employeeId),
      employeeName: assignment.employeeName || null,
      employeeCode: assignment.employeeCode || null,
      assignedByUserId: assignment.assignedByUserId || 'system',
      assignedAt: new Date().toISOString()
    };

    line.updatedAt = new Date().toISOString();
    this.writeStore(store);
    return line;
  }

  unassignLine(extension) {
    const store = this.readStore();
    const line = store.lines.find((item) => !item.deleted && item.extension === String(extension));

    if (!line) {
      throw {
        statusCode: 404,
        message: `Managed line ${extension} not found`
      };
    }

    line.assignment = null;
    line.updatedAt = new Date().toISOString();
    this.writeStore(store);
    return line;
  }

  getManagedExtensions() {
    return this.readStore()
      .lines
      .filter((line) => !line.deleted && line.status === 'active')
      .map((line) => line.extension);
  }
}

export default new LineStoreService();
