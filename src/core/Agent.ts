import { MemoryManager } from '../memory/MemoryManager';
import { MultiLLM } from './MultiLLM';
import { SkillsManager } from './SkillsManager';
import { DecisionEngine } from './DecisionEngine';
import { SimulationEngine } from './SimulationEngine';
import { ActionQueue, Action } from '../memory/ActionQueue';
import { Scheduler } from './Scheduler';
import { ConfigManager } from '../config/ConfigManager';
import { TelegramChannel } from '../channels/TelegramChannel';
import { WhatsAppChannel } from '../channels/WhatsAppChannel';
import { WebBrowser } from '../tools/WebBrowser';
import { WorkerProfileManager } from './WorkerProfile';
import { AgentOrchestrator } from './AgentOrchestrator';
import { Cron } from 'croner';
import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import { eventBus } from './EventBus';
import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import path from 'path';
import fs from 'fs';

export class Agent {
    public memory: MemoryManager;
    public llm: MultiLLM;
    public skills: SkillsManager;
    public decisionEngine: DecisionEngine;
    public simulationEngine: SimulationEngine;
    public actionQueue: ActionQueue;
    public scheduler: Scheduler;
    public config: ConfigManager;
    public telegram: TelegramChannel | undefined;
    public whatsapp: WhatsAppChannel | undefined;
    public browser: WebBrowser;
    public workerProfile: WorkerProfileManager;
    public orchestrator: AgentOrchestrator;
    private lastActionTime: number;
    private lastHeartbeatAt: number = 0;
    private consecutiveIdleHeartbeats: number = 0;
    private lastHeartbeatProductive: boolean = true;
    private agentConfigFile: string;
    private agentIdentity: string = '';
    private isBusy: boolean = false;
    private lastPluginHealthCheckAt: number = 0;
    private currentActionId: string | null = null;
    private currentActionStartAt: number | null = null;

    constructor() {
        this.config = new ConfigManager();
        this.agentConfigFile = this.config.get('agentIdentityPath');
        this.initializeStorage();

        this.memory = new MemoryManager(
            this.config.get('memoryPath'),
            this.config.get('userProfilePath')
        );
        this.llm = new MultiLLM({
            apiKey: this.config.get('openaiApiKey'),
            googleApiKey: this.config.get('googleApiKey'),
            modelName: this.config.get('modelName'),
            bedrockRegion: this.config.get('bedrockRegion'),
            bedrockAccessKeyId: this.config.get('bedrockAccessKeyId'),
            bedrockSecretAccessKey: this.config.get('bedrockSecretAccessKey'),
            bedrockSessionToken: this.config.get('bedrockSessionToken')
        });
        this.skills = new SkillsManager(
            this.config.get('skillsPath') || './SKILLS.md',
            this.config.get('pluginsPath') || './plugins',
            {
                browser: this.browser,
                config: this.config,
                agent: this,
                logger: logger
            }
        );
        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            this.config.get('journalPath'),
            this.config.get('learningPath'),
            this.config
        );
        this.simulationEngine = new SimulationEngine(this.llm);
        this.actionQueue = new ActionQueue(this.config.get('actionQueuePath') || './actions.json');
        this.scheduler = new Scheduler();
        this.browser = new WebBrowser(
            this.config.get('serperApiKey'),
            this.config.get('captchaApiKey'),
            this.config.get('braveSearchApiKey'),
            this.config.get('searxngUrl'),
            this.config.get('searchProviderOrder'),
            this.config.get('browserProfileDir'),
            this.config.get('browserProfileName')
        );
        this.workerProfile = new WorkerProfileManager();
        this.orchestrator = new AgentOrchestrator();

        this.loadLastActionTime();
        this.loadLastHeartbeatTime();

        // Ensure context is up to date (supports reconfiguration)
        this.skills.setContext({
            browser: this.browser,
            config: this.config,
            agent: this,
            logger: logger,
            workerProfile: this.workerProfile,
            orchestrator: this.orchestrator
        });

