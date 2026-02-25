# Config Hot-Reload & WhatsApp Improvements

This document describes the new features added to OrcBot for better config management, WhatsApp control, and task management.

## Features Implemented

### 1. Config Hot-Reload (Live Updates)

The bot now automatically reloads configuration changes while running, without needing a restart.

**How it works:**
- ConfigManager watches the config file for changes
- When config is updated (via file edit or `orcbot config set`), a `config:changed` event is emitted
- Agent and channels listen for this event and reload their settings automatically

**Supported config hot-reload:**
- WhatsApp settings (auto-reply, status reply, auto-react, context profiling)
- Memory limits (context limit, episodic limit, consolidation thresholds)
- Future: Can be extended to other settings as needed

**Usage:**
```bash
# While bot is running, edit config:
orcbot config set whatsappAutoReplyEnabled true

# The bot will automatically reload and apply the new setting
# No restart required!
```

### 2. WhatsApp Status Media Download Control

**Problem Solved:** Bot was downloading ALL status media, even when you didn't want to interact with statuses.

**Solution:** 
- Status media is now only downloaded if `whatsappStatusReplyEnabled` is `true`
- Regular message media is always downloaded
- Logs clearly indicate when status media is skipped

**Config:**
```yaml
whatsappStatusReplyEnabled: false  # Skip status media downloads
whatsappStatusReplyEnabled: true   # Download status media for analysis
```

### 3. Strict Auto-Reply Enforcement

**Problem Solved:** Bot was sometimes replying to external messages even when auto-reply was disabled.

**Solution:**
- WhatsApp channel now caches config settings for faster access
- Clear checks before pushing tasks based on `whatsappAutoReplyEnabled`
- Logging shows when messages are skipped due to disabled auto-reply
- Owner messages are always processed regardless of auto-reply setting

**How it works:**
```typescript
// External message
if (this.autoReplyEnabled) {
  await this.agent.pushTask(...); // Only if enabled
} else {
  logger.info(`External message skipped - autoReplyEnabled is false`);
}

// Owner message
if (isFromOwner || isToMe) {
  await this.agent.pushTask(...); // Always processed
}
```

### 4. Enhanced Contact Profiling

Contact profiles are now more powerful and comprehensive.

**New Profile Features:**
- Automatic metadata tracking (JID, timestamps)
- Structured JSON format with consistent schema
- Enhanced storage in `~/.orcbot/profiles/`

**New Skills:**

#### `get_contact_profile(jid)`
Retrieve the stored profile for a WhatsApp contact.

**Usage:**
```javascript
{
  "name": "get_contact_profile",
  "args": {
    "jid": "1234567890@s.whatsapp.net"
  }
}
```

**Returns:**
```json
{
  "jid": "1234567890@s.whatsapp.net",
  "name": "John Doe",
  "preferences": ["tech", "music"],
  "notes": "Software developer, likes AI discussions",
  "createdAt": "2026-02-03T20:00:00.000Z",
  "lastUpdated": "2026-02-03T22:30:00.000Z"
}
```

#### `list_whatsapp_contacts(limit?)`
List recent WhatsApp contacts from memory.

**Usage:**
```javascript
{
  "name": "list_whatsapp_contacts",
  "args": {
    "limit": 10
  }
}
```

**Returns:**
```
Recent WhatsApp Contacts (10):

1. John Doe (1234567890@s.whatsapp.net)
   Last: Hey, can you help me with...
   Time: 2026-02-03T22:30:00.000Z

2. Jane Smith (0987654321@s.whatsapp.net)
   Last: Thanks for the information!
   Time: 2026-02-03T21:15:00.000Z
...
```

#### `search_chat_history(jid, limit?)`
Search chat history with a specific contact.

**Usage:**
```javascript
{
  "name": "search_chat_history",
  "args": {
    "jid": "1234567890@s.whatsapp.net",
    "limit": 5
  }
}
```

**Returns:**
```
Chat history with 1234567890@s.whatsapp.net (5 messages):

[2026-02-03T22:30:00.000Z] User John Doe said: Can you help me with Python?

[2026-02-03T22:25:00.000Z] User John Doe said: Hello!

[2026-02-03T21:00:00.000Z] User John Doe said: How are you?
...
```

