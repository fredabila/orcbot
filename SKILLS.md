# OrcBot Skills Registry

This file lists the available skills for the agent.

## Messaging & Media
- **send_telegram(chat_id, message)**: [CORE MESSAGING] Send a message to a Telegram user.
- **send_whatsapp(jid, message)**: [CORE MESSAGING] Send a message to a WhatsApp contact or group.
- **send_discord(channel_id, message)**: [CORE MESSAGING] Send a message to a Discord channel.
- **send_discord_file(channel_id, file_path, caption?)**: [CORE MESSAGING] Send a file to a Discord channel with an optional caption.
- **send_gateway_chat(message)**: [CORE MESSAGING] Send a message to the Gateway Chat interface.
- **send_file(jid, path, caption?)**: [CORE MESSAGING] Send a file to Telegram or WhatsApp.
- **download_file(url, filename?)**: [MEDIA/FILE TOOL] Download a file to local storage.
- **generate_pdf(content, output_path, is_html?)**: [MEDIA/FILE TOOL] Generate a PDF file from Markdown or HTML content. Use this to compile research, logs, or reports into a clean PDF document.
- **analyze_media(path, prompt?)**: [MEDIA/FILE TOOL] Analyze an image, audio, or document file.
- **text_to_speech(text, voice?, speed?)**: [MEDIA/FILE TOOL] Convert text to an audio file using AI voice synthesis. Available voices: OpenAI (alloy, echo, fable, onyx, nova, shimmer) or Google (achernar, achird, algenib, algieba, alnilam, aoede, autonoe, callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi).
- **send_voice_note(jid, text, voice?)**: [CORE MESSAGING] Convert text to speech and send as a voice note. Same voice options as text_to_speech.
- **post_whatsapp_status(text)**: [CORE MESSAGING] Post a text update to WhatsApp status.
- **react(message_id, emoji, channel?, chat_id?)**: [CORE MESSAGING] React to a message with an emoji (auto-detect channel).
- **react_telegram(chat_id, message_id, emoji)**: [CORE MESSAGING] React to a Telegram message with an emoji.
- **react_whatsapp(jid, message_id, emoji)**: [CORE MESSAGING] React to a WhatsApp message with an emoji.
- **react_discord(channel_id, message_id, emoji)**: [CORE MESSAGING] React to a Discord message with an emoji.
- **reply_whatsapp_status(jid, message)**: [CORE MESSAGING] Reply to a contact’s WhatsApp status.
- **update_contact_profile(jid, profile_json)**: [MEMORY/STATE] Persist a WhatsApp contact profile.
- **get_contact_profile(jid)**: [MEMORY/STATE] Retrieve a stored WhatsApp contact profile.
- **list_whatsapp_contacts(limit?)**: [MEMORY/STATE] List recent WhatsApp contacts that interacted with the bot.
- **get_discord_guilds()**: [CORE MESSAGING] Get the list of Discord servers (guilds) the bot is in.
- **get_discord_channels(guild_id)**: [CORE MESSAGING] Get the list of text channels in a Discord server.

## Self-Modification & Core Access
- **read_codebase_file(path)**: [SYSTEM] Read any source file in the project. (Requires `enableSelfModification` toggle in TUI).
- **search_codebase(query, include?)**: [SYSTEM] Search across the entire codebase for patterns. (Requires `enableSelfModification` toggle in TUI).
- **edit_codebase_file(path, old_text, new_text)**: [SYSTEM] Modify its own source code to fix bugs or extend functionality. (Requires `enableSelfModification` toggle in TUI).

