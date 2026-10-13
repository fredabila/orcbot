import { describe, it, expect } from 'vitest';
import {
    hasConfiguredProvider,
    getConfiguredProviders,
    ALL_PROVIDERS,
} from '../src/config/providerCredentials';

/** Minimal ConfigManager shim. */
function makeConfig(store: Record<string, any>) {
    return { get: (key: string) => store[key] };
}

describe('providerCredentials', () => {
    it('recognizes the newer keyed providers', () => {
        const config = makeConfig({
            deepseekApiKey: 'sk-deepseek',
            groqApiKey: 'gsk_x',
            xaiApiKey: 'xai-x',
            perplexityApiKey: 'pplx-x',
            cerebrasApiKey: 'csk-x',
        });
        for (const provider of ['deepseek', 'groq', 'xai', 'perplexity', 'cerebras']) {
            expect(hasConfiguredProvider(config, provider)).toBe(true);
        }
    });

    it('treats a custom base URL as the required custom-provider setting', () => {
        expect(hasConfiguredProvider(makeConfig({ customBaseUrl: 'https://api.deepseek.com' }), 'custom')).toBe(true);
        // A key alone is not enough: the endpoint is unknown without a base URL.
        expect(hasConfiguredProvider(makeConfig({ customApiKey: 'sk-x' }), 'custom')).toBe(false);
        expect(hasConfiguredProvider(makeConfig({}), 'custom')).toBe(false);
    });

    it('keeps the special-case providers working', () => {
        expect(hasConfiguredProvider(makeConfig({ bedrockAccessKeyId: 'AKIA' }), 'bedrock')).toBe(true);
        expect(hasConfiguredProvider(makeConfig({ ollamaEnabled: true }), 'ollama')).toBe(true);
        expect(hasConfiguredProvider(makeConfig({ ollamaApiUrl: 'http://localhost:11434' }), 'ollama')).toBe(true);
    });

    it('lists every configured provider, including custom', () => {
        const config = makeConfig({ openaiApiKey: 'sk-openai', customBaseUrl: 'https://api.deepseek.com' });
        const providers = getConfiguredProviders(config);
        expect(providers).toContain('openai');
        expect(providers).toContain('custom');
    });

    it('exposes every provider the activity surfaces should check', () => {
        for (const provider of ['openai', 'google', 'anthropic', 'openrouter', 'nvidia', 'groq', 'mistral', 'deepseek', 'xai', 'perplexity', 'cerebras', 'custom', 'bedrock', 'ollama']) {
            expect(ALL_PROVIDERS).toContain(provider);
        }
    });
});
