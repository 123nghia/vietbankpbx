/**
 * PBX Data Service
 * Reads call history and recording metadata from FreePBX CDR.
 */

import fs from 'fs';
import mysql from 'mysql2/promise';
import logger from '../utils/logger.js';
import pbxConfigService from './pbx-config-service.js';

class PBXDataService {
  constructor() {
    this.pool = null;
    this.columns = new Set();
  }

  async initialize() {
    const config = pbxConfigService.getCdrConfig();

    if (!config.user || !config.password) {
      logger.warn('CDR database credentials are missing. FreePBX config auto-discovery may be incomplete.');
    }

    this.pool = mysql.createPool(config);
    await this.pool.query('SELECT 1');
    await this.loadSchema();

    logger.info('Connected to FreePBX CDR database', {
      host: config.host,
      port: config.port,
      database: config.database
    });
  }

  async loadSchema() {
    const sql = `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cdr'
    `;

    const [rows] = await this.pool.query(sql);
    this.columns = new Set(rows.map((row) => row.COLUMN_NAME));
  }

  hasColumn(name) {
    return this.columns.has(name);
  }

  selectColumn(columnName, alias = columnName) {
    if (!this.hasColumn(columnName)) {
      return `NULL AS \`${alias}\``;
    }

    return `\`${columnName}\` AS \`${alias}\``;
  }

  getTimeColumn() {
    return this.hasColumn('start') ? 'start' : 'calldate';
  }

  getAnswerColumn() {
    return this.hasColumn('answer') ? 'answer' : null;
  }

  getEndColumn() {
    return this.hasColumn('end') ? 'end' : null;
  }

  buildCdrSubquery(baseFilters = {}, includeRecordingsOnly = false) {
    const timeColumn = this.getTimeColumn();
    const answerColumn = this.getAnswerColumn();
    const endColumn = this.getEndColumn();
    const extensionPattern = pbxConfigService.getInternalNumberPattern().source;

    const whereClauses = ['1 = 1'];
    const params = [];

    if (baseFilters.startDate) {
      whereClauses.push(`\`${timeColumn}\` >= ?`);
      params.push(baseFilters.startDate);
    }

    if (baseFilters.endDate) {
      whereClauses.push(`\`${timeColumn}\` <= ?`);
      params.push(baseFilters.endDate);
    }

    if (baseFilters.extension) {
      whereClauses.push(`
        (
          src = ?
          OR dst = ?
          OR channel LIKE ?
          OR dstchannel LIKE ?
        )
      `);
      params.push(
        String(baseFilters.extension),
        String(baseFilters.extension),
        `%/${baseFilters.extension}-%`,
        `%/${baseFilters.extension}-%`
      );
    }

    if (baseFilters.callId) {
      whereClauses.push(`
        (
          uniqueid = ?
          OR linkedid = ?
          OR accountcode = ?
        )
      `);
      params.push(baseFilters.callId, baseFilters.callId, baseFilters.callId);
    }

    if (includeRecordingsOnly) {
      if (this.hasColumn('recordingfile')) {
        whereClauses.push(`COALESCE(recordingfile, '') <> ''`);
      } else if (this.hasColumn('userfield')) {
        whereClauses.push(`COALESCE(userfield, '') <> ''`);
      } else {
        whereClauses.push('1 = 0');
      }
    }

    const subquery = `
      SELECT
        ${this.selectColumn('uniqueid')},
        ${this.selectColumn('linkedid')},
        ${this.selectColumn('accountcode')},
        ${this.selectColumn('clid')},
        ${this.selectColumn('src')},
        ${this.selectColumn('dst')},
        ${this.selectColumn('did')},
        ${this.selectColumn('dcontext')},
        ${this.selectColumn('channel')},
        ${this.selectColumn('dstchannel')},
        ${this.selectColumn('lastapp')},
        ${this.selectColumn('lastdata')},
        ${this.selectColumn('duration')},
        ${this.selectColumn('billsec')},
        ${this.selectColumn('disposition')},
        ${this.selectColumn('amaflags')},
        ${this.selectColumn('userfield')},
        ${this.selectRecordingFileColumn()},
        ${this.selectColumn('cnum')},
        ${this.selectColumn('cnam')},
        ${this.selectColumn(timeColumn, 'start_time')},
        ${answerColumn ? this.selectColumn(answerColumn, 'answer_time') : 'NULL AS `answer_time`'},
        ${endColumn ? this.selectColumn(endColumn, 'end_time') : 'NULL AS `end_time`'},
        CASE
          WHEN src REGEXP '${extensionPattern}' AND dst REGEXP '${extensionPattern}' THEN 'internal'
          WHEN src REGEXP '${extensionPattern}' THEN 'outbound'
          WHEN dst REGEXP '${extensionPattern}' THEN 'inbound'
          ELSE 'unknown'
        END AS normalized_direction,
        CASE
          WHEN UPPER(COALESCE(disposition, '')) = 'ANSWERED' THEN 'completed'
          WHEN UPPER(COALESCE(disposition, '')) = 'BUSY' THEN 'busy'
          WHEN UPPER(COALESCE(disposition, '')) IN ('NO ANSWER', 'NOANSWER') THEN 'no_answer'
          WHEN UPPER(COALESCE(disposition, '')) = 'CANCEL' THEN 'cancelled'
          WHEN UPPER(COALESCE(disposition, '')) IN ('FAILED', 'CONGESTION', 'CHANUNAVAIL') THEN 'failed'
          ELSE LOWER(REPLACE(COALESCE(disposition, 'unknown'), ' ', '_'))
        END AS normalized_status,
        GREATEST(COALESCE(duration, 0) - COALESCE(billsec, 0), 0) AS wait_time
      FROM cdr
      WHERE ${whereClauses.join(' AND ')}
    `;

    return { subquery, params };
  }

