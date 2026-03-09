# OrcBot Docker Image
# Multi-stage build for smaller final image
# Supports Playwright, Puppeteer, and Lightpanda browser engines

# ============ Build Stage ============
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ============ Production Stage ============
FROM node:22-slim AS production

# Install system dependencies for:
# - Playwright browsers (chromium, firefox, webkit)
# - Puppeteer/Chrome
# - Sharp (image processing)
# - robotjs (desktop automation)
# - ffmpeg (video processing)
RUN apt-get update && apt-get install -y \
    # Core utilities
    ca-certificates \
    wget \
    curl \
    git \
    # Playwright/Puppeteer browser dependencies
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
    # Sharp/libvips dependencies
    libvips \
    libvips-tools \
    # Robotjs/X11 automation dependencies
    libx11-dev \
    libxext-dev \
    libxtst-dev \
    libxrender-dev \
    libxrandr-dev \
    libxi-dev \
    # ffmpeg dependencies
    ffmpeg \
    # Additional utilities
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
# Scripts are enabled; Puppeteer browser download is disabled via env vars, and Playwright is installed explicitly
RUN npm ci --omit=dev

# Install Playwright browsers (chromium, firefox, webkit) with full multi-browser support
RUN npx playwright install chromium firefox webkit --with-deps || true

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy additional assets
COPY apps/ ./apps/
COPY docs/ ./docs/
COPY AGENTS.md ./.AI.md ./LICENSE ./README.md ./USER.md ./JOURNAL.md ./LEARNING.md ./

# Create data directory
RUN mkdir -p /root/.orcbot

# Set environment variables
ENV NODE_ENV=production
ENV ORCBOT_DATA_DIR=/root/.orcbot
# Disable Puppeteer auto-download since we use Playwright
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Expose gateway port
EXPOSE 3100

# Graceful shutdown
STOPSIGNAL SIGTERM

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/status').then(r=>{if(!r.ok)throw 1})" || exit 1

# Default command - start gateway with agent
CMD ["node", "dist/cli/index.js", "gateway", "--with-agent", "-s", "./apps/dashboard"]