## Email Management
- **send_email(to, subject, message, inReplyTo?, references?)**: [CORE MESSAGING] Send an email via configured SMTP account.
- **search_emails({ query?, sender?, subject?, daysAgo?, unreadOnly?, limit? })**: [EMAIL TOOL] Search for emails in the inbox. Use `query` for body/text search.
- **fetch_email(uid)**: [EMAIL TOOL] Fetch the full content of a specific email by its IMAP UID.
- **index_emails_to_knowledge_base({ query?, sender?, subject?, daysAgo?, limit?, collection? })**: [EMAIL TOOL] Search and ingest emails into the RAG Knowledge Store for semantic search.
- **generate_email_report({ topic, emails?, sender?, subject?, query?, daysAgo? })**: [EMAIL TOOL] Analyze multiple emails and generate a synthesized report/summary.
- **google_identity_status()**: [EMAIL/AUTH TOOL] Check whether Google OAuth credentials and a Gmail-backed identity are configured and connected for browser auth workflows.
- **google_identity_connect(client_id?, client_secret?, code_or_redirect_url?, email?)**: [EMAIL/AUTH TOOL] Configure Google OAuth credentials and connect the agent by exchanging an authorization code or redirect URL. If no code is provided, returns a consent URL.
- **google_inbox_search(query, maxResults?)**: [EMAIL/AUTH TOOL] Search the connected Gmail inbox for login emails, magic links, verification messages, or other auth-related mail.
- **google_latest_otp(from_contains?, subject_contains?)**: [EMAIL/AUTH TOOL] Extract the latest numeric OTP code from recent Gmail messages, optionally filtered by sender or subject.
- **google_workspace_status()**: [GOOGLE WORKSPACE TOOL] Check whether the Google Workspace CLI (`gws`) is installed and whether its auth context is available.
- **google_workspace_command(args:array, json?, account?)**: [GOOGLE WORKSPACE TOOL] Run a structured `gws` command without a shell. Use this for broad Workspace access across Gmail, Drive, Docs, Sheets, Calendar, and related services.
- **google_docs_create(title, content?, account?)**: [GOOGLE WORKSPACE TOOL] Create a Google Doc via `gws`, optionally writing initial content right after creation.
- **google_docs_write(document_id, text, account?)**: [GOOGLE WORKSPACE TOOL] Append plain text to an existing Google Doc via `gws`.
- **google_drive_list(query?, pageSize?, account?)**: [GOOGLE WORKSPACE TOOL] List Google Drive files with optional Drive query filtering.
- **google_sheets_create(title, account?)**: [GOOGLE WORKSPACE TOOL] Create a Google Sheets spreadsheet via `gws`.
- **google_sheets_read(spreadsheet_id, range, account?)**: [GOOGLE WORKSPACE TOOL] Read a range of cell values from a Google Sheet via `gws`.
- **google_sheets_append(spreadsheet_id, values|json_values, account?, dryRun?)**: [GOOGLE WORKSPACE TOOL] Append one or more rows to a Google Sheet via `gws`.
- **google_calendar_create_event(summary, start, end, calendar?, location?, description?, attendees?, account?, dryRun?)**: [GOOGLE WORKSPACE TOOL] Create a Google Calendar event via `gws`.
- **google_gmail_triage(max?, query?, labels?, account?)**: [GOOGLE WORKSPACE TOOL] Show an unread Gmail summary via `gws`.
- **google_gmail_send(to, subject, body, cc?, bcc?, account?, dryRun?)**: [GOOGLE WORKSPACE TOOL] Send a plain-text Gmail message via `gws`.
- **google_gmail_reply(message_id, body, to?, cc?, bcc?, from?, account?, dryRun?)**: [GOOGLE WORKSPACE TOOL] Reply to a Gmail message via `gws`, preserving thread headers automatically.
- **google_gmail_reply_all(message_id, body, to?, cc?, bcc?, remove?, from?, account?, dryRun?)**: [GOOGLE WORKSPACE TOOL] Reply-all to a Gmail thread via `gws`.

