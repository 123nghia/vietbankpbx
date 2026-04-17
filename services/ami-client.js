/**
 * Raw Asterisk Manager Interface client.
 */

import net from 'net';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import pbxConfigService from './pbx-config-service.js';

class AMIClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.buffer = '';
    this.connected = false;
    this.banner = null;
    this.initialized = false;
    this.pendingActions = new Map();
    this.actionSequence = 0;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.boundDataHandler = (chunk) => this.handleData(chunk);
    this.boundCloseHandler = () => this.handleDisconnect();
    this.boundErrorHandler = (error) => this.handleSocketError(error);
  }

  async initialize() {
    if (this.initialized && this.connected) {
      return;
    }

    this.shouldReconnect = true;
    await this.connectAndLogin();
    this.initialized = true;
  }

  async connectAndLogin() {
    const amiConfig = pbxConfigService.getAmiConfig();

    await new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: amiConfig.host, port: amiConfig.port },
        () => {
          socket.removeListener('error', reject);
          this.socket = socket;
          this.socket.setKeepAlive(true, 10000);
          this.socket.on('data', this.boundDataHandler);
          this.socket.on('close', this.boundCloseHandler);
          this.socket.on('error', this.boundErrorHandler);
          resolve();
        }
      );

      socket.once('error', reject);
    });

    await this.waitForBanner();

    const loginResponse = await this.sendAction('Login', {
      Username: amiConfig.username,
      Secret: amiConfig.password,
      Events: 'on'
    });

    if (loginResponse.Response !== 'Success') {
      throw new Error(loginResponse.Message || 'AMI login failed');
    }

    this.connected = true;
    logger.info('Connected to Asterisk AMI', {
      host: amiConfig.host,
      port: amiConfig.port
    });
  }

  waitForBanner() {
    if (this.banner) {
      return Promise.resolve(this.banner);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('banner', handleBanner);
        reject(new Error('Timed out waiting for AMI banner'));
      }, 5000);

      const handleBanner = (banner) => {
        clearTimeout(timeout);
        this.off('banner', handleBanner);
        resolve(banner);
      };

      this.once('banner', handleBanner);
    });
  }

  nextActionId(prefix = 'action') {
    this.actionSequence += 1;
    return `${prefix}-${Date.now()}-${this.actionSequence}`;
  }

  async sendAction(action, fields = {}) {
    if (!this.socket) {
      throw new Error('AMI socket is not connected');
    }

    const actionId = fields.ActionID || this.nextActionId(action.toLowerCase());

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(actionId);
        reject(new Error(`AMI action timed out: ${action}`));
      }, parseInt(process.env.FREEPBX_AMI_ACTION_TIMEOUT_MS || '10000', 10));

      this.pendingActions.set(actionId, {
        action,
        resolve,
        reject,
        timeout,
        expectEvents: false
      });

      this.writeAction(action, {
        ...fields,
        ActionID: actionId
      });
    });
  }

  async collectActionEvents(action, fields = {}, options = {}) {
    if (!this.socket) {
      throw new Error('AMI socket is not connected');
    }

    const actionId = fields.ActionID || this.nextActionId(action.toLowerCase());
    const completeEvent = options.completeEvent;
    const eventFilter = options.eventFilter || (() => true);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(actionId);
        reject(new Error(`AMI event collection timed out: ${action}`));
      }, parseInt(process.env.FREEPBX_AMI_ACTION_TIMEOUT_MS || '10000', 10));

      this.pendingActions.set(actionId, {
        action,
        resolve,
        reject,
        timeout,
        expectEvents: true,
        response: null,
        events: [],
        completeEvent,
        eventFilter
      });

      this.writeAction(action, {
        ...fields,
        ActionID: actionId
      });
    });
  }

  writeAction(action, fields) {
    const lines = [`Action: ${action}`];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => lines.push(`${key}: ${item}`));
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    lines.push('', '');
    this.socket.write(lines.join('\r\n'));
  }

  handleData(chunk) {
    this.buffer += chunk.toString('utf8');

    let separatorIndex = this.buffer.indexOf('\r\n\r\n');

    while (separatorIndex >= 0) {
      const rawMessage = this.buffer.slice(0, separatorIndex);
      this.buffer = this.buffer.slice(separatorIndex + 4);

      if (rawMessage.trim()) {
        const message = this.parseMessage(rawMessage);
        this.handleMessage(message);
      }

      separatorIndex = this.buffer.indexOf('\r\n\r\n');
    }
  }

  parseMessage(rawMessage) {
    const lines = rawMessage.split('\r\n');

    if (lines.length === 1 && !lines[0].includes(':')) {
      return { Banner: lines[0] };
    }

    const message = {};

    for (const line of lines) {
      const separator = line.indexOf(':');
      if (separator === -1) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();

      if (message[key] === undefined) {
        message[key] = value;
      } else if (Array.isArray(message[key])) {
        message[key].push(value);
      } else {
        message[key] = [message[key], value];
      }
    }

    return message;
  }

  handleMessage(message) {
    if (message.Banner) {
      this.banner = message.Banner;
      this.emit('banner', message.Banner);
      return;
    }

    if (message.Response) {
      const pendingAction = this.pendingActions.get(message.ActionID);

      if (!pendingAction) {
        return;
      }

      if (!pendingAction.expectEvents) {
        clearTimeout(pendingAction.timeout);
        this.pendingActions.delete(message.ActionID);
        pendingAction.resolve(message);
        return;
      }

      pendingAction.response = message;

      if (message.Response === 'Error') {
        clearTimeout(pendingAction.timeout);
        this.pendingActions.delete(message.ActionID);
        pendingAction.reject(new Error(message.Message || `AMI action failed: ${pendingAction.action}`));
      }

      return;
    }

    if (!message.Event) {
      return;
    }

    this.emit('event', message);
    this.emit(`event:${message.Event}`, message);

    const pendingAction = this.pendingActions.get(message.ActionID);
    if (!pendingAction || !pendingAction.expectEvents) {
      return;
    }

    if (message.Event === pendingAction.completeEvent) {
      clearTimeout(pendingAction.timeout);
      this.pendingActions.delete(message.ActionID);
      pendingAction.resolve({
        response: pendingAction.response,
        events: pendingAction.events,
        complete: message
      });
      return;
    }

    if (pendingAction.eventFilter(message)) {
      pendingAction.events.push(message);
    }
  }

  handleSocketError(error) {
    logger.error('AMI socket error', { error: error.message });
  }

  handleDisconnect() {
    if (!this.connected && !this.initialized) {
      return;
    }

    this.connected = false;
    this.socket = null;
    this.banner = null;

    for (const [actionId, pendingAction] of this.pendingActions.entries()) {
      clearTimeout(pendingAction.timeout);
      pendingAction.reject(new Error(`AMI socket disconnected during action: ${pendingAction.action}`));
      this.pendingActions.delete(actionId);
    }

    logger.warn('AMI socket disconnected');

    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    const reconnectDelayMs = pbxConfigService.getAmiConfig().reconnectDelayMs;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectAndLogin();
        this.emit('reconnected');
      } catch (error) {
        logger.error('AMI reconnect failed', { error: error.message });
        this.handleDisconnect();
      }
    }, reconnectDelayMs);
  }

  async close() {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (!this.socket) {
      return;
    }

    try {
      if (this.connected) {
        await this.sendAction('Logoff');
      }
    } catch (error) {
      logger.warn('AMI logoff failed during shutdown', { error: error.message });
    }

    this.socket.destroy();
    this.socket = null;
    this.connected = false;
    this.initialized = false;
  }
}

export default new AMIClient();
