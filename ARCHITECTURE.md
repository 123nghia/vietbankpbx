# FreePBX Microservice - Architecture & Integration

## Phân chia Công việc

### Microservice (192.168.1.9:3000) - Phần tương tác với FreePBX

**Phần cuộc gọi (Call Interaction):**
- ✅ `POST /api/calls/auto-dial` - Gọi tự động
- ✅ `GET /api/calls/history` - Lịch sử cuộc gọi
- ✅ `GET /api/calls/:callId` - Chi tiết cuộc gọi
- ✅ `POST /api/calls/:callId/end` - Kết thúc cuộc gọi
- ✅ Real-time call events via WebSocket

**Phần ghi âm (Recording Interaction):**
- ✅ `GET /api/recordings` - Danh sách ghi âm
- ✅ `GET /api/recordings/:recordingId/download` - Tải file
- ✅ `POST /api/recordings/:recordingId/register` - Đăng ký ghi âm
- ✅ `DELETE /api/recordings/:recordingId` - Xóa ghi âm

### crmHuman System (192.168.1.33) - Phần thống kê & báo cáo

**Phần thống kê (Statistics & Reporting):**
- Consume từ Microservice: `GET /api/statistics/*`
- Lưu vào SQL Server database (CallStatistics, CallLogs)
- Tạo báo cáo, dashboard, visualization

## Database Schema

### Tạo ở SQL Server (crmHuman)

```sql
-- Call Logs Table
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

-- Call Statistics Table
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
```

## API Documentation

### Auto-dial API

**Request:**
```bash
POST /api/calls/auto-dial
Content-Type: application/json

{
  "fromExtension": "101",
  "toNumber": "+84912345678",
  "context": "from-internal",
  "priority": 1,
  "timeout": 30000,
  "metadata": {
    "reason": "sales_call",
    "customerId": 123,
    "notes": "Khách hàng mới"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "callId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "initiated",
    "fromExtension": "101",
    "toNumber": "+84912345678"
  },
  "message": "Auto-dial initiated successfully",
  "timestamp": "2026-04-16T10:30:00.000Z"
}
```

### Call History API

**Request:**
```bash
GET /api/calls/history?extension=101&direction=outbound&status=completed&limit=20&offset=0
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "callId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "fromExtension": "101",
        "toExtension": "102",
        "toNumber": "+84912345678",
        "direction": "outbound",
        "status": "completed",
        "startTime": "2026-04-16T09:30:00Z",
        "endTime": "2026-04-16T09:32:45Z",
        "duration": 165,
        "waitTime": 5,
        "recordingId": "rec-12345"
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 20,
      "offset": 0,
      "totalPages": 8
    }
  },
  "timestamp": "2026-04-16T10:30:00Z"
}
```

### Statistics API

**Today Statistics:**
```bash
GET /api/statistics/today?extension=101
```

**Date Range Statistics:**
```bash
GET /api/statistics/range?startDate=2026-04-01&endDate=2026-04-16&extension=101
```

**System Statistics:**
```bash
GET /api/statistics/system
```

Response:
```json
{
  "success": true,
  "data": {
    "today": {
      "TotalCalls": 45,
      "InboundCalls": 20,
      "OutboundCalls": 25,
      "InternalCalls": 0,
      "CompletedCalls": 40,
      "MissedCalls": 3,
      "FailedCalls": 2,
      "RecordedCalls": 35,
      "AverageDuration": 128,
      "TotalDuration": 5120,
      "AverageWaitTime": 8
    },
    "onlineExtensions": 15,
    "recordings": {
      "TotalRecordings": 350,
      "TotalStorageUsed": 52428800,
      "AverageRecordingDuration": 145
    }
  },
  "timestamp": "2026-04-16T10:30:00Z"
}
```

## WebSocket Real-time Events

### Connection & Subscription

