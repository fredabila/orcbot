/**
 * AgentWorker - Standalone worker process for multi-agent orchestration
 * 
 * This file runs as an independent child process spawned by the AgentOrchestrator.
 * Each worker has its own Agent instance with isolated memory and executes tasks
 * assigned to it via IPC (Inter-Process Communication).
 */

import { Agent } from './Agent';
import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../utils/logger';
import yaml from 'yaml';
import path from 'path';
import fs from 'fs';

interface WorkerConfig {
    agentId: string;
    name: string;
    role: string;
    capabilities: string[];
    memoryPath: string;
    profilePath: string;
    parentDataDir: string;
}

interface IPCMessage {
    type: 'init' | 'task' | 'command' | 'shutdown' | 'ping' | 'status-request';
    payload?: any;
    taskId?: string;
}

interface IPCResponse {
    type: 'ready' | 'task-started' | 'task-completed' | 'task-failed' | 'status' | 'pong' | 'error' | 'log';
    payload?: any;
    taskId?: string;
    error?: string;
}

class AgentWorkerProcess {
    private config: WorkerConfig | null = null;
    private agent: Agent | null = null;
    private isRunning: boolean = false;
    private currentTaskId: string | null = null;

    constructor() {
        this.setupIPC();
        this.send({ type: 'log', payload: 'Worker process started, awaiting initialization...' });
    }

    private setupIPC(): void {
        process.on('message', async (message: IPCMessage) => {
            try {
                await this.handleMessage(message);
            } catch (err: any) {
                this.send({ type: 'error', error: err.message });
            }
        });

        process.on('disconnect', () => {
            logger.info(`Worker ${this.config?.agentId}: Parent disconnected, shutting down`);
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            logger.info(`Worker ${this.config?.agentId}: Received SIGTERM, shutting down`);
            this.shutdown();
        });

        process.on('SIGINT', () => {
            logger.info(`Worker ${this.config?.agentId}: Received SIGINT, shutting down`);
            this.shutdown();
        });
    }

    private send(response: IPCResponse): void {
        if (process.send) {
            process.send(response);
        }
    }

    private async handleMessage(message: IPCMessage): Promise<void> {
        switch (message.type) {
            case 'init':
                await this.initialize(message.payload as WorkerConfig);
                break;

            case 'task':
                await this.executeTask(message.taskId!, message.payload);
                break;

            case 'command':
                await this.handleCommand(message.payload);
                break;

            case 'ping':
                this.send({ type: 'pong', payload: { agentId: this.config?.agentId, timestamp: Date.now() } });
                break;

            case 'status-request':
                this.send({
                    type: 'status',
                    payload: {
                        agentId: this.config?.agentId,
                        name: this.config?.name,
                        isRunning: this.isRunning,
                        currentTaskId: this.currentTaskId,
                        memoryStats: this.agent ? await this.getMemoryStats() : null
                    }
                });
                break;

            case 'shutdown':
                this.shutdown();
                break;
        }
    }

