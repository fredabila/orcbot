# OrcBot AI Coding Instructions

## Project Overview
OrcBot is a TypeScript/Node.js autonomous AI agent that can chat over Telegram, WhatsApp, Discord, and a web gateway. It plans multi-step tasks, executes tools (skills), browses the web, and learns from its interactions. All state is file-backed under `~/.orcbot/` by default.

---

## Architecture Map

| Layer | File(s) | Role |
|-------|---------|------|
| **CLI entrypoint** | [src/cli/index.ts](src/cli/index.ts) | Wires all subsystems, TUI menus, user commands |
| **Core agent** | [src/core/Agent.ts](src/core/Agent.ts) | Orchestrates memory, LLM, skills, channels, scheduling; runs the main action loop |
| **Decision engine** | [src/core/DecisionEngine.ts](src/core/DecisionEngine.ts) | Assembles context + prompt, calls LLM, validates response, runs termination review |
| **Modular prompts** | [src/core/prompts/](src/core/prompts/) | 8 task-specific helpers + PromptRouter; only relevant helpers are injected per task |
| **Simulation/planning** | [src/core/SimulationEngine.ts](src/core/SimulationEngine.ts) | Produces a pre-plan before execution starts |
| **Parser** | [src/core/ParserLayer.ts](src/core/ParserLayer.ts) | Normalizes raw LLM text into structured JSON (3-tier fallback) |
| **Context compactor** | [src/core/ContextCompactor.ts](src/core/ContextCompactor.ts) | Truncation and LLM-based summarization for oversized context |
| **Decision pipeline** | [src/core/DecisionPipeline.ts](src/core/DecisionPipeline.ts) | Post-parse guardrails on tool calls |
| **Memory** | [src/memory/MemoryManager.ts](src/memory/MemoryManager.ts) | Short/episodic/long memory in JSON, consolidation, daily markdown logs |
| **Action queue** | [src/memory/ActionQueue.ts](src/memory/ActionQueue.ts) | Priority-sorted durable queue with retry, chaining, TTL, stale recovery |
| **Storage** | [src/storage/JSONAdapter.ts](src/storage/JSONAdapter.ts) | Atomic JSON persistence with backup/recovery |
| **LLM routing** | [src/core/MultiLLM.ts](src/core/MultiLLM.ts) | Routes by model name (gemini→Google, nvidia:→NVIDIA, else OpenAI), auto-fallback |
| **Skills manager** | [src/core/SkillsManager.ts](src/core/SkillsManager.ts) | Registry, dynamic plugin loading, skill matching |
| **Channels** | [src/channels/](src/channels/) | Telegram (Telegraf), WhatsApp (Baileys), Discord (discord.js), Gateway (Express+WS) |
| **Browser** | [src/tools/WebBrowser.ts](src/tools/WebBrowser.ts) | Playwright with semantic snapshots, Serper search, 2Captcha |
| **Scheduler** | [src/core/Scheduler.ts](src/core/Scheduler.ts) | Cron-based via croner, emits `scheduler:tick` on EventBus |
| **Config** | [src/config/ConfigManager.ts](src/config/ConfigManager.ts) | YAML hot-reload, feature toggles, API keys |
| **Token tracking** | [src/core/TokenTracker.ts](src/core/TokenTracker.ts) | Per-model token/cost tracking and budgets |
| **Runtime tuner** | [src/core/RuntimeTuner.ts](src/core/RuntimeTuner.ts) | Auto-adjusts limits based on runtime signals |

---

## Memory System (Critical — Read This First)

Memory is the most complex subsystem and the #1 source of agent behavior bugs. Understand these layers:

### Storage Layer
- **JSONAdapter** ([src/storage/JSONAdapter.ts](src/storage/JSONAdapter.ts)): Atomic writes (temp→rename), `.bak` crash recovery, in-memory cache. Every `saveMemory` serializes the full array — keep memory count reasonable.
- **DailyMemory** ([src/memory/DailyMemory.ts](src/memory/DailyMemory.ts)): Append-only markdown files (`YYYY-MM-DD.md`). Good for auditing but **not read by the decision engine** — only accessible via `memory_search`/`memory_get` skills.
- **VectorMemory** ([src/memory/VectorMemory.ts](src/memory/VectorMemory.ts)): Embedding-based semantic index for similarity search. File-backed JSON (`vector_memory.json`) with atomic writes. Uses OpenAI `text-embedding-3-small` (256 dims) or Google `text-embedding-004` as fallback. Gracefully disabled when no embedding API key is configured.

