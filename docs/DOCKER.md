# Docker Deployment Guide

This guide explains how to run OrcBot using Docker.

## What is Docker?

Docker packages your application and all its dependencies into a **container** — a lightweight, portable unit that runs the same way everywhere. Think of it as a shipping container for software.

**Benefits:**
- ✅ No need to install Node.js, npm, or dependencies manually
- ✅ Runs identically on any machine (Windows, Mac, Linux, servers)
- ✅ Easy to start/stop and update
- ✅ Isolated from your system

## Prerequisites

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   - Windows/Mac: Download and install
   - Linux: `curl -fsSL https://get.docker.com | sh`

2. Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

## Quick Start

### Option 1: Minimal Setup (Recommended)

Uses Alpine Linux + Lightpanda browser for smallest footprint (~150MB):

```bash
# 1. Create environment file with your API keys
cp .env.example .env
# Edit .env with your keys (OPENAI_API_KEY, etc.)

# 2. Start OrcBot + Lightpanda
docker compose -f docker-compose.minimal.yml up -d

# 3. View logs
docker logs -f orcbot

# 4. Open dashboard
# http://localhost:3100
```

### Option 2: Full Setup

Includes Playwright browser support for full web automation:

```bash
# 1. Create environment file
cp .env.example .env

# 2. Start OrcBot
docker compose up -d

# 3. (Optional) Also start Lightpanda
docker compose --profile lightpanda up -d
```

## Commands

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start containers in background |
| `docker compose down` | Stop and remove containers |
| `docker compose logs -f` | Follow live logs |
| `docker compose restart` | Restart containers |
| `docker compose pull` | Update to latest images |
| `docker compose build --no-cache` | Rebuild from scratch |

## Configuration

### Environment Variables

Set these in your `.env` file:

```env
# Required (at least one)
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Optional channels
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...

# Optional gateway security
GATEWAY_API_KEY=your-secret
```

### Persistent Data

Data is stored in a Docker volume (`orcbot-data`). To access or backup:

```bash
# View volume location
docker volume inspect orcbot-data

# Backup data
docker run --rm -v orcbot-data:/data -v $(pwd):/backup alpine tar czf /backup/orcbot-backup.tar.gz /data

# Restore data
docker run --rm -v orcbot-data:/data -v $(pwd):/backup alpine tar xzf /backup/orcbot-backup.tar.gz -C /
```

### Custom Config File

Mount your own config file:

```yaml
# docker-compose.yml
services:
  orcbot:
    volumes:
      - orcbot-data:/root/.orcbot
      - ./my-config.yaml:/root/.orcbot/orcbot.config.yaml:ro
```

## Architecture

```
┌─────────────────────────────────────────────┐
│              Docker Network                 │
│                                             │
│  ┌─────────────┐      ┌─────────────────┐  │
│  │   OrcBot    │      │   Lightpanda    │  │
│  │  Container  │─────▶│    Container    │  │
│  │  :3100      │      │    :9222        │  │
│  └─────────────┘      └─────────────────┘  │
│         │                                   │
└─────────┼───────────────────────────────────┘
          │
          ▼
    ┌───────────┐
    │  Volume   │  (persistent data)
    │orcbot-data│
    └───────────┘
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs orcbot

# Common issues:
# - Missing API keys in .env
# - Port 3100 already in use (change in docker-compose.yml)
```

### Can't connect to dashboard
```bash
# Verify container is running
docker ps

# Check port mapping
docker port orcbot
```

### WhatsApp QR code
WhatsApp requires QR scanning. View it via logs:
```bash
docker logs orcbot
```

### Reset everything
```bash
# Stop and remove containers + volumes
docker compose down -v

# Remove image to rebuild
docker rmi orcbot-orcbot
```

## Building Custom Image

```bash
# Build locally
docker build -t my-orcbot .

# Build minimal version
docker build -f Dockerfile.minimal -t my-orcbot:minimal .

# Run custom image
docker run -d --name orcbot -p 3100:3100 --env-file .env my-orcbot
```

## Production Tips

1. **Use secrets management** — Don't commit `.env` files
2. **Set restart policy** — `restart: unless-stopped` handles crashes
3. **Monitor resources** — `docker stats orcbot`
4. **Use Lightpanda** — 9x less RAM than Playwright/Chrome
5. **Regular backups** — Volume snapshots or tar exports

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose build --no-cache
docker compose up -d
```
