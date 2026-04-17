/**
 * PBX Configuration Service
 * Loads runtime settings from environment variables and FreePBX config.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

class PBXConfigService {
  constructor() {
    this.freepbxConfig = null;
  }

  loadFreePBXConfig() {
    if (this.freepbxConfig !== null) {
      return this.freepbxConfig;
    }

    const configFile = process.env.FREEPBX_CONFIG_FILE || '/etc/freepbx.conf';

    if (!fs.existsSync(configFile)) {
      logger.warn('FreePBX config file not found, using environment variables only', {
        configFile
      });
      this.freepbxConfig = {};
      return this.freepbxConfig;
    }

    const content = fs.readFileSync(configFile, 'utf8');
    const config = {};
    const regex = /\$amp_conf\[['"]([^'"]+)['"]\]\s*=\s*['"]([^'"]*)['"]\s*;/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      config[match[1]] = match[2];
    }

    this.freepbxConfig = config;

    logger.info('FreePBX config loaded', {
      configFile,
      keys: Object.keys(config).length
    });

    return config;
  }

  getAmiConfig() {
    return {
      host: process.env.FREEPBX_AMI_HOST || process.env.FREEPBX_HOST || '127.0.0.1',
      port: parseInt(process.env.FREEPBX_AMI_PORT || '5038', 10),
      username: process.env.FREEPBX_AMI_USER || 'admin',
      password: process.env.FREEPBX_AMI_PASSWORD || '',
      bannerTimeoutMs: parseInt(process.env.FREEPBX_AMI_BANNER_TIMEOUT_MS || '15000', 10),
      requireBanner: process.env.FREEPBX_AMI_REQUIRE_BANNER === 'true',
      reconnectDelayMs: parseInt(process.env.FREEPBX_AMI_RECONNECT_DELAY_MS || '5000', 10)
    };
  }

  getCdrConfig() {
    const freepbxConfig = this.loadFreePBXConfig();

    return {
      host: process.env.FREEPBX_CDR_DB_HOST ||
        freepbxConfig.CDRDBHOST ||
        freepbxConfig.AMPDBHOST ||
        '127.0.0.1',
      port: parseInt(
        process.env.FREEPBX_CDR_DB_PORT ||
          freepbxConfig.CDRDBPORT ||
          freepbxConfig.AMPDBPORT ||
          '3306',
        10
      ),
      user: process.env.FREEPBX_CDR_DB_USER ||
        freepbxConfig.CDRDBUSER ||
        freepbxConfig.AMPDBUSER ||
        '',
      password: process.env.FREEPBX_CDR_DB_PASSWORD ||
        freepbxConfig.CDRDBPASS ||
        freepbxConfig.AMPDBPASS ||
        '',
      database: process.env.FREEPBX_CDR_DB_NAME ||
        freepbxConfig.CDRDBNAME ||
        'asteriskcdrdb',
      waitForConnections: true,
      connectionLimit: parseInt(process.env.FREEPBX_CDR_DB_POOL_SIZE || '10', 10),
      queueLimit: 0
    };
  }

  getRecordingRoot() {
    return process.env.FREEPBX_RECORDING_ROOT ||
      process.env.RECORDING_STORAGE_PATH ||
      '/var/spool/asterisk/monitor';
  }

  getManagedLineStorePath() {
    return process.env.LINE_STORE_PATH || '/app/data/managed-lines.json';
  }

  getEndpointTechnology() {
    return process.env.FREEPBX_ENDPOINT_TECH || 'PJSIP';
  }

  getDialContext() {
    return process.env.FREEPBX_DIAL_CONTEXT || 'from-internal';
  }

  getHintContext() {
    return process.env.FREEPBX_HINT_CONTEXT || 'ext-local';
  }

  getServiceBaseUrl() {
    if (process.env.SERVICE_PUBLIC_URL) {
      return process.env.SERVICE_PUBLIC_URL;
    }

    const serviceHost = process.env.FREEPBX_HOST || '192.168.1.9';
    const servicePort = process.env.SERVICE_PORT || '3000';
    return `http://${serviceHost}:${servicePort}`;
  }

  getInternalNumberPattern() {
    const minLength = parseInt(process.env.INTERNAL_EXTENSION_MIN_LENGTH || '2', 10);
    const maxLength = parseInt(process.env.INTERNAL_EXTENSION_MAX_LENGTH || '6', 10);
    return new RegExp(`^[0-9]{${minLength},${maxLength}}$`);
  }

  ensureManagedLineStoreDirectory() {
    const storePath = this.getManagedLineStorePath();
    const directory = path.dirname(storePath);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }
}

export default new PBXConfigService();
