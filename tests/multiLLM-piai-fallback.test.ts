import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../src/core/PiAIAdapter', async () => ({
    piAiCall: vi.fn(),
    piAiCallWithTools: vi.fn(),
    getPiProviders: vi.fn(async () => []),
    getPiModels: vi.fn(async () => []),
    piAiLogin: vi.fn(async () => {}),
    isPiAiLinked: vi.fn((providerKey: string) => providerKey === 'openai-codex'),
}));

import { MultiLLM } from '../src/core/MultiLLM';
import { logger } from '../src/utils/logger';
import { piAiCall } from '../src/core/PiAIAdapter';

describe('MultiLLM pi-ai fallback handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports the pi-ai failure instead of a missing OpenAI key when OAuth-backed auth is in use', async () => {
        vi.mocked(piAiCall).mockRejectedValue(new Error('oauth token refresh failed'));

        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const llm = new MultiLLM({
            modelName: 'gpt-5.1',
            usePiAI: true,
            googleApiKey: 'google-test-key',
        });

        const callGoogleSpy = vi.fn().mockResolvedValue('fallback ok');
        const callOpenAISpy = vi.fn().mockRejectedValue(new Error('legacy OpenAI path should not be used'));

        (llm as any).callGoogle = callGoogleSpy;
        (llm as any).callOpenAI = callOpenAISpy;

        const result = await llm.call('hello');
        expect(result).toBe('fallback ok');
        expect(callOpenAISpy).not.toHaveBeenCalled();

        const warningMessages = warnSpy.mock.calls.map(([message]) => String(message));
        expect(warningMessages.some(message => message.includes('pi-ai call failed for openai/gpt-5.1'))).toBe(true);
        expect(warningMessages.some(message => message.includes('Primary provider (openai) via pi-ai failed: oauth token refresh failed'))).toBe(true);
        expect(warningMessages.some(message => message.includes('API key not configured'))).toBe(false);
    }, 15000);

    it('uses the selected model as the implicit fast model for openai-codex auth', async () => {
        const llm = new MultiLLM({
            modelName: 'gpt-5.1',
            usePiAI: true,
        });

        const callSpy = vi.spyOn(llm, 'call').mockResolvedValue('ok');

        const result = await llm.callFast('hello');

        expect(result).toBe('ok');
        expect(callSpy).toHaveBeenCalledWith('hello', undefined, 'openai', 'gpt-5.1');
    });

    it('falls back to the selected model when an explicit fast model fails', async () => {
        const llm = new MultiLLM({
            modelName: 'gpt-5.1',
            usePiAI: true,
            googleApiKey: 'google-test-key',
        });

        llm.setFastModel('gpt-4o-mini');

        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const callSpy = vi.spyOn(llm, 'call')
            .mockRejectedValueOnce(new Error('Unknown model gpt-4o-mini'))
            .mockResolvedValueOnce('selected model ok');

        const result = await llm.callFast('hello');

        expect(result).toBe('selected model ok');
        expect(callSpy).toHaveBeenNthCalledWith(1, 'hello', undefined, 'openai', 'gpt-4o-mini');
        expect(callSpy).toHaveBeenNthCalledWith(2, 'hello', undefined, 'openai', 'gpt-5.1');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Explicit fast model gpt-4o-mini failed'));
    });
});