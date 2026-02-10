import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { renderMarkdown, hasMarkdown } from '../utils/MarkdownRenderer';
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
            const chatId = (ctx.chat?.id != null ? ctx.chat.id.toString() : userId);
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

                        const downloadsDir = path.join(this.agent.config.getDataHome(), 'downloads');
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

            // Auto-transcribe voice/audio messages so the agent can "hear" them
            let transcription = '';
            if (mediaPath && (message.voice || message.audio)) {
                try {
                    logger.info(`Telegram: Auto-transcribing audio from ${userName}...`);
                    const result = await this.agent.llm.analyzeMedia(mediaPath, 'Transcribe this audio message exactly. Return only the transcription text.');
                    // Strip "Transcription result:\n" prefix that Whisper path adds
                    transcription = result.replace(/^Transcription result:\n/i, '').trim();
                    if (transcription) {
                        logger.info(`Telegram: Transcribed voice from ${userName}: "${transcription.substring(0, 100)}..."`);
                    }
                } catch (e) {
                    logger.warn(`Telegram: Auto-transcription failed: ${e}`);
                }
            }

            // Auto-analyze images/video/documents so the agent sees media context immediately
            // instead of needing a separate analyze_media step (which causes split responses)
            let mediaAnalysis = '';
            if (mediaPath && !transcription && (photo || doc || video)) {
                try {
                    const mediaType = photo ? 'image' : video ? 'video' : 'document';
                    logger.info(`Telegram: Auto-analyzing ${mediaType} from ${userName}...`);
                    const prompt = text
                        ? `The user sent this ${mediaType} with the message: "${text}". Describe what you see in detail.`
                        : `Describe the content of this ${mediaType} in detail.`;
                    mediaAnalysis = await this.agent.llm.analyzeMedia(mediaPath, prompt);
                    if (mediaAnalysis) {
                        logger.info(`Telegram: Analyzed ${mediaType} from ${userName}: "${mediaAnalysis.substring(0, 100)}..."`);
                    }
                } catch (e) {
                    logger.warn(`Telegram: Auto media analysis failed: ${e}`);
                }
            }

            if (!text && !mediaPath) return;

            logger.info(`Telegram: Message from ${userName} (${userId}): ${text || transcription || '[Media]'} | autoReply=${autoReplyEnabled}`);

            // Build content with transcription / media analysis if available
            const voiceLabel = transcription ? ` [Voice message transcription: "${transcription}"]` : '';
            const mediaLabel = mediaAnalysis ? ` [Media analysis: ${mediaAnalysis}]` : '';
            const content = text 
                ? `User ${userName} (Telegram ${userId}) said: ${text}${voiceLabel}${mediaLabel}${replyContext ? ' ' + replyContext : ''}`
                : transcription
                    ? `User ${userName} (Telegram ${userId}) sent a voice message: "${transcription}"${replyContext ? ' ' + replyContext : ''}`
                    : mediaAnalysis
                        ? `User ${userName} (Telegram ${userId}) sent media: ${path.basename(mediaPath)} [Media analysis: ${mediaAnalysis}]${replyContext ? ' ' + replyContext : ''}`
                        : `User ${userName} (Telegram ${userId}) sent a file: ${path.basename(mediaPath)}${replyContext ? ' ' + replyContext : ''}`;

            // Store user message in memory
            this.agent.memory.saveMemory({
                id: `tg-${message.message_id}`,
                type: 'short',
                content: content,
                timestamp: new Date().toISOString(),
                metadata: { 
                    source: 'telegram', 
                    role: 'user',
                    messageId: message.message_id, 
                    chatId,
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

            // Push task to agent — include transcription/analysis in task so agent has full context
            const displayText = text || (transcription ? `[Voice: "${transcription}"]` : '[Media]');
            const mediaContext = mediaAnalysis ? ` [Media analysis: ${mediaAnalysis}]` : '';
            const taskDescription = replyContext
                ? `Telegram message from ${userName}: "${displayText}"${mediaContext} ${replyContext}${mediaPath ? ` (File stored at: ${mediaPath})` : ''}`
                : `Telegram message from ${userName}: "${displayText}"${mediaContext}${mediaPath ? ` (File stored at: ${mediaPath})` : ''}`;
            
            await this.agent.pushTask(
                taskDescription,
                10,
                {
                    source: 'telegram',
                    // Use chatId as sourceId so replies go to the same chat (DM or group).
                    sourceId: chatId,
                    senderName: userName,
                    chatId,
                    userId,
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
            // Convert markdown to Telegram HTML if the message contains formatting
            const useHtml = hasMarkdown(message);
            const formatted = useHtml ? renderMarkdown(message, 'telegram_html') : message;
            const sendOpts = useHtml ? { parse_mode: 'HTML' as const } : {};

            // Telegram has a 4096 character limit. We'll chunk the message into parts.
            const MAX_LENGTH = 4000;
            if (formatted.length <= MAX_LENGTH) {
                try {
                    await this.bot.telegram.sendMessage(to, formatted, sendOpts);
                } catch (parseErr: any) {
                    // If HTML parsing fails, fall back to plain text
                    if (useHtml && parseErr?.response?.description?.includes('parse')) {
                        logger.warn(`TelegramChannel: HTML parse failed, falling back to plain text`);
                        await this.bot.telegram.sendMessage(to, renderMarkdown(message, 'plain'));
                    } else {
                        throw parseErr;
                    }
                }
                logger.info(`TelegramChannel: Sent message to ${to}${useHtml ? ' (HTML)' : ''}`);
            } else {
                logger.warn(`TelegramChannel: Message too long (${formatted.length} chars). Chunking...`);
                // Split by length, but ideally we'd split by newlines if possible
                const chunks: string[] = [];
                let current = formatted;
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
                    const chunkText = `[Part ${i + 1}/${chunks.length}]\n${chunks[i]}`;
                    try {
                        await this.bot.telegram.sendMessage(to, chunkText, sendOpts);
                    } catch (parseErr: any) {
                        if (useHtml && parseErr?.response?.description?.includes('parse')) {
                            await this.bot.telegram.sendMessage(to, renderMarkdown(chunkText, 'plain'));
                        } else {
                            throw parseErr;
                        }
                    }
                    // Small delay to prevent rate limiting
                    await new Promise(r => setTimeout(r, 500));
                }
                logger.info(`TelegramChannel: Sent ${chunks.length} chunks to ${to}${useHtml ? ' (HTML)' : ''}`);
            }
        } catch (error) {
            logger.error(`TelegramChannel: Error sending message to ${to}: ${error}`);
            throw error;
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

            // Format captions with HTML if they contain markdown
            const useHtml = caption ? hasMarkdown(caption) : false;
            const formattedCaption = useHtml && caption ? renderMarkdown(caption, 'telegram_html') : caption;
            const captionOpts = useHtml ? { caption: formattedCaption, parse_mode: 'HTML' as const } : { caption: formattedCaption };

            if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
                await this.bot.telegram.sendPhoto(to, { source: filePath }, captionOpts);
            } else if (['mp4', 'mov'].includes(ext || '')) {
                await this.bot.telegram.sendVideo(to, { source: filePath }, captionOpts);
            } else if (['mp3', 'm4a', 'ogg'].includes(ext || '')) {
                await this.bot.telegram.sendAudio(to, { source: filePath }, captionOpts);
            } else {
                await this.bot.telegram.sendDocument(to, { source: filePath }, captionOpts);
            }

            logger.info(`TelegramChannel: Sent file ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`TelegramChannel: Error sending file: ${error}`);
            throw error;
        }
    }

    /**
     * Send a voice note to a Telegram chat.
     * Uses sendVoice API so it appears as a playable voice message bubble.
     */
    public async sendVoiceNote(to: string, filePath: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            await this.bot.telegram.sendVoice(to, { source: filePath });
            logger.info(`TelegramChannel: Sent voice note ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`TelegramChannel: Error sending voice note: ${error}`);
            throw error;
        }
    }

    /**
     * React to a message with an emoji.
     * Uses Telegram Bot API setMessageReaction (API 7.0+).
     */
    public async react(chatId: string, messageId: string, emoji: string): Promise<void> {
        try {
            // Normalize chatId — might be composite "chatId_msgId" or plain number
            let normalizedChatId: string | number = chatId;
            if (String(chatId).includes('_')) {
                // Composite format: take the FIRST part as chat_id
                normalizedChatId = String(chatId).split('_')[0];
                logger.warn(`TelegramChannel: Normalized chat_id from "${chatId}" to "${normalizedChatId}"`);
            }
            normalizedChatId = Number(normalizedChatId) || normalizedChatId;

            // Normalize messageId — might be composite "chatId_msgId" or plain number
            const rawId = String(messageId);
            let numericId: number;
            if (rawId.includes('_')) {
                // Composite format: take the LAST part as message_id
                const parts = rawId.split('_');
                numericId = parseInt(parts[parts.length - 1], 10);
                logger.warn(`TelegramChannel: Normalized message_id from "${rawId}" to "${numericId}"`);
            } else {
                numericId = parseInt(rawId, 10);
            }
            if (isNaN(numericId)) {
                throw new Error(`Invalid message_id format: ${rawId}`);
            }

            logger.debug(`TelegramChannel: react() chat_id=${normalizedChatId} message_id=${numericId} emoji=${emoji}`);
            await (this.bot.telegram as any).callApi('setMessageReaction', {
                chat_id: normalizedChatId,
                message_id: numericId,
                reaction: [{ type: 'emoji', emoji }],
                is_big: false
            });
            logger.info(`TelegramChannel: Reacted with ${emoji} to message ${numericId} in ${normalizedChatId}`);
        } catch (error) {
            logger.error(`TelegramChannel: Error reacting to message ${messageId} in chat ${chatId}: ${error}`);
            throw error;
        }
    }
}
