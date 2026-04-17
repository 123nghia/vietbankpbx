/**
 * FreePBX PBX Adapter
 * Exposes CRM-facing APIs backed directly by FreePBX/Asterisk on 192.168.1.9.
 */

import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';

import sipService from './services/sip-service.js';
import sipLineService from './services/sip-line-service.js';
import callManager from './services/call-manager.js';
import recordingService from './services/recording-service.js';
import statisticsService from './services/statistics-service.js';
import pbxDataService from './services/pbx-data-service.js';
import pbxConfigService from './services/pbx-config-service.js';
import logger from './utils/logger.js';

import callRoutes from './routes/call-routes.js';
import sipLineRoutes from './routes/sip-line-routes.js';
import recordingRoutes from './routes/recording-routes.js';
import statisticsRoutes from './routes/statistics-routes.js';
import healthRoutes from './routes/health-routes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'http://192.168.1.3',
      'http://localhost:3000',
      'http://localhost:3001'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(helmet({
  crossOriginResourcePolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use((req, res, next) => {
  const trustedAdminIps = (process.env.TRUSTED_ADMIN_IPS ||
    '127.0.0.1,::1,::ffff:127.0.0.1,192.168.1.3,::ffff:192.168.1.3')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const requestIp = req.ip || req.connection?.remoteAddress || '';
  const userId = req.get('x-user-id') || req.body?.userId || req.body?.createdByUserId || null;
  const role = req.get('x-user-role') || req.get('x-role') || req.body?.userRole || null;
  const name = req.get('x-user-name') || req.body?.userName || null;
  const trustedInternalAdmin = trustedAdminIps.includes(requestIp);

  if (userId || role || name || trustedInternalAdmin) {
    req.user = {
      userId: userId || (trustedInternalAdmin ? 'trusted-internal-admin' : null),
      role: role || (trustedInternalAdmin ? 'admin' : null),
      name
    };
  }

  next();
});

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.userId || null
  });
  next();
});

app.use('/api/health', healthRoutes);
app.use('/api/calls', callRoutes(io));
app.use('/api/sip', sipLineRoutes(io));
app.use('/api/recordings', recordingRoutes);
app.use('/api/statistics', statisticsRoutes);

app.use('/recordings', express.static(pbxConfigService.getRecordingRoot()));

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

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  socket.on('subscribe:calls', () => socket.join('calls'));
  socket.on('subscribe:statistics', () => socket.join('statistics'));
  socket.on('subscribe:recordings', () => socket.join('recordings'));
  socket.on('subscribe:sip', () => socket.join('sip'));
  socket.on('disconnect', () => logger.info('Client disconnected', { socketId: socket.id }));
});

async function initializeServices() {
  try {
    logger.info('Initializing PBX CDR data service...');
    await pbxDataService.initialize();

    logger.info('Initializing SIP/AMI service...');
    await sipService.initialize(io);

    logger.info('Initializing managed line service...');
    await sipLineService.initialize(io);

    logger.info('Initializing call manager...');
    await callManager.initialize(io);

    logger.info('Initializing recording service...');
    await recordingService.initialize();

    logger.info('Initializing statistics service...');
    await statisticsService.initialize(io);

    logger.info('All PBX adapter services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

const PORT = process.env.SERVICE_PORT || 3000;
const HOST = process.env.SERVICE_HOST || '0.0.0.0';

async function startServer() {
  await initializeServices();

  server.listen(PORT, HOST, () => {
    logger.info(`FreePBX adapter running on ${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    await Promise.allSettled([
      pbxDataService.close(),
      sipService.close()
    ]);
    logger.info('Server shut down');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(async () => {
    await Promise.allSettled([
      pbxDataService.close(),
      sipService.close()
    ]);
    logger.info('Server shut down');
    process.exit(0);
  });
});

export { app, server, io };
