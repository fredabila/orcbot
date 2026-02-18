---
title: OrcBot: Building an Autonomous AI Agent That Actually Works in Production
published: true
description: A deep dive into the architecture, memory system, guard rails, and production lessons from building a self-hosted multi-channel AI agent in TypeScript.
tags: ai, nodejs, typescript, opensource
---

I've been building OrcBot — an autonomous AI agent framework written in TypeScript/Node.js — and wanted to share what it actually takes to get a multi-channel AI agent running reliably in production. This isn't a "wrap the OpenAI API in three lines" tutorial. This is the messy, real stuff.

## What Is OrcBot?

OrcBot is a self-hosted autonomous AI agent. You run it on your own machine or server, connect it to Telegram, WhatsApp, Discord, or a web gateway, and it handles multi-step tasks on your behalf — browsing the web, writing and running code, scheduling work, managing files, and learning from its interactions over time.

Think of it less like a chatbot and more like a background worker that understands natural language.

```
User (Telegram): "Find me the latest Node.js LTS release notes and summarize them"
OrcBot: [searches the web, reads the page, summarizes, sends reply]
```

It does this without you having to specify *how* — it figures out the steps, executes them, and delivers the result.

## Architecture Overview

OrcBot is structured around a few key layers:

```
CLI / Channel (Telegram, WhatsApp, Discord, Gateway)
         ↓
   ActionQueue  ←→  MemoryManager
         ↓
      Agent (main loop)
         ↓
  SimulationEngine → DecisionEngine → ParserLayer
         ↓
    SkillsManager (web, files, shell, messaging…)
         ↓
      MultiLLM (OpenAI / Google / NVIDIA / Bedrock / OpenRouter)
```

Every inbound message becomes a **task** pushed onto a durable, priority-sorted `ActionQueue`. The agent picks up tasks, plans them with a `SimulationEngine`, then runs a decision loop — calling tools, observing results, and iterating until the goal is met or it decides it's done.

## The Memory System

This is where most agent frameworks fall apart, and where OrcBot does something different.

Memory has three tiers:

| Type | Lifespan | Purpose |
|---|---|---|
| `short` | Until consolidation | Per-step tool results, observations, inbound messages |
| `episodic` | Permanent | LLM-generated summaries of completed task chunks |
| `long` | Permanent | Curated facts, daily logs, user profile |

Every step in a running task writes a `short` memory entry tagged with the action ID. When the task completes, those step entries are deleted, and a summary `episodic` entry is written. This keeps the context window clean without losing history.

The tricky part: **cross-action pollution**. Imagine action A generates an error memory. Action B starts and accidentally picks up that error in its context. Our fix was to tag all step memories with their `actionId` and filter them out when assembling context for a different action.

We also added a **VectorMemory** layer using OpenAI's `text-embedding-3-small` (with a Google fallback) for semantic similarity search. When you're in a conversation, OrcBot ranks thread entries by embedding distance rather than just "last N messages" — so the most *relevant* prior context surfaces, not just the most recent.

## Guard Rails: Why the Loop Doesn't Spin Forever

One of the hardest problems in autonomous agents is **loop detection**. The agent will sometimes get into patterns like:

- Search → get result → search the same thing again → repeat
- Write file → read it back → write again → repeat

We built these guard rails into the decision pipeline:

```typescript
// Consecutive non-deep turns (planning spam)
if (consecutiveNonDeepTurns >= 5) forceBreak = true;

// Identical tool+args called 3x in a row
if (signatureLoopCount >= 3) forceBreak = true;

// Same 2-skill pattern with same args, 3x
if (patternLoopCount >= 3) forceBreak = true;

// Single skill used >5 times in one action
if (skillFrequency[skill] > 5) skipThisCall = true;
```

These aren't optional — they're the difference between an agent that terminates gracefully and one that burns your API budget in five minutes.

## Multi-LLM Routing

OrcBot doesn't lock you to one provider. The `MultiLLM` class routes by model name prefix:

```typescript
if (model.startsWith('gemini'))    → Google Generative AI
if (model.startsWith('nvidia:'))   → NVIDIA API (OpenAI-compatible)
if (model.startsWith('bedrock:'))  → AWS Bedrock
if (model.startsWith('claude'))    → Anthropic
else                               → OpenAI
```

There's also automatic fallback — if the primary provider returns an error, it retries against the other. Useful at 2am when you don't want pages.