## System & Configuration
- **run_command(command, cwd?)**: [SYSTEM/OS LEVEL] Execute shell commands on the host system (subject to allow/deny lists). Automatically extracts directory from "cd /path && command" or "cd /path ; command" patterns and uses as working directory.
- **shell_poll(id, intervalMs?, maxAttempts?, stopOnOutput?)**: [SYSTEM/OS LEVEL] Register a background polling job to monitor a shell session until it completes or hits a specific output. Ideal for long-running CLI tasks.
- **get_system_info()**: [SYSTEM/OS LEVEL] Return system time/date and OS info.
- **set_config(key, value)**: [CONFIG MANAGEMENT] Persist configuration values.
- **execute_typescript(code?, args?, filename?)**: [DYNAMIC EXECUTION TOOL] Write, compile, and execute TypeScript code on the fly. USE THIS WHEN YOU NEED TO BUILD CUSTOM LOGIC, hit undocumented APIs, or process data in ways standard tools cannot handle. If `filename` is not provided, code is saved to a persistent `scratchpad.ts` file. If `filename` (e.g., "script.ts") is provided with `code`, it saves the script to a scripts directory for reuse. If only `filename` is provided without `code`, it executes the previously saved script.
- **execute_python_code(code?, filename?)**: [ADVANCED DATA/MATH TOOL] Execute Python code in an isolated local virtual environment. ONLY use this for data analysis, complex math, or tasks requiring Python-specific libraries (pandas, numpy, etc.) after standard tools or simple TypeScript fail. Provide `code` to run it directly. Optionally provide `filename` (e.g., "script.py") to save the code for future reuse. If you only provide `filename` without `code`, it will execute the previously saved script.
- **install_python_package(package)**: [ADVANCED TOOL DEPENDENCY] Install a Python package (via pip) into the local virtual environment. ONLY use this when you specifically need a library for the execute_python_code tool.
- **manage_skills(skill_definition)**: [SKILL MANAGEMENT] Append new skill definitions to SKILLS.md.
- **self_repair_skill(skillName, errorMessage)**: [SKILL MANAGEMENT] Diagnose and fix a failing plugin skill.
- **tweak_skill(skillName, issue, fix?)**: [SKILL MANAGEMENT] Patch any skill — built-in or plugin — that keeps failing. Generates and saves a replacement wrapper plugin, reloads it immediately. Use when a core skill has a fixable argument-shape or API error.
- **install_npm_dependency(packageName)**: [SYSTEM/OS LEVEL] Install an NPM package for custom skills.

## Browser & Web
- **web_search(query)**: [HIGH-LEVEL PREFERRED] Search the web using multiple engines with fallback. ALWAYS try this before deep browser automation.
- **browser_navigate(url)**: [BROWSER/WEB AUTOMATION] Navigate to a URL and return a semantic snapshot.
- **browser_examine_page()**: [BROWSER/WEB AUTOMATION] Get a semantic snapshot of the current page.
- **browser_wait(ms)**: [BROWSER/WEB AUTOMATION] Wait for a number of milliseconds.
- **browser_wait_for(selector, timeout?)**: [BROWSER/WEB AUTOMATION] Wait for a selector.
- **browser_click(selector_or_ref)**: [BROWSER/WEB AUTOMATION] Click an element by selector or ref.
- **browser_type(selector_or_ref, text)**: [BROWSER/WEB AUTOMATION] Type into an element by selector or ref.
- **browser_press(key)**: [BROWSER/WEB AUTOMATION] Press a keyboard key.
- **browser_screenshot()**: [BROWSER/WEB AUTOMATION] Capture a screenshot.
- **browser_vision(prompt?)**: [BROWSER/WEB AUTOMATION] Analyze the current page using vision.
- **browser_solve_captcha()**: [BROWSER/WEB AUTOMATION] Solve detected CAPTCHA.
- **browser_run_js(script)**: [BROWSER/WEB AUTOMATION] Execute custom JavaScript on the current page.
- **browser_run_script(code)**: [BROWSER/WEB AUTOMATION] Web Scratchpad: Execute custom JavaScript/Puppeteer code directly on the active browser page. Provides access to "page" and "browser" objects. (Admin only).
- **browser_back()**: [BROWSER/WEB AUTOMATION] Navigate back to the previous page.
- **browser_scroll(direction, amount?)**: [BROWSER/WEB AUTOMATION] Scroll the page up or down.
- **browser_hover(selector)**: [BROWSER/WEB AUTOMATION] Hover over an element to trigger menus or tooltips.
- **browser_select(selector, value)**: [BROWSER/WEB AUTOMATION] Select an option in a dropdown by visible label.
- **switch_browser_profile(profileName, profileDir?)**: [BROWSER/WEB AUTOMATION] Switch to a persistent browser profile.
- **switch_browser_engine(engine, endpoint?)**: [BROWSER/WEB AUTOMATION] Switch between Puppeteer and Lightpanda browser engines.
- **create_time_capsule(goal, duration_minutes)**: [ADMIN] Start a high-intensity, time-bounded task. Standard step limits and hard breaks are relaxed to allow the agent to go "all-in" on a complex goal within a specific time window. (Admin only).
- **extract_article(url?)**: [HIGH-LEVEL PREFERRED] Extract clean article text from a URL or the current page.
- **http_fetch(url, method?, headers?, body?, timeout?)**: [HIGH-LEVEL PREFERRED] Lightweight HTTP request (no browser). Supports GET/POST/PUT/PATCH/DELETE. Returns status + body. Ideal for APIs and simple pages. USE THIS BEFORE RESORTING TO FULL BROWSER.
- **youtube_trending(region?, category?)**: [HIGH-LEVEL PREFERRED] Fetch YouTube trending videos via API fallbacks.

