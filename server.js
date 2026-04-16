/**
 * FreePBX Microservice - Main Server
 * Handles SIP connections, call management, recordings, and statistics
 * Deployed at 192.168.1.9:3000
 */

import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
dotenv.config();

// Import routes and services
import sipService from './services/sip-service.js';
import sipLineService from './services/sip-line-service.js';
import callManager from './services/call-manager.js';
import recordingService from './services/recording-service.js';
import statisticsService from './services/statistics-service.js';
import databaseService from './services/database-service.js';
import logger from './utils/logger.js';

// Routes
import callRoutes from './routes/call-routes.js';
import sipLineRoutes from './routes/sip-line-routes.js';
import recordingRoutes from './routes/recording-routes.js';
import statisticsRoutes from './routes/statistics-routes.js';
import healthRoutes from './routes/health-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'http://192.168.1.33',
      'http://localhost:3000',
      'http://localhost:3001'
    ],
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/calls', callRoutes(io));
app.use('/api/sip', sipLineRoutes(io));
app.use('/api/recordings', recordingRoutes);
app.use('/api/statistics', statisticsRoutes);

// Serve recording files
app.use('/recordings', express.static(process.env.RECORDING_STORAGE_PATH || '/app/recordings'));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    requestId: req.id
  });
});

// WebSocket events
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Subscribe to call events
  socket.on('subscribe:calls', () => {
    socket.join('calls');
    logger.info('Client subscribed to call events', { socketId: socket.id });
  });

  // Subscribe to statistics
  socket.on('subscribe:statistics', () => {
    socket.join('statistics');
    logger.info('Client subscribed to statistics', { socketId: socket.id });
  });

  // Subscribe to recordings
  socket.on('subscribe:recordings', () => {
    socket.join('recordings');
    logger.info('Client subscribed to recording events', { socketId: socket.id });
  });

  // Subscribe to SIP line events
  socket.on('subscribe:sip', () => {
    socket.join('sip');
    logger.info('Client subscribed to SIP events', { socketId: socket.id });
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
});

// Initialize services
async function initializeServices() {
  try {
    // Initialize database
    logger.info('Initializing database service...');
    await databaseService.initialize();

    // Initialize SIP service
    logger.info('Initializing SIP service...');
    await sipService.initialize(io);

    // Initialize SIP Line service
    logger.info('Initializing SIP Line service...');
    await sipLineService.initialize(io);

    // Initialize call manager
    logger.info('Initializing call manager...');
    await callManager.initialize(io);

    // Initialize recording service
    logger.info('Initializing recording service...');
    await recordingService.initialize();

    // Initialize statistics service
    logger.info('Initializing statistics service...');
    await statisticsService.initialize(io);

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Start server
const PORT = process.env.SERVICE_PORT || 3000;
const HOST = process.env.SERVICE_HOST || '0.0.0.0';

server.listen(PORT, HOST, async () => {
  logger.info(`FreePBX Microservice running on ${HOST}:${PORT}`);
  await initializeServices();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    await databaseService.close();
    await sipService.close();
    logger.info('Server shut down');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(async () => {
    await databaseService.close();
    await sipService.close();
    logger.info('Server shut down');
    process.exit(0);
  });
});

// Export for testing
export { app, server, io };