#### `get_whatsapp_context(jid)`
Get comprehensive context about a contact (profile + recent chat).

**Usage:**
```javascript
{
  "name": "get_whatsapp_context",
  "args": {
    "jid": "1234567890@s.whatsapp.net"
  }
}
```

**Returns:**
```
=== WhatsApp Context for 1234567890@s.whatsapp.net ===

📋 PROFILE:
{
  "jid": "1234567890@s.whatsapp.net",
  "name": "John Doe",
  "preferences": ["tech", "music"],
  "notes": "Software developer, likes AI discussions"
}

💬 RECENT MESSAGES (5):
[2026-02-03T22:30:00.000Z] User John Doe said: Can you help me with Python?
[2026-02-03T22:25:00.000Z] User John Doe said: Hello!
...
```

### 5. Task Management Use Cases

With the new skills, you can now manage WhatsApp tasks more effectively:

**Example 1: Check a specific conversation**
```
User: "Check what John said in our last chat"

Agent uses:
1. list_whatsapp_contacts() to find John's JID
2. search_chat_history(john_jid, 10) to get recent messages
3. Summarizes for the user
```

**Example 2: Send a contextual message**
```
User: "Send Jane a message about the project we discussed"

Agent uses:
1. get_whatsapp_context(jane_jid) to retrieve profile and chat history
2. Understands the context of "the project"
3. send_whatsapp(jane_jid, "relevant message based on context")
```

**Example 3: Update contact information**
```
User: "Remember that Mike likes basketball"

Agent uses:
1. get_contact_profile(mike_jid) to retrieve existing profile
2. Updates profile with new information
3. update_contact_profile(mike_jid, updated_profile)
```

## Configuration Options

All WhatsApp features are controlled by these config options:

```yaml
# Enable/disable WhatsApp channel
whatsappEnabled: true

# Auto-reply to external messages
whatsappAutoReplyEnabled: false

# Reply to WhatsApp statuses
whatsappStatusReplyEnabled: false

# Auto-react to messages with emojis
whatsappAutoReactEnabled: false

# Learn from conversations and update profiles
whatsappContextProfilingEnabled: true

# Your WhatsApp number (auto-detected)
whatsappOwnerJID: "1234567890@s.whatsapp.net"
```

## Testing

Run the test suite to verify all features:

```bash
# Run all tests
npm test

# Run specific test
npm test tests/config-reload.test.ts

# Run manual integration test
node tests/manual-config-reload-test.js
```

## Technical Implementation

### Event Flow

```
Config File Change
    ↓
ConfigManager.startWatcher() detects change
    ↓
ConfigManager.loadConfig() reloads config
    ↓
emit('config:changed', { oldConfig, newConfig })
    ↓
Agent.setupEventListeners() receives event
    ↓
Detects which settings changed
    ↓
emit('whatsapp:config-changed', newConfig) if WhatsApp changed
    ↓
WhatsAppChannel.setupConfigListener() receives event
    ↓
Updates cached settings (autoReplyEnabled, etc.)
    ↓
New behavior takes effect immediately
```

### File Structure

```
~/.orcbot/
├── orcbot.config.yaml          # Main config (auto-reloaded)
├── profiles/                    # Contact profiles
│   ├── 1234567890_s_whatsapp_net.json
│   └── 0987654321_s_whatsapp_net.json
├── memory.json                  # Short-term memory
├── downloads/                   # Downloaded media
└── whatsapp-session/           # WhatsApp auth state
```

## Backward Compatibility

All changes are backward compatible:
- Existing configs work without modification
- New skills are optional (existing code unchanged)
- Old profile format is automatically upgraded
- No breaking changes to existing functionality

## Future Enhancements

Potential improvements for future releases:
- Real-time chat history from WhatsApp (not just memory)
- Group chat management skills
- Contact search by name/traits
- Bulk profile operations
- Profile-based smart replies
- Conversation sentiment tracking
