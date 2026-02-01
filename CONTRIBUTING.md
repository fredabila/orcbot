## 🏗 Project Structure

OrcBot is organized into modular core layers:

- `src/core`: The brain. Contains `Agent.ts`, `DecisionEngine.ts`, `SimulationEngine.ts`, `MultiLLM.ts`, and `SkillsManager.ts`.
- `src/channels`: Communication adapters for Telegram, WhatsApp, and the local CLI.
- `src/tools`: Specialized interaction tools like `WebBrowser.ts`.
- `src/memory`: Storage and context managers (`MemoryManager.ts`, `ActionQueue.ts`).
- `src/cli`: CLI commands and the Setup Wizard.
- `apps/www`: The landing page and web-based dashboard.

## 🤝 Pull Request Process

We encourage contributions! To ensure stability, please follow this flow:

1.  **Fork & Branch**: Create a feature branch from `main`.
2.  **Lint & Build**: Mandatory verification via `npm run build`. We use strict TypeScript rules.
3.  **Atomic Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`).
4.  **Documentation**: If you add a skill, update `SKILLS.md` and the appropriate registry in `Agent.ts`.
5.  **Test**: Verified your changes in the autonomous loop using `orcbot run`.

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

## 📡 Adding a New Channel
Channels are providers like Discord, Slack, or WhatsApp.
1. Implement the `IChannel` interface (`src/channels/IChannel.ts`).
2. Add a setup method in the `Agent` class via `setupChannels`.
3. Add configuration keys in `ConfigManager.ts` to store tokens.

---

## 🧠 Core Improvements
- **MultiLLM**: Add new providers (Anthropic, Local LLMs) in `src/core/MultiLLM.ts`.
- **DecisionEngine**: Refine the system prompt or reasoning logic.
- **SimulationEngine**: Improve planning strategies and contingencies.

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
