import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { Agent } from '../core/Agent';
import { eventBus } from '../core/EventBus';

import { IChannel } from './IChannel';

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

        this.bot.on(['text', 'photo', 'document', 'audio', 'voice', 'video'], async (ctx) => {
            const message = ctx.message as any;
            const userId = ctx.from.id.toString();
            const userName = ctx.from.first_name;
            const autoReplyEnabled = this.agent.config.get('telegramAutoReplyEnabled');

            let text = message.text || message.caption || '';

            // Extract reply context if this message is a reply to another message
            let replyContext = '';
            let replyToMessageId: number | undefined;
            if (message.reply_to_message) {
                const replied = message.reply_to_message;
                replyToMessageId = replied.message_id;
                const repliedText = replied.text || replied.caption || '[Media/Sticker]';
                const repliedUser = replied.from?.first_name || 'Unknown';
                replyContext = `[Replying to ${repliedUser}'s message: "${repliedText.substring(0, 200)}${repliedText.length > 200 ? '...' : ''}"]`;
            }
            let mediaPath = '';

            // Handle Media
            const photo = message.photo;
            const doc = message.document;
            const audio = message.audio || message.voice;
            const video = message.video;

            if (photo || doc || audio || video) {
                try {
                    const fileId = photo ? photo[photo.length - 1].file_id :
                        doc ? doc.file_id :
                            audio ? audio.file_id :
                                video ? video.file_id : '';

                    if (fileId) {
                        const fileLink = await this.bot.telegram.getFileLink(fileId);
                        const response = await fetch(fileLink.href);
                        const buffer = await response.arrayBuffer();

                        const downloadsDir = path.join(os.homedir(), '.orcbot', 'downloads');
                        if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                        const ext = photo ? 'jpg' : doc ? (doc.file_name?.split('.').pop() || 'bin') : audio ? 'ogg' : video ? 'mp4' : 'bin';
                        mediaPath = path.join(downloadsDir, `tg_${message.message_id}.${ext}`);
                        fs.writeFileSync(mediaPath, Buffer.from(buffer));
                        logger.info(`Telegram Media saved: ${mediaPath}`);
                    }
                } catch (e) {
                    logger.error(`Failed to download Telegram media: ${e}`);
                }
            }

            if (!text && !mediaPath) return;

            logger.info(`Telegram: Message from ${userName} (${userId}): ${text || '[Media]'} | autoReply=${autoReplyEnabled}`);

            const content = text 
                ? `User ${userName} (Telegram ${userId}) said: ${text}${replyContext ? ' ' + replyContext : ''}`
                : `User ${userName} (Telegram ${userId}) sent a file: ${path.basename(mediaPath)}${replyContext ? ' ' + replyContext : ''}`;

            // Store user message in memory
            this.agent.memory.saveMemory({
                id: `tg-${message.message_id}`,
                type: 'short',
                content: content,
                timestamp: new Date().toISOString(),
                metadata: { 
                    source: 'telegram', 
                    messageId: message.message_id, 
                    userId, 
                    userName, 
                    mediaPath,
                    replyToMessageId,
                    replyContext: replyContext || undefined
                }
            });

            if (!autoReplyEnabled) {
                logger.debug(`Telegram: Auto-reply disabled, skipping task creation.`);
                return;
            }

            // Push task to agent
            const taskDescription = replyContext
                ? `Telegram message from ${userName}: "${text || '[Media]'}" ${replyContext}${mediaPath ? ` (File stored at: ${mediaPath})` : ''}`
                : `Telegram message from ${userName}: "${text || '[Media]'}"${mediaPath ? ` (File stored at: ${mediaPath})` : ''}`;
            
            await this.agent.pushTask(
                taskDescription,
                10,
                {
                    source: 'telegram',
                    sourceId: userId,
                    senderName: userName,
                    messageId: message.message_id,  // For deduplication
                    mediaPath,
                    replyToMessageId,
                    replyContext: replyContext || undefined
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
            // Telegram has a 4096 character limit. We'll chunk the message into parts.
            const MAX_LENGTH = 4000;
            if (message.length <= MAX_LENGTH) {
                await this.bot.telegram.sendMessage(to, message);
                logger.info(`TelegramChannel: Sent message to ${to}`);
            } else {
                logger.warn(`TelegramChannel: Message too long (${message.length} chars). Chunking...`);
                // Split by length, but ideally we'd split by newlines if possible
                const chunks: string[] = [];
                let current = message;
                while (current.length > 0) {
                    if (current.length <= MAX_LENGTH) {
                        chunks.push(current);
                        break;
                    }
                    // Try to find a good breaking point (newline)
                    let breakPoint = current.lastIndexOf('\n', MAX_LENGTH);
                    if (breakPoint === -1 || breakPoint < MAX_LENGTH * 0.8) {
                        breakPoint = MAX_LENGTH;
                    }

                    chunks.push(current.substring(0, breakPoint));
                    current = current.substring(breakPoint).trim();
                }

                for (let i = 0; i < chunks.length; i++) {
                    await this.bot.telegram.sendMessage(to, `[Part ${i + 1}/${chunks.length}]\n${chunks[i]}`);
                    // Small delay to prevent rate limiting
                    await new Promise(r => setTimeout(r, 500));
                }
                logger.info(`TelegramChannel: Sent ${chunks.length} chunks to ${to}`);
            }
        } catch (error) {
            logger.error(`TelegramChannel: Error sending message to ${to}: ${error}`);
        }
    }

    public async sendTypingIndicator(to: string): Promise<void> {
        try {
            await this.bot.telegram.sendChatAction(to, 'typing');
        } catch (error) {
            // Ignore errors for typing indicators as they are non-critical
        }
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const ext = filePath.split('.').pop()?.toLowerCase();

            if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
                await this.bot.telegram.sendPhoto(to, { source: filePath }, { caption });
            } else if (['mp4', 'mov'].includes(ext || '')) {
                await this.bot.telegram.sendVideo(to, { source: filePath }, { caption });
            } else if (['mp3', 'm4a', 'ogg'].includes(ext || '')) {
                await this.bot.telegram.sendAudio(to, { source: filePath }, { caption });
            } else {
                await this.bot.telegram.sendDocument(to, { source: filePath }, { caption });
            }

            logger.info(`TelegramChannel: Sent file ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`TelegramChannel: Error sending file: ${error}`);
            throw error;
        }
    }
}
