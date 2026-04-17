FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy application
COPY . .

# Create logs and recordings directories
RUN mkdir -p logs recordings

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.SERVICE_PORT || 3000; require('http').get('http://localhost:' + port + '/api/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode); })"

# Start application
CMD ["node", "server.js"]
