# OrcBot Skills Registry

This file lists the available skills for the agent.

## Messaging & Media
- **send_telegram(chat_id, message)**: Send a message to a Telegram user.
- **send_whatsapp(jid, message)**: Send a message to a WhatsApp contact or group.
- **send_discord(channel_id, message)**: Send a message to a Discord channel.
- **send_discord_file(channel_id, file_path, caption?)**: Send a file to a Discord channel with an optional caption.
- **send_gateway_chat(message)**: Send a message to the Gateway Chat interface.
- **send_file(jid, path, caption?)**: Send a file to Telegram or WhatsApp.
- **download_file(url, filename?)**: Download a file to local storage.
- **analyze_media(path, prompt?)**: Analyze an image, audio, or document file.
- **text_to_speech(text, voice?, speed?)**: Convert text to an audio file using AI voice synthesis.
- **send_voice_note(jid, text, voice?)**: Convert text to speech and send as a voice note.
- **post_whatsapp_status(text)**: Post a text update to WhatsApp status.
- **react(message_id, emoji, channel?, chat_id?)**: React to a message with an emoji (auto-detect channel).
- **react_telegram(chat_id, message_id, emoji)**: React to a Telegram message with an emoji.
- **react_whatsapp(jid, message_id, emoji)**: React to a WhatsApp message with an emoji.
- **react_discord(channel_id, message_id, emoji)**: React to a Discord message with an emoji.
- **reply_whatsapp_status(jid, message)**: Reply to a contact’s WhatsApp status.
- **update_contact_profile(jid, profile_json)**: Persist a WhatsApp contact profile.
- **get_contact_profile(jid)**: Retrieve a stored WhatsApp contact profile.
- **list_whatsapp_contacts(limit?)**: List recent WhatsApp contacts that interacted with the bot.
- **get_discord_guilds()**: Get the list of Discord servers (guilds) the bot is in.
- **get_discord_channels(guild_id)**: Get the list of text channels in a Discord server.

## System & Configuration
- **run_command(command, cwd?)**: Execute shell commands (subject to allow/deny lists). Automatically extracts directory from "cd /path && command" or "cd /path ; command" patterns and uses as working directory.
- **get_system_info()**: Return server time/date and OS info.
- **set_config(key, value)**: Persist configuration values.
- **manage_skills(skill_definition)**: Append new skill definitions to SKILLS.md.
- **self_repair_skill(skillName, errorMessage)**: Diagnose and fix a failing plugin skill.
- **tweak_skill(skillName, issue, fix?)**: Patch any skill — built-in or plugin — that keeps failing. Generates and saves a replacement wrapper plugin, reloads it immediately. Use when a core skill has a fixable argument-shape or API error.
- **install_npm_dependency(packageName)**: Install an NPM package for custom skills.

## Browser & Web
- **web_search(query)**: Search the web using multiple engines with fallback.
- **browser_navigate(url)**: Navigate to a URL and return a semantic snapshot.
- **browser_examine_page()**: Get a semantic snapshot of the current page.
- **browser_wait(ms)**: Wait for a number of milliseconds.
- **browser_wait_for(selector, timeout?)**: Wait for a selector.
- **browser_click(selector_or_ref)**: Click an element by selector or ref.
- **browser_type(selector_or_ref, text)**: Type into an element by selector or ref.
- **browser_press(key)**: Press a keyboard key.
- **browser_screenshot()**: Capture a screenshot.
- **browser_vision(prompt?)**: Analyze the current page using vision.
- **browser_solve_captcha()**: Solve detected CAPTCHA.
- **browser_run_js(script)**: Execute custom JavaScript on the current page.
- **browser_back()**: Navigate back to the previous page.
- **browser_scroll(direction, amount?)**: Scroll the page up or down.
- **browser_hover(selector)**: Hover over an element to trigger menus or tooltips.
- **browser_select(selector, value)**: Select an option in a dropdown by visible label.
- **switch_browser_profile(profileName, profileDir?)**: Switch to a persistent browser profile.
- **switch_browser_engine(engine, endpoint?)**: Switch between Playwright and Lightpanda browser engines.
- **extract_article(url?)**: Extract clean article text from a URL or the current page.
- **http_fetch(url, method?, headers?, body?, timeout?)**: Lightweight HTTP request (no browser). Supports GET/POST/PUT/PATCH/DELETE. Returns status + body. Ideal for APIs and simple pages.
- **youtube_trending(region?, category?)**: Fetch YouTube trending videos via API fallbacks.

