import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/ConfigManager';

interface GoogleIdentityState {
    email?: string;
    refreshToken?: string; // encrypted when encryption key is available
    encrypted?: boolean;
    scope?: string;
    tokenType?: string;
    updatedAt?: string;
}

interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
    refresh_token?: string;
}

export interface GoogleIdentityStatus {
    configured: boolean;
    connected: boolean;
    email?: string;
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasRefreshToken: boolean;
    scope?: string;
    updatedAt?: string;
}

export interface GoogleMailMessage {
    id: string;
    threadId?: string;
    snippet?: string;
    subject?: string;
    from?: string;
    internalDate?: string;
}

export class GoogleIdentityManager {
    private statePath: string;
    private state: GoogleIdentityState = {};
    private cachedAccessToken: { value: string; expiresAt: number } | null = null;

    private readonly defaultScope = [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly'
    ].join(' ');

    constructor(private config: ConfigManager) {
        this.statePath = path.join(this.config.getDataHome(), 'google-identity.json');
        this.loadState();
    }

    public getStatus(): GoogleIdentityStatus {
        const clientId = String(this.config.get('googleOAuthClientId') || '').trim();
        const clientSecret = String(this.config.get('googleOAuthClientSecret') || '').trim();
        const refreshToken = this.getRefreshToken();

        return {
            configured: !!clientId && !!clientSecret,
            connected: !!clientId && !!clientSecret && !!refreshToken,
            email: this.state.email,
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            hasRefreshToken: !!refreshToken,
            scope: this.state.scope,
            updatedAt: this.state.updatedAt
        };
    }

    public setCredentials(input: { clientId: string; clientSecret: string; email?: string }): void {
        this.config.set('googleOAuthClientId' as any, input.clientId.trim());
        this.config.set('googleOAuthClientSecret' as any, input.clientSecret.trim());
        if (input.email?.trim()) {
            this.state.email = input.email.trim();
            this.saveState();
        }
    }

    public getAuthorizationUrl(scope?: string): string {
        const clientId = String(this.config.get('googleOAuthClientId') || '').trim();
        if (!clientId) {
            throw new Error('googleOAuthClientId is not configured');
        }

        const redirectUri = String(this.config.get('googleOAuthRedirectUri') || 'http://localhost');
        const effectiveScope = scope?.trim() || this.defaultScope;

        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', effectiveScope);
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');

        return url.toString();
    }

