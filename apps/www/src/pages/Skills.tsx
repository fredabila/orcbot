import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import '../index.css';
import './Skills.css';

// ─── Data ────────────────────────────────────────────────────────────────────

type Tag = 'messaging' | 'browser' | 'system' | 'memory' | 'ai' | 'orchestration' | 'scheduling' | 'rag' | 'computer' | 'tuning' | 'email';

interface Skill {
  name: string;
  sig: string;
  desc: string;
  tags: Tag[];
}

const CATEGORIES: { id: Tag | 'all'; label: string; icon: string }[] = [
  { id: 'all',          label: 'All Skills',          icon: '✦' },
  { id: 'messaging',    label: 'Messaging & Media',    icon: '💬' },
  { id: 'browser',      label: 'Browser & Web',        icon: '🌐' },
  { id: 'system',       label: 'System & Config',      icon: '⚙️' },
  { id: 'memory',       label: 'Memory & Learning',    icon: '🧠' },
  { id: 'rag',          label: 'RAG Knowledge',        icon: '📚' },
  { id: 'ai',           label: 'AI & Analysis',        icon: '🤖' },
  { id: 'computer',     label: 'Computer Use',         icon: '🖥️' },
  { id: 'orchestration',label: 'Multi-Agent',          icon: '👥' },
  { id: 'email',        label: 'Email & Workspace',     icon: '📧' },
  { id: 'scheduling',   label: 'Scheduling',           icon: '🗓️' },
  { id: 'tuning',       label: 'Self-Tuning',          icon: '🔧' },
];

