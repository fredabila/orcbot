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
        expect(priority).toBe(12);
        expect(metadata.continuationIntent).toBe('resume_prior_commitment');
        expect(metadata.replyToAgentText).toContain('default to Shopify');
    });
});