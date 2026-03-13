import { describe, expect, it } from 'vitest';
import { buildMcpStatusSnapshot, getMcpApiKeyFromHeaders, isMcpRequestAuthorized, normalizeMcpResponseMessages, resolveMcpHttpOptions } from '../src/mcp/OrcBotMcpServer';

describe('OrcBotMcpServer helpers', () => {
    it('normalizes multiple assistant messages into a single MCP tool result', () => {
        const text = normalizeMcpResponseMessages([
            'First partial result',
            'Second partial result',
            'Second partial result'
        ]);

        expect(text).toBe('First partial result\n\n---\n\nSecond partial result');
    });

    it('builds a stable status snapshot from the agent runtime', () => {
        const snapshot = buildMcpStatusSnapshot({
            isRunning: true,
            config: {
                get: (key: string) => ({
                    agentName: 'OrcBot',
                    llmProvider: 'openai',
                    modelName: 'gpt-4o',
                    safeMode: false
                } as Record<string, any>)[key]
            },
            actionQueue: {
                getCounts: () => ({ pending: 2, waiting: 1, 'in-progress': 1, completed: 4, failed: 0 })
            },
            skills: {
                getAllSkills: () => [{ name: 'one' }, { name: 'two' }, { name: 'three' }]
            }
        } as any);

        expect(snapshot.agentName).toBe('OrcBot');
        expect(snapshot.isRunning).toBe(true);
        expect(snapshot.queue.pending).toBe(2);
        expect(snapshot.skillCount).toBe(3);
    });

    it('accepts MCP auth from x-api-key or bearer authorization', () => {
        expect(getMcpApiKeyFromHeaders({ 'x-api-key': 'secret' })).toBe('secret');
        expect(getMcpApiKeyFromHeaders({ authorization: 'Bearer token-123' })).toBe('token-123');
        expect(isMcpRequestAuthorized('secret', { 'x-api-key': 'secret' })).toBe(true);
        expect(isMcpRequestAuthorized('secret', { authorization: 'Bearer secret' })).toBe(true);
        expect(isMcpRequestAuthorized('secret', { authorization: 'Bearer wrong' })).toBe(false);
    });

    it('prefers dedicated MCP config and normalizes the route path', () => {
        const resolved = resolveMcpHttpOptions({
            get: (key: string) => ({
                mcpHost: '127.0.0.1',
                mcpPort: 4100,
                mcpPath: 'agent-mcp',
                mcpApiKey: 'mcp-secret',
                gatewayApiKey: 'gateway-secret'
            } as Record<string, any>)[key]
        });

        expect(resolved).toEqual({
            host: '127.0.0.1',
            port: 4100,
            path: '/agent-mcp',
            apiKey: 'mcp-secret'
        });
    });

    it('falls back to gateway auth when dedicated MCP auth is unset', () => {
        const resolved = resolveMcpHttpOptions({
            get: (key: string) => ({
                gatewayApiKey: 'gateway-secret'
            } as Record<string, any>)[key]
        }, {
            host: '0.0.0.0',
            port: 3195,
            path: '/mcp-custom'
        });

        expect(resolved).toEqual({
            host: '0.0.0.0',
            port: 3195,
            path: '/mcp-custom',
            apiKey: 'gateway-secret'
        });
    });
});