## Computer Use (Vision + System)
- **computer_screenshot(context?)**: [VISION/COMPUTER CONTROL] Capture a screenshot (browser or system) with optional vision description.
- **computer_click(x?, y?, description?, button?, context?)**: [VISION/COMPUTER CONTROL] Click by coordinates or vision-locate a described element.
- **computer_vision_click(description, button?, context?)**: [VISION/COMPUTER CONTROL] Vision-guided click by description.
- **computer_type(text, inputDescription?, context?)**: [VISION/COMPUTER CONTROL] Type text, optionally vision-locating the input first.
- **computer_key(key, context?)**: [VISION/COMPUTER CONTROL] Press a key or key combo (e.g., ctrl+c, alt+Tab).
- **computer_mouse_move(x, y, context?)**: [VISION/COMPUTER CONTROL] Move the mouse cursor to pixel coordinates.
- **computer_drag(fromX, fromY, toX, toY, context?)**: [VISION/COMPUTER CONTROL] Drag from one point to another.
- **computer_scroll(direction, amount?, x?, y?, context?)**: [VISION/COMPUTER CONTROL] Scroll in browser or system context.
- **computer_locate(description, context?)**: [VISION/COMPUTER CONTROL] Vision-locate an element and return coordinates.
- **computer_describe(x?, y?, radius?, context?)**: [VISION/COMPUTER CONTROL] Vision description of the screen or a region.

## Memory, Journal & Learning
- **update_user_profile(info_text)**: [MEMORY/STATE] Save permanent information learned about the user.
- **update_agent_identity(trait)**: [MEMORY/STATE] Update the agent’s personality/identity.
- **update_journal(entry_text)**: [MEMORY/STATE] Write a reflection entry to JOURNAL.md.
- **update_learning(topic, knowledge_content?)**: [MEMORY/STATE] Research and persist knowledge to LEARNING.md.
- **update_world(topic, content)**: [MEMORY/STATE] Update the internal environment cluster, institution, and governance structure in WORLD.md. Use this to maintain the agentic society rules.
- **request_supporting_data(question)**: [MEMORY/STATE] Ask for missing info and pause execution.
- **deep_reason(topic)**: [MEMORY/STATE] Perform intensive multi-step analysis.
- **recall_memory(query, limit?)**: [MEMORY/STATE] Semantic search across ALL memory — finds relevant memories from any channel, time period, or type.
- **search_chat_history(jid, query?, limit?, source?)**: [MEMORY/STATE] Search chat history with a contact. Supports semantic search (meaning-based) and keyword search. Works across WhatsApp, Telegram, and Discord.
- **get_whatsapp_context(jid)**: [MEMORY/STATE] Get WhatsApp contact context including profile and recent history.

## RAG Knowledge Store
- **rag_ingest(content, source, collection?, title?, tags?, format?)**: [RAG/KNOWLEDGE] Ingest a document or dataset into the knowledge store. Chunks, embeds, and stores content for semantic retrieval. Supports text, markdown, CSV, JSON, JSONL, and code.
- **rag_ingest_file(file_path, collection?, tags?, title?)**: [RAG/KNOWLEDGE] Read a local file and ingest it into the knowledge store.
- **rag_ingest_url(url, collection?, tags?, title?)**: [RAG/KNOWLEDGE] Download a web page or file from a URL, extract readable text, and ingest it. Uses Readability for HTML extraction.
- **rag_search(query, limit?, collection?, tags?)**: [RAG/KNOWLEDGE] Semantic search across ingested knowledge. Returns the most relevant document chunks ranked by similarity.
- **rag_list(collection?)**: [RAG/KNOWLEDGE] List documents and collections in the knowledge store with stats (chunk counts, sizes, tags).
- **rag_delete(document_id?, collection?)**: [RAG/KNOWLEDGE] Delete a specific document or an entire collection from the knowledge store.