    private async initialize(config: WorkerConfig): Promise<void> {
        this.config = config;

        // Ensure worker directories exist
        const workerDir = path.dirname(config.memoryPath);
        if (!fs.existsSync(workerDir)) {
            fs.mkdirSync(workerDir, { recursive: true });
        }

        // Build worker config from parent config in ONE atomic write.
        // CRITICAL: We do NOT use ConfigManager.set() here because each set() call
        // writes to disk, emits config:changed, AND syncs to other config locations,
        // causing config reload storms when 30+ keys are written sequentially.
        const workerConfigPath = path.join(workerDir, 'orcbot.config.yaml');
        const parentConfigPath = path.join(config.parentDataDir, 'orcbot.config.yaml');
        
        if (fs.existsSync(parentConfigPath)) {
            // Read parent config as plain YAML (no fs.watch, no EventBus, no sync)
            let parentCfg: any = {};
            try {
                parentCfg = yaml.parse(fs.readFileSync(parentConfigPath, 'utf-8')) || {};
            } catch (e) {
                logger.warn(`Worker ${config.agentId}: Failed to read parent config: ${e}`);
            }

            // Build the worker config object in memory
            const workerCfg: any = {
                // ── API keys (all providers) ──
                openaiApiKey: parentCfg.openaiApiKey,
                googleApiKey: parentCfg.googleApiKey,
                nvidiaApiKey: parentCfg.nvidiaApiKey,
                anthropicApiKey: parentCfg.anthropicApiKey,
                openrouterApiKey: parentCfg.openrouterApiKey,
                openrouterBaseUrl: parentCfg.openrouterBaseUrl,
                openrouterReferer: parentCfg.openrouterReferer,
                openrouterAppName: parentCfg.openrouterAppName,

                // ── AWS Bedrock ──
                bedrockRegion: parentCfg.bedrockRegion,
                bedrockAccessKeyId: parentCfg.bedrockAccessKeyId,
                bedrockSecretAccessKey: parentCfg.bedrockSecretAccessKey,
                bedrockSessionToken: parentCfg.bedrockSessionToken,

                // ── LLM settings ──
                modelName: parentCfg.modelName,
                llmProvider: parentCfg.llmProvider,

                // ── Search & Browser ──
                serperApiKey: parentCfg.serperApiKey,
                searchProviderOrder: parentCfg.searchProviderOrder,
                braveSearchApiKey: parentCfg.braveSearchApiKey,
                searxngUrl: parentCfg.searxngUrl,
                captchaApiKey: parentCfg.captchaApiKey,
                browserEngine: parentCfg.browserEngine,
                lightpandaEndpoint: parentCfg.lightpandaEndpoint,
                // Each worker gets its own browser profile to avoid lock conflicts
                browserProfileDir: path.join(workerDir, 'browser-profile'),
                browserProfileName: `worker-${config.agentId}`,

                // ── Agent behavior settings ──
                maxSteps: parentCfg.maxSteps,
                maxMessages: parentCfg.maxMessages,
                memoryContextLimit: parentCfg.memoryContextLimit,
                memoryEpisodicLimit: parentCfg.memoryEpisodicLimit,
                memoryConsolidationThreshold: parentCfg.memoryConsolidationThreshold,
                memoryConsolidationBatch: parentCfg.memoryConsolidationBatch,

                // ── Worker-specific paths ──
                agentName: config.name,
                memoryPath: config.memoryPath,
                actionQueuePath: path.join(workerDir, 'actions.json'),
                journalPath: path.join(workerDir, 'JOURNAL.md'),
                learningPath: path.join(workerDir, 'LEARNING.md'),
                userProfilePath: path.join(workerDir, 'USER.md'),
                agentIdentityPath: path.join(workerDir, 'AGENT.md'),
                tokenUsagePath: path.join(workerDir, 'token-usage-summary.json'),
                tokenLogPath: path.join(workerDir, 'token-usage.log'),

                // ── Worker isolation ──
                // Workers MUST NOT start channels or AgenticUser (only primary manages those)
                agenticUserEnabled: false,
                telegramToken: '',
                whatsappEnabled: false,
                discordToken: '',
            };

            // Remove undefined keys so parent defaults aren't overridden with undefined
            for (const key of Object.keys(workerCfg)) {
                if (workerCfg[key] === undefined) delete workerCfg[key];
            }

            // Write the entire config in ONE atomic operation
            try {
                fs.writeFileSync(workerConfigPath, yaml.stringify(workerCfg));
            } catch (e) {
                logger.error(`Worker ${config.agentId}: Failed to write worker config: ${e}`);
            }
        }

        // Set environment variable to point to worker config
        process.env.ORCBOT_CONFIG_PATH = workerConfigPath;
        process.env.ORCBOT_DATA_DIR = workerDir;

        // Initialize the Agent in worker mode (skips channels, orchestration skills, AgenticUser)
        this.agent = new Agent({ isWorker: true });
        this.isRunning = true;

        logger.info(`Worker ${config.agentId}: Initialized as "${config.name}" with role "${config.role}"`);
        this.send({ type: 'ready', payload: { agentId: config.agentId, name: config.name } });
    }

