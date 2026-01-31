import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
import { Agent } from './Agent';
import { eventBus } from './EventBus';

export interface IChannel {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendMessage(to: string, message: string): Promise<void>;
}

export class TelegramChannel implements IChannel {
    public name = 'telegram';
    private bot: Telegraf;
    private agent: Agent;

    constructor(token: string, agent: Agent) {
        this.bot = new Telegraf(token);
        this.agent = agent;
        this.setupListeners();
    }

    private setupListeners() {
        this.bot.start((ctx) => {
            ctx.reply(`Welcome! I am ${this.agent.config.get('agentName')}. How can I assist you today?`);
            logger.info(`Telegram: User ${ctx.message.from.id} started the bot`);
        });

        this.bot.command('status', (ctx) => {
            const memoryCount = this.agent.memory.searchMemory('short').length;
            const queueCount = this.agent.actionQueue.getQueue().length;
            ctx.reply(`Status:\n- Short-term Memories: ${memoryCount}\n- Pending Actions: ${queueCount}`);
        });

        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text;
            const userId = ctx.message.from.id.toString();
            const userName = ctx.message.from.first_name;

            logger.info(`Telegram: Message from ${userName} (${userId}): ${text}`);

            // Store user message in memory
            this.agent.memory.saveMemory({
                id: Math.random().toString(36).substring(7),
                type: 'short',
                content: `User ${userName} (Telegram ${userId}) said: ${text}`,
                timestamp: new Date().toISOString()
            });

            // Push task to agent
            await this.agent.pushTask(
                `Telegram message from ${userName}: "${text}"`,
                10,
                {
                    source: 'telegram',
                    sourceId: userId,
                    senderName: userName
                }
            );

            // We could wait for a response event here, but for now we'll rely on the agent to act
            // and maybe implementing a "SendMessage" skill would be better.
            // But for interactive chat, we might want a direct response loop.
            // For this MVP, let's just acknowledge receipt if needed, or better yet,
            // let the Agent's decision engine decide to call a "send_telegram" skill.
        });
    }

    public async start(): Promise<void> {
        logger.info('TelegramChannel: Starting bot...');
        try {
            await this.bot.launch(() => {
                logger.info('TelegramChannel: Bot started successfully');
            });

            // Enable graceful stop
            process.once('SIGINT', () => this.bot.stop('SIGINT'));
            process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
        } catch (error) {
            logger.error(`TelegramChannel: Failed to start bot: ${error}`);
        }
    }

    public async stop(): Promise<void> {
        this.bot.stop();
        logger.info('TelegramChannel: Bot stopped');
    }

    public async sendMessage(to: string, message: string): Promise<void> {
        try {
            await this.bot.telegram.sendMessage(to, message);
            logger.info(`TelegramChannel: Sent message to ${to}`);
        } catch (error) {
            logger.error(`TelegramChannel: Error sending message to ${to}: ${error}`);
        }
    }
}