## Computer Use (Vision + System)
- **computer_screenshot(context?)**: Capture a screenshot (browser or system) with optional vision description.
- **computer_click(x?, y?, description?, button?, context?)**: Click by coordinates or vision-locate a described element.
- **computer_vision_click(description, button?, context?)**: Vision-guided click by description.
- **computer_type(text, inputDescription?, context?)**: Type text, optionally vision-locating the input first.
- **computer_key(key, context?)**: Press a key or key combo (e.g., ctrl+c, alt+Tab).
- **computer_mouse_move(x, y, context?)**: Move the mouse cursor to pixel coordinates.
- **computer_drag(fromX, fromY, toX, toY, context?)**: Drag from one point to another.
- **computer_scroll(direction, amount?, x?, y?, context?)**: Scroll in browser or system context.
- **computer_locate(description, context?)**: Vision-locate an element and return coordinates.
- **computer_describe(x?, y?, radius?, context?)**: Vision description of the screen or a region.

## Memory, Journal & Learning
- **update_user_profile(info_text)**: Save permanent information learned about the user.
- **update_agent_identity(trait)**: Update the agent’s personality/identity.
- **update_journal(entry_text)**: Write a reflection entry to JOURNAL.md.
- **update_learning(topic, knowledge_content?)**: Research and persist knowledge.
- **request_supporting_data(question)**: Ask for missing info and pause execution.
- **deep_reason(topic)**: Perform intensive multi-step analysis.
- **recall_memory(query, limit?)**: Semantic search across ALL memory — finds relevant memories from any channel, time period, or type.
- **search_chat_history(jid, query?, limit?, source?)**: Search chat history with a contact. Supports semantic search (meaning-based) and keyword search. Works across WhatsApp, Telegram, and Discord.
- **get_whatsapp_context(jid)**: Get WhatsApp contact context including profile and recent history.

## RAG Knowledge Store
- **rag_ingest(content, source, collection?, title?, tags?, format?)**: Ingest a document or dataset into the knowledge store. Chunks, embeds, and stores content for semantic retrieval. Supports text, markdown, CSV, JSON, JSONL, and code.
- **rag_ingest_file(file_path, collection?, tags?, title?)**: Read a local file and ingest it into the knowledge store.
- **rag_ingest_url(url, collection?, tags?, title?)**: Download a web page or file from a URL, extract readable text, and ingest it. Uses Readability for HTML extraction.
- **rag_search(query, limit?, collection?, tags?)**: Semantic search across ingested knowledge. Returns the most relevant document chunks ranked by similarity.
- **rag_list(collection?)**: List documents and collections in the knowledge store with stats (chunk counts, sizes, tags).
- **rag_delete(document_id?, collection?)**: Delete a specific document or an entire collection from the knowledge store.

## Scheduling
- **schedule_task(time_or_cron, task_description)**: Schedule a task for later.

## Multi-Agent Orchestration
- **spawn_agent(name, role, capabilities?)**: Create a sub-agent.
- **list_agents()**: List active agents.
- **terminate_agent(agent_id)**: Terminate a spawned agent.
- **delegate_task(description, priority?, agent_id?)**: Create and assign a task.
- **distribute_tasks()**: Auto-assign pending tasks.
- **orchestrator_status()**: Get orchestration summary.
- **complete_delegated_task(task_id, result?)**: Mark a delegated task completed.
- **fail_delegated_task(task_id, error)**: Mark a delegated task failed.
- **send_agent_message(to_agent_id, message, type?)**: Send inter-agent messages.
- **broadcast_to_agents(message)**: Broadcast a message to all agents.
- **get_agent_messages(agent_id?, limit?)**: Retrieve agent messages.
- **clone_self(clone_name, specialized_role?)**: Create a full-capability clone.

## Self-Tuning & Adaptation
These skills allow the agent to dynamically adjust its own behavior based on what's working.

- **get_tuning_options()**: Discover all available tunable settings (browser, workflow, LLM).
- **tune_browser_domain(domain, settings, reason)**: Adjust browser settings for a specific domain (e.g., forceHeadful, clickTimeout, useSlowTyping).
- **mark_headful(domain, reason?)**: Mark a domain as requiring visible browser mode.
- **tune_workflow(settings, reason)**: Adjust workflow settings (maxStepsPerAction, maxRetriesPerSkill, retryDelayMs).
- **get_tuning_state()**: View current tuning configuration and learned settings.
- **get_tuning_history(limit?)**: See recent tuning changes and their outcomes.
- **reset_tuning(category?)**: Reset tuning to defaults (browser, workflow, llm, or all).

