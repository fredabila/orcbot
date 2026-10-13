/**
 * ModelRegistry - the set of models the user has already configured, and the logic to switch
 * between them.
 *
 * Two stores feed the switcher:
 *   - `savedModels`: an explicit, user-curated shortlist. Unbounded, and the only way to keep
 *     several models for one provider (e.g. a Sonnet for coding and a Haiku for cheap passes).
 *   - `providerModelNames` / `fallbackModelNames`: auto-remembered maps already maintained by
 *     ConfigManager. One model per provider, so they are a useful free history but cannot stand
 *     in for the curated list.
 *
 * Everything here is pure with respect to the config object it is handed, so it can be unit
 * tested against a plain in-memory shim rather than a real ConfigManager.
 */

import { DEFAULT_MODEL_IDS } from './modelDefaults';
import { inferProviderFromModel, type InferredProvider } from './providerInference';

/** Minimal slice of ConfigManager the registry needs. */
export interface ModelConfigAccess {
    get(key: string): any;
    set(key: string, value: any): void;
    /** Optional: used when present so a switch is one write and one `config:changed` event. */
    setMany?(updates: Record<string, any>): void;
}

export type ModelEntrySource = 'active' | 'saved' | 'provider-memory' | 'fallback';

export interface SavedModel {
    model: string;
    provider?: string;
    label?: string;
}

export interface ModelEntry {
    model: string;
    /** Provider as configured. `undefined` means "infer from the model id". */
    provider?: string;
    /** Provider that will actually be used, after inference. Never undefined. */
    effectiveProvider: InferredProvider;
    label?: string;
    /** Every store this entry was found in, most authoritative first. */
    sources: ModelEntrySource[];
    hasCredentials: boolean;
    isActive: boolean;
}

export interface ModelMatch {
    entry?: ModelEntry;
    /** Set when a query matched more than one entry; `entry` is then undefined. */
    ambiguous?: ModelEntry[];
}

export interface ListOptions {
    /**
     * Optional OAuth-link probe (`MultiLLM.isPiAiLinked`). Lets a provider count as usable when
     * the user authorised it interactively instead of pasting an API key.
     */
    isLinked?: (piProviderId: string) => boolean;
}

/**
 * Providers accepted by `AgentConfigSchema.llmProvider`.
 *
 * Kept in sync with the schema enum so a switch can persist `llmProvider` directly. Providers
 * outside this set are still routable via a model-id prefix, but persisting them would fail the
 * next config load, so they are left unset.
 */
export const PERSISTABLE_PROVIDERS = new Set([
    'openai', 'google', 'bedrock', 'openrouter', 'nvidia', 'anthropic', 'ollama',
    'groq', 'mistral', 'deepseek', 'xai', 'perplexity', 'cerebras', 'custom',
]);

/** pi-ai catalogue ids and other aliases mapped onto the legacy provider names. */
const PROVIDER_ALIASES: Record<string, string> = {
    'amazon-bedrock': 'bedrock',
    'google-vertex': 'google',
    'google-gemini-cli': 'google',
    'google-antigravity': 'google',
    'openai-codex': 'openai',
    'azure-openai-responses': 'openai',
    'minimax-cn': 'minimax',
    'openai-compatible': 'custom',
    local: 'ollama',
};

/** Config key that proves a provider is reachable. */
const PROVIDER_CREDENTIAL_KEYS: Record<string, string[]> = {
    openai: ['openaiApiKey'],
    google: ['googleApiKey'],
    openrouter: ['openrouterApiKey'],
    nvidia: ['nvidiaApiKey'],
    anthropic: ['anthropicApiKey'],
    bedrock: ['bedrockAccessKeyId'],
    groq: ['groqApiKey'],
    mistral: ['mistralApiKey'],
    cerebras: ['cerebrasApiKey'],
    xai: ['xaiApiKey'],
    perplexity: ['perplexityApiKey'],
    deepseek: ['deepseekApiKey'],
    huggingface: ['huggingfaceApiKey'],
    // The generic provider is reachable once its base URL is set; the key is optional
    // for endpoints that do not require auth (local vLLM, LM Studio, ...).
    custom: ['customBaseUrl'],
};

