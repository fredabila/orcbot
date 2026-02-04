# Polling System and Discord Integration

This document describes the new features added to OrcBot: the Polling System and Discord channel integration.

## Polling System

The Polling System provides a generic polling mechanism that prevents agents from constantly looping to check conditions. Instead of busy-waiting, agents can register polling jobs that check conditions at configurable intervals.

### Architecture

- **PollingManager** (`src/core/PollingManager.ts`): Main polling service
- **Event-Driven**: Emits events via EventBus for polling lifecycle
- **Configurable**: Each job has its own interval and max attempts
- **Non-Blocking**: Runs in background without blocking agent execution

### Available Skills

#### 1. `register_polling_job`
Register a new polling job to check a condition periodically.

**Parameters:**
- `job_id` (string): Unique identifier for the job
- `description` (string): Human-readable description
- `condition_type` (string): Type of condition to check (see below)
- `condition_params` (object): Parameters specific to the condition type
- `interval_ms` (number): Polling interval in milliseconds (default: 5000)
- `max_attempts` (number, optional): Maximum number of attempts before failing

**Supported Condition Types:**
1. **file_exists** - Checks if a file exists at a path
   - Parameters: `path` or `file_path` (string)
2. **memory_contains** - Searches recent memories for text
   - Parameters: `text` or `search` (string)
3. **task_status** - Checks if a task has reached a specific status
   - Parameters: `task_id` or `id` (string), `status` (string, default: "completed")
4. **custom_check** - Looks for custom check results in memory (format: "key:true")
   - Parameters: `check_key` or `key` (string)

**Example (file_exists):**
```json
{
  "skill": "register_polling_job",
  "args": {
    "job_id": "wait_for_report",
    "description": "Wait for report file to be created",
    "condition_type": "file_exists",
    "condition_params": {
      "path": "/path/to/report.pdf"
    },
    "interval_ms": 5000,
    "max_attempts": 20
  }
}
```

**Example (memory_contains):**
```json
{
  "skill": "register_polling_job",
  "args": {
    "job_id": "wait_for_approval",
    "description": "Wait for approval message",
    "condition_type": "memory_contains",
    "condition_params": {
      "text": "approved"
    },
    "interval_ms": 10000,
    "max_attempts": 30
  }
}
```

**Example (task_status):**
```json
{
  "skill": "register_polling_job",
  "args": {
    "job_id": "wait_for_task",
    "description": "Wait for background task completion",
    "condition_type": "task_status",
    "condition_params": {
      "task_id": "background-task-123",
      "status": "completed"
    },
    "interval_ms": 3000
  }
}
```

#### 2. `cancel_polling_job`
Cancel an active polling job.

**Parameters:**
- `job_id` (string): The job ID to cancel

**Example:**
```json
{
  "skill": "cancel_polling_job",
  "args": {
    "job_id": "check_email_response"
  }
}
```

#### 3. `get_polling_status`
Get status of a specific job or list all active jobs.

**Parameters:**
- `job_id` (string, optional): Job ID to check. If omitted, lists all active jobs.

**Example:**
```json
{
  "skill": "get_polling_status",
  "args": {
    "job_id": "check_email_response"
  }
}
```

### EventBus Events

The PollingManager emits the following events:

- `polling:started` - When polling manager starts
- `polling:stopped` - When polling manager stops
- `polling:registered` - When a new job is registered
- `polling:progress` - On each polling attempt
- `polling:success` - When a job completes successfully
- `polling:failure` - When a job fails (max attempts reached)
- `polling:error` - When a job encounters an error
- `polling:cancelled` - When a job is cancelled

## Discord Integration

Discord channel integration allows OrcBot to connect to Discord servers and interact with users.

### Setup

