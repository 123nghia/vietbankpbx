/**
 * SIP/AMI Service
 * Handles realtime call control and extension state via Asterisk AMI.
 */

import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import amiClient from './ami-client.js';
import pbxConfigService from './pbx-config-service.js';

class SIPService {
  constructor() {
    this.io = null;
    this.activeCalls = new Map();
    this.recentCalls = new Map();
    this.callsBySignalId = new Map();
    this.extensionStates = new Map();
    this.bound = false;
  }

  async initialize(io) {
    this.io = io;

    if (!this.bound) {
      amiClient.on('event', (event) => this.handleAmiEvent(event));
      amiClient.on('reconnected', async () => {
        logger.info('AMI client reconnected');
        await this.refreshExtensionStates().catch((error) => {
          logger.error('Failed to refresh extension states after reconnect', {
            error: error.message
          });
        });
      });
      this.bound = true;
    }

    try {
      await amiClient.initialize();
      await this.refreshExtensionStates();
    } catch (error) {
      logger.error('AMI is not connected. Service will continue in degraded mode and retry in background.', {
        error: error.message
      });
    }

    logger.info('SIP/AMI Service initialized');
  }

  async makeCall(fromExtension, toNumber, metadata = {}) {
    if (!this.isConnected()) {
      throw {
        statusCode: 503,
        message: 'Asterisk AMI is disconnected'
      };
    }

    const callId = metadata.callId || uuidv4();
    const endpointTech = metadata.endpointTech || pbxConfigService.getEndpointTechnology();
    const dialContext = metadata.context || pbxConfigService.getDialContext();
    const normalizedExtension = String(fromExtension);
    const normalizedNumber = String(toNumber);
    const timeout = String(metadata.timeout || parseInt(process.env.CALL_ORIGINATE_TIMEOUT_MS || '30000', 10));

    const call = {
      callId,
      fromExtension: normalizedExtension,
      toNumber: normalizedNumber,
      direction: 'outbound',
      status: 'initiating',
      createdAt: new Date().toISOString(),
      answeredAt: null,
      endedAt: null,
      waitTime: 0,
      talkTime: 0,
      channels: new Set(),
      metadata
    };

    this.activeCalls.set(callId, call);
    this.registerSignalId(callId, callId);

    this.emitCallEvent('call:created', call);

    const variables = [
      `__CRM_CALL_ID=${callId}`,
      `__CRM_TARGET_NUMBER=${normalizedNumber}`,
      metadata.employeeId ? `__CRM_EMPLOYEE_ID=${metadata.employeeId}` : null,
      metadata.candidateId ? `__CRM_CANDIDATE_ID=${metadata.candidateId}` : null
    ].filter(Boolean);

    try {
      const response = await amiClient.sendAction('Originate', {
        ActionID: callId,
        Channel: `${endpointTech}/${normalizedExtension}`,
        Context: dialContext,
        Exten: normalizedNumber,
        Priority: '1',
        Timeout: timeout,
        CallerID: metadata.callerId || normalizedExtension,
        Account: callId,
        Async: 'true',
        ChannelId: callId,
        Variable: variables
      });

      call.status = response.Response === 'Success' ? 'ringing' : 'failed';
      call.lastAmiResponse = response.Message || null;

      logger.info('Originate action submitted', {
        callId,
        fromExtension: normalizedExtension,
        toNumber: normalizedNumber,
        response: response.Response
      });

      return callId;
    } catch (error) {
      call.status = 'failed';
      call.endedAt = new Date().toISOString();
      this.storeRecentCall(call);
      this.activeCalls.delete(callId);
      this.cleanupCallSignals(call);

      logger.error('Failed to originate call', {
        error: error.message,
        callId,
        fromExtension: normalizedExtension,
        toNumber: normalizedNumber
      });

      throw error;
    }
  }