## Scheduling
- **schedule_task(time_or_cron, task_description)**: [SCHEDULING] Schedule a task for later.
- **scheduler_add(schedule, task_description, priority?)**: [SCHEDULING] Add a persistent, recurring task to the agent's internal scheduler (e.g., "every 2 hours", "9am daily").

## Multi-Agent Orchestration
- **spawn_agent(name, role, capabilities?)**: [ORCHESTRATION] Create a sub-agent for temporary task delegation.
- **create_peer_agent(name, role, specialized_governance?)**: [ORCHESTRATION] Create an independent "clone" that inherits your identity foundations and WORLD.md governance. Use this for permanent specialized entities.
- **configure_peer_agent(agent_id, updates:object)**: [ORCHESTRATION] Update the configuration (API keys, channel tokens, etc.) for an existing peer agent. The agent will be restarted to apply changes.
- **list_agents()**: [ORCHESTRATION] List active agents.
- **terminate_agent(agent_id)**: [ORCHESTRATION] Terminate a spawned agent.

## Skill Orchestration Metadata
Built-in and plugin skills use metadata flags to drive fluid orchestration without hardcoded tool lists:

- `isDeep`: (boolean) When true, this tool counts as "substantive progress." Resets the communication cooldown, allowing the agent is allowed to send a fresh status update after execution.
- `isResearch`: (boolean) When true, this tool has a much higher repetition budget (up to 15 calls per action). Essential for browsing and searching.
- `isSideEffect`: (boolean) When true, this tool is subject to deduplication and cross-channel permission checks. Used for messaging and file delivery.
- `isDangerous`: (boolean) When true, requires explicit user permission in autonomy mode unless `sudoMode` is active.
- `isElevated`: (boolean) When true, restricts execution to authorized admin users only.
- **delegate_task(description, priority?, agent_id?)**: [ORCHESTRATION] Create and assign a task.
- **distribute_tasks()**: [ORCHESTRATION] Auto-assign pending tasks.
- **orchestrator_status()**: [ORCHESTRATION] Get orchestration summary.
- **complete_delegated_task(task_id, result?)**: [ORCHESTRATION] Mark a delegated task completed.
- **fail_delegated_task(task_id, error)**: [ORCHESTRATION] Mark a delegated task failed.
- **send_agent_message(to_agent_id, message, type?)**: [ORCHESTRATION] Send inter-agent messages.
- **broadcast_to_agents(message)**: [ORCHESTRATION] Broadcast a message to all agents.
- **get_agent_messages(agent_id?, limit?)**: [ORCHESTRATION] Retrieve agent messages.
- **clone_self(clone_name, specialized_role?)**: [ORCHESTRATION] Create a full-capability clone.

## Self-Tuning & Adaptation
These skills allow the agent to dynamically adjust its own behavior based on what's working.

- **get_tuning_options()**: [SELF-TUNING] Discover all available tunable settings (browser, workflow, LLM).
- **tune_browser_domain(domain, settings, reason)**: [SELF-TUNING] Adjust browser settings for a specific domain (e.g., forceHeadful, clickTimeout, useSlowTyping).
- **mark_headful(domain, reason?)**: [SELF-TUNING] Mark a domain as requiring visible browser mode.
- **tune_workflow(settings, reason)**: [SELF-TUNING] Adjust workflow settings (maxStepsPerAction, maxRetriesPerSkill, retryDelayMs).
- **get_tuning_state()**: [SELF-TUNING] View current tuning configuration and learned settings.
- **get_tuning_history(limit?)**: [SELF-TUNING] See recent tuning changes and their outcomes.
- **reset_tuning(category?)**: [SELF-TUNING] Reset tuning to defaults (browser, workflow, llm, or all).

## Self-Training Sidecar
These skills manage OrcBot's offline-safe self-training pipeline: capture accepted trajectories from real work, prepare datasets and manifests, evaluate candidate models, and promote them through admin-gated rollout.

