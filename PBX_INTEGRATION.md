# PBX Integration Flow

## Topology

- FreePBX / Asterisk host: `192.168.1.9`
- PBX adapter service: `http://192.168.1.9:3000`
- CRM host: `192.168.1.3`

The adapter is deployed on the same host as FreePBX so it can:

- control calls through AMI on `127.0.0.1:5038`
- read call history from FreePBX CDR database
- read recording files directly from `/var/spool/asterisk/monitor`

## What The Adapter Now Handles

- outbound click-to-call from a managed extension
- hangup through AMI
- managed extension registry for CRM
- assign and unassign extension to employee
- live extension state from AMI
- call history from CDR
- recording list and file download from PBX storage
- dashboard metrics:
  - total calls
  - inbound / outbound / internal
  - completed / busy / no answer / cancelled / failed
  - total and average talk time
  - total and average wait time
  - online extensions
  - managed line counts

## Required Environment

Create `.env` on `192.168.1.9`:

```env
FREEPBX_HOST=192.168.1.9

FREEPBX_AMI_HOST=127.0.0.1
FREEPBX_AMI_PORT=5038
FREEPBX_AMI_USER=admin
FREEPBX_AMI_PASSWORD=your_real_ami_password
FREEPBX_AMI_BANNER_TIMEOUT_MS=15000
FREEPBX_AMI_REQUIRE_BANNER=false

FREEPBX_CONFIG_FILE=/etc/freepbx.conf
FREEPBX_RECORDING_ROOT=/var/spool/asterisk/monitor

FREEPBX_CDR_DB_HOST=127.0.0.1
FREEPBX_CDR_DB_PORT=3306
FREEPBX_CDR_DB_NAME=asteriskcdrdb
FREEPBX_CDR_DB_USER=
FREEPBX_CDR_DB_PASSWORD=

FREEPBX_ENDPOINT_TECH=PJSIP
FREEPBX_HINT_CONTEXT=ext-local
FREEPBX_DIAL_CONTEXT=from-internal

SERVICE_HOST=0.0.0.0
SERVICE_PORT=3000
SERVICE_PUBLIC_URL=http://192.168.1.9:3000

TRUSTED_ADMIN_IPS=127.0.0.1,::1,::ffff:127.0.0.1,192.168.1.3,::ffff:192.168.1.3
LINE_STORE_PATH=/app/data/managed-lines.json
ALLOW_RECORDING_DELETE=false
```

Notes:

- Do not commit the real AMI password into git.
- If `/etc/freepbx.conf` is mounted and readable, DB credentials can be auto-discovered from FreePBX.
- `TRUSTED_ADMIN_IPS` already allows backend traffic from CRM host `192.168.1.3`.

## Docker Deploy

```bash
cd /opt/freepbx-microservice
cp .env.example .env
vi .env
docker compose build --no-cache
docker compose up -d
docker compose logs -f freepbx-microservice
```

Health checks:

```bash
curl http://192.168.1.9:3000/api/health
curl http://192.168.1.9:3000/api/health/detailed
```

Expected detailed health:

- `cdrDatabase: connected`
- `ami: connected`

## CRM To Adapter Contract

CRM should call the adapter from backend code on `192.168.1.3`.

Recommended headers:

```http
x-user-id: <crm-user-id>
x-user-role: admin
x-user-name: <display-name>
```

Even without headers, requests from `192.168.1.3` are treated as trusted internal admin by default.

## Admin Flow

### 1. Register CRM-managed extensions

CRM first registers which PBX extensions it is allowed to manage:

```bash
curl -X POST http://192.168.1.9:3000/api/sip/create \
  -H "Content-Type: application/json" \
  -H "x-user-id: 1" \
  -H "x-user-role: admin" \
  -d '{
    "extension": "101",
    "displayName": "Recruiter 101"
  }'
```

### 2. Assign extension to employee

```bash
curl -X POST http://192.168.1.9:3000/api/sip/101/assign \
  -H "Content-Type: application/json" \
  -H "x-user-id: 1" \
  -H "x-user-role: admin" \
  -d '{
    "employeeId": "hr-001",
    "employeeName": "Nguyen Van A",
    "employeeCode": "NS001"
  }'
```

### 3. Place call to candidate

Only managed active lines are allowed to originate calls.

```bash
curl -X POST http://192.168.1.9:3000/api/calls/auto-dial \
  -H "Content-Type: application/json" \
  -H "x-user-id: 1" \
  -H "x-user-role: admin" \
  -d '{
    "fromExtension": "101",
    "toNumber": "0912345678",
    "metadata": {
      "candidateId": "uv-1001",
      "employeeId": "hr-001"
    }
  }'
```

Flow:

1. Adapter checks line `101` is registered and active.
2. Adapter uses AMI `Originate`.
3. Asterisk rings extension `101`.
4. When agent answers, Asterisk continues dialplan in `from-internal` to dial the candidate.
5. AMI events update realtime call state.
6. CDR and recording become available after the call is written by Asterisk.

### 4. End active call

```bash
curl -X POST http://192.168.1.9:3000/api/calls/<callId>/end \
  -H "Content-Type: application/json" \
  -H "x-user-id: 1" \
  -H "x-user-role: admin" \
  -d '{ "reason": "normal" }'
```

## Read APIs For CRM

### Managed lines

- `GET /api/sip/list`
- `GET /api/sip/:extension`
- `GET /api/sip/stats/overview`

Useful filters:

- `status=active`
- `isAssigned=true`
- `employeeId=hr-001`

### Calls

- `GET /api/calls/active`
- `GET /api/calls/active/count`
- `GET /api/calls/history`
- `GET /api/calls/:callId`

Important call statuses:

- `completed`
- `busy`
- `no_answer`
- `cancelled`
- `failed`

### Recordings

- `GET /api/recordings`
- `GET /api/recordings/:recordingId`
- `GET /api/recordings/:recordingId/download`

### Dashboard / statistics

- `GET /api/statistics/today`
- `GET /api/statistics/range`
- `GET /api/statistics/extensions`
- `GET /api/statistics/system`
- `GET /api/statistics/extensions/online`

## Dashboard Data Source Mapping

- current active calls: realtime AMI memory state
- line online status: AMI extension state
- call history: FreePBX `cdr` table
- recording metadata: CDR plus PBX recording path
- recording file download: direct file stream from PBX host
- talk time: `billsec`
- wait time: `duration - billsec`
- status counters: normalized from `disposition`

## Important Behavior

- This adapter no longer depends on CRM SQL Server tables.
- It is a PBX adapter, not a CRM persistence service.
- Recordings are read from PBX storage, not copied into the adapter database.
- Delete recording is disabled unless `ALLOW_RECORDING_DELETE=true`.
- CRM should call this service from backend code, not directly from browser clients.

## Recommended Smoke Tests

```bash
curl http://192.168.1.9:3000/api/health/detailed
curl http://192.168.1.9:3000/api/sip/list
curl http://192.168.1.9:3000/api/statistics/system
curl http://192.168.1.9:3000/api/statistics/extensions/online
```

Then:

1. register one extension
2. assign it to one employee
3. place one outbound test call
4. confirm realtime state in `/api/calls/active`
5. confirm CDR appears in `/api/calls/history`
6. confirm recording appears in `/api/recordings`