```javascript
// Client code (crmHuman Razor Pages)
const socket = io('http://192.168.1.9:3000', {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on('connect', () => {
  console.log('Connected to microservice');
  
  // Subscribe to call events
  socket.emit('subscribe:calls');
  
  // Subscribe to statistics
  socket.emit('subscribe:statistics');
  
  // Subscribe to recordings
  socket.emit('subscribe:recordings');
});

// Listen to call events
socket.on('call:created', (data) => {
  console.log('New call created:', data);
  // Update UI in real-time
});

socket.on('call:incoming', (data) => {
  console.log('Incoming call:', data);
  // Show notification
});

socket.on('call:status-updated', (data) => {
  console.log('Call status changed:', data);
  // Update call status in dashboard
});

socket.on('extension:status-updated', (data) => {
  console.log('Extension status:', data);
  // Update extension availability
});

socket.on('statistics:updated', (data) => {
  console.log('Statistics updated:', data);
  // Update dashboard metrics
});
```

## File Structure

```
freepbx-microservice/
├── server.js                    # Main entry point
├── package.json                 # Dependencies
├── .env.example                 # Environment template
├── Dockerfile                   # Docker image
├── docker-compose.yml           # Compose config
├── DEPLOYMENT_GUIDE.md          # This file
├── ARCHITECTURE.md              # Architecture details
│
├── services/
│   ├── database-service.js      # SQL Server connection
│   ├── sip-service.js           # SIP client & AMI interface
│   ├── call-manager.js          # Call orchestration
│   ├── recording-service.js     # Recording management
│   └── statistics-service.js    # Statistics generation
│
├── routes/
│   ├── health-routes.js         # Health check
│   ├── call-routes.js           # Call APIs
│   ├── recording-routes.js      # Recording APIs
│   └── statistics-routes.js     # Statistics APIs
│
├── utils/
│   ├── logger.js                # Winston logging
│   ├── validation.js            # Joi validation
│   └── response.js              # Standard response format
│
├── logs/                        # Log files
├── recordings/                  # Audio files (volumes in docker)
└── tests/                       # Unit tests (future)
```

## Integration Steps with crmHuman

### Step 1: Setup Database Tables
Run the SQL scripts in `DatabaseMigration` of crmHuman to create CallLogs, CallStatistics tables.

### Step 2: Add Telephony Service to Business Layer

```csharp
// VS.Human.Business/Imp/TelephonyBusiness.cs

public class TelephonyBusiness : BaseBusiness, ITelephonyBusiness
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<TelephonyBusiness> _logger;

    private readonly string _microserviceUrl = 
        Environment.GetEnvironmentVariable("FREEPBX_SERVICE_URL") 
        ?? "http://192.168.1.9:3000";

    public TelephonyBusiness(
        IUnitOfWork unitOfWork,
        IHttpContextAccessor contextAccessor,
        HttpClient httpClient,
        ILogger<TelephonyBusiness> logger
    ) : base(unitOfWork, contextAccessor)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<CallDto> InitiateAutoDial(AutoDialRequest request)
    {
        try
        {
            var payload = new
            {
                fromExtension = request.FromExtension,
                toNumber = request.ToNumber,
                metadata = new
                {
                    userId = GetUserId(),
                    reason = request.Reason,
                    customerId = request.CustomerId
                }
            };

            var response = await _httpClient.PostAsJsonAsync(
                $"{_microserviceUrl}/api/calls/auto-dial",
                payload
            );

            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Auto-dial failed: {response.StatusCode}");
            }

            var content = await response.Content.ReadAsAsync<dynamic>();
            return new CallDto
            {
                CallId = content.data.callId,
                Status = content.data.status
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Auto-dial failed");
            throw;
        }
    }

    public async Task<PagedResult<CallDto>> GetCallHistory(CallHistoryFilter filter)
    {
        var queryString = BuildQueryString(filter);
        var response = await _httpClient.GetAsync(
            $"{_microserviceUrl}/api/calls/history{queryString}"
        );

        var content = await response.Content.ReadAsAsync<dynamic>();
        return new PagedResult<CallDto>
        {
            Items = content.data.items,
            Total = content.data.pagination.total,
            PageSize = content.data.pagination.limit
        };
    }

    public async Task<DailyStatisticsDto> GetTodayStatistics(string extension = null)
    {
        var url = $"{_microserviceUrl}/api/statistics/today";
        if (!string.IsNullOrEmpty(extension))
        {
            url += $"?extension={extension}";
        }

        var response = await _httpClient.GetAsync(url);
        var content = await response.Content.ReadAsAsync<DailyStatisticsDto>();
        return content;
    }
}
```

