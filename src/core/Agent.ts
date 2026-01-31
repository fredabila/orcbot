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
        this.skills = new SkillsManager(this.config.get('skillsPath') || './SKILLS.md');
        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            this.config.get('journalPath'),
            this.config.get('learningPath')
        );
        this.actionQueue = new ActionQueue(this.config.get('actionQueuePath') || './actions.json');
        this.scheduler = new Scheduler();
        this.browser = new WebBrowser();
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
                if (key === 'agentIdentity') defaultContent = '# .AI.md\nName: Alice\nPersonality: proactive, concise, professional\nAutonomyLevel: high\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n';
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
                    exec(command, (error: any, stdout: string, stderr: string) => {
                        if (error) resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                        resolve(stdout || stderr || "Command executed successfully (no output)");
                    });
                });
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
            description: 'Navigate to a URL and get text content',
            usage: 'browser_navigate(url)',
            handler: async (args: any) => {
                const url = args.url || args.link || args.site;
                if (!url) return 'Error: Missing url.';
                return this.browser.navigate(url);
            }
        });

        // Skill: Web Search
        this.skills.registerSkill({
            name: 'web_search',
            description: 'Search the web for information',
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
            description: 'Update your own identity/personality',
            usage: 'update_agent_identity(trait)',
            handler: async (args: any) => {
                const trait = args.trait || args.info || args.text;
                if (!trait) return 'Error: Missing trait.';

                const identityPath = this.config.get('agentIdentityPath');
                try {
                    fs.appendFileSync(identityPath, `\n- Learned Trait: ${trait}`);
                    this.loadAgentIdentity();
                    return `Successfully updated agent identity at ${identityPath} with: "${trait}"`;
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
    }

    private loadAgentIdentity() {
        if (fs.existsSync(this.agentConfigFile)) {
            this.agentIdentity = fs.readFileSync(this.agentConfigFile, 'utf-8');
            logger.info(`Agent identity loaded from ${this.agentConfigFile}`);
        } else {
            this.agentIdentity = "Your name is OrcBot. You are a professional autonomous agent.";
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

            const MAX_STEPS = 10;
            let currentStep = 0;
            let messagesSent = 0;
            let lastStepToolSignatures = '';

            while (currentStep < MAX_STEPS) {
                currentStep++;
                logger.info(`Agent: Step ${currentStep} for action ${action.id}`);

                if (this.telegram && action.payload.source === 'telegram') {
                    await this.telegram.sendTypingIndicator(action.payload.sourceId);
                }

                const decision = await this.decisionEngine.decide({
                    ...action,
                    payload: {
                        ...action.payload,
                        messagesSent,
                        messagingLocked: messagesSent > 0,
                        currentStep
                    }
                });
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

                    let lastMessageContent = '';
                    let forceBreak = false;
                    for (const toolCall of decision.tools) {
                        if (toolCall.name === 'send_telegram') {
                            const currentMessage = toolCall.metadata?.message || '';
                            if (currentMessage === lastMessageContent) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id}.`);
                                continue;
                            }
                            lastMessageContent = currentMessage;
                        }

                        logger.info(`Executing skill: ${toolCall.name}`);
                        const toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});

                        let observation = `Observation: Tool ${toolCall.name} returned: ${JSON.stringify(toolResult)}`;
                        if (toolCall.name === 'send_telegram') {
                            messagesSent++;
                            observation += `. [SYSTEM: Message Sent (#${messagesSent}). Content: "${toolCall.metadata?.message}". If this satisfies the user, terminate NOW.]`;
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
            await this.memory.consolidate(this.llm);
        } catch (error) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');
        } finally {
            this.isBusy = false;
        }
    }
}