    public async exchangeAuthorizationCode(codeOrRedirectUrl: string): Promise<void> {
        const clientId = String(this.config.get('googleOAuthClientId') || '').trim();
        const clientSecret = String(this.config.get('googleOAuthClientSecret') || '').trim();
        const redirectUri = String(this.config.get('googleOAuthRedirectUri') || 'http://localhost');

        if (!clientId || !clientSecret) {
            throw new Error('googleOAuthClientId/googleOAuthClientSecret must be configured first');
        }

        const code = this.extractCode(codeOrRedirectUrl);
        if (!code) throw new Error('Unable to parse authorization code');

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        });

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Google token exchange failed (${res.status}): ${txt}`);
        }

        const token = await res.json() as GoogleTokenResponse;
        if (!token.refresh_token) {
            throw new Error('No refresh_token returned. Re-consent with prompt=consent and access_type=offline.');
        }

        this.setRefreshToken(token.refresh_token, token.scope, token.token_type);
        this.cachedAccessToken = {
            value: token.access_token,
            expiresAt: Date.now() + Math.max(60, token.expires_in - 30) * 1000
        };

        try {
            const profile = await this.fetchGoogleProfile();
            if (profile.email) {
                this.state.email = profile.email;
                this.saveState();
            }
        } catch (e) {
            logger.warn(`GoogleIdentityManager: Token exchange succeeded but profile fetch failed: ${e}`);
        }
    }

    public disconnect(): void {
        this.cachedAccessToken = null;
        this.state.refreshToken = undefined;
        this.state.scope = undefined;
        this.state.tokenType = undefined;
        this.state.updatedAt = new Date().toISOString();
        this.saveState();
    }

    public async searchInbox(query: string, maxResults: number = 5): Promise<GoogleMailMessage[]> {
        const q = String(query || '').trim();
        const max = Math.min(20, Math.max(1, Number(maxResults) || 5));

        const list = await this.gmailGet(`/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
        const messageIds: string[] = Array.isArray(list?.messages) ? list.messages.map((m: any) => m.id).filter(Boolean) : [];
        if (messageIds.length === 0) return [];

        const results: GoogleMailMessage[] = [];
        for (const id of messageIds.slice(0, max)) {
            try {
                const msg = await this.gmailGet(`/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
                const headers = Array.isArray(msg?.payload?.headers) ? msg.payload.headers : [];
                const subject = headers.find((h: any) => String(h.name).toLowerCase() === 'subject')?.value;
                const from = headers.find((h: any) => String(h.name).toLowerCase() === 'from')?.value;
                results.push({
                    id: msg.id,
                    threadId: msg.threadId,
                    snippet: msg.snippet,
                    subject,
                    from,
                    internalDate: msg.internalDate
                });
            } catch {
                // continue best-effort
            }
        }
        return results;
    }

    public async findLatestOtp(filter?: { fromContains?: string; subjectContains?: string }): Promise<{ code?: string; message?: GoogleMailMessage }> {
        const fromQ = filter?.fromContains ? ` from:${filter.fromContains}` : '';
        const subjectQ = filter?.subjectContains ? ` subject:${filter.subjectContains}` : '';
        const query = `newer_than:7d${fromQ}${subjectQ}`.trim();
        const messages = await this.searchInbox(query, 8);

        for (const msg of messages) {
            const hay = `${msg.subject || ''} ${msg.snippet || ''}`;
            const otpMatch = hay.match(/\b(\d{4,8})\b/);
            if (otpMatch) {
                return { code: otpMatch[1], message: msg };
            }
        }

        return { message: messages[0] };
    }

    private async fetchGoogleProfile(): Promise<{ email?: string }> {
        const token = await this.getAccessToken();
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Profile fetch failed (${res.status}): ${txt}`);
        }
        return await res.json() as { email?: string };
    }

    private async gmailGet(pathAndQuery: string): Promise<any> {
        const token = await this.getAccessToken();
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1${pathAndQuery}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Gmail API failed (${res.status}): ${txt}`);
        }
        return await res.json();
    }

    private async getAccessToken(): Promise<string> {
        if (this.cachedAccessToken && Date.now() < this.cachedAccessToken.expiresAt) {
            return this.cachedAccessToken.value;
        }

        const refreshToken = this.getRefreshToken();
        const clientId = String(this.config.get('googleOAuthClientId') || '').trim();
        const clientSecret = String(this.config.get('googleOAuthClientSecret') || '').trim();

        if (!refreshToken || !clientId || !clientSecret) {
            throw new Error('Google identity is not connected (missing client credentials or refresh token)');
        }

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Refresh token exchange failed (${res.status}): ${txt}`);
        }

        const token = await res.json() as GoogleTokenResponse;
        this.cachedAccessToken = {
            value: token.access_token,
            expiresAt: Date.now() + Math.max(60, token.expires_in - 30) * 1000
        };

        return token.access_token;
    }

    private extractCode(input: string): string | null {
        const text = String(input || '').trim();
        if (!text) return null;

        if (/^[a-zA-Z0-9\-_.\/]+$/.test(text) && text.length > 20 && !text.includes('http')) {
            return text;
        }

        try {
            const url = new URL(text);
            const code = url.searchParams.get('code');
            return code || null;
        } catch {
            return null;
        }
    }

    private loadState(): void {
        try {
            if (!fs.existsSync(this.statePath)) return;
            const raw = fs.readFileSync(this.statePath, 'utf-8');
            const parsed = JSON.parse(raw) as GoogleIdentityState;
            this.state = parsed || {};
        } catch (e) {
            logger.warn(`GoogleIdentityManager: Failed to load state: ${e}`);
            this.state = {};
        }
    }

    private saveState(): void {
        try {
            const dir = path.dirname(this.statePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            logger.warn(`GoogleIdentityManager: Failed to save state: ${e}`);
        }
    }

    private setRefreshToken(refreshToken: string, scope?: string, tokenType?: string): void {
        const token = String(refreshToken || '').trim();
        if (!token) return;
        const encrypted = this.tryEncrypt(token);
        this.state.refreshToken = encrypted.value;
        this.state.encrypted = encrypted.encrypted;
        this.state.scope = scope || this.state.scope;
        this.state.tokenType = tokenType || this.state.tokenType;
        this.state.updatedAt = new Date().toISOString();
        this.saveState();
    }

    private getRefreshToken(): string | null {
        const val = String(this.state.refreshToken || '').trim();
        if (!val) return null;
        if (this.state.encrypted) {
            const dec = this.tryDecrypt(val);
            return dec || null;
        }
        return val;
    }

    private getEncryptionKey(): Buffer | null {
        const raw = String(process.env.ORCBOT_SECRET_KEY || this.config.get('orcbotSecretKey') || '').trim();
        if (!raw) return null;
        return crypto.createHash('sha256').update(raw).digest();
    }

    private tryEncrypt(plain: string): { value: string; encrypted: boolean } {
        const key = this.getEncryptionKey();
        if (!key) return { value: plain, encrypted: false };

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        const payload = Buffer.concat([iv, tag, enc]).toString('base64');
        return { value: payload, encrypted: true };
    }

    private tryDecrypt(payloadBase64: string): string | null {
        const key = this.getEncryptionKey();
        if (!key) return null;

        try {
            const payload = Buffer.from(payloadBase64, 'base64');
            if (payload.length < 12 + 16 + 1) return null;
            const iv = payload.subarray(0, 12);
            const tag = payload.subarray(12, 28);
            const data = payload.subarray(28);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
            return dec;
        } catch {
            return null;
        }
    }
}
