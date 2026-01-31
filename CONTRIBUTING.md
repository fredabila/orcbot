# Contributing to OrcBot

We welcome contributions! OrcBot is designed to be modular and easy to extend. We want to make this the best TypeScript Agent framework.

## Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/orcbot.git
   cd orcbot
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run in Dev Mode**
   ```bash
   npm run dev -- ui
   ```

## Key Areas to Contribute

### 1. New Providers (`src/core/MultiLLM.ts`)
We currently support OpenAI and Google Gemini.
- Implement new providers (e.g., Anthropic, Local LLMs) in `MultiLLM.ts`.
- Update `inferProvider` logic.

### 2. New Skills (`src/core/SkillsManager.ts`)
- Define new skills in `SKILLS.md` if they are prompt-based.
- For complex logic, register handler functions in `Agent.ts` (`registerInternalSkills`).

### 3. Channels (`src/core/`)
- Implement `IChannel` interface for new platforms (Discord, Slack, Matrix).
- Add the channel initialization to `Agent.ts`.

## Code Style
- Use TypeScript.
- Follow the existing folder structure.
- Ensure `npm run build` passes before submitting.
- Use `npm run dev -- <command>` to test your changes.

## Submitting Pull Requests
1. Create a branch (`feature/amazing-feature`)
2. Commit your changes.
3. Push to the branch.
4. Open a Pull Request.

## Community

Join our discussions on [GitHub Issues](https://github.com/yourusername/orcbot/issues).
