/**
 * OrcBot Web Gateway Server
 * 
 * Provides a REST API and WebSocket interface for managing the agent
 * remotely. This mirrors the TUI functionality but over HTTP.
 */

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Agent } from '../core/Agent';
import { ConfigManager } from '../config/ConfigManager';
import { collectDoctorReport } from '../cli/Doctor';
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';

export interface GatewayConfig {
    port: number;
    host: string;
    apiKey?: string;
    corsOrigins?: string[];
    staticDir?: string;
    rateLimitPerMinute?: number;
}

export class GatewayServer {
    private app: express.Application;
    private server: http.Server;
    private wss: WebSocketServer;
    private agent: Agent;
    private config: ConfigManager;
    private gatewayConfig: GatewayConfig;
    private clients: Set<WebSocket> = new Set();
    private requestBuckets: Map<string, { count: number; windowStart: number }> = new Map();
    private static readonly DATA_HOME_TEXT_LIMIT_BYTES = 1_000_000;
    private static readonly DATA_HOME_MIME_TYPES: Record<string, string> = {
        '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.jsonl': 'application/x-ndjson; charset=utf-8',
        '.yaml': 'application/yaml; charset=utf-8',
        '.yml': 'application/yaml; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.csv': 'text/csv; charset=utf-8',
        '.log': 'text/plain; charset=utf-8',
        '.ts': 'text/plain; charset=utf-8',
        '.js': 'text/plain; charset=utf-8',
        '.tsx': 'text/plain; charset=utf-8',
        '.jsx': 'text/plain; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.pdf': 'application/pdf'
    };

    constructor(agent: Agent, config: ConfigManager, gatewayConfig: Partial<GatewayConfig> = {}) {
        this.agent = agent;
        this.config = config;
        // Resolve staticDir to absolute path
        let resolvedStaticDir = gatewayConfig.staticDir;
        if (resolvedStaticDir) {
            resolvedStaticDir = path.resolve(process.cwd(), resolvedStaticDir);
        } else {
            const defaultDashboardDir = path.resolve(process.cwd(), 'apps', 'dashboard');
            if (fs.existsSync(defaultDashboardDir)) {
                resolvedStaticDir = defaultDashboardDir;
            }
        }

        this.gatewayConfig = {
            port: gatewayConfig.port || config.get('gatewayPort') || 3100,
            host: gatewayConfig.host || config.get('gatewayHost') || '0.0.0.0',
            apiKey: gatewayConfig.apiKey || config.get('gatewayApiKey'),
            corsOrigins: gatewayConfig.corsOrigins || config.get('gatewayCorsOrigins') || ['*'],
            staticDir: resolvedStaticDir,
            rateLimitPerMinute: gatewayConfig.rateLimitPerMinute || config.get('gatewayRateLimitPerMinute') || 180
        };

        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.setupEventForwarding();
    }

    /**
     * Generate a unique message ID
     */
    private generateMessageId(): string {
        return `gateway-chat-${crypto.randomUUID()}`;
    }

    private verifySlackSignature(req: Request, rawBody: string, signingSecret: string): boolean {
        const timestamp = req.headers['x-slack-request-timestamp'];
        const signature = req.headers['x-slack-signature'];
        if (!timestamp || !signature) {
            logger.warn('Slack signature verification failed: missing headers.');
            return false;
        }

        const ts = Number(timestamp);
        if (!Number.isFinite(ts)) {
            logger.warn('Slack signature verification failed: invalid timestamp.');
            return false;
        }

        // Reject if request is too old (5 minutes)
        const ageSeconds = Math.abs(Date.now() / 1000 - ts);
        if (ageSeconds > 60 * 5) {
            logger.warn('Slack signature verification failed: stale request.');
            return false;
        }

        const baseString = `v0:${timestamp}:${rawBody}`;
        const hash = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
        const expected = `v0=${hash}`;
        const provided = String(signature);

        if (provided.length !== expected.length) return false;
        try {
            return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
        } catch {
            return false;
        }
    }

