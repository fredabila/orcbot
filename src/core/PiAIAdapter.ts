/**
 * PiAIAdapter — wraps @mariozechner/pi-ai to provide the same interface as
 * MultiLLM's call() and callWithTools() methods.
 *
 * Activated when `usePiAI: true` is set in orcbot.config.yaml.
 * Falls back to the legacy MultiLLM code if pi-ai is unavailable or misconfigured.
 *
 * Benefits over the hand-rolled provider code:
 *  - Supports 15+ providers out of the box (including Groq, Mistral, xAI, Vercel, etc.)
 *  - Cross-provider handoffs with automatic thinking-block serialization
 *  - Built-in token + cost tracking per call
 *  - Abort signal support
 */

import { logger } from '../utils/logger';
import type { LLMToolDefinition, LLMToolResponse } from './MultiLLM';

// ── Dynamic import guards ──
// pi-ai is an optional peer — we catch import errors so OrcBot degrades
// gracefully when the package is missing or the env doesn't support it.
let piAiLoaded = false;
let getModel: any = null;
let complete: any = null;

async function ensurePiAi(): Promise<boolean> {
    if (piAiLoaded) return true;
    try {
        const mod = await import('@mariozechner/pi-ai');
        getModel = mod.getModel;
        complete = mod.complete;
        piAiLoaded = true;
        return true;
    } catch (e) {
        logger.warn(`PiAIAdapter: @mariozechner/pi-ai not available — ${(e as Error).message}`);
        return false;
    }
}

/** Maps OrcBot's provider names to pi-ai provider names */
function toPiProvider(provider: string, model: string): string {
    // 'auto' or empty string — fall straight through to model-name inference below
    if (provider && provider !== 'auto') {
        if (provider === 'openai') return 'openai';
        if (provider === 'google') return 'google';
        if (provider === 'anthropic') return 'anthropic';
        if (provider === 'openrouter') return 'openrouter';
        if (provider === 'bedrock') return 'amazon-bedrock';
        if (provider === 'nvidia') return 'openrouter';
        if (provider === 'groq') return 'groq';
        if (provider === 'mistral') return 'mistral';
        if (provider === 'cerebras') return 'cerebras';
        if (provider === 'xai') return 'xai';
    }
    // Infer from model name
    if (model.startsWith('gemini')) return 'google';
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('nvidia:') || model.startsWith('meta/') || model.startsWith('nvidia/')) return 'openrouter';
    if (model.startsWith('bedrock:')) return 'amazon-bedrock';
    if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma')) return 'groq';
    if (model.startsWith('mistral') || model.startsWith('codestral') || model.startsWith('open-mistral')) return 'mistral';
    if (model.startsWith('grok')) return 'xai';
    return 'openai';
}

/** Strips provider prefixes OrcBot uses internally (e.g. "nvidia:llama..." → "llama...") */
function normalizePiModel(model: string): string {
    return model.replace(/^nvidia:/, '').replace(/^bedrock:/, '');
}

/** Converts OrcBot LLMToolDefinition[] to pi-ai Tool[] */
function topiTools(tools: LLMToolDefinition[]): any[] {
    return tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: {
            type: 'object' as const,
            properties: Object.fromEntries(
                Object.entries(t.function.parameters.properties).map(([k, v]) => [
                    k,
                    { type: (v as any).type, description: (v as any).description }
                ])
            ),
            required: t.function.parameters.required ?? [],
        },
    }));
}

export interface PiAIAdapterOptions {
    provider: string;
    model: string;
    apiKeys: {
        openai?: string;
        google?: string;
        anthropic?: string;
        openrouter?: string;
        nvidia?: string;
        bedrockAccessKeyId?: string;
        bedrockSecretAccessKey?: string;
        bedrockRegion?: string;
        bedrockSessionToken?: string;
        groq?: string;
        mistral?: string;
        cerebras?: string;
        xai?: string;
    };
}

/**
 * Drop-in replacement for MultiLLM.call() using pi-ai.
 * Returns the text response string, matching the MultiLLM.call() signature.
 */
export async function piAiCall(
    prompt: string,
    systemMessage: string | undefined,
    opts: PiAIAdapterOptions
): Promise<string> {
    if (!(await ensurePiAi())) {
        throw new Error('PiAIAdapter: @mariozechner/pi-ai not available');
    }

    const piProvider = toPiProvider(opts.provider, opts.model);
    const piModel = normalizePiModel(opts.model);
    const apiKey = resolveApiKey(piProvider, opts.apiKeys);

    let model: any;
    try {
        model = getModel(piProvider, piModel);
    } catch (e) {
        throw new Error(`PiAIAdapter: Unknown model "${piModel}" for provider "${piProvider}": ${(e as Error).message}`);
    }

    const messages: any[] = [];
    if (prompt) messages.push({ role: 'user', content: prompt });

    const context: any = {
        messages,
        ...(systemMessage ? { systemPrompt: systemMessage } : {}),
    };

    const callOpts: any = {};
    if (apiKey) callOpts.apiKey = apiKey;

    const response = await complete(model, context, callOpts);

    // Extract text from response content blocks
    const text = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

    logger.debug(`PiAIAdapter: call() → ${piProvider}/${piModel} — ${response.usage?.output ?? '?'} tokens out`);
    return text;
}

/**
 * Drop-in replacement for MultiLLM.callWithTools() using pi-ai.
 * Returns LLMToolResponse matching the MultiLLM.callWithTools() signature.
 */
export async function piAiCallWithTools(
    prompt: string,
    systemMessage: string,
    tools: LLMToolDefinition[],
    opts: PiAIAdapterOptions
): Promise<LLMToolResponse> {
    if (!(await ensurePiAi())) {
        throw new Error('PiAIAdapter: @mariozechner/pi-ai not available');
    }

    const piProvider = toPiProvider(opts.provider, opts.model);
    const piModel = normalizePiModel(opts.model);
    const apiKey = resolveApiKey(piProvider, opts.apiKeys);

    let model: any;
    try {
        model = getModel(piProvider, piModel);
    } catch (e) {
        throw new Error(`PiAIAdapter: Unknown model "${piModel}" for provider "${piProvider}": ${(e as Error).message}`);
    }

    const piTools = topiTools(tools);

    const context: any = {
        systemPrompt: systemMessage,
        messages: [{ role: 'user', content: prompt }],
        tools: piTools,
    };

    const callOpts: any = {};
    if (apiKey) callOpts.apiKey = apiKey;

    const response = await complete(model, context, callOpts);

    // Separate text blocks from tool-call blocks
    const textContent = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

    const toolCalls = response.content
        .filter((b: any) => b.type === 'toolCall')
        .map((b: any) => ({
            name: b.name,
            arguments: b.arguments ?? {},
            id: b.id,
        }));

    logger.debug(`PiAIAdapter: callWithTools() → ${piProvider}/${piModel} — ${toolCalls.length} tool calls`);

    return {
        content: textContent,
        toolCalls,
        raw: response,
    };
}

/** Resolve the right API key for a pi-ai provider name */
function resolveApiKey(piProvider: string, keys: PiAIAdapterOptions['apiKeys']): string | undefined {
    switch (piProvider) {
        case 'openai': return keys.openai;
        case 'google': return keys.google;
        case 'anthropic': return keys.anthropic;
        case 'openrouter': return keys.openrouter || keys.nvidia;
        case 'amazon-bedrock': return undefined; // Bedrock uses env-based AWS credentials
        case 'groq': return keys.groq;
        case 'mistral': return keys.mistral;
        case 'cerebras': return keys.cerebras;
        case 'xai': return keys.xai;
        default: return keys.openai;
    }
}
