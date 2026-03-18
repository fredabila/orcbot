# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsc compile → dist/ (also copies Chrome CDP files)
npm run build:fast     # esbuild fast bundle (node build.mjs)
npm run dev            # ts-node dev mode
npm test               # vitest run --reporter=dot
npm run test:watch     # vitest watch mode
npm start              # run compiled CLI from dist/
```

Run a single test file:
```bash
npx vitest run tests/decisionEngine.test.ts
```

## Architecture

OrcBot is an autonomous AI agent orchestrator. It plans multi-step tasks using a ReAct loop (Thought→Action→Observation), executes skills (tools), and delivers results over multiple channels. All state is file-backed under `~/.orcbot/` (or `ORCBOT_DATA_DIR`).

### Layer Map

| Layer | Key File(s) | Role |
|-------|-------------|------|
| CLI | `src/cli/index.ts` | Entrypoint, TUI menus, daemon management |
| Agent | `src/core/Agent.ts` | Main action loop, registers 80+ skills, wires all subsystems |
| Decision Engine | `src/core/DecisionEngine.ts` | Assembles prompt + context, calls LLM, validates response, runs termination review |
| Simulation | `src/core/SimulationEngine.ts` | Pre-plans execution before tools run |
| Parser | `src/core/ParserLayer.ts` | 3-tier fallback: strict JSON → relaxed → regex extraction |
| Decision Pipeline | `src/core/DecisionPipeline.ts` | Post-parse guardrails (dedup, loop detection, frequency limits) |
| Prompts | `src/core/prompts/` | 8 modular helpers (Core, Tooling, Browser, Research, …); PromptRouter injects only relevant ones |
| LLM Routing | `src/core/MultiLLM.ts` | `gemini*`→Google, `nvidia:*`→NVIDIA, `bedrock:*`→AWS, else OpenAI; auto-fallback |
| Skills Manager | `src/core/SkillsManager.ts` | Skill registry, dynamic plugin loading from `~/.orcbot/plugins/`, intent matching |
| Memory | `src/memory/MemoryManager.ts` | Short/episodic/long tiers + vector semantic search |
| Action Queue | `src/memory/ActionQueue.ts` | Priority-sorted durable queue with retry, chaining, TTL |
| Storage | `src/storage/JSONAdapter.ts` | Atomic JSON writes (temp→rename), `.bak` crash recovery |
| Channels | `src/channels/` | Telegram (Telegraf), WhatsApp (Baileys), Discord (discord.js), Web Gateway (Express+WS) |
| Browser | `src/tools/WebBrowser.ts` | Playwright + Serper/Google/Bing/DDG search chain, 2Captcha |
| Config | `src/config/ConfigManager.ts` | YAML hot-reload; never hardcode keys — use `ConfigManager.get()` |

### Action Loop (processNextAction)

1. Pick highest-priority pending action from queue
2. SimulationEngine pre-plans execution
3. Step loop (default max ~30 steps):
   - DecisionEngine → tools + reasoning
   - DecisionPipeline guard rails (see below)
   - Execute tools sequentially
   - Save step observations to memory
   - Check: `goals_met`, `forceBreak`, message budget
4. Review gate: second LLM pass confirms termination
5. Cleanup: save conclusion, `cleanupActionMemories()`, consolidate

### Guard Rails — Do Not Weaken

| Check | Threshold | Purpose |
|-------|-----------|---------|
| Consecutive non-deep turns | ≥5 | Kills planning/journal loops |
| Signature loop | 3× same tools+args | Kills identical repeats |
| Skill frequency | 5 standard / 15 research | Prevents runaway tool use |
| Pattern loop | 3× same 2-skill pattern | Kills alternating loops |
| Consecutive failures | 3 per skill | Stops beating dead horses |

## Memory System

Memory is the most complex subsystem and the #1 source of agent behavior bugs.

### Types

| Type | Lifespan | Purpose |
|------|----------|---------|
| `short` | Until consolidation (~30 entries) | Step observations, tool results, inbound messages |
| `episodic` | Permanent (last 5 shown in context) | LLM-generated summaries after consolidation |
| `long` | Permanent | Rarely injected directly; DailyMemory is the long-term store |

### Lifecycle for an Action

```
Action starts  → episodic "{id}-start"
  Each step    → short "{id}-step-{n}-{skill}"
  On error     → short "{id}-step-{n}-{skill}-error"  (prefixed [SYSTEM: ...])
Action ends    → episodic "{id}-conclusion"
               → cleanupActionMemories(id)  ← step memories DELETED
               → consolidate() if threshold reached
```

### Rules When Adding Memory Writes

1. Use `short` for per-action transient data; `episodic` for durable summaries
2. Always include `metadata: { actionId, step, skill }` at minimum
3. Keep content under 500 chars
4. Prefix system guidance with `[SYSTEM: ...]` so filters can skip it
5. If adding a new `saveMemory` call inside a step, use a unique suffix to avoid ID collisions

### Key Pitfalls

- **Cross-action pollution**: Old `[SYSTEM: ERROR...]` from action A misleading action B — `cleanupActionMemories()` is the fix; `otherMemories` filter excludes `[SYSTEM:]` + `-step-` IDs
- **Context overflow**: Actions with 20+ steps auto-compact (first 2 + last 5 verbatim; middle grouped by tool)
- **Concurrent writes**: JSONAdapter in-memory cache is authoritative; last writer wins but atomic writes prevent corruption

## Skills

### Adding a Core Skill

```typescript
this.skills.registerSkill({
    name: 'my_skill',
    description: 'What it does',
    usage: 'my_skill(arg1, arg2)',
    handler: async (args: any) => {
        try {
            return { success: true, result: 'data' };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    }
});
```

### Dynamic Plugins

Drop a `.ts` or `.js` file exporting `{ name, description, usage, handler }` into `~/.orcbot/plugins/`. Loaded without restart. Broken plugins trigger `self_repair_skill` automatically.

## Data Directory Layout

```
~/.orcbot/
├── orcbot.config.yaml    # Hot-reloadable main config
├── .env                  # API keys
├── memory.json           # Short + episodic memories (+ .bak, .tmp)
├── vector_memory.json    # Semantic search embeddings
├── action_queue.json     # Task queue
├── plugins/              # Dynamic skill plugins
├── memory/               # Daily markdown logs (YYYY-MM-DD.md)
└── profiles/             # Per-contact JSON profiles
```

Config CLI: `orcbot config set <key> <value>` / `orcbot config get <key>`

## Development Conventions

- Use `EventBus` over polling for background task wiring
- All file paths relative to data dir, not CWD
- Return `{ success: true/false, error?, ... }` from skill handlers
- Log via shared Winston logger: `src/utils/logger.ts`
- Retry/fallback via `ErrorHandler.withRetry()`: `src/utils/ErrorHandler.ts`
- VectorMemory is gracefully disabled when no embedding API key is set