const SKILLS: Skill[] = [
  // ── Messaging & Media ──
  { name: 'send_telegram',       sig: 'send_telegram(chat_id, message)',             desc: 'Send a message to a Telegram user or group.',                                       tags: ['messaging'] },
  { name: 'send_whatsapp',       sig: 'send_whatsapp(jid, message)',                 desc: 'Send a message to a WhatsApp contact or group.',                                    tags: ['messaging'] },
  { name: 'send_discord',        sig: 'send_discord(channel_id, message)',           desc: 'Send a message to a Discord channel.',                                              tags: ['messaging'] },
  { name: 'send_discord_file',   sig: 'send_discord_file(channel_id, path, caption?)',desc: 'Send a file to a Discord channel with an optional caption.',                      tags: ['messaging'] },
  { name: 'send_gateway_chat',   sig: 'send_gateway_chat(message)',                  desc: 'Send a message to the web Gateway Chat interface.',                                 tags: ['messaging'] },
  { name: 'send_file',           sig: 'send_file(jid, path, caption?)',              desc: 'Send a file to Telegram or WhatsApp.',                                              tags: ['messaging'] },
  { name: 'download_file',       sig: 'download_file(url, filename?)',               desc: 'Download a file to local storage.',                                                 tags: ['messaging', 'system'] },
  { name: 'analyze_media',       sig: 'analyze_media(path, prompt?)',                desc: 'Analyze an image, audio, or document file using AI vision.',                       tags: ['messaging', 'ai'] },
  { name: 'text_to_speech',      sig: 'text_to_speech(text, voice?, speed?)',        desc: 'Convert text to an audio file using AI voice synthesis.',                          tags: ['messaging', 'ai'] },
  { name: 'send_voice_note',     sig: 'send_voice_note(jid, text, voice?)',          desc: 'Convert text to speech and send as a voice note.',                                 tags: ['messaging', 'ai'] },
  { name: 'post_whatsapp_status',sig: 'post_whatsapp_status(text)',                  desc: 'Post a text update to your WhatsApp status.',                                      tags: ['messaging'] },
  { name: 'react',               sig: 'react(message_id, emoji, channel?, chat_id?)',desc: 'React to a message with an emoji (auto-detects channel).',                        tags: ['messaging'] },
  { name: 'react_telegram',      sig: 'react_telegram(chat_id, message_id, emoji)',  desc: 'React to a specific Telegram message.',                                            tags: ['messaging'] },
  { name: 'react_whatsapp',      sig: 'react_whatsapp(jid, message_id, emoji)',      desc: 'React to a specific WhatsApp message.',                                            tags: ['messaging'] },
  { name: 'react_discord',       sig: 'react_discord(channel_id, message_id, emoji)',desc: 'React to a specific Discord message.',                                             tags: ['messaging'] },
  { name: 'reply_whatsapp_status',sig:'reply_whatsapp_status(jid, message)',         desc: 'Reply to a contact\'s WhatsApp status.',                                           tags: ['messaging'] },
  { name: 'update_contact_profile',sig:'update_contact_profile(jid, profile_json)', desc: 'Persist a WhatsApp contact profile.',                                              tags: ['messaging', 'memory'] },
  { name: 'get_contact_profile', sig: 'get_contact_profile(jid)',                    desc: 'Retrieve a stored WhatsApp contact profile.',                                      tags: ['messaging', 'memory'] },
  { name: 'list_whatsapp_contacts',sig:'list_whatsapp_contacts(limit?)',             desc: 'List recent WhatsApp contacts that interacted with the bot.',                      tags: ['messaging'] },
  { name: 'get_discord_guilds',  sig: 'get_discord_guilds()',                        desc: 'Get the list of Discord servers the bot is in.',                                   tags: ['messaging'] },
  { name: 'get_discord_channels',sig: 'get_discord_channels(guild_id)',              desc: 'Get the list of text channels in a Discord server.',                               tags: ['messaging'] },
  // ── System & Config ──
  { name: 'run_command',         sig: 'run_command(command, cwd?)',                  desc: 'Execute shell commands with allow/deny list safety. Auto-extracts working dir.',   tags: ['system'] },
  { name: 'get_system_info',     sig: 'get_system_info()',                           desc: 'Return system time, date, and OS information.',                                    tags: ['system'] },
  { name: 'set_config',          sig: 'set_config(key, value)',                      desc: 'Persist configuration values to the config store.',                                tags: ['system'] },
  { name: 'manage_skills',       sig: 'manage_skills(skill_definition)',             desc: 'Append new skill definitions to SKILLS.md.',                                       tags: ['system'] },
  { name: 'self_repair_skill',   sig: 'self_repair_skill(skillName, errorMessage)',  desc: 'Diagnose and automatically fix a failing plugin skill.',                           tags: ['system', 'ai'] },
  { name: 'install_npm_dependency',sig:'install_npm_dependency(packageName)',        desc: 'Install an NPM package for use in custom plugin skills.',                          tags: ['system'] },
  // ── Browser & Web ──
  { name: 'web_search',          sig: 'web_search(query)',                           desc: 'Search the web using multiple engines with automatic fallback.',                   tags: ['browser'] },
  { name: 'browser_navigate',    sig: 'browser_navigate(url)',                       desc: 'Navigate to a URL and return a semantic snapshot for interaction.',                tags: ['browser'] },
  { name: 'browser_examine_page',sig: 'browser_examine_page()',                      desc: 'Get a semantic snapshot of the current page.',                                     tags: ['browser'] },
  { name: 'browser_wait',        sig: 'browser_wait(ms)',                            desc: 'Wait for a specified number of milliseconds.',                                     tags: ['browser'] },
  { name: 'browser_wait_for',    sig: 'browser_wait_for(selector, timeout?)',        desc: 'Wait for an element selector to appear.',                                          tags: ['browser'] },
  { name: 'browser_click',       sig: 'browser_click(selector_or_ref)',              desc: 'Click an element by CSS selector or orcbot-ref.',                                  tags: ['browser'] },
  { name: 'browser_type',        sig: 'browser_type(selector_or_ref, text)',         desc: 'Type text into an element by selector or ref.',                                    tags: ['browser'] },
  { name: 'browser_press',       sig: 'browser_press(key)',                          desc: 'Press a keyboard key in the browser.',                                             tags: ['browser'] },
  { name: 'browser_screenshot',  sig: 'browser_screenshot()',                        desc: 'Capture a screenshot of the current browser page.',                                tags: ['browser'] },
  { name: 'browser_vision',      sig: 'browser_vision(prompt?)',                     desc: 'Analyze the current page using AI vision capabilities.',                           tags: ['browser', 'ai'] },
  { name: 'browser_solve_captcha',sig:'browser_solve_captcha()',                     desc: 'Automatically solve detected CAPTCHA challenges via 2Captcha.',                   tags: ['browser'] },
  { name: 'browser_run_js',      sig: 'browser_run_js(script)',                      desc: 'Execute custom JavaScript on the current page.',                                   tags: ['browser'] },
  { name: 'browser_back',        sig: 'browser_back()',                              desc: 'Navigate back to the previous page.',                                              tags: ['browser'] },
  { name: 'browser_scroll',      sig: 'browser_scroll(direction, amount?)',          desc: 'Scroll the page up or down by a specified amount.',                                tags: ['browser'] },
  { name: 'browser_hover',       sig: 'browser_hover(selector)',                     desc: 'Hover over an element to trigger menus or tooltips.',                              tags: ['browser'] },
  { name: 'browser_select',      sig: 'browser_select(selector, value)',             desc: 'Select an option in a dropdown by visible label.',                                 tags: ['browser'] },
  { name: 'switch_browser_profile',sig:'switch_browser_profile(profileName, dir?)', desc: 'Switch to a persistent browser profile for session continuity.',                   tags: ['browser'] },
  { name: 'switch_browser_engine',sig:'switch_browser_engine(engine, endpoint?)',   desc: 'Switch between Playwright and Lightpanda browser engines.',                        tags: ['browser'] },
  { name: 'extract_article',     sig: 'extract_article(url?)',                       desc: 'Extract clean article text from a URL or current page.',                           tags: ['browser'] },
  { name: 'http_fetch',          sig: 'http_fetch(url, method?, headers?, body?, timeout?)',desc: 'Lightweight HTTP request without a browser. Supports all methods.',        tags: ['browser'] },
  { name: 'youtube_trending',    sig: 'youtube_trending(region?, category?)',        desc: 'Fetch YouTube trending videos via API fallbacks.',                                  tags: ['browser'] },
  // ── Computer Use ──
  { name: 'computer_screenshot', sig: 'computer_screenshot(context?)',               desc: 'Capture a screenshot of the browser or desktop with optional vision.',             tags: ['computer'] },
  { name: 'computer_click',      sig: 'computer_click(x?, y?, description?, button?, context?)',desc:'Click by coordinates or vision-locate a described element.',            tags: ['computer'] },
  { name: 'computer_vision_click',sig:'computer_vision_click(description, button?, context?)',desc:'Vision-guided click by natural language description.',                    tags: ['computer', 'ai'] },
  { name: 'computer_type',       sig: 'computer_type(text, inputDescription?, context?)',desc: 'Type text, optionally vision-locating the target input first.',               tags: ['computer'] },
  { name: 'computer_key',        sig: 'computer_key(key, context?)',                 desc: 'Press a key or key combo (e.g., ctrl+c, alt+Tab).',                               tags: ['computer'] },
  { name: 'computer_mouse_move', sig: 'computer_mouse_move(x, y, context?)',         desc: 'Move the mouse cursor to specific pixel coordinates.',                             tags: ['computer'] },
  { name: 'computer_drag',       sig: 'computer_drag(fromX, fromY, toX, toY, context?)',desc:'Drag from one point to another on screen.',                                     tags: ['computer'] },
  { name: 'computer_scroll',     sig: 'computer_scroll(direction, amount?, x?, y?, context?)',desc:'Scroll in browser or system context.',                                    tags: ['computer'] },
  { name: 'computer_locate',     sig: 'computer_locate(description, context?)',      desc: 'Vision-locate an element and return its coordinates.',                             tags: ['computer', 'ai'] },
  { name: 'computer_describe',   sig: 'computer_describe(x?, y?, radius?, context?)',desc: 'Vision description of the full screen or a specific region.',                    tags: ['computer', 'ai'] },
  // ── Memory & Learning ──
  { name: 'update_user_profile', sig: 'update_user_profile(info_text)',              desc: 'Save permanent information learned about the user to profile.',                    tags: ['memory'] },
  { name: 'update_agent_identity',sig:'update_agent_identity(trait)',                desc: 'Update the agent\'s personality or identity traits.',                              tags: ['memory'] },
  { name: 'update_journal',      sig: 'update_journal(entry_text)',                  desc: 'Write a reflection entry to the agent\'s JOURNAL.md.',                            tags: ['memory'] },
  { name: 'update_learning',     sig: 'update_learning(topic, knowledge_content?)', desc: 'Research and persist knowledge to the LEARNING.md file.',                          tags: ['memory', 'ai'] },
  { name: 'request_supporting_data',sig:'request_supporting_data(question)',         desc: 'Ask the user for missing info and pause execution until answered.',                tags: ['memory'] },
  { name: 'deep_reason',         sig: 'deep_reason(topic)',                          desc: 'Perform intensive multi-step analysis on a topic.',                                tags: ['memory', 'ai'] },
  { name: 'recall_memory',       sig: 'recall_memory(query, limit?)',                desc: 'Semantic search across ALL memory — finds memories from any channel or time.',    tags: ['memory'] },
  { name: 'search_chat_history', sig: 'search_chat_history(jid, query?, limit?, source?)',desc:'Search chat history with a contact by meaning or keyword.',                  tags: ['memory'] },
  { name: 'get_whatsapp_context',sig: 'get_whatsapp_context(jid)',                   desc: 'Get WhatsApp contact context including profile and recent history.',               tags: ['memory', 'messaging'] },
  // ── RAG ──
  { name: 'rag_ingest',          sig: 'rag_ingest(content, source, collection?, title?, tags?, format?)',desc:'Ingest a document into the knowledge store. Chunks and embeds it.', tags: ['rag'] },
  { name: 'rag_ingest_file',     sig: 'rag_ingest_file(file_path, collection?, tags?, title?)',desc:'Read a local file and ingest it into the knowledge store.',               tags: ['rag'] },
  { name: 'rag_ingest_url',      sig: 'rag_ingest_url(url, collection?, tags?, title?)',desc:'Download a web page and ingest it. Uses Readability for HTML.',                 tags: ['rag'] },
  { name: 'rag_search',          sig: 'rag_search(query, limit?, collection?, tags?)',desc:'Semantic search across ingested knowledge, ranked by similarity.',                 tags: ['rag', 'ai'] },
  { name: 'rag_list',            sig: 'rag_list(collection?)',                        desc: 'List documents and collections with stats (chunks, sizes, tags).',                tags: ['rag'] },
  { name: 'rag_delete',          sig: 'rag_delete(document_id?, collection?)',        desc: 'Delete a specific document or entire collection from the knowledge store.',       tags: ['rag'] },
  // ── Scheduling ──
  { name: 'schedule_task',       sig: 'schedule_task(time_or_cron, task_description)',desc:'Schedule a task for later using a time string or cron expression.',              tags: ['scheduling'] },
  // ── Multi-Agent Orchestration ──
  { name: 'spawn_agent',         sig: 'spawn_agent(name, role, capabilities?)',       desc: 'Create a sub-agent with a specific role and optional capabilities.',              tags: ['orchestration'] },
  { name: 'list_agents',         sig: 'list_agents()',                                desc: 'List all currently active spawned agents.',                                       tags: ['orchestration'] },
  { name: 'terminate_agent',     sig: 'terminate_agent(agent_id)',                    desc: 'Terminate a specific spawned agent.',                                             tags: ['orchestration'] },
  { name: 'delegate_task',       sig: 'delegate_task(description, priority?, agent_id?)',desc:'Create and assign a task to an agent.',                                        tags: ['orchestration'] },
  { name: 'distribute_tasks',    sig: 'distribute_tasks()',                           desc: 'Auto-assign all pending tasks to available agents.',                              tags: ['orchestration'] },
  { name: 'orchestrator_status', sig: 'orchestrator_status()',                        desc: 'Get a full orchestration status summary.',                                        tags: ['orchestration'] },
  { name: 'complete_delegated_task',sig:'complete_delegated_task(task_id, result?)', desc: 'Mark a delegated task as completed with an optional result.',                     tags: ['orchestration'] },
  { name: 'fail_delegated_task', sig: 'fail_delegated_task(task_id, error)',          desc: 'Mark a delegated task as failed with an error message.',                         tags: ['orchestration'] },
  { name: 'send_agent_message',  sig: 'send_agent_message(to_agent_id, message, type?)',desc:'Send a message to a specific agent.',                                           tags: ['orchestration'] },
  { name: 'broadcast_to_agents', sig: 'broadcast_to_agents(message)',                 desc: 'Broadcast a message to all active agents simultaneously.',                       tags: ['orchestration'] },
  { name: 'get_agent_messages',  sig: 'get_agent_messages(agent_id?, limit?)',        desc: 'Retrieve messages sent to/from an agent.',                                        tags: ['orchestration'] },
  { name: 'clone_self',          sig: 'clone_self(clone_name, specialized_role?)',    desc: 'Create a full-capability clone of the current agent.',                           tags: ['orchestration'] },
  // ── Self-Tuning ──
  { name: 'get_tuning_options',  sig: 'get_tuning_options()',                         desc: 'Discover all available tunable settings (browser, workflow, LLM).',              tags: ['tuning'] },
  { name: 'tune_browser_domain', sig: 'tune_browser_domain(domain, settings, reason)',desc:'Adjust browser settings for a specific domain.',                                  tags: ['tuning', 'browser'] },
  { name: 'mark_headful',        sig: 'mark_headful(domain, reason?)',                desc: 'Mark a domain as requiring visible (headful) browser mode.',                     tags: ['tuning', 'browser'] },
  { name: 'tune_workflow',       sig: 'tune_workflow(settings, reason)',              desc: 'Adjust workflow settings like maxStepsPerAction and retryDelayMs.',               tags: ['tuning'] },
  { name: 'get_tuning_state',    sig: 'get_tuning_state()',                           desc: 'View current tuning configuration and all learned domain settings.',              tags: ['tuning'] },
  { name: 'get_tuning_history',  sig: 'get_tuning_history(limit?)',                   desc: 'See recent tuning changes and their impact outcomes.',                            tags: ['tuning'] },
  { name: 'reset_tuning',        sig: 'reset_tuning(category?)',                      desc: 'Reset browser, workflow, LLM, or all tuning to defaults.',                       tags: ['tuning'] },
  // ── Telegram Advanced ──
  { name: 'telegram_send_buttons',sig: 'telegram_send_buttons(chatId, message, buttons)',desc: 'Send Telegram message with inline keyboard buttons for user choice.',             tags: ['messaging'] },
  { name: 'telegram_edit_message',sig: 'telegram_edit_message(chatId, messageId, newText)',desc: 'Edit a previously-sent Telegram message in-place.',                             tags: ['messaging'] },
  { name: 'telegram_send_poll',  sig: 'telegram_send_poll(chatId, question, options, isAnonymous?)',desc: 'Create a native Telegram poll for structured user input.',              tags: ['messaging'] },
  { name: 'telegram_react',      sig: 'telegram_react(chatId, messageId, emoji)',     desc: 'React to a Telegram message with an emoji.',                                      tags: ['messaging'] },
  { name: 'telegram_pin_message',sig: 'telegram_pin_message(chatId, messageId, silent?)',desc: 'Pin a message in a Telegram chat.',                                             tags: ['messaging'] },
  // ── Email & Slack ──
  { name: 'send_email',          sig: 'send_email(to, subject, message, inReplyTo?, references?)',desc: 'Send email via configured SMTP with threading support.',                  tags: ['email'] },
  { name: 'search_emails',       sig: 'search_emails({ query?, sender?, subject?, daysAgo?, unreadOnly?, limit? })',desc: 'Search inbox for emails matching criteria.',            tags: ['email'] },
  { name: 'fetch_email',         sig: 'fetch_email(uid)',                             desc: 'Fetch the full content of a specific email by UID.',                               tags: ['email'] },
  { name: 'index_emails_to_knowledge_base',sig: 'index_emails_to_knowledge_base({ query?, sender?, subject?, daysAgo?, limit?, collection? })',desc: 'Index emails into the Knowledge Store for semantic search.', tags: ['email', 'rag'] },
  { name: 'generate_email_report',sig: 'generate_email_report({ topic, emails?, sender?, subject?, query?, daysAgo? })',desc: 'Analyze emails and generate a synthesized report.',  tags: ['email', 'ai'] },
  { name: 'google_identity_status',sig: 'google_identity_status()',                   desc: 'Check whether Google OAuth and the Gmail-backed identity are configured.',         tags: ['email'] },
  { name: 'google_identity_connect',sig: 'google_identity_connect(client_id?, client_secret?, code_or_redirect_url?, email?)',desc: 'Connect the Google identity service for Gmail auth workflows.', tags: ['email'] },
  { name: 'google_inbox_search', sig: 'google_inbox_search(query, maxResults?)',      desc: 'Search the connected Gmail inbox for auth messages or verification mail.',         tags: ['email'] },
  { name: 'google_latest_otp',   sig: 'google_latest_otp(from_contains?, subject_contains?)',desc: 'Extract the latest numeric OTP from recent Gmail messages.',                  tags: ['email'] },
  { name: 'google_workspace_status',sig: 'google_workspace_status()',                 desc: 'Check whether the Google Workspace CLI is installed and authenticated.',           tags: ['email'] },
  { name: 'google_workspace_command',sig: 'google_workspace_command(args:array, json?, account?)',desc: 'Run a structured gws command without a shell.',                       tags: ['email', 'system'] },
  { name: 'google_docs_create',  sig: 'google_docs_create(title, content?, account?)',desc: 'Create a Google Doc and optionally append initial text.',                         tags: ['email'] },
  { name: 'google_docs_write',   sig: 'google_docs_write(document_id, text, account?)',desc: 'Append plain text to an existing Google Doc.',                                  tags: ['email'] },
  { name: 'google_drive_list',   sig: 'google_drive_list(query?, pageSize?, account?)',desc: 'List Google Drive files through Google Workspace CLI.',                          tags: ['email'] },
  { name: 'google_sheets_create',sig: 'google_sheets_create(title, account?)',        desc: 'Create a Google Sheets spreadsheet.',                                              tags: ['email'] },
  { name: 'google_sheets_read',  sig: 'google_sheets_read(spreadsheet_id, range, account?)',desc: 'Read a range of values from a Google Sheet.',                            tags: ['email'] },
  { name: 'google_sheets_append',sig: 'google_sheets_append(spreadsheet_id, values|json_values, account?, dryRun?)',desc: 'Append one or more rows to a Google Sheet.',      tags: ['email'] },
  { name: 'google_calendar_create_event',sig: 'google_calendar_create_event(summary, start, end, calendar?, location?, description?, attendees?, account?, dryRun?)',desc: 'Create a Google Calendar event.', tags: ['email'] },
  { name: 'google_gmail_triage', sig: 'google_gmail_triage(max?, query?, labels?, account?)',desc: 'Show an unread Gmail summary via Google Workspace CLI.',                 tags: ['email'] },
  { name: 'google_gmail_send',   sig: 'google_gmail_send(to, subject, body, cc?, bcc?, account?, dryRun?)',desc: 'Send a plain-text Gmail message via gws.',                 tags: ['email'] },
  { name: 'google_gmail_reply',  sig: 'google_gmail_reply(message_id, body, to?, cc?, bcc?, from?, account?, dryRun?)',desc: 'Reply to a Gmail message while preserving threading.', tags: ['email'] },
  { name: 'google_gmail_reply_all',sig: 'google_gmail_reply_all(message_id, body, to?, cc?, bcc?, remove?, from?, account?, dryRun?)',desc: 'Reply-all to a Gmail thread.',  tags: ['email'] },
  { name: 'send_slack',          sig: 'send_slack(channel_id, message)',              desc: 'Send a message to a Slack channel or DM.',                                        tags: ['email'] },
  { name: 'send_slack_file',     sig: 'send_slack_file(channel_id, file_path, caption?)',desc: 'Send a file to a Slack channel with optional caption.',                         tags: ['email'] },
  { name: 'react_slack',         sig: 'react_slack(channel_id, message_id, emoji)',   desc: 'React to a Slack message with an emoji.',                                          tags: ['email'] },
  // ── WhatsApp Advanced ──
  { name: 'search_whatsapp_contacts',sig: 'search_whatsapp_contacts(query)',          desc: 'Search for WhatsApp contacts by name or number.',                                 tags: ['messaging'] },
  // ── Memory Advanced ──
  { name: 'memory_search',       sig: 'memory_search(query)',                         desc: 'Search across all memory files with semantic + keyword hybrid.',                   tags: ['memory'] },
  { name: 'memory_get',          sig: 'memory_get(path)',                             desc: 'Retrieve full content of a specific memory file.',                                 tags: ['memory'] },
  { name: 'memory_write',        sig: 'memory_write(content, type?, category?)',      desc: 'Write entry to daily log or long-term memory.',                                    tags: ['memory'] },
  { name: 'memory_stats',        sig: 'memory_stats()',                               desc: 'Get statistics about the memory system.',                                          tags: ['memory'] },
  { name: 'search_memory_logs',  sig: 'search_memory_logs(query)',                    desc: 'Search memory log files by keyword.',                                              tags: ['memory'] },
  { name: 'list_memory_logs',    sig: 'list_memory_logs()',                           desc: 'List available memory log files.',                                                 tags: ['memory'] },
  { name: 'read_memory_log',     sig: 'read_memory_log(file)',                        desc: 'Read a specific memory log file.',                                                 tags: ['memory'] },
  // ── Canvas / Dashboard ──
  { name: 'render_canvas',       sig: 'render_canvas({ html, js?, css?, title? })',   desc: 'Render live interactive HTML/JS workspace in the dashboard.',                      tags: ['ai', 'system'] },
  // ── Image & Media Generation ──
  { name: 'generate_image',      sig: 'generate_image(prompt, options?)',             desc: 'Generate an image from a text prompt using AI.',                                   tags: ['ai', 'messaging'] },
  { name: 'send_image',          sig: 'send_image(to, image_path, caption?, channel?)',desc: 'Send an image to a specified channel.',                                           tags: ['messaging'] },
  // ── Model Management ──
  { name: 'list_available_models',sig: 'list_available_models()',                     desc: 'List all available LLM models configured.',                                        tags: ['ai', 'system'] },
  { name: 'switch_model',        sig: 'switch_model(model_name)',                     desc: 'Switch to a different LLM model.',                                                 tags: ['ai', 'system'] },
  // ── Shell & Terminal ──
  { name: 'shell_start',         sig: 'shell_start(shell_type?)',                     desc: 'Start a new interactive shell session.',                                           tags: ['system'] },
  { name: 'shell_poll',          sig: 'shell_poll(session_id)',                       desc: 'Poll for output from a running shell session.',                                    tags: ['system'] },
  { name: 'shell_read',          sig: 'shell_read(session_id)',                       desc: 'Read all output from a shell session.',                                            tags: ['system'] },
  { name: 'shell_send',          sig: 'shell_send(session_id, command)',              desc: 'Send a command to a running shell session.',                                       tags: ['system'] },
  { name: 'shell_stop',          sig: 'shell_stop(session_id)',                       desc: 'Stop a shell session.',                                                            tags: ['system'] },
  { name: 'shell_list',          sig: 'shell_list()',                                 desc: 'List all running shell sessions.',                                                 tags: ['system'] },
  { name: 'orcbot_control',      sig: 'orcbot_control(action, args?)',                desc: 'Internal control for OrcBot daemon operations.',                                   tags: ['system'] },
  { name: 'system_check',        sig: 'system_check()',                               desc: 'Run a comprehensive system health check.',                                         tags: ['system'] },
  { name: 'manage_config',       sig: 'manage_config({ action, key?, value? })',      desc: 'Manage agent configuration with approval workflow.',                                tags: ['system'] },
  // ── Tool Management ──
  { name: 'install_tool',        sig: 'install_tool(tool_name, url)',                 desc: 'Install a new tool from URL or registry.',                                         tags: ['system'] },
  { name: 'list_tools',          sig: 'list_tools()',                                 desc: 'List all installed tools and plugins.',                                             tags: ['system'] },
  { name: 'activate_tool',       sig: 'activate_tool(tool_name)',                     desc: 'Activate an installed tool.',                                                      tags: ['system'] },
  { name: 'approve_tool',        sig: 'approve_tool(tool_name)',                      desc: 'Approve a tool for use.',                                                          tags: ['system'] },
  { name: 'read_tool_readme',    sig: 'read_tool_readme(tool_name)',                  desc: 'Read documentation for a tool.',                                                   tags: ['system'] },
  { name: 'run_tool_command',    sig: 'run_tool_command(tool_name, command, args?)',   desc: 'Run a command via an installed tool.',                                             tags: ['system'] },
  { name: 'uninstall_tool',      sig: 'uninstall_tool(tool_name)',                    desc: 'Uninstall a tool.',                                                                tags: ['system'] },
  { name: 'tweak_skill',         sig: 'tweak_skill(skill_name, parameter, new_value)',desc: 'Tweak runtime parameters of an existing skill.',                                   tags: ['system', 'tuning'] },
  // ── Agent Skill Management ──
  { name: 'install_skill',       sig: 'install_skill(source)',                        desc: 'Install Agent Skill from GitHub, gist, URL, or npm package.',                      tags: ['system'] },
  { name: 'create_skill',        sig: 'create_skill({ name, description, usage, content, category? })',desc: 'Create a knowledge-based skill (instructions/workflows).',          tags: ['system'] },
  { name: 'activate_skill',      sig: 'activate_skill(skill_names)',                  desc: 'Enable or activate installed agent skills.',                                       tags: ['system'] },
  { name: 'list_agent_skills',   sig: 'list_agent_skills()',                          desc: 'List all available agent skills.',                                                 tags: ['system'] },
  { name: 'read_skill_resource', sig: 'read_skill_resource(skill_name, resource?)',   desc: 'Read a resource file from an agent skill.',                                        tags: ['system'] },
  { name: 'validate_skill',      sig: 'validate_skill(skill_name)',                   desc: 'Validate the syntax and structure of a skill.',                                    tags: ['system'] },
  { name: 'uninstall_agent_skill',sig: 'uninstall_agent_skill(skill_name)',           desc: 'Uninstall or remove an agent skill.',                                              tags: ['system'] },
  { name: 'run_skill_script',    sig: 'run_skill_script(skill_name, script_name, args?)',desc: 'Execute a named script from a skill.',                                         tags: ['system'] },
  { name: 'write_skill_file',    sig: 'write_skill_file(skill_name, file_path, content)',desc: 'Write a file into a skill\'s directory.',                                       tags: ['system'] },
  // ── Browser Advanced ──
  { name: 'browser_set_viewport',sig: 'browser_set_viewport(width, height, scale?)', desc: 'Set the browser viewport size.',                                                    tags: ['browser'] },
  { name: 'browser_run_script',  sig: 'browser_run_script(script)',                   desc: 'Run JavaScript in the browser and return the result.',                              tags: ['browser'] },
  { name: 'browser_debug_overlay',sig: 'browser_debug_overlay(action?, text?)',       desc: 'Show or hide a debug overlay on the page.',                                        tags: ['browser'] },
  { name: 'browser_click_text',  sig: 'browser_click_text(text, options?)',           desc: 'Click an element containing specific text.',                                        tags: ['browser'] },
  { name: 'browser_find_element',sig: 'browser_find_element(selector, options?)',     desc: 'Find an element and get its metadata.',                                             tags: ['browser'] },
  { name: 'browser_type_into_label',sig: 'browser_type_into_label(label_text, value)',desc: 'Type into an input field associated with a label.',                                 tags: ['browser'] },
  { name: 'browser_cleanup',     sig: 'browser_cleanup()',                            desc: 'Clean up browser resources and close the page.',                                    tags: ['browser'] },
  { name: 'browser_perform',     sig: 'browser_perform(actions)',                     desc: 'Execute a batch of browser actions sequentially.',                                  tags: ['browser'] },
  { name: 'browser_trace_start', sig: 'browser_trace_start()',                        desc: 'Start Playwright trace recording.',                                                 tags: ['browser'] },
  { name: 'browser_trace_stop',  sig: 'browser_trace_stop()',                         desc: 'Stop trace recording and save the trace file.',                                     tags: ['browser'] },
  { name: 'browser_api_intercept',sig: 'browser_api_intercept()',                     desc: 'Enable API interception to discover XHR/fetch endpoints.',                           tags: ['browser'] },
  { name: 'browser_api_list',    sig: 'browser_api_list(json_only?)',                 desc: 'List all API endpoints discovered by interception.',                                 tags: ['browser'] },
  { name: 'browser_extract_content',sig: 'browser_extract_content()',                 desc: 'Extract readable text from the current page.',                                      tags: ['browser'] },
  { name: 'browser_extract_data',sig: 'browser_extract_data(selector, attribute?, limit?)',desc: 'Extract structured data from CSS-matched elements.',                            tags: ['browser'] },
  { name: 'browser_fill_form',   sig: 'browser_fill_form(fields, submit_selector?)', desc: 'Batch fill multiple form fields and optionally submit.',                              tags: ['browser'] },
  // ── Firecrawl Cloud Browsing ──
  { name: 'firecrawl_scrape',    sig: 'firecrawl_scrape(url, format?, options?)',     desc: 'Scrape a URL using Firecrawl cloud renderer.',                                      tags: ['browser'] },
  { name: 'firecrawl_search',    sig: 'firecrawl_search(query, limit?, sources?, scrape?, tbs?)',desc: 'Web search via Firecrawl with optional content scraping.',                tags: ['browser'] },
  { name: 'firecrawl_browser',   sig: 'firecrawl_browser(command, session_id?)',      desc: 'Execute commands in a Firecrawl cloud browser sandbox.',                             tags: ['browser'] },
  { name: 'firecrawl_crawl',     sig: 'firecrawl_crawl(url, limit?, max_depth?, wait?, output?)',desc: 'Crawl an entire website using Firecrawl.',                                tags: ['browser'] },
  { name: 'firecrawl_agent',     sig: 'firecrawl_agent(prompt, urls?, schema?, wait?)',desc: 'AI-powered structured data extraction from the web.',                               tags: ['browser', 'ai'] },
  // ── File System & Code Execution ──
  { name: 'write_file',          sig: 'write_file(path, content, mode?)',             desc: 'Write or append content to a file.',                                                tags: ['system'] },
  { name: 'read_file',           sig: 'read_file(path, startLine?, endLine?)',        desc: 'Read a file with optional line range.',                                             tags: ['system'] },
  { name: 'create_directory',    sig: 'create_directory(path)',                       desc: 'Create a directory and parent directories.',                                        tags: ['system'] },
  { name: 'list_directory',      sig: 'list_directory(path)',                         desc: 'List all files in a directory.',                                                    tags: ['system'] },
  { name: 'generate_pdf',        sig: 'generate_pdf(content, output_path, is_html?)', desc: 'Generate a PDF from Markdown or HTML content.',                                    tags: ['system'] },
  { name: 'execute_typescript',  sig: 'execute_typescript(code?, args?, filename?)',  desc: 'Write, compile, and execute TypeScript code on-the-fly.',                           tags: ['system', 'ai'] },
  { name: 'execute_python_code', sig: 'execute_python_code(code, filename?)',         desc: 'Execute Python code in an isolated virtual environment.',                           tags: ['system', 'ai'] },
  { name: 'install_python_package',sig: 'install_python_package(package)',            desc: 'Install a Python package via pip into the venv.',                                   tags: ['system'] },
  { name: 'create_custom_skill', sig: 'create_custom_skill({ name, description, usage, code })',desc: 'Create a code-based plugin skill (.ts) for runnable logic.',              tags: ['system', 'ai'] },
  // ── Action Queue Management ──
  { name: 'cancel_action',       sig: 'cancel_action(action_id)',                    desc: 'Cancel a specific action in the queue.',                                             tags: ['system'] },
  { name: 'clear_action_queue',  sig: 'clear_action_queue(status?)',                 desc: 'Clear the action queue, optionally filtered by status.',                              tags: ['system'] },
  // ── Scheduling Advanced ──
  { name: 'schedule_list',       sig: 'schedule_list()',                              desc: 'List all scheduled tasks.',                                                         tags: ['scheduling'] },
  { name: 'schedule_remove',     sig: 'schedule_remove(schedule_id)',                 desc: 'Remove a scheduled task.',                                                          tags: ['scheduling'] },
  { name: 'scheduler_add',       sig: 'scheduler_add(cronPattern, description, payload?)',desc: 'Add a cron-based scheduled task.',                                              tags: ['scheduling'] },
  { name: 'heartbeat_schedule',  sig: 'heartbeat_schedule({ contact, interval, instructions, message? })',desc: 'Create a recurring heartbeat check-in schedule.',                tags: ['scheduling'] },
  { name: 'heartbeat_list',      sig: 'heartbeat_list()',                             desc: 'List all heartbeat schedules.',                                                     tags: ['scheduling'] },
  { name: 'heartbeat_mark_check',sig: 'heartbeat_mark_check(heartbeat_id, status)',   desc: 'Mark a heartbeat check as done.',                                                  tags: ['scheduling'] },
  { name: 'heartbeat_instructions',sig: 'heartbeat_instructions(heartbeat_id)',       desc: 'Get instructions for a heartbeat.',                                                 tags: ['scheduling'] },
  { name: 'heartbeat_remove',    sig: 'heartbeat_remove(heartbeat_id)',               desc: 'Remove a heartbeat schedule.',                                                      tags: ['scheduling'] },
  // ── Polling ──
  { name: 'register_polling_job',sig: 'register_polling_job({ description, interval, config? })',desc: 'Register a recurring polling task.',                                     tags: ['scheduling'] },
  { name: 'cancel_polling_job',  sig: 'cancel_polling_job(job_id)',                   desc: 'Cancel a polling job.',                                                             tags: ['scheduling'] },
  { name: 'get_polling_status',  sig: 'get_polling_status(job_id?)',                  desc: 'Get status of polling jobs.',                                                       tags: ['scheduling'] },
  { name: 'list_polling_jobs',   sig: 'list_polling_jobs()',                          desc: 'List all registered polling jobs.',                                                  tags: ['scheduling'] },
  { name: 'get_polling_job_status',sig: 'get_polling_job_status(job_id)',             desc: 'Get the status of a specific polling job.',                                          tags: ['scheduling'] },
  // ── Agent Peer & Worker Management ──
  { name: 'create_peer_agent',   sig: 'create_peer_agent({ name, personality, skills?, channels? })',desc: 'Create a peer agent instance.',                                      tags: ['orchestration'] },
  { name: 'configure_peer_agent',sig: 'configure_peer_agent({ agentId, configuration })',desc: 'Configure peer agent settings.',                                                  tags: ['orchestration'] },
  { name: 'cancel_delegated_task',sig: 'cancel_delegated_task(task_id)',              desc: 'Cancel a delegated task.',                                                           tags: ['orchestration'] },
  { name: 'browse_async',        sig: 'browse_async(url, task)',                      desc: 'Offload a browser task to the worker pool asynchronously.',                          tags: ['orchestration', 'browser'] },
  { name: 'get_worker_status',   sig: 'get_worker_status(worker_id?)',               desc: 'Get the status of worker processes.',                                                tags: ['orchestration'] },
  { name: 'get_worker_token_usage',sig: 'get_worker_token_usage(worker_id?)',        desc: 'Get token usage from worker processes.',                                              tags: ['orchestration'] },
  { name: 'start_agent',         sig: 'start_agent(agent_id)',                        desc: 'Start a peer agent.',                                                               tags: ['orchestration'] },
  { name: 'restart_agent',       sig: 'restart_agent(agent_id)',                      desc: 'Restart a peer agent.',                                                              tags: ['orchestration'] },
  // ── Agentic User (HITL) ──
  { name: 'agentic_user_status', sig: 'agentic_user_status()',                       desc: 'Get the status of the agentic user feedback system.',                                 tags: ['orchestration'] },
  { name: 'agentic_user_log',    sig: 'agentic_user_log()',                          desc: 'View the agentic user interaction log.',                                              tags: ['orchestration'] },
  { name: 'agentic_user_clear',  sig: 'agentic_user_clear()',                        desc: 'Clear agentic user data.',                                                           tags: ['orchestration'] },
  // ── Codebase Tools ──
  { name: 'read_codebase_file',  sig: 'read_codebase_file(file_path, startLine?, endLine?)',desc: 'Read a file from the agent\'s git repository.',                               tags: ['system'] },
  { name: 'search_codebase',     sig: 'search_codebase(query, includePattern?)',     desc: 'Search the codebase for patterns and symbols.',                                      tags: ['system'] },
  { name: 'locate_code_symbol',  sig: 'locate_code_symbol(symbol_name)',             desc: 'Find the definition location of a code symbol.',                                     tags: ['system'] },
  { name: 'edit_codebase_file',  sig: 'edit_codebase_file(file_path, replacements)', desc: 'Make targeted edits to codebase files.',                                             tags: ['system'] },
  // ── Bootstrap & World ──
  { name: 'update_bootstrap_file',sig: 'update_bootstrap_file(name, content, category?)',desc: 'Update a bootstrap skill specification.',                                        tags: ['system'] },
  { name: 'read_bootstrap_file', sig: 'read_bootstrap_file(name)',                   desc: 'Read a bootstrap skill specification.',                                               tags: ['system'] },
  { name: 'list_bootstrap_files',sig: 'list_bootstrap_files()',                      desc: 'List available bootstrap files.',                                                     tags: ['system'] },
  { name: 'update_world',        sig: 'update_world(section, content)',              desc: 'Update the agent world/environment structure.',                                       tags: ['system'] },
  // ── Channel & Misc ──
  { name: 'manage_channels',     sig: 'manage_channels({ action, name?, code? })',   desc: 'Manage messaging channels (list, add, remove).',                                     tags: ['system'] },
  { name: 'create_time_capsule', sig: 'create_time_capsule({ goal, duration_minutes })',desc: 'Start a high-intensity, time-bounded task with relaxed limits.',                   tags: ['system', 'ai'] },
  // ── Book Log ──
  { name: 'book_log_add',        sig: 'book_log_add(title, source, summary, tags, keyExcerpts, insights, documentId?)',desc: 'Add an abstractive summary of a resource to the Book Log.', tags: ['memory', 'rag'] },
  { name: 'book_log_search',     sig: 'book_log_search(query)',                       desc: 'Search the Book Log for summaries and insights.',                                   tags: ['memory', 'rag'] },
  { name: 'book_log_list',       sig: 'book_log_list(limit?)',                        desc: 'List recent Book Log entries.',                                                     tags: ['memory', 'rag'] },
];