  buildOuterFilters(filters = {}) {
    const whereClauses = ['1 = 1'];
    const params = [];

    if (filters.direction) {
      whereClauses.push('normalized_direction = ?');
      params.push(filters.direction);
    }

    if (filters.status) {
      whereClauses.push('normalized_status = ?');
      params.push(filters.status);
    }

    return { whereClauses, params };
  }

  async getCallHistory(filters = {}) {
    const { subquery, params: subqueryParams } = this.buildCdrSubquery(filters, false);
    const { whereClauses, params: outerParams } = this.buildOuterFilters(filters);
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const sql = `
      SELECT *
      FROM (${subquery}) cdr_view
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY start_time DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (${subquery}) cdr_view
      WHERE ${whereClauses.join(' AND ')}
    `;

    const queryParams = [...subqueryParams, ...outerParams, limit, offset];
    const countParams = [...subqueryParams, ...outerParams];

    const [rows] = await this.pool.query(sql, queryParams);
    const [countRows] = await this.pool.query(countSql, countParams);

    return {
      calls: rows.map((row) => this.normalizeCallRow(row)),
      total: countRows[0]?.total || 0,
      limit,
      offset
    };
  }

  async getCallDetails(callId) {
    const result = await this.getCallHistory({
      callId,
      limit: 1,
      offset: 0
    });

    if (!result.calls.length) {
      throw {
        statusCode: 404,
        message: 'Call not found'
      };
    }

    return result.calls[0];
  }

  async getRecordings(filters = {}) {
    const { subquery, params: subqueryParams } = this.buildCdrSubquery(filters, true);
    const { whereClauses, params: outerParams } = this.buildOuterFilters(filters);
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const sql = `
      SELECT *
      FROM (${subquery}) recording_view
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY start_time DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (${subquery}) recording_view
      WHERE ${whereClauses.join(' AND ')}
    `;

    const queryParams = [...subqueryParams, ...outerParams, limit, offset];
    const countParams = [...subqueryParams, ...outerParams];

    const [rows] = await this.pool.query(sql, queryParams);
    const [countRows] = await this.pool.query(countSql, countParams);

    return {
      recordings: rows
        .map((row) => this.normalizeRecordingRow(row))
        .filter((recording) => recording !== null),
      total: countRows[0]?.total || 0,
      limit,
      offset
    };
  }

  async getRecording(recordingId) {
    const decoded = this.decodeRecordingId(recordingId);

    if (!decoded.callId || !decoded.recordingFile) {
      throw {
        statusCode: 400,
        message: 'Invalid recording ID'
      };
    }

    const { subquery, params } = this.buildCdrSubquery({
      callId: decoded.callId
    }, true);

    const sql = `
      SELECT *
      FROM (${subquery}) recording_view
      ORDER BY start_time DESC
      LIMIT 100
    `;

    const [rows] = await this.pool.query(sql, params);

    const recording = rows
      .map((row) => this.normalizeRecordingRow(row))
      .find((item) => item && item.fileName === decoded.recordingFile);

    if (!recording) {
      throw {
        statusCode: 404,
        message: 'Recording not found'
      };
    }

    return recording;
  }

