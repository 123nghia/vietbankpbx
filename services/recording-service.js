/**
 * Recording Service
 * Reads recording metadata and files directly from the PBX host.
 */

import fs from 'fs';
import logger from '../utils/logger.js';
import pbxConfigService from './pbx-config-service.js';
import pbxDataService from './pbx-data-service.js';

class RecordingService {
  async initialize() {
    logger.info('Recording Service initialized', {
      recordingRoot: pbxConfigService.getRecordingRoot()
    });
  }

  async getRecordings(filters = {}) {
    return pbxDataService.getRecordings(filters);
  }

  async getRecording(recordingId) {
    return pbxDataService.getRecording(recordingId);
  }

  async registerRecording() {
    throw {
      statusCode: 501,
      message: 'Manual recording registration is not used when service is deployed on the PBX host'
    };
  }

  async deleteRecording(recordingId) {
    const recording = await this.getRecording(recordingId);

    if (!recording.filePath || !fs.existsSync(recording.filePath)) {
      throw {
        statusCode: 404,
        message: 'Recording file not found'
      };
    }

    if (process.env.ALLOW_RECORDING_DELETE !== 'true') {
      throw {
        statusCode: 403,
        message: 'Recording delete is disabled'
      };
    }

    fs.unlinkSync(recording.filePath);

    logger.info('Recording file deleted from PBX host', {
      recordingId,
      filePath: recording.filePath
    });

    return {
      success: true,
      recordingId
    };
  }

  getRecordingStream(recordingId, recording) {
    if (!recording.filePath || !fs.existsSync(recording.filePath)) {
      throw {
        statusCode: 404,
        message: 'Recording file not found'
      };
    }

    return fs.createReadStream(recording.filePath);
  }
}

export default new RecordingService();
