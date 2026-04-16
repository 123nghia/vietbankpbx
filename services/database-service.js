/**
 * Database Service - SQL Server Integration
 * Stores call logs, recording metadata, and statistics
 */

import sql from 'mssql';
import logger from '../utils/logger.js';

class DatabaseService {
  constructor() {
    this.pool = null;
    this.config = {
      server: process.env.DB_SERVER || '.',
      database: process.env.DB_DATABASE || 'crmHuman',
      authentication: {
        type: 'default',
        options: {
          userName: process.env.DB_USER || 'sa',
          password: process.env.DB_PASSWORD || ''
        }
      },
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableKeepAlive: true
      },
      pool: {
        max: parseInt(process.env.DB_POOL_SIZE || 10),
        min: 2,
        idleTimeoutMillis: 30000
      }
    };
  }

  async initialize() {
    try {
      this.pool = new sql.ConnectionPool(this.config);
      await this.pool.connect();
      logger.info('Database connected', { server: this.config.server });

      // Create tables if not exist
      await this.createTablesIfNotExist();
    } catch (error) {
      logger.error('Database connection failed', { error: error.message });
      throw error;
    }
  }

  async createTablesIfNotExist() {
    try {
      const request = this.pool.request();

      // Call Logs Table
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CallLogs')
        CREATE TABLE CallLogs (
          Id INT PRIMARY KEY IDENTITY(1,1),
          CallId NVARCHAR(100) UNIQUE NOT NULL,
          FromExtension NVARCHAR(50) NOT NULL,
          ToExtension NVARCHAR(50),
          ToNumber NVARCHAR(50),
          Direction NVARCHAR(20), -- inbound, outbound, internal
          Status NVARCHAR(50), -- ringing, connected, completed, missed, failed, abandoned
          StartTime DATETIME2 NOT NULL,
          EndTime DATETIME2,
          Duration INT, -- seconds
          WaitTime INT, -- seconds
          RecordingId NVARCHAR(100),
          Metadata NVARCHAR(MAX),
          CreatedAt DATETIME2 DEFAULT GETUTCDATE()
        );
        CREATE INDEX IX_CallLogs_FromExtension ON CallLogs(FromExtension);
        CREATE INDEX IX_CallLogs_Direction ON CallLogs(Direction);
        CREATE INDEX IX_CallLogs_Status ON CallLogs(Status);
        CREATE INDEX IX_CallLogs_StartTime ON CallLogs(StartTime);
      `);

      // Recordings Table
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Recordings')
        CREATE TABLE Recordings (
          Id INT PRIMARY KEY IDENTITY(1,1),
          RecordingId NVARCHAR(100) UNIQUE NOT NULL,
          CallId NVARCHAR(100) NOT NULL,
          FilePath NVARCHAR(MAX) NOT NULL,
          FileSize BIGINT,
          FileFormat NVARCHAR(20),
          Duration INT, -- seconds
          FromExtension NVARCHAR(50),
          ToExtension NVARCHAR(50),
          ToNumber NVARCHAR(50),
          Direction NVARCHAR(20),
          RecordedAt DATETIME2 NOT NULL,
          ExpiresAt DATETIME2,
          Metadata NVARCHAR(MAX),
          CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (CallId) REFERENCES CallLogs(CallId) ON DELETE CASCADE
        );
        CREATE INDEX IX_Recordings_RecordingId ON Recordings(RecordingId);
        CREATE INDEX IX_Recordings_CallId ON Recordings(CallId);
        CREATE INDEX IX_Recordings_RecordedAt ON Recordings(RecordedAt);
      `);

      // Call Statistics Table
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CallStatistics')
        CREATE TABLE CallStatistics (
          Id INT PRIMARY KEY IDENTITY(1,1),
          StatDate DATE NOT NULL,
          Extension NVARCHAR(50) NOT NULL,
          TotalCalls INT DEFAULT 0,
          InboundCalls INT DEFAULT 0,
          OutboundCalls INT DEFAULT 0,
          InternalCalls INT DEFAULT 0,
          CompletedCalls INT DEFAULT 0,
          MissedCalls INT DEFAULT 0,
          FailedCalls INT DEFAULT 0,
          AverageDuration INT, -- seconds
          TotalDuration INT, -- seconds
          AverageWaitTime INT, -- seconds
          RecordedCalls INT DEFAULT 0,
          UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
          UNIQUE (StatDate, Extension)
        );
        CREATE INDEX IX_CallStatistics_StatDate ON CallStatistics(StatDate);
        CREATE INDEX IX_CallStatistics_Extension ON CallStatistics(Extension);
      `);

      // Online Extensions Table (Real-time tracking)
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OnlineExtensions')
        CREATE TABLE OnlineExtensions (
          Id INT PRIMARY KEY IDENTITY(1,1),
          Extension NVARCHAR(50) UNIQUE NOT NULL,
          Status NVARCHAR(50), -- available, busy, away, dnd
          CurrentCallId NVARCHAR(100),
          OnlineSince DATETIME2 NOT NULL,
          LastActivity DATETIME2 NOT NULL,
          Metadata NVARCHAR(MAX)
        );
        CREATE INDEX IX_OnlineExtensions_Extension ON OnlineExtensions(Extension);
      `);

      // SIP Lines Table
      await request.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SipLines')
        CREATE TABLE SipLines (
          Id INT PRIMARY KEY IDENTITY(1,1),
          LineId NVARCHAR(100) UNIQUE NOT NULL,
          Extension NVARCHAR(50) UNIQUE NOT NULL,
          DisplayName NVARCHAR(255) NOT NULL,
          Password NVARCHAR(255) NOT NULL,
          Secret NVARCHAR(255),
          AccountCode NVARCHAR(100),
          MailboxEmail NVARCHAR(255),
          Context NVARCHAR(50) DEFAULT 'from-internal',
          Status NVARCHAR(50) DEFAULT 'active', -- active, inactive, suspended
          IsActive BIT DEFAULT 1,
          CreatedByUserId NVARCHAR(100),
          CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
          UpdatedAt DATETIME2,
          DeletedByUserId NVARCHAR(100),
          DeletedAt DATETIME2,
          Deleted BIT DEFAULT 0,
          Metadata NVARCHAR(MAX)
        );
        CREATE INDEX IX_SipLines_Extension ON SipLines(Extension);
        CREATE INDEX IX_SipLines_Status ON SipLines(Status);
        CREATE INDEX IX_SipLines_Deleted ON SipLines(Deleted);
        CREATE INDEX IX_SipLines_CreatedAt ON SipLines(CreatedAt);
      `);

      logger.info('Database tables initialized');
    } catch (error) {
      logger.error('Failed to create tables', { error: error.message });
      throw error;
    }
  }

  async query(sql, params = {}) {
    try {
      const request = this.pool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.query(sql);
      return result.recordset;
    } catch (error) {
      logger.error('Query execution failed', { error: error.message, sql });
      throw error;
    }
  }

  async execute(procedureName, params = {}) {
    try {
      const request = this.pool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);
      return result.recordset;
    } catch (error) {
      logger.error('Procedure execution failed', { error: error.message, procedureName });
      throw error;
    }
  }

  async close() {
    try {
      if (this.pool) {
        await this.pool.close();
        logger.info('Database connection closed');
      }
    } catch (error) {
      logger.error('Failed to close database connection', { error: error.message });
    }
  }
}

export default new DatabaseService();
