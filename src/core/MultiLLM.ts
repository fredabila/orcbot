import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import fs from 'fs';
import path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TokenTracker } from './TokenTracker';
import { piAiCall, piAiCallWithTools, type PiAIAdapterOptions } from './PiAIAdapter';

export type LLMProvider = 'openai' | 'google' | 'bedrock' | 'openrouter' | 'nvidia' | 'anthropic';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** JSON Schema-based tool definition (OpenAI function calling format) */
export interface LLMToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, { type: string; description?: string }>;
            required?: string[];
        };
    };
}

/** Structured tool call returned by native tool calling APIs */
export interface LLMToolCall {
    name: string;
    arguments: Record<string, any>;
    id?: string;  // tool_call_id from the API
}

/** Combined response from callWithTools: text content + structured tool calls */
export interface LLMToolResponse {
    content: string;         // Text/reasoning from the model (may be empty if only tool calls)
    toolCalls: LLMToolCall[];
    raw?: any;               // Raw API response for debugging
}

export class MultiLLM {
    private openaiKey: string | undefined;
    private openrouterKey: string | undefined;
    private openrouterBaseUrl: string;
    private openrouterReferer?: string;
    private openrouterAppName?: string;
    private googleKey: string | undefined;
    private nvidiaKey: string | undefined;
    private anthropicKey: string | undefined;
    private modelName: string;
    private bedrockRegion?: string;
    private bedrockAccessKeyId?: string;
    private bedrockSecretAccessKey?: string;
    private bedrockSessionToken?: string;
    private groqKey?: string;
    private mistralKey?: string;
    private cerebrasKey?: string;
    private xaiKey?: string;
    private tokenTracker?: TokenTracker;
    private preferredProvider?: LLMProvider;
    /** When true, route call() and callWithTools() through @mariozechner/pi-ai */
    private usePiAI: boolean = false;

    constructor(config?: { apiKey?: string, googleApiKey?: string, nvidiaApiKey?: string, anthropicApiKey?: string, modelName?: string, bedrockRegion?: string, bedrockAccessKeyId?: string, bedrockSecretAccessKey?: string, bedrockSessionToken?: string, tokenTracker?: TokenTracker, openrouterApiKey?: string, openrouterBaseUrl?: string, openrouterReferer?: string, openrouterAppName?: string, llmProvider?: LLMProvider, usePiAI?: boolean, groqApiKey?: string, mistralApiKey?: string, cerebrasApiKey?: string, xaiApiKey?: string }) {
        this.openaiKey = config?.apiKey || process.env.OPENAI_API_KEY;
        this.openrouterKey = config?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
        this.openrouterBaseUrl = config?.openrouterBaseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
        this.openrouterReferer = config?.openrouterReferer || process.env.OPENROUTER_REFERER;
        this.openrouterAppName = config?.openrouterAppName || process.env.OPENROUTER_APP_NAME;
        this.googleKey = config?.googleApiKey || process.env.GOOGLE_API_KEY;
        this.nvidiaKey = config?.nvidiaApiKey || process.env.NVIDIA_API_KEY;
        this.anthropicKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
        this.modelName = config?.modelName || 'gpt-4o';
        this.bedrockRegion = config?.bedrockRegion || process.env.BEDROCK_REGION || process.env.AWS_REGION;
        this.bedrockAccessKeyId = config?.bedrockAccessKeyId || process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
        this.bedrockSecretAccessKey = config?.bedrockSecretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
        this.bedrockSessionToken = config?.bedrockSessionToken || process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;
        this.groqKey = config?.groqApiKey || process.env.GROQ_API_KEY;
        this.mistralKey = config?.mistralApiKey || process.env.MISTRAL_API_KEY;
        this.cerebrasKey = config?.cerebrasApiKey || process.env.CEREBRAS_API_KEY;
        this.xaiKey = config?.xaiApiKey || process.env.XAI_API_KEY;
        this.tokenTracker = config?.tokenTracker;
        this.preferredProvider = config?.llmProvider;
        this.usePiAI = config?.usePiAI ?? false;

        if (this.usePiAI) logger.info('MultiLLM: pi-ai backend enabled');
        logger.info(`MultiLLM: Initialized with model ${this.modelName}`);
    }

    // ── Fast model for internal reasoning (reviews, reflections, classification) ──
    // Uses a cheaper/faster model for non-user-facing LLM calls.
    // Set via config key `fastModelName` (default: gpt-4o-mini).
    private fastModelName?: string;

    /**
     * Set the fast model name used for internal reasoning tasks
     * (task classification, termination review, post-action reflection).
     * These calls don't need the full primary model's quality.
     */
    public setFastModel(modelName: string): void {
        this.fastModelName = modelName;
        logger.info(`MultiLLM: Fast model set to ${modelName}`);
    }

    /**
     * Call the LLM using the fast/cheap model for internal reasoning.
     * Resolution order:
     *   1. Explicit fastModelName from config → use it with its native provider
     *   2. If that provider has no API key → pick a fast model for the primary provider
     *   3. If no fastModelName configured → auto-select a fast model for the primary provider
     */
    public async callFast(prompt: string, systemMessage?: string): Promise<string> {
        // If user explicitly configured a fast model, try its native provider first
        if (this.fastModelName) {
            const provider = this.inferProvider(this.fastModelName);
            if (this.hasKeyForProvider(provider)) {
                return this.call(prompt, systemMessage, provider, this.fastModelName);
            }
            // Configured fast model's provider has no key — fall through
            logger.info(`MultiLLM: Fast model ${this.fastModelName} needs ${provider} key (not configured). Auto-selecting from primary provider.`);
        }

        // Auto-select a fast model for the primary provider
        const primaryProvider = this.preferredProvider || this.inferProvider(this.modelName);
        const fastModel = this.getFastModelForProvider(primaryProvider);
        return this.call(prompt, systemMessage, primaryProvider, fastModel);
    }