  async endCall(callId, reason = 'normal') {
    if (!this.isConnected()) {
      throw {
        statusCode: 503,
        message: 'Asterisk AMI is disconnected'
      };
    }

    const call = this.activeCalls.get(callId);

    if (!call) {
      throw {
        statusCode: 404,
        message: 'Active call not found'
      };
    }

    const channelList = Array.from(call.channels || []);
    if (call.channel && !channelList.includes(call.channel)) {
      channelList.push(call.channel);
    }
    if (call.destinationChannel && !channelList.includes(call.destinationChannel)) {
      channelList.push(call.destinationChannel);
    }

    if (!channelList.length) {
      throw {
        statusCode: 409,
        message: 'Call exists but AMI channel is no longer available'
      };
    }

    await Promise.all(
      channelList.map((channel) =>
        amiClient.sendAction('Hangup', {
          Channel: channel,
          Cause: '16'
        }).catch((error) => {
          logger.warn('AMI hangup failed for channel', {
            channel,
            callId,
            error: error.message
          });
        })
      )
    );

    logger.info('AMI hangup sent', { callId, reason, channels: channelList.length });

    return {
      success: true,
      callId,
      reason
    };
  }

  getCallSnapshot(callId) {
    const activeCall = this.activeCalls.get(callId);
    if (activeCall) {
      return this.serializeCall(activeCall);
    }

    return this.recentCalls.get(callId) || null;
  }

  getActiveCalls() {
    return Array.from(this.activeCalls.values()).map((call) => this.serializeCall(call));
  }

  getActiveCallsCount() {
    return this.activeCalls.size;
  }

  isConnected() {
    return amiClient.connected === true;
  }

  async getOnlineExtensions(extensions = null) {
    if (Array.isArray(extensions)) {
      if (extensions.length === 0) {
        return [];
      }

      const states = await Promise.all(
        extensions.map((extension) =>
          this.getExtensionState(extension).catch(() => ({
            extension,
            status: 'unknown',
            statusCode: -1,
            rawStatus: 'Unknown',
            device: null,
            hint: null,
            lastUpdate: new Date().toISOString()
          }))
        )
      );

      return states.filter((state) => !['unknown', 'unavailable'].includes(state.status));
    }

    const result = await amiClient.collectActionEvents('ExtensionStateList', {}, {
      completeEvent: 'ExtensionStateListComplete',
      eventFilter: (event) => event.Event === 'ExtensionStatus'
    });

    const states = result.events
      .map((event) => this.normalizeExtensionState(event))
      .filter((state) => Boolean(state.extension));

    states.forEach((state) => {
      this.extensionStates.set(state.extension, state);
    });

    return states.filter((state) => !['unknown', 'unavailable'].includes(state.status));
  }

  async getExtensionState(extension) {
    const response = await amiClient.sendAction('ExtensionState', {
      Exten: String(extension),
      Context: pbxConfigService.getHintContext()
    });

    const state = this.normalizeExtensionState({
      ...response,
      Exten: String(extension)
    });

    this.extensionStates.set(state.extension, state);
    return state;
  }

  async refreshExtensionStates() {
    const states = await this.getOnlineExtensions();
    logger.info('Extension states refreshed', { count: states.length });
  }

  normalizeExtensionState(payload) {
    const extension = payload.Exten || this.extractExtensionFromChannel(payload.Channel) || null;
    const statusCode = Number(payload.Status ?? payload.ExtensionStatus ?? -1);
    const rawStatus = payload.StatusText || payload.ExtensionStatusText || this.mapExtensionStatusCode(statusCode);

    return {
      extension,
      status: this.normalizeExtensionStatus(rawStatus),
      statusCode,
      rawStatus,
      hint: payload.Hint || null,
      device: payload.Device || null,
      lastUpdate: new Date().toISOString()
    };
  }

  handleAmiEvent(event) {
    switch (event.Event) {
      case 'OriginateResponse':
        this.handleOriginateResponse(event);
        break;
      case 'DialBegin':
        this.handleDialBegin(event);
        break;
      case 'DialEnd':
        this.handleDialEnd(event);
        break;
      case 'BridgeEnter':
        this.handleBridgeEnter(event);
        break;
      case 'Hangup':
        this.handleHangup(event);
        break;
      case 'DeviceStateChange':
        this.handleDeviceStateChange(event);
        break;
      case 'ExtensionStatus':
        this.handleExtensionStatus(event);
        break;
      default:
        break;
    }
  }