### Step 3: Register in DI

```csharp
// VS.Human.Business/Ioc.cs

public static void Config(this IServiceCollection services)
{
    // ... existing registrations ...
    
    services.AddSingleton<ITelephonyBusiness, TelephonyBusiness>();
    
    // HttpClient for microservice
    services.AddHttpClient<ITelephonyBusiness, TelephonyBusiness>()
        .ConfigureHttpClient(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(30);
        });
}
```

### Step 4: Add UI Pages

```csharp
// crmHuman/Pages/Telephony/Dashboard.cshtml.cs

public class TelephonyDashboard : BaseModel2
{
    private readonly ITelephonyBusiness _telephonyBusiness;

    public TelephonyDashboard(ITelephonyBusiness telephonyBusiness)
    {
        _telephonyBusiness = telephonyBusiness;
    }

    [BindProperty]
    public DailyStatisticsDto TodayStats { get; set; }

    public List<CallDto> RecentCalls { get; set; }

    public async Task OnGet()
    {
        var userData = GetInfoUser();
        
        TodayStats = await _telephonyBusiness.GetTodayStatistics(userData.UserName);
        
        var filter = new CallHistoryFilter
        {
            Extension = userData.UserName,
            Limit = 20,
            Offset = 0
        };
        
        var result = await _telephonyBusiness.GetCallHistory(filter);
        RecentCalls = result.Items.ToList();
    }

    public async Task<IActionResult> OnPostAutoDial(string fromExtension, string toNumber)
    {
        try
        {
            var request = new AutoDialRequest
            {
                FromExtension = fromExtension,
                ToNumber = toNumber,
                Reason = "manual_dial"
            };

            var result = await _telephonyBusiness.InitiateAutoDial(request);
            
            return new JsonResult(new { success = true, callId = result.CallId });
        }
        catch (Exception ex)
        {
            return new JsonResult(new { success = false, error = ex.Message });
        }
    }
}
```

## Monitoring & Maintenance

### Health Monitoring
```bash
# Check service health
curl -i http://192.168.1.9:3000/api/health

# Detailed health check
curl http://192.168.1.9:3000/api/health/detailed
```

### Logs Monitoring
```bash
# Real-time logs (Docker)
docker logs -f freepbx-microservice --tail 100

# Application logs
tail -f freepbx-microservice/logs/combined.log
tail -f freepbx-microservice/logs/error.log
```

### Database Maintenance
```sql
-- Check call logs size
SELECT COUNT(*) as TotalCalls FROM CallLogs
WHERE CreatedAt >= DATEADD(DAY, -30, GETUTCDATE());

-- Archive old records
DELETE FROM CallLogs WHERE CreatedAt < DATEADD(MONTH, -6, GETUTCDATE());

-- Check recording storage
SELECT SUM(FileSize) as TotalSize FROM Recordings
WHERE RecordedAt >= DATEADD(DAY, -30, GETUTCDATE());
```

## Troubleshooting

### 1. Service not responding
```bash
# Check if container is running
docker ps | grep freepbx-microservice

# Check logs for errors
docker logs freepbx-microservice | grep ERROR

# Restart service
docker restart freepbx-microservice
```

### 2. Database connection failed
```bash
# Verify credentials in .env
# Test SQL Server connectivity
sqlcmd -S 192.168.1.33 -U sa -P password -d crmHuman -Q "SELECT 1"
```

### 3. FreePBX connection issues
```bash
# Check FreePBX is accessible
ping 192.168.1.9
curl -i http://192.168.1.9/

# Check SIP port
telnet 192.168.1.9 5060

# Check AMI port
telnet 192.168.1.9 5038
```

---

**Deployment Ready**: April 16, 2026
**Version**: 1.0.0-RC1