### Memory Types
| Type | Lifespan | Purpose |
|------|----------|---------|
| `short` | Until consolidation (~30 entries) | Step observations, tool results, system injections, inbound messages |
| `episodic` | Permanent (last 5 shown in context) | LLM-generated summaries of consolidated short memories; action conclusions |
| `long` | Permanent | Rarely used directly; DailyMemory's MEMORY.md is the long-term store |

### How Memory Flows into LLM Prompts
1. `getRecentContext()` returns the 20 most-recent short memories + last 5 episodic summaries
2. DecisionEngine splits these into:
   - **Step History** — entries with `{actionId}-step-*` prefix → ground truth for current task
   - **Other Context** — up to 5 recent memories from other sources (filtered to exclude cross-action `[SYSTEM:]` injections)
   - **Thread Context** — from `searchMemory('short')`, filtered by source+chatId, ranked by semantic similarity (vector memory) or keyword overlap (fallback) → the conversation thread
3. Joins with: core instructions, channel context, user profile, journal tail, learning tail

### Memory Lifecycle for an Action
```
Action starts → episodic "{id}-start"
  Step 1 → short "{id}-step-1-{skill}"       (tool observation)
  Step 1 → short "{id}-step-1-{skill}-error"  (system injection if error)
  Step N → ...
Action completes → episodic "{id}-conclusion"
                → cleanupActionMemories(id)    ← step memories DELETED
                → consolidate() runs if threshold reached
```

### Step History Compaction
When an action has >10 step memories, the DecisionEngine proactively compacts:
- First 2 steps preserved verbatim (task orientation)
- Last 5 steps preserved verbatim (recent context)
- Middle steps compressed: grouped by tool with success/failure counts

### Known Memory Pitfalls (Prevent These)
- **Cross-action pollution**: Old `[SYSTEM: ERROR...]` memories from action A misleading action B. Mitigation: `cleanupActionMemories()` runs on completion; `otherMemories` filters `[SYSTEM:]`+`-step-` IDs.
- **Step-history context overflow**: Actions with 20+ steps can overflow context. Mitigation: proactive compaction in DecisionEngine.
- **Consolidation metadata loss**: Summary erases individual metadata. Mitigation: consolidation preserves a metadata index (sources, contacts, skills, time range).
- **Concurrent writes**: Channel listeners and action loop both call `saveMemory`. JSONAdapter's in-memory cache is authoritative; last writer wins but atomic writes prevent corruption.
- **Memory ID collisions**: Multiple tools in one step can collide on `{actionId}-step-{n}-{skill}`. If adding new `saveMemory` calls, use a unique suffix.

### When Adding New Memory Writes
1. Use type `short` for transient per-action data; `episodic` for durable summaries
2. Always include `metadata` with `{ actionId, step, skill }` at minimum
3. Keep content under 500 chars — it will be injected into LLM prompts
4. Prefix system guidance with `[SYSTEM: ...]` so filters can identify it
5. Never store secrets or API keys in memory

### Memory Helper Methods
- `getActionMemories(actionId)` — all step memories for one action (chronological)
- `getActionStepCount(actionId)` — count of step memories (for compaction decisions)
- `cleanupActionMemories(actionId)` — removes all step memories after action completes (JSON + vector)
- `getRecentContext(limit?)` — top N short + last 5 episodic (default limit=20)
- `searchMemory(type)` — all memories of a type
- `semanticSearch(query, limit, filter?)` — vector similarity search across all indexed memories
- `initVectorMemory(config)` — initialize vector memory with API keys (called by Agent after construction)
- `getExtendedContext()` — daily memory + long-term (currently not wired into DecisionEngine)

---

## Action Queue

[src/memory/ActionQueue.ts](src/memory/ActionQueue.ts) is the durable task queue:
- **In-memory cache** with periodic flush (5s) and atomic disk writes
- **Priority-sorted**: lower number = higher priority
- **Retry with backoff**: `retry: { maxAttempts, attempts, baseDelay }` — failed actions auto-requeue
- **Action chaining**: `dependsOn` field, `pushAfter(parentId, action)`, `pushChain(actions[])`
- **TTL cleanup**: completed (24h), failed (72h) auto-expire; stale in-progress (30min) auto-reset
- **Lifecycle**: `shutdown()` stops timers + final flush; `reload()` re-reads from disk
- Use EventBus (`action:push`, `action:queued`) for reactive wiring, not polling