## Agent Skills (SKILL.md Ecosystem)
Agent Skills follow the [agentskills.io](https://agentskills.io/) specification — portable, LLM-readable skill packages that can extend OrcBot in any direction.

### Agent Skill Management
- **install_skill(source)**: Install a skill from GitHub URL, gist, `.skill` zip, or local path.
- **create_skill(name, description?, instructions?)**: Scaffold a new skill with SKILL.md template.
- **activate_skill(name, active?)**: Toggle skill activation (progressive disclosure — only activated skills load full instructions).
- **list_agent_skills()**: List all installed agent skills with status, resources, and version.
- **read_skill_resource(skill_name, file_path)**: Read a bundled file (reference, script, asset) from an installed skill.
- **validate_skill(name_or_path)**: Validate a skill directory against the agentskills.io specification.
- **uninstall_agent_skill(name)**: Remove an installed agent skill.
- **run_skill_script(skill_name, script, args?)**: Execute a bundled script (.js/.ts/.py/.sh/.ps1) from a skill.
- **write_skill_file(skill_name, file_path, content)**: Write or update files inside a skill directory.

### SKILL.md Format
Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:
```yaml
---
name: my-skill-name
description: "What this skill does"
license: MIT
compatibility:
  - "orcbot"
metadata:
  version: "1.0.0"
  author: "Author Name"
allowed-tools:
  - "web_search"
  - "run_command"
orcbot:
  autoActivate: false
  triggerPatterns: ["pattern1", "pattern2"]
  requiredConfig: ["apiKey"]
  requiredPackages: ["some-npm-package"]
  permissions: ["network", "filesystem"]
---

# My Skill Name

Instructions for the agent in natural language...
```

### Directory Structure
```
my-skill-name/
  SKILL.md          # Required — frontmatter + instructions
  scripts/          # Executable scripts the agent can run
  references/       # Background knowledge and documentation
  assets/           # Images, templates, data files
```

### Installing Skills
- **CLI**: `orcbot skill install <url-or-path>`
- **TUI**: Skills menu → Install from URL / Install from Local Path
- **Agent**: Use `install_skill` tool with a GitHub URL, gist, or local path
- **Manual**: Copy a skill directory into `~/.orcbot/plugins/skills/`

### Creating Skills
- **CLI**: `orcbot skill create <name> --description "What it does"`
- **TUI**: Skills menu → Create New
- **Agent**: Use `create_skill` tool — the agent can even generate instructions from a description

### Progressive Disclosure
Skills use a three-level loading strategy to minimize token usage:
1. **Level 1** (always loaded): Name + description (~100 tokens per skill)
2. **Level 2** (on activation): Full SKILL.md instructions
3. **Level 3** (on demand): Bundled resources via `read_skill_resource`

## Community / Plugin Skills
Custom plugin skills (.ts/.js files) are loaded from ~/.orcbot/plugins. If you add new plugins there, they will appear in the agent's live skill registry.

## Configuration Management
Agent-driven configuration management with policy-based security. See [docs/CONFIG_MANAGEMENT.md](docs/CONFIG_MANAGEMENT.md) for complete documentation.

- **manage_config({ action: "get", key })**: Get current value of a configuration setting.
- **manage_config({ action: "set", key, value, reason? })**: Set a configuration value (respects policy: SAFE, APPROVAL, or LOCKED).
- **manage_config({ action: "list" })**: List all configurations categorized by policy level.
- **manage_config({ action: "policy" })**: View configuration policy descriptions.
- **manage_config({ action: "history", limit? })**: View configuration change history.
- **manage_config({ action: "pending" })**: View pending approval requests.
- **manage_config({ action: "approve", key })**: Approve a pending configuration change.
- **manage_config({ action: "reject", key })**: Reject a pending configuration change.
- **manage_config({ action: "suggest", taskDescription })**: Get configuration optimization suggestions for a task.

### Policy Levels
- **SAFE**: Agents can modify autonomously (e.g., modelName, memoryContextLimit, maxStepsPerAction)
- **APPROVAL**: Agents can request, requires approval (e.g., API keys, autonomy settings)
- **LOCKED**: Agents cannot modify (e.g., security settings like safeMode, commandDenyList)
