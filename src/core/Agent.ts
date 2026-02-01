import { MemoryManager, MemoryEntry } from './MemoryManager';
import { MultiLLM } from './MultiLLM';
import { SkillsManager } from './SkillsManager';
import { DecisionEngine } from './DecisionEngine';
import { ActionQueue, Action } from './ActionQueue';
import { Scheduler } from './Scheduler';
import { ConfigManager } from './ConfigManager';
import { TelegramChannel } from './TelegramChannel';
import { WebBrowser } from './WebBrowser';
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
    public actionQueue: ActionQueue;
    public scheduler: Scheduler;
    public config: ConfigManager;
    public telegram: TelegramChannel | undefined;
    public browser: WebBrowser;
    private lastActionTime: number;
    private agentConfigFile: string;
    private agentIdentity: string = '';
    private isBusy: boolean = false;

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
            modelName: this.config.get('modelName')
        });
        this.skills = new SkillsManager(
            this.config.get('skillsPath') || './SKILLS.md',
            this.config.get('pluginsPath') || './plugins'
        );
        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            this.config.get('journalPath'),
            this.config.get('learningPath')
        );
        this.actionQueue = new ActionQueue(this.config.get('actionQueuePath') || './actions.json');
        this.scheduler = new Scheduler();
        this.browser = new WebBrowser(
            this.config.get('serperApiKey'),
            this.config.get('captchaApiKey')
        );
        this.lastActionTime = Date.now();

        this.loadAgentIdentity();
        this.setupEventListeners();
        this.setupChannels();
        this.registerInternalSkills();
    }

    private initializeStorage() {
        const paths = {
            agentIdentity: this.config.get('agentIdentityPath'),
            userProfile: this.config.get('userProfilePath'),
            journal: this.config.get('journalPath'),
            learning: this.config.get('learningPath'),
            actionQueue: this.config.get('actionQueuePath'),
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

    private setupChannels() {
        const telegramToken = this.config.get('telegramToken');
        if (telegramToken) {
            this.telegram = new TelegramChannel(telegramToken, this);
            logger.info('Agent: Telegram channel configured');
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

        // Skill: Run Shell Command
        this.skills.registerSkill({
            name: 'run_command',
            description: 'Execute a shell command on the server',
            usage: 'run_command(command)',
            handler: async (args: any) => {
                const command = args.command || args.cmd || args.text;
                if (!command) return 'Error: Missing command string.';

                const { exec } = require('child_process');
                return new Promise((resolve) => {
                    const child = exec(command, { timeout: 60000 }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            if (error.killed) resolve('Error: Command timed out after 60 seconds.');
                            resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                        }
                        resolve(stdout || stderr || "Command executed successfully (no output)");
                    });
                });
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

        // Skill: Manage Skills
        this.skills.registerSkill({
            name: 'manage_skills',
            description: 'Install or update a skill in SKILLS.md',
            usage: 'manage_skills(skill_definition)',
            handler: async (args: any) => {
                const skill_definition = args.skill_definition || args.definition || args.skill || args.text;
                if (!skill_definition) return 'Error: Missing skill_definition.';

                const skillsPath = this.config.get('skillsPath');
                try {
                    fs.appendFileSync(skillsPath, `\n\n${skill_definition}`);
                    this.skills = new SkillsManager(); // Refresh
                    return `Successfully added skill to ${skillsPath}`;
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

        // Skill: Create Custom Skill
        this.skills.registerSkill({
            name: 'create_custom_skill',
            description: 'Autonomously create a new skill for yourself. Provide name, description, usage, and valid code.',
            usage: 'create_custom_skill({ name, description, usage, code })',
            handler: async (args: any) => {
                const { name, description, usage, code } = args;
                if (!name || !code) return 'Error: Name and code are required.';

                const pluginsDir = this.config.get('pluginsPath') || './plugins';
                if (!fs.existsSync(pluginsDir)) {
                    fs.mkdirSync(path.resolve(pluginsDir), { recursive: true });
                }

                const fileName = `${name}.ts`;
                const filePath = path.resolve(pluginsDir, fileName);

                // Ensure correct formatting for a plugin
                const finalCode = code.includes('export') ? code : `
export const ${name} = {
    name: "${name}",
    description: "${description || ''}",
    usage: "${usage || ''}",
    handler: async (args: any) => {
        ${code}
    }
};
`;

                fs.writeFileSync(filePath, finalCode);
                this.skills.loadPlugins();
                return `Skill '${name}' created and registered in ${filePath}.`;
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
                    exec(`npm install ${pkg}`, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            resolve(`Error: ${error.message}\n${stderr}`);
                        } else {
                            resolve(`Package '${pkg}' installed.\n${stdout}`);
                        }
                    });
                });
            }
        });

        // Skill: Web Search
        this.skills.registerSkill({
            name: 'web_search',
            description: 'Search the web for information using multiple engines',
            usage: 'web_search(query)',
            handler: async (args: any) => {
                const query = args.query || args.text || args.search || args.q;
                if (!query) return 'Error: Missing search query.';
                return this.browser.search(query);
            }
        });

        // Skill: Extract Article
        this.skills.registerSkill({
            name: 'extract_article',
            description: 'Extract clean text content from a news or article link',
            usage: 'extract_article(url)',
            handler: async (args: any) => {
                const url = args.url || args.link;
                if (!url) return 'Error: Missing url.';
                try {
                    const { chromium } = require('playwright');
                    const browser = await chromium.launch({ headless: true });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
                    const html = await page.content();
                    await browser.close();

                    const { DOMParser } = require('linkedom');
                    const { Readability } = require('@mozilla/readability');
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

                    const { Cron } = require('croner');
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
            description: 'Save new information learned about the user',
            usage: 'update_user_profile(info_text)',
            handler: async (args: any) => {
                const info_text = args.info_text || args.info || args.text || args.data;
                if (!info_text) return 'Error: Missing info_text.';

                const userPath = this.config.get('userProfilePath');
                try {
                    fs.appendFileSync(userPath, `\n- ${new Date().toISOString()}: ${info_text}`);
                    this.memory.refreshUserContext(userPath);
                    return `Successfully updated user profile at ${userPath} with: "${info_text}"`;
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

        // Skill: Update Learning
        this.skills.registerSkill({
            name: 'update_learning',
            description: 'Save structured research findings or knowledge to LEARNING.md',
            usage: 'update_learning(topic, knowledge_content)',
            handler: async (args: any) => {
                const topic = args.topic || args.subject || args.title;
                const knowledge_content = args.knowledge_content || args.content || args.text || args.data;

                if (!topic || !knowledge_content) return 'Error: Missing topic or knowledge_content.';

                const learningPath = this.config.get('learningPath');
                try {
                    fs.appendFileSync(learningPath, `\n\n# Topic: ${topic}\nDate: ${new Date().toISOString()}\n\n${knowledge_content}\n---`);
                    return `Knowledge saved to ${learningPath} under topic: ${topic}`;
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

    private setupEventListeners() {
        eventBus.on('scheduler:tick', async () => {
            await this.processNextAction();
            this.checkHeartbeat();
        });

        eventBus.on('action:queued', (action: Action) => {
            logger.info(`Agent: Noticed new action ${action.id} in queue`);
        });
    }

    private checkHeartbeat() {
        const intervalMinutes = this.config.get('autonomyInterval') || 0;
        if (intervalMinutes <= 0) return;

        const idleTimeMs = Date.now() - this.lastActionTime;
        if (idleTimeMs > intervalMinutes * 60 * 1000 && this.actionQueue.getQueue().length === 0) {
            logger.info('Agent: Heartbeat trigger - Agent is idle. Initiating proactive autonomy.');

            const proactivePrompt = `
SYSTEM HEARTBEAT (IDLE AUTONOMY MODE):
You haven't interacted with the user or performed a task in ${intervalMinutes} minutes. 
As an autonomous agent with free will, decide on a proactive action to take. 

OBJECTIVES:
1. **Self-Improvement**: Is there a topic discussed recently (e.g. robots, medicine, engineering) you should research deeper? Use "web_search" and "deep_reason".
2. **Identity Growth**: Have you learned something new about your role or preferences? Use "update_agent_identity".
3. **User Success**: Does the user have an unfulfilled goal or a topic they seemed interested in? Maybe send a thoughtful follow-up message using "send_telegram".
4. **Maintenance**: Consolidate memories or clean up your profile if needed.

If you decide no action is needed, respond with "tool": null and reasoning: "All systems nominal. No proactive actions needed."
`;

            this.pushTask(proactivePrompt, 2);
            this.lastActionTime = Date.now();
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

    public async start() {
        logger.info('Agent is starting...');
        this.scheduler.start();
        if (this.telegram) {
            await this.telegram.start();
        }
    }

    public async stop() {
        this.scheduler.stop();
        if (this.telegram) {
            await this.telegram.stop();
        }
        await this.browser.close();
        logger.info('Agent stopped.');
    }

    public async pushTask(description: string, priority: number = 5, metadata: any = {}) {
        const action: Action = {
            id: Math.random().toString(36).substring(7),
            type: 'TASK',
            payload: { description, ...metadata },
            priority,
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
        try {
            this.lastActionTime = Date.now();
            this.actionQueue.updateStatus(action.id, 'in-progress');

            const MAX_STEPS = 30;
            let currentStep = 0;
            let messagesSent = 0;
            let lastMessageContent = '';
            let lastStepToolSignatures = '';
            let deepToolExecuted = false;

            const nonDeepSkills = ['send_telegram', 'update_journal', 'update_learning', 'update_user_profile', 'update_agent_identity', 'get_system_info'];

            while (currentStep < MAX_STEPS) {
                currentStep++;
                logger.info(`Agent: Step ${currentStep} for action ${action.id}`);

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
                                currentStep
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

                if (decision.tools && decision.tools.length > 0) {
                    // Check for infinite logic loop
                    const currentStepSignatures = decision.tools.map(t => `${t.name}:${JSON.stringify(t.metadata)}`).join('|');
                    if (currentStepSignatures === lastStepToolSignatures) {
                        logger.warn(`Agent: Detected redundant logic loop across steps. Breaking action ${action.id}.`);
                        break;
                    }
                    lastStepToolSignatures = currentStepSignatures;

                    let forceBreak = false;
                    for (const toolCall of decision.tools) {
                        if (toolCall.name === 'send_telegram') {
                            const currentMessage = (toolCall.metadata?.message || '').trim();

                            // 1. Block exact duplicates across any step
                            if (currentMessage === lastMessageContent) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Exact duplicate).`);
                                continue;
                            }

                            // 2. SOCIAL COMMUNICATION LOCK: Step 2+ requires new "Deep Data"
                            if (currentStep > 1 && !deepToolExecuted) {
                                logger.warn(`Agent: Blocked non-essential communication in Step ${currentStep} (No Deep Data).`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-lock`,
                                    type: 'short',
                                    content: `[SYSTEM LOCK: You have already communicated in Step 1. You cannot speak again in Step 2+ without presenting NEW data from a deep skill (Search/Command/Web). Purely social redirected/reflections are forbidden. Terminate now.]`
                                });
                                continue;
                            }

                            lastMessageContent = currentMessage;
                        }

                        logger.info(`Executing skill: ${toolCall.name}`);
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
                        if (!nonDeepSkills.includes(toolCall.name) && !JSON.stringify(toolResult).toLowerCase().includes('error')) {
                            deepToolExecuted = true;
                        }

                        let observation = `Observation: Tool ${toolCall.name} returned: ${JSON.stringify(toolResult)}`;
                        if (toolCall.name === 'send_telegram') {
                            messagesSent++;
                            observation += `. [SYSTEM: Message Sent (#${messagesSent}). Content Hash: ${Buffer.from(lastMessageContent).slice(0, 10).toString('hex')}... If goal is reached, terminate now.]`;
                        }

                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-${toolCall.name}`,
                            type: 'short',
                            content: observation,
                            metadata: { tool: toolCall.name, result: toolResult }
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
            this.actionQueue.updateStatus(action.id, 'completed');
        } catch (error: any) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');

            // SOS Notification
            if (this.telegram && action.payload.source === 'telegram') {
                const sosMessage = `⚠️ *Action Failed*: I encountered a persistent error while processing your request: "${action.payload.description}"\n\n*Error*: ${error.message}\n\nI've logged this to my journal and will attempt to recover in the next turn.`;
                await this.telegram.sendMessage(action.payload.sourceId, sosMessage);
            }
        } finally {
            this.isBusy = false;

            // BACKGROUND TASK: Memory Consolidation
            // We do this in the background after the agent is marked as not busy
            // to prevent blocking the next task.
            this.memory.consolidate(this.llm).catch(e => {
                logger.error(`Background Memory Consolidation Error: ${e}`);
            });
        }
    }
}
