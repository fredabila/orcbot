/**
 * Provider inference from a model id.
 *
 * This logic lived as a method pair on `MultiLLM`. It is extracted here because the model
 * switcher has to predict exactly the provider MultiLLM will choose at call time: if the two
 * implementations drift, the picker shows one provider while the agent quietly dials another.
 *
 * `MultiLLM.inferProvider` and `MultiLLM.hasStrongProviderSignal` now delegate to these.
 */

export type InferredProvider =
    | 'openai' | 'google' | 'bedrock' | 'openrouter' | 'nvidia' | 'anthropic' | 'ollama'
    | 'groq' | 'mistral' | 'deepseek' | 'xai' | 'perplexity' | 'cerebras' | 'custom';

/**
 * Best-effort provider for a model id, matching prefixes first and then well-known name
 * fragments. Falls back to `openai`, which is also MultiLLM's historical default.
 */
export function inferProviderFromModel(modelName: string): InferredProvider {
    const lower = (modelName || '').toLowerCase();
    if (lower.startsWith('ollama:') || lower.startsWith('local:') || lower.startsWith('ol:')) return 'ollama';
    if (lower.startsWith('custom:') || lower.startsWith('compat:') || lower.startsWith('openai-compatible:')) return 'custom';
    if (lower.includes('bedrock') || lower.startsWith('br:')) return 'bedrock';
    if (lower.includes('claude') || lower.startsWith('anthropic:') || lower.startsWith('ant:')) return 'anthropic';
    if (lower.startsWith('openrouter:') || lower.startsWith('openrouter/') || lower.startsWith('or:')) return 'openrouter';
    if (lower.startsWith('nvidia:') || lower.startsWith('nv:')) return 'nvidia';
    if (lower.startsWith('mistral:') || lower.startsWith('mi:')) return 'mistral';
    if (lower.startsWith('groq:') || lower.startsWith('gr:')) return 'groq';
    if (lower.startsWith('deepseek:') || lower.startsWith('ds:')) return 'deepseek';
    if (lower.startsWith('xai:') || lower.startsWith('xi:')) return 'xai';
    if (lower.startsWith('perplexity:') || lower.startsWith('pp:')) return 'perplexity';
    if (lower.startsWith('cerebras:') || lower.startsWith('cb:')) return 'cerebras';
    if (lower.includes('gemini')) return 'google';
    if (lower.includes('gpt-') || lower.includes('o1-')) return 'openai';
    if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('llama')) return 'groq';
    return 'openai';
}

/**
 * True when the model id names its provider unambiguously enough to override an explicitly
 * configured `llmProvider`. Used by MultiLLM to resolve provider/model mismatches.
 */
export function hasStrongProviderSignal(modelName: string): boolean {
    const lower = (modelName || '').toLowerCase();
    return lower.startsWith('ollama:') ||
        lower.startsWith('local:') ||
        lower.startsWith('ol:') ||
        lower.startsWith('custom:') ||
        lower.startsWith('compat:') ||
        lower.startsWith('openai-compatible:') ||
        lower.includes('bedrock') ||
        lower.startsWith('br:') ||
        lower.includes('claude') ||
        lower.startsWith('anthropic:') ||
        lower.startsWith('ant:') ||
        lower.startsWith('openrouter:') ||
        lower.startsWith('openrouter/') ||
        lower.startsWith('or:') ||
        lower.startsWith('nvidia:') ||
        lower.startsWith('nv:') ||
        lower.startsWith('mistral:') ||
        lower.startsWith('mi:') ||
        lower.startsWith('groq:') ||
        lower.startsWith('gr:') ||
        lower.startsWith('deepseek:') ||
        lower.startsWith('ds:') ||
        lower.startsWith('xai:') ||
        lower.startsWith('xi:') ||
        lower.startsWith('perplexity:') ||
        lower.startsWith('pp:') ||
        lower.startsWith('cerebras:') ||
        lower.startsWith('cb:') ||
        lower.includes('gemini') ||
        lower.includes('gpt-') ||
        lower.includes('o1-');
}
