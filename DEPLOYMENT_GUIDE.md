# FreePBX Microservice Deployment Guide

## Kiến trúc

```
┌─────────────────────┐
│  crmHuman System    │
│  (192.168.1.33)     │
│  ↓ HTTP/WebSocket   │
├─────────────────────┤
│ FreePBX Microservice│
│ Node.js Service     │
│ (192.168.1.9:3000)  │
│ ↓ SIP/AMI Protocol  │
├─────────────────────┤
│ FreePBX (Asterisk)  │
│ (192.168.1.9:5060)  │
│ (192.168.1.9:5038)  │
└─────────────────────┘
```

## Features

### 1. **Cuộc gọi (Call Management)**
- ✅ Auto-dial: Gọi tự động đến số điện thoại
- ✅ Incoming calls: Tracking cuộc gọi đến
- ✅ Call state: Ringing, Connected, Completed, Failed, Missed, Abandoned
- ✅ Call history: Lịch sử chi tiết mỗi cuộc gọi
- ✅ Call duration: Thời gian đàm thoại
- ✅ Wait time: Thời gian chờ (ringing)

### 2. **Ghi âm (Recording Management)**
- ✅ Recording storage: Lưu trữ files ghi âm
- ✅ Recording metadata: Lưu thông tin ghi âm
- ✅ Download recordings: Tải file ghi âm
- ✅ Recording filtering: Lọc theo extension, ngày, hướng gọi

### 3. **Thống kê & Báo cáo (Statistics)**
- ✅ Today statistics: Thống kê hôm nay
- ✅ Date range statistics: Thống kê theo khoảng thời gian
- ✅ Extension summary: Tóm tắt theo extension
- ✅ System statistics: Thống kê hệ thống
- ✅ Online extensions: Số SIP đang online
- ✅ Call metrics: Số cuộc gọi, loại, tình trạng, thời gian trung bình

### 4. **Real-time Updates**
- ✅ WebSocket events: Cập nhật real-time
- ✅ Call events: Thông báo về sự kiện cuộc gọi
- ✅ Statistics updates: Cập nhật thống kê mỗi 5 phút
- ✅ Extension status: Trạng thái extension thay đổi

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ (nếu chạy local)
- SQL Server (crmHuman database)
- FreePBX/Asterisk tại 192.168.1.9
- Network connectivity giữa các server

## Installation & Deployment

### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone/Copy project
cd freepbx-microservice

# 2. Cập nhật environment variables
cp .env.example .env
nano .env

# 3. Cấu hình theo thông tin của bạn
# - FREEPBX_HOST=192.168.1.9
# - DB_SERVER=192.168.1.33
# - DB_PASSWORD=your_password
# - CRMHUMAN_API_KEY=your_key

# 4. Start service
docker-compose up -d

# 5. Check logs
docker-compose logs -f freepbx-microservice

# 6. Health check
curl http://192.168.1.9:3000/api/health
```

### Option 2: Manual Installation

```bash
# 1. Install dependencies
npm install

# 2. Cấu hình environment
cp .env.example .env
nano .env

# 3. Tạo logs và recordings folder
mkdir -p logs recordings

# 4. Start service
NODE_ENV=production npm start

# hoặc với PM2 (production)
pm2 start server.js --name "freepbx-microservice"
pm2 save
pm2 startup
```

## API Endpoints

### Health Check
- `GET /api/health` - Service health status
- `GET /api/health/detailed` - Detailed health check

### Call Management (Phần tương tác cuộc gọi)
- `POST /api/calls/auto-dial` - Gọi tự động
- `GET /api/calls/history` - Lịch sử cuộc gọi
- `GET /api/calls/:callId` - Chi tiết cuộc gọi
- `POST /api/calls/:callId/end` - Kết thúc cuộc gọi
- `GET /api/calls/active/count` - Số cuộc gọi đang active

### Recording Management (Phần tương tác ghi âm)
- `GET /api/recordings` - Danh sách ghi âm
- `GET /api/recordings/:recordingId` - Chi tiết ghi âm
- `GET /api/recordings/:recordingId/download` - Tải file ghi âm
- `POST /api/recordings/:recordingId/register` - Đăng ký ghi âm mới
- `DELETE /api/recordings/:recordingId` - Xóa ghi âm

### Statistics (Phần thống kê - lưu ở crmHuman)
- `GET /api/statistics/today` - Thống kê hôm nay
- `GET /api/statistics/range` - Thống kê theo khoảng thời gian
- `GET /api/statistics/extensions` - Thống kê theo extension
- `GET /api/statistics/system` - Thống kê hệ thống
- `GET /api/statistics/extensions/online` - Extension đang online

## WebSocket Events

### Broadcast Events (từ service gửi đến crmHuman)

```javascript
// Khi có cuộc gọi mới
io.to('calls').emit('call:created', {
  callId, fromExtension, toNumber, status, timestamp
});

