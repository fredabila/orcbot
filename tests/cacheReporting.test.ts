import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TokenTracker } from '../src/core/TokenTracker';
import { MultiLLM } from '../src/core/MultiLLM';
import { DecisionEngine } from '../src/core/DecisionEngine';

const tmpDir = path.join(os.tmpdir(), `orcbot-cache-test-${Date.now()}`);

function entry(overrides: Record<string, any> = {}) {
    return {
        ts: new Date().toISOString(),
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
        cachedTokens: 0,
        metadata: { estimated: false },
        ...overrides,
    };
}

describe('TokenTracker cache reporting', () => {
    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    it('aggregates cached prompt tokens into totals, per provider and per model', () => {
        const summaryPath = path.join(tmpDir, 'summary.json');
        const tracker = new TokenTracker(summaryPath, path.join(tmpDir, 'usage.log'));

        tracker.record(entry({ provider: 'openai', cachedTokens: 800 }));
        tracker.record(entry({ provider: 'google', model: 'gemini-2.5-flash', cachedTokens: 200 }));

        const summary = tracker.getSummary();
        expect(summary.totals.cachedTokens).toBe(1000);
        expect(summary.byProvider['openai'].cachedTokens).toBe(800);
        expect(summary.byProvider['google'].cachedTokens).toBe(200);
        expect(summary.byModel['gpt-4o'].cachedTokens).toBe(800);
    });

    it('reports the cache hit rate and per-provider breakdown', () => {
        const summaryPath = path.join(tmpDir, 'summary2.json');
        const tracker = new TokenTracker(summaryPath, path.join(tmpDir, 'usage2.log'));

        tracker.record(entry({ provider: 'openai', promptTokens: 1000, cachedTokens: 750 }));
        tracker.record(entry({ provider: 'anthropic', promptTokens: 1000, cachedTokens: 250 }));

        const report = tracker.getCacheReport();
        expect(report.cachedTokens).toBe(1000);
        expect(report.promptTokens).toBe(2000);
        expect(report.hitRatePct).toBe(50);
        expect(report.byProvider).toEqual({ openai: 750, anthropic: 250 });
    });

    it('computes the hit rate against API-reported prompts only', () => {
        const summaryPath = path.join(tmpDir, 'summary4.json');
        const tracker = new TokenTracker(summaryPath, path.join(tmpDir, 'usage4.log'));

        // Only a call that returned a usage block can report a cache hit, so an estimated
        // call must not count as a cache miss and drag the displayed rate down.
        tracker.record(entry({ provider: 'openai', promptTokens: 1000, cachedTokens: 500 }));
        tracker.record(entry({ provider: 'ollama', promptTokens: 9000, cachedTokens: 0, metadata: { estimated: true } }));

        const report = tracker.getCacheReport();
        expect(report.promptTokens).toBe(10000);
        expect(report.reportedPromptTokens).toBe(1000);
        expect(report.hitRatePct).toBe(50);
    });

    it('treats a missing cachedTokens field as zero', () => {
        const summaryPath = path.join(tmpDir, 'summary3.json');
        const tracker = new TokenTracker(summaryPath, path.join(tmpDir, 'usage3.log'));
        const { cachedTokens, ...withoutCache } = entry();

        tracker.record(withoutCache as any);

        expect(tracker.getSummary().totals.cachedTokens).toBe(0);
        expect(tracker.getCacheReport().hitRatePct).toBe(0);
    });
});