---

## Agent Execution Loop

The main loop in `processNextAction()`:
1. **Pick** highest-priority pending action from queue
2. **Simulate** (SimulationEngine) → execution plan
3. **Loop** (max steps from config, default ~30):
   a. Send typing indicator
   b. Call DecisionEngine → get tools + reasoning + verification
   c. Run guard rails: dedup, planning-loop, signature-loop, skill-frequency, pattern-loop
   d. Execute tools sequentially
   e. Save observations to memory
   f. Check: goals_met, forceBreak, message budget, waiting-for-clarification
4. **Review gate** — if terminating, a second LLM pass confirms
5. **Cleanup** — save conclusion, cleanup step memories, consolidate

### Guard Rails (Do Not Weaken)
| Check | Threshold | Purpose |
|-------|-----------|---------|
| Consecutive non-deep turns | ≥5 | Kills planning loops (journal/learning spam) |
| Signature loop | 3x same tools+args | Kills identical repeat calls |
| Skill frequency | 5 (standard) / 15 (research) | Prevents runaway tool use |
| Pattern loop | 3x same 2-skill pattern with same args | Kills alternating loops |
| Consecutive failures | 3 per skill | Stops beating dead horses |
| Message budget | configurable | Prevents message spam to user |
| Communication cooldown | No deep tool since last msg | Blocks empty status updates |
| File delivery break | send_file success on file-centric task | Prevents re-read loops |

---

## Skills System

- **Core skills** registered in [Agent.ts](src/core/Agent.ts): `send_telegram`, `send_whatsapp`, `send_discord`, `send_file`, `web_search`, `browser_navigate`, `browser_click`, `run_command`, `write_file`, `read_file`, `schedule_task`, etc.
- **Dynamic plugins** loaded from `~/.orcbot/plugins/` by [SkillsManager](src/core/SkillsManager.ts). Must export `{ name, description, usage, handler }`. Handler receives `(args, context)` where context has `{ browser, config, agent, logger }`.
- **Plugin repair**: Broken plugins trigger `self_repair_skill` task. Keep plugins CommonJS-friendly.
- **Skill matching**: `matchSkillsForTask()` activates relevant skills per-task (progressive disclosure).

---

## Channels

| Channel | File | Transport | Notes |
|---------|------|-----------|-------|
| Telegram | [TelegramChannel.ts](src/channels/TelegramChannel.ts) | Telegraf | Chunks long messages; sends typing indicators |
| WhatsApp | [WhatsAppChannel.ts](src/channels/WhatsAppChannel.ts) | Baileys | Ensures `@s.whatsapp.net` suffix; QR auth |
| Discord | [DiscordChannel.ts](src/channels/DiscordChannel.ts) | discord.js | Channel-based messaging |
| Gateway | [src/gateway/](src/gateway/) | Express + WebSocket | Web chat interface |

All channels write inbound messages to memory as `short` entries and push tasks to ActionQueue when auto-reply is enabled.

---

## Prompt System

[src/core/prompts/](src/core/prompts/) contains modular helpers:
- **CoreHelper** (always on): identity, JSON contract, base rules
- **ToolingHelper** (always on): tool-calling patterns, error handling
- **CommunicationHelper**: messaging etiquette, channel rules
- **BrowserHelper**: navigation, clicking, snapshot interpretation
- **ResearchHelper**: search strategy, source evaluation, file delivery
- **SchedulingHelper**: cron patterns, temporal reasoning
- **MediaHelper**: file handling, format conversion, delivery workflow
- **ProfileHelper**: contact profiling rules

**PromptRouter** analyzes the task description and activates only relevant helpers — typically saving 5-10K characters per prompt.

---

## Data Paths

All user data lives under `~/.orcbot/` (or `ORCBOT_DATA_DIR`):
```
~/.orcbot/
├── orcbot.config.yaml    # Main config (hot-reloadable)
├── .env                  # API keys
├── memory.json           # Short + episodic memories (+ .bak, .tmp)
├── vector_memory.json    # Embedding vectors for semantic search (+ .bak, .tmp)
├── action_queue.json     # Task queue (+ .bak, .tmp)
├── JOURNAL.md            # Agent reflections
├── LEARNING.md           # Knowledge base
├── USER.md               # User profile
├── MEMORY.md             # Long-term curated facts
├── profiles/             # Per-contact JSON profiles
├── plugins/              # Dynamic skill plugins
├── downloads/            # Media downloads
├── memory/               # Daily markdown logs (YYYY-MM-DD.md)
├── bootstrap/            # First-run skill specs
└── schedules/            # Persisted scheduled tasks
```