// Khi có cuộc gọi đến
io.to('calls').emit('call:incoming', {
  callId, fromNumber, toExtension, status, timestamp
});

// Khi trạng thái cuộc gọi thay đổi
io.to('calls').emit('call:status-updated', {
  callId, status, duration, timestamp
});

// Khi có extension đổi trạng thái
io.to('statistics').emit('extension:status-updated', {
  extension, status, callId, timestamp
});

// Cập nhật thống kê (mỗi 5 phút)
io.to('statistics').emit('statistics:updated', {
  timestamp, extensionSummary
});
```

### Client Subscription

```javascript
// Client connects to WebSocket
const socket = io('http://192.168.1.9:3000');

// Subscribe to call events
socket.emit('subscribe:calls');
socket.on('call:created', (data) => {
  console.log('New call:', data);
});

// Subscribe to statistics
socket.emit('subscribe:statistics');
socket.on('statistics:updated', (data) => {
  console.log('Statistics updated:', data);
});
```

## Database Schema

### CallLogs Table
```sql
CREATE TABLE CallLogs (
  Id INT PRIMARY KEY IDENTITY(1,1),
  CallId NVARCHAR(100) UNIQUE NOT NULL,
  FromExtension NVARCHAR(50) NOT NULL,
  ToExtension NVARCHAR(50),
  ToNumber NVARCHAR(50),
  Direction NVARCHAR(20), -- inbound, outbound, internal
  Status NVARCHAR(50), -- ringing, connected, completed, missed, failed
  StartTime DATETIME2 NOT NULL,
  EndTime DATETIME2,
  Duration INT, -- seconds
  WaitTime INT, -- seconds
  RecordingId NVARCHAR(100),
  Metadata NVARCHAR(MAX),
  CreatedAt DATETIME2 DEFAULT GETUTCDATE()
);
```

### Recordings Table
```sql
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
```

### CallStatistics Table
```sql
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
  AverageDuration INT,
  TotalDuration INT,
  AverageWaitTime INT,
  RecordedCalls INT DEFAULT 0,
  UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
  UNIQUE (StatDate, Extension)
);
```

### OnlineExtensions Table
```sql
CREATE TABLE OnlineExtensions (
  Id INT PRIMARY KEY IDENTITY(1,1),
  Extension NVARCHAR(50) UNIQUE NOT NULL,
  Status NVARCHAR(50), -- available, busy, away, dnd
  CurrentCallId NVARCHAR(100),
  OnlineSince DATETIME2 NOT NULL,
  LastActivity DATETIME2 NOT NULL,
  Metadata NVARCHAR(MAX)
);
```

## Configuration

### Environment Variables (.env)

```
# FreePBX Connection
FREEPBX_HOST=192.168.1.9
FREEPBX_PORT=5060
FREEPBX_AMI_HOST=192.168.1.9
FREEPBX_AMI_PORT=5038
FREEPBX_AMI_USER=admin
FREEPBX_AMI_PASSWORD=amiadmin

# SIP Configuration
SIP_DOMAIN=192.168.1.9
SIP_PORT=5060
SIP_EXTENSION=101
SIP_PASSWORD=extension101

# Database
DB_SERVER=192.168.1.33
DB_DATABASE=crmHuman
DB_USER=sa
DB_PASSWORD=your_password
DB_POOL_SIZE=10

