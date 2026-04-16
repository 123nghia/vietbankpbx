/**
 * SIP Service - Handles SIP connections with FreePBX
 */

import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import databaseService from './database-service.js';

class SIPService {
  constructor() {
    this.sipClient = null;
    this.registrations = new Map(); // Map of Extension -> Registration
    this.activeCalls = new Map(); // Map of CallId -> Call info
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    logger.info('SIP Service initializing...');

    // In production, use SIP.js or node-sip library
    // For now, we'll create a mock implementation with AMI (Asterisk Manager Interface)
    // This will be enhanced with actual SIP client library

    try {
      // TODO: Connect to FreePBX AMI interface at 192.168.1.9:5038
      // TODO: Subscribe to AMI events (VarSet, Newchannel, Hangup, etc.)
      
      logger.info('SIP Service initialized');
    } catch (error) {
      logger.error('SIP Service initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Make outbound call (Auto-dial)
   * @param {string} fromExtension - Calling extension
   * @param {string} toNumber - Destination number
   */
  async makeCall(fromExtension, toNumber, metadata = {}) {
    const callId = uuidv4();
    
    try {
      logger.info('Making outbound call', {
        callId,
        fromExtension,
        toNumber
      });

      // Store call in database
      await databaseService.query(`
        INSERT INTO CallLogs (
          CallId, FromExtension, ToNumber, Direction, Status, 
          StartTime, WaitTime, Metadata
        ) VALUES (
          @callId, @fromExtension, @toNumber, 'outbound', 'ringing',
          GETUTCDATE(), 0, @metadata
        )
      `, {
        callId,
        fromExtension,
        toNumber,
        metadata: JSON.stringify(metadata)
      });

      // Store in active calls
      this.activeCalls.set(callId, {
        callId,
        fromExtension,
        toNumber,
        direction: 'outbound',
        startTime: new Date(),
        status: 'ringing'
      });

      // Emit via WebSocket
      this.io.to('calls').emit('call:created', {
        callId,
        fromExtension,
        toNumber,
        direction: 'outbound',
        status: 'ringing',
        timestamp: new Date().toISOString()
      });

      // TODO: Actually make the call via AMI/SIP
      // originate exten to FromExtension with variables, call ToNumber

      return callId;
    } catch (error) {
      logger.error('Failed to make call', {
        error: error.message,
        callId,
        fromExtension,
        toNumber
      });
      throw error;
    }
  }

  /**
   * Handle incoming call event
   */
  async handleIncomingCall(fromNumber, toExtension, channelId) {
    const callId = uuidv4();
    const startTime = new Date();

    try {
      logger.info('Incoming call received', {
        callId,
        fromNumber,
        toExtension
      });

      await databaseService.query(`
        INSERT INTO CallLogs (
          CallId, FromExtension, ToExtension, Direction, Status, StartTime
        ) VALUES (
          @callId, @fromNumber, @toExtension, 'inbound', 'ringing', GETUTCDATE()
        )
      `, {
        callId,
        fromNumber,
        toExtension
      });

      this.activeCalls.set(callId, {
        callId,
        fromNumber,
        toExtension,
        direction: 'inbound',
        status: 'ringing',
        startTime,
        channelId
      });

      this.io.to('calls').emit('call:incoming', {
        callId,
        fromNumber,
        toExtension,
        direction: 'inbound',
        status: 'ringing',
        timestamp: startTime.toISOString()
      });

      return callId;
    } catch (error) {
      logger.error('Failed to handle incoming call', {
        error: error.message,
        callId,
        fromNumber,
        toExtension
      });
      throw error;
    }
  }

  /**
   * Update call status
   */
  async updateCallStatus(callId, status, additionalInfo = {}) {
    try {
      const call = this.activeCalls.get(callId);
      if (!call) {
        logger.warn('Call not found in active calls', { callId });
        return;
      }

      call.status = status;

      // Update database
      if (status === 'completed' || status === 'failed' || status === 'abandoned') {
        const endTime = new Date();
        const duration = Math.round((endTime - call.startTime) / 1000);

        await databaseService.query(`
          UPDATE CallLogs 
          SET Status = @status, EndTime = @endTime, Duration = @duration
          WHERE CallId = @callId
        `, {
          callId,
          status,
          endTime,
          duration
        });

        this.activeCalls.delete(callId);
      } else {
        await databaseService.query(`
          UPDATE CallLogs 
          SET Status = @status
          WHERE CallId = @callId
        `, {
          callId,
          status
        });
      }

      // Broadcast status update
      this.io.to('calls').emit('call:status-updated', {
        callId,
        status,
        ...additionalInfo,
        timestamp: new Date().toISOString()
      });

      logger.info('Call status updated', { callId, status });
    } catch (error) {
      logger.error('Failed to update call status', {
        error: error.message,
        callId,
        status
      });
    }
  }

  /**
   * Get list of online extensions
   */
  async getOnlineExtensions() {
    try {
      const extensions = await databaseService.query(`
        SELECT Extension, Status, CurrentCallId, OnlineSince, Metadata
        FROM OnlineExtensions
        WHERE OnlineSince > DATEADD(MINUTE, -5, GETUTCDATE())
        ORDER BY Extension
      `);

      return extensions;
    } catch (error) {
      logger.error('Failed to get online extensions', { error: error.message });
      return [];
    }
  }

  /**
   * Update extension status
   */
  async updateExtensionStatus(extension, status, callId = null) {
    try {
      await databaseService.query(`
        MERGE INTO OnlineExtensions AS target
        USING (SELECT @extension AS Extension) AS source
        ON target.Extension = source.Extension
        WHEN MATCHED THEN
          UPDATE SET Status = @status, CurrentCallId = @callId, LastActivity = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (Extension, Status, CurrentCallId, OnlineSince, LastActivity)
          VALUES (@extension, @status, @callId, GETUTCDATE(), GETUTCDATE());
      `, {
        extension,
        status,
        callId
      });

      this.io.to('statistics').emit('extension:status-updated', {
        extension,
        status,
        callId,
        timestamp: new Date().toISOString()
      });

      logger.debug('Extension status updated', { extension, status });
    } catch (error) {
      logger.error('Failed to update extension status', {
        error: error.message,
        extension,
        status
      });
    }
  }

  async close() {
    logger.info('Closing SIP Service...');
    // Cleanup
  }
}

export default new SIPService();
