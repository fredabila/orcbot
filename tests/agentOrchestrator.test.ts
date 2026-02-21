import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentOrchestrator } from '../src/core/AgentOrchestrator';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('AgentOrchestrator spawnAgent capability normalization', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // best-effort cleanup
            }
        }
    });

    it('keeps execute capability when custom capabilities are provided', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-a',
            role: 'worker',
            capabilities: ['browser', 'search']
        });

        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).toContain('browser');
        expect(agent.capabilities).toContain('search');
    });

    it('normalizes capability casing/whitespace and de-duplicates', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-b',
            role: 'worker',
            capabilities: [' Execute ', 'BROWSER', 'browser', '']
        });

        expect(agent.capabilities.filter(c => c === 'browser')).toHaveLength(1);
        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).not.toContain(' Execute ');
    });

    it('ignores non-string capability values without throwing', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-c',
            role: 'worker',
            capabilities: [1, true, { key: 'value' }, ' Search '] as unknown as string[]
        });

        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).toContain('1');
        expect(agent.capabilities).toContain('true');
        expect(agent.capabilities).toContain('[object object]');
        expect(agent.capabilities).toContain('search');
    });
});


describe('AgentOrchestrator worker synchronization safety', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // best-effort cleanup
            }
        }
    });

    it('reverts assignment if dispatch to worker fails', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-sync-a',
            role: 'worker',
            autoStart: false
        });

        const task = orchestrator.createTask('Investigate sync safety', 10);

        const internal = orchestrator as any;
        internal.isWorkerRunning = () => true;
        internal.readyWorkers.add(agent.id);
        internal.sendToWorker = () => false;

        const assigned = orchestrator.assignTask(task.id, agent.id);
        expect(assigned).toBe(false);

        const refreshedTask = orchestrator.getTasks().find(t => t.id === task.id)!;
        const refreshedAgent = orchestrator.getAgent(agent.id)!;

        expect(refreshedTask.status).toBe('pending');
        expect(refreshedTask.assignedTo).toBeNull();
        expect(refreshedAgent.status).toBe('idle');
        expect(refreshedAgent.currentTask).toBeNull();
    });

    it('re-queues in-flight task when worker exits unexpectedly', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-sync-b',
            role: 'worker',
            autoStart: false
        });

        const task = orchestrator.createTask('Do coordinated work', 9);

        const internal = orchestrator as any;
        const taskMap = internal.tasks as Map<string, any>;
        const agentMap = internal.agents as Map<string, any>;

        const internalTask = taskMap.get(task.id);
        internalTask.status = 'in-progress';
        internalTask.assignedTo = agent.id;

        const internalAgent = agentMap.get(agent.id);
        internalAgent.status = 'working';
        internalAgent.currentTask = task.id;

        internal.handleWorkerExit(agent.id, 1);

        const refreshedTask = orchestrator.getTasks().find(t => t.id === task.id)!;
        const refreshedAgent = orchestrator.getAgent(agent.id)!;

        expect(refreshedTask.status).toBe('pending');
        expect(refreshedTask.assignedTo).toBeNull();
        expect(refreshedTask.error).toContain('exited unexpectedly');
        expect(refreshedAgent.status).toBe('paused');
        expect(refreshedAgent.currentTask).toBeNull();
    });

    it('cancels an assigned task immediately and stops the running worker', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-sync-c',
            role: 'worker',
            autoStart: false
        });

        const task = orchestrator.createTask('Long running delegated task', 8);
        const internal = orchestrator as any;
        const taskMap = internal.tasks as Map<string, any>;
        const agentMap = internal.agents as Map<string, any>;

        const internalTask = taskMap.get(task.id);
        internalTask.status = 'in-progress';
        internalTask.assignedTo = agent.id;

        const internalAgent = agentMap.get(agent.id);
        internalAgent.status = 'working';
        internalAgent.currentTask = task.id;

        const stopCalls: string[] = [];
        internal.isWorkerRunning = () => true;
        internal.stopWorkerProcess = (id: string) => {
            stopCalls.push(id);
            return true;
        };

        const cancelled = orchestrator.cancelTask(task.id, 'User sent a newer request');
        expect(cancelled).toBe(true);

        const refreshedTask = orchestrator.getTasks().find(t => t.id === task.id)!;
        expect(refreshedTask.status).toBe('failed');
        expect(refreshedTask.error).toBe('User sent a newer request');
        expect(stopCalls).toEqual([agent.id]);
    });

    it('does not re-queue a cancelled task on worker exit', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-sync-d',
            role: 'worker',
            autoStart: false
        });

        const task = orchestrator.createTask('Task that should stay cancelled', 6);
        const internal = orchestrator as any;
        const taskMap = internal.tasks as Map<string, any>;
        const agentMap = internal.agents as Map<string, any>;
        const cancelledReasons = internal.cancelledTaskReasons as Map<string, string>;

        const internalTask = taskMap.get(task.id);
        internalTask.status = 'in-progress';
        internalTask.assignedTo = agent.id;

        const internalAgent = agentMap.get(agent.id);
        internalAgent.status = 'working';
        internalAgent.currentTask = task.id;

        cancelledReasons.set(task.id, 'Cancelled due to superseding user message');

        internal.handleWorkerExit(agent.id, 0);

        const refreshedTask = orchestrator.getTasks().find(t => t.id === task.id)!;
        expect(refreshedTask.status).toBe('failed');
        expect(refreshedTask.assignedTo).toBeNull();
        expect(refreshedTask.error).toBe('Cancelled due to superseding user message');
        expect(cancelledReasons.has(task.id)).toBe(false);
    });
});
