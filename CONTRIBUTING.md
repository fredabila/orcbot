# Contributing to OrcBot

We welcome contributions! OrcBot is designed to be a "High-Power" autonomous agent framework. This guide explains how to extend its intelligence and capabilities.

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

### 2. Validation with Zod
For safety, you should validate input arguments using `zod`. This prevents the LLM from passing garbage data into your tools.

```typescript
import { z } from 'zod';

const WeatherSchema = z.object({ city: z.string() });

// Inside handler:
const { city } = WeatherSchema.parse(args);
```

### 3. Return Values (Observations)
The LLM processes the return value of your handler. 
- **Be Descriptive**: Return "Page title is 'News' and it has 5 articles" rather than just "Done".
- **Error Handling**: Use `try/catch` and return clear error messages. The agent's ReAct loop allows it to see the error and "re-think" a different strategy.

### 4. Update the Registry
Add your skill to `SKILLS.md`. This is critical because the Agent uses this file to build its system prompt and know what it's capable of.

## 📡 Adding a New Channel
Channels are providers like Discord, Slack, or WhatsApp.
1. Implement the `Channel` interface (see `src/core/TelegramChannel.ts`).
2. Add a setup method in the `Agent` class via `setupChannels`.
3. Add configuration keys in `ConfigManager.ts` to store tokens.

## 🧠 Core Improvements
- **MultiLLM**: Add new providers (Anthropic, Local LLMs) in `src/core/MultiLLM.ts`.
- **DecisionEngine**: Refine the system prompt or reasoning logic.

## 🔌 Dynamic Plugin System
OrcBot now supports a hot-loadable plugin system. This allows you (and the agent!) to add powers without recompiling or editing the core source.

### 1. The Plugins Directory
By default, OrcBot scans `~/.orcbot/plugins` (global) or `./plugins` (local) for `.ts` or `.js` files.

### 2. Plugin Structure
A plugin is a simple object exported from a file:

```typescript
// ./plugins/check_price.ts
export const check_price = {
    name: 'check_stock_price',
    description: 'Fetch the live price for a stock symbol',
    usage: 'check_stock_price(symbol)',
    handler: async ({ symbol }: { symbol: string }) => {
        const data = await fetch(`https://api.example.com/quote/${symbol}`);
        return `Current price for ${symbol} is $${data.price}`;
    }
};
```

### 3. Autonomous Skill Building
The agent has a special skill called `create_custom_skill`. 
- **The Loop**: If the agent is asked to do something it can't, it will search for the logic, write the code, and call `create_custom_skill` to install it.
- **Dependencies**: Use `install_npm_dependency` if your plugin requires external libraries.

## 🧪 Testing
- Run `npm run build` to verify type safety.
- Use `orcbot run` to test autonomous behavior.
- Add logs via `logger.info()` to trace the reasoning loop steps.

---
Built with ❤️ for the Autonomous Era
