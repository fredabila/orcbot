# 🤖 OrcBot
### TypeScript Autonomous Agent Framework

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**Autonomous. Modular. Extensible.**

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Deployment](#deployment)

</div>

---

## 🚀 Why OrcBot?

OrcBot isn't just a chatbot. It's an **autonomous agent** capable of living on your server, thinking for itself, and proactively helping you. It remembers your conversations, manages tasks, and connects to the world via skills.

### Key Capabilities

*   🧠 **Multi-LLM Core**: Switch between **OpenAI (GPT-4)** and **Google Gemini** on the fly.
*   💾 **Persistent Memory**: Remembers users and context across sessions using local JSON storage.
*   📡 **Telegram Integration**: Chat with OrcBot from anywhere; it learns who you are.
*   💓 **Autonomy Heartbeat**: OrcBot wakes up periodically (configurable) to reflect on tasks and take initiative.
*   🖥️ **Interactive TUI**: A beautiful terminal user interface to manage everything.
*   🔌 **Skill System**: Easily extendable plugin system for new capabilities.

---

## 📦 Installation

### Option A: Global Install (Recommended)
Run it from anywhere.

```bash
npm install -g .
orcbot ui
```

### Option B: For Developers
Hack on the core.

```bash
git clone https://github.com/fredabila/orcbot.git
cd orcbot
npm install
npm run build
npm run dev -- ui
```

---

## 🎮 Usage

### The Terminal UI (TUI)

Launch the visual interface:
```bash
orcbot ui
```

**Use the TUI to:**
1.  **Configure Agent**: Set API keys (`openaiApiKey`, `googleApiKey`) and Model (`gpt-4o`, `gemini-pro`).
2.  **Manage Connections**: Setup your **Telegram Bot** token.
3.  **Start Loop**: Run the agent.

### Command Line
You can also run commands directly:

```bash
# Start the autonomous loop
orcbot run

# Manually add a task
orcbot push "Research quantum computing" --priority 8

# Check status
orcbot status
```

---

## 🛠️ Configuration

Configuration is stored locally in `orcbot.config.yaml`.

```yaml
agentName: OrcBot
modelName: gpt-4o             # or gemini-pro
autonomyInterval: 15          # Minutes between self-reflection checks
openaiApiKey: sk-...
googleApiKey: AIza...
telegramToken: 12345...
memoryPath: ./memory.json
```

### Auto-Model Switching
OrcBot automatically detects the provider based on the `modelName`:
*   Starts with `gpt-` → **OpenAI**
*   Starts with `gemini-` → **Google**

---

## 🚢 Deployment

OrcBot is designed to run 24/7 on a VPS.

**Using PM2 (Recommended):**
```bash
npm install -g pm2
pm2 start dist/cli/index.js --name orcbot -- run
```

Your agent will now stay online, listen to Telegram messages, and run its autonomy heartbeat. See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker instructions.

---

## 🤝 Contributing

We love contributions! Whether it's a new Skill, a new Channel (Discord?), or a core improvement.
Check out [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

<div align="center">
Built with ❤️ in TypeScript
</div>
