import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import '../index.css';
import './Skills.css';

// ─── Data ────────────────────────────────────────────────────────────────────

type Tag = 'messaging' | 'browser' | 'system' | 'memory' | 'ai' | 'orchestration' | 'scheduling' | 'rag' | 'computer' | 'tuning';

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

      {/* ── Nav ── */}
      <nav className="nav nav-scrolled">
        <Link to="/" className="logo">
          <svg className="logo-mark" width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="#5cffb3" fillOpacity="0.15" />
            <path d="M8 14l4 4 8-8" stroke="#5cffb3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="21" cy="7" r="2.5" fill="#5cffb3" />
          </svg>
          <span className="logo-text">OrcBot</span>
        </Link>

        <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
          <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`} />
        </button>

        <div className={`nav-center ${mobileMenuOpen ? 'open' : ''}`}>
          <Link to="/" onClick={() => setMobileMenuOpen(false)}>Home</Link>
          <Link to="/deploy" onClick={() => setMobileMenuOpen(false)}>Deploy</Link>
          <a href="#plugin-guide" onClick={() => setMobileMenuOpen(false)}>Plugin Guide</a>
        </div>

        <div className="nav-end">
          <a className="nav-btn ghost" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="nav-btn primary" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </nav>

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