---

## Config & Feature Toggles

ConfigManager ([src/config/ConfigManager.ts](src/config/ConfigManager.ts)) reads `orcbot.config.yaml` with hot-reload. Key knobs:
- `maxSteps`, `maxMessages` — action loop limits
- `sudoMode` — bypass autonomy safety gates
- `decisionEngineAutoCompaction` — enable/disable reactive context compaction
- `memoryFlushEnabled` — pre-consolidation memory flush
- Channel tokens: `telegramToken`, `openaiApiKey`, `googleApiKey`, `nvidiaApiKey`
- CLI: `orcbot config set key value` / `orcbot config get key`

---

## LLM Routing

[MultiLLM](src/core/MultiLLM.ts) routes by model prefix:
- `gemini*` → Google Generative AI
- `nvidia:*` → NVIDIA API (OpenAI-compatible)
- `bedrock:*` → AWS Bedrock
- Everything else → OpenAI

Auto-fallback: if primary provider fails, tries the other. Pass `systemMessage` to `call()`.

---

## Browser Tooling

[WebBrowser](src/tools/WebBrowser.ts) wraps Playwright:
- Semantic snapshots with `data-orcbot-ref` selectors for click/type targets
- Search chain: Serper API → Google → Bing → DuckDuckGo
- 2Captcha integration for CAPTCHA solving
- Blank-page detection counter (`_blankPageCount`) with template-placeholder guard

---

## Testing

- **Framework**: Vitest (`npx vitest run`)
- **Test files**: `tests/*.test.ts` (currently 13 files, 139+ tests)
- **Build**: `npm run build` → tsc to `dist/`
- **Dev**: `npm run dev` → ts-node
- **Manual**: `orcbot ui` for TUI, channel simulators

---

## Development Style Guide

- TypeScript-first, strict types where practical
- File-backed persistence over databases (portability)
- Event-driven (EventBus) over polling for background tasks
- Minimal external deps — prefer builtins
- Never hardcode API keys — use `ConfigManager.get()`
- All paths relative to data dir, not CWD
- Keep `saveMemory` content concise (<500 chars)
- Use structured `{ success: true/false, error?, ... }` returns from skill handlers
- Log via shared Winston logger (`src/utils/logger.ts`)
- Retry/fallback via `ErrorHandler.withRetry()` (`src/utils/ErrorHandler.ts`)

---

## Common Patterns

### Adding a New Skill
```typescript
this.skills.registerSkill({
    name: 'my_skill',
    description: 'What it does',
    usage: 'my_skill(arg1, arg2)',
    handler: async (args: any) => {
        try {
            // Do work
            return { success: true, result: 'data' };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    }
});
```

### Adding a New Channel Listener
```typescript
channel.on('message', (msg) => {
    this.memory.saveMemory({
        id: `channel-${Date.now()}`,
        type: 'short',
        content: `Channel message from ${msg.sender}: ${msg.text}`,
        metadata: { source: 'channel-name', sourceId: msg.chatId, ... }
    });
    if (autoReply) {
        this.actionQueue.push({ id: generateId(), status: 'pending', priority: 5, payload: { ... } });
    }
});
```

### Triggering Self-Improvement
The agent auto-creates plugins when skills fail repeatedly. See `triggerSkillCreationForFailure()` in Agent.ts. Plugins land in `~/.orcbot/plugins/` and are loaded on next tick.

---

## Extending the System

### Persistent Memory Improvements
- DailyMemory exists but is not wired into DecisionEngine — to surface long-term facts, either make the agent use `memory_search` skill or add `getExtendedContext()` output to the prompt
- VectorMemory is now implemented and wired: `saveMemory()` auto-queues embeddings; DecisionEngine uses `semanticSearch()` for thread context relevance ranking with keyword fallback
- The ContextCompactor is functional and wired reactively on context overflow — it could also be called proactively before every LLM call for consistently large actions

### New LLM Providers
Add a new branch in `MultiLLM.call()` keyed on model prefix. Follow the pattern of existing providers (API key from config, error handling, response extraction).

### New Channels
Implement `IChannel` interface, register in Agent.ts constructor, add inbound message → memory + actionQueue wiring. See existing channels for the pattern.