/** pi-ai provider ids whose OAuth link substitutes for an API key. */
const OAUTH_PROVIDER_IDS: Record<string, string[]> = {
    anthropic: ['anthropic'],
    openai: ['openai-codex'],
    google: ['google-gemini-cli', 'google-antigravity'],
};

/** Lowercase and de-alias a provider id. Returns undefined for blank input. */
export function normalizeProviderId(provider?: unknown): string | undefined {
    if (typeof provider !== 'string') return undefined;
    const lower = provider.trim().toLowerCase();
    if (!lower) return undefined;
    return PROVIDER_ALIASES[lower] || lower;
}

function readStringMap(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
}

/** Read and sanitise the curated shortlist, dropping malformed entries. */
export function readSavedModels(config: ModelConfigAccess): SavedModel[] {
    const raw = config.get('savedModels');
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((e: any) => e && typeof e === 'object' && typeof e.model === 'string' && e.model.trim())
        .map((e: any) => ({
            model: String(e.model).trim(),
            ...(typeof e.provider === 'string' && e.provider.trim() ? { provider: e.provider.trim() } : {}),
            ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
        }));
}

function providerHasCredentials(
    config: ModelConfigAccess,
    provider: string,
    options: ListOptions,
): boolean {
    // Ollama is a local server, so there is no key to check.
    if (provider === 'ollama') return true;

    const keys = PROVIDER_CREDENTIAL_KEYS[provider];
    if (keys?.some(key => {
        const value = config.get(key);
        return typeof value === 'string' ? value.trim().length > 0 : !!value;
    })) {
        return true;
    }

    const oauthIds = OAUTH_PROVIDER_IDS[provider];
    if (oauthIds && options.isLinked) {
        return oauthIds.some(id => {
            try {
                return options.isLinked!(id);
            } catch {
                return false;
            }
        });
    }

    // Unknown provider: do not claim it is broken, since MultiLLM may read a bare env var.
    return !keys;
}

/**
 * Build the switch list: active model first, then the curated shortlist in user order, then the
 * auto-remembered per-provider and fallback maps.
 *
 * Entries are deduplicated on effective provider + model id, so a curated entry and an
 * auto-remembered one for the same target collapse into a single row carrying both sources.
 */
export function listConfiguredModels(
    config: ModelConfigAccess,
    options: ListOptions = {},
): ModelEntry[] {
    const activeModel = String(config.get('modelName') || DEFAULT_MODEL_IDS.openaiMain).trim();
    const activeProvider = normalizeProviderId(config.get('llmProvider'));
    const activeEffective = activeProvider || inferProviderFromModel(activeModel);

    const candidates: Array<{
        model: string;
        provider?: string;
        label?: string;
        source: ModelEntrySource;
    }> = [];

    if (activeModel) {
        candidates.push({ model: activeModel, provider: activeProvider, source: 'active' });
    }

    for (const entry of readSavedModels(config)) {
        candidates.push({
            model: entry.model,
            provider: normalizeProviderId(entry.provider),
            label: entry.label,
            source: 'saved',
        });
    }

    for (const [provider, model] of Object.entries(readStringMap(config.get('providerModelNames')))) {
        candidates.push({ model, provider: normalizeProviderId(provider), source: 'provider-memory' });
    }

    for (const [provider, model] of Object.entries(readStringMap(config.get('fallbackModelNames')))) {
        candidates.push({ model, provider: normalizeProviderId(provider), source: 'fallback' });
    }

    const byKey = new Map<string, ModelEntry>();
    for (const candidate of candidates) {
        if (!candidate.model) continue;

        const effectiveProvider = (candidate.provider as InferredProvider)
            || inferProviderFromModel(candidate.model);
        const key = `${effectiveProvider}::${candidate.model.toLowerCase()}`;

        const existing = byKey.get(key);
        if (existing) {
            if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
            if (!existing.label && candidate.label) existing.label = candidate.label;
            continue;
        }

        byKey.set(key, {
            model: candidate.model,
            provider: candidate.provider,
            effectiveProvider,
            label: candidate.label,
            sources: [candidate.source],
            hasCredentials: providerHasCredentials(config, effectiveProvider, options),
            isActive: candidate.model.toLowerCase() === activeModel.toLowerCase()
                && effectiveProvider === activeEffective,
        });
    }

    return [...byKey.values()];
}

