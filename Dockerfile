# OrcBot Docker Image
# Multi-stage build for smaller final image

# ============ Build Stage ============
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ============ Production Stage ============
FROM node:20-slim AS production

# Install system dependencies for Playwright (optional browser support)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    xdg-utils \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy additional assets
COPY apps/ ./apps/
COPY docs/ ./docs/

# Create data directory
RUN mkdir -p /root/.orcbot

# Set environment variables
ENV NODE_ENV=production
ENV ORCBOT_DATA_DIR=/root/.orcbot

# Expose gateway port
EXPOSE 3100

# Graceful shutdown
STOPSIGNAL SIGTERM

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/status').then(r=>{if(!r.ok)throw 1})" || exit 1

# Default command - start gateway with agent
CMD ["node", "dist/cli/index.js", "gateway", "--with-agent", "-s", "./apps/dashboard"]
