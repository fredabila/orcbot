import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '../src/core/MessageBus';

function createMockAgent() {
    return {
        resolveSessionScopeId: vi.fn(() => 'telegram:chat-1'),
        config: {
            get: vi.fn((key: string) => {
                if (key === 'telegramAutoReplyEnabled') return true;
                if (key === 'agentName') return 'OrcBot';
                return undefined;
            })
        },
        actionQueue: {
            getQueue: vi.fn(() => [])
        },
        memory: {
            saveMemory: vi.fn(),
            searchMemory: vi.fn(() => [])
        },
        llm: {
            callFast: vi.fn(async (prompt: string) => {
                const normalized = prompt.toLowerCase();
                if ((normalized.includes('new user message: """i dont care"""') || normalized.includes('new user message: """your call"""')) && normalized.includes('proceed with the build')) {
                    return JSON.stringify({ intent: 'continue_pending_work', subtype: 'permission', confidence: 0.93 });
                }
                if (normalized.includes('new user message: """ave you started"""') && (normalized.includes('setting up the theme') || normalized.includes('started. shopify selected'))) {
                    return JSON.stringify({ intent: 'continue_pending_work', subtype: 'status_check', confidence: 0.91 });
                }
                return JSON.stringify({ intent: 'normal_reply', subtype: 'none', confidence: 0.9 });
            })
        },
        pushTask: vi.fn(async () => undefined)
    } as any;
}

describe('MessageBus continuation routing', () => {
    it('promotes short reply-to-bot approvals into continuation work', async () => {
        const agent = createMockAgent();
        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'i dont care',
            messageId: 'msg-1',
            replyContext: '[Replying to OrcBot\'s message: "I\'ll default to Shopify and proceed with the build."]',
            metadata: {
                replyToMessageId: 111
            }
        });

        expect(agent.pushTask).toHaveBeenCalledTimes(1);
        const [description, priority, metadata] = agent.pushTask.mock.calls[0];
        expect(description).toContain('CONTINUATION:');
        expect(description).toContain('permission to continue');
        expect(priority).toBe(12);
        expect(metadata.continuationIntent).toBe('resume_prior_commitment');
        expect(metadata.replyToAgentMessage).toBe(true);
        expect(metadata.replyToAgentText).toContain('default to Shopify');
    });

    it('keeps ordinary replies as normal respond tasks', async () => {
        const agent = createMockAgent();
        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'what time is it',
            messageId: 'msg-2',
            replyContext: '[Replying to OrcBot\'s message: "I\'ll default to Shopify and proceed with the build."]'
        });

        expect(agent.pushTask).toHaveBeenCalledTimes(1);
        const [description, priority, metadata] = agent.pushTask.mock.calls[0];
        expect(description).toContain('Respond to telegram message');
        expect(description).not.toContain('CONTINUATION:');
        expect(priority).toBe(10);
        expect(metadata.continuationIntent).toBeUndefined();
    });

    it('infers continuation from recent same-thread assistant promise without explicit reply context', async () => {
        const agent = createMockAgent();
        agent.memory.searchMemory = vi.fn(() => [
            {
                id: 'tg-out-0',
                type: 'short',
                content: 'Assistant sent Telegram message to chat-1: First I will wire the product catalog, then I will configure checkout.',
                timestamp: new Date(Date.now() - 60_000).toISOString(),
                metadata: {
                    source: 'telegram',
                    role: 'assistant',
                    chatId: 'chat-1'
                }
            },
            {
                id: 'tg-out-1',
                type: 'short',
                content: 'Assistant sent Telegram message to chat-1: I\'ll default to Shopify and proceed with the build.',
                timestamp: new Date().toISOString(),
                metadata: {
                    source: 'telegram',
                    role: 'assistant',
                    chatId: 'chat-1'
                }
            }
        ]);

        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'your call',
            messageId: 'msg-3'
        });

        expect(agent.pushTask).toHaveBeenCalledTimes(1);
        const [description, priority, metadata] = agent.pushTask.mock.calls[0];
        expect(description).toContain('CONTINUATION:');
        expect(description).toContain('Recent assistant thread context:');
        expect(description).toContain('configure checkout');
        expect(priority).toBe(12);
        expect(metadata.continuationIntent).toBe('resume_prior_commitment');
        expect(metadata.replyToAgentText).toContain('default to Shopify');
        expect(metadata.continuationThreadContext).toContain('configure checkout');
    });

    it('queues quiet-mode continuation work even when reply suppression is requested', async () => {
        const agent = createMockAgent();
        agent.memory.searchMemory = vi.fn(() => [
            {
                id: 'tg-out-2',
                type: 'short',
                content: 'Assistant sent Telegram message to chat-1: I\'ll proceed with the build and send you the result.',
                timestamp: new Date().toISOString(),
                metadata: {
                    source: 'telegram',
                    role: 'assistant',
                    chatId: 'chat-1'
                }
            }
        ]);

        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'your call',
            messageId: 'msg-4',
            metadata: {
                suppressReply: true
            }
        });

        expect(agent.pushTask).toHaveBeenCalledTimes(1);
        const [description, , metadata] = agent.pushTask.mock.calls[0];
        expect(description).toContain('CONTINUATION:');
        expect(description).toContain('QUIET MODE:');
        expect(metadata.quietMode).toBe(true);
        expect(metadata.suppressProgressFeedback).toBe(true);
    });

    it('still suppresses trivial chatter when reply suppression is requested', async () => {
        const agent = createMockAgent();
        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'ok',
            messageId: 'msg-5',
            metadata: {
                suppressReply: true
            }
        });

        expect(agent.pushTask).not.toHaveBeenCalled();
    });

    it('promotes status-check follow-ups on pending work into continuation tasks', async () => {
        const agent = createMockAgent();
        agent.memory.searchMemory = vi.fn(() => [
            {
                id: 'tg-out-3',
                type: 'short',
                content: 'Assistant sent Telegram message to chat-1: Yeah — started. Shopify selected. I\'m setting up the theme and core pages first, then products and payments after that.',
                timestamp: new Date().toISOString(),
                metadata: {
                    source: 'telegram',
                    role: 'assistant',
                    chatId: 'chat-1'
                }
            }
        ]);

        const bus = new MessageBus(agent);

        await bus.dispatch({
            source: 'telegram',
            sourceId: 'chat-1',
            userId: 'user-1',
            senderName: 'Frederick',
            content: 'ave you started',
            messageId: 'msg-6'
        });

        expect(agent.pushTask).toHaveBeenCalledTimes(1);
        const [description, priority, metadata] = agent.pushTask.mock.calls[0];
        expect(description).toContain('CONTINUATION:');
        expect(description).toContain('Verify the real state');
        expect(description).toContain('resume it now');
        expect(priority).toBe(12);
        expect(metadata.continuationIntent).toBe('resume_prior_commitment');
        expect(metadata.followUpIntent).toBe('status_check_on_pending_work');
    });
});