<div align="center">
<img src="orcbot_hero_banner_1769974399613.png" width="100%" alt="OrcBot Hero Banner">

# OrcBot v2.0
### The Production-Ready Strategic AI Agent
#### High-Power Intelligence with Web, Shell, and Strategic Simulation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)]()
[![ReAct](https://img.shields.io/badge/Reasoning-ReAct-purple.svg)]()

**Autonomous. Strategic. Multi-Modal. Self-Healing.**

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Skills Registry](#-high-power-skills) • [Configuration](#configuration)

</div>

---

## 🚀 Why OrcBot v2.0?

OrcBot is a next-generation **autonomous reasoning agent**. In v2.0, we've moved beyond simple ReAct loops to a **Strategic Simulation Architecture**. Before executing a task, OrcBot simulates the outcome, identifies potential pitfalls, and generates a robust execution plan with built-in fallbacks.

### Key Capabilities

*   🧠 **Strategic Simulation Layer**: Pre-task planning that anticipates errors (like CAPTCHAs or search failures) before they happen.
*   🛡️ **Autonomous Immune System**: Automatically detects broken plugin code and uses its `self_repair_skill` to fix itself.
*   📸 **Multi-Modal Intelligence**: Native capability to analyze images, audio, and documents via Telegram and WhatsApp.
*   🌐 **Context-Aware Browsing**: Strategic web navigation that handles dynamic content and bypasses anti-bot measures.
*   🐚 **Shell Execution**: Full system access to run commands, manage files, and install dependencies.
*   💓 **Autonomy Heartbeat**: Proactively wakes up to self-reflect and take action even when idle.
*   🖥️ **Interactive TUI & Dashboard**: Comprehensive terminal interface and web landing page for management.
*   🔌 **Dynamic Plugin System**: Hot-loadable TypeScript plugins for limitless extensibility.

---

### Installation

You can get started instantly with our one-line installer:

**Linux / macOS**
```bash
curl -sSL https://orcbot.ai/install.sh | bash
```

**Windows (PowerShell)**
```powershell
iwr https://orcbot.vercel.app/install.ps1 | iex
```

Alternatively, clone the repo and run:
```bash
npm install
npm run build
npm run setup
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
