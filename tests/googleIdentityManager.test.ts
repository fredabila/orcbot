import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleIdentityManager } from '../src/core/GoogleIdentityManager';
import { ConfigPolicy } from '../src/config/ConfigPolicy';

vi.mock('../src/utils/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

class StubConfig {
    private values: Record<string, any>;

    constructor(private dataHome: string, values: Record<string, any> = {}) {
        this.values = { ...values };
    }

    get(key: string) {
        return this.values[key];
    }

    set(key: string, value: any) {
        this.values[key] = value;
    }

    getDataHome() {
        return this.dataHome;
    }
}

const tempPaths: string[] = [];
const originalSecretKey = process.env.ORCBOT_SECRET_KEY;

function createManager(configValues: Record<string, any> = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-google-identity-'));
    tempPaths.push(tempDir);
    const config = new StubConfig(tempDir, configValues);
    const manager = new GoogleIdentityManager(config as any);
    return { manager, config, tempDir };
}

afterEach(() => {
    mockFetch.mockReset();
    if (originalSecretKey === undefined) {
        delete process.env.ORCBOT_SECRET_KEY;
    } else {
        process.env.ORCBOT_SECRET_KEY = originalSecretKey;
    }

    for (const tempPath of tempPaths.splice(0)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
    }
});

describe('GoogleIdentityManager', () => {
    beforeEach(() => {
        process.env.ORCBOT_SECRET_KEY = 'test-secret-key';
    });

    it('reports configuration state and builds an authorization URL', () => {
        const { manager } = createManager({
            googleOAuthClientId: 'client-id-123',
            googleOAuthClientSecret: 'client-secret-456',
            googleOAuthRedirectUri: 'http://localhost/callback'
        });

        const status = manager.getStatus();
        expect(status.configured).toBe(true);
        expect(status.connected).toBe(false);
        expect(status.hasClientId).toBe(true);
        expect(status.hasClientSecret).toBe(true);
        expect(status.hasRefreshToken).toBe(false);

        const url = new URL(manager.getAuthorizationUrl());
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe('client-id-123');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
        expect(url.searchParams.get('scope')).toContain('gmail.readonly');
    });

    it('exchanges an authorization code, encrypts the refresh token, and loads email', async () => {
        const { manager, tempDir } = createManager({
            googleOAuthClientId: 'client-id-123',
            googleOAuthClientSecret: 'client-secret-456',
            googleOAuthRedirectUri: 'http://localhost/callback'
        });

        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'access-token-1',
                    expires_in: 3600,
                    scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
                    token_type: 'Bearer',
                    refresh_token: 'refresh-token-1'
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ email: 'agent@example.com' })
            });

        await manager.exchangeAuthorizationCode('http://localhost/callback?code=sample-auth-code');

        const status = manager.getStatus();
        expect(status.connected).toBe(true);
        expect(status.email).toBe('agent@example.com');
        expect(status.hasRefreshToken).toBe(true);
        expect(status.scope).toContain('gmail.readonly');

        const statePath = path.join(tempDir, 'google-identity.json');
        const savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(savedState.refreshToken).not.toBe('refresh-token-1');
        expect(savedState.encrypted).toBe(true);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(String(mockFetch.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
        expect(String(mockFetch.mock.calls[1][0])).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
    });

    it('disconnects and removes the persisted refresh token', async () => {
        const { manager, tempDir } = createManager({
            googleOAuthClientId: 'client-id-123',
            googleOAuthClientSecret: 'client-secret-456'
        });

        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'access-token-1',
                    expires_in: 3600,
                    scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
                    token_type: 'Bearer',
                    refresh_token: 'refresh-token-1'
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ email: 'agent@example.com' })
            });

        await manager.exchangeAuthorizationCode('sample-auth-code-value-1234567890');
        manager.disconnect();

        const status = manager.getStatus();
        expect(status.connected).toBe(false);
        expect(status.hasRefreshToken).toBe(false);

        const statePath = path.join(tempDir, 'google-identity.json');
        const savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(savedState.refreshToken).toBeUndefined();
    });

    it('extracts the latest OTP from recent message snippets', async () => {
        const { manager } = createManager();
        const searchSpy = vi.spyOn(manager, 'searchInbox').mockResolvedValue([
            { id: '1', subject: 'Welcome', snippet: 'No code here' },
            { id: '2', subject: 'Your verification code', snippet: 'Use 482913 to continue' }
        ]);

        const result = await manager.findLatestOtp({ fromContains: 'accounts.google.com' });

        expect(searchSpy).toHaveBeenCalledWith('newer_than:7d from:accounts.google.com', 8);
        expect(result.code).toBe('482913');
        expect(result.message?.id).toBe('2');
    });
});

describe('Google OAuth config policy', () => {
    it('requires approval for client id and locks the client secret', () => {
        expect(ConfigPolicy.requiresApproval('googleOAuthClientId')).toBe(true);
        expect(ConfigPolicy.isLocked('googleOAuthClientSecret')).toBe(true);
        expect(ConfigPolicy.canAutoModify('googleOAuthClientId')).toBe(false);
    });
});