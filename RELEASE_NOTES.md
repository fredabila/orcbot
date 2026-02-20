# Release Notes - OrcBot v1.0.0

This inaugural release of OrcBot introduces core infrastructure for parallel task execution and interactive shell management.

## 🚀 Key Features

### 🐙 Dual-Lane Parallel Task Execution
OrcBot can now multitask efficiently. User-facing interactions (Telegram, WhatsApp, etc.) are processed in a dedicated high-priority lane, while autonomy-driven tasks (heartbeats, grooming, background research) run in parallel.
- **Improved Responsiveness**: Never wait for a background task to finish before getting a reply.
- **Resource Management**: Background tasks automatically yield to user interactions.

### 🐚 Interactive Shell Sessions
A new set of skills for managing long-running background processes:
- **`shell_start`**: Spawn persistent processes (like `npm run dev`) that stay active across turns.
- **`shell_read`**: Read real-time output via a ring buffer.
- **`shell_send`**: Interact with running processes via stdin.
- **`shell_stop`**: Gracefully terminate background sessions.

### 🛡️ Security & Stabilization
- **Elevated Skills**: Shell operations are protected by permission gates.
- **Safe Mode**: Interactive shell access is disabled when `safeMode` is active.
- **Refactored Busy State**: Per-lane busy tracking improves agent stability.

## 📦 What's Included
- Full source code.
- Pre-built distribution in `dist/`.
- Updated documentation and skills registry.
