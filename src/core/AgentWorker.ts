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

        // Copy essential config from parent to worker directory
        const workerConfigPath = path.join(workerDir, 'orcbot.config.yaml');
        const parentConfigPath = path.join(config.parentDataDir, 'orcbot.config.yaml');
        
        if (fs.existsSync(parentConfigPath)) {
            const parentConfig = new ConfigManager(parentConfigPath);
            const workerConfig = new ConfigManager(workerConfigPath);
            
            // Copy API keys and essential settings
            workerConfig.set('openaiApiKey', parentConfig.get('openaiApiKey'));
            workerConfig.set('googleApiKey', parentConfig.get('googleApiKey'));
            workerConfig.set('modelName', parentConfig.get('modelName'));
            workerConfig.set('serperApiKey', parentConfig.get('serperApiKey'));
            workerConfig.set('searchProviderOrder', parentConfig.get('searchProviderOrder'));
            workerConfig.set('braveSearchApiKey', parentConfig.get('braveSearchApiKey'));
            workerConfig.set('captchaApiKey', parentConfig.get('captchaApiKey'));
            
            // Set worker-specific paths
            workerConfig.set('agentName', config.name);
            workerConfig.set('memoryPath', config.memoryPath);
            workerConfig.set('actionQueuePath', path.join(workerDir, 'actions.json'));
            workerConfig.set('journalPath', path.join(workerDir, 'JOURNAL.md'));
            workerConfig.set('learningPath', path.join(workerDir, 'LEARNING.md'));
            workerConfig.set('userProfilePath', path.join(workerDir, 'USER.md'));
            workerConfig.set('agentIdentityPath', path.join(workerDir, 'AGENT.md'));
        }

        // Set environment variable to point to worker config
        process.env.ORCBOT_CONFIG_PATH = workerConfigPath;
        process.env.ORCBOT_DATA_DIR = workerDir;

        // Initialize the Agent (it will use the env vars to find config)
        this.agent = new Agent();
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

            // Push the task to the worker's action queue and process it
            await this.agent.pushTask(taskDescription, 10); // High priority
            
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
            if (fs.existsSync(this.config.memoryPath)) {
                const data = JSON.parse(fs.readFileSync(this.config.memoryPath, 'utf-8'));
                return {
                    shortTermCount: data.short?.length || 0,
                    episodicCount: data.episodic?.length || 0,
                    semanticCount: data.semantic?.length || 0
                };
            }
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