# Service
SERVICE_PORT=3000
SERVICE_HOST=192.168.1.9
NODE_ENV=production
LOG_LEVEL=info

# Storage
RECORDING_STORAGE_PATH=/app/recordings

# Integration
CRMHUMAN_API_URL=http://192.168.1.33/api
CRMHUMAN_API_KEY=your_api_key
```

## Usage Examples

### Example 1: Auto-dial từ crmHuman

```bash
curl -X POST http://192.168.1.9:3000/api/calls/auto-dial \
  -H "Content-Type: application/json" \
  -d '{
    "fromExtension": "101",
    "toNumber": "+84912345678",
    "metadata": {
      "reason": "sales_call",
      "customerId": 123,
      "productId": 456
    }
  }'
```

### Example 2: Lấy lịch sử cuộc gọi

```bash
curl "http://192.168.1.9:3000/api/calls/history?extension=101&direction=outbound&limit=20&offset=0"
```

### Example 3: Lấy thống kê hôm nay

```bash
curl "http://192.168.1.9:3000/api/statistics/today?extension=101"
```

### Example 4: Tải file ghi âm

```bash
curl -O "http://192.168.1.9:3000/api/recordings/recording-uuid-here/download"
```

## Integration with crmHuman

### Từ crmHuman Razor Pages, kết nối WebSocket:

```csharp
// Pages/Telephony/Dashboard.cshtml.cs

using System.Net.WebSockets;
using System.Text.Json;

public class TelephonyDashboard : BaseModel2
{
    private Uri _socketUri = new Uri("ws://192.168.1.9:3000");
    
    public async Task OnGet()
    {
        var userData = GetInfoUser();
        
        // Connect to microservice
        using (var socket = new ClientWebSocket())
        {
            await socket.ConnectAsync(_socketUri, CancellationToken.None);
            
            // Subscribe to events
            var subscribeMsg = new { action = "subscribe", channel = "calls" };
            var json = JsonSerializer.Serialize(subscribeMsg);
            await socket.SendAsync(
                new ArraySegment<byte>(System.Text.Encoding.UTF8.GetBytes(json)),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None
            );
        }
    }
}
```

## Troubleshooting

### 1. Connection refused (192.168.1.9:3000)
```bash
# Check if service is running
docker ps | grep freepbx-microservice

# Check logs
docker logs freepbx-microservice

# Or if running locally
npm run dev
```

### 2. Database connection error
```bash
# Verify DB credentials in .env
# Check SQL Server is accessible
sqlcmd -S 192.168.1.33 -U sa -P your_password -d crmHuman
```

### 3. FreePBX connection issues
```bash
# Test connection to FreePBX
ping 192.168.1.9
telnet 192.168.1.9 5060  # SIP Port
telnet 192.168.1.9 5038  # AMI Port
```

### 4. View logs
```bash
# Docker logs
docker logs -f freepbx-microservice

# Local logs
tail -f logs/combined.log
tail -f logs/error.log
```

## Performance Tuning

- **DB Pool Size**: `DB_POOL_SIZE=20` (cho high volume)
- **Recording Storage**: Sử dụng SSD cho tốc độ ghi
- **Memory Limits**: `docker-compose` set memory limit nếu cần

## Security

- ✅ Validate all inputs (Joi schema)
- ✅ CORS configured cho crmHuman domain
- ✅ Environment variables cho sensitive data
- ✅ HTTPS recommended (thêm reverse proxy như Nginx)

## Monitoring

```bash
# PM2 Monitoring
pm2 monit

# Docker stats
docker stats freepbx-microservice

# Health endpoint
curl http://192.168.1.9:3000/api/health
```

## Next Steps

1. **Implement actual SIP.js or node-sip connection** - Current implementation có TODO
2. **Thêm AMI event handler** - Parse Asterisk Manager Interface events
3. **Recording webhook** - Nhận thông báo khi có recording từ FreePBX
4. **Authentication layer** - Thêm JWT tokens
5. **Rate limiting** - Thêm ratelimit middleware
6. **Metrics & monitoring** - Thêm Prometheus metrics

---

**Last Updated**: April 16, 2026
**Version**: 1.0.0
