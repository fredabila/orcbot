import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/core/Agent';
import { StepLedger } from '../src/core/CompletionAudit';

const cronerState = vi.hoisted(() => {
    const callbacks = new Map<string, () => void>();
    class MockCron {
        public readonly schedule: string;
        constructor(schedule: string, callback?: () => void) {
            this.schedule = schedule;
            if (callback) {
                callbacks.set(schedule, callback);
            }
        }
        stop() {
            callbacks.delete(this.schedule);
        }
    }
    return { callbacks, MockCron };
});

vi.mock('croner', () => ({
    Cron: cronerState.MockCron
}));

describe('Heartbeat system', () => {
    let tempDir: string;
    let actionQueuePath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-heartbeat-'));
        actionQueuePath = path.join(tempDir, 'action_queue.json');
        fs.writeFileSync(actionQueuePath, '[]', 'utf8');
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function createAgentHarness() {
        const agent = Object.create(Agent.prototype) as any;
        agent.config = {
            get: (key: string) => {
                const map: Record<string, any> = {
                    actionQueuePath,
                    userProfilePath: path.join(tempDir, 'USER.md'),
                    journalPath: path.join(tempDir, 'JOURNAL.md'),
                    learningPath: path.join(tempDir, 'LEARNING.md'),
                    worldPath: path.join(tempDir, 'WORLD.md')
                };
                return map[key];
            }
        };
        agent.memory = {
            getRecentContext: () => []
        };
        agent.actionQueue = {
            getQueue: () => []
        };
        agent.pushTask = vi.fn();
        agent.isBusy = false;
        agent.lastUserActivityAt = 0;
        agent.lastHeartbeatPushAt = 0;
        agent.heartbeatJobMeta = new Map();
        agent.heartbeatJobs = new Map();
        agent.heartbeatSchedulePath = path.join(tempDir, 'heartbeat-schedules.json');
        agent.telegram = undefined;
        agent.whatsapp = undefined;
        agent.discord = undefined;
        agent.slack = undefined;
        agent.lastHeartbeatMessageSentAt = 0;
        agent.lastWorldEventsRefreshAt = 0;
        agent.lastWorldEventsSummary = '';
        return agent;
    }

    it('builds a heartbeat prompt that references the correct tools', () => {
        const agent = createAgentHarness();

        const prompt = agent.buildSmartHeartbeatPrompt(30 * 60 * 1000, 0, 0);

        expect(prompt).toContain('heartbeat_mark_check(checks, timestamp?)');
        expect(prompt).toContain("'npm run build' via 'run_command'");
        expect(prompt).not.toContain('run_terminal_command');
        expect(prompt).not.toContain(`use write_file on \`${path.join(tempDir, 'heartbeat-state.json')}\``);
    });

    it('skips generic idle heartbeat work before the long-idle threshold and avoids world-event refresh', async () => {
        const agent = createAgentHarness();
        agent.config = {
            get: (key: string) => {
                const map: Record<string, any> = {
                    actionQueuePath,
                    userProfilePath: path.join(tempDir, 'USER.md'),
                    journalPath: path.join(tempDir, 'JOURNAL.md'),
                    learningPath: path.join(tempDir, 'LEARNING.md'),
                    worldPath: path.join(tempDir, 'WORLD.md'),
                    autonomyEnabled: true,
                    autonomyInterval: 15,
                    autonomyPostUserCooldownSeconds: 0,
                    worldEventsHeartbeatEnabled: true,
                };
                return map[key];
            }
        };
        agent.detectStalledAction = vi.fn();
        agent.recoverStaleInProgressActions = vi.fn();
        agent.maybeRefreshWorldEventsContext = vi.fn(async () => undefined);
        agent.selfTraining = {
            prepareTrainingJobIfNeeded: vi.fn(() => ({ prepared: false }))
        };
        agent.orchestrator = {
            getRunningWorkers: () => [],
            getAvailableAgents: () => []
        };
        agent.lastActionTime = Date.now() - 20 * 60 * 1000;
        agent.lastHeartbeatAt = 0;
        agent.lastHeartbeatProductive = true;
        agent.consecutiveIdleHeartbeats = 0;
        agent.heartbeatRunning = false;

        await agent.checkHeartbeat();

        expect(agent.maybeRefreshWorldEventsContext).not.toHaveBeenCalled();
        expect(agent.pushTask).not.toHaveBeenCalled();
    });

    it('runs lightweight maintenance when the main heartbeat is suppressed by queue activity', async () => {
        const agent = createAgentHarness();
        agent.config = {
            get: (key: string) => {
                const map: Record<string, any> = {
                    actionQueuePath,
                    userProfilePath: path.join(tempDir, 'USER.md'),
                    journalPath: path.join(tempDir, 'JOURNAL.md'),
                    learningPath: path.join(tempDir, 'LEARNING.md'),
                    worldPath: path.join(tempDir, 'WORLD.md'),
                    autonomyEnabled: true,
                    autonomyInterval: 15,
                    autonomyPostUserCooldownSeconds: 0,
                    lightweightHeartbeatEnabled: true,
                    lightweightHeartbeatIntervalMinutes: 1,
                    pluginHealthCheckIntervalMinutes: 60,
                    worldEventsHeartbeatEnabled: false,
                };
                return map[key];
            }
        };
        agent.detectStalledAction = vi.fn();
        agent.recoverStaleInProgressActions = vi.fn();
        agent.maybeRefreshWorldEventsContext = vi.fn(async () => undefined);
        agent.memory = {
            getRecentContext: () => [],
            flushToDisk: vi.fn(),
            saveMemory: vi.fn()
        };
        agent.skills = {
            loadPlugins: vi.fn(),
            checkPluginsHealth: vi.fn(async () => ({ healthy: [], issues: [] }))
        };
        agent.syncSkillsRegistryNow = vi.fn(() => ({ success: true, targets: [], sourcePath: null }));
        agent.selfTraining = {
            prepareTrainingJobIfNeeded: vi.fn(() => ({ prepared: false }))
        };
        agent.actionQueue = {
            getQueue: () => [
                {
                    id: 'pending-user-task',
                    status: 'pending',
                    payload: { description: 'User work pending' }
                }
            ]
        };
        agent.lastActionTime = Date.now() - 5 * 60 * 1000;
        agent.lastHeartbeatAt = 0;
        agent.lastLightweightHeartbeatAt = 0;
        agent.heartbeatRunning = false;

        await agent.checkHeartbeat();

        expect(agent.memory.flushToDisk).toHaveBeenCalledTimes(1);
        expect(agent.syncSkillsRegistryNow).toHaveBeenCalledTimes(1);
        expect(agent.skills.loadPlugins).toHaveBeenCalledWith(true);
        expect(agent.pushTask).not.toHaveBeenCalled();
        expect(agent.maybeRefreshWorldEventsContext).not.toHaveBeenCalled();
    });

    it('updates heartbeat check state by merging timestamps safely', () => {
        const agent = createAgentHarness();
        const statePath = path.join(tempDir, 'heartbeat-state.json');
        fs.writeFileSync(statePath, JSON.stringify({ email: 1000 }, null, 2), 'utf8');

        const updatedChecks = agent.updateHeartbeatCheckState(['news', 'email'], 2000);
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

        expect(updatedChecks).toEqual(['news', 'email']);
        expect(state).toEqual({ email: 2000, news: 2000 });
    });

    it('manages heartbeat instructions through the dedicated helper', () => {
        const agent = createAgentHarness();
        const instructionsPath = path.join(tempDir, 'heartbeat.md');

        expect(agent.manageHeartbeatInstructions('read')).toBe('');

        agent.manageHeartbeatInstructions('replace', 'Focus on support inbox triage.');
        expect(fs.readFileSync(instructionsPath, 'utf8')).toBe('Focus on support inbox triage.');

        agent.manageHeartbeatInstructions('append', 'Keep summaries concise.');
        expect(fs.readFileSync(instructionsPath, 'utf8')).toBe('Focus on support inbox triage.\n\nKeep summaries concise.');

        agent.manageHeartbeatInstructions('clear');
        expect(fs.readFileSync(instructionsPath, 'utf8')).toBe('');
    });

    it('preserves scheduled heartbeat objectives when refreshing execution context', () => {
        const agent = createAgentHarness();

        const description = agent.composeHeartbeatExecutionDescription(
            {
                isHeartbeat: true,
                heartbeatKind: 'scheduled',
                heartbeatTask: 'Check the support inbox for urgent failures and report only if there is a real blocker.'
            },
            2 * 60 * 60 * 1000,
            1,
            0
        );

        expect(description).toContain('SCHEDULED HEARTBEAT TASK');
        expect(description).toContain('Check the support inbox for urgent failures and report only if there is a real blocker.');
        expect(description).toContain('Do NOT replace this scheduled task with a generic idle-time initiative');
    });

    it('updates the heartbeat message timestamp after a successful heartbeat send', () => {
        const agent = createAgentHarness();
        const before = Date.now();

        agent.recordSuccessfulSideEffectDelivery(
            {
                id: 'hb-send',
                type: 'task',
                priority: 2,
                lane: 'autonomy',
                status: 'pending',
                timestamp: new Date().toISOString(),
                payload: {
                    isHeartbeat: true,
                    source: 'telegram',
                    sourceId: 'chat-1',
                    description: 'Heartbeat follow-up'
                }
            },
            { name: 'send_telegram', metadata: { message: 'Actual update' } },
            'Message sent successfully',
            new Set<string>()
        );

        expect(agent.lastHeartbeatMessageSentAt).toBeGreaterThanOrEqual(before);
    });

    it('treats silent successful tool work as productive heartbeat work', () => {
        const agent = createAgentHarness();
        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            timestamp: Date.now(),
        });

        const productive = agent.didHeartbeatProduceUsefulWork({
            stepLedger: ledger,
            substantiveDeliveriesSent: 0,
            anyUserDeliverySuccess: false,
        });

        expect(productive).toBe(true);
    });

    it('enqueues scheduled heartbeat tasks with preserved scheduled metadata', () => {
        const agent = createAgentHarness();

        agent.registerHeartbeatSchedule({
            id: 'hb_test',
            schedule: '0 * * * *',
            task: 'Review support inbox for urgent regressions.',
            priority: 4,
            createdAt: new Date().toISOString()
        }, false);

        const callback = cronerState.callbacks.get('0 * * * *');
        expect(callback).toBeTypeOf('function');

        callback?.();

        expect(agent.pushTask).toHaveBeenCalledWith(
            'Heartbeat Task: Review support inbox for urgent regressions.',
            4,
            expect.objectContaining({
                isHeartbeat: true,
                heartbeatId: 'hb_test',
                heartbeatKind: 'scheduled',
                heartbeatTask: 'Review support inbox for urgent regressions.'
            }),
            'autonomy'
        );
    });
});