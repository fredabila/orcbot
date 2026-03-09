import { describe, expect, it, vi } from 'vitest';
import { resolveInboundRoute } from '../src/core/InboundRouting';
import { Agent } from '../src/core/Agent';

describe('resolveInboundRoute', () => {
    it('resumes waiting actions before any other same-thread work', () => {
        const decision = resolveInboundRoute([
            {
                id: 'wait-1',
                type: 'TASK',
                payload: { sessionScopeId: 'scope:thread-1', source: 'telegram', sourceId: 'chat-1' },
                priority: 10,
                lane: 'user',
                status: 'waiting',
                timestamp: '2026-03-08T00:00:00.000Z'
            },
            {
                id: 'pending-1',
                type: 'TASK',
                payload: { sessionScopeId: 'scope:thread-1', source: 'telegram', sourceId: 'chat-1' },
                priority: 9,
                lane: 'user',
                status: 'pending',
                timestamp: '2026-03-08T00:01:00.000Z'
            }
        ] as any, {
            source: 'telegram',
            sourceId: 'chat-1',
            sessionScopeId: 'scope:thread-1',
            messageId: 'msg-2'
        });

        expect(decision.route).toBe('resume_waiting');
        expect(decision.waitingActionId).toBe('wait-1');
    });

    it('queues behind active work and marks stale pending work as superseded', () => {
        const decision = resolveInboundRoute([
            {
                id: 'active-1',
                type: 'TASK',
                payload: { sessionScopeId: 'scope:thread-1', source: 'telegram', sourceId: 'chat-1' },
                priority: 10,
                lane: 'user',
                status: 'in-progress',
                timestamp: '2026-03-08T00:00:00.000Z'
            },
            {
                id: 'pending-1',
                type: 'TASK',
                payload: { sessionScopeId: 'scope:thread-1', source: 'telegram', sourceId: 'chat-1' },
                priority: 8,
                lane: 'user',
                status: 'pending',
                timestamp: '2026-03-08T00:01:00.000Z'
            }
        ] as any, {
            source: 'telegram',
            sourceId: 'chat-1',
            sessionScopeId: 'scope:thread-1',
            messageId: 'msg-3'
        });

        expect(decision.route).toBe('queue_after_active');
        expect(decision.activeActionId).toBe('active-1');
        expect(decision.supersededActionIds).toEqual(['pending-1']);
    });
});

describe('Agent.pushTask inbound routing', () => {
    it('fails stale pending same-thread actions before queuing the newer one', async () => {
        const pushed: any[] = [];
        const updated: Array<{ id: string; status: string }> = [];

        const agent = Object.create(Agent.prototype) as any;
        agent.resolveSessionScopeId = vi.fn(() => 'scope:thread-1');
        agent.actionQueue = {
            getQueue: vi.fn(() => [
                {
                    id: 'old-pending',
                    type: 'TASK',
                    payload: { sessionScopeId: 'scope:thread-1', source: 'telegram', sourceId: 'chat-1', description: 'old request' },
                    priority: 10,
                    lane: 'user',
                    status: 'pending',
                    timestamp: '2026-03-08T00:00:00.000Z'
                }
            ]),
            updateStatus: vi.fn((id: string, status: string) => updated.push({ id, status })),
            push: vi.fn((action: any) => pushed.push(action))
        };
        agent.recentTaskFingerprints = new Map();
        agent.recentTaskDedupWindowMs = 60000;
        agent.processedMessages = new Set();
        agent.processedMessagesMaxSize = 5000;
        agent.trackKnownUser = vi.fn();
        agent.maybeReconnectBriefing = vi.fn(async () => undefined);
        agent.maybeCaptureOnboardingQuestionnaireResponse = vi.fn(async () => ({ captured: false, onboardingOnly: false }));
        agent.isUserAdmin = vi.fn(() => false);
        agent.config = { get: vi.fn((key: string) => key === 'guidanceMode' ? 'balanced' : undefined) };

        await agent.pushTask('new request', 10, {
            source: 'telegram',
            sourceId: 'chat-1',
            messageId: 'msg-new'
        }, 'user');

        expect(updated).toEqual([{ id: 'old-pending', status: 'failed' }]);
        expect(pushed).toHaveLength(1);
        expect(pushed[0].payload.inboundRoute).toBe('supersede_pending');
        expect(pushed[0].payload.inboundSupersededActionIds).toEqual(['old-pending']);
    });
});