    /** Check whether we have a usable API key for the given provider. */
    private hasKeyForProvider(provider: LLMProvider): boolean {
        switch (provider) {
            case 'openai': return !!this.openaiKey && !this.openaiKey.startsWith('your_');
            case 'google': return !!this.googleKey && !this.googleKey.startsWith('your_');
            case 'anthropic': return !!this.anthropicKey && !this.anthropicKey.startsWith('your_');
            case 'nvidia': return !!this.nvidiaKey && !this.nvidiaKey.startsWith('your_');
            case 'openrouter': return !!this.openrouterKey && !this.openrouterKey.startsWith('your_');
            case 'bedrock': return !!this.bedrockAccessKeyId;
            default: return false;
        }
    }

    /** Return a cheap/fast model name appropriate for the given provider. */
    private getFastModelForProvider(provider: LLMProvider): string {
        switch (provider) {
            case 'openai': return 'gpt-4o-mini';
            case 'google': return 'gemini-2.0-flash-lite';
            case 'anthropic': return 'claude-3-5-haiku-latest';
            case 'nvidia': return 'meta/llama-3.3-70b-instruct';
            case 'openrouter': return 'openai/gpt-oss-120b:free';
            case 'bedrock': return this.modelName;
            default: return this.modelName;
        }
    }

    public async call(prompt: string, systemMessage?: string, provider?: LLMProvider, modelOverride?: string): Promise<string> {
        if (this.usePiAI) {
            try {
                return await piAiCall(prompt, systemMessage, this.getPiAIOptions(modelOverride, provider));
            } catch (e) {
                logger.warn(`MultiLLM: pi-ai call failed, falling back to legacy — ${(e as Error).message}`);
            }
        }
        const primaryProvider = provider || this.preferredProvider || this.inferProvider(modelOverride || this.modelName);
        
        // Build fallback chain: try all available providers
        const fallbackProvider = this.getFallbackProvider(primaryProvider);

        const executeCall = async (p: LLMProvider, m?: string) => {
            if (p === 'openai') return this.callOpenAI(prompt, systemMessage, m);
            if (p === 'google') return this.callGoogle(prompt, systemMessage, m);
            if (p === 'bedrock') return this.callBedrock(prompt, systemMessage, m);
            if (p === 'openrouter') return this.callOpenRouter(prompt, systemMessage, m);
            if (p === 'nvidia') return this.callNvidia(prompt, systemMessage, m);
            if (p === 'anthropic') return this.callAnthropic(prompt, systemMessage, m);
            throw new Error(`Provider ${p} not supported`);
        };

        const primaryModel = modelOverride || this.modelName;

        return ErrorHandler.withFallback(
            () => ErrorHandler.withRetry(() => executeCall(primaryProvider, primaryModel), { maxRetries: 2 }),
            async () => {
                if (!fallbackProvider) throw new Error(`Primary provider (${primaryProvider}) failed and no fallback available.`);

                const fallbackModel = this.getDefaultModelForProvider(fallbackProvider);
                logger.info(`MultiLLM: Falling back from ${primaryProvider} to ${fallbackProvider} (Using model: ${fallbackModel})`);

                return ErrorHandler.withRetry(() => executeCall(fallbackProvider, fallbackModel), { maxRetries: 1 });
            }
        );
    }

