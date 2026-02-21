import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { ChildProcess, fork } from 'child_process';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { IPCMessage, IPCResponse, WorkerConfig } from './AgentWorker';

export interface AgentInstanceConfig {
    id: string;
    name: string;
    role: string;
    parentId: string | null;
    capabilities: string[];
    status: 'idle' | 'working' | 'paused' | 'terminated';
    currentTask: string | null;
    createdAt: string;
    lastActiveAt: string;
    memoryPath: string;
    profilePath: string;
    pid?: number; // Process ID when running as child process
}

export interface OrchestratorTask {
    id: string;
    description: string;
    assignedTo: string | null;
    status: 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';
    priority: number;
    result?: string;
    error?: string;
    createdAt: string;
    completedAt?: string;
}

export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    type: 'task' | 'result' | 'status' | 'command' | 'broadcast';
    payload: any;
    timestamp: string;
}

export class AgentOrchestrator extends EventEmitter {
    private agents: Map<string, AgentInstanceConfig> = new Map();
    private tasks: Map<string, OrchestratorTask> = new Map();
    private messageQueue: AgentMessage[] = [];
    private workerProcesses: Map<string, ChildProcess> = new Map();
    private dataDir: string;
    private agentsFilePath: string;
    private tasksFilePath: string;
    private primaryAgentId: string;
    private workerScriptPath: string;
    private readyWorkers: Set<string> = new Set();
    private pendingTaskDispatch: Map<string, string[]> = new Map();

    constructor(dataDir?: string, primaryAgentId?: string) {
        super();
        this.dataDir = dataDir || path.join(os.homedir(), '.orcbot', 'orchestrator');
        this.agentsFilePath = path.join(this.dataDir, 'agents.json');
        this.tasksFilePath = path.join(this.dataDir, 'tasks.json');
        this.primaryAgentId = primaryAgentId || 'primary';
        
        // Worker script path - try compiled JS first, fall back to TS for dev
        const distWorker = path.join(__dirname, '..', '..', 'dist', 'core', 'AgentWorker.js');
        const srcWorker = path.join(__dirname, 'AgentWorker.ts');
        this.workerScriptPath = fs.existsSync(distWorker) ? distWorker : srcWorker;

        this.ensureDataDir();
        this.load();
        this.registerPrimaryAgent();
    }

