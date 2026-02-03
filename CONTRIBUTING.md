---

## 🚨 Current Focus Areas & Known Issues

We're actively working on these challenges and welcome contributions:

### 🔴 High Priority

#### 1. **LLM-Generated Plugin Quality**
The agent can autonomously create plugins via `create_custom_skill`, but the LLM often generates malformed code:
- **Await outside async**: `SyntaxError: await is only valid in async functions` - LLM creates nested non-async functions that use `await`
- **Incomplete code**: Missing semicolons, unclosed braces/parentheses, truncated output
- **Wrong structure**: LLM provides full module code when only the handler body is expected (or vice versa)
- **TypeScript errors**: Invalid type annotations, missing imports

**How to help:**
- Improve the `create_custom_skill` handler in `src/core/Agent.ts` with better sanitization/validation
- Add pre-compilation syntax checking before saving plugins
- Improve the skill description/prompt to guide the LLM better
- Add a "code repair" step that uses the LLM to fix syntax errors before saving

#### 2. **Self-Repair Reliability**
The `self_repair_skill` feature attempts to fix broken plugins automatically, but often fails or creates new issues:
- Repair attempts sometimes make the code worse
- No limit on repair attempts (can loop infinitely)
- Doesn't always understand the root cause of the error

**How to help:**
- Add retry limits and backoff for self-repair
- Improve error message parsing to give better context to the repair LLM
- Add a "quarantine" system for plugins that fail repeatedly

### 🟡 Medium Priority

#### 3. **Memory & Context Management**
- Consolidation sometimes loses important context
- No semantic search for memories (just recency-based)
- Large conversations can exceed token limits

#### 4. **Multi-Provider LLM Resilience**
- Fallback between OpenAI/Google could be smoother
- Rate limiting handling needs improvement
- No support for local LLMs (Ollama, LM Studio)

#### 5. **Testing Coverage**
- No automated test suite currently exists
- Need unit tests for core components (DecisionEngine, SkillsManager, MemoryManager)
- Need integration tests for skill execution

### 🟢 Nice to Have

#### 6. **New Channel Integrations**
- Discord bot support
- Slack integration
- Matrix/Element support

#### 7. **Web Dashboard**
- Real-time agent status monitoring
- Memory/conversation browser
- Skill management UI

---

## 🏗 Project Structure

OrcBot is organized into modular core layers:

- `src/core`: The brain. Contains `Agent.ts`, `DecisionEngine.ts`, `SimulationEngine.ts`, `MultiLLM.ts`, and `SkillsManager.ts`.
- `src/channels`: Communication adapters for Telegram, WhatsApp, and the local CLI.
- `src/tools`: Specialized interaction tools like `WebBrowser.ts`.
- `src/memory`: Storage and context managers (`MemoryManager.ts`, `ActionQueue.ts`).
- `src/cli`: CLI commands and the Setup Wizard.
- `apps/www`: The landing page and web-based dashboard.

---

## 🧪 Local Development

```bash
npm install
npm run build
npm run dev
```

Frontend (landing page):

```bash
cd apps/www
npm install
npm run dev
```

---

## 🤝 Pull Request Process

We encourage contributions! To ensure stability, please follow this flow:

1.  **Fork & Branch**: Create a feature branch from `main`.
2.  **Lint & Build**: Mandatory verification via `npm run build`. We use strict TypeScript rules.
3.  **Atomic Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`).
4.  **Documentation**: If you add a skill, update `SKILLS.md` and the appropriate registry in `Agent.ts`.
5.  **Test**: Verify changes using `orcbot run` and the TUI (`orcbot ui`).
6.  **Frontend**: If you change the web UI, verify `apps/www` renders without console errors.

---

## ✅ Tests

```bash
npm test
```

---

## 🛠 How to Add a New Skill

Skills are the tools the agent uses to interact with the world. They are defined in `src/core/Agent.ts` within the `registerInternalSkills` method.

### 1. Define the Skill
A skill consists of a name, description, usage example, and an async handler.

```typescript
this.skills.registerSkill({
    name: 'check_weather',
    description: 'Get current weather for a city',
    usage: 'check_weather(city)',
    handler: async ({ city }: { city: string }) => {
        // Implementation logic (API calls, etc.)
        const result = await weatherApi.get(city);
        return `The weather in ${city} is ${result.temp}°C`;
    }
});
```

### 2. Validation
For safety, you should validate input arguments. The agent handles ReAct loops based on your return values.

### 3. Return Values (Observations)
The LLM processes the return value of your handler. 
- **Be Descriptive**: Return "Page title is 'News' and it has 5 articles" rather than just "Done".
- **Error Handling**: Use `try/catch` and return clear error messages. The agent's reasoning loop allows it to see the error and "re-think" a different strategy.

---

## 🔒 Security & Secrets

- Never hardcode API keys or tokens.
- Use `ConfigManager.get(...)` and environment variables.
- Avoid logging secrets in skill output or channel messages.

---

## 📡 Adding a New Channel
Channels are providers like Discord, Slack, or WhatsApp.
1. Implement the `IChannel` interface (`src/channels/IChannel.ts`).
2. Add a setup method in the `Agent` class via `setupChannels`.
3. Add configuration keys in `ConfigManager.ts` to store tokens.

---

## 🧩 Plugin Guidelines

- Export `{ name, description, usage, handler }` from your plugin.
- Keep plugins CommonJS-friendly for `require`.
- Add a header comment `// @source: <url>` if generated from a spec.
- Prefer resilient handlers: validate inputs and return helpful errors.

---

## 🧠 Core Improvements
- **MultiLLM**: Add new providers (Anthropic, Local LLMs) in `src/core/MultiLLM.ts`.
- **DecisionEngine**: Refine the system prompt or reasoning logic.
- **SimulationEngine**: Improve planning strategies and contingencies.

---

## 📘 Documentation Expectations

- Update README for user-facing changes.
- Update SKILLS.md if new skills are added or existing ones change.
- Keep examples accurate and runnable.

---

## 🔌 Dynamic Plugin System
OrcBot supports a hot-loadable plugin system. This allows you (and the agent!) to add powers without recompiling or editing the core source.

### 1. The Plugins Directory
By default, OrcBot scans `~/.orcbot/plugins` (global) or `./plugins` (local) for `.ts` or `.js` files.

### 2. Autonomous Skill Building
The agent has a special skill called `create_custom_skill`. 
- **The Loop**: If the agent is asked to do something it can't, it will search for the logic, write the code, and call `create_custom_skill` to install it.
- **Immune System**: OrcBot v2.0 now includes an autonomous self-repair trigger. If a plugin fails to compile, the agent will automatically attempt to fix it!

---
Built with ❤️ for the Autonomous Era
