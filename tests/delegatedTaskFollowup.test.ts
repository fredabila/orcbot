import { describe, expect, it } from 'vitest';
import { buildDelegatedTaskFollowupAction } from '../src/core/DelegatedTaskFollowup';

describe('buildDelegatedTaskFollowupAction', () => {
    it('builds a user-lane follow-up action when reply context is present', () => {
        const action = buildDelegatedTaskFollowupAction({
            task: {
                id: 'task-123',
                description: 'Look up the invoice status',
                assignedTo: 'agent-1',
                status: 'completed',
                priority: 8,
                createdAt: new Date().toISOString(),
                metadata: {
                    notifyParent: true,
                    delegationKind: 'delegate_task',
                    originalRequest: 'Check whether my invoice was paid.',
                    delegatedDescription: 'Look up the invoice status',
                    replyContext: {
                        source: 'telegram',
                        sourceId: 'chat-1',
                        chatId: 'chat-1',
                        userId: 'user-1',
                        sessionScopeId: 'scope:telegram:chat-1'
                    }
                }
            },
            agentId: 'agent-1',
            workerName: 'InvoiceWorker',
            outcome: 'completed',
            result: 'Invoice INV-44 was paid yesterday.'
        });

        expect(action).not.toBeNull();
        expect(action?.lane).toBe('user');
        expect(action?.payload?.delegatedFollowup).toBe(true);
        expect(action?.payload?.source).toBe('telegram');
        expect(action?.payload?.delegatedTaskOutcome).toBe('completed');
        expect(String(action?.payload?.description || '')).toContain('Invoice INV-44 was paid yesterday.');
    });

    it('returns null when there is no usable reply context', () => {
        const action = buildDelegatedTaskFollowupAction({
            task: {
                id: 'task-456',
                description: 'Background indexing',
                assignedTo: 'agent-2',
                status: 'completed',
                priority: 5,
                createdAt: new Date().toISOString(),
                metadata: {
                    notifyParent: false
                }
            },
            agentId: 'agent-2',
            outcome: 'completed',
            result: 'done'
        });

        expect(action).toBeNull();
    });
});