describe('MultiLLM cache-hit accounting', () => {
    it('reads OpenAI prompt-cache hits from prompt_tokens_details', () => {
        const tracker = { record: vi.fn() };
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'k', tokenTracker: tracker as any });

        (llm as any).recordUsage('openai', 'gpt-4o', 'p', {
            usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } },
        }, 'out');

        expect(tracker.record.mock.calls[0][0].cachedTokens).toBe(80);
    });

    it('reads Gemini cache hits from usageMetadata', () => {
        const tracker = { record: vi.fn() };
        const llm = new MultiLLM({ modelName: 'gemini-2.5-flash', googleApiKey: 'k', tokenTracker: tracker as any });

        (llm as any).recordUsage('google', 'gemini-2.5-flash', 'p', {
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, total_cached_tokens: 64 },
        }, 'out');

        expect(tracker.record.mock.calls[0][0].cachedTokens).toBe(64);
    });

    it('reads Anthropic cache reads from cache_read_input_tokens', () => {
        const tracker = { record: vi.fn() };
        const llm = new MultiLLM({ modelName: 'claude-sonnet-4-5', anthropicApiKey: 'k', tokenTracker: tracker as any });

        (llm as any).recordUsage('anthropic', 'claude-sonnet-4-5', 'p', {
            usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 90 },
        }, 'out');

        expect(tracker.record.mock.calls[0][0].cachedTokens).toBe(90);
    });

    it('reports zero when the provider returns no usage data at all', () => {
        const tracker = { record: vi.fn() };
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'k', tokenTracker: tracker as any });

        (llm as any).recordUsage('openai', 'gpt-4o', 'some prompt', {}, 'done');

        const recorded = tracker.record.mock.calls[0][0];
        expect(recorded.cachedTokens).toBe(0);
        expect(recorded.metadata.estimated).toBe(true);
    });

    it('uses real usage from the OpenAI streaming path instead of estimating', async () => {
        const tracker = { record: vi.fn() };
        const encoder = new TextEncoder();
        const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 100 } } })}\n\ndata: [DONE]\n\n`,
        ];
        let served = 0;
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '',
            body: {
                getReader: () => ({
                    read: async () => served < chunks.length
                        ? { done: false, value: encoder.encode(chunks[served++]) }
                        : { done: true, value: undefined },
                }),
            },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'k', tokenTracker: tracker as any });

        const result = await llm.call('p', 's', 'openai', 'gpt-4o');

        expect(result).toBe('hi');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
        const recorded = tracker.record.mock.calls[0][0];
        expect(recorded.promptTokens).toBe(120);
        expect(recorded.completionTokens).toBe(8);
        expect(recorded.cachedTokens).toBe(100);
        expect(recorded.metadata.estimated).toBe(false);
    });
});

describe('OpenRouter cache breakpoints', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function bodyOf(fetchMock: any, callIndex: number) {
        return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
    }

    function openRouterStub() {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
            text: async () => '',
        }));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('adds a top-level cache breakpoint for Anthropic-family models', async () => {
        const fetchMock = openRouterStub();
        const llm = new MultiLLM({ modelName: 'anthropic/claude-sonnet-4', openrouterApiKey: 'k' });

        // Called directly: resolveProviderForModel maps an "anthropic/..." model id to the
        // Anthropic provider, which is not what this test is about.
        await (llm as any).callOpenRouter('decide', 'system', 'anthropic/claude-sonnet-4');

        expect(bodyOf(fetchMock, 0).cache_control).toEqual({ type: 'ephemeral' });
    });

    it('adds no cache breakpoint for providers that cache implicitly', async () => {
        const fetchMock = openRouterStub();
        const llm = new MultiLLM({ modelName: 'openai/gpt-5.1', openrouterApiKey: 'k' });

        await (llm as any).callOpenRouter('decide', 'system', 'openai/gpt-5.1');

        expect(bodyOf(fetchMock, 0)).not.toHaveProperty('cache_control');
    });

    it('adds the cache breakpoint on the native tool-calling path too', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: '', tool_calls: [] } }] }),
            text: async () => '',
        }));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'anthropic/claude-sonnet-4', openrouterApiKey: 'k' });

        await (llm as any).callOpenRouterWithTools('decide', 'system', [], 'anthropic/claude-sonnet-4');

        expect(bodyOf(fetchMock, 0).cache_control).toEqual({ type: 'ephemeral' });
    });
});

describe('DecisionEngine prompt prefix stability', () => {
    it('keeps the volatile runtime line out of the cacheable prompt prefix', async () => {
        const llmCalls: Array<{ prompt: string; systemMessage?: string }> = [];
        const mockLLM = {
            supportsNativeToolCalling: () => false,
            call: vi.fn(async (prompt: string, systemMessage?: string) => {
                llmCalls.push({ prompt, systemMessage });
                return JSON.stringify({
                    reasoning: 'done',
                    verification: { goals_met: true, analysis: 'complete' },
                    tools: [],
                });
            }),
        } as any;

        const mockMemory = {
            getUserContext: () => ({ raw: 'Test user' }),
            getRecentContext: () => [],
            getContactProfile: () => null,
        } as any;

        const mockSkills = {
            getSkillsPrompt: () => 'Available Skills:\n- send_telegram',
            getCompactSkillsPrompt: () => 'Tools: send_telegram',
            getRelevantSkillsPrompt: () => 'Available Skills:\n- send_telegram',
            getAllSkills: () => [{ name: 'send_telegram' }],
            matchSkillsForTask: () => [],
            getAgentSkillsPrompt: () => '',
            getActivatedSkillsContext: () => '',
            getAgentSkills: () => [],
            activateAgentSkill: () => {},
            deactivateNonStickySkills: () => {},
        } as any;

        const mockConfig = { get: () => undefined } as any;

        const engine = new DecisionEngine(
            mockMemory, mockLLM, mockSkills,
            path.join(tmpDir, 'journal.md'), path.join(tmpDir, 'learning.md'), mockConfig
        );
        engine.setAgentIdentity('Test Agent');

        await engine.decide({
            payload: {
                description: 'Say hello',
                messagesSent: 0,
                currentStep: 3,
                executionPlan: 'Greet the user',
                source: 'telegram',
                sourceId: 'test-user',
            },
        });

        const systemPrompt = llmCalls[0].systemMessage || '';

        // The runtime line carries per-step values, so leading with it would change the very
        // first tokens on every step and defeat the provider's automatic prompt cache.
        expect(systemPrompt.trimStart().startsWith('RUNTIME:')).toBe(false);
        expect(systemPrompt).toContain('RUNTIME:');
        expect(systemPrompt.indexOf('TOOLING RULE')).toBeLessThan(systemPrompt.indexOf('RUNTIME:'));
    });
});
