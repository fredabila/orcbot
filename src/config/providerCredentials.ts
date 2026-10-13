import type { ConfigManager } from './ConfigManager';

/** Any object exposing ConfigManager's read API (lets tests pass a plain shim). */
export interface ProviderConfigLike {
    get(key: string): any;
}

/**
 * Config keys that prove a provider is usable. A non-empty value for any of them counts as
 * "configured". Keep this list aligned with `AgentConfigSchema.llmProvider` and with MultiLLM's
 * routing so status surfaces never disagree with what the agent can actually dial.
 */
export const PROVIDER_CREDENTIAL_KEYS: Record<string, string[]> = {
    openai: ['openaiApiKey'],
    google: ['googleApiKey'],
    anthropic: ['anthropicApiKey'],
    openrouter: ['openrouterApiKey'],
    nvidia: ['nvidiaApiKey'],
    groq: ['groqApiKey'],
    mistral: ['mistralApiKey'],
    deepseek: ['deepseekApiKey'],
    xai: ['xaiApiKey'],
    perplexity: ['perplexityApiKey'],
    cerebras: ['cerebrasApiKey'],
    huggingface: ['huggingfaceApiKey'],
    kimi: ['kimiApiKey'],
    minimax: ['minimaxApiKey'],
    zai: ['zaiApiKey'],
    opencode: ['opencodeApiKey'],
    // Generic OpenAI-compatible provider. The base URL is the required setting; the key is
    // optional for unauthenticated local endpoints, so either one counts as configured.
    custom: ['customBaseUrl', 'customApiKey'],
};

/** Every provider id that has a first-class credential mapping (excludes bedrock/ollama). */
export const KEYED_PROVIDERS: string[] = Object.keys(PROVIDER_CREDENTIAL_KEYS);

/** Providers that need bespoke readiness checks rather than a simple API-key lookup. */
export const SPECIAL_PROVIDERS = ['bedrock', 'ollama'] as const;

/** All provider ids a status surface should consider, keyed + special. */
export const ALL_PROVIDERS: string[] = [...KEYED_PROVIDERS, ...SPECIAL_PROVIDERS];

function isPresent(value: unknown): boolean {
    return typeof value === 'string' ? value.trim().length > 0 : !!value;
}

/** True when the config carries the credentials/settings to reach `provider`. */
export function hasConfiguredProvider(config: ProviderConfigLike, provider: string): boolean {
    const id = String(provider || '').trim().toLowerCase();

    if (id === 'bedrock') {
        return isPresent(config.get('bedrockAccessKeyId'));
    }
    if (id === 'ollama') {
        return config.get('ollamaEnabled') === true || isPresent(config.get('ollamaApiUrl'));
    }
    if (id === 'custom') {
        // A base URL is mandatory; an API key alone is not enough to dial the endpoint.
        return isPresent(config.get('customBaseUrl'));
    }

    const keys = PROVIDER_CREDENTIAL_KEYS[id];
    if (!keys) return false;
    return keys.some(key => isPresent(config.get(key)));
}

/** Every provider id that is currently reachable from the config. */
export function getConfiguredProviders(config: ProviderConfigLike): string[] {
    return ALL_PROVIDERS.filter(provider => hasConfiguredProvider(config, provider));
}

/** Narrow helper for call sites that hold a real ConfigManager. */
export type ProviderConfig = ConfigManager;
