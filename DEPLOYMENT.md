# Deployment Guide for OrcBot

OrcBot is designed to run as a **long-running service** on a server. Since it listens for Telegram messages and runs scheduled tasks, it needs to stay active.

## 1. Prerequisites
- A Virtual Private Server (VPS) (e.g., AWS EC2, DigitalOcean, Hetzner, Railway)
- Node.js installed (v18+)
- `npm` installed

## 2. Installation on Server

Clone your repository or copy the files to your server.

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## 3. Configuration

Create or edit your config file:
```bash
nano orcbot.config.yaml
```

Ensure you have your keys set:
```yaml
openaiApiKey: "sk-..."
telegramToken: "123..."
modelName: "gpt-4o"
```

## 4. Running with PM2 (Recommended)

`pm2` is a process manager that keeps your app running in the background and restarts it if it crashes.

```bash
# Install PM2 globally
npm install -g pm2

# Start OrcBot
# We point to the compiled CLI entry point
pm2 start dist/cli/index.js --name orcbot -- run
```

### Useful PM2 Commands
- **Logs**: `pm2 logs orcbot` (See what the agent is thinking/doing)
- **Stop**: `pm2 stop orcbot`
- **Restart**: `pm2 restart orcbot`

## 5. Running with Docker (Alternative)

You can also containerize the agent.

**Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["node", "dist/cli/index.js", "run"]
```

## How the Loop Works

1. **Wait State**: The agent sits idle, waiting for triggers (Scheduler Tick or Telegram Event).
2. **Event Trigger**: When you send a message on Telegram, the `TelegramChannel` receives it immediately.
3. **Queueing**: The message is converted into a **Task** (e.g., "Respond to user...") and pushed to the `ActionQueue`.
4. **Execution**: The `Agent` loop picks up the task, uses the LLM to decide on a response, and executes the `send_telegram` skill to reply back to you.