  async getAggregatedStatistics(filters = {}) {
    const history = await this.getCallHistory({
      ...filters,
      limit: filters.limit || 5000,
      offset: 0
    });

    const calls = history.calls;
    const totalTalkTime = calls.reduce((sum, call) => sum + (call.talkTime || 0), 0);
    const totalWaitTime = calls.reduce((sum, call) => sum + (call.waitTime || 0), 0);
    const recordedCalls = calls.filter((call) => Boolean(call.recordingId)).length;

    const statusCounts = {};
    calls.forEach((call) => {
      statusCounts[call.status] = (statusCounts[call.status] || 0) + 1;
    });

    return {
      totalCalls: calls.length,
      inboundCalls: calls.filter((call) => call.direction === 'inbound').length,
      outboundCalls: calls.filter((call) => call.direction === 'outbound').length,
      internalCalls: calls.filter((call) => call.direction === 'internal').length,
      completedCalls: calls.filter((call) => call.status === 'completed').length,
      noAnswerCalls: calls.filter((call) => call.status === 'no_answer').length,
      busyCalls: calls.filter((call) => call.status === 'busy').length,
      failedCalls: calls.filter((call) => call.status === 'failed').length,
      cancelledCalls: calls.filter((call) => call.status === 'cancelled').length,
      recordedCalls,
      averageTalkTime: calls.length ? Math.round(totalTalkTime / calls.length) : 0,
      totalTalkTime,
      averageWaitTime: calls.length ? Math.round(totalWaitTime / calls.length) : 0,
      totalWaitTime,
      byStatus: statusCounts
    };
  }

