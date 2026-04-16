#!/bin/bash
# FreePBX Microservice Deployment Script
# Usage: ./deploy.sh

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   FreePBX Microservice Deployment Script                   ║"
echo "║   Target: 192.168.1.9:3000                                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# Check files
echo ""
echo -e "${YELLOW}[2/5] Checking required files...${NC}"

FILES=("server.js" "package.json" "Dockerfile" "docker-compose.yml" ".env.example")
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}✗ Missing: $file${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Found: $file${NC}"
done

# Check .env
echo ""
echo -e "${YELLOW}[3/5] Checking environment configuration...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ .env not found, creating from template...${NC}"
    cp .env.example .env
    echo -e "${RED}⚠ IMPORTANT: Edit .env with your FreePBX and database credentials${NC}"
    echo -e "${RED}⚠ Run: nano .env${NC}"
    exit 1
fi
echo -e "${GREEN}✓ .env file exists${NC}"

# Build Docker image
echo ""
echo -e "${YELLOW}[4/5] Building Docker image...${NC}"

if docker-compose build; then
    echo -e "${GREEN}✓ Docker image built successfully${NC}"
else
    echo -e "${RED}✗ Docker build failed${NC}"
    exit 1
fi

# Start service
echo ""
echo -e "${YELLOW}[5/5] Starting FreePBX Microservice...${NC}"

if docker-compose up -d; then
    echo -e "${GREEN}✓ Service started${NC}"
else
    echo -e "${RED}✗ Service start failed${NC}"
    exit 1
fi

# Wait for service to be ready
echo ""
echo -e "${YELLOW}Waiting for service to be ready...${NC}"
sleep 5

# Health check
echo ""
echo -e "${YELLOW}Checking service health...${NC}"

HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health || echo "")
if [ -z "$HEALTH_RESPONSE" ]; then
    echo -e "${YELLOW}⚠ Service may still be starting, check logs with:${NC}"
    echo -e "${YELLOW}   docker-compose logs -f freepbx-microservice${NC}"
else
    echo -e "${GREEN}✓ Service is healthy${NC}"
fi

# Print summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "║ ${GREEN}✓ Deployment Successful!${NC}                                ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║ Service URL:   http://192.168.1.9:3000                   ║"
echo "║ Health Check:  http://192.168.1.9:3000/api/health        ║"
echo "║ Logs:          docker-compose logs -f                    ║"
echo "║ Stop Service:  docker-compose down                       ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║ Next Steps:                                                ║"
echo "║ 1. Test: curl http://192.168.1.9:3000/api/health         ║"
echo "║ 2. Read: QUICKSTART.md                                    ║"
echo "║ 3. Integrate: Copy TelephonyBusiness.cs to crmHuman       ║"
echo "╚════════════════════════════════════════════════════════════╝"