/**
 * Resolve a user-supplied query against the switch list.
 *
 * Tried in order: 1-based list index, exact model id, exact label, then unique substring on
 * model id or label. A substring hitting several entries returns them as `ambiguous` rather
 * than silently picking one.
 */
export function findModelEntry(entries: ModelEntry[], query: string): ModelMatch {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return {};

    if (/^\d+$/.test(needle)) {
        const index = Number(needle) - 1;
        if (index >= 0 && index < entries.length) return { entry: entries[index] };
    }

    const exactModel = entries.filter(e => e.model.toLowerCase() === needle);
    if (exactModel.length === 1) return { entry: exactModel[0] };
    if (exactModel.length > 1) return { ambiguous: exactModel };

    const exactLabel = entries.filter(e => (e.label || '').toLowerCase() === needle);
    if (exactLabel.length === 1) return { entry: exactLabel[0] };
    if (exactLabel.length > 1) return { ambiguous: exactLabel };

    const partial = entries.filter(e =>
        e.model.toLowerCase().includes(needle) || (e.label || '').toLowerCase().includes(needle));
    if (partial.length === 1) return { entry: partial[0] };
    if (partial.length > 1) return { ambiguous: partial };

    return {};
}

/**
 * Point the agent at a configured model.
 *
 * Writes `modelName` and `llmProvider` together through `setMany` so the agent never observes
 * the new provider paired with the old model. When the target provider is outside the config
 * schema's enum, `llmProvider` is cleared instead of being set to an unloadable value.
 */
export function switchToModel(
    config: ModelConfigAccess,
    target: { model: string; provider?: string },
): { model: string; provider?: string } {
    const model = String(target.model || '').trim();
    if (!model) throw new Error('Cannot switch to an empty model id');

    const provider = normalizeProviderId(target.provider);
    const persistable = provider && PERSISTABLE_PROVIDERS.has(provider) ? provider : undefined;

    const updates: Record<string, any> = {
        llmProvider: persistable,
        modelName: model,
    };

    if (typeof config.setMany === 'function') {
        config.setMany(updates);
    } else {
        // Provider first: its coupling rewrites modelName, so the explicit model must land after.
        config.set('llmProvider', persistable);
        config.set('modelName', model);
    }

    return { model, provider: persistable };
}

/** Add the active model to the curated shortlist, replacing any entry for the same target. */
export function saveCurrentModel(config: ModelConfigAccess, label?: string): SavedModel {
    const model = String(config.get('modelName') || '').trim();
    if (!model) throw new Error('There is no active model to save');

    const provider = normalizeProviderId(config.get('llmProvider'));
    const entry: SavedModel = {
        model,
        ...(provider ? { provider } : {}),
        ...(label?.trim() ? { label: label.trim() } : {}),
    };

    const saved = readSavedModels(config);
    const effective = provider || inferProviderFromModel(model);
    const existingIndex = saved.findIndex(e =>
        e.model.toLowerCase() === model.toLowerCase()
        && (normalizeProviderId(e.provider) || inferProviderFromModel(e.model)) === effective);

    const next = [...saved];
    if (existingIndex >= 0) next[existingIndex] = entry;
    else next.push(entry);

    config.set('savedModels', next);
    return entry;
}

/** Remove a curated entry by exact model id or label. Returns null when nothing matched. */
export function removeSavedModel(config: ModelConfigAccess, query: string): SavedModel | null {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return null;

    const saved = readSavedModels(config);
    const index = saved.findIndex(e =>
        e.model.toLowerCase() === needle || (e.label || '').toLowerCase() === needle);
    if (index < 0) return null;

    const [removed] = saved.splice(index, 1);
    config.set('savedModels', saved);
    return removed;
}
