/**
 * SIP Line Management Service
 * Handles creation, deletion, and management of SIP extensions
 * Only administrators can create/delete lines
 */

import logger from '../utils/logger.js';
import databaseService from './database-service.js';
import { v4 as uuidv4 } from 'uuid';

class SIPLineService {
  constructor() {
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    logger.info('SIP Line Service initialized');
  }

  /**
   * Create new SIP line (extension)
   * Only admin can create
   */
  async createSIPLine(createRequest) {
    const {
      extension,
      displayName,
      password,
      secret,
      accountCode,
      mailboxEmail,
      context,
      createdByUserId
    } = createRequest;

    const lineId = uuidv4();

    try {
      logger.info('Creating new SIP line', {
        lineId,
        extension,
        displayName,
        createdByUserId
      });

      // Check if extension already exists
      const existing = await databaseService.query(`
        SELECT Id FROM SipLines WHERE Extension = @extension AND Deleted = 0
      `, { extension });

      if (existing && existing.length > 0) {
        throw {
          statusCode: 409,
          message: `Extension ${extension} already exists`
        };
      }

      // Insert into database
      await databaseService.query(`
        INSERT INTO SipLines (
          LineId, Extension, DisplayName, Password, Secret, 
          AccountCode, MailboxEmail, Context, CreatedByUserId, 
          CreatedAt, Status, IsActive
        ) VALUES (
          @lineId, @extension, @displayName, @password, @secret,
          @accountCode, @mailboxEmail, @context, @createdByUserId,
          GETUTCDATE(), 'active', 1
        )
      `, {
        lineId,
        extension,
        displayName,
        password,
        secret,
        accountCode,
        mailboxEmail,
        context: context || 'from-internal'
      });

      // TODO: Call FreePBX API to create extension
      // await this.createExtensionInFreePBX({ extension, displayName, password });

      // Broadcast event
      this.io.to('sip').emit('sip:line-created', {
        lineId,
        extension,
        displayName,
        status: 'active',
        timestamp: new Date().toISOString()
      });

      logger.info('SIP line created successfully', {
        lineId,
        extension
      });

      return {
        lineId,
        extension,
        displayName,
        status: 'active',
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to create SIP line', {
        error: error.message,
        extension,
        lineId
      });
      throw error;
    }
  }

  /**
   * Delete SIP line (soft delete)
   * Only admin can delete
   */
  async deleteSIPLine(extension, deletedByUserId) {
    try {
      logger.info('Deleting SIP line', {
        extension,
        deletedByUserId
      });

      // Check if extension exists
      const existing = await databaseService.query(`
        SELECT LineId FROM SipLines WHERE Extension = @extension AND Deleted = 0
      `, { extension });

      if (!existing || existing.length === 0) {
        throw {
          statusCode: 404,
          message: `Extension ${extension} not found`
        };
      }

      const lineId = existing[0].LineId;

      // Soft delete (mark as deleted)
      await databaseService.query(`
        UPDATE SipLines 
        SET Deleted = 1, DeletedAt = GETUTCDATE(), DeletedByUserId = @deletedByUserId
        WHERE Extension = @extension
      `, {
        extension,
        deletedByUserId
      });

      // TODO: Call FreePBX API to delete extension
      // await this.deleteExtensionInFreePBX(extension);

      // Mark all associated calls as inactive
      await databaseService.query(`
        UPDATE OnlineExtensions 
        SET LastActivity = GETUTCDATE()
        WHERE Extension = @extension
      `, { extension });

      // Broadcast event
      this.io.to('sip').emit('sip:line-deleted', {
        extension,
        lineId,
        timestamp: new Date().toISOString()
      });

      logger.info('SIP line deleted successfully', {
        extension,
        lineId
      });

      return {
        success: true,
        extension,
        lineId,
        message: 'SIP line deleted successfully'
      };
    } catch (error) {
      logger.error('Failed to delete SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  /**
   * Get all SIP lines
   */
  async getSIPLines(filters = {}) {
    try {
      let query = `
        SELECT 
          LineId, Extension, DisplayName, Password, Secret,
          AccountCode, MailboxEmail, Context, Status, IsActive,
          CreatedByUserId, CreatedAt, DeletedAt, Deleted
        FROM SipLines
        WHERE Deleted = 0
      `;

      const params = {};

      if (filters.extension) {
        query += ` AND Extension LIKE @extension`;
        params.extension = `%${filters.extension}%`;
      }

      if (filters.status) {
        query += ` AND Status = @status`;
        params.status = filters.status;
      }

      if (filters.isActive !== undefined) {
        query += ` AND IsActive = @isActive`;
        params.isActive = filters.isActive ? 1 : 0;
      }

      query += ` ORDER BY Extension ASC`;
      query += ` OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

      params.offset = filters.offset || 0;
      params.limit = filters.limit || 100;

      const lines = await databaseService.query(query, params);

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total FROM SipLines
        WHERE Deleted = 0
        ${filters.extension ? ` AND Extension LIKE @extension` : ''}
        ${filters.status ? ` AND Status = @status` : ''}
        ${filters.isActive !== undefined ? ` AND IsActive = @isActive` : ''}
      `;

      const countResult = await databaseService.query(countQuery, params);

      return {
        lines,
        total: countResult[0]?.total || 0,
        limit: params.limit,
        offset: params.offset
      };
    } catch (error) {
      logger.error('Failed to get SIP lines', { error: error.message });
      throw error;
    }
  }

  /**
   * Get single SIP line details
   */
  async getSIPLineByExtension(extension) {
    try {
      const result = await databaseService.query(`
        SELECT 
          LineId, Extension, DisplayName, Password, Secret,
          AccountCode, MailboxEmail, Context, Status, IsActive,
          CreatedByUserId, CreatedAt
        FROM SipLines
        WHERE Extension = @extension AND Deleted = 0
      `, { extension });

      if (!result || result.length === 0) {
        throw {
          statusCode: 404,
          message: `SIP line ${extension} not found`
        };
      }

      return result[0];
    } catch (error) {
      logger.error('Failed to get SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  /**
   * Update SIP line
   */
  async updateSIPLine(extension, updateRequest) {
    try {
      const { displayName, password, accountCode, mailboxEmail, status } = updateRequest;

      logger.info('Updating SIP line', {
        extension,
        displayName,
        status
      });

      const updates = [];
      const params = { extension };

      if (displayName !== undefined) {
        updates.push(`DisplayName = @displayName`);
        params.displayName = displayName;
      }

      if (password !== undefined) {
        updates.push(`Password = @password`);
        params.password = password;
      }

      if (accountCode !== undefined) {
        updates.push(`AccountCode = @accountCode`);
        params.accountCode = accountCode;
      }

      if (mailboxEmail !== undefined) {
        updates.push(`MailboxEmail = @mailboxEmail`);
        params.mailboxEmail = mailboxEmail;
      }

      if (status !== undefined) {
        updates.push(`Status = @status`);
        params.status = status;
      }

      if (updates.length === 0) {
        throw {
          statusCode: 400,
          message: 'No fields to update'
        };
      }

      updates.push(`UpdatedAt = GETUTCDATE()`);

      const query = `
        UPDATE SipLines 
        SET ${updates.join(', ')}
        WHERE Extension = @extension AND Deleted = 0
      `;

      await databaseService.query(query, params);

      // Broadcast event
      this.io.to('sip').emit('sip:line-updated', {
        extension,
        ...updateRequest,
        timestamp: new Date().toISOString()
      });

      logger.info('SIP line updated successfully', { extension });

      return { success: true, extension };
    } catch (error) {
      logger.error('Failed to update SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  /**
   * Get SIP line statistics
   */
  async getSIPLineStats() {
    try {
      const stats = await databaseService.query(`
        SELECT 
          COUNT(*) as TotalLines,
          SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) as ActiveLines,
          SUM(CASE WHEN Status = 'inactive' THEN 1 ELSE 0 END) as InactiveLines,
          SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as OnlineLines
        FROM SipLines
        WHERE Deleted = 0
      `);

      return stats[0] || {
        TotalLines: 0,
        ActiveLines: 0,
        InactiveLines: 0,
        OnlineLines: 0
      };
    } catch (error) {
      logger.error('Failed to get SIP line stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate SIP line
   */
  async activateSIPLine(extension) {
    try {
      await databaseService.query(`
        UPDATE SipLines 
        SET IsActive = 1, Status = 'active', UpdatedAt = GETUTCDATE()
        WHERE Extension = @extension AND Deleted = 0
      `, { extension });

      this.io.to('sip').emit('sip:line-activated', {
        extension,
        timestamp: new Date().toISOString()
      });

      logger.info('SIP line activated', { extension });
      return { success: true, extension, status: 'active' };
    } catch (error) {
      logger.error('Failed to activate SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }

  /**
   * Deactivate SIP line
   */
  async deactivateSIPLine(extension) {
    try {
      await databaseService.query(`
        UPDATE SipLines 
        SET IsActive = 0, Status = 'inactive', UpdatedAt = GETUTCDATE()
        WHERE Extension = @extension AND Deleted = 0
      `, { extension });

      this.io.to('sip').emit('sip:line-deactivated', {
        extension,
        timestamp: new Date().toISOString()
      });

      logger.info('SIP line deactivated', { extension });
      return { success: true, extension, status: 'inactive' };
    } catch (error) {
      logger.error('Failed to deactivate SIP line', {
        error: error.message,
        extension
      });
      throw error;
    }
  }
}

export default new SIPLineService();