- **get_self_training_status()**: [SELF-TRAINING] Return self-training stats, artifact paths, candidate registry state, and the latest prepared/evaluated/promoted records.
- **prepare_self_training_job()**: [SELF-TRAINING] Build an offline training manifest from accepted trajectories. Does not mutate the live model.
- **run_self_training_eval(limit?, provider?, modelName?)**: [SELF-TRAINING][ADMIN] Evaluate accepted trajectories against the active or specified model and persist an evaluation report.
- **build_self_training_launch_plan(commandTemplate?, cwd?, sessionId?)**: [SELF-TRAINING][ADMIN] Build the command, working directory, and session ID for launching an external training job without executing it.
- **launch_self_training_job(commandTemplate?, cwd?, sessionId?, dryRun?)**: [SELF-TRAINING][ADMIN] Launch a prepared offline training job in a background shell session, or preview it with `dryRun`.
- **register_self_training_candidate(modelName, provider?, candidateId?, jobId?, notes?)**: [SELF-TRAINING][ADMIN] Register a trained candidate model, linking it to the latest evaluation and launch metadata when available.
- **promote_self_training_candidate(candidateId?, modelName?, provider?, dryRun?)**: [SELF-TRAINING][ADMIN] Promote a registered candidate into OrcBot's live `modelName` and `llmProvider` config after promotion gates pass. Use `dryRun` to preview the switch.

## Agent Skills (SKILL.md Ecosystem)
Agent Skills follow the [agentskills.io](https://agentskills.io/) specification — portable, LLM-readable skill packages that can extend OrcBot in any direction.

### Agent Skill Management
- **install_skill(source)**: [SKILL MANAGEMENT] Install a skill from GitHub URL, gist, `.skill` zip, or local path.
- **create_skill(name, description?, instructions?)**: [SKILL MANAGEMENT] Scaffold a new skill with SKILL.md template.
- **activate_skill(name, active?)**: [SKILL MANAGEMENT] Toggle skill activation (progressive disclosure — only activated skills load full instructions).
- **list_agent_skills()**: [SKILL MANAGEMENT] List all installed agent skills with status, resources, and version.
- **read_skill_resource(skill_name, file_path)**: [SKILL MANAGEMENT] Read a bundled file (reference, script, asset) from an installed skill.
- **validate_skill(name_or_path)**: [SKILL MANAGEMENT] Validate a skill directory against the agentskills.io specification.
- **uninstall_agent_skill(name)**: [SKILL MANAGEMENT] Remove an installed agent skill.
- **run_skill_script(skill_name, script, args?)**: [SKILL MANAGEMENT] Execute a bundled script (.js/.ts/.py/.sh/.ps1) from a skill.
- **write_skill_file(skill_name, file_path, content)**: [SKILL MANAGEMENT] Write or update files inside a skill directory.

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

- **manage_config({ action: "get", key })**: [CONFIG MANAGEMENT] Get current value of a configuration setting.
- **manage_config({ action: "set", key, value, reason? })**: [CONFIG MANAGEMENT] Set a configuration value (respects policy: SAFE, APPROVAL, or LOCKED).
- **manage_config({ action: "list" })**: [CONFIG MANAGEMENT] List all configurations categorized by policy level.
- **manage_config({ action: "policy" })**: [CONFIG MANAGEMENT] View configuration policy descriptions.
- **manage_config({ action: "history", limit? })**: [CONFIG MANAGEMENT] View configuration change history.
- **manage_config({ action: "pending" })**: [CONFIG MANAGEMENT] View pending approval requests.
- **manage_config({ action: "approve", key })**: [CONFIG MANAGEMENT] Approve a pending configuration change.
- **manage_config({ action: "reject", key })**: [CONFIG MANAGEMENT] Reject a pending configuration change.
- **manage_config({ action: "suggest", taskDescription })**: [CONFIG MANAGEMENT] Get configuration optimization suggestions for a task.

### Policy Levels
- **SAFE**: Agents can modify autonomously (e.g., modelName, memoryContextLimit, maxStepsPerAction)
- **APPROVAL**: Agents can request, requires approval (e.g., API keys, autonomy settings)
- **LOCKED**: Agents cannot modify (e.g., security settings like safeMode, commandDenyList)
