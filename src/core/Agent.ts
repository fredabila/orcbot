import { MemoryManager, MemoryEntry } from './MemoryManager';
import { MultiLLM } from './MultiLLM';
import { SkillsManager } from './SkillsManager';
import { DecisionEngine } from './DecisionEngine';
import { ActionQueue, Action } from './ActionQueue';
import { Scheduler } from './Scheduler';
import { ConfigManager } from './ConfigManager';
import { TelegramChannel } from './TelegramChannel';
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
    private lastActionTime: number;

    constructor(private agentConfigFile: string = '.AI.md') {
        this.config = new ConfigManager();
        this.memory = new MemoryManager();
        this.llm = new MultiLLM({
            apiKey: this.config.get('openaiApiKey'),
            googleApiKey: this.config.get('googleApiKey'),
            modelName: this.config.get('modelName')
        });
        this.skills = new SkillsManager();
        this.decisionEngine = new DecisionEngine(this.memory, this.llm, this.skills);
        this.actionQueue = new ActionQueue();
        this.scheduler = new Scheduler();
        this.lastActionTime = Date.now();

        this.loadAgentIdentity();
        this.setupEventListeners();
        this.setupChannels();
        this.registerInternalSkills();
    }

    private setupChannels() {
        const telegramToken = this.config.get('telegramToken');
        if (telegramToken) {
            this.telegram = new TelegramChannel(telegramToken, this);
            logger.info('Agent: Telegram channel configured');
        }
    }

    private registerInternalSkills() {
        // Register skill to send telegram messages
        this.skills.registerSkill({
            name: 'send_telegram',
            description: 'Send a message to a Telegram user',
            usage: 'send_telegram(chat_id, message)',
            handler: async ({ chat_id, message }: { chat_id: string, message: string }) => {
                if (this.telegram) {
                    await this.telegram.sendMessage(chat_id, message);
                    return `Message sent to ${chat_id}`;
                }
                return 'Telegram channel not available';
            }
        });
    }

    private loadAgentIdentity() {
        if (fs.existsSync(this.agentConfigFile)) {
            const content = fs.readFileSync(this.agentConfigFile, 'utf-8');
            logger.info(`Agent identity loaded from ${this.agentConfigFile}`);
        } else {
            logger.warn(`${this.agentConfigFile} not found. Using default identity.`);
        }
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
            logger.info('Agent: Heartbeat trigger - Agent is idle. Initiating self-reflection.');
            this.pushTask('System Heartbeat: Review recent events and memory. Decide if any proactive action is needed. If none, just log "All good".', 2);
            this.lastActionTime = Date.now(); // Reset to avoid spamming
        }
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
        logger.info('Agent stopped.');
    }

    public async pushTask(description: string, priority: number = 5) {
        const action: Action = {
            id: Math.random().toString(36).substring(7),
            type: 'TASK',
            payload: { description },
            priority,
            status: 'pending',
            timestamp: new Date().toISOString(),
        };
        this.actionQueue.push(action);
    }

    private async processNextAction() {
        const action = this.actionQueue.getNext();
        if (!action) return;

        this.lastActionTime = Date.now(); // Update activity timestamp
        this.actionQueue.updateStatus(action.id, 'in-progress');

        try {
            const decision = await this.decisionEngine.decide(action.payload.description);
            logger.info(`Decision made: ${decision.action} - ${decision.reasoning}`);

            if (decision.tool) {
                const toolResult = await this.skills.executeSkill(decision.tool, decision.metadata || {});
                logger.info(`Tool ${decision.tool} result: ${JSON.stringify(toolResult)}`);
            }

            this.memory.saveMemory({
                id: action.id,
                type: 'short',
                content: `Executed task: ${action.payload.description}. Result: ${decision.content}`,
                metadata: { decision }
            });

            this.actionQueue.updateStatus(action.id, 'completed');
        } catch (error) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');
        }
    }
}
