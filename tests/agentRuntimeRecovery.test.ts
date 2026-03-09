import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/core/Agent';
import type { Action } from '../src/memory/ActionQueue';

type SavedMemory = {
    id: string;
    type: string;
    content: string;
    metadata?: any;
};

function createAction(id: string): Action {
    return {
        id,
        type: 'task',
        priority: 10,
        lane: 'user',
        status: 'pending',
        timestamp: new Date().toISOString(),
        payload: {
            description: 'Recover from a failed tool execution',
            source: 'autonomy'
        }
    };
}

function createAgentHarness(options: {
    action: Action;
    decisions: any[];
    executeSkill: (name: string, metadata: any) => Promise<any>;
    getSkill?: (name: string) => any;
    taskComplexity?: 'trivial' | 'simple' | 'standard' | 'complex';
    reviewForcedTermination?: (reason: string) => Promise<'continue' | 'terminate' | 'stop'>;
    configOverrides?: Record<string, any>;
}) {
    const savedMemories: SavedMemory[] = [];
    const actions = [options.action];
    const decisionMock = vi.fn(async () => {
        const next = options.decisions.shift();
        if (!next) {
            throw new Error('No queued decision available for test');
        }
        return next;
    });

    const executeSkillMock = vi.fn(options.executeSkill);
    const updateStatusMock = vi.fn((actionId: string, status: Action['status']) => {
        const action = actions.find(entry => entry.id === actionId);
        if (action) action.status = status;
    });

    const agent = Object.create(Agent.prototype) as any;
    agent.isBusy = false;
    agent.currentActionId = null;
    agent.currentActionStartAt = null;
    agent.activeToolExecutions = new Map();
    agent.lastActionTime = Date.now();
    agent.lastHeartbeatProductive = true;
    agent.consecutiveIdleHeartbeats = 0;
    agent.maxStepFallbackCount = 0;
    agent.delayRiskHighCount = 0;
    agent._blankPageCount = 0;
    agent.cancelledActions = new Set();
    agent.typingIntervals = new Map();
    agent.browser = { _blankUrlHistory: { clear: vi.fn() } };
    agent.orchestrator = {
        getRunningWorkers: () => [],
        getAvailableAgents: () => []
    };
    agent.telegram = undefined;
    agent.whatsapp = undefined;
    agent.slack = undefined;
    agent.llm = {};
    agent.config = {
        get: (key: string) => {
            const map: Record<string, any> = {
                maxStepsPerAction: 6,
                maxMessagesPerAction: 4,
                progressFeedbackStepInterval: 4,
                progressFeedbackForceInitial: false,
                maxToolRepeats: 5,
                maxResearchToolRepeats: 20,
                sessionAnchorEnabled: true,
                compactSkillsPrompt: false
            };
            if (options.configOverrides && key in options.configOverrides) {
                return options.configOverrides[key];
            }
            return map[key];
        },
        getDataHome: () => 'D:/orcbot'
    };
    agent.memory = {
        saveMemory: vi.fn((entry: SavedMemory) => {
            savedMemories.push(entry);
        }),
        getActionMemories: vi.fn(() => savedMemories.filter(entry => (entry.metadata?.actionId || '').toString() === options.action.id)),
        cleanupActionMemories: vi.fn(),
        flushToDisk: vi.fn(),
        consolidate: vi.fn().mockResolvedValue(undefined),
        consolidateInteractions: vi.fn().mockResolvedValue(undefined)
    };
    agent.actionQueue = {
        getNext: vi.fn(() => {
            const nextPending = actions.find(entry => entry.status === 'pending');
            if (!nextPending) return undefined;
            nextPending.status = 'in-progress';
            return nextPending;
        }),
        getQueue: vi.fn(() => actions),
        updateStatus: updateStatusMock
    };
    agent.skills = {
        executeSkill: executeSkillMock,
        getSkill: vi.fn((name: string) => options.getSkill?.(name) || null),
        getCompactSkillsPrompt: vi.fn(() => 'Tools: alpha, beta'),
        getSkillsPrompt: vi.fn(() => 'Available Skills:\n- alpha\n- beta')
    };
    agent.simulationEngine = {
        simulate: vi.fn(async () => 'STEP BUDGET: 3\n- Try a tool and recover if it fails.')
    };
    agent.decisionEngine = {
        decide: decisionMock
    };
    agent.blockReviewer = {};
    agent.startPersistentTypingIndicator = vi.fn();
    agent.stopPersistentTypingIndicator = vi.fn();
    agent.updateLastActionTime = vi.fn();
    agent.buildSimulationContext = vi.fn(() => '');
    agent.buildSessionContinuityHint = vi.fn(() => '');
    agent.classifyTaskComplexity = vi.fn(async () => 'standard');
    if (options.taskComplexity) {
        agent.classifyTaskComplexity = vi.fn(async () => options.taskComplexity);
    }
    agent.sendProgressFeedback = vi.fn(async () => false);
    agent.isRobustReasoningEnabled = vi.fn(() => false);
    agent.shouldExposeChecklistPreview = vi.fn(() => false);
    agent.buildChecklistPreviewMessage = vi.fn(() => '');
    agent.sendChecklistPreview = vi.fn(async () => false);
    agent.buildActionTimeSignals = vi.fn(() => ({ delayRisk: 'low' }));
    agent.reviewForcedTermination = vi.fn(async (_action: Action, reason: string) => {
        if (options.reviewForcedTermination) {
            return options.reviewForcedTermination(reason);
        }
        return 'stop';
    });
    agent.reviewHardBlock = vi.fn(async () => ({ verdict: 'CONTINUE' }));
    agent.isSequentialUIComponent = vi.fn(() => false);
    agent.isSubstantiveDeliveryMessage = vi.fn(() => true);
    agent.detectAndResumeIncompleteWork = vi.fn(async () => undefined);
    agent.auditCompletionFromActionLogs = vi.fn(async () => ({ ok: true, issues: [] }));
    agent.buildAuditCode = vi.fn(() => 'audit');
    agent.hasExistingRecoveryTask = vi.fn(() => false);
    agent.pushTask = vi.fn(async () => undefined);
    agent.sendNoResponseFallback = vi.fn(async () => false);
    agent.postActionReflection = vi.fn(async () => undefined);
    agent.getOrCreateEmailChannel = vi.fn(() => undefined);

    return {
        agent,
        savedMemories,
        decisionMock,
        executeSkillMock,
        updateStatusMock,
    };
}

