import { IChannel } from './IChannel';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { SocketModeClient } from '@slack/socket-mode';
import { LogLevel } from '@slack/logger';

/**
 * SlackChannel - lightweight Slack Web API integration.
 *
 * Requires a bot token (xoxb-...) with scopes:
 * - chat:write
 * - channels:read (optional for discovery)
 * - reactions:write (for react)
 * - files:write (for sendFile)
 */
export class SlackChannel implements IChannel {
    public readonly name = 'Slack';
    private readonly token: string;
    private readonly appToken?: string;
    private readonly agent: any;
    private isReady = false;
    private botUserId?: string;
    private botId?: string;
    private socketClient?: SocketModeClient;

    constructor(token: string, appToken: string | undefined, agent: any) {
        this.token = token;
        this.appToken = appToken;
        this.agent = agent;
    }

    public async start(): Promise<void> {
        const ok = await this.callSlack('auth.test', {});
        if (!ok?.ok) {
            throw new Error(`Slack auth failed: ${ok?.error || 'unknown_error'}`);
        }
        this.isReady = true;
        this.botUserId = ok.user_id;
        this.botId = ok.bot_id;
        logger.info(`Slack bot authenticated as ${ok.user || ok.user_id || 'unknown-user'}`);

        // Start Socket Mode if app token is provided
        if (this.appToken && !this.socketClient) {
            logger.info('Slack Socket Mode starting...');
            this.socketClient = new SocketModeClient({
                appToken: this.appToken,
                logLevel: LogLevel.ERROR
            });

            this.socketClient.on('events_api', async (event) => {
                try {
                    const eventType = event?.body?.event?.type || 'unknown';
                    const channelType = event?.body?.event?.channel_type || event?.body?.event?.channelType || 'unknown';
                    logger.info(`Slack Socket Mode event received: ${eventType} (${channelType})`);
                    await event.ack();
                    await this.handleEvent(event.body);
                } catch (e: any) {
                    logger.warn(`Slack Socket Mode event handling error: ${e?.message || e}`);
                }
            });

            this.socketClient.on('error', (error) => {
                logger.warn(`Slack Socket Mode error: ${error}`);
            });

            await this.socketClient.start();
            logger.info('Slack Socket Mode connected');
        } else if (!this.appToken) {
            logger.warn('Slack Socket Mode disabled: slackAppToken not set. Inbound messages will only arrive via Events API webhook.');
        }
    }

    public async stop(): Promise<void> {
        this.isReady = false;
        if (this.socketClient) {
            try {
                await this.socketClient.disconnect();
            } catch {
                // ignore
            }
            this.socketClient = undefined;
        }
    }

    public async sendMessage(to: string, message: string): Promise<void> {
        const payload = { channel: to, text: String(message ?? '') };
        const res = await this.callSlack('chat.postMessage', payload);
        if (!res?.ok) throw new Error(`Slack send failed: ${res?.error || 'unknown_error'}`);
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

        // Legacy API remains broadly compatible for bot uploads.
        const form = new FormData();
        form.append('channels', to);
        if (caption) form.append('initial_comment', caption);
        form.append('filename', path.basename(filePath));
        form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

        const response = await fetch('https://slack.com/api/files.upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}` },
            body: form
        });

