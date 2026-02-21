import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../utils/logger';

interface UsagePingPayload {
    installId: string;
    event: 'startup';
    timestamp: string;
    app: string;
    version: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    provider: string;
    channels: string[];
    safeMode: boolean;
    hasApiKeys: string[];
}

export class UsagePing {
    private readonly installIdPath: string;
    private warnedMissingEndpoint = false;

    constructor(private config: ConfigManager) {
        this.installIdPath = path.join(this.config.getDataHome(), 'install-id');
    }

    public async sendStartupPing(): Promise<void> {
        const enabled = this.config.get('usagePingEnabled') !== false;
        const targetUrl = this.resolveTargetUrl();

        if (!enabled) return;
        if (!targetUrl) {
            if (!this.warnedMissingEndpoint) {
                logger.warn('UsagePing: enabled but no usagePingUrl configured. Set usagePingUrl (or ORCBOT_USAGE_PING_URL) to your own endpoint.');
                this.warnedMissingEndpoint = true;
            }
            return;
        }

        const timeoutMs = Number(this.config.get('usagePingTimeoutMs') || 4000);
        const payload = this.buildPayload();
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        const token = (this.config.get('usagePingToken') || process.env.ORCBOT_USAGE_PING_TOKEN || '').trim();
        if (token) {
            headers.authorization = `Bearer ${token}`;
            headers['x-orcbot-usage-token'] = token;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            await fetch(targetUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            logger.debug(`UsagePing: startup ping skipped/failed: ${error}`);
        } finally {
            clearTimeout(timeout);
        }
    }

    private resolveTargetUrl(): string {
        return (this.config.get('usagePingUrl') || process.env.ORCBOT_USAGE_PING_URL || '').trim();
    }

    private buildPayload(): UsagePingPayload {
        return {
            installId: this.getOrCreateInstallId(),
            event: 'startup',
            timestamp: new Date().toISOString(),
            app: 'orcbot',
            version: this.getPackageVersion(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            provider: this.config.get('llmProvider') || 'unknown',
            channels: this.getEnabledChannels(),
            safeMode: !!this.config.get('safeMode'),
            hasApiKeys: this.getPresentApiKeys()
        };
    }

    private getEnabledChannels(): string[] {
        const channels: string[] = [];
        if (this.config.get('telegramToken')) channels.push('telegram');
        if (this.config.get('whatsappEnabled')) channels.push('whatsapp');
        if (this.config.get('discordToken')) channels.push('discord');
        if (this.config.get('slackBotToken')) channels.push('slack');
        return channels;
    }

    private getPresentApiKeys(): string[] {
        const keyMap: Array<[string, unknown]> = [
            ['openai', this.config.get('openaiApiKey')],
            ['openrouter', this.config.get('openrouterApiKey')],
            ['google', this.config.get('googleApiKey')],
            ['anthropic', this.config.get('anthropicApiKey')],
            ['nvidia', this.config.get('nvidiaApiKey')],
            ['bedrock', this.config.get('bedrockAccessKeyId')],
            ['serper', this.config.get('serperApiKey')],
        ];
        return keyMap.filter(([, value]) => !!value).map(([name]) => name);
    }

    private getOrCreateInstallId(): string {
        try {
            if (fs.existsSync(this.installIdPath)) {
                const existing = fs.readFileSync(this.installIdPath, 'utf-8').trim();
                if (existing) return existing;
            }
            const generated = crypto.randomUUID();
            fs.writeFileSync(this.installIdPath, generated, 'utf-8');
            return generated;
        } catch (error) {
            logger.debug(`UsagePing: install id persistence failed, using ephemeral id: ${error}`);
            return crypto.randomUUID();
        }
    }

    private getPackageVersion(): string {
        try {
            const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
            const raw = fs.readFileSync(packageJsonPath, 'utf-8');
            const parsed = JSON.parse(raw);
            return parsed.version || 'unknown';
        } catch {
            return 'unknown';
        }
    }
}
