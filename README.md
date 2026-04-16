# README.md - FreePBX Microservice

<div align="center">

# 📞 FreePBX Microservice for crmHuman

> Node.js microservice for FreePBX integration with call management, recording handling, and real-time statistics

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?logo=node.js)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green)]()

</div>

## 🎯 Features

### 📞 Call Management
- ✅ **Auto-dial** - Automatic outbound calls
- ✅ **Incoming Calls** - Real-time incoming call tracking
- ✅ **Call State Management** - Ringing, connected, completed, failed, missed
- ✅ **Call History** - Detailed call logs with filtering
- ✅ **Call Duration & Wait Time** - Metrics for each call

### 🔊 Recording Management
- ✅ **Recording Storage** - Centralized recording file storage
- ✅ **Metadata Management** - Complete recording information
- ✅ **Download/Stream** - Easy access to recorded calls
- ✅ **Recording Filtering** - Search by extension, date, direction

### 📊 Statistics & Reporting
- ✅ **Real-time Metrics** - Today's call statistics
- ✅ **Date Range Reports** - Historical analysis
- ✅ **Extension Analytics** - Per-extension performance
- ✅ **System Dashboard** - Overall system statistics
- ✅ **Online Extensions** - Real-time SIP availability

### 🔄 Real-time Updates
- ✅ **WebSocket Events** - Live call notifications
- ✅ **Status Updates** - Call state changes
- ✅ **Statistics Push** - Automatic metric updates
- ✅ **Extension Tracking** - Online status monitoring

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│        crmHuman System              │
│       (192.168.1.33)                │
│  REST API + WebSocket Client        │
└────────────────┬────────────────────┘
                 │ HTTP/WebSocket
                 ▼
┌─────────────────────────────────────┐
│   FreePBX Microservice              │
│        Node.js / Express            │
│      (192.168.1.9:3000)             │
│                                     │
│  ├─ Call Management                 │
│  ├─ Recording Service               │
│  ├─ Statistics Engine               │
│  └─ Database Persistence            │
└────────────────┬────────────────────┘
                 │ SIP + AMI Protocol
                 ▼
┌─────────────────────────────────────┐
│      FreePBX / Asterisk             │
│       (192.168.1.9:5060)            │
│       (192.168.1.9:5038 AMI)        │
└─────────────────────────────────────┘
```

## 📋 Prerequisites

- **Node.js** 18.0+
- **Docker** & **Docker Compose** (optional but recommended)
- **SQL Server** with crmHuman database
- **FreePBX/Asterisk** 17.0+
- Network connectivity between all servers

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone repository
git clone <repo-url>
cd freepbx-microservice

# Create environment file
cp .env.example .env

# Edit configuration
nano .env
# Update: FREEPBX_HOST, DB_PASSWORD, etc.

# Start service
docker-compose up -d

# Check health
curl http://192.168.1.9:3000/api/health
```

### Using Node.js (Manual)

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env

# Create necessary directories
mkdir -p logs recordings

# Start service
NODE_ENV=production npm start

# Or use PM2
pm2 start server.js --name "freepbx-microservice"
```

## 📚 API Endpoints

### Health Check
```bash
GET /api/health
GET /api/health/detailed
```

### Call Management
```bash
POST   /api/calls/auto-dial              # Initiate auto-dial
GET    /api/calls/history                # Get call history
GET    /api/calls/:callId                # Get call details
POST   /api/calls/:callId/end            # End call
GET    /api/calls/active/count           # Active calls count
```

### Recording Management
```bash
GET    /api/recordings                   # List recordings
GET    /api/recordings/:recordingId      # Get recording details
GET    /api/recordings/:recordingId/download  # Download file
POST   /api/recordings/:recordingId/register  # Register new recording
DELETE /api/recordings/:recordingId      # Delete recording
```

### Statistics
```bash
GET    /api/statistics/today             # Today's statistics
GET    /api/statistics/range             # Date range statistics
GET    /api/statistics/extensions        # Extension summary
GET    /api/statistics/system            # System-wide stats
GET    /api/statistics/extensions/online # Online extensions
```

## 🔌 WebSocket Events

### Subscribe to Events
```javascript
const socket = io('http://192.168.1.9:3000');

