import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import { GatewayServer } from '../src/gateway/GatewayServer';
import { eventBus } from '../src/core/EventBus';

function waitForMessage(socket: WebSocket, predicate: (message: any) => boolean, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off('message', onMessage);
            reject(new Error('Timed out waiting for WebSocket message'));
        }, timeoutMs);

        const onMessage = (raw: WebSocket.RawData) => {
            try {
                const parsed = JSON.parse(raw.toString());
                if (!predicate(parsed)) {
                    return;
                }
                clearTimeout(timeout);
                socket.off('message', onMessage);
                resolve(parsed);
            } catch {
                // Ignore non-JSON payloads during the wait window.
            }
        };

        socket.on('message', onMessage);
    });
}

describe('GatewayServer', () => {
    let dataHome: string;
    let gateway: GatewayServer;
    let port: number;
    let socket: WebSocket | null = null;

    beforeEach(async () => {
        dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-gateway-'));

        const agent = {
            isRunning: false,
            skills: {
                getAllSkills: () => []
            },
            memory: {
                getRecentContext: () => []
            },
            orchestrator: {
                getAgents: () => [],
                getTasks: () => [],
                getDetailedWorkerStatus: () => [
                    {
                        agentId: 'agent-1',
                        name: 'BrowserWorker',
                        pid: 1234,
                        status: 'idle',
                        isRunning: true,
                        currentTaskId: null,
                        currentTaskDescription: null,
                        lastActiveAt: '2026-03-08T00:00:00.000Z',
                        role: 'browser_specialist',
                        capabilityProfile: {
                            enforced: true,
                            capabilities: ['execute', 'browse', 'web_search'],
                            allowChannels: false
                        },
                        lastCapabilityBlock: {
                            blocked: true,
                            skillName: 'run_command',
                            requiredCapability: 'run_command',
                            reason: 'Worker capability policy blocked skill run_command: requires capability run_command.',
                            timestamp: '2026-03-08T00:05:00.000Z'
                        }
                    }
                ]
            }
        };

        const configValues: Record<string, any> = {
            gatewayHost: '127.0.0.1',
            gatewayPort: 3100,
            mcpHost: '127.0.0.1',
            mcpPort: 3190,
            mcpPath: '/mcp',
            modelName: 'test-model',
            llmProvider: 'openai',
            safeMode: false,
            whatsappEnabled: false
        };

        const config = {
            get: (key: string) => configValues[key],
            set: (key: string, value: any) => { configValues[key] = value; },
            getDataHome: () => dataHome
        };

        gateway = new GatewayServer(agent as any, config as any, {
            host: '127.0.0.1',
            staticDir: path.join(process.cwd(), 'apps', 'dashboard')
        });

        (gateway as any).gatewayConfig.port = 0;
        await gateway.start();
        port = ((gateway as any).server.address() as { port: number }).port;
    });

    afterEach(() => {
        try {
            socket?.close();
        } catch {}
        gateway.stop();
        try {
            fs.rmSync(dataHome, { recursive: true, force: true });
        } catch {}
    });

    it('forwards chat:message gateway responses to websocket clients', async () => {
        socket = new WebSocket(`ws://127.0.0.1:${port}/`);

        await new Promise<void>((resolve, reject) => {
            socket?.once('open', () => resolve());
            socket?.once('error', (error) => reject(error));
        });

        const messagePromise = waitForMessage(socket, (message) => message.type === 'chat:message');

        eventBus.emit('gateway:chat:response', {
            type: 'chat:message',
            role: 'assistant',
            content: 'Gateway reply',
            timestamp: new Date().toISOString(),
            metadata: { source: 'gateway-chat' }
        });

        const message = await messagePromise;
        expect(message.type).toBe('chat:message');
        expect(message.content).toBe('Gateway reply');
        expect(message.role).toBe('assistant');
    });

    it('serves doctor and security audit reports over the API', async () => {
        fs.writeFileSync(path.join(dataHome, 'orcbot.lock'), JSON.stringify({ pid: 999991, startedAt: '2026-03-08T00:00:00.000Z', host: 'test-host', cwd: dataHome }), 'utf8');

        const doctorResponse = await fetch(`http://127.0.0.1:${port}/api/doctor`);
        expect(doctorResponse.ok).toBe(true);
        const doctor = await doctorResponse.json();
        expect(doctor.findings.some((finding: any) => finding.id === 'runtime.stale_lock_file')).toBe(true);
        expect(doctor.facts.runtime.lockFilePresent).toBe(true);

        const securityResponse = await fetch(`http://127.0.0.1:${port}/api/security/audit`);
        expect(securityResponse.ok).toBe(true);
        const security = await securityResponse.json();
        expect(security.findings.every((finding: any) => ['security', 'gateway', 'mcp', 'channels'].includes(finding.area))).toBe(true);
        expect(security.findings.some((finding: any) => finding.id === 'gateway.loopback_no_auth')).toBe(true);
        expect(security.findings.some((finding: any) => finding.id === 'mcp.loopback_no_auth')).toBe(true);

        const securitySummaryResponse = await fetch(`http://127.0.0.1:${port}/api/security`);
        expect(securitySummaryResponse.ok).toBe(true);
        const securitySummary = await securitySummaryResponse.json();
        expect(securitySummary.mcp.path).toBe('/mcp');
        expect(securitySummary.mcp.authEnabled).toBe(false);
        expect(securitySummary.mcp.authSource).toBe('none');
    });

    it('serves enriched orchestrator worker status over the API', async () => {
        const response = await fetch(`http://127.0.0.1:${port}/api/orchestrator/agents`);
        expect(response.ok).toBe(true);

        const payload = await response.json();
        expect(payload.agents).toHaveLength(1);
        expect(payload.agents[0].capabilityProfile.capabilities).toEqual(['execute', 'browse', 'web_search']);
        expect(payload.agents[0].lastCapabilityBlock.skillName).toBe('run_command');
    });

    it('rotates the MCP API key and reflects auth state in /api/security', async () => {
        // Before rotation: no MCP auth
        const before = await fetch(`http://127.0.0.1:${port}/api/security`);
        expect(before.ok).toBe(true);
        const beforeBody = await before.json();
        expect(beforeBody.mcp.authEnabled).toBe(false);

        // Rotate
        const rotateResponse = await fetch(`http://127.0.0.1:${port}/api/mcp/key/rotate`, { method: 'POST' });
        expect(rotateResponse.ok).toBe(true);
        const rotateBody = await rotateResponse.json();
        expect(rotateBody.success).toBe(true);
        expect(typeof rotateBody.token).toBe('string');
        expect(rotateBody.token.length).toBe(64);
        expect(rotateBody.tokenPartial).toMatch(/^.{4}\*+.{4}$/);

        // After rotation: MCP auth enabled, source is mcpApiKey
        const after = await fetch(`http://127.0.0.1:${port}/api/security`);
        expect(after.ok).toBe(true);
        const afterBody = await after.json();
        expect(afterBody.mcp.authEnabled).toBe(true);
        expect(afterBody.mcp.authSource).toBe('mcpApiKey');
    });
});