        const data: any = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
            throw new Error(`Slack file upload failed: ${data?.error || response.statusText || 'unknown_error'}`);
        }
    }

    public async sendTypingIndicator(to: string): Promise<void> {
        try {
            await this.callSlack('conversations.typing', { channel: to });
        } catch {
            // best effort
        }
    }

    public async react(chatId: string, messageId: string, emoji: string): Promise<void> {
        const name = this.normalizeEmoji(emoji);
        const res = await this.callSlack('reactions.add', { channel: chatId, timestamp: messageId, name });
        if (!res?.ok) throw new Error(`Slack reaction failed: ${res?.error || 'unknown_error'}`);
    }

    /**
     * Handle inbound Slack Events API payloads.
     * This is called by the GatewayServer when Slack posts events to /slack/events.
     */
    public async handleEvent(payload: any): Promise<void> {
        const event = payload?.event;
        if (!event) {
            logger.debug('Slack: handleEvent called without event payload');
            return;
        }

        const type = event.type;
        const subtype = event.subtype;

        // Ignore bot/system events and edits/deletes
        if (event.bot_id || subtype === 'bot_message' || subtype === 'message_changed' || subtype === 'message_deleted') {
            logger.debug(`Slack: Ignoring bot/system event (${type}/${subtype || 'none'})`);
            return;
        }

        const userId = event.user || event.message?.user;
        if (!userId) {
            logger.debug('Slack: Ignoring event without user id');
            return;
        }
        if (this.botUserId && userId === this.botUserId) {
            logger.debug('Slack: Ignoring self message');
            return;
        }

        const channelId = event.channel;
        const channelType = event.channel_type || event.channelType;
        let text = event.text || event.message?.text || '';

        // Determine if this message should trigger a response
        const isDirect = channelType === 'im' || channelType === 'mpim';
        const isMention = type === 'app_mention' || (this.botUserId && text.includes(`<@${this.botUserId}>`));
        if (!isDirect && !isMention) {
            logger.debug(`Slack: Ignoring non-mention channel message (${channelType || 'unknown'})`);
            return; // Ignore non-mention channel chatter
        }

        // Remove mention token for cleaner text
        if (this.botUserId && text) {
            const mentionPattern = new RegExp(`<@${this.botUserId}>`, 'g');
            text = text.replace(mentionPattern, '').trim();
        }

        const messageId = event.ts || event.message?.ts;
        const threadTs = event.thread_ts || event.message?.thread_ts;
        const autoReplyEnabled = this.agent.config.get('slackAutoReplyEnabled');
        const sessionScopeId = this.agent.resolveSessionScopeId('slack', {
            sourceId: channelId,
            userId
        });

        const content = text
            ? `Slack message from ${userId}: ${text}`
            : `Slack message from ${userId} (no text)`;

        // Store in memory
        this.agent.memory.saveMemory({
            id: `slack-${messageId || Date.now()}`,
            type: 'short',
            content,
            timestamp: new Date().toISOString(),
            metadata: {
                source: 'slack',
                role: 'user',
                sessionScopeId,
                channelId,
                userId,
                messageId,
                threadTs,
                channelType,
                isMention
            }
        });

        if (!autoReplyEnabled) {
            logger.debug('Slack: Auto-reply disabled, skipping task creation.');
            return;
        }

        const displayText = text || '[No text]';
        const taskDescription = isMention
            ? `Respond to Slack mention from ${userId} in channel ${channelId}: "${displayText}"`
            : `Respond to Slack DM from ${userId}: "${displayText}"`;

        await this.agent.pushTask(
            taskDescription,
            10,
            {
                source: 'slack',
                sourceId: channelId,
                sessionScopeId,
                senderName: userId,
                channelId,
                userId,
                messageId,
                threadTs,
                requiresResponse: true
            }
        );
    }

    private async callSlack(endpoint: string, body: Record<string, any>): Promise<any> {
        const response = await fetch(`https://slack.com/api/${endpoint}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Slack API ${endpoint} failed: HTTP ${response.status}`);
        }

        const data = await response.json().catch(() => ({}));
        if (!data?.ok) {
            logger.warn(`Slack API error (${endpoint}): ${data?.error || 'unknown_error'}`);
        }
        return data;
    }

    private normalizeEmoji(input: string): string {
        const trimmed = String(input || '').trim();
        // Slack expects short names like "+1" or "rocket".
        if (/^[a-z0-9_+\-]+$/i.test(trimmed)) {
            return trimmed.replace(/^:+|:+$/g, '');
        }

        const fallbackMap: Record<string, string> = {
            '👍': '+1',
            '❤️': 'heart',
            '🔥': 'fire',
            '🎉': 'tada',
            '😂': 'joy',
            '✅': 'white_check_mark',
            '❌': 'x',
            '🚀': 'rocket',
            '👀': 'eyes'
        };

        return fallbackMap[trimmed] || '+1';
    }
}
