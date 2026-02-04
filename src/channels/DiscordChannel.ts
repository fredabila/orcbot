import { Client, GatewayIntentBits, Message, Partials, AttachmentBuilder, TextBasedChannel } from 'discord.js';
import { IChannel } from './IChannel';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

/**
 * DiscordChannel - Discord bot integration for OrcBot
 * 
 * Implements the IChannel interface to provide Discord connectivity.
 * Uses discord.js library for bot operations.
 */
export class DiscordChannel implements IChannel {
    public readonly name: string = 'Discord';
    private client: Client;
    private agent: any;
    private token: string;
    private autoReplyEnabled: boolean;
    private isReady: boolean = false;
    private downloadPath: string;

    constructor(token: string, agent: any) {
        this.token = token;
        this.agent = agent;
        this.autoReplyEnabled = this.agent.config.get('discordAutoReplyEnabled') ?? false;
        
        // Set up download directory
        const dataDir = path.dirname(this.agent.config.get('memoryPath'));
        this.downloadPath = path.join(dataDir, 'downloads');
        if (!fs.existsSync(this.downloadPath)) {
            fs.mkdirSync(this.downloadPath, { recursive: true });
        }

        // Initialize Discord client with necessary intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildMembers,
            ],
            partials: [Partials.Channel, Partials.Message]
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.once('ready', () => {
            this.isReady = true;
            logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
        });

        this.client.on('messageCreate', async (message: Message) => {
            await this.handleIncomingMessage(message);
        });

