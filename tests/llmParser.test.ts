import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMParser } from '../src/core/LLMParser';

describe('LLMParser', () => {
    let mockLLM: { call: ReturnType<typeof vi.fn> };
    let parser: LLMParser;

    beforeEach(() => {
        mockLLM = {
            call: vi.fn()
        };
        parser = new LLMParser(mockLLM);
    });

    describe('extractFields', () => {
        it('should extract structured fields from LLM response', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                action: 'EXECUTE',
                tool: 'web_search',
                metadata: { query: 'test query' },
                reasoning: 'Need to search for info'
            }));

            const result = await parser.extractFields('{ broken json "tool": "web_search"');

            expect(result).not.toBeNull();
            expect(result!.action).toBe('EXECUTE');
            expect(result!.tool).toBe('web_search');
            expect(result!.metadata).toEqual({ query: 'test query' });
            expect(result!.reasoning).toBe('Need to search for info');
            expect(mockLLM.call).toHaveBeenCalledOnce();
        });

        it('should extract tools array', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                tools: [
                    { name: 'web_search', metadata: { query: 'test' } },
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'hi' } }
                ]
            }));

            const result = await parser.extractFields('malformed json with tools');

            expect(result).not.toBeNull();
            expect(result!.tools).toHaveLength(2);
            expect(result!.tools![0].name).toBe('web_search');
            expect(result!.tools![1].name).toBe('send_telegram');
        });

        it('should extract verification', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                action: 'THOUGHT',
                verification: { goals_met: true, analysis: 'Task complete' }
            }));

            const result = await parser.extractFields('{ goals_met: true }');

            expect(result).not.toBeNull();
            expect(result!.verification).toEqual({
                goals_met: true,
                analysis: 'Task complete'
            });
        });

        it('should return null when LLM returns empty result', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({}));

            const result = await parser.extractFields('completely broken');

            expect(result).toBeNull();
        });

        it('should return null when LLM returns no JSON', async () => {
            mockLLM.call.mockResolvedValue('I cannot parse this');

            const result = await parser.extractFields('not json at all');

            expect(result).toBeNull();
        });

        it('should return null when LLM call fails', async () => {
            mockLLM.call.mockRejectedValue(new Error('API error'));

            const result = await parser.extractFields('broken json');

            expect(result).toBeNull();
        });

        it('should cache results for repeated calls', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                tool: 'web_search',
                metadata: { query: 'test' }
            }));

            const result1 = await parser.extractFields('same input');
            const result2 = await parser.extractFields('same input');

            expect(result1).toEqual(result2);
            expect(mockLLM.call).toHaveBeenCalledOnce(); // Only called once due to cache
        });

        it('should truncate long reasoning', async () => {
            const longReasoning = 'x'.repeat(600);
            mockLLM.call.mockResolvedValue(JSON.stringify({
                tool: 'test',
                reasoning: longReasoning
            }));

            const result = await parser.extractFields('test input');

            expect(result!.reasoning!.length).toBeLessThanOrEqual(500);
        });

        it('should filter tools without names', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                tools: [
                    { name: 'valid_tool', metadata: {} },
                    { metadata: {} },  // No name
                    { name: '', metadata: {} }  // Empty name
                ]
            }));

            const result = await parser.extractFields('test');

            expect(result!.tools).toHaveLength(1);
            expect(result!.tools![0].name).toBe('valid_tool');
        });
    });

    describe('classifyIntent', () => {
        it('should classify action intent', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                intent: 'action',
                confidence: 0.9,
                suggestedHelpers: ['development', 'research']
            }));

            const result = await parser.classifyIntent('build me a website');

            expect(result.intent).toBe('action');
            expect(result.confidence).toBe(0.9);
            expect(result.suggestedHelpers).toContain('development');
        });

        it('should classify question intent', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                intent: 'question',
                confidence: 0.85,
                suggestedHelpers: ['research', 'communication']
            }));

            const result = await parser.classifyIntent('what is the weather like?');

            expect(result.intent).toBe('question');
            expect(result.suggestedHelpers).toContain('research');
        });

        it('should handle invalid intent gracefully', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                intent: 'invalid_intent',
                confidence: 2.5,
                suggestedHelpers: ['invalid_helper', 'development']
            }));

            const result = await parser.classifyIntent('test');

            expect(result.intent).toBe('unknown');
            expect(result.confidence).toBe(1); // Clamped to max
            expect(result.suggestedHelpers).toEqual(['development']); // Only valid helpers
        });

        it('should return default on LLM failure', async () => {
            mockLLM.call.mockRejectedValue(new Error('API error'));

            const result = await parser.classifyIntent('test');

            expect(result.intent).toBe('unknown');
            expect(result.confidence).toBe(0);
            expect(result.suggestedHelpers).toEqual(['communication']);
        });

        it('should return default when LLM returns no JSON', async () => {
            mockLLM.call.mockResolvedValue('No JSON here');

            const result = await parser.classifyIntent('test');

            expect(result.intent).toBe('unknown');
            expect(result.confidence).toBe(0);
            expect(result.suggestedHelpers).toEqual(['communication']);
        });

        it('should cache classification results', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                intent: 'development',
                confidence: 0.95,
                suggestedHelpers: ['development']
            }));

            await parser.classifyIntent('build a todo app');
            await parser.classifyIntent('build a todo app');

            expect(mockLLM.call).toHaveBeenCalledOnce();
        });
    });

    describe('normalizeMetadata', () => {
        it('should normalize field names', async () => {
            mockLLM.call.mockResolvedValue(JSON.stringify({
                chatId: '123456',
                message: 'Hello world'
            }));

            const result = await parser.normalizeMetadata(
                'send_telegram',
                { chat_id: '123456', content: 'Hello world' },
                ['chatId', 'message']
            );

            expect(result.chatId).toBe('123456');
            expect(result.message).toBe('Hello world');
        });

        it('should return original metadata on failure', async () => {
            mockLLM.call.mockRejectedValue(new Error('API error'));

            const original = { chat_id: '123', content: 'test' };
            const result = await parser.normalizeMetadata('send_telegram', original, ['chatId', 'message']);

            expect(result).toEqual(original);
        });

        it('should return original when LLM returns non-JSON', async () => {
            mockLLM.call.mockResolvedValue('Unable to process');

            const original = { x: 1 };
            const result = await parser.normalizeMetadata('test_tool', original, ['y']);

            expect(result).toEqual(original);
        });
    });
});
