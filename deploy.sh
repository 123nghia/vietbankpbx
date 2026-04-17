#!/bin/bash
# FreePBX Microservice Deployment Script
# Usage: ./deploy.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

compose() {
    if docker compose version > /dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose > /dev/null 2>&1; then
        docker-compose "$@"
    else
        return 127
    fi
}

echo "============================================================"
echo "  FreePBX Microservice Deployment Script"
echo "  Target: 192.168.1.9:3000"
echo "============================================================"
echo ""

echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

if ! command -v docker > /dev/null 2>&1; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}Docker found${NC}"

if ! compose version > /dev/null 2>&1; then
    echo -e "${RED}Docker Compose is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}Docker Compose found${NC}"

echo ""
echo -e "${YELLOW}[2/6] Checking required files...${NC}"

FILES=("server.js" "package.json" "Dockerfile" "docker-compose.yml" ".env.example")
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}Missing: $file${NC}"
        exit 1
    fi
    echo -e "${GREEN}Found: $file${NC}"
done

echo ""
echo -e "${YELLOW}[3/6] Checking environment configuration...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}.env not found, creating from template...${NC}"
    cp .env.example .env
    echo -e "${RED}Edit .env with your FreePBX and database credentials${NC}"
    echo -e "${RED}Run: nano .env${NC}"
    exit 1
fi
echo -e "${GREEN}.env file exists${NC}"

echo ""
echo -e "${YELLOW}[4/6] Validating compose configuration...${NC}"

if compose config > /dev/null; then
    echo -e "${GREEN}Compose configuration is valid${NC}"
else
    echo -e "${RED}Compose configuration is invalid${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}[5/6] Building Docker image...${NC}"

if compose build; then
    echo -e "${GREEN}Docker image built successfully${NC}"
else
    echo -e "${RED}Docker build failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}[6/6] Starting FreePBX Microservice...${NC}"

if compose up -d; then
    echo -e "${GREEN}Service started${NC}"
else
    echo -e "${RED}Service start failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Waiting for service to be ready...${NC}"
sleep 5

echo ""
echo -e "${YELLOW}Checking service health...${NC}"

HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health || echo "")
if [ -z "$HEALTH_RESPONSE" ]; then
    echo -e "${YELLOW}Service may still be starting. Check logs with:${NC}"
    echo -e "${YELLOW}  docker compose logs -f freepbx-microservice${NC}"
else
    echo -e "${GREEN}Service is healthy${NC}"
fi

echo ""
echo "============================================================"
echo "  Deployment completed"
echo "============================================================"
echo "Service URL:   http://192.168.1.9:3000"
echo "Health Check:  http://192.168.1.9:3000/api/health"
echo "Logs:          docker compose logs -f"
echo "Stop Service:  docker compose down"
