import crypto from 'node:crypto';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Agent } from '../core/Agent';
import { eventBus } from '../core/EventBus';
import { logger } from '../utils/logger';

export interface OrcBotMcpServerOptions {
    serverName?: string;
    serverVersion?: string;
    chatTimeoutMs?: number;
    chatIdleMs?: number;
    startAgentLoop?: boolean;
}

export interface OrcBotMcpHttpOptions {
    host?: string;
    port?: number;
    path?: string;
    apiKey?: string;
}

export interface ResolvedMcpHttpOptions {
    host: string;
    port: number;
    path: string;
    apiKey?: string;
}

export interface McpStatusSnapshot {
    agentName: string;
    isRunning: boolean;
    llmProvider?: string;
    modelName?: string;
    safeMode: boolean;
    queue: Record<string, number>;
    skillCount: number;
}

type GatewayChatResponseEvent = {
    role?: string;
    content?: string;
    sourceId?: string;
    messageId?: string;
};

type McpHeaderMap = Record<string, string | string[] | undefined>;

type McpConfigReader = {
    get(key: string): any;
};

export function normalizeMcpResponseMessages(messages: string[]): string {
    const unique = Array.from(new Set(messages.map(message => String(message || '').trim()).filter(Boolean)));
    if (unique.length === 0) return '';
    if (unique.length === 1) return unique[0];
    return unique.join('\n\n---\n\n');
}

export function buildMcpStatusSnapshot(agent: Pick<Agent, 'config' | 'isRunning' | 'actionQueue' | 'skills'>): McpStatusSnapshot {
    return {
        agentName: String(agent.config.get('agentName') || 'OrcBot'),
        isRunning: !!agent.isRunning,
        llmProvider: agent.config.get('llmProvider') || undefined,
        modelName: agent.config.get('modelName') || undefined,
        safeMode: !!agent.config.get('safeMode'),
        queue: typeof agent.actionQueue.getCounts === 'function'
            ? agent.actionQueue.getCounts()
            : { pending: 0, waiting: 0, 'in-progress': 0, completed: 0, failed: 0 },
        skillCount: typeof agent.skills.getAllSkills === 'function' ? agent.skills.getAllSkills().length : 0
    };
}

export function getMcpApiKeyFromHeaders(headers: McpHeaderMap): string | undefined {
    const explicit = headers['x-api-key'];
    const explicitValue = Array.isArray(explicit) ? explicit[0] : explicit;
    if (explicitValue && String(explicitValue).trim()) {
        return String(explicitValue).trim();
    }

    const auth = headers.authorization;
    const authValue = Array.isArray(auth) ? auth[0] : auth;
    const match = String(authValue || '').match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
}

export function isMcpRequestAuthorized(expectedApiKey: string | undefined, headers: McpHeaderMap): boolean {
    if (!expectedApiKey) return true;
    const provided = getMcpApiKeyFromHeaders(headers);
    if (!provided) return false;

    try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expectedApiKey));
    } catch {
        return false;
    }
}