  handleOriginateResponse(event) {
    const callId = event.ActionID;
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    call.status = event.Response === 'Success' ? 'ringing' : 'failed';
    call.channel = event.Channel || call.channel;
    call.uniqueId = event.Uniqueid || call.uniqueId;

    this.registerSignalId(event.Uniqueid, callId);
    this.registerSignalId(event.Channel, callId);

    if (call.status === 'failed') {
      call.endedAt = new Date().toISOString();
      this.storeRecentCall(call);
      this.activeCalls.delete(callId);
      this.cleanupCallSignals(call);
    }

    this.emitCallEvent('call:status-updated', call, {
      amiEvent: 'OriginateResponse'
    });
  }

  handleDialBegin(event) {
    const callId = this.findCallId(event);
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    call.status = 'ringing';
    call.channel = event.Channel || call.channel;
    call.destinationChannel = event.DestChannel || call.destinationChannel;

    [
      event.Channel,
      event.DestChannel,
      event.Uniqueid,
      event.DestUniqueid,
      event.Linkedid,
      event.DestLinkedid
    ].forEach((value) => this.registerSignalId(value, callId));

    if (event.Channel) {
      call.channels.add(event.Channel);
    }
    if (event.DestChannel) {
      call.channels.add(event.DestChannel);
    }

    this.emitCallEvent('call:status-updated', call, {
      amiEvent: 'DialBegin'
    });
  }

  handleDialEnd(event) {
    const callId = this.findCallId(event);
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    call.lastDialStatus = event.DialStatus || null;

    if (call.status !== 'connected' && event.DialStatus) {
      call.status = this.mapDialStatus(event.DialStatus);
    }

    this.emitCallEvent('call:status-updated', call, {
      amiEvent: 'DialEnd',
      dialStatus: event.DialStatus || null
    });
  }

  handleBridgeEnter(event) {
    const callId = this.findCallId(event);
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    if (!call.answeredAt) {
      const now = new Date();
      call.answeredAt = now.toISOString();
      call.waitTime = Math.max(
        Math.round((now.getTime() - new Date(call.createdAt).getTime()) / 1000),
        0
      );
    }

    call.status = 'connected';

    [
      event.Channel,
      event.Uniqueid,
      event.Linkedid,
      event.SwapUniqueid
    ].forEach((value) => this.registerSignalId(value, callId));

    if (event.Channel) {
      call.channels.add(event.Channel);
    }

    this.emitCallEvent('call:status-updated', call, {
      amiEvent: 'BridgeEnter'
    });
  }

  handleHangup(event) {
    const callId = this.findCallId(event);
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    const endedAt = new Date();
    call.endedAt = endedAt.toISOString();
    call.talkTime = call.answeredAt
      ? Math.max(
          Math.round((endedAt.getTime() - new Date(call.answeredAt).getTime()) / 1000),
          0
        )
      : 0;
    call.duration = Math.max(
      Math.round((endedAt.getTime() - new Date(call.createdAt).getTime()) / 1000),
      0
    );
    call.status = this.mapFinalStatus(call, event);
    call.hangupCause = event.Cause || null;
    call.hangupCauseText = event['Cause-txt'] || event.CauseTxt || null;

    this.storeRecentCall(call);
    this.activeCalls.delete(callId);
    this.cleanupCallSignals(call);

    this.emitCallEvent('call:status-updated', call, {
      amiEvent: 'Hangup'
    });
  }

  handleDeviceStateChange(event) {
    const extension = this.extractExtensionFromDevice(event.Device);
    if (!extension) {
      return;
    }

    const state = {
      extension,
      status: this.normalizeExtensionStatus(event.State),
      statusCode: null,
      rawStatus: event.State,
      hint: null,
      device: event.Device,
      lastUpdate: new Date().toISOString()
    };

    this.extensionStates.set(extension, state);

    if (this.io) {
      this.io.to('statistics').emit('extension:status-updated', state);
    }
  }

  handleExtensionStatus(event) {
    const state = this.normalizeExtensionState(event);
    if (!state.extension) {
      return;
    }

    this.extensionStates.set(state.extension, state);

    if (this.io) {
      this.io.to('statistics').emit('extension:status-updated', state);
    }
  }

  findCallId(event) {
    const candidates = [
      event.ActionID,
      event.Uniqueid,
      event.Linkedid,
      event.DestUniqueid,
      event.DestLinkedid,
      event.Channel,
      event.DestChannel,
      event.SwapUniqueid
    ];

    for (const candidate of candidates) {
      if (candidate && this.callsBySignalId.has(candidate)) {
        return this.callsBySignalId.get(candidate);
      }
    }

    return null;
  }

