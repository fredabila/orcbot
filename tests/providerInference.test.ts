import { describe, it, expect } from 'vitest';
import { MultiLLM } from '../src/core/MultiLLM';
import { inferProviderFromModel, hasStrongProviderSignal } from '../src/config/providerInference';
import { PERSISTABLE_PROVIDERS, normalizeProviderId } from '../src/config/ModelRegistry';

describe('provider inference for expanded providers', () => {
    it('infers DeepSeek from prefix and name fragment', () => {
        expect(inferProviderFromModel('deepseek:deepseek-chat')).toBe('deepseek');
        expect(inferProviderFromModel('deepseek-chat')).toBe('deepseek');
    });

    it('infers xai, cerebras and perplexity from prefixes', () => {
        expect(inferProviderFromModel('xai:grok-4')).toBe('xai');
        expect(inferProviderFromModel('cerebras:llama3.1-8b')).toBe('cerebras');
        expect(inferProviderFromModel('perplexity:sonar-pro')).toBe('perplexity');
    });

    it('infers the custom OpenAI-compatible provider from its prefixes', () => {
        expect(inferProviderFromModel('custom:my-local-model')).toBe('custom');
        expect(inferProviderFromModel('compat:my-local-model')).toBe('custom');
        expect(inferProviderFromModel('openai-compatible:my-local-model')).toBe('custom');
        expect(hasStrongProviderSignal('custom:my-local-model')).toBe(true);
    });
});

describe('ModelRegistry provider coverage', () => {
    it('persists the newly supported providers', () => {
        for (const provider of ['groq', 'mistral', 'deepseek', 'xai', 'perplexity', 'cerebras', 'custom']) {
            expect(PERSISTABLE_PROVIDERS.has(provider)).toBe(true);
        }
    });

    it('does not claim to persist providers still outside the schema enum', () => {
        expect(PERSISTABLE_PROVIDERS.has('minimax')).toBe(false);
    });

    it('aliases openai-compatible onto custom', () => {
        expect(normalizeProviderId('openai-compatible')).toBe('custom');
    });
});

describe('MultiLLM custom provider', () => {
    it('normalizes custom model prefixes', () => {
        const llm = new MultiLLM({ modelName: 'custom:foo', customBaseUrl: 'http://localhost:8000/v1' });
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeCustomModel('custom:foo')).toBe('foo');
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeCustomModel('compat:bar')).toBe('bar');
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeCustomModel('openai-compatible:baz')).toBe('baz');
    });

    it('treats a configured base URL as reachable and resolves the custom model', () => {
        const llm = new MultiLLM({
            modelName: 'gpt-4o',
            customBaseUrl: 'http://localhost:8000/v1',
            customModelName: 'my-model',
        });
        // @ts-ignore - accessing private method for testing
        expect(llm.hasKeyForProvider('custom')).toBe(true);
        // @ts-ignore - accessing private method for testing
        expect(llm.getDefaultModelForProvider('custom')).toBe('my-model');
        // @ts-ignore - accessing private method for testing
        expect(llm.inferProvider('custom:my-model')).toBe('custom');
    });

    it('reports the custom provider as unconfigured without a base URL', () => {
        const originalBase = process.env.CUSTOM_BASE_URL;
        const originalKey = process.env.CUSTOM_API_KEY;
        delete process.env.CUSTOM_BASE_URL;
        delete process.env.CUSTOM_API_KEY;
        try {
            const llm = new MultiLLM({ modelName: 'custom:foo' });
            // @ts-ignore - accessing private method for testing
            expect(llm.hasKeyForProvider('custom')).toBe(false);
        } finally {
            if (originalBase !== undefined) process.env.CUSTOM_BASE_URL = originalBase;
            if (originalKey !== undefined) process.env.CUSTOM_API_KEY = originalKey;
        }
    });
});