    /**
     * Call the LLM with native tool/function calling support.
     * Providers that support tool calling (OpenAI, Anthropic, Google, OpenRouter, NVIDIA)
     * will pass structured tool definitions to the API rather than embedding them in the prompt.
     * 
     * Returns both the text content (reasoning) and structured tool calls.
     * Falls back to regular call() + text parsing for unsupported providers.
     */
    public async callWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        provider?: LLMProvider,
        modelOverride?: string
    ): Promise<LLMToolResponse> {
        if (this.usePiAI) {
            try {
                return await piAiCallWithTools(prompt, systemMessage, tools, this.getPiAIOptions(modelOverride, provider));
            } catch (e) {
                logger.warn(`MultiLLM: pi-ai callWithTools failed, falling back to legacy — ${(e as Error).message}`);
            }
        }
        const primaryProvider = provider || this.preferredProvider || this.inferProvider(modelOverride || this.modelName);
        const model = modelOverride || this.modelName;

        // Check if provider supports native tool calling
        const supportsTools = this.supportsNativeToolCalling(primaryProvider);

        if (!supportsTools || tools.length === 0) {
            // Fallback: use regular call() — tools are already in the system prompt
            const textResponse = await this.call(prompt, systemMessage, provider, modelOverride);
            return { content: textResponse, toolCalls: [] };
        }

        const executeToolCall = async (p: LLMProvider, m: string): Promise<LLMToolResponse> => {
            switch (p) {
                case 'openai':
                case 'nvidia':  // NVIDIA uses OpenAI-compatible API
                    return this.callOpenAIWithTools(prompt, systemMessage, tools, m, p);
                case 'anthropic':
                    return this.callAnthropicWithTools(prompt, systemMessage, tools, m);
                case 'google':
                    return this.callGoogleWithTools(prompt, systemMessage, tools, m);
                case 'openrouter':
                    return this.callOpenRouterWithTools(prompt, systemMessage, tools, m);
                default:
                    // Unsupported: fall back to text-based
                    const text = await this.call(prompt, systemMessage, p, m);
                    return { content: text, toolCalls: [] };
            }
        };

        const fallbackProvider = this.getFallbackProvider(primaryProvider);

        return ErrorHandler.withFallback(
            () => ErrorHandler.withRetry(() => executeToolCall(primaryProvider, model), { maxRetries: 2 }),
            async () => {
                if (!fallbackProvider) throw new Error(`Primary provider (${primaryProvider}) failed and no fallback available.`);
                const fallbackModel = this.getDefaultModelForProvider(fallbackProvider);
                logger.info(`MultiLLM: Tool call falling back from ${primaryProvider} to ${fallbackProvider}`);
                return ErrorHandler.withRetry(() => executeToolCall(fallbackProvider, fallbackModel), { maxRetries: 1 });
            }
        );
    }

    /**
     * Whether a given provider supports native tool/function calling.
     */
    public supportsNativeToolCalling(provider?: LLMProvider): boolean {
        const p = provider || this.preferredProvider || this.inferProvider(this.modelName);
        return ['openai', 'anthropic', 'google', 'openrouter', 'nvidia'].includes(p);
    }

    // ── Native tool calling: OpenAI / NVIDIA (OpenAI-compatible) ──

    private async callOpenAIWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string,
        provider: 'openai' | 'nvidia'
    ): Promise<LLMToolResponse> {
        const apiKey = provider === 'nvidia' ? this.nvidiaKey : this.openaiKey;
        const baseUrl = provider === 'nvidia'
            ? 'https://integrate.api.nvidia.com/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

        if (!apiKey) throw new Error(`${provider} API key not configured`);

        const resolvedModel = provider === 'nvidia' ? this.normalizeNvidiaModel(model) : model;

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        const body: any = {
            model: resolvedModel,
            messages,
            temperature: 0.7,
            tools,
        };

        // NVIDIA may need max_tokens
        if (provider === 'nvidia') {
            body.max_tokens = 16384;
        }

        try {
            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    ...(provider === 'nvidia' ? { 'Accept': 'application/json' } : {}),
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`${provider} Tool Call API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            const message = data.choices?.[0]?.message;
            const textContent = message?.content || '';
            const toolCalls: LLMToolCall[] = (message?.tool_calls || []).map((tc: any) => ({
                name: tc.function?.name || '',
                arguments: this.safeParseJson(tc.function?.arguments),
                id: tc.id,
            }));

            this.recordUsage(provider, resolvedModel, prompt, data, textContent);
            logger.debug(`MultiLLM: ${provider} tool call returned ${toolCalls.length} tool(s) + ${textContent.length} chars text`);

            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM ${provider} tool call error: ${error}`);
            throw error;
        }
    }

    // ── Native tool calling: Anthropic ──

    private async callAnthropicWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        if (!this.anthropicKey) throw new Error('Anthropic API key not configured');

        const resolvedModel = this.normalizeAnthropicModel(model);

        // Convert OpenAI tool format → Anthropic tool format
        const anthropicTools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
        }));

        const body: any = {
            model: resolvedModel,
            max_tokens: 16384,
            messages: [{ role: 'user', content: prompt }],
            tools: anthropicTools,
        };
        if (systemMessage) {
            // Use structured content block with cache_control for prompt caching
            body.system = [
                {
                    type: 'text',
                    text: systemMessage,
                    cache_control: { type: 'ephemeral' }
                }
            ];
        }

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.anthropicKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-beta': 'prompt-caching-2024-07-31',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Anthropic Tool Call API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;

            // Anthropic returns mixed content blocks: text and tool_use
            let textContent = '';
            const toolCalls: LLMToolCall[] = [];

            for (const block of (data.content || [])) {
                if (block.type === 'text') {
                    textContent += block.text;
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        name: block.name,
                        arguments: block.input || {},
                        id: block.id,
                    });
                }
            }

            this.recordUsage('anthropic', resolvedModel, prompt, data, textContent);
            logger.debug(`MultiLLM: Anthropic tool call returned ${toolCalls.length} tool(s) + ${textContent.length} chars text`);

            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM Anthropic tool call error: ${error}`);
            throw error;
        }
    }

    // ── Native tool calling: Google Gemini ──

    private async callGoogleWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        const fullPrompt = systemMessage ? `System: ${systemMessage}\n\nUser: ${prompt}` : prompt;

        // Convert OpenAI tool format → Gemini function declaration format
        const geminiTools = [{
            function_declarations: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            }))
        }];

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    tools: geminiTools,
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Google Tool Call API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;

            let textContent = '';
            const toolCalls: LLMToolCall[] = [];

            // Gemini returns parts with text and/or functionCall
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text) {
                    textContent += part.text;
                }
                if (part.functionCall) {
                    toolCalls.push({
                        name: part.functionCall.name,
                        arguments: part.functionCall.args || {},
                    });
                }
            }

            this.recordUsage('google', model, fullPrompt, data, textContent);
            logger.debug(`MultiLLM: Google tool call returned ${toolCalls.length} tool(s) + ${textContent.length} chars text`);

            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM Google tool call error: ${error}`);
            throw error;
        }
    }

    // ── Native tool calling: OpenRouter (OpenAI-compatible) ──

    private async callOpenRouterWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        if (!this.openrouterKey) throw new Error('OpenRouter API key not configured');

        const resolvedModel = this.normalizeOpenRouterModel(model);
        const base = this.openrouterBaseUrl.replace(/\/+$/, '');
        const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openrouterKey}`,
        };
        if (this.openrouterReferer) headers['HTTP-Referer'] = this.openrouterReferer;
        if (this.openrouterAppName) headers['X-Title'] = this.openrouterAppName;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: resolvedModel,
                    messages,
                    temperature: 0.7,
                    tools,
                    // Tell OpenRouter to only route to providers that support tool use
                    provider: { require: ['tools'] },
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                // If no provider supports tools for this model, fall back to text-based call
                if (response.status === 404 && err.includes('tool use')) {
                    logger.warn(`MultiLLM: OpenRouter model "${resolvedModel}" has no tool-capable providers, falling back to text-based call`);
                    const textResponse = await this.callOpenRouter(prompt, systemMessage, model);
                    return { content: textResponse, toolCalls: [] };
                }
                throw new Error(`OpenRouter Tool Call API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            const message = data.choices?.[0]?.message;
            const textContent = message?.content || '';
            const toolCalls: LLMToolCall[] = (message?.tool_calls || []).map((tc: any) => ({
                name: tc.function?.name || '',
                arguments: this.safeParseJson(tc.function?.arguments),
                id: tc.id,
            }));

            this.recordUsage('openrouter', resolvedModel, prompt, data, textContent);
            logger.debug(`MultiLLM: OpenRouter tool call returned ${toolCalls.length} tool(s) + ${textContent.length} chars text`);

            return { content: textContent, toolCalls, raw: data };
        } catch (error: any) {
            // Also catch retried 404 tool-use errors gracefully
            if (error?.message?.includes('tool use') && error?.message?.includes('404')) {
                logger.warn(`MultiLLM: OpenRouter model "${resolvedModel}" tool call failed, falling back to text-based call`);
                const textResponse = await this.callOpenRouter(prompt, systemMessage, model);
                return { content: textResponse, toolCalls: [] };
            }
            logger.error(`MultiLLM OpenRouter tool call error: ${error}`);
            throw error;
        }
    }

    /**
     * Safely parse a JSON string, returning empty object on failure.
     * OpenAI tool call arguments come as a JSON string.
     */
    private safeParseJson(str: any): Record<string, any> {
        if (typeof str === 'object' && str !== null) return str;
        if (typeof str !== 'string') return {};
        try {
            return JSON.parse(str);
        } catch {
            logger.warn(`MultiLLM: Failed to parse tool arguments: "${String(str).slice(0, 100)}"`);
            return {};
        }
    }

    private getFallbackProvider(primaryProvider: LLMProvider): LLMProvider | null {
        // Priority order for fallbacks based on what's configured
        const fallbackOrder: LLMProvider[] = ['openai', 'anthropic', 'google', 'nvidia', 'openrouter', 'bedrock'];
        
        for (const provider of fallbackOrder) {
            if (provider === primaryProvider) continue;
            
            if (provider === 'openai' && this.openaiKey) return 'openai';
            if (provider === 'anthropic' && this.anthropicKey) return 'anthropic';
            if (provider === 'google' && this.googleKey) return 'google';
            if (provider === 'nvidia' && this.nvidiaKey) return 'nvidia';
            if (provider === 'openrouter' && this.openrouterKey) return 'openrouter';
            if (provider === 'bedrock' && this.bedrockAccessKeyId) return 'bedrock';
        }
        
        return null;
    }

    private getDefaultModelForProvider(provider: LLMProvider): string {
        switch (provider) {
            case 'openai': return 'gpt-4o';
            case 'google': return 'gemini-2.0-flash';
            case 'nvidia': return 'moonshotai/kimi-k2.5';
            case 'openrouter': return 'google/gemini-2.0-flash-exp:free';
            case 'anthropic': return 'claude-sonnet-4-5';
            case 'bedrock': return this.modelName;
            default: return this.modelName;
        }
    }

    public async analyzeMedia(filePath: string, prompt: string): Promise<string> {
        const provider = this.inferProvider(this.modelName);

        if (provider === 'google') {
            return this.analyzeMediaGoogle(filePath, prompt);
        } else {
            return this.analyzeMediaOpenAI(filePath, prompt);
        }
    }

    public async analyzeMediaWithModel(filePath: string, prompt: string, modelName: string): Promise<string> {
        if (!modelName) return this.analyzeMedia(filePath, prompt);

        const provider = this.inferProvider(modelName);
        if (provider === 'google') {
            return this.analyzeMediaGoogle(filePath, prompt, modelName);
        }
        if (provider === 'openai') {
            return this.analyzeMediaOpenAI(filePath, prompt);
        }
        return this.analyzeMedia(filePath, prompt);
    }

    /**
     * Text-to-Speech: Convert text to an audio file using the primary provider.
     * Uses Google TTS when primary provider is google; otherwise OpenAI TTS.
     * Returns the path to the generated audio file.
     * 
     * @param text The text to convert to speech
     * @param outputPath Where to save the audio file
     * @param voice The voice to use. OpenAI voices: alloy, echo, fable, onyx, nova, shimmer. Google: e.g. kore.
     * @param speed Speech speed multiplier (0.25 to 4.0). Default: 1.0
     */
    public async textToSpeech(text: string, outputPath: string, voice: string = 'nova', speed: number = 1.0): Promise<string> {
        const primaryProvider = this.preferredProvider || this.inferProvider(this.modelName);

        if (primaryProvider === 'google' && this.googleKey) {
            return this.textToSpeechGoogle(text, outputPath, voice);
        }

        if (!this.openaiKey) {
            throw new Error('OpenAI API key not configured — required for TTS');
        }

        const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
        if (!validVoices.includes(voice)) {
            voice = 'nova';
        }

        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openaiKey}`,
                },
                body: JSON.stringify({
                    model: 'tts-1',
                    input: text,
                    voice: voice,
                    response_format: 'opus',  // Opus codec in OGG container — works as voice note
                    speed: Math.max(0.25, Math.min(4.0, speed))
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`OpenAI TTS Error: ${response.status} ${err}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            
            // Ensure output directory exists
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            fs.writeFileSync(outputPath, buffer);
            logger.info(`MultiLLM TTS (OpenAI): Generated ${buffer.length} bytes → ${outputPath}`);
            return outputPath;
        } catch (error) {
            logger.error(`MultiLLM TTS Error: ${error}`);
            throw error;
        }
    }

    private async textToSpeechGoogle(text: string, outputPath: string, voice: string = 'kore'): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured — required for TTS');

        const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.googleKey}`;
        const body = {
            model: 'gemini-2.5-flash-preview-tts',
            input: text,
            response_modalities: ['AUDIO'],
            generation_config: {
                speech_config: {
                    language: 'en-us',
                    voice: voice || 'kore'
                }
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Google TTS Error: ${response.status} ${err}`);
            }

            const data: any = await response.json().catch(() => ({}));
            const outputs = data?.outputs || [];
            const audio = outputs.find((o: any) => o?.type === 'audio');
            const base64 = audio?.data;
            if (!base64) {
                throw new Error('Google TTS Error: No audio data returned');
            }

            const pcmBuffer = Buffer.from(base64, 'base64');

            const wavPath = path.extname(outputPath).toLowerCase() === '.wav'
                ? outputPath
                : outputPath.replace(path.extname(outputPath) || '', '') + '.wav';

            // Ensure output directory exists
            const dir = path.dirname(wavPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            this.writeWavFile(pcmBuffer, wavPath, 24000, 1, 16);
            logger.info(`MultiLLM TTS (Google): Generated ${pcmBuffer.length} bytes PCM → ${wavPath}`);
            return wavPath;
        } catch (error) {
            logger.error(`MultiLLM TTS Error: ${error}`);
            throw error;
        }
    }

    private writeWavFile(pcmData: Buffer, outputPath: string, sampleRate: number, channels: number, bitDepth: number): void {
        const byteRate = sampleRate * channels * (bitDepth / 8);
        const blockAlign = channels * (bitDepth / 8);
        const dataSize = pcmData.length;
        const header = Buffer.alloc(44);

        header.write('RIFF', 0);
        header.writeUInt32LE(36 + dataSize, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // PCM header size
        header.writeUInt16LE(1, 20);  // Audio format PCM
        header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitDepth, 34);
        header.write('data', 36);
        header.writeUInt32LE(dataSize, 40);

        const wav = Buffer.concat([header, pcmData]);
        fs.writeFileSync(outputPath, wav);
    }

    private async analyzeMediaGoogle(filePath: string, prompt: string, modelOverride?: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        const buffer = fs.readFileSync(filePath);
        const mimeType = this.getMimeType(filePath);
        const base64Data = buffer.toString('base64');

        const model = (modelOverride && modelOverride.trim()) ? modelOverride.trim() : 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`;

        const body = {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Google Media Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            if (data.candidates && data.candidates.length > 0 &&
                data.candidates[0].content &&
                data.candidates[0].content.parts &&
                data.candidates[0].content.parts.length > 0) {
                return data.candidates[0].content.parts[0].text;
            }
            throw new Error(`No analytical content in Gemini response: ${JSON.stringify(data)}`);
        } catch (error) {
            logger.error(`MultiLLM Google Media Error: ${error}`);
            throw error;
        }
    }

    private async analyzeMediaOpenAI(filePath: string, prompt: string): Promise<string> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');
        const ext = path.extname(filePath).toLowerCase().substring(1);

        // Prefer detected mime over extension
        const buffer = fs.readFileSync(filePath);
        const detectedMime = await this.detectMime(buffer, ext);

        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) || detectedMime.startsWith('image/')) {
            const { encoded, mime } = await this.prepareImage(buffer, detectedMime);

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openaiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                {
                                    type: 'image_url',
                                    image_url: { url: `data:${mime};base64,${encoded}` }
                                }
                            ]
                        }
                    ]
                }),
            });

            if (!response.ok) throw new Error(`OpenAI Vision Error: ${response.status}`);
            const data = await response.json() as any;
            return data.choices[0].message.content;
        } else if (['mp3', 'm4a', 'wav', 'ogg'].includes(ext) || detectedMime.startsWith('audio/')) {
            const formData = new FormData();
            // In Node environments, global FormData might behave differently.
            formData.append('file', new Blob([buffer]), path.basename(filePath));
            formData.append('model', 'whisper-1');

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiKey}`,
                },
                body: formData
            });

            if (!response.ok) throw new Error(`OpenAI Whisper Error: ${response.status}`);
            const data = await response.json() as any;
            return `Transcription result:\n${data.text}`;
        } else if (ext === 'pdf' || detectedMime === 'application/pdf') {
            try {
                const text = await this.extractPdfText(buffer);
                return this.call(`${prompt}\n\n[PDF EXCERPT]:\n${text.substring(0, 15000)}`);
            } catch (e) {
                logger.warn(`PDF extract failed, falling back to raw text: ${e}`);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    return this.call(`${prompt}\n\n[FILE CONTENT EXCERPT]:\n${content.substring(0, 15000)}`);
                } catch (err) {
                    return `Unsupported file analysis for extension .${ext}. Try a multimodal provider like Google/Gemini for advanced media types.`;
                }
            }
        } else {
            // Document Fallback
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                return this.call(`${prompt}\n\n[FILE CONTENT EXCERPT]:\n${content.substring(0, 15000)}`);
            } catch (e) {
                return `Unsupported file analysis for extension .${ext}. Try a multimodal provider like Google/Gemini for advanced media types.`;
            }
        }
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase().substring(1);
        switch (ext) {
            case 'png': return 'image/png';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'webp': return 'image/webp';
            case 'mp4': return 'video/mp4';
            case 'mp3': return 'audio/mpeg';
            case 'wav': return 'audio/wav';
            case 'pdf': return 'application/pdf';
            default: return 'application/octet-stream';
        }
    }

    private async detectMime(buffer: Buffer, fallbackExt: string): Promise<string> {
        try {
            const { fileTypeFromBuffer } = await import('file-type');
            const res = await fileTypeFromBuffer(buffer);
            if (res?.mime) return res.mime;
        } catch (e) {
            logger.debug(`Mime detect fallback: ${e}`);
        }
        return this.getMimeType(`.${fallbackExt}`);
    }

    private async prepareImage(buffer: Buffer, mime: string): Promise<{ encoded: string, mime: string }> {
        let working = buffer;
        let workingMime = mime;
        try {
            const sharp = (await import('sharp')).default;
            const image = sharp(buffer, { failOn: 'none' });
            const meta = await image.metadata();
            const needsResize = (meta.width && meta.width > 2048) || (meta.height && meta.height > 2048);

            if (needsResize || (buffer.byteLength > 2_000_000)) {
                const resized = image.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
                const output = await resized.jpeg({ quality: 85 }).toBuffer();
                working = output;
                workingMime = 'image/jpeg';
            }
        } catch (e) {
            logger.debug(`Image preprocess skipped: ${e}`);
        }

        return { encoded: working.toString('base64'), mime: workingMime };
    }

    private async extractPdfText(buffer: Buffer): Promise<string> {
        // pdfjs-dist is ESM; use dynamic import
        const pdfjs = await import('pdfjs-dist');
        const loadingTask = pdfjs.getDocument({ data: buffer });
        const doc = await loadingTask.promise;
        const maxPages = Math.min(doc.numPages, 20);
        let text = '';
        for (let i = 1; i <= maxPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map((it: any) => it.str).join(' ');
            text += strings + '\n';
            if (text.length > 20000) break; // guardrail
        }
        return text;
    }

    /** Build PiAIAdapterOptions from current state. */
    private getPiAIOptions(modelOverride?: string, providerOverride?: LLMProvider): PiAIAdapterOptions {
        const model = modelOverride || this.modelName;
        return {
            // Do NOT pass this.preferredProvider here — it's a legacy routing hint that can
            // misdirect pi-ai (e.g. stored 'google' but model is 'llama-3.3-70b-versatile').
            // Only pass an explicit per-call override; toPiProvider() infers from model name.
            provider: providerOverride ?? 'auto',
            model,
            apiKeys: {
                openai: this.openaiKey,
                google: this.googleKey,
                anthropic: this.anthropicKey,
                openrouter: this.openrouterKey,
                nvidia: this.nvidiaKey,
                bedrockAccessKeyId: this.bedrockAccessKeyId,
                bedrockSecretAccessKey: this.bedrockSecretAccessKey,
                bedrockRegion: this.bedrockRegion,
                bedrockSessionToken: this.bedrockSessionToken,
                groq: this.groqKey,
                mistral: this.mistralKey,
                cerebras: this.cerebrasKey,
                xai: this.xaiKey,
            },
        };
    }

    private inferProvider(modelName: string): LLMProvider {
        const lower = modelName.toLowerCase();
        if (lower.includes('bedrock') || lower.startsWith('br:')) return 'bedrock';
        if (lower.includes('claude') || lower.startsWith('anthropic:') || lower.startsWith('ant:')) return 'anthropic';
        if (lower.includes('gemini')) return 'google';
        if (lower.startsWith('openrouter:') || lower.startsWith('openrouter/') || lower.startsWith('or:')) return 'openrouter';
        if (lower.startsWith('nvidia:') || lower.startsWith('nv:')) return 'nvidia';
        return 'openai';
    }

    private normalizeOpenRouterModel(modelName: string): string {
        return modelName
            .replace(/^openrouter:/i, '')
            .replace(/^openrouter\//i, '')
            .replace(/^or:/i, '');
    }

    private normalizeNvidiaModel(modelName: string): string {
        return modelName
            .replace(/^nvidia:/i, '')
            .replace(/^nv:/i, '');
    }

    private normalizeAnthropicModel(modelName: string): string {
        return modelName
            .replace(/^anthropic:/i, '')
            .replace(/^ant:/i, '');
    }

    private getBedrockClient() {
        if (!this.bedrockRegion) throw new Error('Bedrock region not configured');
        return new BedrockRuntimeClient({
            region: this.bedrockRegion,
            credentials: this.bedrockAccessKeyId && this.bedrockSecretAccessKey ? {
                accessKeyId: this.bedrockAccessKeyId,
                secretAccessKey: this.bedrockSecretAccessKey,
                sessionToken: this.bedrockSessionToken,
            } : undefined,
        });
    }

    private async callBedrock(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        const modelId = modelOverride || this.modelName;
        if (!this.bedrockRegion) throw new Error('Bedrock region not configured');

        const body = {
            messages: [
                systemMessage ? { role: 'user', content: [{ type: 'text', text: `${systemMessage}\n\n${prompt}` }] } : { role: 'user', content: [{ type: 'text', text: prompt }] }
            ],
            max_tokens: 1024,
            temperature: 0.7
        } as any;

        const client = this.getBedrockClient();
        const command = new InvokeModelCommand({
            modelId,
            body: JSON.stringify(body),
            contentType: 'application/json',
            accept: 'application/json'
        });

        try {
            const response = await client.send(command);
            const decoded = new TextDecoder().decode(response.body as Uint8Array);
            const data = JSON.parse(decoded);
            this.recordUsage('bedrock', modelId, prompt, data, undefined);

            if (data.output?.message?.content?.length) {
                const textPart = data.output.message.content.find((p: any) => p.text)?.text;
                if (textPart) return textPart;
            }
            if (data.outputText) return data.outputText;
            return JSON.stringify(data);
        } catch (error) {
            logger.error(`MultiLLM Bedrock Error: ${error}`);
            throw error;
        }
    }

    private async callOpenAI(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        const model = modelOverride || this.modelName;

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openaiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.7,
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`OpenAI API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            this.recordUsage('openai', model, prompt, data, data?.choices?.[0]?.message?.content);
            return data.choices[0].message.content;
        } catch (error) {
            logger.error(`MultiLLM OpenAI Error: ${error}`);
            throw error;
        }
    }

    private async callOpenRouter(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.openrouterKey) throw new Error('OpenRouter API key not configured');

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        const rawModel = modelOverride || this.modelName;
        const model = this.normalizeOpenRouterModel(rawModel);
        const base = this.openrouterBaseUrl.replace(/\/+$/, '');
        const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openrouterKey}`
        };
        if (this.openrouterReferer) headers['HTTP-Referer'] = this.openrouterReferer;
        if (this.openrouterAppName) headers['X-Title'] = this.openrouterAppName;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`OpenRouter API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            const content = data?.choices?.[0]?.message?.content;
            this.recordUsage('openrouter', model, prompt, data, content);
            return content || JSON.stringify(data);
        } catch (error) {
            logger.error(`MultiLLM OpenRouter Error: ${error}`);
            throw error;
        }
    }

    private async callGoogle(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        const fullPrompt = systemMessage ? `System: ${systemMessage}\n\nUser: ${prompt}` : prompt;
        const model = modelOverride || this.modelName;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }]
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Google API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            this.recordUsage('google', model, fullPrompt, data, textOut);
            if (data.candidates && data.candidates.length > 0 &&
                data.candidates[0].content &&
                data.candidates[0].content.parts &&
                data.candidates[0].content.parts.length > 0) {
                return data.candidates[0].content.parts[0].text;
            }
            throw new Error(`No text content in Gemini response: ${JSON.stringify(data)}`);
        } catch (error) {
            logger.error(`MultiLLM Google Error: ${error}`);
            throw error;
        }
    }

    private async callNvidia(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.nvidiaKey) throw new Error('NVIDIA API key not configured');

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        const rawModel = modelOverride || this.modelName;
        const model = this.normalizeNvidiaModel(rawModel);

        try {
            const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.nvidiaKey}`,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: 16384,
                    temperature: 0.7,
                    top_p: 1.00,
                    stream: false,
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`NVIDIA API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            this.recordUsage('nvidia', model, prompt, data, data?.choices?.[0]?.message?.content);
            return data.choices[0].message.content;
        } catch (error) {
            logger.error(`MultiLLM NVIDIA Error: ${error}`);
            throw error;
        }
    }

    private async callAnthropic(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.anthropicKey) throw new Error('Anthropic API key not configured');

        const rawModel = modelOverride || this.modelName;
        const model = this.normalizeAnthropicModel(rawModel);

        const body: any = {
            model,
            max_tokens: 16384,
            messages: [
                { role: 'user', content: prompt }
            ]
        };

        // Anthropic Messages API uses a top-level "system" field, not a system message in the array.
        // Use structured content block with cache_control for prompt caching.
        // This can save 90% of input token costs on repeated system prompts.
        if (systemMessage) {
            body.system = [
                {
                    type: 'text',
                    text: systemMessage,
                    cache_control: { type: 'ephemeral' }
                }
            ];
        }

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.anthropicKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-beta': 'prompt-caching-2024-07-31',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Anthropic API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;

            // Extract text from content blocks
            const textContent = data.content
                ?.filter((block: any) => block.type === 'text')
                ?.map((block: any) => block.text)
                ?.join('') || '';

            this.recordUsage('anthropic', model, prompt, data, textContent);
            return textContent;
        } catch (error) {
            logger.error(`MultiLLM Anthropic Error: ${error}`);
            throw error;
        }
    }

    private recordUsage(provider: LLMProvider, model: string, prompt: string, data: any, completionText?: string) {
        if (!this.tokenTracker) return;

        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        let estimated = true; // assume estimated until proven otherwise

        // Try to extract real usage data from API response first
        if ((provider === 'openai' || provider === 'openrouter' || provider === 'nvidia') && data?.usage) {
            const u = data.usage;
            if (u.prompt_tokens !== undefined && u.prompt_tokens !== null) {
                promptTokens = u.prompt_tokens;
                completionTokens = u.completion_tokens ?? 0;
                totalTokens = u.total_tokens ?? (promptTokens + completionTokens);
                estimated = false;
            }
        }

        if (provider === 'google' && data?.usageMetadata) {
            const u = data.usageMetadata;
            if (u.promptTokenCount !== undefined && u.promptTokenCount !== null) {
                promptTokens = u.promptTokenCount;
                completionTokens = u.candidatesTokenCount ?? 0;
                totalTokens = u.totalTokenCount ?? (promptTokens + completionTokens);
                estimated = false;
            }
        }

        if (provider === 'bedrock') {
            const usage = data?.usage || data?.Usage || {};
            const inputTokens = usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens;
            const outputTokens = usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens;
            if (inputTokens !== undefined && inputTokens !== null) {
                promptTokens = inputTokens;
                completionTokens = outputTokens ?? 0;
                totalTokens = usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens);
                estimated = false;
            }
        }

        if (provider === 'anthropic' && data?.usage) {
            const u = data.usage;
            if (u.input_tokens !== undefined && u.input_tokens !== null) {
                promptTokens = u.input_tokens;
                completionTokens = u.output_tokens ?? 0;
                totalTokens = promptTokens + completionTokens;
                estimated = false;
            }
        }

        // Only fall back to estimation if the API returned no usage data at all
        if (estimated) {
            promptTokens = this.estimateTokens(prompt);
            completionTokens = this.estimateTokens(completionText || '');
            totalTokens = promptTokens + completionTokens;
        }

        this.tokenTracker.record({
            ts: new Date().toISOString(),
            provider,
            model,
            promptTokens,
            completionTokens,
            totalTokens,
            metadata: { estimated }
        });
    }

    /**
     * Improved token estimation heuristic.
     * Uses word/subword analysis instead of the naive chars/4 formula.
     * Still an approximation but ~20-30% more accurate for mixed content.
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;

        // Count different text components that tokenize differently:
        // 1. Words (most map to 1 token, long words to 2+)
        // 2. Numbers (each digit group is usually 1-2 tokens)
        // 3. Punctuation / special chars (usually 1 token each)
        // 4. Whitespace runs (usually absorbed into adjacent tokens)

        let tokens = 0;

        // Split into whitespace-separated chunks
        const chunks = text.split(/\s+/).filter(c => c.length > 0);
        for (const chunk of chunks) {
            if (chunk.length <= 4) {
                // Short words are typically 1 token
                tokens += 1;
            } else if (chunk.length <= 10) {
                // Medium words: usually 1-2 tokens
                tokens += Math.ceil(chunk.length / 5);
            } else {
                // Long words/URLs/code: ~1 token per 4-5 chars
                tokens += Math.ceil(chunk.length / 4.5);
            }
        }

        // Add tokens for newlines (each is typically a token)
        const newlines = (text.match(/\n/g) || []).length;
        tokens += newlines;

        // Minimum 1 token for non-empty text
        return Math.max(1, Math.ceil(tokens));
    }

    /**
     * Generate an image using the configured provider.
     * Returns the file path to the saved image.
     */
    public async generateImage(
        prompt: string,
        outputPath: string,
        options?: {
            provider?: 'openai' | 'google';
            model?: string;
            size?: string;
            quality?: string;
        }
    ): Promise<{ success: boolean; filePath?: string; revisedPrompt?: string; error?: string }> {
        const provider = options?.provider || (this.googleKey ? 'google' : this.openaiKey ? 'openai' : null);

        if (!provider) {
            return { success: false, error: 'No image generation provider available. Configure an OpenAI or Google API key.' };
        }

        try {
            if (provider === 'openai') {
                return await this.generateImageOpenAI(prompt, outputPath, options?.model, options?.size, options?.quality);
            } else if (provider === 'google') {
                return await this.generateImageGoogle(prompt, outputPath, options?.model, options?.size);
            }
            return { success: false, error: `Unsupported image gen provider: ${provider}` };
        } catch (error) {
            logger.error(`MultiLLM: Image generation failed (${provider}): ${error}`);
            return { success: false, error: String(error) };
        }
    }

    /**
     * Generate an image using OpenAI DALL·E / GPT Image API.
     * Uses the Images API endpoint: POST /v1/images/generations
     */
    private async generateImageOpenAI(
        prompt: string,
        outputPath: string,
        model?: string,
        size?: string,
        quality?: string
    ): Promise<{ success: boolean; filePath?: string; revisedPrompt?: string; error?: string }> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');

        const imageModel = model || 'dall-e-3';
        const imageSize = size || '1024x1024';
        // DALL-E 3 uses 'standard'/'hd'; GPT Image uses 'low'/'medium'/'high'
        const isDalle = imageModel.startsWith('dall-e');
        let imageQuality: string;
        if (isDalle) {
            imageQuality = (quality === 'high' || quality === 'hd') ? 'hd' : 'standard';
        } else {
            imageQuality = quality || 'medium';
        }

        const body: any = {
            model: imageModel,
            prompt,
            n: 1,
            size: imageSize,
            quality: imageQuality,
        };

        // GPT Image models return b64_json by default; DALL-E supports both
        body.response_format = 'b64_json';

        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openaiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI Image API Error: ${response.status} ${err}`);
        }

        const data = await response.json() as any;
        const imageData = data?.data?.[0];

        if (!imageData) throw new Error('No image data in OpenAI response');

        const b64 = imageData.b64_json;
        if (!b64) throw new Error('No base64 image data returned');

        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));

        logger.info(`MultiLLM: OpenAI image generated → ${outputPath} (model: ${imageModel})`);

        return {
            success: true,
            filePath: outputPath,
            revisedPrompt: imageData.revised_prompt,
        };
    }

    /**
     * Generate an image using Google Gemini image generation.
     * Uses the Gemini generateContent endpoint with responseModalities: ['Image'].
     * Compatible models: gemini-2.5-flash-image, gemini-3-pro-image-preview
     */
    private async generateImageGoogle(
        prompt: string,
        outputPath: string,
        model?: string,
        size?: string
    ): Promise<{ success: boolean; filePath?: string; revisedPrompt?: string; error?: string }> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        const imageModel = model || 'gemini-2.5-flash-image';

        // Map size to aspect ratio for Gemini
        let aspectRatio: string | undefined;
        if (size) {
            const [w, h] = size.split('x').map(Number);
            if (w && h) {
                if (w > h) aspectRatio = '16:9';
                else if (h > w) aspectRatio = '9:16';
                else aspectRatio = '1:1';
            }
        }

        const requestBody: any = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ['Image', 'Text'],
            },
        };

        if (aspectRatio) {
            requestBody.generationConfig.imageConfig = { aspectRatio };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${this.googleKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Google Image API Error: ${response.status} ${err}`);
        }

        const data = await response.json() as any;
        const parts = data?.candidates?.[0]?.content?.parts;

        if (!parts || parts.length === 0) {
            throw new Error('No parts in Gemini image response');
        }

        // Find the image part (inline_data with image mimetype)
        let imageB64: string | undefined;
        let mimeType = 'image/png';
        let textResponse: string | undefined;

        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                imageB64 = part.inlineData.data;
                mimeType = part.inlineData.mimeType;
            } else if (part.inline_data && part.inline_data.mime_type?.startsWith('image/')) {
                // Alternative casing from some API responses
                imageB64 = part.inline_data.data;
                mimeType = part.inline_data.mime_type;
            } else if (part.text) {
                textResponse = part.text;
            }
        }

        if (!imageB64) {
            throw new Error(`No image data in Gemini response. Text: ${textResponse || 'none'}`);
        }

        // Determine extension from mime type
        const ext = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
        const finalPath = outputPath.endsWith(ext) ? outputPath : outputPath.replace(/\.[^.]+$/, ext);

        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(finalPath, Buffer.from(imageB64, 'base64'));

        logger.info(`MultiLLM: Google image generated → ${finalPath} (model: ${imageModel})`);

        return {
            success: true,
            filePath: finalPath,
            revisedPrompt: textResponse,
        };
    }
}
