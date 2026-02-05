# OpenClaw Memory Integration - Implementation Guide

This document describes the OpenClaw-inspired memory enhancements integrated into OrcBot.

## Overview

Based on analysis of [OpenClaw's memory system](https://github.com/openclaw/openclaw) and their [memory documentation](https://docs.openclaw.ai/concepts/memory), we've implemented key improvements to OrcBot's memory management:

1. **Daily Memory Logs** - Markdown-based daily logs (memory/YYYY-MM-DD.md)
2. **Long-Term Memory** - Curated durable facts (MEMORY.md)  
3. **Memory Tools** - Search and retrieval tools for agents
4. **Automatic Memory Flush** - Pre-consolidation memory preservation
5. **Bootstrap Files** - Workspace context injection (AGENTS.md, SOUL.md, etc.)

## Key Features

### 1. Daily Memory System

**File:** `src/memory/DailyMemory.ts`

Implements OpenClaw's markdown-based memory pattern:

```typescript
const dailyMemory = new DailyMemory();

// Append to today's log
dailyMemory.appendToDaily('User prefers morning notifications', 'Preferences');

// Read recent context (today + yesterday)
const context = dailyMemory.readRecentContext();

// Write to long-term memory
dailyMemory.appendToLongTerm('User is a TypeScript developer', 'Profile');
```

**File Structure:**
```
~/.orcbot/
├── MEMORY.md                    # Long-term curated memory
└── memory/
    ├── 2024-02-01.md           # Daily logs (append-only)
    ├── 2024-02-02.md
    └── 2024-02-03.md
```

### 2. Memory Tools

**File:** `src/skills/memoryTools.ts`

Four new agent skills for memory operations:

#### memory_search
Search across all memory files with context:
```json
{
  "tool": "memory_search",
  "query": "user preferences"
}
```

Returns snippets with file location and relevance scores.

#### memory_get  
Retrieve full content of specific memory files:
```json
{
  "tool": "memory_get", 
  "path": "MEMORY.md"
}
```

Supports: `MEMORY.md`, `today`, `yesterday`, `memory/YYYY-MM-DD.md`

#### memory_write
Write to daily or long-term memory:
```json
{
  "tool": "memory_write",
  "content": "Important fact to remember",
  "type": "long-term",
  "category": "User Profile"
}
```

#### memory_stats
Get memory system statistics and available files.

### 3. Automatic Memory Flush

**Integrated in:** `src/memory/MemoryManager.ts`

Inspired by OpenClaw's pre-compaction memory flush, OrcBot now automatically triggers a memory flush when approaching the consolidation threshold.

**How it works:**
1. Monitors short-term memory count
2. When approaching consolidation (soft threshold = 25 memories)
3. Triggers an LLM call to identify important information
4. Agent can use `memory_write` to preserve facts before consolidation
5. Prevents important context from being lost in consolidation

**Configuration:**
```typescript
memoryManager.setLimits({
    consolidationThreshold: 30,      // Full consolidation at 30 memories
    memoryFlushSoftThreshold: 25,    // Flush reminder at 25 memories
    memoryFlushEnabled: true          // Enable/disable feature
});
```

### 4. Bootstrap File System

**File:** `src/core/BootstrapManager.ts`

Implements OpenClaw's workspace bootstrap pattern with five context files:

#### IDENTITY.md
Agent name, version, capabilities, and purpose

#### SOUL.md  
Personality, tone, boundaries, and values

#### AGENTS.md
Operating instructions and core behaviors

#### TOOLS.md
Tool notes, conventions, and best practices

#### USER.md
User profile, preferences, and context

**Usage:**
```typescript
const bootstrap = new BootstrapManager();
bootstrap.initializeFiles();  // Create default templates

// Load all context
const context = bootstrap.loadBootstrapContext();

// Get formatted context for prompts
const formatted = bootstrap.getFormattedContext();
```

**Integration:**
Bootstrap files are automatically initialized in the Agent constructor and available via `agent.bootstrap`.

## Architecture Changes

### MemoryManager Enhancements

```typescript
class MemoryManager {
    private dailyMemory: DailyMemory;           // Daily log system
    private memoryFlushEnabled: boolean;        // Memory flush toggle
    private lastMemoryFlushAt: number;          // Flush throttling
    
    // New methods
    async memoryFlush(llm: MultiLLM): Promise<boolean>
    getDailyMemory(): DailyMemory
    getExtendedContext(): string
}
```

### Agent Integration

```typescript
class Agent {
    public bootstrap: BootstrapManager;   // Bootstrap files system
    
    constructor() {
        // ... existing initialization
        
        // Initialize bootstrap manager
        this.bootstrap = new BootstrapManager();
        this.bootstrap.initializeFiles();
        
        // Memory tools automatically registered
    }
}
```

## Benefits Over Previous System

### Before (JSON-only)
- Memories stored in opaque JSON
- No easy inspection or manual editing
- Single consolidation strategy
- No structured long-term memory
- Limited context injection

### After (Markdown + JSON)
- ✅ Human-readable markdown files
- ✅ Easy manual inspection and editing
- ✅ Dual-layer memory (daily + long-term)
- ✅ Automatic preservation of important facts
- ✅ Structured workspace context
- ✅ Search and retrieval tools
- ✅ Compatible with version control

## Usage Examples

### Example 1: Storing User Preferences

```typescript
// Agent receives: "I prefer to get notifications in the morning"

// System automatically writes to daily log
memory.getDailyMemory().appendToDaily(
    'User prefers morning notifications',
    'Preferences'
);

// Agent decides this is important for long-term
await agent.callTool('memory_write', {
    content: 'User prefers morning notifications (9-11 AM)',
    type: 'long-term',
    category: 'User Preferences'
});
```

### Example 2: Recalling Information

```typescript
// Later session - agent searches memory
const result = await agent.callTool('memory_search', {
    query: 'notification preferences'
});

// Returns:
// "1. **MEMORY.md** (score: 1.5)
// **>>> User prefers morning notifications (9-11 AM)**
//     Category: User Preferences
//     Updated: 2024-02-04"
```

### Example 3: Memory Flush Workflow

```typescript
// System detects 25+ memories, triggers flush
await memoryManager.memoryFlush(llm);

// LLM analyzes recent context:
// "Important: User mentioned project deadline Feb 15"

// Agent preserves important information
await agent.callTool('memory_write', {
    content: 'Project deadline: February 15, 2024',
    type: 'long-term',
    category: 'Current Projects'
});

// Then consolidation proceeds safely
await memoryManager.consolidate(llm);
```

## Configuration

### Memory Limits

Update in agent initialization or via config:

```typescript
agent.memory.setLimits({
    contextLimit: 20,                    // Recent memories in context
    episodicLimit: 5,                    // Episodic summaries to include
    consolidationThreshold: 30,          // Trigger consolidation
    consolidationBatch: 20,              // Memories per batch
    memoryFlushSoftThreshold: 25,        // Trigger flush reminder
    memoryFlushEnabled: true             // Enable memory flush
});
```

### Bootstrap Files

Customize templates in `BootstrapManager.getDefaultTemplates()` or edit files directly:

```bash
~/.orcbot/
├── IDENTITY.md
├── SOUL.md
├── AGENTS.md
├── TOOLS.md
└── USER.md
```

## Future Enhancements

Based on OpenClaw's advanced features, potential future additions:

1. **Vector Search** - Semantic search with embeddings (OpenClaw has OpenAI/Gemini/local support)
2. **Hybrid Search** - BM25 + vector search for better recall
3. **Session Indexing** - Index session transcripts for search
4. **Memory Citations** - Auto-cite sources in responses
5. **QMD Backend** - External search sidecar integration

## Testing

The memory system can be tested via:

```bash
# Start OrcBot
npm run dev

# Test memory tools
> orcbot push "Write to memory: TypeScript is my favorite language" -p 10
> orcbot push "Search memory for: favorite language" -p 10
> orcbot push "Show memory stats" -p 10
```

## References

- **OpenClaw Repository:** https://github.com/openclaw/openclaw
- **OpenClaw Memory Docs:** https://docs.openclaw.ai/concepts/memory
- **OpenClaw Agent Runtime:** https://docs.openclaw.ai/concepts/agent
- **Implementation Files:**
  - `src/memory/DailyMemory.ts`
  - `src/skills/memoryTools.ts`
  - `src/core/BootstrapManager.ts`
  - `src/memory/MemoryManager.ts` (enhanced)
  - `src/core/Agent.ts` (integration)

## Summary

This integration brings OpenClaw's production-tested memory patterns to OrcBot:

- **Markdown-based** memory for transparency
- **Dual-layer** system (daily + long-term)
- **Automatic preservation** via memory flush
- **Structured workspace** context
- **Search and retrieval** tools
- **Backward compatible** with existing JSON system

The system is designed to scale from personal use to production deployments while maintaining human-readable, version-controllable memory files.