  registerSignalId(signalId, callId) {
    if (!signalId || !callId) {
      return;
    }

    this.callsBySignalId.set(signalId, callId);
  }

  cleanupCallSignals(call) {
    const signalIds = new Set([
      call.callId,
      call.channel,
      call.destinationChannel,
      call.uniqueId,
      call.linkedId,
      ...(call.channels || [])
    ].filter(Boolean));

    for (const signalId of signalIds) {
      this.callsBySignalId.delete(signalId);
    }
  }

  extractExtensionFromDevice(device) {
    if (!device) {
      return null;
    }

    const match = String(device).match(/(?:PJSIP|SIP|Local)\/([^@\-\/]+)/i);
    return match ? match[1] : null;
  }

  extractExtensionFromChannel(channel) {
    if (!channel) {
      return null;
    }

    const match = String(channel).match(/(?:PJSIP|SIP|Local)\/([^@\-\/]+)/i);
    return match ? match[1] : null;
  }

  mapDialStatus(dialStatus) {
    const normalized = String(dialStatus || '').toUpperCase();

    switch (normalized) {
      case 'ANSWER':
      case 'ANSWERED':
        return 'connected';
      case 'BUSY':
        return 'busy';
      case 'NOANSWER':
      case 'NO ANSWER':
        return 'no_answer';
      case 'CANCEL':
        return 'cancelled';
      case 'CHANUNAVAIL':
      case 'CONGESTION':
      case 'FAILED':
        return 'failed';
      default:
        return 'ringing';
    }
  }

  mapFinalStatus(call, event) {
    if (call.answeredAt) {
      return 'completed';
    }

    const hangupText = String(event['Cause-txt'] || event.CauseTxt || '').toLowerCase();
    const dialStatus = String(call.lastDialStatus || '').toLowerCase();

    if (hangupText.includes('busy') || dialStatus === 'busy') {
      return 'busy';
    }

    if (hangupText.includes('no answer') || dialStatus === 'noanswer' || dialStatus === 'no answer') {
      return 'no_answer';
    }

    if (hangupText.includes('cancel') || dialStatus === 'cancel') {
      return 'cancelled';
    }

    if (hangupText.includes('congestion') || hangupText.includes('unavail') || dialStatus === 'failed') {
      return 'failed';
    }

    return call.status === 'ringing' ? 'no_answer' : (call.status || 'failed');
  }

  mapExtensionStatusCode(statusCode) {
    switch (statusCode) {
      case 0:
        return 'Idle';
      case 1:
        return 'In Use';
      case 2:
        return 'Busy';
      case 4:
        return 'Unavailable';
      case 8:
        return 'Ringing';
      case 16:
        return 'On Hold';
      case 17:
        return 'In Use';
      default:
        return 'Unknown';
    }
  }

  normalizeExtensionStatus(statusText) {
    const normalized = String(statusText || 'unknown').toLowerCase().replace(/\s+/g, '_');

    switch (normalized) {
      case 'idle':
      case 'not_inuse':
      case 'available':
        return 'available';
      case 'in_use':
      case 'inuse':
        return 'in_use';
      case 'busy':
        return 'busy';
      case 'ringing':
        return 'ringing';
      case 'on_hold':
      case 'hold':
        return 'on_hold';
      case 'unavailable':
        return 'unavailable';
      case 'invalid':
      case 'unknown':
      default:
        return 'unknown';
    }
  }

  storeRecentCall(call) {
    const serialized = this.serializeCall(call);
    this.recentCalls.set(serialized.callId, serialized);

    setTimeout(() => {
      this.recentCalls.delete(serialized.callId);
    }, parseInt(process.env.RECENT_CALL_CACHE_MS || '900000', 10));
  }

  serializeCall(call) {
    return {
      ...call,
      channels: Array.from(call.channels || [])
    };
  }

  emitCallEvent(eventName, call, extra = {}) {
    if (!this.io) {
      return;
    }

    this.io.to('calls').emit(eventName, {
      ...this.serializeCall(call),
      ...extra,
      timestamp: new Date().toISOString()
    });
  }

  async close() {
    await amiClient.close();
  }
}

export default new SIPService();