        this.loadAgentIdentity();
        this.setupEventListeners();
        this.setupChannels();
        this.registerInternalSkills();
    }

    private initializeStorage() {
        const paths = {
            userProfile: this.config.get('userProfilePath'),
            journal: this.config.get('journalPath'),
            learning: this.config.get('learningPath'),
            actionQueue: this.config.get('actionQueuePath'),
            memory: this.config.get('memoryPath'),
            skills: this.config.get('skillsPath')
        };

        for (const [key, filePath] of Object.entries(paths)) {
            if (!filePath) continue;

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info(`Created directory: ${dir}`);
            }

            // Ensure file exists with default content if missing
            if (!fs.existsSync(filePath)) {
                let defaultContent = '';
                if (key === 'agentIdentity') defaultContent = '# .AI.md\nName: OrcBot\nPersonality: proactive, concise, professional\nAutonomyLevel: high\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n';
                if (key === 'userProfile') defaultContent = '# User Profile\n\nThis file contains information about the user.\n\n## Core Identity\n- Name: Frederick\n- Preferences: None known yet\n';
                if (key === 'journal') defaultContent = '# Agent Journal\nThis file contains self-reflections and activity logs.\n';
                if (key === 'learning') defaultContent = '# Agent Learning Base\nThis file contains structured knowledge on various topics.\n';
                if (key === 'actionQueue') defaultContent = '[]';
                if (key === 'memory') defaultContent = '{"memories":[]}';
                if (key === 'skills') defaultContent = '# Global Skills\n(Skills are loaded from SKILLS.md)\n';

                try {
                    fs.writeFileSync(filePath, defaultContent);
                    logger.info(`Initialized missing data file: ${filePath}`);
                } catch (e) {
                    logger.error(`Failed to initialize ${key} at ${filePath}: ${e}`);
                }
            }
        }
    }

    public setupChannels() {
        const telegramToken = this.config.get('telegramToken');
        if (telegramToken) {
            this.telegram = new TelegramChannel(telegramToken, this);
            logger.info('Agent: Telegram channel configured');
        }

        const whatsappEnabled = this.config.get('whatsappEnabled');
        if (whatsappEnabled) {
            this.whatsapp = new WhatsAppChannel(this);
            logger.info('Agent: WhatsApp channel configured');
        }
    }

    private registerInternalSkills() {
        // Skill: Send Telegram
        this.skills.registerSkill({
            name: 'send_telegram',
            description: 'Send a message to a Telegram user',
            usage: 'send_telegram(chat_id, message)',
            handler: async (args: any) => {
                const chat_id = args.chat_id || args.chatId || args.id;
                const message = args.message || args.content || args.text;

                if (!chat_id) return 'Error: Missing chat_id. Use the numeric ID provided in context.';
                if (!message) return 'Error: Missing message content.';

                if (this.telegram) {
                    await this.telegram.sendMessage(chat_id, message);
                    return `Message sent to ${chat_id}`;
                }
                return 'Telegram channel not available';
            }
        });

        // Skill: Send WhatsApp
        this.skills.registerSkill({
            name: 'send_whatsapp',
            description: 'Send a message to a WhatsApp contact or group',
            usage: 'send_whatsapp(jid, message)',
            handler: async (args: any) => {
                const jid = args.jid || args.to || args.id;
                const message = args.message || args.content || args.text;

                if (!jid) return 'Error: Missing jid (WhatsApp ID).';
                if (!message) return 'Error: Missing message content.';

                if (this.whatsapp) {
                    await this.whatsapp.sendMessage(jid, message);
                    return `Message sent to ${jid} via WhatsApp`;
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Download File
        this.skills.registerSkill({
            name: 'download_file',
            description: 'Download a file from the web to the agent\'s local storage.',
            usage: 'download_file(url, filename?)',
            handler: async (args: any) => {
                const url = args.url;
                if (!url) return 'Error: Missing url.';

                try {
                    let filename = args.filename || path.basename(new URL(url).pathname) || `file_${Date.now()}`;
                    const downloadsDir = path.join(path.dirname(this.config.get('memoryPath')), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                    const filePath = path.join(downloadsDir, filename);
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                    const buffer = await response.arrayBuffer();
                    fs.writeFileSync(filePath, Buffer.from(buffer));

                    return `File downloaded successfully to: ${filePath}`;
                } catch (e) {
                    return `Error downloading file: ${e}`;
                }
            }
        });

        // Skill: Send File
        this.skills.registerSkill({
            name: 'send_file',
            description: 'Send a file (image, document, audio) to a Telegram or WhatsApp contact.',
            usage: 'send_file(jid, path, caption?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const filePath = args.path || args.file_path;
                const caption = args.caption || '';

                if (!jid) return 'Error: Missing jid.';
                if (!filePath) return 'Error: Missing file path.';

                try {
                    const isWhatsApp = jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via WhatsApp to ${jid}`;
                    } else if (this.telegram && !isWhatsApp) {
                        await this.telegram.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Telegram to ${jid}`;
                    }
                    return 'Appropriate channel not available or JID type not recognized.';
                } catch (e) {
                    return `Error sending file: ${e}`;
                }
            }
        });

        // Skill: Analyze Media
        this.skills.registerSkill({
            name: 'analyze_media',
            description: 'Use AI to analyze an image, audio, or document file. Provide the path and what you want to know.',
            usage: 'analyze_media(path, prompt?)',
            handler: async (args: any) => {
                const filePath = args.path || args.file_path;
                const prompt = args.prompt || 'Describe the content of this file.';

                if (!filePath) return 'Error: Missing path.';
                if (!fs.existsSync(filePath)) return `Error: File not found at ${filePath}`;

                try {
                    return await this.llm.analyzeMedia(filePath, prompt);
                } catch (e) {
                    return `Error analyzing media: ${e}`;
                }
            }
        });

        // Skill: Post WhatsApp Status
        this.skills.registerSkill({
            name: 'post_whatsapp_status',
            description: 'Post a text update to your WhatsApp status (Stories)',
            usage: 'post_whatsapp_status(text)',
            handler: async (args: any) => {
                const text = args.text || args.message || args.content;
                if (!text) return 'Error: Missing text content.';

                if (this.whatsapp) {
                    try {
                        await this.whatsapp.postStatus(text);
                        return 'WhatsApp status update posted successfully';
                    } catch (e) {
                        return `Error posting WhatsApp status: ${e}`;
                    }
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: React to WhatsApp Message
        this.skills.registerSkill({
            name: 'react_whatsapp',
            description: 'React to a specific WhatsApp message with an emoji',
            usage: 'react_whatsapp(jid, message_id, emoji)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const messageId = args.message_id || args.messageId || args.id;
                const emoji = args.emoji || args.reaction || '✅';

                if (!jid) return 'Error: Missing jid.';
                if (!messageId) return 'Error: Missing message_id. You must get this from the message context.';

                if (this.whatsapp) {
                    await this.whatsapp.react(jid, messageId, emoji);
                    return `Reacted with ${emoji} to message ${messageId}`;
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Reply to WhatsApp Status
        this.skills.registerSkill({
            name: 'reply_whatsapp_status',
            description: 'Reply to a contact\'s WhatsApp status update',
            usage: 'reply_whatsapp_status(jid, message)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const message = args.message || args.content || args.text;

                if (!jid) return 'Error: Missing jid.';
                if (!message) return 'Error: Missing message content.';

                if (this.whatsapp) {
                    // For status reply, the JID is the person who posted the status
                    await this.whatsapp.sendMessage(jid, message);
                    return `Replied to status of ${jid}`;
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Update Contact Profile
        this.skills.registerSkill({
            name: 'update_contact_profile',
            description: 'Update the autonomous profile/memory of a specific WhatsApp contact. Use this to store traits, facts, and relationship context.',
            usage: 'update_contact_profile(jid, profile_json)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const profileJson = args.profile_json || args.profile || args.content;

                if (!jid) return 'Error: Missing jid.';
                if (!profileJson) return 'Error: Missing profile_json.';

                try {
                    // Validate JSON if it's a string, or just save it
                    const data = typeof profileJson === 'string' ? profileJson : JSON.stringify(profileJson, null, 2);
                    this.memory.saveContactProfile(jid, data);
                    return `Profile for ${jid} updated successfully.`;
                } catch (e) {
                    return `Error updating profile: ${e}`;
                }
            }
        });

        // Skill: Run Shell Command
        this.skills.registerSkill({
            name: 'run_command',
            description: 'Execute a shell command on the server',
            usage: 'run_command(command)',
            handler: async (args: any) => {
                const command = args.command || args.cmd || args.text;
                if (!command) return 'Error: Missing command string.';

                const trimmed = String(command).trim();
                const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() || '';
                const allowList = (this.config.get('commandAllowList') || []) as string[];
                const denyList = (this.config.get('commandDenyList') || []) as string[];
                const safeMode = this.config.get('safeMode');

                if (safeMode) {
                    return 'Error: Safe mode is enabled. run_command is disabled.';
                }

                if (denyList.map(s => s.toLowerCase()).includes(firstToken)) {
                    return `Error: Command '${firstToken}' is blocked by commandDenyList.`;
                }

                if (allowList.length > 0 && !allowList.map(s => s.toLowerCase()).includes(firstToken)) {
                    return `Error: Command '${firstToken}' is not in commandAllowList.`;
                }

                const timeoutMs = parseInt(args.timeoutMs || args.timeout || this.config.get('commandTimeoutMs') || 120000, 10);
                const retries = parseInt(args.retries || this.config.get('commandRetries') || 1, 10);
                const cwd = args.cwd || this.config.get('commandWorkingDir') || process.cwd();

                const { exec } = require('child_process');

                const runOnce = () => new Promise<string>((resolve) => {
                    const child = exec(command, { timeout: timeoutMs, cwd }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            if (error.killed) {
                                resolve(`Error: Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
                                return;
                            }
                            resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                            return;
                        }
                        resolve(stdout || stderr || "Command executed successfully (no output)");
                    });

                    child.on('error', (err: any) => {
                        resolve(`Error: Failed to start command: ${err?.message || err}`);
                    });
                });

                let attempt = 0;
                let lastResult = '';
                while (attempt <= retries) {
                    lastResult = await runOnce();
                    if (!lastResult.startsWith('Error:')) return lastResult;
                    attempt++;
                    if (attempt <= retries) {
                        logger.warn(`run_command retry ${attempt}/${retries} after error: ${lastResult}`);
                    }
                }

                return lastResult;
            }
        });

        // Skill: Get System Info
        this.skills.registerSkill({
            name: 'get_system_info',
            description: 'Get current server time, date, and OS information',
            usage: 'get_system_info()',
            handler: async () => {
                const os = require('os');
                return `Server Time: ${new Date().toLocaleString()}\nOS: ${os.platform()} ${os.release()}`;
            }
        });

        // Skill: Self Repair
        this.skills.registerSkill({
            name: 'self_repair_skill',
            description: 'Autonomously diagnose and fix a failing plugin skill. Use this when a tool returns an error or fails to execute correctly.',
            usage: 'self_repair_skill(skillName, errorMessage)',
            handler: async (args: any) => {
                const { skillName, errorMessage } = args;
                if (!skillName || !errorMessage) return 'Error: skillName and errorMessage are required.';

                const skillsList = this.skills.getAllSkills();
                const targetSkill = skillsList.find(s => s.name === skillName);

                if (!targetSkill || !targetSkill.pluginPath) {
                    return `Error: Skill "${skillName}" not found or is a core skill that cannot be modified.`;
                }

                try {
                    const pluginContent = fs.readFileSync(targetSkill.pluginPath, 'utf8');
                    let specContent = '';

                    if (targetSkill.sourceUrl) {
                        try {
                            const res = await fetch(targetSkill.sourceUrl);
                            if (res.ok) specContent = await res.text();
                        } catch (e) {
                            logger.warn(`SelfRepair: Failed to fetch spec from ${targetSkill.sourceUrl}: ${e}`);
                        }
                    }

                    const repairPrompt = `
I am attempting to fix a bug in the OrcBot plugin "${skillName}".
THE ERROR:
"""
${errorMessage}
"""

THE CURRENT CODE:
\`\`\`typescript
${pluginContent}
\`\`\`

${specContent ? `THE ORIGINAL SPECIFICATION:\n\"\"\"\n${specContent}\n\"\"\"\n` : ''}

RULES:
1. Identify the cause of the error (e.g., wrong API endpoint, missing headers, logic bug).
2. Generate the CORRECTED TypeScript code. 
3. Maintain the same "Skill" interface and export structure.
4. Keep the "@source" tag in the header if it exists.
5. Output ONLY the raw TypeScript code, no markdown blocks.

Output the fixed code:
`;

                    logger.info(`SelfRepair: Consulting LLM to fix "${skillName}"...`);
                    const fixedCode = await this.llm.call(repairPrompt, "You are a master at debugging and fixing AI agent plugins.");
                    const cleanCode = fixedCode.replace(/```typescript/g, '').replace(/```/g, '').trim();

                    fs.writeFileSync(targetSkill.pluginPath, cleanCode);
                    this.skills.loadPlugins(); // Reload registry

                    return `Successfully repaired and reloaded skill "${skillName}". You can now try to use it again.`;

                } catch (error: any) {
                    return `Self-repair failed for ${skillName}: ${error.message}`;
                }
            }
        });

        // Skill: Set Config
        this.skills.registerSkill({
            name: 'set_config',
            description: 'Persistently save a configuration key-value pair. Use this to store API keys or settings (e.g., MOLTBOOK_API_KEY).',
            usage: 'set_config(key, value)',
            handler: async (args: any) => {
                const key = args.key;
                const value = args.value;
                if (!key || value === undefined) return 'Error: Key and value are required.';
                this.config.set(key, value);
                return `Successfully saved ${key} to configuration.`;
            }
        });

        // Skill: Manage Skills
        this.skills.registerSkill({
            name: 'manage_skills',
            description: 'Install or update a skill in SKILLS.md. Use this to describe new tools the agent should have access to.',
            usage: 'manage_skills(skill_definition)',
            handler: async (args: any) => {
                const skill_definition = args.skill_definition || args.definition || args.skill || args.text;
                if (!skill_definition) return 'Error: Missing skill_definition.';

                const skillsPath = this.config.get('skillsPath');
                try {
                    fs.appendFileSync(skillsPath, `\n\n${skill_definition}`);
                    // Instead of re-instantiating, we just log. 
                    // Manual skills are already registered. Plugins can be reloaded.
                    this.skills.loadPlugins();
                    return `Successfully added skill to ${skillsPath}. The new definition is now active in your context.`;
                } catch (e) {
                    return `Failed to update skills: ${e}`;
                }
            }
        });

        // Skill: Browser Navigate
        this.skills.registerSkill({
            name: 'browser_navigate',
            description: 'Navigate to a URL and return a semantic snapshot of interactive elements.',
            usage: 'browser_navigate(url)',
            handler: async (args: any) => {
                const url = args.url || args.link || args.site;
                if (!url) return 'Error: Missing url.';
                const res = await this.browser.navigate(url);
                if (res.startsWith('Error')) return res;
                return await this.browser.getSemanticSnapshot();
            }
        });

        // Skill: Browser Examine Page
        this.skills.registerSkill({
            name: 'browser_examine_page',
            description: 'Get a text-based semantic snapshot of the current page including all interactive elements with reference IDs.',
            usage: 'browser_examine_page()',
            handler: async () => {
                return await this.browser.getSemanticSnapshot();
            }
        });

        // Skill: Browser Wait
        this.skills.registerSkill({
            name: 'browser_wait',
            description: 'Wait for a specified number of milliseconds',
            usage: 'browser_wait(ms)',
            handler: async (args: any) => {
                const ms = parseInt(args.ms || args.time || '1000');
                return this.browser.wait(ms);
            }
        });

        // Skill: Browser Wait For Selector
        this.skills.registerSkill({
            name: 'browser_wait_for',
            description: 'Wait for a CSS selector to appear on the page',
            usage: 'browser_wait_for(selector, timeout?)',
            handler: async (args: any) => {
                const selector = args.selector || args.css;
                const timeout = args.timeout ? parseInt(args.timeout) : 15000;
                if (!selector) return 'Error: Missing selector.';
                return this.browser.waitForSelector(selector, timeout);
            }
        });

        // Skill: Browser Click
        this.skills.registerSkill({
            name: 'browser_click',
            description: 'Click an element using a CSS selector or a numeric reference ID [ref=N] from the semantic snapshot.',
            usage: 'browser_click(selector_or_ref)',
            handler: async (args: any) => {
                const selector = args.selector_or_ref || args.selector || args.css || args.ref;
                if (!selector) return 'Error: Missing selector or ref.';
                return this.browser.click(String(selector));
            }
        });

        // Skill: Browser Type
        this.skills.registerSkill({
            name: 'browser_type',
            description: 'Type text into an input field using a CSS selector or a numeric reference ID [ref=N].',
            usage: 'browser_type(selector_or_ref, text)',
            handler: async (args: any) => {
                const selector = args.selector_or_ref || args.selector || args.css || args.ref;
                const text = args.text || args.value;
                if (!selector || !text) return 'Error: Missing selector/ref or text.';
                return this.browser.type(String(selector), text);
            }
        });

        // Skill: Browser Press Key
        this.skills.registerSkill({
            name: 'browser_press',
            description: 'Press a keyboard key (e.g. "Enter", "Tab")',
            usage: 'browser_press(key)',
            handler: async (args: any) => {
                const key = args.key || args.name;
                if (!key) return 'Error: Missing key.';
                return this.browser.press(key);
            }
        });

        // Skill: Browser Screenshot
        this.skills.registerSkill({
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current browser state',
            usage: 'browser_screenshot()',
            handler: async () => {
                const captcha = await this.browser.detectCaptcha();
                const result = await this.browser.screenshot();
                return captcha ? `${result}\n[SYSTEM ALERT: ${captcha}. You should use browser_solve_captcha() now.]` : result;
            }
        });

        // Skill: Browser Solve CAPTCHA
        this.skills.registerSkill({
            name: 'browser_solve_captcha',
            description: 'Attempt to solve a detected CAPTCHA (reCAPTCHA, hCaptcha, etc.)',
            usage: 'browser_solve_captcha()',
            handler: async () => {
                return this.browser.solveCaptcha();
            }
        });

        // Skill: Browser Run JS
        this.skills.registerSkill({
            name: 'browser_run_js',
            description: 'Run custom JavaScript on the current page.',
            usage: 'browser_run_js(script)',
            handler: async (args: any) => {
                const script = args.script || args.code || args.js;
                if (!script) return 'Error: Missing script.';
                return this.browser.evaluate(script);
            }
        });

        // Skill: Switch Browser Profile
        this.skills.registerSkill({
            name: 'switch_browser_profile',
            description: 'Switch to a persistent browser profile by name (and optional directory).',
            usage: 'switch_browser_profile(profileName, profileDir?)',
            handler: async (args: any) => {
                const profileName = args.profileName || args.name || args.profile;
                const profileDir = args.profileDir || args.dir;
                if (!profileName) return 'Error: Missing profileName.';
                return this.browser.switchProfile(profileName, profileDir);
            }
        });

        // Skill: Create Custom Skill
        this.skills.registerSkill({
            name: 'create_custom_skill',
            description: 'Autonomously create a new skill. The "code" argument must be the **BODY** of a Node.js async function. \n\nIMPORTANT RULES:\n1. Do NOT wrap the code in `async function() { ... }` or `() => { ... }`. Provide ONLY the inner logic.\n2. To access the browser, use `await context.browser.evaluate(() => { ... })`.\n3. Do NOT try to call other skills as functions (e.g. `send_file(...)` is NOT available directly). You must use `context.agent.skills.execute("skill_name", { args })` if you strictly need to call another skill, or better yet, implement the logic natively using `fs`, `fetch`, etc.\n4. Ensure you `return` a string at the end of the operation.',
            usage: 'create_custom_skill({ name, description, usage, code })',
            handler: async (args: any) => {
                if (this.config.get('safeMode')) {
                    return 'Error: Safe mode is enabled. Skill creation is disabled.';
                }
                const { name, description, usage, code } = args;
                if (!name || !code) return 'Error: Name and code are required.';

                const pluginsDir = this.config.get('pluginsPath') || './plugins';
                if (!fs.existsSync(pluginsDir)) {
                    fs.mkdirSync(path.resolve(pluginsDir), { recursive: true });
                }

                const fileName = `${name}.ts`;
                const filePath = path.resolve(pluginsDir, fileName);

                // Basic Sanitization: Remove outer function wrappers if the AI messed up
                let sanitizedCode = code.trim();
                // Remove "async function(url, context) {" or similar prefixes
                sanitizedCode = sanitizedCode.replace(/^(async\s+)?function\s*\([^)]*\)\s*\{/, '');
                // Remove trailing "}"
                if (code.includes('function') && sanitizedCode.endsWith('}')) {
                    sanitizedCode = sanitizedCode.substring(0, sanitizedCode.lastIndexOf('}'));
                }

                // Ensure correct formatting for a plugin
                const finalCode = code.includes('export') ? code : `
import { AgentContext } from '../src/core/SkillsManager';
import fs from 'fs';
import path from 'path';

export const ${name} = {
    name: "${name}",
    description: "${description || ''}",
    usage: "${usage || ''}",
    handler: async (args: any, context: AgentContext) => {
        // INSTRUCTIONS FOR AI: 
        // 1. Use 'context.browser' to access the browser (e.g. context.browser.evaluate(...))
        // 2. Use 'context.config' to access settings.
        // 3. Use standard 'fetch' for external APIs.
        
        ${sanitizedCode}
    }
};
`;

                fs.writeFileSync(filePath, finalCode);

                // FORCE RELOAD: Update the registry immediately
                this.skills.loadPlugins();

                return `Skill '${name}' created at ${filePath} and registered. You can use it immediately.`;
            }
        });

        // Skill: Install NPM Dependency
        this.skills.registerSkill({
            name: 'install_npm_dependency',
            description: 'Install an NPM package for use in custom skills.',
            usage: 'install_npm_dependency(packageName)',
            handler: async (args: any) => {
                const pkg = args.packageName || args.package;
                if (!pkg) return 'Error: Missing package name.';

                return new Promise((resolve) => {
                    const { exec } = require('child_process');
                    logger.info(`Agent: Installing NPM package '${pkg}'...`);
                    const child = exec(`npm install ${pkg}`, { timeout: 120000 }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            if (error.killed) {
                                resolve(`Error: Installation of '${pkg}' timed out after 120 seconds. It might still be running in the background, but I am moving on.`);
                            } else {
                                resolve(`Error installing '${pkg}': ${error.message}\n${stderr}`);
                            }
                        } else {
                            resolve(`Package '${pkg}' installed successfully.\n${stdout}`);
                        }
                    });
                });
            }
        });

        // Skill: Web Search
        this.skills.registerSkill({
            name: 'web_search',
            description: 'Search the web for information using multiple engines (APIs + browser fallback)',
            usage: 'web_search(query)',
            handler: async (args: any) => {
                const query = args.query || args.text || args.search || args.q;
                if (!query) return 'Error: Missing search query.';
                
                logger.info(`Searching: "${query}"`);
                
                // First attempt with standard search (includes API + browser fallbacks)
                let result = await this.browser.search(query);
                
                // If all providers failed, try a direct deep browser search
                if (result.includes('Error: All search providers failed')) {
                    logger.warn('All standard search providers failed. Attempting deep browser search...');
                    
                    // Try navigating directly and extracting any useful content
                    try {
                        // Try DuckDuckGo's no-JS version as final fallback
                        const deepResult = await this.browser.navigate(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
                        
                        if (deepResult && !deepResult.includes('Error')) {
                            // Extract links from the page content
                            const links = await this.browser.page?.evaluate(() => {
                                const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
                                return anchors
                                    .filter(a => {
                                        const href = (a as HTMLAnchorElement).href;
                                        return !href.includes('duckduckgo') && 
                                               !href.includes('duck.co') &&
                                               a.textContent && a.textContent.trim().length > 5;
                                    })
                                    .slice(0, 5)
                                    .map(a => ({
                                        title: a.textContent?.trim() || '',
                                        url: (a as HTMLAnchorElement).href
                                    }));
                            });
                            
                            if (links && links.length > 0) {
                                const formatted = links.map((l: any) => `• [${l.title}](${l.url})`).join('\n');
                                return `Search Results (via lite browser):\n\n${formatted}\n\n[Note: Limited results due to search API unavailability. Consider configuring Serper API for better results.]`;
                            }
                        }
                    } catch (e) {
                        logger.debug(`Deep browser search failed: ${e}`);
                    }
                    
                    // Final fallback: Provide guidance
                    return `Unable to search at this time. Search services are unavailable.\n\nSuggestions:\n• Try again in a few minutes\n• Use browse_website to visit a specific URL directly\n• Configure a search API (Serper, Brave) for reliable results\n\nQuery attempted: "${query}"`;
                }
                
                return result;
            }
        });

        // Skill: Extract Article
        this.skills.registerSkill({
            name: 'extract_article',
            description: 'Extract clean text content from a news or article link. Optional: if "url" is omitted, extracts from the current active browser page.',
            usage: 'extract_article(url?)',
            handler: async (args: any) => {
                const url = args.url || args.link;
                try {
                    let html = '';
                    if (url) {
                        const { chromium } = require('playwright');
                        const browser = await chromium.launch({ headless: true });
                        const page = await browser.newPage();
                        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
                        html = await page.content();
                        await browser.close();
                    } else {
                        // Extract from current active session
                        if (!this.browser.page) return "Error: No active browser page to extract from. Provide a URL.";
                        html = await this.browser.page.content();
                    }

                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const reader = new Readability(doc as any);
                    const article = reader.parse();

                    if (!article) return "Failed to extract article content.";
                    return `Title: ${article.title}\n\nContent:\n${article.textContent.substring(0, 5000)}`;
                } catch (e) {
                    return `Error extracting article: ${e}`;
                }
            }
        });

        // Skill: Schedule Task
        this.skills.registerSkill({
            name: 'schedule_task',
            description: 'Schedule a task to run later using cron syntax or relative time (e.g. "in 5 minutes")',
            usage: 'schedule_task(time_or_cron, task_description)',
            handler: async (args: any) => {
                const time_or_cron = args.time_or_cron || args.time || args.schedule;
                const task_description = args.task_description || args.task || args.description;

                if (!time_or_cron || !task_description) return 'Error: Missing time_or_cron or task_description.';

                try {
                    let schedule: string | Date = time_or_cron;
                    const relativeMatch = time_or_cron.match(/in (\d+) (second|minute|hour|day)s?/i);
                    if (relativeMatch) {
                        const amount = parseInt(relativeMatch[1]);
                        const unit = relativeMatch[2].toLowerCase();
                        const date = new Date();
                        if (unit.startsWith('second')) date.setSeconds(date.getSeconds() + amount);
                        if (unit.startsWith('minute')) date.setMinutes(date.getMinutes() + amount);
                        if (unit.startsWith('hour')) date.setHours(date.getHours() + amount);
                        if (unit.startsWith('day')) date.setDate(date.getDate() + amount);
                        schedule = date;
                    }

                    new Cron(schedule, () => {
                        logger.info(`Scheduled Task Triggered: ${task_description}`);
                        this.pushTask(`Scheduled Task: ${task_description}`, 8);
                    });

                    return `Task scheduled successfully for: ${schedule}`;
                } catch (e) {
                    return `Failed to schedule task: ${e}`;
                }
            }
        });

        // Skill: Deep Reasoning
        this.skills.registerSkill({
            name: 'deep_reason',
            description: 'Perform an intensive analysis of a topic with multiple steps',
            usage: 'deep_reason(topic)',
            handler: async (args: any) => {
                const topic = args.topic || args.subject || args.query || args.text;
                if (!topic) return 'Error: Missing topic.';

                const system = `You are an elite reasoning engine. Use a meticulous chain-of-thought to analyze the topic.
Break it into components, evaluate pros/cons, and synthesize a deep conclusion.
Be thorough and academic.`;
                return this.llm.call(topic, system);
            }
        });

        // Skill: Learn User Info
        this.skills.registerSkill({
            name: 'update_user_profile',
            description: 'Save permanent information learned about the user (name, preferences, habits, goals). Use this PROACTIVELY whenever you learn something new about Frederick.',
            usage: 'update_user_profile(info_text)',
            handler: async (args: any) => {
                const info_text = args.info_text || args.info || args.text || args.data;
                if (!info_text) return 'Error: Missing info_text.';

                const userPath = this.config.get('userProfilePath');
                try {
                    // Prepend date for chronological history
                    const entry = `\n- [${new Date().toLocaleDateString()}] ${info_text}`;
                    fs.appendFileSync(userPath, entry);
                    this.memory.refreshUserContext(userPath);
                    logger.info(`User Profile Updated: ${info_text}`);
                    return `Successfully updated user profile with: "${info_text}"`;
                } catch (e) {
                    return `Failed to update profile at ${userPath}: ${e}`;
                }
            }
        });

        // Skill: Evolve Identity
        this.skills.registerSkill({
            name: 'update_agent_identity',
            description: 'Update your own identity, personality, or name. Provide a snippet or a full block.',
            usage: 'update_agent_identity(trait)',
            handler: async (args: any) => {
                const trait = args.trait || args.info || args.text;
                if (!trait) return 'Error: Missing trait information.';

                const identityPath = this.config.get('agentIdentityPath');
                try {
                    // If the trait looks like a full block or a specific name update, we overwrite/restructure.
                    if (trait.startsWith('#') || trait.includes('Name:')) {
                        fs.writeFileSync(identityPath, trait.trim());
                        this.loadAgentIdentity();
                        return `Identity completely redefined at ${identityPath}.`;
                    } else {
                        fs.appendFileSync(identityPath, `\n- Learned Trait: ${trait}`);
                        this.loadAgentIdentity();
                        return `Successfully added trait to agent identity at ${identityPath}: "${trait}"`;
                    }
                } catch (e) {
                    return `Failed to update identity at ${identityPath}: ${e}`;
                }
            }
        });

        // Skill: Update Journal
        this.skills.registerSkill({
            name: 'update_journal',
            description: 'Record a self-reflection entry or activity log in JOURNAL.md',
            usage: 'update_journal(entry_text)',
            handler: async (args: any) => {
                const entry_text = args.entry_text || args.entry || args.text;
                if (!entry_text) return 'Error: Missing entry_text.';

                const journalPath = this.config.get('journalPath');
                try {
                    fs.appendFileSync(journalPath, `\n\n## [${new Date().toISOString()}] Reflection\n${entry_text}`);
                    return `Journal entry saved to ${journalPath}`;
                } catch (e) {
                    return `Failed to update journal at ${journalPath}: ${e}`;
                }
            }
        });

        // Skill: Update Learning - with actual research capability
        this.skills.registerSkill({
            name: 'update_learning',
            description: 'Research a topic using web search and save structured findings to LEARNING.md. If knowledge_content is empty, will auto-research the topic.',
            usage: 'update_learning(topic, knowledge_content?)',
            handler: async (args: any) => {
                const topic = args.topic || args.subject || args.title;
                let knowledge_content = args.knowledge_content || args.content || args.text || args.data;

                if (!topic) return 'Error: Missing topic.';

                // If no content provided, auto-research the topic
                if (!knowledge_content || knowledge_content.trim().length < 50) {
                    try {
                        logger.info(`Learning: Auto-researching topic "${topic}"...`);
                        const searchResult = await this.browser.search(`${topic} latest developments 2024 2025`);
                        
                        if (searchResult && searchResult.length > 100) {
                            // Extract key facts using LLM
                            const extractPrompt = `Extract 5-10 key facts/insights from this search result about "${topic}". Format as bullet points with clear, factual statements:\n\n${searchResult.slice(0, 4000)}`;
                            const extracted = await this.llm.call(extractPrompt, 'Extract key learnings');
                            knowledge_content = extracted || searchResult.slice(0, 2000);
                        } else {
                            return `Could not find sufficient information about "${topic}" to learn from.`;
                        }
                    } catch (e) {
                        return `Failed to research topic "${topic}": ${e}`;
                    }
                }

                const learningPath = this.config.get('learningPath');
                try {
                    const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${knowledge_content}\n\n---`;
                    fs.appendFileSync(learningPath, entry);
                    this.lastHeartbeatProductive = true; // Mark as productive
                    logger.info(`Learning: Saved knowledge about "${topic}" to ${learningPath}`);
                    return `Successfully researched and saved knowledge about "${topic}" to LEARNING.md`;
                } catch (e) {
                    return `Failed to update learning base at ${learningPath}: ${e}`;
                }
            }
        });

        // Skill: Request Supporting Data
        this.skills.registerSkill({
            name: 'request_supporting_data',
            description: 'Pause execution and ask the user for missing information, credentials, or clarification.',
            usage: 'request_supporting_data(question)',
            handler: async (args: any) => {
                const question = args.question || args.text || args.info;
                if (!question) return 'Error: Missing question.';

                // We'll rely on the Agent loop to handle the "pause" by detecting this tool call.
                // But we should actually send the message here if we can.
                return `CLARIFICATION_REQUESTED: ${question}`;
            }
        });

        // ==================== MULTI-AGENT ORCHESTRATION SKILLS ====================

        // Skill: Spawn Agent (Self-Duplication)
        this.skills.registerSkill({
            name: 'spawn_agent',
            description: 'Create a new sub-agent instance for parallel task execution. The spawned agent inherits capabilities and can work independently.',
            usage: 'spawn_agent(name, role, capabilities?)',
            handler: async (args: any) => {
                const name = args.name || args.agent_name;
                const role = args.role || 'worker';
                const capabilities = args.capabilities || ['execute'];

                if (!name) return 'Error: Missing agent name.';

                try {
                    const agent = this.orchestrator.spawnAgent({
                        name,
                        role,
                        capabilities: Array.isArray(capabilities) ? capabilities : [capabilities]
                    });
                    return `Successfully spawned agent "${agent.name}" (ID: ${agent.id}) with role "${agent.role}" and capabilities: ${agent.capabilities.join(', ')}`;
                } catch (e) {
                    return `Error spawning agent: ${e}`;
                }
            }
        });

        // Skill: List Agents
        this.skills.registerSkill({
            name: 'list_agents',
            description: 'List all agent instances in the orchestration layer with their status and current tasks.',
            usage: 'list_agents()',
            handler: async () => {
                const agents = this.orchestrator.getAgents();
                if (agents.length === 0) return 'No agents registered.';

                return agents.map(a => {
                    const taskInfo = a.currentTask ? ` [Task: ${a.currentTask}]` : '';
                    return `- ${a.name} (${a.id}): ${a.status}${taskInfo} | Role: ${a.role} | Capabilities: ${a.capabilities.join(', ')}`;
                }).join('\n');
            }
        });

        // Skill: Terminate Agent
        this.skills.registerSkill({
            name: 'terminate_agent',
            description: 'Terminate a spawned agent instance. Cannot terminate the primary agent.',
            usage: 'terminate_agent(agent_id)',
            handler: async (args: any) => {
                const agentId = args.agent_id || args.id;
                if (!agentId) return 'Error: Missing agent_id.';

                const success = this.orchestrator.terminateAgent(agentId);
                return success
                    ? `Agent ${agentId} terminated successfully.`
                    : `Failed to terminate agent ${agentId}. It may not exist or is the primary agent.`;
            }
        });

        // Skill: Delegate Task
        this.skills.registerSkill({
            name: 'delegate_task',
            description: 'Create a task and optionally assign it to a specific agent or let the orchestrator auto-assign.',
            usage: 'delegate_task(description, priority?, agent_id?)',
            handler: async (args: any) => {
                const description = args.description || args.task || args.text;
                const priority = parseInt(args.priority || '5');
                const agentId = args.agent_id || args.id;

                if (!description) return 'Error: Missing task description.';

                const task = this.orchestrator.createTask(description, priority);

                if (agentId) {
                    const assigned = this.orchestrator.assignTask(task.id, agentId);
                    if (assigned) {
                        return `Task "${task.id}" created and assigned to agent ${agentId}.`;
                    } else {
                        return `Task "${task.id}" created but could not be assigned to ${agentId} (agent busy or not found). Task is pending.`;
                    }
                }

                return `Task "${task.id}" created with priority ${priority}. Use distribute_tasks() to auto-assign or assign manually.`;
            }
        });

        // Skill: Distribute Tasks
        this.skills.registerSkill({
            name: 'distribute_tasks',
            description: 'Auto-assign all pending tasks to available agents based on priority and capability.',
            usage: 'distribute_tasks()',
            handler: async () => {
                const assigned = this.orchestrator.distributeTasks();
                return assigned > 0
                    ? `Distributed ${assigned} task(s) to available agents.`
                    : 'No tasks were distributed. Either no pending tasks or no available agents.';
            }
        });

        // Skill: Get Orchestrator Status
        this.skills.registerSkill({
            name: 'orchestrator_status',
            description: 'Get a summary of the multi-agent orchestration layer including agent and task counts.',
            usage: 'orchestrator_status()',
            handler: async () => {
                return this.orchestrator.getSummary();
            }
        });

        // Skill: Complete Delegated Task
        this.skills.registerSkill({
            name: 'complete_delegated_task',
            description: 'Mark a delegated task as completed with an optional result.',
            usage: 'complete_delegated_task(task_id, result?)',
            handler: async (args: any) => {
                const taskId = args.task_id || args.id;
                const result = args.result || args.output;

                if (!taskId) return 'Error: Missing task_id.';

                const success = this.orchestrator.completeTask(taskId, result);
                return success
                    ? `Task ${taskId} marked as completed.`
                    : `Failed to complete task ${taskId}. Task may not exist.`;
            }
        });

        // Skill: Fail Delegated Task
        this.skills.registerSkill({
            name: 'fail_delegated_task',
            description: 'Mark a delegated task as failed with an error message.',
            usage: 'fail_delegated_task(task_id, error)',
            handler: async (args: any) => {
                const taskId = args.task_id || args.id;
                const error = args.error || args.reason || 'Unknown error';

                if (!taskId) return 'Error: Missing task_id.';

                const success = this.orchestrator.failTask(taskId, error);
                return success
                    ? `Task ${taskId} marked as failed.`
                    : `Failed to update task ${taskId}. Task may not exist.`;
            }
        });

        // Skill: Send Agent Message
        this.skills.registerSkill({
            name: 'send_agent_message',
            description: 'Send a message from one agent to another for inter-agent communication.',
            usage: 'send_agent_message(to_agent_id, message, type?)',
            handler: async (args: any) => {
                const to = args.to_agent_id || args.to;
                const message = args.message || args.content || args.text;
                const type = args.type || 'command';

                if (!to || !message) return 'Error: Missing to_agent_id or message.';

                const msg = this.orchestrator.sendMessage('primary', to, type as any, { message });
                return `Message sent to ${to}: ${msg.id}`;
            }
        });

        // Skill: Broadcast to Agents
        this.skills.registerSkill({
            name: 'broadcast_to_agents',
            description: 'Broadcast a message to all active agents.',
            usage: 'broadcast_to_agents(message)',
            handler: async (args: any) => {
                const message = args.message || args.content || args.text;
                if (!message) return 'Error: Missing message.';

                this.orchestrator.broadcast('primary', { message });
                const agents = this.orchestrator.getAgents().filter(a => a.status !== 'terminated' && a.id !== 'primary');
                return `Broadcast sent to ${agents.length} agent(s).`;
            }
        });

        // Skill: Get Agent Messages
        this.skills.registerSkill({
            name: 'get_agent_messages',
            description: 'Retrieve messages sent to a specific agent.',
            usage: 'get_agent_messages(agent_id?, limit?)',
            handler: async (args: any) => {
                const agentId = args.agent_id || args.id || 'primary';
                const limit = parseInt(args.limit || '20');

                const messages = this.orchestrator.getMessagesFor(agentId, limit);
                if (messages.length === 0) return `No messages for agent ${agentId}.`;

                return messages.map(m =>
                    `[${m.timestamp}] From: ${m.from} | Type: ${m.type}\n  ${JSON.stringify(m.payload)}`
                ).join('\n\n');
            }
        });

        // Skill: Clone Self
        this.skills.registerSkill({
            name: 'clone_self',
            description: 'Create a clone of the primary agent with inherited capabilities for parallel processing.',
            usage: 'clone_self(clone_name, specialized_role?)',
            handler: async (args: any) => {
                const cloneName = args.clone_name || args.name || `Clone-${Date.now()}`;
                const role = args.specialized_role || args.role || 'clone';

                const clone = this.orchestrator.spawnAgent({
                    name: cloneName,
                    role,
                    capabilities: ['execute', 'browse', 'search', 'analyze']
                });

                return `Created clone "${clone.name}" (${clone.id}) with full capabilities. Use delegate_task() to assign work to this clone.`;
            }
        });
    }

    private loadAgentIdentity() {
        if (fs.existsSync(this.agentConfigFile)) {
            this.agentIdentity = fs.readFileSync(this.agentConfigFile, 'utf-8');
            logger.info(`Agent identity loaded from ${this.agentConfigFile}`);
        } else {
            this.agentIdentity = "You are a professional autonomous agent.";
            logger.warn(`${this.agentConfigFile} not found. Using default identity.`);
        }
        this.decisionEngine.setAgentIdentity(this.agentIdentity);
    }

    private isTrivialSocialIntent(text: string): boolean {
        const normalized = (text || '').toLowerCase();
        const quotedMatch = normalized.match(/"([^"]+)"/);
        const payload = (quotedMatch?.[1] || normalized).trim();

        if (payload.length === 0) return false;

        const patterns = [
            /^hi\b/, /^hello\b/, /^hey\b/, /^yo\b/,
            /\bgood (morning|afternoon|evening)\b/,
            /\bhow are you\b/,
            /\bhow's it going\b/,
            /\byou there\b/,
            /\bare you there\b/,
            /\bare you ignoring me\b/,
            /\bp(i|y)ng\b/,
            /^thanks\b/, /^thank you\b/
        ];

        return payload.length <= 80 && patterns.some(p => p.test(payload));
    }

    private getPluginHealthCheckIntervalMs(): number {
        const minutes = this.config.get('pluginHealthCheckIntervalMinutes') || 15;
        return Math.max(1, minutes) * 60 * 1000;
    }

    private async runPluginHealthCheck(trigger: 'startup' | 'tick') {
        const now = Date.now();
        if (now - this.lastPluginHealthCheckAt < this.getPluginHealthCheckIntervalMs()) return;
        this.lastPluginHealthCheckAt = now;

        const { healthy, issues } = await this.skills.checkPluginsHealth();
        if (healthy.length > 0) {
            logger.info(`Agent: Plugin health check (${trigger}) healthy: ${healthy.join(', ')}`);
        }

        if (issues.length === 0) return;

        for (const issue of issues) {
            logger.warn(`Agent: Plugin health issue detected (${issue.skillName}): ${issue.error}`);
            this.memory.saveMemory({
                id: `plugin-health-${issue.skillName}-${Date.now()}`,
                type: 'short',
                content: `Plugin health issue: ${issue.skillName} at ${issue.pluginPath} - ${issue.error}`,
                metadata: { tool: 'plugin_health_check', plugin: issue.skillName, path: issue.pluginPath }
            });

            let repaired = false;
            try {
                await this.skills.executeSkill('self_repair_skill', {
                    skillName: issue.skillName,
                    errorMessage: issue.error,
                    pluginPath: issue.pluginPath,
                    trigger
                });
                repaired = true;
                logger.info(`Agent: self_repair_skill executed for ${issue.skillName}`);
            } catch (e) {
                logger.warn(`Agent: self_repair_skill unavailable or failed for ${issue.skillName}: ${e}`);
            }

            if (!repaired) {
                await this.pushTask(
                    `System Alert: Plugin health check failed for '${issue.skillName}'. Error:\n${issue.error}\n\nPlease use 'self_repair_skill' to fix it immediately.`,
                    10,
                    { source: 'system', error: issue.error, skillName: issue.skillName },
                    'autonomy'
                );
            }
        }
    }

    private setupEventListeners() {
        eventBus.on('scheduler:tick', async () => {
            await this.processNextAction();
            await this.runPluginHealthCheck('tick');
            this.checkHeartbeat();
        });

        eventBus.on('action:queued', (action: Action) => {
            logger.info(`Agent: Noticed new action ${action.id} in queue`);
        });
    }

    private checkHeartbeat() {
        this.detectStalledAction();
        this.recoverStaleInProgressActions();

        const autonomyEnabled = this.config.get('autonomyEnabled');
        const intervalMinutes = this.config.get('autonomyInterval') || 0;
        if (!autonomyEnabled || intervalMinutes <= 0) return;

        // Check for ACTIVE tasks only (pending or in-progress)
        const activeTasks = this.actionQueue.getQueue().filter(a => a.status === 'pending' || a.status === 'in-progress');

        const idleTimeMs = Date.now() - this.lastActionTime;
        const heartbeatDue = (Date.now() - this.lastHeartbeatAt) > intervalMinutes * 60 * 1000;
        const backlogLimit = this.config.get('autonomyBacklogLimit') || 3;
        const hasBacklogSpace = activeTasks.length < backlogLimit;

        // SMART COOLING: If last heartbeat was unproductive, exponentially back off
        // After 3 unproductive heartbeats, wait 2x, then 4x, then 8x the interval
        const cooldownMultiplier = this.lastHeartbeatProductive ? 1 : Math.min(8, Math.pow(2, this.consecutiveIdleHeartbeats));
        const effectiveInterval = intervalMinutes * cooldownMultiplier;
        const smartHeartbeatDue = (Date.now() - this.lastHeartbeatAt) > effectiveInterval * 60 * 1000;

        if (!smartHeartbeatDue) {
            // Still cooling off
            return;
        }

        if (heartbeatDue && hasBacklogSpace) {
            logger.info(`Agent: Heartbeat trigger - Agent idle for ${Math.floor(idleTimeMs / 60000)}m. Cooldown multiplier: ${cooldownMultiplier}x`);

            // Check if we have workers available for delegation
            const runningWorkers = this.orchestrator.getRunningWorkers();
            const availableAgents = this.orchestrator.getAvailableAgents('execute');

            // Build a smarter, more targeted prompt
            const proactivePrompt = this.buildSmartHeartbeatPrompt(idleTimeMs, runningWorkers.length, availableAgents.length);

            // If we have idle workers, delegate research to them instead
            if (availableAgents.length > 0 && runningWorkers.length > 0) {
                logger.info(`Agent: Delegating heartbeat research to ${availableAgents.length} available worker(s)`);
                this.delegateHeartbeatResearch(availableAgents);
            } else {
                // No workers, do it ourselves but be efficient
                this.pushTask(proactivePrompt, 2, { isHeartbeat: true }, 'autonomy');
            }

            // Track productivity
            this.lastHeartbeatProductive = false; // Will be set true if actual learning/action occurs
            this.consecutiveIdleHeartbeats++;
            this.updateLastHeartbeatTime();
        } else if (heartbeatDue && !hasBacklogSpace) {
            logger.info(`Agent: Heartbeat skipped due to backlog (${activeTasks.length}/${backlogLimit}).`);
            // Reset idle counter since we have work
            this.consecutiveIdleHeartbeats = 0;
            this.lastHeartbeatProductive = true;
        }
    }

    private buildSmartHeartbeatPrompt(idleTimeMs: number, workerCount: number, availableWorkers: number): string {
        // Get recent memory to understand context and find actionable opportunities
        const recentMemories = this.memory.getRecentContext(20);
        const recentContext = recentMemories
            .filter(m => m.type === 'episodic' || m.type === 'short')
            .map(m => m.content)
            .join('\n');

        // Check for incomplete/failed tasks
        const recentTasks = this.actionQueue.getQueue()
            .filter(a => a.status === 'failed' || a.status === 'completed')
            .slice(-5)
            .map(a => `[${a.status}] ${a.payload?.description?.slice(0, 100) || 'Unknown'}`)
            .join('\n');

        // Get user profile for personalized actions
        const userProfilePath = this.config.get('userProfilePath');
        let userContext = '';
        try {
            if (fs.existsSync(userProfilePath)) {
                userContext = fs.readFileSync(userProfilePath, 'utf-8').slice(0, 500);
            }
        } catch { /* ignore */ }

        return `
PROACTIVE HEARTBEAT - Idle for ${Math.floor(idleTimeMs / 60000)} minutes.
Workers: ${availableWorkers} available / ${workerCount} total

═══════════════════════════════════════════
RECENT CONVERSATION & TASKS:
${recentContext.slice(0, 2000) || 'No recent activity'}

RECENT TASK HISTORY:
${recentTasks || 'No recent tasks'}

USER PROFILE:
${userContext.slice(0, 300) || 'No profile yet'}
═══════════════════════════════════════════

YOU HAVE FULL CAPABILITIES. Based on the context above, choose an ACTION:

🔄 **FOLLOW UP ON SOMETHING**
- Did the user ask you to check something later? Do it now.
- Was there a task that failed? Try a different approach.
- Did user mention a website/service? Go check it for updates.

📬 **PROACTIVE OUTREACH**
- Send the user a useful update via Telegram/WhatsApp
- Share something relevant you found
- Ask if they need help with something mentioned earlier

🔍 **INVESTIGATE & RESEARCH**
- User mentioned a problem? Research solutions and report back
- Something was unclear? Look it up and prepare an answer
- Browse a site the user cares about and summarize what's new

🛠️ **MAINTENANCE & IMPROVEMENT**
- Clean up old memories or consolidate learnings
- Update your identity/persona based on interactions
- Retry a failed automation with a new strategy

📚 **LEARN SOMETHING CONTEXTUAL**
- Research deeper into a topic the user discussed
- update_learning("topic from context") to auto-research and save

⏹️ **NOTHING TO DO**
- If context is empty or nothing actionable: terminate with goals_met: true
- Don't force an action if there's genuinely nothing useful

RULES:
- Actions must relate to the conversation context above
- Be genuinely helpful, not performative
- If you message the user, have something valuable to say
- If nothing meaningful to do, just terminate
`;
    }

    private async delegateHeartbeatResearch(availableAgents: any[]) {
        // Get context to determine what action to delegate
        const recentMemories = this.memory.getRecentContext(15);
        const recentContext = recentMemories
            .filter(m => m.type === 'episodic' || m.type === 'short')
            .map(m => m.content)
            .join('\n');

        if (!recentContext || recentContext.length < 50) {
            logger.info(`Agent: No recent context for heartbeat action, skipping delegation`);
            return;
        }

        // Use LLM to determine the best proactive action from context
        try {
            const actionPrompt = `Based on this conversation context, what is ONE useful proactive action a worker agent could do? 
Consider: following up on something, researching a topic mentioned, checking a website, preparing information.

Context:
${recentContext.slice(0, 1500)}

Respond with a single actionable task description (one sentence):`;
            
            const taskDescription = await this.llm.call(actionPrompt, 'Extract proactive action');
            
            if (!taskDescription || taskDescription.length < 10 || taskDescription.length > 200) {
                logger.info(`Agent: Could not extract meaningful action from context`);
                return;
            }

            const worker = availableAgents[0];
            const task = this.orchestrator.delegateTask(
                worker.id,
                taskDescription.trim(),
                3 // Low priority
            );
            logger.info(`Agent: Delegated proactive task to worker ${worker.name}: "${taskDescription.trim().slice(0, 60)}..."`);
            this.lastHeartbeatProductive = true;
            this.consecutiveIdleHeartbeats = 0;
        } catch (e) {
            logger.warn(`Agent: Failed to delegate heartbeat action: ${e}`);
        }
    }

    private updateLastActionTime() {
        this.lastActionTime = Date.now();
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat');
        try {
            fs.writeFileSync(heartbeatPath, this.lastActionTime.toString());
        } catch (e) {
            logger.error(`Failed to save heartbeat: ${e}`);
        }
    }

    private updateLastHeartbeatTime() {
        this.lastHeartbeatAt = Date.now();
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat_autonomy');
        try {
            fs.writeFileSync(heartbeatPath, this.lastHeartbeatAt.toString());
        } catch (e) {
            logger.error(`Failed to save heartbeat autonomy time: ${e}`);
        }
    }

    private loadLastActionTime() {
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat');
        if (fs.existsSync(heartbeatPath)) {
            try {
                const data = fs.readFileSync(heartbeatPath, 'utf-8');
                this.lastActionTime = parseInt(data) || Date.now();
                logger.info(`Agent: Restored last action time: ${new Date(this.lastActionTime).toLocaleString()}`);
            } catch (e) {
                this.lastActionTime = Date.now();
            }
        } else {
            this.lastActionTime = Date.now();
        }
    }

    private loadLastHeartbeatTime() {
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat_autonomy');
        if (fs.existsSync(heartbeatPath)) {
            try {
                const data = fs.readFileSync(heartbeatPath, 'utf-8');
                this.lastHeartbeatAt = parseInt(data) || Date.now();
            } catch (e) {
                this.lastHeartbeatAt = Date.now();
            }
        } else {
            this.lastHeartbeatAt = Date.now();
        }
    }

    private detectStalledAction() {
        if (!this.isBusy || !this.currentActionStartAt || !this.currentActionId) return;
        const maxMinutes = this.config.get('maxActionRunMinutes') || 10;
        const elapsedMs = Date.now() - this.currentActionStartAt;
        if (elapsedMs <= maxMinutes * 60 * 1000) return;

        logger.error(`Agent: Action ${this.currentActionId} stalled for ${Math.floor(elapsedMs / 60000)}m. Forcing failure.`);
        this.actionQueue.updateStatus(this.currentActionId, 'failed');
        this.isBusy = false;
        this.currentActionId = null;
        this.currentActionStartAt = null;
    }

    private recoverStaleInProgressActions() {
        const maxMinutes = this.config.get('maxStaleActionMinutes') || 30;
        const threshold = Date.now() - maxMinutes * 60 * 1000;
        const queue = this.actionQueue.getQueue();
        const stale = queue.filter(a => a.status === 'in-progress' && new Date(a.updatedAt || a.timestamp).getTime() < threshold);
        if (stale.length === 0) return;

        for (const action of stale) {
            logger.warn(`Agent: Found stale in-progress action ${action.id}. Marking failed.`);
            this.actionQueue.updateStatus(action.id, 'failed');
        }
    }

    public async resetMemory() {
        logger.info('Agent: Resetting all memory and identity files...');

        // Clear memory.json
        const memoryPath = this.config.get('memoryPath') || './memory.json';
        if (fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, JSON.stringify({}, null, 2));

        // Clear actions.json
        const actionPath = this.config.get('actionQueuePath') || './actions.json';
        if (fs.existsSync(actionPath)) fs.writeFileSync(actionPath, JSON.stringify([], null, 2));

        // Reset USER.md
        const userPath = this.config.get('userProfilePath') || './USER.md';
        const defaultUser = '# User Profile\n\nThis file contains information about the user.\n\n## Core Identity\n- Name: Unknown\n- Preferences: None known yet\n\n## Learned Facts\n(Empty)\n';
        fs.writeFileSync(userPath, defaultUser);

        // Reset .AI.md
        const defaultAI = '# .AI.md\nName: Alice\nPersonality: proactive, concise, professional\nAutonomyLevel: high\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n';
        fs.writeFileSync(this.agentConfigFile, defaultAI);

        // Reset JOURNAL.md
        const journalPath = this.config.get('journalPath') || './JOURNAL.md';
        fs.writeFileSync(journalPath, '# Agent Journal\nThis file contains self-reflections and activity logs.\n');

        // Reset LEARNING.md
        const learningPath = this.config.get('learningPath') || './LEARNING.md';
        fs.writeFileSync(learningPath, '# Agent Learning Base\nThis file contains structured knowledge on various topics.\n');

        // Reload managers
        this.memory = new MemoryManager(memoryPath, userPath);
        this.actionQueue = new ActionQueue(actionPath);
        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            journalPath,
            learningPath
        );

        logger.info('Agent: Memory and Identity have been reset.');
    }

    /**
     * Run a single decision cycle (used by worker processes)
     * Processes the next action in the queue and returns the result
     */
    public async runOnce(): Promise<string | null> {
        const action = this.actionQueue.getNext();
        if (!action) {
            return null;
        }

        this.isBusy = true;
        this.currentActionId = action.id;
        this.currentActionStartAt = Date.now();

        try {
            this.actionQueue.updateStatus(action.id, 'in-progress');

            // Run simulation and decision loop for this single action
            const recentHist = this.memory.getRecentContext();
            const contextStr = recentHist.map(c => `[${c.type}] ${c.content}`).join('\n');
            const executionPlan = await this.simulationEngine.simulate(action.payload.description, contextStr);

            const MAX_STEPS = 30;
            let currentStep = 0;
            let result = '';

            while (currentStep < MAX_STEPS) {
                currentStep++;

                const decision = await this.decisionEngine.decide({
                    ...action,
                    payload: {
                        ...action.payload,
                        currentStep,
                        executionPlan
                    }
                });

                // Check for termination via verification.goals_met
                if (decision.verification?.goals_met) {
                    result = decision.content || 'Task completed';
                    break;
                }

                if (decision.tools && decision.tools.length > 0) {
                    for (const tool of decision.tools) {
                        await this.skills.executeSkill(tool.name, tool.metadata || {});
                    }
                }
            }

            this.actionQueue.updateStatus(action.id, 'completed');
            
            this.memory.saveMemory({
                id: `${action.id}-complete`,
                type: 'episodic',
                content: `Completed Task: "${action.payload.description}" - Result: ${result.slice(0, 200)}`,
                metadata: { actionId: action.id }
            });

            return result;
        } catch (err: any) {
            logger.error(`Agent runOnce error: ${err.message}`);
            this.actionQueue.updateStatus(action.id, 'failed');
            return `Error: ${err.message}`;
        } finally {
            this.isBusy = false;
            this.currentActionId = null;
            this.currentActionStartAt = null;
        }
    }

    public async start() {
        logger.info('Agent is starting...');
        this.scheduler.start();

        const startupPromises: Promise<void>[] = [];
        if (this.telegram) {
            startupPromises.push(this.telegram.start());
        }
        if (this.whatsapp) {
            startupPromises.push(this.whatsapp.start());
        }

        await Promise.all(startupPromises);
        await this.runPluginHealthCheck('startup');
        logger.info('Agent: All channels initialized');
    }

    public async stop() {
        this.scheduler.stop();
        if (this.telegram) {
            await this.telegram.stop();
        }
        if (this.whatsapp) {
            await this.whatsapp.stop();
        }
        await this.browser.close();
        logger.info('Agent stopped.');
    }

    public async pushTask(description: string, priority: number = 5, metadata: any = {}, lane: 'user' | 'autonomy' = 'user') {
        const action: Action = {
            id: Math.random().toString(36).substring(7),
            type: 'TASK',
            payload: { description, ...metadata },
            priority,
            lane,
            status: 'pending',
            timestamp: new Date().toISOString(),
        };
        this.actionQueue.push(action);
    }

    private async processNextAction() {
        if (this.isBusy) return;

        const action = this.actionQueue.getNext();
        if (!action) return;

        this.isBusy = true;
        this.currentActionId = action.id;
        this.currentActionStartAt = Date.now();
        try {
            this.updateLastActionTime();
            this.actionQueue.updateStatus(action.id, 'in-progress');

            // Record Task Start in Episodic Memory
            this.memory.saveMemory({
                id: `${action.id}-start`,
                type: 'episodic',
                content: `Starting Task: "${action.payload.description}" ${action.payload.source === 'telegram' ? `(via Telegram from ${action.payload.senderName})` : ''}`,
                metadata: { actionId: action.id, source: action.payload.source }
            });

            // SIMULATION LAYER (New)
            // Run a quick mental simulation to plan the steps (executed once per action start)
            const recentHist = this.memory.getRecentContext();
            const contextStr = recentHist.map(c => `[${c.type}] ${c.content}`).join('\n');
            const isSocialFastPath = this.isTrivialSocialIntent(action.payload.description || '');
            const executionPlan = isSocialFastPath
                ? 'Respond once with a brief, friendly reply and terminate immediately. Do not perform research or multi-step actions.'
                : await this.simulationEngine.simulate(action.payload.description, contextStr);

            const MAX_STEPS = isSocialFastPath ? 1 : (this.config.get('maxStepsPerAction') || 30);
            const MAX_MESSAGES = isSocialFastPath ? 1 : (this.config.get('maxMessagesPerAction') || 3);
            let currentStep = 0;
            let messagesSent = 0;
            let lastMessageContent = '';
            let lastStepToolSignatures = '';
            let loopCounter = 0;
            let deepToolExecutedSinceLastMessage = true; // Start true to allow Step 1 message
            let stepsSinceLastMessage = 0;
            let consecutiveNonDeepTurns = 0;
            const sentMessagesInAction: string[] = [];

            const nonDeepSkills = [
                'send_telegram',
                'send_whatsapp',
                'update_journal',
                'update_learning',
                'update_user_profile',
                'update_agent_identity',
                'get_system_info',
                'browser_examine_page', // Examining without action is low info
                'browser_screenshot',
                'request_supporting_data'
            ];

            while (currentStep < MAX_STEPS) {
                currentStep++;
                stepsSinceLastMessage++;
                logger.info(`Agent: Step ${currentStep} for action ${action.id}`);

                if (messagesSent >= MAX_MESSAGES) {
                    logger.warn(`Agent: Message budget reached (${messagesSent}/${MAX_MESSAGES}). Forcing termination for action ${action.id}.`);
                    break;
                }

                if (this.telegram && action.payload.source === 'telegram') {
                    await this.telegram.sendTypingIndicator(action.payload.sourceId);
                }

                let decision;
                try {
                    decision = await ErrorHandler.withRetry(async () => {
                        return await this.decisionEngine.decide({
                            ...action,
                            payload: {
                                ...action.payload,
                                messagesSent,
                                messagingLocked: messagesSent > 0,
                                currentStep,
                                executionPlan // Pass plan to DecisionEngine
                            }
                        });
                    }, { maxRetries: 2 });
                } catch (e) {
                    logger.error(`DecisionEngine failed after retries: ${e}`);
                    throw new Error(`LLM Decision Failure: ${e}`);
                }

                if (decision.reasoning) {
                    logger.info(`Agent Reasoning: ${decision.reasoning}`);
                }

                const pipelineNotes = decision.metadata?.pipelineNotes;
                if (pipelineNotes && (pipelineNotes.warnings?.length || pipelineNotes.dropped?.length)) {
                    this.memory.saveMemory({
                        id: `${action.id}-step-${currentStep}-pipeline-notes`,
                        type: 'short',
                        content: `Pipeline notes: ${JSON.stringify(pipelineNotes)}`,
                        metadata: { tool: 'pipeline', ...pipelineNotes }
                    });
                }

                if (decision.verification) {
                    logger.info(`Verification: [Goals Met: ${decision.verification.goals_met}] ${decision.verification.analysis}`);
                    if (decision.verification.goals_met) {
                        logger.info(`Agent: Strategic goal satisfied. Terminating action ${action.id}.`);
                        break;
                    }
                }

                if (decision.tools && decision.tools.length > 0) {
                    // 1. INTRA-STEP DEDUPLICATION (Fixes multi-call issues on commands)
                    const uniqueTools: any[] = [];
                    const seenSignatures = new Set<string>();
                    for (const t of decision.tools) {
                        const sig = `${t.name}:${JSON.stringify(t.metadata)}`;
                        if (!seenSignatures.has(sig)) {
                            uniqueTools.push(t);
                            seenSignatures.add(sig);
                        } else {
                            logger.warn(`Agent: Dropped intra-step duplicate tool: ${t.name}`);
                        }
                    }
                    decision.tools = uniqueTools;

                    // 2. PLANNING LOOP PROTECTION
                    // If all tools in this turn are non-deep (journal, learning, etc.), increment turn counter
                    const hasDeepToolThisTurn = decision.tools.some((t: any) => !nonDeepSkills.includes(t.name));
                    if (!hasDeepToolThisTurn) {
                        consecutiveNonDeepTurns++;
                        if (consecutiveNonDeepTurns >= 3) {
                            logger.warn(`Agent: Detected planning loop (3 turns without deep action). Terminating action ${action.id}.`);
                            break;
                        }
                    } else {
                        consecutiveNonDeepTurns = 0;
                    }

                    // 3. INFINITE LOGIC LOOP (Signature-based)
                    const currentStepSignatures = decision.tools.map(t => `${t.name}:${JSON.stringify(t.metadata)}`).join('|');
                    if (currentStepSignatures === lastStepToolSignatures) {
                        loopCounter++;
                        if (loopCounter >= 3) {
                            logger.warn(`Agent: Detected persistent redundant logic loop (3x). Breaking action ${action.id}.`);
                            break;
                        } else {
                            logger.info(`Agent: Detected potential loop (${loopCounter}/3). allowing retry...`);
                        }
                    } else {
                        loopCounter = 0;
                    }
                    lastStepToolSignatures = currentStepSignatures;

                    let forceBreak = false;
                    let hasSentMessageInThisStep = false;

                    for (const toolCall of decision.tools) {
                        // Reset cooldown if a deep tool (search, command, browser interaction) is used
                        if (!nonDeepSkills.includes(toolCall.name)) {
                            deepToolExecutedSinceLastMessage = true;
                        }

                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp') {
                            const currentMessage = (toolCall.metadata?.message || '').trim();

                            // 1. Block exact duplicates across any step in this action
                            if (sentMessagesInAction.includes(currentMessage)) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Action-wide duplicate).`);
                                continue;
                            }

                            // 2. Communication Cooldown: Block if no new deep info since last message
                            // Exceptions: 
                            // - Step 1 is mandatory (Greeter)
                            // - If 15+ steps have passed without an update (Status update for long tasks)
                            if (currentStep > 1 && !deepToolExecutedSinceLastMessage && stepsSinceLastMessage < 15) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Communication Cooldown - No new deep data).`);
                                continue;
                            }

                            // 3. Block double-messages in a single step
                            if (hasSentMessageInThisStep) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Already sent message in this step).`);
                                continue;
                            }

                            sentMessagesInAction.push(currentMessage);
                            lastMessageContent = currentMessage;
                            hasSentMessageInThisStep = true;
                            deepToolExecutedSinceLastMessage = false; // Reset cooldown after sending
                            stepsSinceLastMessage = 0; // Reset status update timer
                        }

                        // 3. SAFETY GATING (Autonomy Lane)
                        // Autonomous background tasks cannot run dangerous commands without explicit user permission.
                        const dangerousTools = ['run_command', 'write_to_file', 'install_npm_dependency'];
                        if (action.lane === 'autonomy' && dangerousTools.includes(toolCall.name)) {
                            logger.warn(`Agent: Blocked dangerous tool ${toolCall.name} in autonomy lane.`);

                            // If we have a Telegram, notify the user
                            if (this.telegram && this.config.get('telegramToken')) {
                                // Find a chatID to notify (from config or last known?)
                                // For now, we rely on the Agent self-correcting strategy or just logging.
                            }

                            const denial = `[PERMISSION DENIED] You are in AUTONOMY MODE. You cannot use '${toolCall.name}' directly. 
System Policy requires you to ASK the user for permission first.
Action: Use 'send_telegram' to explain what you want to do and ask for approval. 
(e.g., "I found a file I want to edit. Can I proceed?")`;

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-denial`,
                                type: 'short',
                                content: denial
                            });
                            // We don't execute the skill. We continue to next loop iteration, effectively "skipping" this tool but logging the denial.
                            // The agent will see this in memory next turn.
                            continue;
                        }


                        // logger.info(`Executing skill: ${toolCall.name}`); // Redundant, SkillsManager logs this
                        let toolResult;
                        try {
                            toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});
                        } catch (e) {
                            logger.error(`Skill execution failed: ${toolCall.name} - ${e}`);
                            toolResult = `Error executing skill ${toolCall.name}: ${e}`;
                        }

                        // CLARIFICATION HANDLING: Break sequence if agent is asking for info
                        if (toolCall.name === 'request_supporting_data') {
                            const question = toolCall.metadata?.question || toolCall.metadata?.text || 'I need more information to proceed.';
                            if (this.telegram && action.payload.source === 'telegram') {
                                await this.telegram.sendMessage(action.payload.sourceId, `❓ *Clarification Needed*: ${question}`);
                            }
                            logger.info(`Agent: Clarification requested. Pausing action ${action.id}.`);
                            forceBreak = true;

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-clarification`,
                                type: 'short',
                                content: `[SYSTEM: Agent requested clarification: "${question}". Pausing sequence.]`
                            });
                            break;
                        }

                        // Mark if a deep tool was successfully used
                        const resultString = JSON.stringify(toolResult) || '';
                        if (!nonDeepSkills.includes(toolCall.name) && !resultString.toLowerCase().includes('error')) {
                            deepToolExecutedSinceLastMessage = true;
                        }

                        let observation = `Observation: Tool ${toolCall.name} returned: ${JSON.stringify(toolResult)}`;
                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp') {
                            messagesSent++;
                        }

                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-${toolCall.name}`,
                            type: 'short',
                            content: observation,
                            metadata: { tool: toolCall.name, result: toolResult, input: toolCall.metadata }
                        });

                        // HARD BREAK after scheduling to prevent loops
                        if (toolCall.name === 'schedule_task') {
                            logger.info(`Agent: Task scheduled for action ${action.id}. Terminating sequence.`);
                            forceBreak = true;
                            break;
                        }
                    }
                    if (forceBreak) break;
                } else {
                    logger.info(`Agent: Action ${action.id} reached self-termination. Reasoning: ${decision.reasoning || 'No further tools needed.'}`);
                    break;
                }
            }
            // Record Final Response/Reasoning in Memory upon completion
            this.memory.saveMemory({
                id: `${action.id}-conclusion`,
                type: 'episodic',
                content: `Task Finished: ${action.payload.description}. Current status marked as completed.`,
                metadata: { actionId: action.id, steps: currentStep }
            });

            this.actionQueue.updateStatus(action.id, 'completed');
        } catch (error: any) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');

            // SOS Notification
            const sosMessage = `⚠️ *Action Failed*: I encountered a persistent error while processing your request: "${action.payload.description}"\n\n*Error*: ${error.message}`;

            if (this.telegram && action.payload.source === 'telegram') {
                await this.telegram.sendMessage(action.payload.sourceId, sosMessage + `\n\nI've logged this to my journal and will attempt to recover in the next turn.`);
            } else if (this.whatsapp && action.payload.source === 'whatsapp') {
                await this.whatsapp.sendMessage(action.payload.sourceId, sosMessage);
            }
        } finally {
            this.isBusy = false;
            this.currentActionId = null;
            this.currentActionStartAt = null;

            // BACKGROUND TASK: Memory Consolidation
            // We do this in the background after the agent is marked as not busy
            // to prevent blocking the next task.
            this.memory.consolidate(this.llm).catch(e => {
                logger.error(`Background Memory Consolidation Error: ${e}`);
            });
        }
    }
}