const TAG_COLORS: Record<Tag, string> = {
  messaging:    '#5cffb3',
  browser:      '#5cc9ff',
  system:       '#ffb347',
  memory:       '#c77fff',
  ai:           '#ff6b9d',
  orchestration:'#4dd9ac',
  scheduling:   '#ffd166',
  rag:          '#06d6a0',
  computer:     '#ff9f1c',
  tuning:       '#e0c3fc',
  email:        '#ff7eb3',
};

// ─── Plugin steps ─────────────────────────────────────────────────────────────

const PLUGIN_STEPS = [
  {
    num: '01',
    title: 'Create the plugin file',
    desc: 'Drop a new <code>.js</code> file in <code>~/.orcbot/plugins/</code>. The directory is created automatically on first run.',
    code: `// ~/.orcbot/plugins/my_skill.js
module.exports = {
  name: 'my_skill',
  description: 'What this skill does',
  usage: 'my_skill(param1, param2)',
  handler: async (args, context) => {
    const { param1, param2 } = args;
    // context.browser — Playwright browser
    // context.config  — ConfigManager
    // context.agent   — Agent instance
    // context.logger  — Winston logger
    try {
      return { success: true, result: 'done' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
};`,
  },
  {
    num: '02',
    title: 'Hot-reload — no restart needed',
    desc: 'OrcBot watches the plugins directory. New files are loaded on the next heartbeat cycle automatically.',
    code: `# OrcBot will log:
[SkillsManager] Loaded plugin: my_skill
[SkillsManager] 31 skills registered`,
  },
  {
    num: '03',
    title: 'Install NPM dependencies',
    desc: 'If your plugin needs third-party packages, use the built-in skill or install manually.',
    code: `# Via agent — auto-installs and reloads
→ install_npm_dependency("axios")

# Or manually in the plugins dir
cd ~/.orcbot/plugins
npm install axios`,
  },
  {
    num: '04',
    title: 'Use Agent Skills spec (optional)',
    desc: 'For shareable skills, follow the <code>agentskills.io</code> spec. OrcBot can install them from a URL or GitHub.',
    code: `# skill.json (agentskills.io spec)
{
  "name": "my_skill",
  "version": "1.0.0",
  "description": "...",
  "entry": "index.js",
  "params": [
    { "name": "param1", "type": "string", "required": true }
  ]
}`,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

function Skills() {
  const [activeCategory, setActiveCategory] = useState<Tag | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return SKILLS.filter(s => {
      const catMatch = activeCategory === 'all' || s.tags.includes(activeCategory as Tag);
      const searchMatch = !q || s.name.includes(q) || s.desc.toLowerCase().includes(q) || s.sig.toLowerCase().includes(q);
      return catMatch && searchMatch;
    });
  }, [activeCategory, search]);

  return (
    <div className="app">
      <div className="bg-gradient-orbs" />
      <div className="noise-overlay" />

      <Header scrolled={true} />

      {/* ── Hero ── */}
      <div className="skills-hero">
        <div className="skills-hero-inner">
          <div className="section-label">Skills Registry</div>
          <h1 className="skills-hero-title">
            {SKILLS.length}+ built-in skills,<br />
            <span className="hero-title-em">infinitely extensible.</span>
          </h1>
          <p className="skills-hero-sub">
            Every capability OrcBot ships with — browse by category, search, and learn how to add your own.
          </p>

          <div className="skills-hero-stats">
            {CATEGORIES.filter(c => c.id !== 'all').map(cat => {
              const count = SKILLS.filter(s => s.tags.includes(cat.id as Tag)).length;
              return (
                <div key={cat.id} className="sh-stat" onClick={() => setActiveCategory(cat.id as Tag)} style={{ cursor: 'pointer' }}>
                  <span className="sh-stat-icon">{cat.icon}</span>
                  <span className="sh-stat-count">{count}</span>
                  <span className="sh-stat-label">{cat.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Browser ── */}
      <div className="skills-browser">
        {/* Sidebar */}
        <aside className="skills-sidebar">
          <div className="sb-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search skills…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="sb-search-input"
            />
            {search && (
              <button className="sb-search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>

          <nav className="sb-nav">
            {CATEGORIES.map(cat => {
              const count = cat.id === 'all'
                ? SKILLS.length
                : SKILLS.filter(s => s.tags.includes(cat.id as Tag)).length;
              return (
                <button
                  key={cat.id}
                  className={`sb-nav-item ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => { setActiveCategory(cat.id as Tag | 'all'); setSearch(''); }}
                >
                  <span className="sb-nav-icon">{cat.icon}</span>
                  <span className="sb-nav-label">{cat.label}</span>
                  <span className="sb-nav-count">{count}</span>
                </button>
              );
            })}
          </nav>

          <div className="sb-cta">
            <p>Want to add a skill?</p>
            <a href="#plugin-guide" className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '9px 16px' }}>
              Plugin Guide ↓
            </a>
          </div>
        </aside>

        {/* Grid */}
        <div className="skills-main">
          <div className="skills-main-header">
            <div>
              <span className="skills-count">{filtered.length} skill{filtered.length !== 1 ? 's' : ''}</span>
              {search && <span className="skills-search-tag"> matching "<strong>{search}</strong>"</span>}
            </div>
            {activeCategory !== 'all' && (
              <button className="skills-clear-filter" onClick={() => setActiveCategory('all')}>
                Clear filter ×
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="skills-empty">
              <span>🔍</span>
              <p>No skills match "<strong>{search}</strong>"</p>
              <button className="btn btn-outline" style={{ fontSize: '0.85rem', marginTop: '12px' }} onClick={() => { setSearch(''); setActiveCategory('all'); }}>
                Clear search
              </button>
            </div>
          ) : (
            <div className="skills-grid">
              {filtered.map(skill => (
                <div
                  key={skill.name}
                  className={`skill-card ${expanded === skill.name ? 'expanded' : ''}`}
                  onClick={() => setExpanded(expanded === skill.name ? null : skill.name)}
                >
                  <div className="skill-card-top">
                    <code className="skill-name">{skill.name}</code>
                    <div className="skill-tags">
                      {skill.tags.map(t => (
                        <span key={t} className="skill-tag" style={{ '--tag-color': TAG_COLORS[t] } as React.CSSProperties}>
                          {t}
                        </span>
                      ))}
                    </div>
                    <svg className="skill-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                  <p className="skill-desc">{skill.desc}</p>
                  {expanded === skill.name && (
                    <div className="skill-expanded">
                      <div className="skill-sig-block">
                        <span className="skill-sig-label">Signature</span>
                        <code className="skill-sig">{skill.sig}</code>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Plugin Guide ── */}
      <div id="plugin-guide" className="plugin-guide">
        <div className="plugin-guide-inner">
          <div className="section-label">Extend OrcBot</div>
          <h2 className="section-title">Add a custom skill in 4 steps.</h2>
          <p className="section-desc">
            Drop a <code style={{ color: 'var(--accent)', background: 'rgba(92,255,179,0.1)', padding: '1px 6px', borderRadius: '4px' }}>.js</code> file
            in <code style={{ color: 'var(--accent)', background: 'rgba(92,255,179,0.1)', padding: '1px 6px', borderRadius: '4px' }}>~/.orcbot/plugins/</code> and OrcBot hot-loads it on the next heartbeat. No restarts, no boilerplate config.
          </p>

          <div className="plugin-steps">
            {PLUGIN_STEPS.map((step, i) => (
              <div className="plugin-step" key={i}>
                <div className="plugin-step-head">
                  <span className="plugin-step-num">{step.num}</span>
                  <div>
                    <h3 className="plugin-step-title">{step.title}</h3>
                    <p className="plugin-step-desc" dangerouslySetInnerHTML={{ __html: step.desc }} />
                  </div>
                </div>
                <div className="plugin-code-block">
                  <div className="plugin-code-bar">
                    <span className="tdb-dot red" /><span className="tdb-dot yellow" /><span className="tdb-dot green" />
                  </div>
                  <pre className="plugin-code"><code>{step.code}</code></pre>
                </div>
              </div>
            ))}
          </div>

          <div className="plugin-cta-row">
            <div className="plugin-cta-card">
              <span className="plugin-cta-icon">📦</span>
              <h4>NPM Packages</h4>
              <p>Plugins can use any NPM package. Use <code>install_npm_dependency</code> from inside a session or <code>npm install</code> in the plugins dir.</p>
            </div>
            <div className="plugin-cta-card">
              <span className="plugin-cta-icon">🔄</span>
              <h4>Self-Repair</h4>
              <p>If a plugin throws an error repeatedly, OrcBot automatically triggers <code>self_repair_skill</code> and re-writes it.</p>
            </div>
            <div className="plugin-cta-card">
              <span className="plugin-cta-icon">🌐</span>
              <h4>agentskills.io Spec</h4>
              <p>Follow the open Agent Skills spec for shareable, portable plugins that work across any OrcBot instance.</p>
            </div>
            <div className="plugin-cta-card">
              <span className="plugin-cta-icon">🔑</span>
              <h4>Full Context Access</h4>
              <p>Handlers receive <code>browser</code>, <code>config</code>, <code>agent</code>, and <code>logger</code> — the full OrcBot runtime at your fingertips.</p>
            </div>
          </div>

          <div className="plugin-docs-link">
            <Link to="/" className="btn btn-outline btn-lg">← Back to Home</Link>
            <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
              View on GitHub
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
            </a>
          </div>
        </div>
      </div>

      <footer className="site-footer">
        <div className="footer-bottom" style={{ maxWidth: '1400px' }}>
          <p>&copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.</p>
          <div className="footer-bottom-links">
            <Link to="/">Home</Link>
            <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Skills;