For cheap internal steps (like compaction summaries or planning), you can set a `fastModelName` that routes lower-stakes calls to a cheaper model automatically.

## The Plugin System

OrcBot can extend itself. If a skill fails repeatedly, it queues a `self_repair_skill` task — which has the agent write a new plugin to solve the problem, save it to `~/.orcbot/plugins/`, and hot-load it on the next tick.

Plugins are plain CommonJS modules:

```javascript
module.exports = {
  name: 'fetch_weather',
  description: 'Get current weather for a city',
  usage: 'fetch_weather(city)',
  handler: async (args, context) => {
    const { city } = args;
    const res = await fetch(`https://wttr.in/${city}?format=3`);
    const text = await res.text();
    return { success: true, result: text };
  }
};
```

Drop that in `~/.orcbot/plugins/` and it's live immediately.

## Server Mode

Running OrcBot on a server has different requirements than running it on your laptop. A busy server accumulates memory fast — outbound message logs, vector embeddings, action history — and the defaults tuned for desktop use become a problem overnight.

We added a `serverMode` flag that automatically applies conservative defaults when enabled:

```yaml
# orcbot.config.yaml
serverMode: true
```

What changes under the hood:

| Setting | Default | Server mode |
|---|---|---|
| ActionQueue completed TTL | 24h | 2h |
| ActionQueue failed TTL | 72h | 12h |
| ActionQueue flush interval | 5s | 15s |
| Vector memory max entries | 5,000 | 1,500 |
| Message dedup cache | 1,000 | 300 |
| Thread context window | 8 messages | 6 messages |
| Journal/learning injection | 1,500 chars | 800 chars |
| Compact skill descriptions | off | on |

Individual values can still be overridden on top of `serverMode: true` if you need to tune further.

## Channels

OrcBot speaks four languages natively:

- **Telegram** via Telegraf — full bot API, chunked messages, typing indicators
- **WhatsApp** via Baileys — unofficial WA Web protocol, QR auth, presence composing
- **Discord** via discord.js — guild channel messaging
- **Web Gateway** — Express + WebSocket, useful for embedding in your own app

Each channel is isolated — they share the memory and action queue, but message routing, auth, and formatting are per-channel.

## What's File-Backed (By Design)

No database. Everything lives under `~/.orcbot/`:

```
memory.json          ← short + episodic memories
action_queue.json    ← durable task queue
vector_memory.json   ← embedding index
JOURNAL.md           ← agent reflections
LEARNING.md          ← accumulated knowledge
USER.md              ← user profile
profiles/            ← per-contact JSON profiles
plugins/             ← dynamic skill extensions
```

File-backed persistence means you can inspect any state with a text editor, back it up with `rsync`, and run without provisioning any external services. The `JSONAdapter` does atomic writes (temp file → rename) with `.bak` crash recovery, so you don't lose state on a hard kill.

## Lessons Learned

**1. Context window management is a first-class concern.**
An agent that runs 30-step tasks will overflow any context window if you're not proactively compacting. We added mid-action compaction that summarizes the "middle" of the step history while preserving the first two steps (task orientation) and last five (recent context).

**2. Deduplication is harder than it looks.**
Inbound messages can arrive twice (network retries, channel reconnections). We maintain a rolling Set of processed message fingerprints. Naively using `Array.from(set)` for eviction on a 1,000-entry set turns into a performance problem — iterator-based eviction is the right call.

**3. Recovery tasks need tight scoping.**
If a task doesn't deliver a result and you queue a recovery task, the recovery agent will search its memory for context — and pick up episodic memories from *other* tasks. The fix: include the original action ID in the recovery task description so the agent knows exactly which step logs to review.

**4. Trivial tasks need short-circuit paths.**
A "got it!" reply to "hello" should not trigger a full audit of task completeness. We classify tasks as `trivial` vs `substantive` early in the loop and skip the expensive LLM-based completion review when it's obviously done.

**5. Guard rails are not a last resort.**
Build them in from day one. The loop detection, frequency caps, and consecutive-failure stops aren't belt-and-suspenders — they're load-bearing walls.

## Getting Started

```bash
git clone https://github.com/fredabila/orcbot
cd orcbot
npm install
npm run build

# First-time setup
node dist/cli/index.js setup

# Add your API key, then start
node dist/cli/index.js ui
```

OrcBot is MIT licensed and fully self-hosted. All data stays on your machine.

---

If you're building agents or have questions about any of the architecture decisions above, drop a comment — happy to go deeper on any of it.