    private ensureDataDir(): void {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    private load(): void {
        try {
            if (fs.existsSync(this.agentsFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.agentsFilePath, 'utf-8'));
                for (const agent of data) {
                    this.agents.set(agent.id, agent);
                }
                logger.info(`Orchestrator: Loaded ${this.agents.size} agent(s)`);
            }
            if (fs.existsSync(this.tasksFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.tasksFilePath, 'utf-8'));
                for (const task of data) {
                    this.tasks.set(task.id, task);
                }
            }
        } catch (e) {
            logger.warn(`Orchestrator: Failed to load state: ${e}`);
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(this.agentsFilePath, JSON.stringify(Array.from(this.agents.values()), null, 2));
            fs.writeFileSync(this.tasksFilePath, JSON.stringify(Array.from(this.tasks.values()), null, 2));
        } catch (e) {
            logger.error(`Orchestrator: Failed to save state: ${e}`);
        }
    }

    private registerPrimaryAgent(): void {
        if (!this.agents.has(this.primaryAgentId)) {
            const primary: AgentInstanceConfig = {
                id: this.primaryAgentId,
                name: 'Primary Agent',
                role: 'orchestrator',
                parentId: null,
                capabilities: ['orchestrate', 'spawn', 'delegate', 'execute'],
                status: 'idle',
                currentTask: null,
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
                memoryPath: path.join(os.homedir(), '.orcbot', 'memory.json'),
                profilePath: path.join(os.homedir(), '.orcbot', 'worker-profile.json')
            };
            this.agents.set(this.primaryAgentId, primary);
            this.save();
        }
    }

    /**
     * Spawn a new agent instance as a child process
     */
    private normalizeCapabilities(input?: unknown[]): string[] {
        const normalized = new Set(
            (input || [])
                .map(cap => String(cap ?? '').trim().toLowerCase())
                .filter(Boolean)
        );

        // Workers should remain task-executable even when custom capabilities are
        // provided from loose user input (e.g. "browser,search" without "execute").
        if (normalized.size === 0 || !normalized.has('execute')) {
            normalized.add('execute');
        }

        return Array.from(normalized);
    }

    public spawnAgent(config: {
        name: string;
        role: string;
        capabilities?: string[];
        parentId?: string;
        autoStart?: boolean; // Default true - starts the worker process immediately
    }): AgentInstanceConfig {
        const id = `agent-${uuidv4().slice(0, 8)}`;
        const agentDir = path.join(this.dataDir, 'instances', id);

        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }

        const agent: AgentInstanceConfig = {
            id,
            name: config.name,
            role: config.role,
            parentId: config.parentId || this.primaryAgentId,
            capabilities: this.normalizeCapabilities(config.capabilities),
            status: 'idle',
            currentTask: null,
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            memoryPath: path.join(agentDir, 'memory.json'),
            profilePath: path.join(agentDir, 'profile.json')
        };

        // Initialize agent memory file
        fs.writeFileSync(agent.memoryPath, JSON.stringify({ short: [], episodic: [], semantic: [] }, null, 2));

        this.agents.set(id, agent);
        this.save();

        // Auto-start the worker process unless disabled
        if (config.autoStart !== false) {
            this.startWorkerProcess(agent);
        }

        logger.info(`Orchestrator: Spawned new agent "${agent.name}" (${id}) with role "${agent.role}"`);
        this.emit('agent:spawned', agent);

        return agent;
    }

    /**
     * Start a worker process for an agent
     */
    public startWorkerProcess(agent: AgentInstanceConfig): boolean {
        if (this.workerProcesses.has(agent.id)) {
            logger.warn(`Orchestrator: Worker process already running for agent ${agent.id}`);
            return false;
        }

        try {
            // Determine if we need ts-node for TypeScript files
            const isTypeScript = this.workerScriptPath.endsWith('.ts');
            const execArgv = isTypeScript ? ['-r', 'ts-node/register'] : [];

            const child = fork(this.workerScriptPath, [], {
                execArgv,
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                env: { ...process.env, ORCBOT_WORKER: 'true' }
            });

            agent.pid = child.pid;
            this.workerProcesses.set(agent.id, child);
            this.readyWorkers.delete(agent.id);
            if (!this.pendingTaskDispatch.has(agent.id)) {
                this.pendingTaskDispatch.set(agent.id, []);
            }

            // Setup IPC message handling
            child.on('message', (message: IPCResponse) => {
                this.handleWorkerMessage(agent.id, message);
            });

            child.on('error', (err) => {
                logger.error(`Orchestrator: Worker ${agent.id} error: ${err.message}`);
                this.handleWorkerExit(agent.id, 1);
            });

            child.on('exit', (code) => {
                logger.info(`Orchestrator: Worker ${agent.id} exited with code ${code}`);
                this.handleWorkerExit(agent.id, code || 0);
            });

            // Capture stdout/stderr and forward to main process logs
            child.stdout?.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        logger.info(`[Worker:${agent.name}] ${line}`);
                    }
                }
            });

            child.stderr?.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        logger.warn(`[Worker:${agent.name}] ${line}`);
                    }
                }
            });

            // Initialize the worker with its config
            const workerConfig: WorkerConfig = {
                agentId: agent.id,
                name: agent.name,
                role: agent.role,
                capabilities: agent.capabilities,
                memoryPath: agent.memoryPath,
                profilePath: agent.profilePath,
                parentDataDir: path.join(os.homedir(), '.orcbot')
            };

            this.sendToWorker(agent.id, { type: 'init', payload: workerConfig });

            logger.info(`Orchestrator: Started worker process for agent "${agent.name}" (PID: ${child.pid})`);
            this.save();
            return true;
        } catch (err: any) {
            logger.error(`Orchestrator: Failed to start worker for agent ${agent.id}: ${err.message}`);
            return false;
        }
    }

    /**
     * Send a message to a worker process
     */
    private sendToWorker(agentId: string, message: IPCMessage): boolean {
        const worker = this.workerProcesses.get(agentId);
        if (!worker || !worker.connected) {
            logger.warn(`Orchestrator: Cannot send to worker ${agentId} - not connected`);
            return false;
        }
        worker.send(message);
        return true;
    }

    /**
     * Handle messages from worker processes
     */
    private handleWorkerMessage(agentId: string, message: IPCResponse): void {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        agent.lastActiveAt = new Date().toISOString();

        switch (message.type) {
            case 'ready':
                logger.info(`Orchestrator: Worker ${agentId} is ready`);
                this.readyWorkers.add(agentId);
                if (!agent.currentTask) {
                    agent.status = 'idle';
                }
                this.flushPendingDispatch(agentId);
                this.emit('worker:ready', { agentId, ...message.payload });
                break;

            case 'task-started':
                agent.status = 'working';
                agent.currentTask = message.taskId || null;
                if (message.taskId) {
                    const task = this.tasks.get(message.taskId);
                    if (task) task.status = 'in-progress';
                }
                this.emit('worker:task-started', { agentId, taskId: message.taskId });
                logger.info(`Orchestrator: Worker ${agentId} started task ${message.taskId}`);
                break;

            case 'task-completed':
                agent.status = 'idle';
                agent.currentTask = null;
                if (message.taskId) {
                    const result = message.payload?.result;
                    this.completeTask(message.taskId, result);
                    
                    // Auto-send result message to primary agent for retrieval
                    const task = this.tasks.get(message.taskId);
                    if (task && agent.parentId) {
                        this.sendMessage(agentId, agent.parentId, 'result', {
                            taskId: message.taskId,
                            taskDescription: task.description,
                            result: result || 'Task completed',
                            completedAt: new Date().toISOString()
                        });
                    }
                }
                this.emit('worker:task-completed', { agentId, taskId: message.taskId, result: message.payload?.result });
                logger.info(`Orchestrator: Worker ${agentId} completed task ${message.taskId}`);
                break;

            case 'task-failed':
                agent.status = 'idle';
                agent.currentTask = null;
                if (message.taskId) {
                    this.failTask(message.taskId, message.error || 'Unknown error');
                    
                    // Auto-send failure message to primary agent
                    const task = this.tasks.get(message.taskId);
                    if (task && agent.parentId) {
                        this.sendMessage(agentId, agent.parentId, 'result', {
                            taskId: message.taskId,
                            taskDescription: task.description,
                            error: message.error || 'Unknown error',
                            failedAt: new Date().toISOString()
                        });
                    }
                }
                this.emit('worker:task-failed', { agentId, taskId: message.taskId, error: message.error });
                logger.warn(`Orchestrator: Worker ${agentId} failed task ${message.taskId}: ${message.error}`);
                break;

            case 'status':
                this.emit('worker:status', { agentId, ...message.payload });
                break;

            case 'pong':
                this.emit('worker:pong', { agentId, ...message.payload });
                break;

            case 'log':
                // Forward worker logs to main process at info level
                logger.info(`[Worker:${agent.name}] ${message.payload}`);
                break;

            case 'error':
                logger.error(`[Worker:${agent.name}] Error: ${message.error}`);
                this.emit('worker:error', { agentId, error: message.error });
                break;
        }

        this.save();
    }

    /**
     * Handle worker process exit
     */
    private handleWorkerExit(agentId: string, exitCode: number): void {
        this.workerProcesses.delete(agentId);
        this.readyWorkers.delete(agentId);
        this.pendingTaskDispatch.delete(agentId);

        const agent = this.agents.get(agentId);
        if (agent) {
            const strandedTaskId = agent.currentTask;
            agent.pid = undefined;
            agent.status = exitCode === 0 ? 'idle' : 'paused';
            agent.currentTask = null;

            if (strandedTaskId) {
                const task = this.tasks.get(strandedTaskId);
                if (task && task.status !== 'completed' && task.status !== 'failed') {
                    task.status = 'pending';
                    task.assignedTo = null;
                    task.error = `Worker ${agentId} exited unexpectedly with code ${exitCode}`;
                    logger.warn(`Orchestrator: Re-queued task ${strandedTaskId} after worker ${agentId} exit`);
                    this.emit('task:requeued', {
                        taskId: strandedTaskId,
                        previousAgentId: agentId,
                        reason: 'worker-exit',
                        exitCode
                    });
                }
            }

            this.save();
        }

        this.emit('worker:exit', { agentId, exitCode });
    }

    /**
     * Stop a worker process
     */
    public stopWorkerProcess(agentId: string): boolean {
        const worker = this.workerProcesses.get(agentId);
        if (!worker) return false;

        this.sendToWorker(agentId, { type: 'shutdown' });
        
        // Force kill after timeout
        setTimeout(() => {
            if (this.workerProcesses.has(agentId)) {
                worker.kill('SIGKILL');
            }
        }, 5000);

        return true;
    }

    /**
     * Check if a worker process is running
     */
    public isWorkerRunning(agentId: string): boolean {
        const worker = this.workerProcesses.get(agentId);
        return worker?.connected || false;
    }

    /**
     * Get all running worker PIDs
     */
    public getRunningWorkers(): Array<{ agentId: string; pid: number; name: string }> {
        const running: Array<{ agentId: string; pid: number; name: string }> = [];
        for (const [agentId, worker] of this.workerProcesses.entries()) {
            if (worker.connected && worker.pid) {
                const agent = this.agents.get(agentId);
                running.push({
                    agentId,
                    pid: worker.pid,
                    name: agent?.name || 'Unknown'
                });
            }
        }
        return running;
    }

    /**
     * Ping a worker to check if it's responsive
     */
    public pingWorker(agentId: string): boolean {
        return this.sendToWorker(agentId, { type: 'ping' });
    }

    /**
     * Request status from a worker
     */
    public requestWorkerStatus(agentId: string): boolean {
        return this.sendToWorker(agentId, { type: 'status-request' });
    }

    /**
     * Terminate an agent instance
     */
    public terminateAgent(agentId: string): boolean {
        const agent = this.agents.get(agentId);
        if (!agent) return false;
        if (agentId === this.primaryAgentId) {
            logger.warn('Orchestrator: Cannot terminate primary agent');
            return false;
        }

        // Stop the worker process first
        this.stopWorkerProcess(agentId);

        agent.status = 'terminated';
        agent.lastActiveAt = new Date().toISOString();
        this.save();

        logger.info(`Orchestrator: Terminated agent "${agent.name}" (${agentId})`);
        this.emit('agent:terminated', agent);

        return true;
    }

    /**
     * Remove a terminated agent completely
     */
    public removeAgent(agentId: string): boolean {
        const agent = this.agents.get(agentId);
        if (!agent || agentId === this.primaryAgentId) return false;

        // Clean up agent data directory
        const agentDir = path.dirname(agent.memoryPath);
        if (fs.existsSync(agentDir)) {
            fs.rmSync(agentDir, { recursive: true, force: true });
        }

        this.agents.delete(agentId);
        this.save();

        logger.info(`Orchestrator: Removed agent "${agent.name}" (${agentId})`);
        return true;
    }

    /**
     * Get all agents
     */
    public getAgents(): AgentInstanceConfig[] {
        return Array.from(this.agents.values());
    }

    /**
     * Get a specific agent
     */
    public getAgent(agentId: string): AgentInstanceConfig | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Get idle agents that can accept tasks
     */
    public getAvailableAgents(capability?: string): AgentInstanceConfig[] {
        return Array.from(this.agents.values()).filter(a => {
            if (a.status !== 'idle') return false;
            if (capability && !a.capabilities.includes(capability)) return false;
            return true;
        });
    }

    /**
     * Update agent status
     */
    public updateAgentStatus(agentId: string, status: AgentInstanceConfig['status'], currentTask?: string | null): void {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        agent.status = status;
        agent.lastActiveAt = new Date().toISOString();
        if (currentTask !== undefined) {
            agent.currentTask = currentTask;
        }
        this.save();
        this.emit('agent:status', agent);
    }

    /**
     * Create a task for distribution
     */
    public createTask(description: string, priority: number = 5): OrchestratorTask {
        const task: OrchestratorTask = {
            id: `task-${uuidv4().slice(0, 8)}`,
            description,
            assignedTo: null,
            status: 'pending',
            priority,
            createdAt: new Date().toISOString()
        };

        this.tasks.set(task.id, task);
        this.save();
        this.emit('task:created', task);

        return task;
    }


    private queueTaskDispatch(agentId: string, taskId: string): void {
        const queue = this.pendingTaskDispatch.get(agentId) || [];
        queue.push(taskId);
        this.pendingTaskDispatch.set(agentId, queue);
    }

    private dispatchTaskToWorker(agentId: string, task: OrchestratorTask): boolean {
        const sent = this.sendToWorker(agentId, {
            type: 'task',
            taskId: task.id,
            payload: task.description
        });

        if (!sent) {
            const agent = this.agents.get(agentId);
            if (agent) {
                logger.warn(`Orchestrator: Failed to send task ${task.id} to worker ${agentId}; reverting assignment`);
                task.assignedTo = null;
                task.status = 'pending';
                agent.status = 'idle';
                agent.currentTask = null;
                this.save();
            }
            return false;
        }

        logger.info(`Orchestrator: Sent task "${task.description.slice(0, 50)}..." to worker "${this.agents.get(agentId)?.name || agentId}"`);
        return true;
    }

    private flushPendingDispatch(agentId: string): void {
        const queue = this.pendingTaskDispatch.get(agentId);
        if (!queue || queue.length === 0) return;

        const nextTaskId = queue.shift();
        if (queue.length === 0) {
            this.pendingTaskDispatch.delete(agentId);
        } else {
            this.pendingTaskDispatch.set(agentId, queue);
        }

        if (!nextTaskId) return;
        const task = this.tasks.get(nextTaskId);
        if (!task || task.assignedTo !== agentId || (task.status !== 'assigned' && task.status !== 'in-progress')) {
            return;
        }

        this.dispatchTaskToWorker(agentId, task);
    }

    /**
     * Assign a task to an agent and send it to the worker process
     */
    public assignTask(taskId: string, agentId: string): boolean {
        const task = this.tasks.get(taskId);
        const agent = this.agents.get(agentId);

        if (!task || !agent) return false;
        if (agent.status !== 'idle') {
            logger.warn(`Orchestrator: Cannot assign task to busy agent ${agentId}`);
            return false;
        }

        task.assignedTo = agentId;
        task.status = 'assigned';
        agent.status = 'working';
        agent.currentTask = taskId;
        agent.lastActiveAt = new Date().toISOString();

        this.save();
        this.emit('task:assigned', { task, agent });

        // Send task to worker process if it's running and ready
        if (this.isWorkerRunning(agentId) && this.readyWorkers.has(agentId)) {
            if (!this.dispatchTaskToWorker(agentId, task)) {
                return false;
            }
        } else {
            this.queueTaskDispatch(agentId, task.id);

            // Try to start the worker if not running
            if (!this.isWorkerRunning(agentId)) {
                logger.info(`Orchestrator: Worker not running for agent ${agentId}, starting...`);
                if (!this.startWorkerProcess(agent)) {
                    logger.error(`Orchestrator: Failed to start worker for task assignment`);
                    task.status = 'pending';
                    task.assignedTo = null;
                    agent.status = 'idle';
                    agent.currentTask = null;
                    this.pendingTaskDispatch.delete(agentId);
                    this.save();
                    return false;
                }
            }

            logger.info(`Orchestrator: Queued task ${task.id} for worker ${agentId} until it is ready`);
        }

        logger.info(`Orchestrator: Assigned task "${task.description.slice(0, 50)}..." to agent "${agent.name}"`);
        return true;
    }

    /**
     * Auto-assign pending tasks to available agents
     */
    public distributeTasks(): number {
        const pendingTasks = Array.from(this.tasks.values())
            .filter(t => t.status === 'pending')
            .sort((a, b) => b.priority - a.priority);

        let assigned = 0;

        for (const task of pendingTasks) {
            const available = this.getAvailableAgents('execute');
            if (available.length === 0) break;

            // Simple round-robin: pick first available
            const agent = available[0];
            if (this.assignTask(task.id, agent.id)) {
                assigned++;
            }
        }

        return assigned;
    }

    /**
     * Mark task as completed
     */
    public completeTask(taskId: string, result?: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        task.status = 'completed';
        task.result = result;
        task.completedAt = new Date().toISOString();

        if (task.assignedTo) {
            const agent = this.agents.get(task.assignedTo);
            if (agent) {
                agent.status = 'idle';
                agent.currentTask = null;
                agent.lastActiveAt = new Date().toISOString();
            }
        }

        this.save();
        this.emit('task:completed', task);

        return true;
    }

    /**
     * Mark task as failed
     */
    public failTask(taskId: string, error: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        task.status = 'failed';
        task.error = error;
        task.completedAt = new Date().toISOString();

        if (task.assignedTo) {
            const agent = this.agents.get(task.assignedTo);
            if (agent) {
                agent.status = 'idle';
                agent.currentTask = null;
            }
        }

        this.save();
        this.emit('task:failed', task);

        return true;
    }

    /**
     * Cancel task (marks as failed with reason)
     */
    public cancelTask(taskId: string, reason: string = 'Cancelled by user'): boolean {
        return this.failTask(taskId, reason);
    }

    /**
     * Get all tasks
     */
    public getTasks(): OrchestratorTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get tasks by status
     */
    public getTasksByStatus(status: OrchestratorTask['status']): OrchestratorTask[] {
        return Array.from(this.tasks.values()).filter(t => t.status === status);
    }

    /**
     * Send a message between agents
     */
    public sendMessage(from: string, to: string, type: AgentMessage['type'], payload: any): AgentMessage {
        const message: AgentMessage = {
            id: `msg-${uuidv4().slice(0, 8)}`,
            from,
            to,
            type,
            payload,
            timestamp: new Date().toISOString()
        };

        this.messageQueue.push(message);
        this.emit('message', message);

        // Keep message queue bounded
        if (this.messageQueue.length > 1000) {
            this.messageQueue = this.messageQueue.slice(-500);
        }

        return message;
    }

    /**
     * Broadcast a message to all agents
     */
    public broadcast(from: string, payload: any): void {
        for (const agent of this.agents.values()) {
            if (agent.id !== from && agent.status !== 'terminated') {
                this.sendMessage(from, agent.id, 'broadcast', payload);
            }
        }
    }

    /**
     * Get messages for an agent
     */
    public getMessagesFor(agentId: string, limit: number = 50): AgentMessage[] {
        return this.messageQueue
            .filter(m => m.to === agentId || m.to === 'all')
            .slice(-limit);
    }

    /**
     * Get orchestration status summary (for TUI/skills)
     */
    public getStatus(): {
        activeAgents: number;
        pendingTasks: number;
        completedTasks: number;
        failedTasks: number;
        workingAgents: number;
        idleAgents: number;
        agents: AgentInstanceConfig[];
        tasks: OrchestratorTask[];
    } {
        const agents = this.getAgents().filter(a => a.status !== 'terminated');
        const tasks = this.getTasks();

        return {
            activeAgents: agents.length,
            pendingTasks: tasks.filter(t => t.status === 'pending').length,
            completedTasks: tasks.filter(t => t.status === 'completed').length,
            failedTasks: tasks.filter(t => t.status === 'failed').length,
            workingAgents: agents.filter(a => a.status === 'working').length,
            idleAgents: agents.filter(a => a.status === 'idle').length,
            agents,
            tasks
        };
    }

    /**
     * List all active (non-terminated) agents with summary info
     */
    public listAgents(): Array<{
        id: string;
        name: string;
        status: string;
        createdAt: string;
        capabilities?: string[];
        activeTasks: number;
    }> {
        return this.getAgents()
            .filter(a => a.status !== 'terminated')
            .map(a => ({
                id: a.id,
                name: a.name,
                status: a.status,
                createdAt: a.createdAt,
                capabilities: a.capabilities,
                activeTasks: a.currentTask ? 1 : 0
            }));
    }

    /**
     * Get detailed worker info including current task description (for TUI)
     */
    public getDetailedWorkerStatus(): Array<{
        agentId: string;
        name: string;
        pid: number | undefined;
        status: string;
        isRunning: boolean;
        currentTaskId: string | null;
        currentTaskDescription: string | null;
        lastActiveAt: string;
        role: string;
    }> {
        const results: Array<{
            agentId: string;
            name: string;
            pid: number | undefined;
            status: string;
            isRunning: boolean;
            currentTaskId: string | null;
            currentTaskDescription: string | null;
            lastActiveAt: string;
            role: string;
        }> = [];

        for (const agent of this.agents.values()) {
            if (agent.status === 'terminated' || agent.id === this.primaryAgentId) continue;

            let taskDescription: string | null = null;
            if (agent.currentTask) {
                const task = this.tasks.get(agent.currentTask);
                taskDescription = task?.description || null;
            }

            results.push({
                agentId: agent.id,
                name: agent.name,
                pid: agent.pid,
                status: agent.status,
                isRunning: this.isWorkerRunning(agent.id),
                currentTaskId: agent.currentTask,
                currentTaskDescription: taskDescription,
                lastActiveAt: agent.lastActiveAt,
                role: agent.role
            });
        }

        return results;
    }

    /**
     * Delegate a task directly to a specific agent (creates and assigns in one step)
     */
    public delegateTask(agentId: string, description: string, priority: number = 5): OrchestratorTask {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        if (agent.status !== 'idle') {
            throw new Error(`Agent ${agentId} is not idle (status: ${agent.status})`);
        }

        const task = this.createTask(description, priority);
        this.assignTask(task.id, agentId);

        return task;
    }

    /**
     * Distribute a list of task descriptions to available agents
     */
    public distributeTaskList(descriptions: string[], priority: number = 5): OrchestratorTask[] {
        const results: OrchestratorTask[] = [];
        const available = this.getAvailableAgents('execute');

        for (let i = 0; i < descriptions.length; i++) {
            const task = this.createTask(descriptions[i], priority);
            const agentIndex = i % available.length;

            if (available.length > 0) {
                this.assignTask(task.id, available[agentIndex].id);
            }

            results.push({ ...task, assignedAgentId: available.length > 0 ? available[agentIndex].id : null } as any);
        }

        return results;
    }

    /**
     * Get orchestration summary (enhanced with token usage and knowledge store info)
     */
    public getSummary(): string {
        const agents = this.getAgents();
        const tasks = this.getTasks();

        const agentsByStatus = {
            idle: agents.filter(a => a.status === 'idle').length,
            working: agents.filter(a => a.status === 'working').length,
            paused: agents.filter(a => a.status === 'paused').length,
            terminated: agents.filter(a => a.status === 'terminated').length
        };

        const tasksByStatus = {
            pending: tasks.filter(t => t.status === 'pending').length,
            assigned: tasks.filter(t => t.status === 'assigned').length,
            inProgress: tasks.filter(t => t.status === 'in-progress').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length
        };

        const lines = [
            `=== Orchestrator Summary ===`,
            `Agents: ${agents.length} total`,
            `  - Idle: ${agentsByStatus.idle}`,
            `  - Working: ${agentsByStatus.working}`,
            `  - Paused: ${agentsByStatus.paused}`,
            `  - Terminated: ${agentsByStatus.terminated}`,
            ``,
            `Tasks: ${tasks.length} total`,
            `  - Pending: ${tasksByStatus.pending}`,
            `  - Assigned: ${tasksByStatus.assigned}`,
            `  - In Progress: ${tasksByStatus.inProgress}`,
            `  - Completed: ${tasksByStatus.completed}`,
            `  - Failed: ${tasksByStatus.failed}`
        ];

        // Add per-worker token usage if available
        const workerTokens = this.getAggregateWorkerTokenUsage();
        if (workerTokens.length > 0) {
            lines.push('', `Worker Token Usage:`);
            for (const wt of workerTokens) {
                lines.push(`  - ${wt.name} (${wt.agentId}): ${wt.totalTokens.toLocaleString()} tokens (${wt.realTokens.toLocaleString()} real, ${wt.estimatedTokens.toLocaleString()} estimated)`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Aggregate token usage from all worker directories
     */
    public getAggregateWorkerTokenUsage(): Array<{
        agentId: string;
        name: string;
        totalTokens: number;
        realTokens: number;
        estimatedTokens: number;
    }> {
        const results: Array<{ agentId: string; name: string; totalTokens: number; realTokens: number; estimatedTokens: number }> = [];

        for (const agent of this.agents.values()) {
            if (agent.id === this.primaryAgentId || agent.status === 'terminated') continue;

            const workerDir = path.dirname(agent.memoryPath);
            const tokenSummaryPath = path.join(workerDir, 'token-usage-summary.json');

            if (fs.existsSync(tokenSummaryPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(tokenSummaryPath, 'utf-8'));
                    results.push({
                        agentId: agent.id,
                        name: agent.name,
                        totalTokens: data.totals?.totalTokens || 0,
                        realTokens: data.realTotals?.totalTokens || 0,
                        estimatedTokens: data.estimatedTotals?.totalTokens || 0
                    });
                } catch { /* skip malformed files */ }
            }
        }

        return results;
    }

    /**
     * Clean up completed and failed tasks older than specified days
     */
    public cleanupOldTasks(daysOld: number = 7): number {
        const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        let removed = 0;

        for (const [id, task] of this.tasks.entries()) {
            if ((task.status === 'completed' || task.status === 'failed') && task.completedAt) {
                if (new Date(task.completedAt).getTime() < cutoff) {
                    this.tasks.delete(id);
                    removed++;
                }
            }
        }

        if (removed > 0) {
            this.save();
            logger.info(`Orchestrator: Cleaned up ${removed} old tasks`);
        }

        return removed;
    }
}
