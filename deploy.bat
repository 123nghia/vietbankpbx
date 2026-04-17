@echo off
REM FreePBX Microservice Deployment Script (Windows)
REM Usage: deploy.bat

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo   FreePBX Microservice Deployment Script (Windows)
echo   Target: 192.168.1.9:3000
echo ============================================================
echo.

echo Checking prerequisites...
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed
    exit /b 1
)
echo [OK] Docker found

docker compose version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "COMPOSE_CMD=docker compose"
) else (
    where docker-compose >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Docker Compose is not installed
        exit /b 1
    )
    set "COMPOSE_CMD=docker-compose"
)
echo [OK] Docker Compose found

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

if not exist "Dockerfile" (
    echo [ERROR] Missing: Dockerfile
    exit /b 1
)
echo [OK] Found: Dockerfile

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

echo.
if not exist ".env" (
    echo Creating .env from template...
    copy .env.example .env >nul
    echo [WARNING] Please edit .env with your FreePBX and database credentials
    echo [WARNING] Run: notepad .env
    exit /b 1
)
echo [OK] .env file exists

echo.
echo Validating compose configuration...
%COMPOSE_CMD% config >nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Compose configuration is invalid
    exit /b 1
)
echo [OK] Compose configuration is valid

echo.
echo Building Docker image...
%COMPOSE_CMD% build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker build failed
    exit /b 1
)
echo [OK] Docker image built successfully

echo.
echo Starting FreePBX Microservice...
%COMPOSE_CMD% up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Service start failed
    exit /b 1
)
echo [OK] Service started

echo.
echo Waiting for service to be ready...
timeout /t 5 /nobreak >nul

echo.
echo Checking service health...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -TimeoutSec 5 -ErrorAction Stop; if ($response.StatusCode -eq 200) { Write-Host '[OK] Service is healthy' } } catch { Write-Host '[WARNING] Service may still be starting. Check logs with: docker compose logs -f freepbx-microservice' }"

echo.
echo ============================================================
echo   Deployment completed
echo ============================================================
echo Service URL:   http://192.168.1.9:3000
echo Health Check:  http://192.168.1.9:3000/api/health
echo Logs:          docker compose logs -f
echo Stop Service:  docker compose down
echo ============================================================