function normalizeMcpRoutePath(value: unknown): string {
    const normalized = String(value || '').trim();
    if (!normalized) return '/mcp';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function resolveMcpHttpOptions(config: McpConfigReader, overrides: OrcBotMcpHttpOptions = {}): ResolvedMcpHttpOptions {
    const host = String(overrides.host || config.get('mcpHost') || '0.0.0.0').trim() || '0.0.0.0';
    const rawPort = overrides.port ?? config.get('mcpPort') ?? 3190;
    const parsedPort = Number.parseInt(String(rawPort), 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3190;
    const path = normalizeMcpRoutePath(overrides.path || config.get('mcpPath') || '/mcp');
    const apiKey = String(overrides.apiKey || config.get('mcpApiKey') || config.get('gatewayApiKey') || '').trim() || undefined;

    return { host, port, path, apiKey };
}

export class OrcBotMcpServer {
    private readonly serverInfo: { name: string; version: string };
    private readonly server: McpServer;
    private httpServer: HttpServer | null = null;

    constructor(private readonly agent: Agent, private readonly options: OrcBotMcpServerOptions = {}) {
        this.serverInfo = {
            name: options.serverName || 'orcbot',
            version: options.serverVersion || process.env.npm_package_version || '1.0.0'
        };
        this.server = this.createServer();
    }

    private createServer(): McpServer {
        const server = new McpServer(this.serverInfo);
        this.registerTools(server);
        return server;
    }

    private registerTools(server: McpServer): void {
        server.registerTool('orcbot_status', {
            description: 'Return OrcBot runtime status, queue counts, active model, and basic safety state.',
        }, async () => this.asTextResult(JSON.stringify(buildMcpStatusSnapshot(this.agent), null, 2)));

        server.registerTool('orcbot_list_skills', {
            description: 'List OrcBot skills that are currently registered and available to the agent.',
        }, async () => {
            const skills = this.agent.skills.getAllSkills()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map(skill => ({
                    name: skill.name,
                    description: skill.description,
                    usage: skill.usage,
                    flags: [
                        skill.isResearch ? 'research' : null,
                        skill.isDeep ? 'deep' : null,
                        skill.isSideEffect ? 'side-effect' : null,
                        skill.isDangerous ? 'dangerous' : null,
                        skill.isElevated ? 'elevated' : null,
                        skill.isParallelSafe ? 'parallel-safe' : null
                    ].filter(Boolean)
                }));

            return this.asTextResult(JSON.stringify(skills, null, 2));
        });

        server.registerTool('orcbot_queue_task', {
            description: 'Queue a task into OrcBot without waiting for a conversational reply.',
            inputSchema: {
                description: z.string().min(1),
                priority: z.number().int().min(1).max(20).optional(),
                clientId: z.string().min(1).max(120).optional()
            }
        }, async ({ description, priority, clientId }) => {
            const sourceId = this.createSourceId(clientId);
            const messageId = `mcp-queue-${crypto.randomUUID()}`;
            await this.agent.pushTask(description, priority ?? 10, {
                source: 'gateway-chat',
                sourceId,
                senderName: 'MCP Client',
                expectResponse: false,
                messageId,
                mcp: true,
                mcpClientId: clientId || undefined
            });

            const action = this.agent.actionQueue.getQueue().find(candidate => candidate.payload?.messageId === messageId);
            return this.asTextResult(JSON.stringify({
                queued: true,
                actionId: action?.id || null,
                sourceId,
                messageId,
                priority: priority ?? 10
            }, null, 2));
        });

        server.registerTool('orcbot_chat', {
            description: 'Send a prompt to OrcBot through the normal gateway-chat path and wait for its reply.',
            inputSchema: {
                prompt: z.string().min(1),
                clientId: z.string().min(1).max(120).optional(),
                timeoutMs: z.number().int().min(1000).max(600000).optional(),
                idleMs: z.number().int().min(250).max(30000).optional()
            }
        }, async ({ prompt, clientId, timeoutMs, idleMs }) => {
            if (!this.agent.isRunning) {
                if (this.options.startAgentLoop === false) {
                    return this.asTextResult('OrcBot agent loop is not running. Start the MCP server without --no-agent-loop or start OrcBot separately.');
                }
                await this.agent.start();
            }

            const sourceId = this.createSourceId(clientId);
            const response = await this.chatWithAgent(prompt, sourceId, timeoutMs, idleMs);
            return this.asTextResult(response);
        });
    }

    private createSourceId(clientId?: string): string {
        const suffix = crypto.randomUUID().slice(0, 8);
        const normalizedClient = String(clientId || 'stdio').replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 48) || 'stdio';
        return `mcp:${normalizedClient}:${suffix}`;
    }

    private async chatWithAgent(prompt: string, sourceId: string, timeoutOverrideMs?: number, idleOverrideMs?: number): Promise<string> {
        const timeoutMs = timeoutOverrideMs ?? this.options.chatTimeoutMs ?? 90000;
        const idleMs = idleOverrideMs ?? this.options.chatIdleMs ?? 4000;
        const messageId = `mcp-chat-${crypto.randomUUID()}`;

        await this.agent.pushTask(`Gateway chat message: "${prompt}"`, 10, {
            source: 'gateway-chat',
            sourceId,
            senderName: 'MCP Client',
            expectResponse: true,
            messageId,
            mcp: true
        });

        const action = this.agent.actionQueue.getQueue().find(candidate => candidate.payload?.messageId === messageId);
        logger.info(`MCP: queued chat task for ${sourceId}${action ? ` (action ${action.id})` : ''}`);

        return this.waitForGatewayResponse(sourceId, timeoutMs, idleMs, action?.id);
    }

    private waitForGatewayResponse(sourceId: string, timeoutMs: number, idleMs: number, actionId?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const allMessages: string[] = [];
            const substantiveMessages: string[] = [];
            let settled = false;
            let idleTimer: NodeJS.Timeout | null = null;
            let statusTimer: NodeJS.Timeout | null = null;

            const cleanup = () => {
                if (idleTimer) clearTimeout(idleTimer);
                if (statusTimer) clearInterval(statusTimer);
                clearTimeout(timeoutTimer);
                eventBus.off('gateway:chat:response', onResponse);
            };

            const finalize = () => {
                if (settled) return;
                settled = true;
                cleanup();
                const text = normalizeMcpResponseMessages(substantiveMessages.length > 0 ? substantiveMessages : allMessages);
                if (!text) {
                    const statusSuffix = actionId
                        ? (() => {
                            const action = this.agent.actionQueue.get(actionId);
                            return action ? ` (action ${actionId} status=${action.status})` : ` (action ${actionId} not found)`;
                        })()
                        : '';
                    reject(new Error(`Timed out waiting for OrcBot response on ${sourceId}${statusSuffix}. Check provider/auth config and run "orcbot doctor --llm".`));
                    return;
                }
                resolve(text);
            };

            const scheduleFinalize = () => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(finalize, idleMs);
            };

            const onResponse = (event: GatewayChatResponseEvent) => {
                if (event?.sourceId !== sourceId) return;
                if (event.role && event.role !== 'assistant' && event.role !== 'system') return;

                const content = String(event.content || '').trim();
                if (!content) return;

                allMessages.push(content);
                if (!/^🧭\s*Task checklist/i.test(content)) {
                    substantiveMessages.push(content);
                    scheduleFinalize();
                }
            };

            if (actionId) {
                statusTimer = setInterval(() => {
                    if (settled) return;
                    const action = this.agent.actionQueue.get(actionId);
                    if (!action) return;

                    if (action.status === 'failed') {
                        settled = true;
                        cleanup();
                        reject(new Error(`OrcBot action ${actionId} failed before sending a chat response. Check provider/auth config (for example: invalid OpenAI key) and run "orcbot doctor --llm".`));
                        return;
                    }

                    if (action.status === 'completed' && allMessages.length === 0) {
                        settled = true;
                        cleanup();
                        reject(new Error(`OrcBot action ${actionId} completed but no gateway chat response event was emitted for source ${sourceId}.`));
                    }
                }, 1000);
            }

            const timeoutTimer = setTimeout(finalize, timeoutMs);
            eventBus.on('gateway:chat:response', onResponse);
        });
    }

    private asTextResult(text: string) {
        return {
            content: [{ type: 'text' as const, text }]
        };
    }

    public async startStdio(): Promise<void> {
        if (this.options.startAgentLoop !== false && !this.agent.isRunning) {
            await this.agent.start();
        }

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.info('MCP: OrcBot MCP stdio server started');
    }

    public async startHttp(options: OrcBotMcpHttpOptions = {}): Promise<void> {
        if (this.options.startAgentLoop !== false && !this.agent.isRunning) {
            await this.agent.start();
        }

        const resolved = resolveMcpHttpOptions(this.agent.config, options);
        const { host, port, path: routePath, apiKey } = resolved;

        const app = express();
        app.use(express.json({ limit: '2mb' }));

        app.use(routePath, (req, res, next) => {
            if (!isMcpRequestAuthorized(apiKey, req.headers as McpHeaderMap)) {
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32001,
                        message: 'Unauthorized'
                    },
                    id: null
                });
                return;
            }
            next();
        });

        app.get('/health', (_req, res) => {
            res.json({ ok: true, transport: 'streamable-http', path: routePath });
        });

        app.get('/', (_req, res) => {
            const connectUrl = `http://localhost:${port}${routePath}`;
            const stdioConfig = JSON.stringify({ mcpServers: { orcbot: { command: 'orcbot', args: ['mcp'] } } }, null, 2);
            const httpConfig = apiKey
                ? JSON.stringify({ mcpServers: { orcbot: { url: connectUrl, headers: { 'X-Api-Key': '<your-mcpApiKey>' } } } }, null, 2)
                : JSON.stringify({ mcpServers: { orcbot: { url: connectUrl } } }, null, 2);
            const tools = this.agent.skills?.getAllSkills?.().map(s => s.name).slice(0, 20).join(', ') || 'n/a';
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OrcBot MCP Server</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.6;color:#1a1a2e}h1{color:#0f8a6c}code,pre{background:#f4f4f4;border-radius:6px;padding:2px 6px}pre{padding:14px;overflow:auto}a{color:#0f8a6c}.tag{display:inline-block;background:#e6f7f3;border-radius:4px;padding:2px 8px;font-size:13px;margin:2px}</style>
</head><body>
<h1>OrcBot MCP Server ✓</h1>
<p>The MCP HTTP server is running. This page is for humans — MCP clients connect via <strong>POST ${routePath}</strong>.</p>
<hr>
<h2>Quick links</h2>
<ul><li><a href="/health">/health</a> — liveness check</li><li><strong>MCP endpoint (for clients):</strong> <code>${connectUrl}</code></li></ul>
<h2>Auth</h2>
<p>${apiKey ? '🔐 API key required — pass as <code>X-Api-Key</code> header or <code>Authorization: Bearer &lt;key&gt;</code>.' : '🔓 No auth required (open access). Set <code>mcpApiKey</code> in config to enable.'}</p>
<h2>Claude Desktop config (stdio)</h2>
<pre>${stdioConfig}</pre>
<h2>HTTP client config (Cursor, Windsurf, etc.)</h2>
<pre>${httpConfig}</pre>
<h2>Available tools</h2>
<p><span class="tag">orcbot_status</span> <span class="tag">orcbot_list_skills</span> <span class="tag">orcbot_queue_task</span> <span class="tag">orcbot_chat</span></p>
<hr><p style="color:#888;font-size:13px">OrcBot ${this.serverInfo.version} &mdash; To start both gateway dashboard + MCP together: <code>orcbot gateway --with-agent --with-mcp</code></p>
</body></html>`);
        });

        app.post(routePath, async (req, res) => {
            const server = this.createServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });

            try {
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            } catch (error: any) {
                logger.error(`MCP HTTP: request failed: ${error?.stack || error}`);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal MCP server error'
                        },
                        id: null
                    });
                }
            } finally {
                res.on('close', () => {
                    void transport.close();
                    void server.close();
                });
            }
        });

        const methodNotAllowed = (_req: any, res: any) => {
            res.status(405).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Method not allowed for stateless MCP HTTP transport'
                },
                id: null
            });
        };

        app.get(routePath, methodNotAllowed);
        app.delete(routePath, methodNotAllowed);

        await new Promise<void>((resolve) => {
            this.httpServer = app.listen(port, host, () => {
                logger.info(`MCP: OrcBot MCP HTTP server running at http://${host}:${port}${routePath}`);
                resolve();
            });
        });
    }

    public async close(): Promise<void> {
        if (this.httpServer) {
            await new Promise<void>((resolve, reject) => {
                this.httpServer?.close(error => error ? reject(error) : resolve());
            });
            this.httpServer = null;
        }
        await this.server.close();
    }
}

export default OrcBotMcpServer;