socket.emit('subscribe:calls');
socket.emit('subscribe:statistics');
socket.emit('subscribe:recordings');
```

### Listen for Events
```javascript
// New call initiated
socket.on('call:created', (data) => { ... });

// Incoming call
socket.on('call:incoming', (data) => { ... });

// Call status changed
socket.on('call:status-updated', (data) => { ... });

// Extension status changed
socket.on('extension:status-updated', (data) => { ... });

// Statistics updated
socket.on('statistics:updated', (data) => { ... });
```

## 📊 Example Usage

### Auto-dial
```bash
curl -X POST http://192.168.1.9:3000/api/calls/auto-dial \
  -H "Content-Type: application/json" \
  -d '{
    "fromExtension": "101",
    "toNumber": "+84912345678",
    "metadata": {
      "reason": "sales",
      "customerId": 123
    }
  }'
```

### Get Today's Statistics
```bash
curl http://192.168.1.9:3000/api/statistics/today?extension=101
```

### Download Recording
```bash
curl -O http://192.168.1.9:3000/api/recordings/rec-12345/download
```

## 🔧 Configuration

Edit `.env` file:

```env
# FreePBX
FREEPBX_HOST=192.168.1.9
FREEPBX_PORT=5060
FREEPBX_AMI_HOST=192.168.1.9
FREEPBX_AMI_PORT=5038
FREEPBX_AMI_USER=admin
FREEPBX_AMI_PASSWORD=amiadmin

# Database
DB_SERVER=192.168.1.33
DB_DATABASE=crmHuman
DB_USER=sa
DB_PASSWORD=your_password

# Service
SERVICE_PORT=3000
SERVICE_HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# Storage
RECORDING_STORAGE_PATH=/app/recordings

# Integration
CRMHUMAN_API_URL=http://192.168.1.33/api
CRMHUMAN_API_KEY=your_api_key
```

## 📁 Project Structure

```
freepbx-microservice/
├── server.js                    # Entry point
├── package.json                 # Dependencies
├── Dockerfile                   # Docker image
├── docker-compose.yml           # Compose configuration
│
├── services/
│   ├── database-service.js      # SQL Server connection
│   ├── sip-service.js           # SIP/AMI interface
│   ├── call-manager.js          # Call orchestration
│   ├── recording-service.js     # Recording management
│   └── statistics-service.js    # Statistics engine
│
├── routes/
│   ├── health-routes.js
│   ├── call-routes.js
│   ├── recording-routes.js
│   └── statistics-routes.js
│
├── utils/
│   ├── logger.js
│   ├── validation.js
│   └── response.js
│
├── logs/                        # Application logs
├── recordings/                  # Audio files
│
├── QUICKSTART.md                # Quick start guide
├── DEPLOYMENT_GUIDE.md          # Detailed deployment
└── ARCHITECTURE.md              # Architecture details
```

## 🗄️ Database Schema

Automatic table creation on startup:
- `CallLogs` - Call history and metadata
- `Recordings` - Recording file information
- `CallStatistics` - Aggregated statistics
- `OnlineExtensions` - Real-time extension status

See `DEPLOYMENT_GUIDE.md` for SQL schema details.

## 🔐 Security

- ✅ Input validation with Joi schemas
- ✅ CORS configured for authorized domains
- ✅ Environment variables for sensitive data
- ✅ Secure logging (no credentials logged)
- ⏳ Future: JWT authentication, rate limiting, HTTPS

## 📖 Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture & integration

## 🐛 Troubleshooting

### Service won't start
```bash
docker logs freepbx-microservice
# Check .env configuration
```

### Database connection error
```bash
# Verify SQL Server is accessible
sqlcmd -S 192.168.1.33 -U sa -P password -d crmHuman
```

### FreePBX connection issues
```bash
# Test network connectivity
ping 192.168.1.9
telnet 192.168.1.9 5060
telnet 192.168.1.9 5038
```

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for more troubleshooting.

## 📞 Support & Contribution

- Issues: Create GitHub issue with detailed description
- Deployment Help: See DEPLOYMENT_GUIDE.md
- Integration Help: See ARCHITECTURE.md

## 📄 License

MIT License - See LICENSE file

## 🙏 Acknowledgments

- FreePBX/Asterisk community
- Express.js framework
- Socket.io for real-time updates

---

**Version**: 1.0.0  
**Last Updated**: April 16, 2026  
**Status**: Production Ready
