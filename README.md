# 🤖 OrcBot
### TypeScript Autonomous Agent Framework
#### High-Power Intelligence with Web, Shell, and Self-Management

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)]()
[![ReAct](https://img.shields.io/badge/Reasoning-ReAct-purple.svg)]()

**Autonomous. Modular. Web-Enabled. Shell-Powered.**

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Skills Registry](#-high-power-skills) • [Configuration](#configuration)

</div>

---

## 🚀 Why OrcBot?

OrcBot is a next-generation **autonomous reasoning agent**. Unlike simple chatbots, OrcBot uses a **ReAct reasoning loop** to think in multiple steps, execute background tasks, browse the web, and manage its own system. It doesn't just reply; it **orchestrates**.

### Key Capabilities

*   🧠 **ReAct Reasoning Loop**: Thinks, Acts, and Observes in multi-step cycles to complete complex tasks.
*   🌐 **Built-in Web Browser**: Surfs the web via Playwright to find real-time info.
*   🐚 **Shell Execution**: Can run command-line tools, manage files, and install dependencies.
*   🧠 **Autonomous Learning**: Automatically updates `USER.md` (your profile) and `.AI.md` (its identity) as it learns.
*   💓 **Autonomy Heartbeat**: Proactively wakes up to self-reflect and take action even when idle.
*   🖥️ **Interactive TUI**: Streamlined terminal interface for high-level management.
*   🔌 **Self-Learning Plugin System**: Drop `.ts` or `.js` files into the `plugins/` directory to live-load new capabilities.
*   🧠 **Autonomous Skill Building**: The agent can autonomously research, write, and install its own skills using the `create_custom_skill` power.

---

## 📦 Installation

### Prerequisites
- Node.js 18+
- Chromium (for browsing): `npx playwright install chromium`

### Setup
```bash
git clone https://github.com/fredabila/orcbot.git
cd orcbot
npm install
npm run build
npm install -g .
```

---

## 🕹️ High-Power Skills

OrcBot comes out of the box with "God Mode" capabilities:

| Skill | Description | Usage Example |
|-------|-------------|---------------|
| `run_command` | Execute any shell command | `run_command("npm test")` |
| `web_search` | Search DuckDuckGo for info | `web_search("latest AI news")` |
| `browser_navigate`| Visit a URL and extract text | `browser_navigate("https://google.com")` |
| `manage_skills` | Install/Update agent skills | `manage_skills("New Skill Definition...")` |
| `deep_reason` | 01-style intensive analysis | `deep_reason("Ethics of AGl")` |
| `update_user_profile`| Permanently learn about user | `update_user_profile("User likes coffee")` |

---

## 🎮 Usage

### TUI Mode (Recommended)
Launch the visual dashboard:
```bash
orcbot ui
```
- **Manage AI Models**: Dedicated menu for OpenAI and Google Gemini keys.
- **Manage Connections**: Configure Telegram and other channels.

### Direct Commands
```bash
# Start the autonomous reasoning loop
orcbot run

# Push an orchestration task
orcbot push "Find the current price of BTC and message it to Frederick on Telegram" -p 10
```

---

## 🧠 The Reasoning Loop (ReAct)

OrcBot doesn't just give one answer. It works iteratively:
1.  **THOUGHT**: "I need to find news first."
2.  **ACTION**: Calls `web_search`.
3.  **OBSERVATION**: Receives news results.
4.  **RE-REASON**: "Now I should update the user's profile and then reply."
5.  **FINALIZE**: Completes background tasks and then messages the user.

---

## 🤝 Contributing

OrcBot is built for extensibility. Contributors can add:
- **Skills**: New tools in `src/core/Agent.ts`.
- **Channels**: New communication platforms (Slack, Discord).
- **Providers**: New LLM interfaces in `MultiLLM.ts`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

<div align="center">
Built with ❤️ for the Autonomous Era
</div>
