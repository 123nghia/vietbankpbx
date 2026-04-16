@echo off
REM FreePBX Microservice Deployment Script (Windows)
REM Usage: deploy.bat

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo    FreePBX Microservice Deployment Script (Windows)
echo    Target: 192.168.1.9:3000
echo ============================================================
echo.

REM Check for Docker
echo Checking prerequisites...
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed
    exit /b 1
)
echo [OK] Docker found

where docker-compose >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Compose is not installed
    exit /b 1
)
echo [OK] Docker Compose found

REM Check files
echo.
echo Checking required files...
if not exist "server.js" (
    echo [ERROR] Missing: server.js
    exit /b 1
)
echo [OK] Found: server.js

if not exist "package.json" (
    echo [ERROR] Missing: package.json
    exit /b 1
)
echo [OK] Found: package.json

if not exist "docker-compose.yml" (
    echo [ERROR] Missing: docker-compose.yml
    exit /b 1
)
echo [OK] Found: docker-compose.yml

if not exist ".env.example" (
    echo [ERROR] Missing: .env.example
    exit /b 1
)
echo [OK] Found: .env.example

REM Check .env
echo.
if not exist ".env" (
    echo Creating .env from template...
    copy .env.example .env
    echo [WARNING] Please edit .env with your FreePBX and database credentials
    echo [WARNING] Run: notepad .env
    exit /b 1
)
echo [OK] .env file exists

REM Build Docker image
echo.
echo Building Docker image...
docker-compose build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker build failed
    exit /b 1
)
echo [OK] Docker image built successfully

REM Start service
echo.
echo Starting FreePBX Microservice...
docker-compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Service start failed
    exit /b 1
)
echo [OK] Service started

REM Wait for service
echo.
echo Waiting for service to be ready...
timeout /t 5 /nobreak

REM Health check
echo.
echo Checking service health...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -TimeoutSec 5 -ErrorAction SilentlyContinue; if ($response.StatusCode -eq 200) { Write-Host '[OK] Service is healthy' } else { Write-Host '[WARNING] Service may still be starting' } } catch { Write-Host '[WARNING] Service may still be starting' }"

REM Print summary
echo.
echo ============================================================
echo    ✓ Deployment Successful!
echo ============================================================
echo.
echo Service URL:   http://192.168.1.9:3000
echo Health Check:  http://192.168.1.9:3000/api/health
echo Logs:          docker-compose logs -f
echo Stop Service:  docker-compose down
echo.
echo Next Steps:
echo 1. Test: curl http://192.168.1.9:3000/api/health
echo 2. Read: QUICKSTART.md
echo 3. Integrate: Copy TelephonyBusiness.cs to crmHuman
echo.
echo ============================================================
