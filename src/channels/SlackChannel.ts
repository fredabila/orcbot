import { IChannel } from './IChannel';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

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
    private readonly agent: any;
    private isReady = false;

    constructor(token: string, agent: any) {
        this.token = token;
        this.agent = agent;
    }

    public async start(): Promise<void> {
        const ok = await this.callSlack('auth.test', {});
        if (!ok?.ok) {
            throw new Error(`Slack auth failed: ${ok?.error || 'unknown_error'}`);
        }
        this.isReady = true;
        logger.info(`Slack bot authenticated as ${ok.user || ok.user_id || 'unknown-user'}`);
    }

    public async stop(): Promise<void> {
        this.isReady = false;
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