describe('Agent runtime recovery supervision', () => {
    it('does not fail a long-running action while an active tool is still within its watchdog window', () => {
        const action = createAction('stalled-action-active-tool');
        const harness = createAgentHarness({
            action,
            decisions: [],
            executeSkill: async () => ({ success: true })
        });

        harness.agent.isBusy = true;
        harness.agent.currentActionId = action.id;
        harness.agent.currentActionStartAt = Date.now() - 11 * 60 * 1000;
        harness.agent.activeToolExecutions.set('tool-1', {
            actionId: action.id,
            toolName: 'run_command',
            startedAt: Date.now() - 2 * 60 * 1000,
            deadlineAt: Date.now() + 2 * 60 * 1000,
        });

        (harness.agent as any).detectStalledAction();

        expect(harness.updateStatusMock).not.toHaveBeenCalled();
        expect(harness.agent.isBusy).toBe(true);
        expect(harness.agent.currentActionId).toBe(action.id);
    });

    it('fails an overlong action when no active tool window remains', () => {
        const action = createAction('stalled-action-no-tool');
        const harness = createAgentHarness({
            action,
            decisions: [],
            executeSkill: async () => ({ success: true })
        });

        harness.agent.isBusy = true;
        harness.agent.currentActionId = action.id;
        harness.agent.currentActionStartAt = Date.now() - 11 * 60 * 1000;

        (harness.agent as any).detectStalledAction();

        expect(harness.updateStatusMock).toHaveBeenCalledWith(action.id, 'failed');
        expect(harness.agent.isBusy).toBe(false);
        expect(harness.agent.currentActionId).toBeNull();
    });

    it('replans immediately after a serial tool failure and skips later tools in that batch', async () => {
        const action = createAction('serial-action');
        const decisions = [
            {
                reasoning: 'Try the first tool, then the second if needed.',
                verification: { goals_met: false, analysis: 'Need tool work' },
                tools: [
                    { name: 'alpha', metadata: { command: 'slow-op' } },
                    { name: 'beta', metadata: { command: 'should-not-run' } }
                ]
            },
            {
                reasoning: 'Recovered after failure.',
                verification: { goals_met: true, analysis: 'Done after replanning' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            executeSkill: async (name: string) => {
                if (name === 'alpha') throw new Error('Request timeout while fetching data');
                return { success: true };
            }
        });

        await (harness.agent as any).processNextAction();

        expect(harness.decisionMock).toHaveBeenCalledTimes(2);
        const executedToolNames = harness.executeSkillMock.mock.calls.map(call => call[0]);
        expect(executedToolNames[0]).toBe('alpha');
        expect(executedToolNames).not.toContain('beta');

        const workflowSignal = harness.savedMemories.find(entry => entry.content.includes('WORKFLOW_SIGNAL'));
        expect(workflowSignal?.content).toContain('queued_tools_skipped=1');
        expect(workflowSignal?.content).toContain('error_type=timeout');
        expect(workflowSignal?.content).toContain('fallback path');
        expect(action.status).toBe('completed');
    });

    it('replans after a parallel batch failure and does not continue into later batches', async () => {
        const action = createAction('parallel-action');
        const decisions = [
            {
                reasoning: 'Fan out safe tools first, then continue.',
                verification: { goals_met: false, analysis: 'Need more work' },
                tools: [
                    { name: 'parallel_alpha', metadata: { query: 'first' } },
                    { name: 'parallel_beta', metadata: { query: 'second' } },
                    { name: 'gamma', metadata: { query: 'must-not-run' } }
                ]
            },
            {
                reasoning: 'Recovered from the failed batch.',
                verification: { goals_met: true, analysis: 'Done after replanning' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            executeSkill: async (name: string) => {
                if (name === 'parallel_alpha') throw new Error('Network timeout while searching');
                if (name === 'parallel_beta') return { success: true, path: 'D:/orcbot/tmp/result.txt' };
                return { success: true };
            },
            getSkill: (name: string) => name.startsWith('parallel_') ? { isParallelSafe: true, isDeep: true } : { isParallelSafe: false, isDeep: true }
        });

        await (harness.agent as any).processNextAction();

        expect(harness.decisionMock).toHaveBeenCalledTimes(2);
        expect(harness.executeSkillMock).toHaveBeenCalledTimes(2);
        expect(harness.executeSkillMock.mock.calls.map(call => call[0])).toEqual(['parallel_alpha', 'parallel_beta']);

        const workflowSignal = harness.savedMemories.find(entry => entry.content.includes('WORKFLOW_SIGNAL') && entry.content.includes('parallel_alpha'));
        expect(workflowSignal?.content).toContain('queued_tools_skipped=1');
        expect(workflowSignal?.content).toContain('error_type=timeout');
        expect(harness.savedMemories.some(entry => entry.content.includes('gamma'))).toBe(false);
        expect(action.status).toBe('completed');
    });

    it('replans during bonus steps after a failed bonus tool and skips later bonus tools in that turn', async () => {
        const action = createAction('bonus-action');
        const decisions = [
            ...Array.from({ length: 6 }, (_, index) => ({
                reasoning: `Main loop step ${index + 1}`,
                verification: { goals_met: false, analysis: 'Keep working until bonus steps' },
                tools: [{ name: 'prep', metadata: { index } }]
            })),
            {
                reasoning: 'Bonus recovery attempt with tool execution.',
                verification: { goals_met: false, analysis: 'Need a final recovery attempt' },
                tools: [
                    { name: 'bonus_alpha', metadata: { query: 'first bonus attempt' } },
                    { name: 'bonus_beta', metadata: { query: 'should-not-run-in-same-bonus-step' } }
                ]
            },
            {
                reasoning: 'Bonus recovery succeeded after replanning.',
                verification: { goals_met: true, analysis: 'Final wrap-up is complete' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            taskComplexity: 'trivial',
            reviewForcedTermination: async (reason: string) => reason === 'max_steps' ? 'continue' : 'stop',
            configOverrides: {
                maxToolRepeats: 10
            },
            executeSkill: async (name: string) => {
                if (name === 'bonus_alpha') throw new Error('Network timeout during bonus recovery');
                return { success: true };
            }
        });

        await (harness.agent as any).processNextAction();

        expect(harness.decisionMock).toHaveBeenCalledTimes(8);
        const executedToolNames = harness.executeSkillMock.mock.calls.map(call => call[0]);
        expect(executedToolNames.slice(0, 5)).toEqual(['prep', 'prep', 'prep', 'prep', 'prep']);
        expect(executedToolNames).toContain('bonus_alpha');
        expect(executedToolNames).not.toContain('bonus_beta');

        const bonusWorkflowSignal = harness.savedMemories.find(entry => entry.content.includes('WORKFLOW_SIGNAL') && entry.content.includes('bonus_alpha'));
        expect(bonusWorkflowSignal?.content).toContain('error_type=timeout');
        expect(bonusWorkflowSignal?.content).toContain('fallback path');
        expect(action.status).toBe('completed');
    });

    it('skips repeated failed bonus signatures and executes the fallback tool instead', async () => {
        const action = createAction('bonus-signature-action');
        const decisions = [
            ...Array.from({ length: 6 }, (_, index) => ({
                reasoning: `Warm-up step ${index + 1}`,
                verification: { goals_met: false, analysis: 'Reach bonus recovery path' },
                tools: [{ name: 'prep', metadata: { index } }]
            })),
            {
                reasoning: 'First bonus attempt fails.',
                verification: { goals_met: false, analysis: 'Need fallback after failure' },
                tools: [
                    { name: 'bonus_alpha', metadata: { query: 'repeat-me' } },
                    { name: 'bonus_beta', metadata: { query: 'skip-this-turn' } }
                ]
            },
            {
                reasoning: 'Retry with the same failed tool plus a fallback.',
                verification: { goals_met: false, analysis: 'Fallback should run' },
                tools: [
                    { name: 'bonus_alpha', metadata: { query: 'repeat-me' } },
                    { name: 'bonus_gamma', metadata: { query: 'fallback-path' } }
                ]
            },
            {
                reasoning: 'Bonus recovery finished.',
                verification: { goals_met: true, analysis: 'Finished after fallback' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            taskComplexity: 'trivial',
            reviewForcedTermination: async (reason: string) => reason === 'max_steps' ? 'continue' : 'stop',
            configOverrides: {
                maxToolRepeats: 10
            },
            executeSkill: async (name: string) => {
                if (name === 'bonus_alpha') throw new Error('Timeout on repeated bonus call');
                return { success: true };
            }
        });

        await (harness.agent as any).processNextAction();

        const executedToolNames = harness.executeSkillMock.mock.calls.map(call => call[0]);
        expect(executedToolNames.filter(name => name === 'bonus_alpha')).toHaveLength(1);
        expect(executedToolNames).toContain('bonus_gamma');
        expect(executedToolNames).not.toContain('bonus_beta');
        expect(action.status).toBe('completed');
    });

    it('skips duplicate bonus side effects that already succeeded earlier in the action', async () => {
        const action = createAction('bonus-side-effect-action');
        const decisions = [
            {
                reasoning: 'Send the main progress update first.',
                verification: { goals_met: false, analysis: 'Need more work before wrap-up' },
                tools: [{ name: 'send_reply', metadata: { message: 'Main update', chatId: 'abc' } }]
            },
            ...Array.from({ length: 5 }, (_, index) => ({
                reasoning: `Warm-up step ${index + 2}`,
                verification: { goals_met: false, analysis: 'Reach bonus path' },
                tools: [{ name: 'prep', metadata: { index } }]
            })),
            {
                reasoning: 'Bonus step should skip the duplicate send and use the fallback message.',
                verification: { goals_met: false, analysis: 'Need one final wrap-up message' },
                tools: [
                    { name: 'send_reply', metadata: { message: 'Main update', chatId: 'abc' } },
                    { name: 'send_reply', metadata: { message: 'Final wrap-up', chatId: 'abc' } }
                ]
            },
            {
                reasoning: 'Wrap-up is complete.',
                verification: { goals_met: true, analysis: 'Nothing else is needed' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            taskComplexity: 'trivial',
            reviewForcedTermination: async (reason: string) => reason === 'max_steps' ? 'continue' : 'stop',
            getSkill: (name: string) => name === 'send_reply'
                ? { isSideEffect: true, isSend: true }
                : { isSideEffect: false, isSend: false },
            executeSkill: async (_name: string, metadata: any) => ({ success: true, delivered: metadata?.message })
        });

        await (harness.agent as any).processNextAction();

        const sendCalls = harness.executeSkillMock.mock.calls
            .filter(call => call[0] === 'send_reply')
            .map(call => call[1]?.message);

        expect(sendCalls).toEqual(['Main update', 'Final wrap-up']);
        expect(action.status).toBe('completed');
    });

    it('blocks redundant main-step sends after the first delivery in the same step', async () => {
        const action = createAction('main-send-cooldown-action');
        const decisions = [
            {
                reasoning: 'Send once, then avoid redundant sends in the same step.',
                verification: { goals_met: false, analysis: 'One send is enough for this turn' },
                tools: [
                    { name: 'send_reply', metadata: { message: 'First reply', chatId: 'abc' } },
                    { name: 'send_reply', metadata: { message: 'Second reply', chatId: 'abc' } }
                ]
            },
            {
                reasoning: 'Wrap-up is done.',
                verification: { goals_met: true, analysis: 'No more sends needed' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            getSkill: (name: string) => name === 'send_reply'
                ? { isSideEffect: true, isSend: true }
                : { isSideEffect: false, isSend: false },
            executeSkill: async (_name: string, metadata: any) => ({ success: true, delivered: metadata?.message })
        });

        await (harness.agent as any).processNextAction();

        const sendCalls = harness.executeSkillMock.mock.calls
            .filter(call => call[0] === 'send_reply')
            .map(call => call[1]?.message);

        expect(sendCalls).toEqual(['First reply']);
        expect(action.status).toBe('completed');
    });

    it('passes metadata arguments through the shared parallel executor', async () => {
        const action = createAction('parallel-metadata-action');
        const decisions = [
            {
                reasoning: 'Run two parallel-safe tools using metadata-shaped arguments.',
                verification: { goals_met: false, analysis: 'Need the parallel batch first' },
                tools: [
                    { name: 'parallel_alpha', metadata: { query: 'first-metadata-query' } },
                    { name: 'parallel_beta', metadata: { query: 'second-metadata-query' } }
                ]
            },
            {
                reasoning: 'Parallel batch completed.',
                verification: { goals_met: true, analysis: 'Done after the parallel step' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            getSkill: (name: string) => name.startsWith('parallel_')
                ? { isParallelSafe: true, isDeep: true }
                : { isParallelSafe: false, isDeep: true },
            executeSkill: async (_name: string, metadata: any) => ({ success: true, seenQuery: metadata?.query })
        });

        await (harness.agent as any).processNextAction();

        const toolCalls = harness.executeSkillMock.mock.calls.map(call => ({ name: call[0], query: call[1]?.query }));
        expect(toolCalls).toEqual([
            { name: 'parallel_alpha', query: 'first-metadata-query' },
            { name: 'parallel_beta', query: 'second-metadata-query' }
        ]);
        expect(action.status).toBe('completed');
    });

    it('treats send_voice_note as a delivered side effect so completion does not retry silently', async () => {
        const action = createAction('voice-note-action');
        const decisions = [
            {
                reasoning: 'Send the requested audio reply.',
                verification: { goals_met: false, analysis: 'Need to deliver the voice note first' },
                tools: [
                    { name: 'send_voice_note', metadata: { chatId: '8077489121', message: 'Here is the audio update about my day.' } }
                ]
            },
            {
                reasoning: 'The voice note has already been sent.',
                verification: { goals_met: true, analysis: 'Task is complete after delivery' },
                tools: []
            }
        ];

        const harness = createAgentHarness({
            action,
            decisions,
            executeSkill: async (_name: string, metadata: any) => ({
                success: true,
                message: `Voice note sent via Telegram to ${metadata?.chatId}`
            })
        });

        await (harness.agent as any).processNextAction();

        expect(harness.decisionMock).toHaveBeenCalledTimes(2);
        const executedToolNames = harness.executeSkillMock.mock.calls.map(call => call[0]);
        expect(executedToolNames).toEqual(['send_voice_note']);
        expect(action.status).toBe('completed');
    });
});