1. **Create a Discord Bot:**
   - Visit [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the bot token
   - Enable "Message Content Intent" under Privileged Gateway Intents

2. **Configure in OrcBot:**
   - Run `orcbot ui` or `npm run dev`
   - Navigate to "Manage Connections" → "Discord Bot"
   - Set your bot token
   - Enable/disable auto-reply as needed
   - Restart OrcBot for token changes to take effect

3. **Invite Bot to Server:**
   - In Discord Developer Portal, go to OAuth2 → URL Generator
   - Select scopes: `bot`
   - Select permissions: `Send Messages`, `Read Messages`, `Attach Files`, etc.
   - Copy and visit the generated URL to add bot to your server

### Available Skills

#### 1. `send_discord`
Send a message to a Discord channel.

**Parameters:**
- `channel_id` (string): Discord channel ID
- `message` (string): Message content (max 2000 characters, auto-splits if longer)

**Example:**
```json
{
  "skill": "send_discord",
  "args": {
    "channel_id": "1234567890123456789",
    "message": "Hello from OrcBot!"
  }
}
```

#### 2. `send_discord_file`
Send a file to a Discord channel with optional caption.

**Parameters:**
- `channel_id` (string): Discord channel ID
- `file_path` (string): Path to the file to send
- `caption` (string, optional): Message to accompany the file

**Example:**
```json
{
  "skill": "send_discord_file",
  "args": {
    "channel_id": "1234567890123456789",
    "file_path": "/path/to/file.pdf",
    "caption": "Here's the report you requested"
  }
}
```

#### 3. `get_discord_guilds`
Get list of Discord servers (guilds) the bot is in.

**Example:**
```json
{
  "skill": "get_discord_guilds",
  "args": {}
}
```

#### 4. `get_discord_channels`
Get list of text channels in a Discord server.

**Parameters:**
- `guild_id` (string): Discord server (guild) ID

**Example:**
```json
{
  "skill": "get_discord_channels",
  "args": {
    "guild_id": "1234567890123456789"
  }
}
```

### Auto-Reply Feature

When auto-reply is enabled:
- Bot automatically processes incoming messages
- Messages are saved to agent memory
- Tasks are created with appropriate priority (higher for DMs)
- Agent can respond using decision engine

### Message Handling

- **Text Messages**: Automatically saved to memory with metadata
- **Attachments**: Logged and saved to memory with download URLs
- **DMs vs Server Messages**: DMs get higher priority (8 vs 6)
- **Bot Messages**: Ignored to prevent loops

### Configuration Keys

The following configuration keys are used:

- `discordToken`: Discord bot token
- `discordAutoReplyEnabled`: Enable/disable automatic replies (default: false)

### TUI Menu

Access Discord configuration via:
```
Main Menu → Manage Connections → Discord Bot
```

Options:
- Set Bot Token
- Enable/Disable Auto-Reply
- Test Connection (shows connected servers)
- Back

## Architecture Notes

### Channel Integration Pattern

Both Discord and other channels (Telegram, WhatsApp) follow the same pattern:

1. Implement `IChannel` interface
2. Register in `Agent.setupChannels()`
3. Add to start/stop lifecycle
4. Register channel-specific skills
5. Add TUI configuration menu

### Event-Driven Design

Discord uses event-driven architecture (via discord.js library), which means:
- No polling needed for message reception
- Connection is persistent via WebSocket
- Low latency for incoming messages
- Automatic reconnection handling

### Integration with Agent

The Discord channel integrates with OrcBot's core features:
- **Memory**: Messages saved with full metadata
- **Action Queue**: Auto-reply creates prioritized tasks
- **Skills**: Agent can use Discord skills in decision flow
- **EventBus**: Lifecycle events for monitoring

## Best Practices

### Polling System

1. **Use Appropriate Intervals**: Don't poll too frequently (minimum 5 seconds recommended)
2. **Set Max Attempts**: Always set max_attempts to prevent infinite polling
3. **Clean Up**: Cancel jobs when no longer needed
4. **Monitor Events**: Subscribe to EventBus events for job lifecycle tracking

### Discord Integration

1. **Protect Your Token**: Never commit tokens to source control
2. **Manage Permissions**: Only grant necessary bot permissions
3. **Handle Rate Limits**: Discord has rate limits; the channel handles splits automatically
4. **Use Channel IDs**: Right-click channels in Discord (Developer Mode) to copy IDs
5. **Test Locally First**: Use the "Test Connection" feature before deploying

## Troubleshooting

### Polling System

- **Jobs Not Running**: Check if PollingManager is started (automatic with agent.start())
- **Jobs Failing**: Check logs for specific error messages
- **Jobs Not Stopping**: Use cancel_polling_job or check max_attempts

### Discord

- **Connection Failed**: Verify token is correct and Message Content Intent is enabled
- **Bot Not Responding**: Check auto-reply is enabled and bot has required permissions
- **Messages Not Sending**: Verify channel ID is correct and bot has access
- **Rate Limit Errors**: Reduce message frequency or check Discord API limits

## Examples

### Example 1: Wait for File Upload (Polling)

```json
{
  "skill": "register_polling_job",
  "args": {
    "job_id": "wait_for_upload",
    "description": "Wait for user to upload report file",
    "condition_type": "file_exists",
    "condition_params": {
      "path": "/home/user/uploads/report.pdf"
    },
    "interval_ms": 5000,
    "max_attempts": 60
  }
}
```

### Example 2: Wait for Approval in Memory

```json
{
  "skill": "register_polling_job",
  "args": {
    "job_id": "wait_for_approval",
    "description": "Wait for manager approval message",
    "condition_type": "memory_contains",
    "condition_params": {
      "text": "APPROVED"
    },
    "interval_ms": 10000,
    "max_attempts": 30
  }
}
```

### Example 3: Send Discord Notification

```json
{
  "skill": "send_discord",
  "args": {
    "channel_id": "1234567890123456789",
    "message": "Daily report completed. All systems operational."
  }
}
```

### Example 4: List Discord Channels and Send Message

```json
[
  {
    "skill": "get_discord_guilds",
    "args": {}
  },
  {
    "skill": "get_discord_channels",
    "args": {
      "guild_id": "SERVER_ID_FROM_PREVIOUS_RESULT"
    }
  },
  {
    "skill": "send_discord",
    "args": {
      "channel_id": "CHANNEL_ID_FROM_PREVIOUS_RESULT",
      "message": "Hello everyone!"
    }
  }
]
```

## Future Enhancements

Potential improvements for future releases:

### Polling System
- Condition-based polling with custom predicates
- Dynamic interval adjustment based on success rate
- Polling job persistence across restarts
- Priority-based polling queue

### Discord Integration
- Slash commands support
- Rich embeds and reactions
- Voice channel integration
- Thread support
- Role management
- Webhook support

## Support

For issues or questions:
- Check logs in `~/.orcbot/logs/`
- Review EventBus events for debugging
- Consult main OrcBot documentation
- Submit issues on GitHub repository
