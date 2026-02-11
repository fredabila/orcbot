# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands
- Install deps: `npm install`
- Build (tsc): `npm run build`
- Fast build: `npm run build:fast`
- Dev CLI (ts-node): `npm run dev`
- Run built CLI: `npm run start` (runs `dist/cli/index.js`)
- Tests (Vitest): `npm test`
- Watch tests: `npm run test:watch`
- Run a single test file: `npx vitest run tests/<file>.test.ts`
- Run a single test by name: `npx vitest run -t "test name"`
- Browser tooling smoke test: `npm run browser:test`
- Lint: no lint script is defined in `package.json`

## High-level architecture (big picture)
- **CLI entrypoint**: `src/cli/index.ts` wires the TUI, CLI commands, and bootstraps subsystems.
- **Agent core loop**: `src/core/Agent.ts` orchestrates the action loop (simulate → decide → execute tools → memory → termination review).
- **Decision stack**:
  - `src/core/DecisionEngine.ts` builds prompts and calls the LLM.
  - `src/core/ParserLayer.ts` normalizes LLM output to structured JSON with fallbacks.
  - `src/core/DecisionPipeline.ts` applies guardrails on tool calls (dedup, loop detection, safety checks). Guardrails are intentional—avoid weakening them.
  - `src/core/SimulationEngine.ts` creates a pre-plan before execution starts.
  - `src/core/prompts/` contains modular helpers activated by `PromptRouter`.
- **Memory system (critical)**:
  - `src/memory/MemoryManager.ts` handles short/episodic/long memory and consolidation.
  - `src/memory/ActionQueue.ts` is the durable priority queue for tasks (retry, TTL, chaining).
  - Storage is file-backed via `src/storage/JSONAdapter.ts` (atomic writes + backups).
  - Vector memory (`src/memory/VectorMemory.ts`) is optional and file-backed.
  - Important constraints from existing instructions: keep `saveMemory` content short (<500 chars), include metadata (`actionId`, `step`, `skill`) for step memories, and avoid storing secrets in memory.
- **Skills system**:
  - Core skills registered in `src/core/Agent.ts`.
  - Dynamic plugins loaded by `src/core/SkillsManager.ts` from `~/.orcbot/plugins/` (or `./plugins`).
- **Channels**: `src/channels/` implements Telegram (Telegraf), WhatsApp (Baileys), Discord (discord.js), and Gateway (Express+WS). Inbound messages write short memory and push tasks to the queue.
- **Web/browser tooling**: `src/tools/WebBrowser.ts` wraps Playwright and provides search fallbacks (Serper → Google → Bing → DuckDuckGo).
- **Config + runtime tuning**:
  - `src/config/ConfigManager.ts` loads `orcbot.config.yaml` with hot-reload and feature toggles.
  - `src/core/RuntimeTuner.ts` adjusts runtime limits based on signals.
  - `src/core/MultiLLM.ts` routes providers by model prefix and falls back on errors.
- **Data paths**: runtime state lives under `~/.orcbot/` (or `ORCBOT_DATA_DIR`) including config, memory, queue, logs, profiles, and plugins.

## Notes pulled from existing project instructions
- The memory subsystem is the most complex and common source of behavior bugs; read the memory section in `.github/copilot-instructions.md` before changing it.
- The action loop guardrails in the decision pipeline are intentional; avoid weakening or removing them without a strong reason.