    /**
     * Save a chat message to memory and broadcast it
     */
    private async handleChatMessage(message: string, metadata: any = {}): Promise<string> {
        const messageId = this.generateMessageId();

        // Ensure a stable sourceId so session scoping, thread context, and waiting-action
        // resume all work correctly. Fall back to 'gateway-web' if the client didn't supply one.
        const sourceId: string = metadata.sourceId || metadata.clientId || 'gateway-web';

        logger.info(`Gateway Chat: message received (${messageId.slice(0, 8)}): "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);

        // Save user message to memory
        this.agent.memory.saveMemory({
            id: messageId,
            type: 'short',
            content: `User (Gateway Chat): ${message}`,
            timestamp: new Date().toISOString(),
            metadata: { source: 'gateway-chat', sourceId, role: 'user', ...metadata }
        });

        // Push task to agent to respond
        await this.agent.pushTask(
            `Gateway chat message: "${message}"`,
            10,
            {
                source: 'gateway-chat',
                sourceId,
                expectResponse: true,
                messageId,
                ...metadata
            }
        );

        // Note: User message is not broadcast here - the client already shows it locally.
        // Only assistant responses are broadcast via the gateway:chat:response event.

        return messageId;
    }

    /**
     * Retrieve chat history from memory
     */
    private getChatHistory(): any[] {
        const allMemories = this.agent.memory?.getRecentContext(100) || [];
        return allMemories
            .filter((m: any) => m.metadata?.source === 'gateway-chat')
            .map((m: any) => {
                let content = m.content;
                if (typeof content === 'string') {
                    const userPrefix = 'User (Gateway Chat): ';
                    if (content.startsWith(userPrefix)) {
                        content = content.slice(userPrefix.length);
                    }
                }

                return {
                    id: m.id,
                    content,
                    timestamp: m.timestamp,
                    role: m.metadata?.role ?? 'assistant',
                    metadata: m.metadata,
                    messageId: m.id
                };
            });
    }

    private getMemoryStats(): { totalMemories: number; fileSize: number } {
        const dataDir = this.getDataHome();
        const memoryPath = path.join(dataDir, 'memory.json');

        if (!fs.existsSync(memoryPath)) {
            return { totalMemories: 0, fileSize: 0 };
        }

        try {
            const content = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
            const memories = Array.isArray(content?.memories) ? content.memories : (Array.isArray(content) ? content : []);
            return {
                totalMemories: memories.length || 0,
                fileSize: fs.statSync(memoryPath).size
            };
        } catch {
            return { totalMemories: 0, fileSize: 0 };
        }
    }

    private getDataHome(): string {
        return path.resolve(this.config.getDataHome?.() || this.config.get('dataDir') || path.join(process.env.HOME || '', '.orcbot'));
    }

    private isProtectedDataHomePath(relativePath: string): boolean {
        const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        if (!normalized) return false;
        return normalized === '.env'
            || normalized.endsWith('/.env')
            || normalized === 'orcbot.lock'
            || normalized.endsWith('/orcbot.lock')
            || normalized.endsWith('.pid');
    }

    private resolveDataHomeTarget(relativePath: string = ''): { root: string; absolutePath: string; relativePath: string } {
        const root = this.getDataHome();
        const requested = String(relativePath || '').trim();
        if (path.isAbsolute(requested)) {
            throw new Error('Absolute paths are not allowed');
        }

        const absolutePath = path.resolve(root, requested || '.');
        const relative = path.relative(root, absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Path escapes the OrcBot data directory');
        }

        const normalizedRelative = (relative || '').replace(/\\/g, '/');
        if (this.isProtectedDataHomePath(normalizedRelative)) {
            throw new Error('Requested path is protected');
        }

        return {
            root,
            absolutePath,
            relativePath: normalizedRelative
        };
    }

    private deleteDataHomeEntry(relativePath: string): { path: string; type: 'file' | 'directory' } {
        const target = this.resolveDataHomeTarget(relativePath);
        if (!target.relativePath) {
            throw new Error('Root data directory cannot be deleted');
        }
        if (!fs.existsSync(target.absolutePath)) {
            throw new Error('Path not found');
        }

        const stats = fs.statSync(target.absolutePath);
        if (stats.isDirectory()) {
            fs.rmSync(target.absolutePath, { recursive: true, force: false });
            return { path: target.relativePath, type: 'directory' };
        }

        fs.unlinkSync(target.absolutePath);
        return { path: target.relativePath, type: 'file' };
    }

    private renameDataHomeEntry(fromPath: string, toPath: string): { fromPath: string; toPath: string; type: 'file' | 'directory' } {
        const source = this.resolveDataHomeTarget(fromPath);
        const destination = this.resolveDataHomeTarget(toPath);

        if (!source.relativePath) {
            throw new Error('Root data directory cannot be renamed');
        }
        if (!destination.relativePath) {
            throw new Error('Destination path is required');
        }
        if (!fs.existsSync(source.absolutePath)) {
            throw new Error('Source path not found');
        }
        if (fs.existsSync(destination.absolutePath)) {
            throw new Error('Destination path already exists');
        }

        fs.mkdirSync(path.dirname(destination.absolutePath), { recursive: true });
        const stats = fs.statSync(source.absolutePath);
        fs.renameSync(source.absolutePath, destination.absolutePath);

        return {
            fromPath: source.relativePath,
            toPath: destination.relativePath,
            type: stats.isDirectory() ? 'directory' : 'file'
        };
    }

    private describeDataHomeEntry(absolutePath: string, relativePath: string, depth: number): any {
        const stats = fs.statSync(absolutePath);
        const isDirectory = stats.isDirectory();
        const mimeType = isDirectory ? undefined : this.getDataHomeMimeType(absolutePath);
        const entry: any = {
            name: relativePath ? path.basename(absolutePath) : path.basename(this.getDataHome()),
            path: relativePath,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? undefined : stats.size,
            modifiedAt: stats.mtime.toISOString(),
            mimeType,
            protected: this.isProtectedDataHomePath(relativePath)
        };

        if (isDirectory && depth > 0 && !entry.protected) {
            const children = fs.readdirSync(absolutePath, { withFileTypes: true })
                .map((child) => {
                    const childRelative = [relativePath, child.name].filter(Boolean).join('/');
                    const childAbsolute = path.join(absolutePath, child.name);
                    const childProtected = this.isProtectedDataHomePath(childRelative);
                    if (childProtected) {
                        return {
                            name: child.name,
                            path: childRelative,
                            type: child.isDirectory() ? 'directory' : 'file',
                            protected: true
                        };
                    }
                    return this.describeDataHomeEntry(childAbsolute, childRelative, depth - 1);
                })
                .sort((left, right) => {
                    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
                    return String(left.name).localeCompare(String(right.name));
                });
            entry.children = children;
        }

        return entry;
    }

    private getDataHomeMimeType(filePath: string): string {
        const extension = path.extname(filePath).toLowerCase();
        return GatewayServer.DATA_HOME_MIME_TYPES[extension] || 'application/octet-stream';
    }

    private isTextDataHomeFile(filePath: string, mimeType: string): boolean {
        const extension = path.extname(filePath).toLowerCase();
        if (mimeType.startsWith('text/')) return true;
        if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml')) return true;
        return ['.ts', '.js', '.tsx', '.jsx', '.md', '.log', '.env', '.sh', '.ps1', '.bat'].includes(extension);
    }

    private getDataHomePreviewKind(mimeType: string): 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary' {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType === 'application/pdf') return 'pdf';
        if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml')) return 'text';
        return 'binary';
    }

    private getDataHomeSummary() {
        const root = this.getDataHome();
        const tree = this.describeDataHomeEntry(root, '', 1);
        return {
            root,
            protectedPatterns: ['.env', 'orcbot.lock', '*.pid'],
            tree
        };
    }

    private getAvailableLogFiles(): string[] {
        const dataHome = this.getDataHome();
        const workspaceRoot = process.cwd();
        const candidates = [
            path.join(workspaceRoot, 'logs', 'combined.log'),
            path.join(dataHome, 'foreground.log'),
            path.join(workspaceRoot, 'logs', 'error.log'),
            path.join(workspaceRoot, 'foreground.log')
        ];

        return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index && fs.existsSync(candidate));
    }

    private getConnectionsSummary() {
        return {
            telegram: {
                configured: !!this.config.get('telegramToken'),
                autoReply: this.config.get('telegramAutoReplyEnabled') || false
            },
            whatsapp: {
                configured: !!this.config.get('whatsappEnabled'),
                autoReply: this.config.get('whatsappAutoReplyEnabled') || false,
                statusReply: this.config.get('whatsappStatusReplyEnabled') || false,
                autoReact: this.config.get('whatsappAutoReactEnabled') || false,
                linkedAccount: this.config.get('whatsappOwnerJID') || null
            },
            discord: {
                configured: !!this.config.get('discordToken'),
                autoReply: this.config.get('discordAutoReplyEnabled') || false
            },
            slack: {
                configured: !!this.config.get('slackBotToken'),
                autoReply: this.config.get('slackAutoReplyEnabled') || false
            },
            email: {
                configured: !!this.config.get('emailEnabled'),
                address: this.config.get('emailAddress') || null
            }
        };
    }

    private getModelsSummary() {
        return {
            currentModel: this.config.get('modelName'),
            provider: this.config.get('llmProvider') || 'auto',
            inferredProvider: this.inferProviderFromModel(this.config.get('modelName') || ''),
            configuredProviders: this.getConfiguredProviders()
        };
    }

    private getSecuritySummary() {
        return {
            safeMode: this.config.get('safeMode') || false,
            autoExecuteCommands: this.config.get('autoExecuteCommands') || false,
            pluginAllowList: this.config.get('pluginAllowList') || [],
            pluginDenyList: this.config.get('pluginDenyList') || []
        };
    }

    private getQueueSummary() {
        const counts = this.agent.actionQueue?.getCounts?.() || {
            pending: 0,
            waiting: 0,
            'in-progress': 0,
            completed: 0,
            failed: 0
        };
        const active = this.agent.actionQueue?.getActive?.() || [];
        const queue = this.agent.actionQueue?.getQueue?.() || [];
        return {
            counts,
            activeCount: active.length,
            total: queue.length,
            active: active.slice(0, 10)
        };
    }

    private getChatSummary() {
        const messages = this.getChatHistory();
        return {
            messageCount: messages.length,
            lastMessageAt: messages[0]?.timestamp || null,
            latest: messages.slice(0, 20)
        };
    }

    private getServiceRegistry() {
        const status = this.getAgentStatus();
        const queue = this.getQueueSummary();
        const chat = this.getChatSummary();
        const memory = this.getMemoryStats();
        const skills = this.agent.skills.getAllSkills();
        const orchestratorAgents = this.agent.orchestrator.getAgents?.() || [];
        const orchestratorTasks = this.agent.orchestrator.getTasks?.() || [];
        const tokenStatus = {
            authEnabled: !!(this.gatewayConfig.apiKey || this.config.get('gatewayApiKey')),
            wsClients: this.clients.size
        };

        return [
            {
                id: 'gateway',
                title: 'Gateway',
                category: 'core',
                status: 'healthy',
                description: 'REST, WebSocket, auth, and browser dashboard transport layer.',
                metrics: { wsClients: this.clients.size, mode: status.mode },
                endpoints: ['/api/status', '/api/health', '/api/gateway/capabilities', '/api/dashboard/overview']
            },
            {
                id: 'agent',
                title: 'Agent Runtime',
                category: 'core',
                status: status.running ? 'healthy' : 'degraded',
                description: 'Main agent loop, model routing, and orchestration status.',
                metrics: { running: status.running, model: status.model, provider: status.provider },
                endpoints: ['/api/status', '/api/models', '/api/providers', '/api/agent/start', '/api/agent/stop']
            },
            {
                id: 'tasks',
                title: 'Task Queue',
                category: 'operations',
                status: queue.counts.failed > 0 ? 'warning' : 'healthy',
                description: 'Queued, in-progress, waiting, and historical actions.',
                metrics: { total: queue.total, active: queue.activeCount, failed: queue.counts.failed },
                endpoints: ['/api/tasks', '/api/tasks/:id', '/api/tasks/:id/cancel', '/api/tasks/clear', '/api/queue/stats']
            },
            {
                id: 'chat',
                title: 'Gateway Chat',
                category: 'workspace',
                status: 'healthy',
                description: 'Web chat session transport, history, and assistant responses.',
                metrics: { messages: chat.messageCount, lastMessageAt: chat.lastMessageAt },
                endpoints: ['/api/chat/send', '/api/chat/history', '/api/chat/export', '/api/chat/clear']
            },
            {
                id: 'memory',
                title: 'Memory',
                category: 'data',
                status: memory.totalMemories > 0 ? 'healthy' : 'degraded',
                description: 'Recent context, search, and file-backed memory statistics.',
                metrics: { totalMemories: memory.totalMemories, fileSize: memory.fileSize },
                endpoints: ['/api/memory', '/api/memory/stats', '/api/memory/search']
            },
            {
                id: 'data-home',
                title: 'Data Home',
                category: 'data',
                status: 'healthy',
                description: 'Managed view over ~/.orcbot files including bootstrap docs, memory artifacts, tools, and workspace folders.',
                metrics: { root: this.getDataHome() },
                endpoints: ['/api/data-home/summary', '/api/data-home/tree', '/api/data-home/file', '/api/data-home/asset', '/api/data-home/directory', '/api/data-home/rename', '/api/data-home/entry']
            },
            {
                id: 'skills',
                title: 'Skills',
                category: 'extensions',
                status: 'healthy',
                description: 'Built-in and plugin skill registry, install, execute, and health checks.',
                metrics: { totalSkills: skills.length, pluginSkills: skills.filter(s => !!s.pluginPath).length },
                endpoints: ['/api/skills', '/api/skills/health', '/api/skills/install', '/api/skills/:name/execute']
            },
            {
                id: 'orchestrator',
                title: 'Orchestrator',
                category: 'operations',
                status: orchestratorTasks.length > 0 ? 'healthy' : 'idle',
                description: 'Delegated agents and distributed task execution state.',
                metrics: { agents: orchestratorAgents.length, delegatedTasks: orchestratorTasks.length },
                endpoints: ['/api/orchestrator/agents', '/api/orchestrator/tasks', '/api/orchestrator/tasks/:id/cancel']
            },
            {
                id: 'channels',
                title: 'Channels',
                category: 'integrations',
                status: 'healthy',
                description: 'Messaging channel configuration and connection settings.',
                metrics: { configured: Object.values(this.getConnectionsSummary()).filter((entry: any) => entry.configured).length },
                endpoints: ['/api/connections', '/api/connections/:channel']
            },
            {
                id: 'security',
                title: 'Security',
                category: 'admin',
                status: tokenStatus.authEnabled ? 'healthy' : 'warning',
                description: 'Gateway auth token, safe mode, and plugin policy controls.',
                metrics: { authEnabled: tokenStatus.authEnabled, wsClients: tokenStatus.wsClients },
                endpoints: ['/api/gateway/token/status', '/api/gateway/token/rotate', '/api/security']
            }
        ];
    }

    private getServiceSnapshot(serviceId: string) {
        const lower = String(serviceId || '').toLowerCase();
        const services = this.getServiceRegistry();
        const service = services.find(entry => entry.id === lower);
        if (!service) return null;

        const snapshots: Record<string, any> = {
            gateway: {
                status: this.getAgentStatus(),
                health: {
                    uptimeSeconds: Math.floor(process.uptime()),
                    wsClients: this.clients.size,
                    memoryUsage: process.memoryUsage()
                },
                capabilities: this.getGatewayCapabilities()
            },
            agent: this.getAgentStatus(),
            tasks: this.getQueueSummary(),
            chat: this.getChatSummary(),
            memory: {
                stats: this.getMemoryStats(),
                recent: this.agent.memory?.getRecentContext(20) || []
            },
            'data-home': this.getDataHomeSummary(),
            skills: {
                skills: this.agent.skills.getAllSkills().map(s => ({
                    name: s.name,
                    description: s.description,
                    usage: s.usage,
                    isPlugin: !!s.pluginPath,
                    pluginPath: s.pluginPath
                }))
            },
            orchestrator: {
                agents: this.agent.orchestrator.getAgents?.() || [],
                tasks: this.agent.orchestrator.getTasks?.() || []
            },
            channels: {
                connections: this.getConnectionsSummary()
            },
            security: {
                token: {
                    authEnabled: !!(this.gatewayConfig.apiKey || this.config.get('gatewayApiKey')),
                    wsClients: this.clients.size
                },
                security: this.getSecuritySummary()
            }
        };

        return {
            ...service,
            snapshot: snapshots[lower] || null,
            timestamp: new Date().toISOString()
        };
    }

    private getDashboardOverview() {
        return {
            status: this.getAgentStatus(),
            health: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.floor(process.uptime()),
                wsClients: this.clients.size,
                memoryUsage: process.memoryUsage()
            },
            queue: this.getQueueSummary(),
            models: this.getModelsSummary(),
            connections: this.getConnectionsSummary(),
            security: this.getSecuritySummary(),
            memory: this.getMemoryStats(),
            chat: this.getChatSummary(),
            services: this.getServiceRegistry(),
            capabilities: this.getGatewayCapabilities()
        };
    }

    private setupMiddleware() {
        this.app.disable('x-powered-by');

        // CORS
        this.app.use(cors({
            origin: this.gatewayConfig.corsOrigins,
            credentials: true
        }));

        // Basic security headers
        this.app.use((_req: Request, res: Response, next: NextFunction) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            res.setHeader('Referrer-Policy', 'no-referrer');
            res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
            res.setHeader('Cache-Control', 'no-store');
            next();
        });

        // JSON parsing
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            // Slack Events API needs raw body for signature verification
            if (req.path === '/slack/events') return next();
            return express.json({ limit: '1mb' })(req, res, next);
        });
        this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

        // Request id for traceability
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            const requestId = req.headers['x-request-id'] || crypto.randomUUID();
            (req as any).requestId = requestId;
            res.setHeader('X-Request-Id', String(requestId));
            next();
        });

        // API rate limiting
        this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            const ip = req.ip || req.socket.remoteAddress || 'unknown';
            if (this.isRateLimited(ip)) {
                return res.status(429).json({
                    error: 'Too many requests. Slow down and retry shortly.',
                    requestId: (req as any).requestId
                });
            }
            next();
        });

        // API Key authentication (if configured)
        this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            const apiKey = this.gatewayConfig.apiKey;
            if (!apiKey) return next(); // No auth required

            const authHeader = (req.headers['authorization'] || '').toString();
            const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const providedKey = String(req.headers['x-api-key'] || req.query.apiKey || bearer || '');
            let authenticated = false;
            try {
                if (providedKey.length > 0 && providedKey.length === apiKey.length) {
                    authenticated = crypto.timingSafeEqual(
                        Buffer.from(providedKey, 'utf8'),
                        Buffer.from(apiKey, 'utf8')
                    );
                }
            } catch {
                authenticated = false;
            }
            if (!authenticated) {
                return res.status(401).json({
                    error: 'Invalid or missing API key',
                    requestId: (req as any).requestId
                });
            }
            next();
        });

        // Request logging
        this.app.use((req: Request, _res: Response, next: NextFunction) => {
            logger.debug(`Gateway: ${req.method} ${req.path}`);
            next();
        });

        // Static files for dashboard (if configured)
        if (this.gatewayConfig.staticDir) {
            if (fs.existsSync(this.gatewayConfig.staticDir)) {
                logger.info(`Gateway: Serving static files from ${this.gatewayConfig.staticDir}`);
                this.app.use(express.static(this.gatewayConfig.staticDir));
            } else {
                logger.warn(`Gateway: Static directory not found: ${this.gatewayConfig.staticDir}`);
            }
        }
    }

    private isRateLimited(ip: string): boolean {
        const now = Date.now();
        const windowMs = 60_000;
        const max = Math.max(30, Number(this.gatewayConfig.rateLimitPerMinute || 180));
        const bucket = this.requestBuckets.get(ip);

        if (!bucket || now - bucket.windowStart >= windowMs) {
            this.requestBuckets.set(ip, { count: 1, windowStart: now });
            return false;
        }

        bucket.count += 1;
        this.requestBuckets.set(ip, bucket);
        return bucket.count > max;
    }

    private getGatewayCapabilities() {
        return {
            auth: {
                apiKeyRequired: !!this.gatewayConfig.apiKey,
                acceptedHeaders: ['x-api-key', 'authorization: Bearer <key>'],
                timingSafe: true
            },
            transport: {
                restBase: '/api',
                websocket: '/'
            },
            api: {
                status: ['GET /api/status', 'GET /api/health', 'GET /api/doctor', 'GET /api/gateway/capabilities', 'GET /api/system/info'],
                dashboard: ['GET /api/dashboard/overview', 'GET /api/services', 'GET /api/services/:id'],
                dataHome: ['GET /api/data-home/summary', 'GET /api/data-home/tree', 'GET /api/data-home/file', 'GET /api/data-home/asset', 'PUT /api/data-home/file', 'POST /api/data-home/directory', 'POST /api/data-home/rename', 'DELETE /api/data-home/entry'],
                security: ['GET /api/security', 'GET /api/security/audit', 'PUT /api/security', 'GET /api/gateway/token/status', 'POST /api/gateway/token/rotate'],
                tasks: ['POST /api/tasks', 'GET /api/tasks', 'GET /api/tasks/:id', 'POST /api/tasks/:id/cancel', 'POST /api/tasks/clear', 'GET /api/queue/stats'],
                chat: ['POST /api/chat/send', 'GET /api/chat/history', 'GET /api/chat/export', 'POST /api/chat/clear'],
                memory: ['GET /api/memory', 'GET /api/memory/stats', 'GET /api/memory/search'],
                runtime: ['GET /api/models', 'PUT /api/models', 'GET /api/providers', 'GET /api/tokens', 'GET /api/connections', 'GET /api/tools', 'GET /api/security', 'PUT /api/security', 'GET /api/config', 'GET /api/config/:key', 'PUT /api/config/:key'],
                orchestrator: ['GET /api/orchestrator/agents', 'GET /api/orchestrator/tasks', 'POST /api/orchestrator/tasks/:id/cancel', 'POST /api/orchestrator/agents/:id/terminate'],
                skills: ['GET /api/skills', 'POST /api/skills/install', 'POST /api/skills/:name/execute', 'DELETE /api/skills/:name', 'GET /api/skills/health'],
                logs: ['GET /api/logs']
            },
            websocketActions: [
                'subscribe', 'pushTask', 'executeSkill', 'cancelAction', 'clearActionQueue',
                'cancelDelegatedTask', 'terminateAgent', 'getStatus', 'setConfig',
                'sendChatMessage', 'getChatHistory'
            ]
        };
    }

    private setupRoutes() {
        const router = express.Router();
        // ===== SLACK EVENTS API =====
        // Uses raw body parsing for signature verification
        this.app.post('/slack/events', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
            const signingSecret = this.config.get('slackSigningSecret');
            if (!signingSecret) {
                logger.warn('Slack Events API called but slackSigningSecret is not configured.');
                return res.status(500).json({ error: 'Slack signing secret not configured' });
            }

            const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
            if (!this.verifySlackSignature(req, rawBody, signingSecret)) {
                return res.status(401).json({ error: 'Invalid Slack signature' });
            }

            let payload: any = {};
            try {
                payload = rawBody ? JSON.parse(rawBody) : {};
            } catch {
                return res.status(400).json({ error: 'Invalid JSON payload' });
            }

            // URL verification handshake
            if (payload?.type === 'url_verification' && payload?.challenge) {
                return res.status(200).send(payload.challenge);
            }

            // Acknowledge quickly, then process async
            res.status(200).send('OK');

            try {
                if (this.agent.slack && payload?.type === 'event_callback') {
                    await this.agent.slack.handleEvent(payload);
                }
            } catch (error: any) {
                logger.warn(`Slack Events API processing error: ${error.message || error}`);
            }
        });

        // ===== STATUS & INFO =====
        router.get('/status', (_req: Request, res: Response) => {
            const status = this.getAgentStatus();
            res.json(status);
        });

        router.get('/health', (_req: Request, res: Response) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.floor(process.uptime()),
                wsClients: this.clients.size,
                memoryUsage: process.memoryUsage()
            });
        });

        router.get('/doctor', (req: Request, res: Response) => {
            const deep = String(req.query.deep || '').toLowerCase() === 'true';
            res.json(collectDoctorReport(this.config, { deep }));
        });

        router.get('/gateway/capabilities', (_req: Request, res: Response) => {
            res.json(this.getGatewayCapabilities());
        });

        router.get('/dashboard/overview', (_req: Request, res: Response) => {
            res.json(this.getDashboardOverview());
        });

        router.get('/services', (_req: Request, res: Response) => {
            res.json({ services: this.getServiceRegistry() });
        });

        router.get('/services/:id', (req: Request, res: Response) => {
            const snapshot = this.getServiceSnapshot(req.params.id);
            if (!snapshot) return res.status(404).json({ error: 'Service not found' });
            res.json(snapshot);
        });

        // ===== ORCBOT DATA HOME =====
        router.get('/data-home/summary', (_req: Request, res: Response) => {
            res.json(this.getDataHomeSummary());
        });

        router.get('/data-home/tree', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.query.path || '');
                const depth = Math.max(0, Math.min(5, parseInt(String(req.query.depth || '2'), 10) || 2));
                const target = this.resolveDataHomeTarget(requestedPath);
                if (!fs.existsSync(target.absolutePath)) {
                    return res.status(404).json({ error: 'Path not found' });
                }
                res.json({
                    root: this.getDataHome(),
                    requestedPath: target.relativePath,
                    entry: this.describeDataHomeEntry(target.absolutePath, target.relativePath, depth)
                });
            } catch (error: any) {
                res.status(400).json({ error: error.message });
            }
        });

        router.get('/data-home/file', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.query.path || '').trim();
                if (!requestedPath) {
                    return res.status(400).json({ error: 'path query is required' });
                }
                const target = this.resolveDataHomeTarget(requestedPath);
                if (!fs.existsSync(target.absolutePath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                const stats = fs.statSync(target.absolutePath);
                if (!stats.isFile()) {
                    return res.status(400).json({ error: 'Requested path is not a file' });
                }
                const mimeType = this.getDataHomeMimeType(target.absolutePath);
                const isText = this.isTextDataHomeFile(target.absolutePath, mimeType);
                const previewKind = this.getDataHomePreviewKind(mimeType);
                let content: string | null = null;

                if (isText) {
                    if (stats.size > GatewayServer.DATA_HOME_TEXT_LIMIT_BYTES) {
                        return res.status(413).json({ error: `File too large to read via gateway API (limit ${GatewayServer.DATA_HOME_TEXT_LIMIT_BYTES} bytes)` });
                    }
                    content = fs.readFileSync(target.absolutePath, 'utf8');
                }

                res.json({
                    root: this.getDataHome(),
                    path: target.relativePath,
                    size: stats.size,
                    modifiedAt: stats.mtime.toISOString(),
                    mimeType,
                    isText,
                    previewKind,
                    content
                });
            } catch (error: any) {
                res.status(400).json({ error: error.message });
            }
        });

        router.get('/data-home/asset', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.query.path || '').trim();
                if (!requestedPath) {
                    return res.status(400).json({ error: 'path query is required' });
                }
                const target = this.resolveDataHomeTarget(requestedPath);
                if (!fs.existsSync(target.absolutePath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                const stats = fs.statSync(target.absolutePath);
                if (!stats.isFile()) {
                    return res.status(400).json({ error: 'Requested path is not a file' });
                }

                const mimeType = this.getDataHomeMimeType(target.absolutePath);
                const dispositionMode = String(req.query.download || '').toLowerCase() === 'true' ? 'attachment' : 'inline';
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Length', String(stats.size));
                res.setHeader('Content-Disposition', `${dispositionMode}; filename="${path.basename(target.absolutePath).replace(/"/g, '')}"`);
                res.sendFile(target.absolutePath);
            } catch (error: any) {
                res.status(400).json({ error: error.message });
            }
        });

        router.put('/data-home/file', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.body?.path || '').trim();
                const content = req.body?.content;
                if (!requestedPath) {
                    return res.status(400).json({ error: 'path is required' });
                }
                if (typeof content !== 'string') {
                    return res.status(400).json({ error: 'content must be a string' });
                }
                const target = this.resolveDataHomeTarget(requestedPath);
                fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
                fs.writeFileSync(target.absolutePath, content, 'utf8');
                const stats = fs.statSync(target.absolutePath);
                res.json({ success: true, path: target.relativePath, size: stats.size, modifiedAt: stats.mtime.toISOString() });
            } catch (error: any) {
                res.status(400).json({ error: error.message });
            }
        });

        router.post('/data-home/directory', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.body?.path || '').trim();
                if (!requestedPath) {
                    return res.status(400).json({ error: 'path is required' });
                }
                const target = this.resolveDataHomeTarget(requestedPath);
                fs.mkdirSync(target.absolutePath, { recursive: true });
                res.json({ success: true, path: target.relativePath });
            } catch (error: any) {
                res.status(400).json({ error: error.message });
            }
        });

        router.post('/data-home/rename', (req: Request, res: Response) => {
            try {
                const fromPath = String(req.body?.fromPath || '').trim();
                const toPath = String(req.body?.toPath || '').trim();
                if (!fromPath || !toPath) {
                    return res.status(400).json({ error: 'fromPath and toPath are required' });
                }

                const result = this.renameDataHomeEntry(fromPath, toPath);
                res.json({ success: true, ...result });
            } catch (error: any) {
                const message = String(error?.message || error);
                const status = message.includes('already exists') ? 409 : (message.includes('not found') ? 404 : 400);
                res.status(status).json({ error: message });
            }
        });

        router.delete('/data-home/entry', (req: Request, res: Response) => {
            try {
                const requestedPath = String(req.query.path || '').trim();
                if (!requestedPath) {
                    return res.status(400).json({ error: 'path query is required' });
                }

                const result = this.deleteDataHomeEntry(requestedPath);
                res.json({ success: true, ...result });
            } catch (error: any) {
                const message = String(error?.message || error);
                const status = message.includes('not found') ? 404 : 400;
                res.status(status).json({ error: message });
            }
        });

        // ===== GATEWAY TOKEN MANAGEMENT =====
        router.get('/gateway/token/status', (_req: Request, res: Response) => {
            const token = this.gatewayConfig.apiKey || this.config.get('gatewayApiKey');
            const isSet = !!token;
            const partial = isSet && token!.length >= 8
                ? `${token!.slice(0, 4)}${'*'.repeat(Math.max(0, token!.length - 8))}${token!.slice(-4)}`
                : (isSet ? '****' : null);
            res.json({
                authEnabled: isSet,
                tokenPartial: partial,
                tokenLength: isSet ? token!.length : 0,
                hint: isSet
                    ? 'Authentication is enabled. Pass token via X-Api-Key header or ?apiKey= query param.'
                    : 'No API key configured — gateway is open. Set gatewayApiKey in config or POST /api/gateway/token/rotate to generate one.'
            });
        });

        router.post('/gateway/token/rotate', (_req: Request, res: Response) => {
            try {
                const newToken = crypto.randomBytes(32).toString('hex');
                this.config.set('gatewayApiKey', newToken);
                // Hot-update the running instance
                this.gatewayConfig.apiKey = newToken;
                const partial = `${newToken.slice(0, 4)}${'*'.repeat(newToken.length - 8)}${newToken.slice(-4)}`;
                logger.info('Gateway: API token rotated via /gateway/token/rotate');
                res.json({
                    success: true,
                    message: 'Token rotated. Copy it now — it will not be shown again in full.',
                    token: newToken,
                    tokenPartial: partial
                });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/system/info', (_req: Request, res: Response) => {
            const cpus = require('os').cpus?.() || [];
            res.json({
                platform: process.platform,
                nodeVersion: process.version,
                pid: process.pid,
                uptimeSeconds: Math.floor(process.uptime()),
                cpuCount: cpus.length,
                cwd: process.cwd(),
                wsClients: this.clients.size
            });
        });

        // ===== TASK MANAGEMENT =====
        router.post('/tasks', async (req: Request, res: Response) => {
            try {
                const { task, priority = 5, metadata = {} } = req.body;
                if (!task) {
                    return res.status(400).json({ error: 'Task description required' });
                }
                await this.agent.pushTask(task, priority, metadata);
                res.json({ success: true, message: 'Task pushed' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/tasks', (_req: Request, res: Response) => {
            const queue = this.agent.actionQueue?.getQueue() || [];
            res.json({ tasks: queue });
        });

        router.get('/tasks/:id', (req: Request, res: Response) => {
            const { id } = req.params;
            const task = this.agent.actionQueue?.getAction(id);
            if (!task) return res.status(404).json({ error: 'Task not found' });
            res.json({ task });
        });

        router.get('/queue/stats', (_req: Request, res: Response) => {
            const counts = this.agent.actionQueue?.getCounts?.() || {
                pending: 0,
                waiting: 0,
                'in-progress': 0,
                completed: 0,
                failed: 0
            };
            const active = this.agent.actionQueue?.getActive?.() || [];
            res.json({ counts, activeCount: active.length });
        });

        router.post('/tasks/:id/cancel', (req: Request, res: Response) => {
            const { id } = req.params;
            const { reason } = req.body || {};
            const result = this.agent.cancelAction(id, reason);
            res.json(result);
        });

        router.post('/tasks/clear', (req: Request, res: Response) => {
            const { reason } = req.body || {};
            const result = this.agent.clearActionQueue(reason);
            res.json(result);
        });

        // ===== ORCHESTRATOR =====
        router.get('/orchestrator/agents', (_req: Request, res: Response) => {
            const agents = this.agent.orchestrator.getDetailedWorkerStatus();
            res.json({ agents });
        });

        router.get('/orchestrator/tasks', (_req: Request, res: Response) => {
            const tasks = this.agent.orchestrator.getTasks();
            res.json({ tasks });
        });

        router.post('/orchestrator/tasks/:id/cancel', (req: Request, res: Response) => {
            const { id } = req.params;
            const { reason } = req.body || {};
            const result = this.agent.cancelDelegatedTask(id, reason);
            res.json(result);
        });

        router.post('/orchestrator/agents/:id/terminate', (req: Request, res: Response) => {
            const { id } = req.params;
            const result = this.agent.terminateAgentInstance(id);
            res.json(result);
        });

        // ===== SKILLS MANAGEMENT =====
        router.get('/skills', (_req: Request, res: Response) => {
            const skills = this.agent.skills.getAllSkills().map(s => ({
                name: s.name,
                description: s.description,
                usage: s.usage,
                isPlugin: !!s.pluginPath,
                pluginPath: s.pluginPath
            }));
            res.json({ skills });
        });

        router.post('/skills/:name/execute', async (req: Request, res: Response) => {
            try {
                const { name } = req.params;
                const args = req.body;
                const result = await this.agent.skills.executeSkill(name, args);
                res.json({ success: true, result });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/skills/health', async (_req: Request, res: Response) => {
            try {
                const health = await this.agent.skills.checkPluginsHealth();
                res.json(health);
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/skills/install', async (req: Request, res: Response) => {
            try {
                const { packageRef } = req.body;
                if (!packageRef || typeof packageRef !== 'string') {
                    return res.status(400).json({ error: 'packageRef is required (e.g. "firecrawl/cli", "npm:some-package", or a URL)' });
                }
                if (typeof (this.agent.skills as any).installSkillFromNpm === 'function') {
                    const result = await (this.agent.skills as any).installSkillFromNpm(packageRef);
                    return res.json(result);
                }
                return res.status(501).json({ error: 'Skill install not available in this build' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.delete('/skills/:name', (req: Request, res: Response) => {
            try {
                const { name } = req.params;
                const skill = this.agent.skills.getAllSkills().find(s => s.name === name);
                if (!skill) return res.status(404).json({ error: `Skill '${name}' not found` });
                if (!skill.pluginPath) return res.status(403).json({ error: `Skill '${name}' is a built-in and cannot be removed` });
                const message = this.agent.skills.uninstallSkill(name);
                const success = message.startsWith('Successfully');
                res.json({ success, message });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== CONFIGURATION =====
        router.get('/config', (_req: Request, res: Response) => {
            // Return safe config (hide sensitive values)
            const safeConfig = this.getSafeConfig();
            res.json({ config: safeConfig });
        });

        router.get('/config/:key', (req: Request, res: Response) => {
            const { key } = req.params;
            const value = this.config.get(key);
            const isSensitive = this.isSensitiveKey(key);
            res.json({
                key,
                value: isSensitive ? (value ? '***SET***' : null) : value,
                sensitive: isSensitive
            });
        });

        router.put('/config/:key', (req: Request, res: Response) => {
            try {
                const { key } = req.params;
                const { value } = req.body;
                this.config.set(key, value);
                res.json({ success: true, key, message: 'Configuration updated' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== MEMORY =====
        router.get('/memory', (_req: Request, res: Response) => {
            const memories = this.agent.memory?.getRecentContext(50) || [];
            res.json({ memories });
        });

        router.get('/memory/stats', (_req: Request, res: Response) => {
            res.json(this.getMemoryStats());
        });

        router.get('/memory/search', (req: Request, res: Response) => {
            try {
                const type = String(req.query.type || 'short') as 'short' | 'episodic' | 'long';
                const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '25'), 10) || 25));
                const query = String(req.query.query || '').trim().toLowerCase();

                let items = this.agent.memory.searchMemory(type as any) || [];
                if (query) {
                    items = items.filter((m: any) => (m.content || '').toLowerCase().includes(query));
                }
                const recent = items
                    .slice()
                    .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                    .slice(0, limit);

                res.json({ type, query: query || null, count: recent.length, memories: recent });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== CONNECTIONS / CHANNELS =====
        router.get('/connections', (_req: Request, res: Response) => {
            const connections = this.getConnectionsSummary();
            res.json({ connections });
        });

        router.put('/connections/:channel', (req: Request, res: Response) => {
            const { channel } = req.params;
            const settings = req.body;

            try {
                if (channel === 'telegram') {
                    if (settings.token !== undefined) this.config.set('telegramToken', settings.token);
                    if (settings.autoReply !== undefined) this.config.set('telegramAutoReplyEnabled', settings.autoReply);
                } else if (channel === 'whatsapp') {
                    if (settings.enabled !== undefined) this.config.set('whatsappEnabled', settings.enabled);
                    if (settings.autoReply !== undefined) this.config.set('whatsappAutoReplyEnabled', settings.autoReply);
                    if (settings.statusReply !== undefined) this.config.set('whatsappStatusReplyEnabled', settings.statusReply);
                    if (settings.autoReact !== undefined) this.config.set('whatsappAutoReactEnabled', settings.autoReact);
                } else if (channel === 'discord') {
                    if (settings.token !== undefined) this.config.set('discordToken', settings.token);
                    if (settings.autoReply !== undefined) this.config.set('discordAutoReplyEnabled', settings.autoReply);
                } else {
                    return res.status(400).json({ error: 'Unknown channel' });
                }
                res.json({ success: true, message: `${channel} settings updated` });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== AI MODELS =====
        router.get('/models', (_req: Request, res: Response) => {
            const models = this.getModelsSummary();
            res.json(models);
        });

        router.get('/providers', (_req: Request, res: Response) => {
            res.json({
                activeModel: this.config.get('modelName'),
                providerMode: this.config.get('llmProvider') || 'auto',
                configuredProviders: this.getConfiguredProviders()
            });
        });

        router.put('/models', (req: Request, res: Response) => {
            try {
                const { modelName, provider } = req.body;
                if (modelName) this.config.set('modelName', modelName);
                if (provider !== undefined) this.config.set('llmProvider', provider || undefined);
                res.json({ success: true, message: 'Model settings updated' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== TOKENS & USAGE =====
        router.get('/tokens', (_req: Request, res: Response) => {
            const tracker = (this.agent as any).tokenTracker;
            if (!tracker) {
                return res.json({ available: false });
            }
            res.json({
                available: true,
                session: tracker.getSessionUsage(),
                total: tracker.getTotalUsage()
            });
        });

        router.get('/tools', (_req: Request, res: Response) => {
            const tools = this.agent.tools.listTools();
            res.json({ tools });
        });

        // ===== AGENT CONTROL =====
        router.post('/agent/start', async (_req: Request, res: Response) => {
            try {
                // Note: This starts the agent loop in-process
                // For background operation, use the CLI daemon mode
                this.agent.start().catch(err => logger.error(`Agent error: ${err}`));
                res.json({ success: true, message: 'Agent loop started' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/agent/stop', (_req: Request, res: Response) => {
            try {
                this.agent.stop();
                res.json({ success: true, message: 'Agent stopped' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== LOGS =====
        router.get('/logs', (req: Request, res: Response) => {
            const lines = parseInt(req.query.lines as string) || 200;
            const level = req.query.level as string; // Filter by log level (info, error, warn, debug)
            const search = req.query.search as string; // Search term
            const availableLogFiles = this.getAvailableLogFiles();
            const logPath = availableLogFiles[0];

            if (!logPath) {
                return res.json({ logs: [], total: 0, source: null, sources: [] });
            }

            try {
                const content = fs.readFileSync(logPath, 'utf8');
                let logLines = content.split('\n').filter(Boolean);
                
                // Filter by level if provided
                if (level) {
                    const levelPattern = new RegExp(`\\b${level}\\b`, 'i');
                    logLines = logLines.filter(line => levelPattern.test(line));
                }
                
                // Search filter if provided
                if (search) {
                    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const searchPattern = new RegExp(escapedSearch, 'i');
                    logLines = logLines.filter(line => searchPattern.test(line));
                }
                
                const total = logLines.length;
                const recentLogs = logLines.slice(-lines);
                
                res.json({ 
                    logs: recentLogs, 
                    total,
                    filtered: !!level || !!search,
                    source: logPath,
                    sources: availableLogFiles
                });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== SECURITY =====
        router.get('/security', (_req: Request, res: Response) => {
            res.json(this.getSecuritySummary());
        });

        router.get('/security/audit', (req: Request, res: Response) => {
            const deep = String(req.query.deep || '').toLowerCase() === 'true';
            const report = collectDoctorReport(this.config, { deep });
            const findings = report.findings.filter(f => f.area === 'security' || f.area === 'gateway' || f.area === 'channels');

            res.json({
                ...report,
                summary: {
                    critical: findings.filter(f => f.severity === 'critical').length,
                    warn: findings.filter(f => f.severity === 'warn').length,
                    info: findings.filter(f => f.severity === 'info').length,
                    ok: Math.max(0, 6 - findings.filter(f => f.severity !== 'info').length)
                },
                findings
            });
        });

        router.put('/security', (req: Request, res: Response) => {
            try {
                const { safeMode, autoExecuteCommands, pluginAllowList, pluginDenyList } = req.body;
                if (safeMode !== undefined) this.config.set('safeMode', safeMode);
                if (autoExecuteCommands !== undefined) this.config.set('autoExecuteCommands', autoExecuteCommands);
                if (pluginAllowList !== undefined) this.config.set('pluginAllowList', pluginAllowList);
                if (pluginDenyList !== undefined) this.config.set('pluginDenyList', pluginDenyList);
                res.json({ success: true, message: 'Security settings updated' });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== CHAT =====
        router.post('/chat/send', async (req: Request, res: Response) => {
            try {
                const { message, metadata = {} } = req.body;
                if (!message) {
                    return res.status(400).json({ error: 'Message is required' });
                }

                const messageId = await this.handleChatMessage(message, metadata);
                res.json({ success: true, messageId });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/chat/history', (_req: Request, res: Response) => {
            try {
                const chatMessages = this.getChatHistory();
                res.json({ messages: chatMessages });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/chat/export', (_req: Request, res: Response) => {
            try {
                const messages = this.getChatHistory();
                res.json({
                    exportedAt: new Date().toISOString(),
                    count: messages.length,
                    messages
                });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/chat/clear', (_req: Request, res: Response) => {
            try {
                // Note: This broadcasts a cleared event but doesn't remove messages from memory storage.
                // Chat history will still be available if the page is refreshed.
                // Full message deletion would require memory manager enhancements.
                this.broadcast({
                    type: 'chat:cleared',
                    timestamp: new Date().toISOString()
                });
                res.json({ 
                    success: true, 
                    message: 'Chat display cleared (note: history persists in memory storage)' 
                });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.use('/api', router);

        // API not found handler
        this.app.use('/api', (_req: Request, res: Response) => {
            res.status(404).json({
                error: 'API route not found',
                hint: 'Use GET /api/gateway/capabilities to discover available endpoints'
            });
        });

        // Catch-all for SPA routing (if dashboard is served)
        this.app.get('*', (req: Request, res: Response) => {
            if (this.gatewayConfig.staticDir) {
                const indexPath = path.join(this.gatewayConfig.staticDir, 'index.html');
                if (fs.existsSync(indexPath)) {
                    return res.sendFile(indexPath);
                }
            }
            res.status(404).json({ error: 'Not found' });
        });

        // Global error boundary
        this.app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
            logger.error(`Gateway unhandled error: ${err?.stack || err}`);
            res.status(500).json({
                error: 'Internal gateway error',
                requestId: (req as any).requestId
            });
        });
    }

    private setupWebSocket() {
        this.wss.on('connection', (ws: WebSocket, req) => {
            if (this.gatewayConfig.apiKey) {
                try {
                    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                    const wsApiKey = requestUrl.searchParams.get('apiKey') || requestUrl.searchParams.get('key');
                    if (wsApiKey !== this.gatewayConfig.apiKey) {
                        ws.close(1008, 'Unauthorized');
                        return;
                    }
                } catch {
                    ws.close(1008, 'Unauthorized');
                    return;
                }
            }

            logger.info(`Gateway: WebSocket client connected from ${req.socket.remoteAddress}`);
            this.clients.add(ws);

            // Send initial status
            ws.send(JSON.stringify({
                type: 'status',
                data: this.getAgentStatus()
            }));

            ws.on('message', async (message: string) => {
                try {
                    const data = JSON.parse(message.toString());
                    await this.handleWebSocketMessage(ws, data);
                } catch (error: any) {
                    ws.send(JSON.stringify({ type: 'error', error: error.message }));
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.debug('Gateway: WebSocket client disconnected');
            });

            ws.on('error', (error) => {
                logger.error(`Gateway WebSocket error: ${error}`);
                this.clients.delete(ws);
            });
        });
    }

    private async handleWebSocketMessage(ws: WebSocket, data: any) {
        const { action, payload } = data;

        switch (action) {
            case 'subscribe':
                // Client wants to subscribe to events
                ws.send(JSON.stringify({ type: 'subscribed', events: payload?.events || ['all'] }));
                break;

            case 'pushTask':
                await this.agent.pushTask(payload.task, payload.priority || 5, payload.metadata || {});
                ws.send(JSON.stringify({ type: 'taskPushed', success: true }));
                break;

            case 'executeSkill':
                try {
                    const result = await this.agent.skills.executeSkill(payload.name, payload.args || {});
                    ws.send(JSON.stringify({ type: 'skillResult', name: payload.name, result }));
                } catch (error: any) {
                    ws.send(JSON.stringify({ type: 'skillError', name: payload.name, error: error.message }));
                }
                break;

            case 'cancelAction': {
                const result = this.agent.cancelAction(payload.actionId, payload.reason);
                ws.send(JSON.stringify({ type: 'actionCancelled', result }));
                break;
            }

            case 'clearActionQueue': {
                const result = this.agent.clearActionQueue(payload.reason);
                ws.send(JSON.stringify({ type: 'actionQueueCleared', result }));
                break;
            }

            case 'cancelDelegatedTask': {
                const result = this.agent.cancelDelegatedTask(payload.taskId, payload.reason);
                ws.send(JSON.stringify({ type: 'delegatedTaskCancelled', result }));
                break;
            }

            case 'terminateAgent': {
                const result = this.agent.terminateAgentInstance(payload.agentId);
                ws.send(JSON.stringify({ type: 'agentTerminated', result }));
                break;
            }

            case 'getStatus':
                ws.send(JSON.stringify({ type: 'status', data: this.getAgentStatus() }));
                break;

            case 'setConfig':
                this.config.set(payload.key, payload.value);
                ws.send(JSON.stringify({ type: 'configUpdated', key: payload.key }));
                break;

            case 'sendChatMessage': {
                try {
                    const { message, metadata = {} } = payload;
                    if (!message) {
                        ws.send(JSON.stringify({ type: 'error', error: 'Message is required' }));
                        break;
                    }

                    const messageId = await this.handleChatMessage(message, metadata);
                    ws.send(JSON.stringify({ type: 'chatMessageSent', success: true, messageId }));
                } catch (error: any) {
                    ws.send(JSON.stringify({ type: 'error', error: error.message }));
                }
                break;
            }

            case 'getChatHistory': {
                try {
                    const chatMessages = this.getChatHistory();
                    ws.send(JSON.stringify({ type: 'chatHistory', messages: chatMessages }));
                } catch (error: any) {
                    ws.send(JSON.stringify({ type: 'error', error: error.message }));
                }
                break;
            }

            default:
                ws.send(JSON.stringify({ type: 'error', error: `Unknown action: ${action}` }));
        }
    }

    private setupEventForwarding() {
        // Forward agent events to WebSocket clients
        const events = [
            'agent:thinking',
            'agent:action',
            'agent:observation',
            'agent:completed',
            'agent:error',
            'memory:saved',
            'action:push',
            'action:queued',
            'scheduler:tick'
        ];

        events.forEach(event => {
            eventBus.on(event, (data: any) => {
                this.broadcast({
                    type: 'event',
                    event,
                    data,
                    timestamp: new Date().toISOString()
                });
            });
        });

        // Listen for gateway chat responses from the agent
        eventBus.on('gateway:chat:response', (data: any) => {
            this.broadcast(data);
        });

        // Listen for gateway file deliveries (images, documents) from the agent
        eventBus.on('gateway:chat:file', (data: any) => {
            this.broadcast(data);
        });
    }

    private broadcast(message: any) {
        const payload = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    private agentLoopStarted: boolean = false;

    public setAgentLoopStarted(started: boolean) {
        this.agentLoopStarted = started;
    }

    private getAgentStatus() {
        const dataDir = this.getDataHome();
        const lockPath = path.join(dataDir, 'orcbot.lock');
        let lockFileValid = false;
        let lockInfo = null;

        if (fs.existsSync(lockPath)) {
            try {
                lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                // Check if the process is actually running
                try {
                    process.kill(lockInfo.pid, 0);
                    lockFileValid = true;
                } catch {
                    // Process not running, stale lock
                    lockFileValid = false;
                }
            } catch {}
        }

        // Determine running state
        const isAgentRunning = lockFileValid || this.agentLoopStarted || this.agent.isRunning;

        return {
            running: isAgentRunning,
            mode: (this.agentLoopStarted || this.agent.isRunning) ? 'full' : (lockFileValid ? 'external' : 'gateway-only'),
            modeDescription: (this.agentLoopStarted || this.agent.isRunning)
                ? 'Gateway + Agent Loop'
                : (lockFileValid ? 'Agent running externally' : 'Gateway only (use --with-agent to start agent)'),
            lockInfo,
            model: this.config.get('modelName'),
            provider: this.config.get('llmProvider') || 'auto',
            inferredProvider: this.inferProviderFromModel(this.config.get('modelName') || ''),
            configuredProviders: this.getConfiguredProviders(),
            channels: {
                telegram: !!this.config.get('telegramToken'),
                whatsapp: this.config.get('whatsappEnabled') || false
            },
            safeMode: this.config.get('safeMode') || false,
            skillCount: this.agent.skills.getAllSkills().length,
            timestamp: new Date().toISOString()
        };
    }

    private getSafeConfig(): Record<string, any> {
        const sensitiveKeys = [
            'openaiApiKey', 'googleApiKey', 'openrouterApiKey', 'telegramToken', 'discordToken',
            'serperApiKey', 'braveSearchApiKey', 'captchaApiKey', 'gatewayApiKey',
            'bedrockAccessKeyId', 'bedrockSecretAccessKey', 'bedrockSessionToken',
            'nvidiaApiKey'
        ];

        const allConfig: Record<string, any> = {};
        const configKeys = [
            'modelName', 'llmProvider', 'safeMode', 'autoExecuteCommands',
            'telegramAutoReplyEnabled', 'whatsappEnabled', 'whatsappAutoReplyEnabled',
            'whatsappStatusReplyEnabled', 'whatsappAutoReactEnabled', 'whatsappContextProfilingEnabled',
            'discordAutoReplyEnabled',
            'memoryContextLimit', 'memoryEpisodicLimit', 'memoryConsolidationThreshold',
            'progressFeedbackEnabled', 'gatewayPort', 'gatewayHost',
            ...sensitiveKeys
        ];

        configKeys.forEach(key => {
            const value = this.config.get(key);
            if (sensitiveKeys.includes(key)) {
                allConfig[key] = value ? '***SET***' : null;
            } else {
                allConfig[key] = value;
            }
        });

        // Add provider alias for backwards compatibility
        allConfig.provider = allConfig.llmProvider || 'auto';

        // Add list of configured providers
        allConfig.configuredProviders = this.getConfiguredProviders();

        return allConfig;
    }

    private getConfiguredProviders(): { name: string; configured: boolean; isActive?: boolean }[] {
        const modelName = (this.config.get('modelName') || '').toLowerCase();
        const explicitProvider = this.config.get('llmProvider');
        
        // Infer which provider would be used for current model
        let inferredProvider = 'openai'; // default
        if (modelName.startsWith('ollama:') || modelName.startsWith('local:')) inferredProvider = 'ollama';
        else if (modelName.includes('gemini')) inferredProvider = 'google';
        else if (modelName.includes('claude')) inferredProvider = 'anthropic';
        else if (modelName.includes('llama') || modelName.includes('mixtral')) inferredProvider = 'openrouter';
        else if (modelName.includes('gpt') || modelName.includes('o1') || modelName.includes('o3')) inferredProvider = 'openai';
        
        const activeProvider = explicitProvider || inferredProvider;

        return [
            { name: 'openai', configured: !!this.config.get('openaiApiKey'), isActive: activeProvider === 'openai' },
            { name: 'google', configured: !!this.config.get('googleApiKey'), isActive: activeProvider === 'google' },
            { name: 'openrouter', configured: !!this.config.get('openrouterApiKey'), isActive: activeProvider === 'openrouter' },
            { name: 'nvidia', configured: !!this.config.get('nvidiaApiKey'), isActive: activeProvider === 'nvidia' },
            { name: 'bedrock', configured: !!this.config.get('bedrockAccessKeyId'), isActive: activeProvider === 'bedrock' }
        ];
    }

    private isSensitiveKey(key: string): boolean {
        const sensitivePatterns = ['key', 'token', 'secret', 'password', 'credential'];
        const lowerKey = key.toLowerCase();
        return sensitivePatterns.some(p => lowerKey.includes(p));
    }

    private inferProviderFromModel(modelName: string): string {
        const model = modelName.toLowerCase();
        if (model.startsWith('ollama:') || model.startsWith('local:')) return 'ollama';
        if (model.includes('gemini')) return 'google';
        if (model.includes('claude')) return 'anthropic';
        if (model.includes('llama') || model.includes('mixtral')) return 'openrouter';
        if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai';
        return 'openai'; // default
    }

    public async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(this.gatewayConfig.port, this.gatewayConfig.host, () => {
                logger.info(`Gateway server running at http://${this.gatewayConfig.host}:${this.gatewayConfig.port}`);
                logger.info(`WebSocket available at ws://${this.gatewayConfig.host}:${this.gatewayConfig.port}`);
                resolve();
            });
        });
    }

    public stop(): void {
        this.clients.forEach(client => client.close());
        this.wss.close();
        this.server.close();
        logger.info('Gateway server stopped');
    }
}

export default GatewayServer;
