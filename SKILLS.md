# OrcBot Skills Registry

This file lists the available skills for the agent.

## Messaging & Media
- **send_telegram(chat_id, message)**: Send a message to a Telegram user.
- **send_whatsapp(jid, message)**: Send a message to a WhatsApp contact or group.
- **send_file(jid, path, caption?)**: Send a file to Telegram or WhatsApp.
- **download_file(url, filename?)**: Download a file to local storage.
- **analyze_media(path, prompt?)**: Analyze an image, audio, or document file.
- **post_whatsapp_status(text)**: Post a text update to WhatsApp status.
- **react_whatsapp(jid, message_id, emoji)**: React to a WhatsApp message with an emoji.
- **reply_whatsapp_status(jid, message)**: Reply to a contact’s WhatsApp status.
- **update_contact_profile(jid, profile_json)**: Persist a WhatsApp contact profile.

## System & Configuration
- **run_command(command)**: Execute shell commands (subject to allow/deny lists).
- **get_system_info()**: Return server time/date and OS info.
- **set_config(key, value)**: Persist configuration values.
- **manage_skills(skill_definition)**: Append new skill definitions to SKILLS.md.
- **self_repair_skill(skillName, errorMessage)**: Diagnose and fix a failing plugin skill.
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
- **switch_browser_profile(profileName, profileDir?)**: Switch to a persistent browser profile.
- **extract_article(url?)**: Extract clean article text from a URL or the current page.
- **youtube_trending(region?, category?)**: Fetch YouTube trending videos via API fallbacks.

## Memory, Journal & Learning
- **update_user_profile(info_text)**: Save permanent information learned about the user.
- **update_agent_identity(trait)**: Update the agent’s personality/identity.
- **update_journal(entry_text)**: Write a reflection entry to JOURNAL.md.
- **update_learning(topic, knowledge_content?)**: Research and persist knowledge.
- **request_supporting_data(question)**: Ask for missing info and pause execution.
- **deep_reason(topic)**: Perform intensive multi-step analysis.

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

## Community / Plugin Skills
Custom plugin skills are loaded from ~/.orcbot/plugins. If you add new plugins there, they will appear in the agent’s live skill registry.