    private async executeTask(taskId: string, taskDescription: string): Promise<void> {
        if (!this.agent || !this.config) {
            this.send({ type: 'error', taskId, error: 'Worker not initialized' });
            return;
        }

        this.currentTaskId = taskId;
        this.send({ type: 'task-started', taskId, payload: { agentId: this.config.agentId } });

        try {
            logger.info(`Worker ${this.config.agentId}: Starting task "${taskId}": ${taskDescription.slice(0, 100)}...`);

            // Append instruction to report findings back and avoid polling loops
            const isWindows = process.platform === 'win32';
            const platformNote = isWindows 
                ? `\n7. WINDOWS PLATFORM: Use 'write_file' and 'create_directory' skills instead of shell commands for file operations. Do NOT use echo with multiline content or && chaining.`
                : '';

            const enhancedTaskDescription = `${taskDescription}

[WORKER INSTRUCTIONS]
1. You are an INDEPENDENT worker agent. Complete this task using YOUR OWN capabilities (web_search, browser tools, write_file, create_directory, run_command, rag_ingest, rag_search, etc.).
2. Do NOT repeatedly call 'get_agent_messages' expecting content from other agents - if content isn't there after 1-2 checks, PROCEED WITH YOUR OWN WORK.
3. If the task mentions "content from another agent" but none exists, generate the content yourself or use placeholder content.
4. When DONE, use 'complete_delegated_task("${taskId}", "<your_findings_summary>")' to report results.
5. DO NOT get stuck in loops checking for external data - take action with what you have.
6. You have RAG capabilities: use 'rag_ingest' to store knowledge and 'rag_search' to retrieve it. Use 'update_learning' and 'update_journal' to record learnings and reflections.${platformNote}`;


            // Push the task to the worker's action queue and process it
            await this.agent.pushTask(enhancedTaskDescription, 10); // High priority
            
            // Execute a single decision cycle to process the task
            const result = await this.agent.runOnce();

            logger.info(`Worker ${this.config.agentId}: Completed task "${taskId}"`);
            this.send({
                type: 'task-completed',
                taskId,
                payload: {
                    agentId: this.config.agentId,
                    result: result || 'Task completed successfully'
                }
            });
        } catch (err: any) {
            logger.error(`Worker ${this.config.agentId}: Task "${taskId}" failed: ${err.message}`);
            this.send({
                type: 'task-failed',
                taskId,
                error: err.message,
                payload: { agentId: this.config.agentId }
            });
        } finally {
            this.currentTaskId = null;
        }
    }

    private async handleCommand(command: { action: string; args?: any }): Promise<void> {
        if (!this.agent || !this.config) {
            this.send({ type: 'error', error: 'Worker not initialized' });
            return;
        }

        switch (command.action) {
            case 'pause':
                this.isRunning = false;
                this.send({ type: 'status', payload: { paused: true } });
                break;

            case 'resume':
                this.isRunning = true;
                this.send({ type: 'status', payload: { paused: false } });
                break;

            case 'clear-memory':
                await this.agent.resetMemory();
                this.send({ type: 'status', payload: { memoryCleared: true } });
                break;

            default:
                this.send({ type: 'error', error: `Unknown command: ${command.action}` });
        }
    }

    private async getMemoryStats(): Promise<any> {
        if (!this.config) return null;

        try {
            const stats: any = { shortTermCount: 0, episodicCount: 0, semanticCount: 0 };

            // Memory counts
            if (fs.existsSync(this.config.memoryPath)) {
                const data = JSON.parse(fs.readFileSync(this.config.memoryPath, 'utf-8'));
                stats.shortTermCount = data.short?.length || 0;
                stats.episodicCount = data.episodic?.length || 0;
                stats.semanticCount = data.semantic?.length || 0;
            }

            // Token usage from the worker's own tracker
            const workerDir = path.dirname(this.config.memoryPath);
            const tokenSummaryPath = path.join(workerDir, 'token-usage-summary.json');
            if (fs.existsSync(tokenSummaryPath)) {
                try {
                    const tokenData = JSON.parse(fs.readFileSync(tokenSummaryPath, 'utf-8'));
                    stats.tokenUsage = {
                        totalTokens: tokenData.totals?.totalTokens || 0,
                        realTokens: tokenData.realTotals?.totalTokens || 0,
                        estimatedTokens: tokenData.estimatedTotals?.totalTokens || 0
                    };
                } catch { /* ignore bad token file */ }
            }

            // Knowledge store stats
            const knowledgeStorePath = path.join(workerDir, 'knowledge_store.json');
            if (fs.existsSync(knowledgeStorePath)) {
                try {
                    const ksData = JSON.parse(fs.readFileSync(knowledgeStorePath, 'utf-8'));
                    stats.knowledgeStore = {
                        documents: ksData.documents?.length || 0,
                        chunks: ksData.chunks?.length || 0
                    };
                } catch { /* ignore */ }
            }

            return stats;
        } catch {
            // Ignore errors
        }
        return { shortTermCount: 0, episodicCount: 0, semanticCount: 0 };
    }

    private shutdown(): void {
        logger.info(`Worker ${this.config?.agentId}: Shutting down...`);
        this.isRunning = false;
        
        // Give time for cleanup
        setTimeout(() => {
            process.exit(0);
        }, 500);
    }
}

// Only run if this is the main module (spawned as worker)
if (require.main === module) {
    new AgentWorkerProcess();
}

export { AgentWorkerProcess, WorkerConfig, IPCMessage, IPCResponse };