  async getDailyStatistics(startDate, endDate, extension = null) {
    const history = await this.getCallHistory({
      startDate,
      endDate,
      extension,
      limit: 10000,
      offset: 0
    });

    const groups = new Map();

    history.calls.forEach((call) => {
      const key = call.startTime ? call.startTime.slice(0, 10) : 'unknown';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(call);
    });

    return Array.from(groups.entries())
      .map(([date, calls]) => {
        const aggregate = this.aggregateCallSet(calls);
        return {
          date,
          ...aggregate
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getExtensionSummary(extensions = []) {
    const history = await this.getCallHistory({
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
      limit: 10000,
      offset: 0
    });

    const targetExtensions = extensions.length
      ? extensions
      : Array.from(
          new Set(
            history.calls
              .flatMap((call) => [call.fromExtension, call.toExtension])
              .filter(Boolean)
          )
        );

    return targetExtensions
      .map((extension) => {
        const calls = history.calls.filter(
          (call) => call.fromExtension === extension || call.toExtension === extension
        );

        const aggregate = this.aggregateCallSet(calls);
        return {
          extension,
          ...aggregate
        };
      })
      .sort((a, b) => b.totalCalls - a.totalCalls);
  }

  async getRecordingSummary(days = 30) {
    const recordings = await this.getRecordings({
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      endDate: new Date(),
      limit: 10000,
      offset: 0
    });

    return {
      totalRecordings: recordings.total,
      totalStorageUsed: recordings.recordings.reduce((sum, item) => sum + (item.fileSize || 0), 0),
      averageRecordingDuration: recordings.recordings.length
        ? Math.round(
            recordings.recordings.reduce((sum, item) => sum + (item.duration || 0), 0) /
              recordings.recordings.length
          )
        : 0
    };
  }

  aggregateCallSet(calls) {
    const totalTalkTime = calls.reduce((sum, call) => sum + (call.talkTime || 0), 0);
    const totalWaitTime = calls.reduce((sum, call) => sum + (call.waitTime || 0), 0);

    return {
      totalCalls: calls.length,
      inboundCalls: calls.filter((call) => call.direction === 'inbound').length,
      outboundCalls: calls.filter((call) => call.direction === 'outbound').length,
      internalCalls: calls.filter((call) => call.direction === 'internal').length,
      completedCalls: calls.filter((call) => call.status === 'completed').length,
      busyCalls: calls.filter((call) => call.status === 'busy').length,
      noAnswerCalls: calls.filter((call) => call.status === 'no_answer').length,
      failedCalls: calls.filter((call) => call.status === 'failed').length,
      cancelledCalls: calls.filter((call) => call.status === 'cancelled').length,
      recordedCalls: calls.filter((call) => Boolean(call.recordingId)).length,
      averageTalkTime: calls.length ? Math.round(totalTalkTime / calls.length) : 0,
      totalTalkTime,
      averageWaitTime: calls.length ? Math.round(totalWaitTime / calls.length) : 0,
      totalWaitTime
    };
  }

  normalizeCallRow(row) {
    const recordingFile = this.extractRecordingFileName(row.recordingfile);
    const fromExtension = this.getInternalExtension(row.src, row.channel);
    const toExtension = this.getInternalExtension(row.dst, row.dstchannel);
    const direction = row.normalized_direction || 'unknown';
    const externalNumber = direction === 'inbound'
      ? row.src || null
      : direction === 'outbound'
        ? row.dst || null
        : null;

    return {
      callId: row.accountcode || row.linkedid || row.uniqueid,
      uniqueId: row.uniqueid,
      linkedId: row.linkedid || row.uniqueid,
      callerId: row.clid || row.cnum || null,
      callerName: row.cnam || null,
      fromExtension,
      toExtension,
      externalNumber,
      source: row.src || null,
      destination: row.dst || null,
      context: row.dcontext || null,
      channel: row.channel || null,
      destinationChannel: row.dstchannel || null,
      direction,
      status: row.normalized_status || 'unknown',
      rawDisposition: row.disposition || null,
      startTime: this.toIsoString(row.start_time),
      answerTime: this.toIsoString(row.answer_time),
      endTime: this.toIsoString(row.end_time),
      duration: Number(row.duration || 0),
      talkTime: Number(row.billsec || 0),
      waitTime: Number(row.wait_time || 0),
      lastApplication: row.lastapp || null,
      lastData: row.lastdata || null,
      recordingId: recordingFile
        ? this.encodeRecordingId(row.accountcode || row.linkedid || row.uniqueid, recordingFile)
        : null,
      recordingFile: recordingFile || null
    };
  }

  normalizeRecordingRow(row) {
    const recordingFile = this.extractRecordingFileName(row.recordingfile);

    if (!recordingFile) {
      return null;
    }

    const callId = row.accountcode || row.linkedid || row.uniqueid;
    const filePath = this.resolveRecordingPath(recordingFile, row.start_time);

    return {
      recordingId: this.encodeRecordingId(callId, recordingFile),
      callId,
      linkedId: row.linkedid || row.uniqueid,
      fileName: recordingFile,
      filePath,
      fileExists: fs.existsSync(filePath),
      fileSize: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
      fileFormat: this.getFileExtension(recordingFile),
      duration: Number(row.billsec || row.duration || 0),
      direction: row.normalized_direction || 'unknown',
      status: row.normalized_status || 'unknown',
      fromExtension: this.getInternalExtension(row.src, row.channel),
      toExtension: this.getInternalExtension(row.dst, row.dstchannel),
      externalNumber: row.normalized_direction === 'inbound' ? row.src : row.dst,
      recordedAt: this.toIsoString(row.start_time)
    };
  }

  getInternalExtension(primaryValue, channelValue) {
    const numberPattern = pbxConfigService.getInternalNumberPattern();

    if (primaryValue && numberPattern.test(String(primaryValue))) {
      return String(primaryValue);
    }

    if (!channelValue) {
      return null;
    }

    const match = String(channelValue).match(/(?:PJSIP|SIP|Local)\/([^@\-\/]+)/i);
    if (match && numberPattern.test(match[1])) {
      return match[1];
    }

    return null;
  }

  selectRecordingFileColumn() {
    if (this.hasColumn('recordingfile')) {
      return this.selectColumn('recordingfile');
    }

    if (this.hasColumn('userfield')) {
      return '`userfield` AS `recordingfile`';
    }

    return 'NULL AS `recordingfile`';
  }

  extractRecordingFileName(value) {
    if (!value) {
      return null;
    }

    const normalized = String(value).trim();

    if (/\.(wav|mp3|gsm|ogg)$/i.test(normalized)) {
      const parts = normalized.split(/[\\/]/);
      return parts[parts.length - 1];
    }

    const match = normalized.match(/([A-Za-z0-9_\-./]+?\.(wav|mp3|gsm|ogg))/i);
    if (match) {
      const parts = match[1].split(/[\\/]/);
      return parts[parts.length - 1];
    }

    return null;
  }

  resolveRecordingPath(recordingFile, callDate) {
    const recordingRoot = pbxConfigService.getRecordingRoot();

    if (recordingFile.includes('/') || recordingFile.includes('\\')) {
      return recordingFile.startsWith('/')
        ? recordingFile
        : `${recordingRoot}/${recordingFile}`;
    }

    const callTime = callDate ? new Date(callDate) : new Date();
    const year = String(callTime.getUTCFullYear());
    const month = String(callTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(callTime.getUTCDate()).padStart(2, '0');

    const datedPath = `${recordingRoot}/${year}/${month}/${day}/${recordingFile}`;
    if (fs.existsSync(datedPath)) {
      return datedPath;
    }

    return `${recordingRoot}/${recordingFile}`;
  }

  encodeRecordingId(callId, recordingFile) {
    return Buffer.from(JSON.stringify({ callId, recordingFile }), 'utf8').toString('base64url');
  }

  decodeRecordingId(recordingId) {
    try {
      return JSON.parse(Buffer.from(recordingId, 'base64url').toString('utf8'));
    } catch (error) {
      return {};
    }
  }

  getFileExtension(fileName) {
    const segments = String(fileName).split('.');
    return segments.length > 1 ? segments.pop().toLowerCase() : 'wav';
  }

  toIsoString(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export default new PBXDataService();
