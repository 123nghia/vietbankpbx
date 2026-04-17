/**
 * Quick Start Guide - FreePBX Microservice
 * Deprecated for the current PBX-host adapter flow.
 * Use PBX_INTEGRATION.md instead.
 */

> Deprecated: this file still contains the older SQL Server based flow.
> Use [PBX_INTEGRATION.md](./PBX_INTEGRATION.md) for deployment on `192.168.1.9`.

# Quick Start Guide

## 1️⃣ Deploy Microservice (on 192.168.1.9)

### Option A: Docker (Recommended)

```bash
# 1. Copy files to 192.168.1.9
scp -r freepbx-microservice user@192.168.1.9:/opt/

# 2. SSH to server
ssh user@192.168.1.9

# 3. Navigate to folder
cd /opt/freepbx-microservice

# 4. Create .env
cp .env.example .env
nano .env

# Update these values:
FREEPBX_HOST=192.168.1.9
FREEPBX_AMI_USER=admin
FREEPBX_AMI_PASSWORD=your_freepbx_password
DB_SERVER=192.168.1.33  # crmHuman server
DB_PASSWORD=your_db_password

# 5. Start service
docker-compose up -d

# 6. Check status
docker ps
docker logs freepbx-microservice

# 7. Test health
curl http://192.168.1.9:3000/api/health
```

### Option B: Manual (Node.js)

```bash
cd /opt/freepbx-microservice
npm install
cp .env.example .env
nano .env  # Configure values
NODE_ENV=production npm start
```

---

## 2️⃣ Integrate with crmHuman

### Step 1: Database Migrations

Run these SQL commands in crmHuman database:

```sql
-- Copy from freepbx-microservice/services/database-service.js
-- Create tables: CallLogs, Recordings, CallStatistics, OnlineExtensions
```

### Step 2: Add DI Registration

Edit `Program.cs` in crmHuman:

```csharp
// Add to ConfigureServices
services.AddHttpClient<ITelephonyBusiness, TelephonyBusiness>();

// Register service
services.AddSingleton<ITelephonyBusiness, TelephonyBusiness>();
```

### Step 3: Add appsettings

Edit `appsettings.json`:

```json
{
  "Telephony": {
    "MicroserviceUrl": "http://192.168.1.9:3000",
    "WebSocketUrl": "ws://192.168.1.9:3000",
    "Enabled": true
  }
}
```

### Step 4: Copy Business Service

Copy `TelephonyBusiness.cs.example` to:
`VS.Human.Business/Imp/TelephonyBusiness.cs`

---

## 3️⃣ Create UI Pages

### Example 1: Call Dashboard

```csharp
// Pages/Telephony/Dashboard.cshtml.cs
public class TelephonyDashboardModel : BaseModel2
{
    private readonly ITelephonyBusiness _telephony;

    public async Task OnGet()
    {
        var userData = GetInfoUser();
        var stats = await _telephony.GetTodayStatistics(userData.UserName);
        // Bind to view
    }
}
```

### Example 2: Call History

```csharp
// Pages/Telephony/CallHistory.cshtml.cs
public class CallHistoryModel : BaseModel2
{
    public async Task OnGet(int pageIndex = 1)
    {
        var filter = new CallHistoryFilterRequest
        {
            Extension = GetInfoUser().UserName,
            Limit = 20,
            Offset = (pageIndex - 1) * 20
        };
        
        var result = await _telephony.GetCallHistory(filter);
        // Bind to view
    }
}
```

### Example 3: Recordings

```csharp
// Pages/Telephony/Recordings.cshtml.cs
public class RecordingsModel : BaseModel2
{
    public async Task OnGet(int pageIndex = 1)
    {
        var filter = new RecordingFilterRequest
        {
            Extension = GetInfoUser().UserName,
            Limit = 20,
            Offset = (pageIndex - 1) * 20
        };
        
        var recordings = await _telephony.GetRecordings(filter);
        // Bind to view
    }

    public async Task<IActionResult> OnGetDownload(string recordingId)
    {
        var result = await _telephony.DownloadRecording(recordingId);
        return Redirect(result.downloadUrl);
    }
}
```

---

## 4️⃣ Real-time Updates (WebSocket)

### Add to Razor Page

```html
<!-- Pages/Telephony/Dashboard.cshtml -->

@section Scripts {
    <script src="~/lib/socket.io/socket.io.js"></script>
    <script>
        const socket = io('http://192.168.1.9:3000');

        socket.on('connect', () => {
            // Subscribe to call events
            socket.emit('subscribe:calls');
            socket.emit('subscribe:statistics');
        });

        // Listen for new calls
        socket.on('call:created', (data) => {
            console.log('New call:', data);
            
            // Update UI
            $('#activeCallsCount').text(data.count);
            
            // Show notification
            new Notification('Cuộc gọi mới', {
                body: `${data.fromExtension} -> ${data.toNumber}`
            });
        });

        // Listen for status updates
        socket.on('call:status-updated', (data) => {
            console.log('Call status:', data);
            updateCallStatus(data.callId, data.status);
        });

        // Listen for statistics
        socket.on('statistics:updated', (data) => {
            console.log('Statistics:', data);
            updateDashboard(data);
        });
    </script>
}
```

---

## 5️⃣ Testing

### Test Endpoints

```bash
# Health check
curl http://192.168.1.9:3000/api/health

# Today statistics
curl http://192.168.1.9:3000/api/statistics/today

# Call history
curl "http://192.168.1.9:3000/api/calls/history?limit=10"

# Extension summary
curl http://192.168.1.9:3000/api/statistics/extensions

# Online extensions
curl http://192.168.1.9:3000/api/statistics/extensions/online

# Recordings list
curl "http://192.168.1.9:3000/api/recordings?limit=20"
```

### Test Auto-dial

```bash
curl -X POST http://192.168.1.9:3000/api/calls/auto-dial \
  -H "Content-Type: application/json" \
  -d '{
    "fromExtension": "101",
    "toNumber": "+84912345678",
    "metadata": {"reason": "test"}
  }'
```

---

## 6️⃣ Production Checklist

- [ ] Configure FreePBX AMI credentials correctly
- [ ] Setup database connection string
- [ ] Configure recording storage path (disk space ≥ 100GB recommended)
- [ ] Setup HTTPS/SSL for WebSocket
- [ ] Enable authentication/API keys
- [ ] Configure logging and monitoring
- [ ] Setup database backups
- [ ] Configure recording retention policy
- [ ] Test all API endpoints
- [ ] Load test the service
- [ ] Setup monitoring alerts

---

## 7️⃣ Troubleshooting

### Service won't start
```bash
# Check logs
docker logs freepbx-microservice | grep ERROR

# Verify database connection
docker exec freepbx-microservice npm run test:db

# Check environment variables
docker exec freepbx-microservice env | grep DB_
```

### Can't connect to FreePBX
```bash
# Test FreePBX is accessible
ping 192.168.1.9

# Test AMI port
telnet 192.168.1.9 5038

# Check FreePBX logs
ssh asterisk@192.168.1.9
tail -f /var/log/asterisk/full
```

### WebSocket connection issues
```bash
# Check firewall
sudo ufw status
sudo ufw allow 3000

# Test WebSocket
wscat -c ws://192.168.1.9:3000
```

---

## 📞 Support

For issues, check:
1. `DEPLOYMENT_GUIDE.md` - Detailed setup instructions
2. `ARCHITECTURE.md` - System architecture details
3. Docker logs - `docker logs freepbx-microservice`
4. Application logs - `logs/combined.log`

---

**Ready to deploy?** Start with Step 1! 🚀
