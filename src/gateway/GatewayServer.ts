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
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';

export interface GatewayConfig {
    port: number;
    host: string;
    apiKey?: string;
    corsOrigins?: string[];
    staticDir?: string;
}

export class GatewayServer {
    private app: express.Application;
    private server: http.Server;
    private wss: WebSocketServer;
    private agent: Agent;
    private config: ConfigManager;
    private gatewayConfig: GatewayConfig;
    private clients: Set<WebSocket> = new Set();

    constructor(agent: Agent, config: ConfigManager, gatewayConfig: Partial<GatewayConfig> = {}) {
        this.agent = agent;
        this.config = config;
        // Resolve staticDir to absolute path
        let resolvedStaticDir = gatewayConfig.staticDir;
        if (resolvedStaticDir) {
            resolvedStaticDir = path.resolve(process.cwd(), resolvedStaticDir);
        }

        this.gatewayConfig = {
            port: gatewayConfig.port || config.get('gatewayPort') || 3100,
            host: gatewayConfig.host || config.get('gatewayHost') || '0.0.0.0',
            apiKey: gatewayConfig.apiKey || config.get('gatewayApiKey'),
            corsOrigins: gatewayConfig.corsOrigins || config.get('gatewayCorsOrigins') || ['*'],
            staticDir: resolvedStaticDir
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

    /**
     * Save a chat message to memory and broadcast it
     */
    private async handleChatMessage(message: string, metadata: any = {}): Promise<string> {
        const messageId = this.generateMessageId();
        
        // Save user message to memory
        this.agent.memory.saveMemory({
            id: messageId,
            type: 'short',
            content: `User (Gateway Chat): ${message}`,
            timestamp: new Date().toISOString(),
            metadata: { source: 'gateway-chat', role: 'user', ...metadata }
        });

        // Push task to agent to respond
        await this.agent.pushTask(
            `Gateway chat message: "${message}"`,
            10,
            {
                source: 'gateway-chat',
                expectResponse: true,
                messageId,
                ...metadata
            }
        );

        // Broadcast message to WebSocket clients
        this.broadcast({
            type: 'chat:message',
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
            messageId
        });

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

    private setupMiddleware() {
        // CORS
        this.app.use(cors({
            origin: this.gatewayConfig.corsOrigins,
            credentials: true
        }));

        // JSON parsing
        this.app.use(express.json());

        // API Key authentication (if configured)
        this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            const apiKey = this.gatewayConfig.apiKey;
            if (!apiKey) return next(); // No auth required

            const providedKey = req.headers['x-api-key'] || req.query.apiKey;
            if (providedKey !== apiKey) {
                return res.status(401).json({ error: 'Invalid or missing API key' });
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

    private setupRoutes() {
        const router = express.Router();

        // ===== STATUS & INFO =====
        router.get('/status', (_req: Request, res: Response) => {
            const status = this.getAgentStatus();
            res.json(status);
        });

        router.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
            const agents = this.agent.orchestrator.getAgents();
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
            const dataDir = this.config.get('dataDir') || path.join(process.env.HOME || '', '.orcbot');
            const memoryPath = path.join(dataDir, 'memory.json');
            
            let stats = { totalMemories: 0, fileSize: 0 };
            if (fs.existsSync(memoryPath)) {
                const content = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
                stats.totalMemories = content.length || 0;
                stats.fileSize = fs.statSync(memoryPath).size;
            }
            res.json(stats);
        });

        // ===== CONNECTIONS / CHANNELS =====
        router.get('/connections', (_req: Request, res: Response) => {
            const connections = {
                telegram: {
                    configured: !!this.config.get('telegramToken'),
                    autoReply: this.config.get('telegramAutoReplyEnabled') || false
                },
                whatsapp: {
                    enabled: this.config.get('whatsappEnabled') || false,
                    autoReply: this.config.get('whatsappAutoReplyEnabled') || false,
                    linkedAccount: this.config.get('whatsappOwnerJID') || null
                }
            };
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
            const models = {
                currentModel: this.config.get('modelName'),
                provider: this.config.get('llmProvider') || 'auto',
                providers: {
                    openai: { configured: !!this.config.get('openaiApiKey') },
                    google: { configured: !!this.config.get('googleApiKey') },
                    openrouter: { configured: !!this.config.get('openrouterApiKey') },
                    bedrock: { configured: !!this.config.get('bedrockAccessKeyId') }
                }
            };
            res.json(models);
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
            const lines = parseInt(req.query.lines as string) || 100;
            const dataDir = this.config.get('dataDir') || path.join(process.env.HOME || '', '.orcbot');
            const logPath = path.join(dataDir, 'foreground.log');

            if (!fs.existsSync(logPath)) {
                return res.json({ logs: [] });
            }

            try {
                const content = fs.readFileSync(logPath, 'utf8');
                const logLines = content.split('\n').filter(Boolean).slice(-lines);
                res.json({ logs: logLines });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        // ===== SECURITY =====
        router.get('/security', (_req: Request, res: Response) => {
            res.json({
                safeMode: this.config.get('safeMode') || false,
                autoExecuteCommands: this.config.get('autoExecuteCommands') || false,
                pluginAllowList: this.config.get('pluginAllowList') || [],
                pluginDenyList: this.config.get('pluginDenyList') || []
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
    }

    private setupWebSocket() {
        this.wss.on('connection', (ws: WebSocket, req) => {
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
        const dataDir = this.config.get('dataDir') || path.join(process.env.HOME || '', '.orcbot');
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
        const isAgentRunning = lockFileValid || this.agentLoopStarted;

        return {
            running: isAgentRunning,
            mode: this.agentLoopStarted ? 'full' : (lockFileValid ? 'external' : 'gateway-only'),
            modeDescription: this.agentLoopStarted 
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
            'openaiApiKey', 'googleApiKey', 'openrouterApiKey', 'telegramToken',
            'serperApiKey', 'braveSearchApiKey', 'captchaApiKey', 'gatewayApiKey',
            'bedrockAccessKeyId', 'bedrockSecretAccessKey', 'bedrockSessionToken',
            'nvidiaApiKey'
        ];

        const allConfig: Record<string, any> = {};
        const configKeys = [
            'modelName', 'llmProvider', 'safeMode', 'autoExecuteCommands',
            'telegramAutoReplyEnabled', 'whatsappEnabled', 'whatsappAutoReplyEnabled',
            'whatsappStatusReplyEnabled', 'whatsappAutoReactEnabled', 'whatsappContextProfilingEnabled',
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
        if (modelName.includes('gemini')) inferredProvider = 'google';
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