        this.client.on('error', (error) => {
            logger.error(`Discord client error: ${error.message}`);
        });
    }

    private isSendableChannel(channel: TextBasedChannel): channel is TextBasedChannel & {
        send: (...args: any[]) => Promise<any>;
        sendTyping: () => Promise<any>;
    } {
        return typeof (channel as any).send === 'function' && typeof (channel as any).sendTyping === 'function';
    }

    private async handleIncomingMessage(message: Message): Promise<void> {
        // Ignore bot's own messages
        if (message.author.bot) return;

        const channelId = message.channelId;
        const userId = message.author.id;
        const username = message.author.username;
        const content = message.content;
        const messageId = message.id;
        const guildId = message.guildId;
        const channelName = message.channel.isDMBased()
            ? 'DM'
            : ('name' in message.channel ? message.channel.name : 'Unknown');

        // Extract reply context if this message is a reply to another message
        let replyContext = '';
        let replyToMessageId: string | undefined;
        if (message.reference?.messageId) {
            replyToMessageId = message.reference.messageId;
            try {
                const repliedMessage = await message.fetchReference();
                const repliedText = repliedMessage.content || '[Media/Embed]';
                const repliedUser = repliedMessage.author?.username || 'Unknown';
                replyContext = `[Replying to ${repliedUser}'s message: "${repliedText.substring(0, 200)}${repliedText.length > 200 ? '...' : ''}"]`;
            } catch (e) {
                // Could not fetch the referenced message, just note the reference exists
                replyContext = `[Replying to message ID: ${replyToMessageId}]`;
            }
        }

        logger.info(`Discord message from ${username} (${userId}) in ${channelName}: ${content.substring(0, 100)}${replyContext ? ' ' + replyContext : ''}`);

        // Save message to memory with metadata (using proper MemoryEntry format)
        this.agent.memory.saveMemory({
            id: `discord-${messageId}`,
            type: 'short',
            content: `Discord message from ${username}: ${content}${replyContext ? ' ' + replyContext : ''}`,
            timestamp: new Date().toISOString(),
            metadata: {
                source: 'discord',
                channelId,
                userId,
                username,
                messageId,
                guildId,
                channelName,
                replyToMessageId,
                replyContext: replyContext || undefined
            }
        });

        // Handle attachments
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                const fileName = attachment.name || 'attachment';
                const fileUrl = attachment.url;
                
                logger.info(`Discord attachment: ${fileName} from ${username}`);
                
                this.agent.memory.saveMemory({
                    id: `discord-attach-${messageId}-${fileName}`,
                    type: 'short',
                    content: `Discord attachment from ${username}: ${fileName} (${fileUrl})`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        source: 'discord',
                        attachmentType: 'attachment',
                        channelId,
                        userId,
                        username,
                        fileName,
                        fileUrl,
                        messageId
                    }
                });
            }
        }

        // Auto-reply if enabled
        if (this.autoReplyEnabled) {
            // Send typing indicator immediately for user feedback
            try {
                await this.sendTypingIndicator(channelId);
            } catch (e) {
                // Ignore typing indicator errors
            }

            const priority = 10; // High priority for user messages (same as Telegram)
            const taskDescription = replyContext
                ? `Respond to Discord message from ${username} in ${channelName}: "${content}" ${replyContext}`
                : `Respond to Discord message from ${username} in ${channelName}: "${content}"`;
            
            await this.agent.pushTask(
                taskDescription,
                priority,
                {
                    source: 'discord',
                    sourceId: channelId,  // Use channelId as sourceId (where to reply)
                    senderName: username,  // Use username as senderName for DecisionEngine
                    channelId,
                    userId,
                    username,
                    messageId,
                    replyToMessageId,
                    replyContext: replyContext || undefined,
                    requiresResponse: true
                }
            );
        }
    }

    public async start(): Promise<void> {
        try {
            await this.client.login(this.token);
            logger.info('Discord channel started successfully');
        } catch (error: any) {
            logger.error(`Failed to start Discord channel: ${error.message}`);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        this.isReady = false;
        this.client.destroy();
        logger.info('Discord channel stopped');
    }

    public async sendMessage(to: string, message: string): Promise<void> {
        if (!this.isReady) {
            throw new Error('Discord client is not ready');
        }

        try {
            // 'to' should be a channel ID
            const channel = await this.client.channels.fetch(to);

            if (!channel || !channel.isTextBased()) {
                throw new Error(`Channel ${to} not found or not text-based`);
            }

            const textChannel = channel as TextBasedChannel;
            if (!this.isSendableChannel(textChannel)) {
                throw new Error(`Channel ${to} does not support sending messages`);
            }

            // Discord has a 2000 character limit, split if necessary
            const maxLength = 2000;
            if (message.length <= maxLength) {
                await textChannel.send(message);
            } else {
                // Split into chunks
                const chunks = this.splitMessage(message, maxLength);
                for (const chunk of chunks) {
                    await textChannel.send(chunk);
                    // Small delay to avoid rate limiting
                    await this.delay(500);
                }
            }

            logger.info(`Discord message sent to channel ${to}`);
        } catch (error: any) {
            logger.error(`Failed to send Discord message: ${error.message}`);
            throw error;
        }
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        if (!this.isReady) {
            throw new Error('Discord client is not ready');
        }

        try {
            const channel = await this.client.channels.fetch(to);

            if (!channel || !channel.isTextBased()) {
                throw new Error(`Channel ${to} not found or not text-based`);
            }

            const textChannel = channel as TextBasedChannel;
            if (!this.isSendableChannel(textChannel)) {
                throw new Error(`Channel ${to} does not support sending messages`);
            }

            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const attachment = new AttachmentBuilder(filePath);
            
            await textChannel.send({
                content: caption || undefined,
                files: [attachment]
            });

            logger.info(`Discord file sent to channel ${to}: ${filePath}`);
        } catch (error: any) {
            logger.error(`Failed to send Discord file: ${error.message}`);
            throw error;
        }
    }

    public async sendTypingIndicator(to: string): Promise<void> {
        if (!this.isReady) {
            return;
        }

        try {
            const channel = await this.client.channels.fetch(to);

            if (channel && channel.isTextBased()) {
                const textChannel = channel as TextBasedChannel;
                if (this.isSendableChannel(textChannel)) {
                    await textChannel.sendTyping();
                }
            }
        } catch (error: any) {
            logger.error(`Failed to send Discord typing indicator: ${error.message}`);
        }
    }

    /**
     * Get list of guilds (servers) the bot is in
     */
    public async getGuilds(): Promise<Array<{ id: string; name: string }>> {
        if (!this.isReady) {
            return [];
        }

        return Array.from(this.client.guilds.cache.values()).map(guild => ({
            id: guild.id,
            name: guild.name
        }));
    }

    /**
     * Get list of text channels in a guild
     */
    public async getTextChannels(guildId: string): Promise<Array<{ id: string; name: string }>> {
        if (!this.isReady) {
            return [];
        }

        try {
            const guild = await this.client.guilds.fetch(guildId);
            const channels = await guild.channels.fetch();
            
            return Array.from(channels.values())
                .filter((channel): channel is NonNullable<typeof channel> => channel !== null && channel.isTextBased())
                .map(channel => ({
                    id: channel.id,
                    name: channel.name
                }));
        } catch (error: any) {
            logger.error(`Failed to get Discord channels: ${error.message}`);
            return [];
        }
    }

    private splitMessage(message: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let remaining = message;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            // Try to split at a newline or space near the limit
            let splitIndex = maxLength;
            const lastNewline = remaining.lastIndexOf('\n', maxLength);
            const lastSpace = remaining.lastIndexOf(' ', maxLength);

            if (lastNewline > maxLength * 0.8) {
                splitIndex = lastNewline;
            } else if (lastSpace > maxLength * 0.8) {
                splitIndex = lastSpace;
            }

            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        return chunks;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
