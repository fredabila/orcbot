import { describe, it, expect, beforeEach } from 'vitest';
import {
    listConfiguredModels,
    findModelEntry,
    switchToModel,
    saveCurrentModel,
    removeSavedModel,
    readSavedModels,
    normalizeProviderId,
    type ModelConfigAccess,
} from '../src/config/ModelRegistry';

/** In-memory stand-in for ConfigManager, including the atomic setMany contract. */
function makeConfig(initial: Record<string, any> = {}): ModelConfigAccess & {
    store: Record<string, any>;
    writes: string[][];
} {
    const store: Record<string, any> = { ...initial };
    const writes: string[][] = [];
    return {
        store,
        writes,
        get: (key: string) => store[key],
        set: (key: string, value: any) => {
            store[key] = value;
            writes.push([key]);
        },
        setMany: (updates: Record<string, any>) => {
            for (const [key, value] of Object.entries(updates)) store[key] = value;
            writes.push(Object.keys(updates));
        },
    };
}

describe('ModelRegistry', () => {
    describe('normalizeProviderId', () => {
        it('lowercases and de-aliases pi-ai provider ids', () => {
            expect(normalizeProviderId('Amazon-Bedrock')).toBe('bedrock');
            expect(normalizeProviderId('google-gemini-cli')).toBe('google');
            expect(normalizeProviderId('openai-codex')).toBe('openai');
            expect(normalizeProviderId('OpenAI')).toBe('openai');
        });

        it('returns undefined for blank or non-string input', () => {
            expect(normalizeProviderId('')).toBeUndefined();
            expect(normalizeProviderId('   ')).toBeUndefined();
            expect(normalizeProviderId(undefined)).toBeUndefined();
            expect(normalizeProviderId(42)).toBeUndefined();
        });
    });

    describe('listConfiguredModels', () => {
        let config: ReturnType<typeof makeConfig>;

        beforeEach(() => {
            config = makeConfig({
                modelName: 'gpt-6.1-sol',
                llmProvider: 'openai',
                openaiApiKey: 'sk-test',
                anthropicApiKey: 'sk-ant-test',
                savedModels: [
                    { model: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Coding' },
                    { model: 'claude-haiku-5-5', provider: 'anthropic', label: 'Cheap' },
                ],
                providerModelNames: { openai: 'gpt-6.1-sol', google: 'gemini-3.8-flash' },
                fallbackModelNames: { openrouter: 'google/gemma-4-31b-it:free' },
            });
        });

        it('puts the active model first and flags it', () => {
            const entries = listConfiguredModels(config);

            expect(entries[0].model).toBe('gpt-6.1-sol');
            expect(entries[0].isActive).toBe(true);
            expect(entries.filter(e => e.isActive)).toHaveLength(1);
        });

        it('keeps several models for the same provider from the curated list', () => {
            const entries = listConfiguredModels(config);
            const anthropic = entries.filter(e => e.effectiveProvider === 'anthropic');

            expect(anthropic.map(e => e.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
            expect(anthropic.map(e => e.label)).toEqual(['Coding', 'Cheap']);
        });

        it('merges all four sources', () => {
            const entries = listConfiguredModels(config);

            expect(entries.map(e => e.model)).toEqual([
                'gpt-6.1-sol',
                'claude-sonnet-5-5',
                'claude-haiku-5-5',
                'gemini-3.8-flash',
                'google/gemma-4-31b-it:free',
            ]);
        });

        it('collapses duplicates onto one row that records every source', () => {
            const entries = listConfiguredModels(config);
            const active = entries.find(e => e.model === 'gpt-6.1-sol')!;

            // Present as the active model and in providerModelNames.
            expect(active.sources).toContain('active');
            expect(active.sources).toContain('provider-memory');
            expect(entries.filter(e => e.model === 'gpt-6.1-sol')).toHaveLength(1);
        });

        it('treats an explicit provider equal to the inferred one as the same target', () => {
            const cfg = makeConfig({
                modelName: 'gpt-6.1-sol',
                llmProvider: 'openai',
                savedModels: [{ model: 'gpt-6.1-sol' }],
            });

            expect(listConfiguredModels(cfg)).toHaveLength(1);
        });

        it('infers the provider when none is configured', () => {
            const cfg = makeConfig({ modelName: 'claude-sonnet-5-5' });
            const [entry] = listConfiguredModels(cfg);

            expect(entry.provider).toBeUndefined();
            expect(entry.effectiveProvider).toBe('anthropic');
        });

        it('reports missing credentials per provider', () => {
            const entries = listConfiguredModels(config);

            expect(entries.find(e => e.model === 'gpt-6.1-sol')!.hasCredentials).toBe(true);
            expect(entries.find(e => e.model === 'claude-sonnet-5-5')!.hasCredentials).toBe(true);
            expect(entries.find(e => e.model === 'gemini-3.8-flash')!.hasCredentials).toBe(false);
        });

        it('accepts an OAuth link in place of an API key', () => {
            const cfg = makeConfig({ modelName: 'claude-sonnet-5-5', llmProvider: 'anthropic' });

            expect(listConfiguredModels(cfg)[0].hasCredentials).toBe(false);
            expect(listConfiguredModels(cfg, { isLinked: id => id === 'anthropic' })[0].hasCredentials).toBe(true);
        });

        it('treats ollama as always reachable', () => {
            const cfg = makeConfig({ modelName: 'ollama:qwen3.8', llmProvider: 'ollama' });

            expect(listConfiguredModels(cfg)[0].hasCredentials).toBe(true);
        });

        it('ignores malformed saved entries and map values', () => {
            const cfg = makeConfig({
                modelName: 'gpt-6.1-sol',
                savedModels: [null, 'nope', { provider: 'openai' }, { model: '  ' }, { model: 'gpt-6-luna' }],
                providerModelNames: { google: '', anthropic: 123 },
            });

            expect(listConfiguredModels(cfg).map(e => e.model)).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
        });

        it('falls back to the default model id when none is configured', () => {
            const entries = listConfiguredModels(makeConfig({}));

            expect(entries).toHaveLength(1);
            expect(entries[0].model).toBe('gpt-6.1-sol');
        });
    });

    describe('findModelEntry', () => {
        const entries = listConfiguredModels(makeConfig({
            modelName: 'gpt-6.1-sol',
            llmProvider: 'openai',
            savedModels: [
                { model: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Coding' },
                { model: 'claude-haiku-5-5', provider: 'anthropic', label: 'Cheap' },
            ],
        }));

        it('resolves a 1-based list index', () => {
            expect(findModelEntry(entries, '2').entry?.model).toBe('claude-sonnet-5-5');
        });

        it('resolves an exact model id regardless of case', () => {
            expect(findModelEntry(entries, 'CLAUDE-HAIKU-5-5').entry?.model).toBe('claude-haiku-5-5');
        });

        it('resolves an exact label', () => {
            expect(findModelEntry(entries, 'coding').entry?.model).toBe('claude-sonnet-5-5');
        });

        it('resolves a unique substring', () => {
            expect(findModelEntry(entries, 'haiku').entry?.model).toBe('claude-haiku-5-5');
        });

        it('reports ambiguity instead of guessing', () => {
            const match = findModelEntry(entries, 'claude');

            expect(match.entry).toBeUndefined();
            expect(match.ambiguous?.map(e => e.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
        });

        it('returns an empty match for unknown and blank queries', () => {
            expect(findModelEntry(entries, 'mistral-large')).toEqual({});
            expect(findModelEntry(entries, '  ')).toEqual({});
            expect(findModelEntry(entries, '99')).toEqual({});
        });
    });

    describe('switchToModel', () => {
        it('writes model and provider in a single transaction', () => {
            const config = makeConfig({ modelName: 'gpt-6.1-sol', llmProvider: 'openai' });

            switchToModel(config, { model: 'claude-sonnet-5-5', provider: 'anthropic' });

            expect(config.store.modelName).toBe('claude-sonnet-5-5');
            expect(config.store.llmProvider).toBe('anthropic');
            expect(config.writes).toHaveLength(1);
            expect(config.writes[0].sort()).toEqual(['llmProvider', 'modelName']);
        });

        it('clears llmProvider for providers the config schema rejects', () => {
            const config = makeConfig({ modelName: 'gpt-6.1-sol', llmProvider: 'openai' });

            const applied = switchToModel(config, { model: 'minimax:minimax-m2', provider: 'minimax' });

            // Persisting `minimax` would make the next config load throw on the Zod enum.
            expect(config.store.llmProvider).toBeUndefined();
            expect(applied.provider).toBeUndefined();
            expect(config.store.modelName).toBe('minimax:minimax-m2');
        });

        it('de-aliases a pi-ai provider id before persisting it', () => {
            const config = makeConfig({});

            switchToModel(config, { model: 'bedrock:anthropic.claude-haiku-5-5', provider: 'amazon-bedrock' });

            expect(config.store.llmProvider).toBe('bedrock');
        });

        it('leaves the provider unset when the target has none', () => {
            const config = makeConfig({ llmProvider: 'openai' });

            switchToModel(config, { model: 'gemini-3.8-flash' });

            expect(config.store.llmProvider).toBeUndefined();
            expect(config.store.modelName).toBe('gemini-3.8-flash');
        });

        it('applies provider before model when setMany is unavailable', () => {
            const store: Record<string, any> = {
                modelName: 'gpt-6.1-sol',
                providerModelNames: { anthropic: 'claude-haiku-5-5' },
            };
            const order: string[] = [];
            const shim: ModelConfigAccess = {
                get: (key: string) => store[key],
                set: (key: string, value: any) => {
                    order.push(key);
                    store[key] = value;
                    // Mirror ConfigManager's coupling: setting the provider rewrites the model.
                    if (key === 'llmProvider' && store.providerModelNames?.[value]) {
                        store.modelName = store.providerModelNames[value];
                    }
                },
            };

            switchToModel(shim, { model: 'claude-sonnet-5-5', provider: 'anthropic' });

            expect(order).toEqual(['llmProvider', 'modelName']);
            expect(store.modelName).toBe('claude-sonnet-5-5');
        });

        it('rejects an empty model id', () => {
            expect(() => switchToModel(makeConfig({}), { model: '   ' })).toThrow(/empty model id/i);
        });
    });

    describe('saveCurrentModel', () => {
        it('appends the active model with its provider and label', () => {
            const config = makeConfig({ modelName: 'claude-sonnet-5-5', llmProvider: 'anthropic' });

            const saved = saveCurrentModel(config, 'Coding');

            expect(saved).toEqual({ model: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Coding' });
            expect(readSavedModels(config)).toHaveLength(1);
        });

        it('omits a blank label', () => {
            const config = makeConfig({ modelName: 'gpt-6.1-sol', llmProvider: 'openai' });

            expect(saveCurrentModel(config, '   ').label).toBeUndefined();
        });

        it('replaces rather than duplicates an entry for the same target', () => {
            const config = makeConfig({
                modelName: 'claude-sonnet-5-5',
                llmProvider: 'anthropic',
                savedModels: [{ model: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Old' }],
            });

            saveCurrentModel(config, 'New');

            const saved = readSavedModels(config);
            expect(saved).toHaveLength(1);
            expect(saved[0].label).toBe('New');
        });

        it('keeps entries whose provider differs', () => {
            const config = makeConfig({
                modelName: 'claude-sonnet-5-5',
                llmProvider: 'bedrock',
                savedModels: [{ model: 'claude-sonnet-5-5', provider: 'anthropic' }],
            });

            saveCurrentModel(config);

            expect(readSavedModels(config)).toHaveLength(2);
        });

        it('throws when there is no active model', () => {
            expect(() => saveCurrentModel(makeConfig({}))).toThrow(/no active model/i);
        });
    });

    describe('removeSavedModel', () => {
        let config: ReturnType<typeof makeConfig>;

        beforeEach(() => {
            config = makeConfig({
                savedModels: [
                    { model: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Coding' },
                    { model: 'gpt-6-luna', provider: 'openai' },
                ],
            });
        });

        it('removes by exact model id', () => {
            expect(removeSavedModel(config, 'gpt-6-luna')?.model).toBe('gpt-6-luna');
            expect(readSavedModels(config).map(e => e.model)).toEqual(['claude-sonnet-5-5']);
        });

        it('removes by label', () => {
            expect(removeSavedModel(config, 'Coding')?.model).toBe('claude-sonnet-5-5');
            expect(readSavedModels(config).map(e => e.model)).toEqual(['gpt-6-luna']);
        });

        it('returns null and leaves the list untouched when nothing matches', () => {
            expect(removeSavedModel(config, 'mistral-large')).toBeNull();
            expect(readSavedModels(config)).toHaveLength(2);
        });

        it('does not treat a substring as a match', () => {
            expect(removeSavedModel(config, 'claude')).toBeNull();
        });
    });
});
