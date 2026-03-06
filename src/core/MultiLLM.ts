import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import fs from 'fs';
import path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TokenTracker } from './TokenTracker';
import { piAiCall, piAiCallWithTools, getPiProviders, getPiModels, piAiLogin, isPiAiLinked, type PiAIAdapterOptions } from './PiAIAdapter';
import { convertToWhisperCompatible, getMimeType as getAudioHelperMimeType, isAudioFile } from '../utils/AudioHelper';
import { eventBus } from './EventBus';

export type LLMProvider = 'openai' | 'google' | 'bedrock' | 'openrouter' | 'nvidia' | 'anthropic' | 'ollama' | 'groq' | 'mistral' | 'deepseek' | 'xai' | 'perplexity' | 'cerebras';

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
    private huggingfaceKey?: string;
    private kimiKey?: string;
    private minimaxKey?: string;
    private zaiKey?: string;
    private perplexityKey?: string;
    private deepseekKey?: string;
    private opencodeKey?: string;
    private ollamaUrl?: string;
    private azureEndpoint?: string;
    private googleProjectId?: string;
    private googleLocation?: string;
    private tokenTracker?: TokenTracker;
    private preferredProvider?: LLMProvider;
    private fallbackModelNames: Record<string, string> = {};

    /** When true, route call() and callWithTools() through @mariozechner/pi-ai */
    private usePiAI: boolean = false;

    constructor(config?: {
        apiKey?: string, googleApiKey?: string, nvidiaApiKey?: string, anthropicApiKey?: string, modelName?: string,
        bedrockRegion?: string, bedrockAccessKeyId?: string, bedrockSecretAccessKey?: string, bedrockSessionToken?: string,
        tokenTracker?: TokenTracker, openrouterApiKey?: string, openrouterBaseUrl?: string, openrouterReferer?: string,
        openrouterAppName?: string, llmProvider?: LLMProvider, usePiAI?: boolean, groqApiKey?: string, mistralApiKey?: string,
        cerebrasApiKey?: string, xaiApiKey?: string, huggingfaceApiKey?: string, kimiApiKey?: string, minimaxApiKey?: string,
        zaiApiKey?: string, perplexityApiKey?: string, deepseekApiKey?: string, opencodeApiKey?: string,
        ollamaApiUrl?: string, azureEndpoint?: string, googleProjectId?: string, googleLocation?: string,
        fallbackModelNames?: Record<string, string>
    }) {
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
        this.huggingfaceKey = config?.huggingfaceApiKey || process.env.HUGGINGFACE_API_KEY;
        this.kimiKey = config?.kimiApiKey || process.env.KIMI_API_KEY;
        this.minimaxKey = config?.minimaxApiKey || process.env.MINIMAX_API_KEY;
        this.zaiKey = config?.zaiApiKey || process.env.ZAI_API_KEY;
        this.perplexityKey = config?.perplexityApiKey || process.env.PERPLEXITY_API_KEY;
        this.deepseekKey = config?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
        this.opencodeKey = config?.opencodeApiKey || process.env.OPENCODE_API_KEY;
        this.ollamaUrl = config?.ollamaApiUrl || process.env.OLLAMA_API_URL || 'http://localhost:11434';
        this.azureEndpoint = config?.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT;
        this.googleProjectId = config?.googleProjectId || process.env.GOOGLE_PROJECT_ID;
        this.googleLocation = config?.googleLocation || process.env.GOOGLE_LOCATION;
        this.tokenTracker = config?.tokenTracker;
        this.preferredProvider = config?.llmProvider;
        this.fallbackModelNames = config?.fallbackModelNames || {};
        this.usePiAI = config?.usePiAI ?? false;

        if (this.usePiAI) logger.info('MultiLLM: pi-ai backend enabled');
        logger.info(`MultiLLM: Initialized with model ${this.modelName}`);
    }

    /**
     * Update configuration and API keys at runtime without re-instantiating.
     */
    public updateConfig(config: {
        apiKey?: string, googleApiKey?: string, nvidiaApiKey?: string, anthropicApiKey?: string, modelName?: string,
        bedrockRegion?: string, bedrockAccessKeyId?: string, bedrockSecretAccessKey?: string, bedrockSessionToken?: string,
        openrouterApiKey?: string, openrouterBaseUrl?: string, openrouterReferer?: string,
        openrouterAppName?: string, llmProvider?: LLMProvider, usePiAI?: boolean, groqApiKey?: string, mistralApiKey?: string,
        cerebrasApiKey?: string, xaiApiKey?: string, huggingfaceApiKey?: string, kimiApiKey?: string, minimaxApiKey?: string,
        zaiApiKey?: string, perplexityApiKey?: string, deepseekApiKey?: string, opencodeApiKey?: string,
        ollamaApiUrl?: string, azureEndpoint?: string, googleProjectId?: string, googleLocation?: string,
        fallbackModelNames?: Record<string, string>, fastModelName?: string
    }) {
        if (config.apiKey !== undefined) this.openaiKey = config.apiKey;
        if (config.googleApiKey !== undefined) this.googleKey = config.googleApiKey;
        if (config.nvidiaApiKey !== undefined) this.nvidiaKey = config.nvidiaApiKey;
        if (config.anthropicApiKey !== undefined) this.anthropicKey = config.anthropicApiKey;
        if (config.modelName !== undefined) this.modelName = config.modelName;
        if (config.bedrockRegion !== undefined) this.bedrockRegion = config.bedrockRegion;
        if (config.bedrockAccessKeyId !== undefined) this.bedrockAccessKeyId = config.bedrockAccessKeyId;
        if (config.bedrockSecretAccessKey !== undefined) this.bedrockSecretAccessKey = config.bedrockSecretAccessKey;
        if (config.bedrockSessionToken !== undefined) this.bedrockSessionToken = config.bedrockSessionToken;
        if (config.openrouterApiKey !== undefined) this.openrouterKey = config.openrouterApiKey;
        if (config.openrouterBaseUrl !== undefined) this.openrouterBaseUrl = config.openrouterBaseUrl;
        if (config.openrouterReferer !== undefined) this.openrouterReferer = config.openrouterReferer;
        if (config.openrouterAppName !== undefined) this.openrouterAppName = config.openrouterAppName;
        if (config.llmProvider !== undefined) this.preferredProvider = config.llmProvider;
        if (config.usePiAI !== undefined) this.usePiAI = config.usePiAI;
        if (config.groqApiKey !== undefined) this.groqKey = config.groqApiKey;
        if (config.mistralApiKey !== undefined) this.mistralKey = config.mistralApiKey;
        if (config.cerebrasApiKey !== undefined) this.cerebrasKey = config.cerebrasApiKey;
        if (config.xaiApiKey !== undefined) this.xaiKey = config.xaiApiKey;
        if (config.huggingfaceApiKey !== undefined) this.huggingfaceKey = config.huggingfaceApiKey;
        if (config.kimiApiKey !== undefined) this.kimiKey = config.kimiApiKey;
        if (config.minimaxApiKey !== undefined) this.minimaxKey = config.minimaxApiKey;
        if (config.zaiApiKey !== undefined) this.zaiKey = config.zaiApiKey;
        if (config.perplexityApiKey !== undefined) this.perplexityKey = config.perplexityApiKey;
        if (config.deepseekApiKey !== undefined) this.deepseekKey = config.deepseekApiKey;
        if (config.opencodeApiKey !== undefined) this.opencodeKey = config.opencodeApiKey;
        if (config.ollamaApiUrl !== undefined) this.ollamaUrl = config.ollamaApiUrl;
        if (config.azureEndpoint !== undefined) this.azureEndpoint = config.azureEndpoint;
        if (config.googleProjectId !== undefined) this.googleProjectId = config.googleProjectId;
        if (config.googleLocation !== undefined) this.googleLocation = config.googleLocation;
        if (config.fallbackModelNames !== undefined) this.fallbackModelNames = config.fallbackModelNames;
        if (config.fastModelName !== undefined) this.fastModelName = config.fastModelName;

        logger.info(`MultiLLM: Configuration updated (active model: ${this.modelName}, provider: ${this.preferredProvider || 'auto'})`);
    }

    // ── Fast model for internal reasoning (reviews, reflections, classification) ──
    private fastModelName?: string;

    public setFastModel(modelName: string): void {
        this.fastModelName = modelName;
        logger.info(`MultiLLM: Fast model set to ${modelName}`);
    }

    public async callFast(prompt: string, systemMessage?: string): Promise<string> {
        if (this.fastModelName) {
            const provider = this.inferProvider(this.fastModelName);
            if (this.hasKeyForProvider(provider)) {
                return this.call(prompt, systemMessage, provider, this.fastModelName);
            }
            logger.info(`MultiLLM: Fast model ${this.fastModelName} needs ${provider} key (not configured). Auto-selecting from primary provider.`);
        }
        const primaryProvider = this.preferredProvider || this.inferProvider(this.modelName);
        const fastModel = this.getFastModelForProvider(primaryProvider);
        return this.call(prompt, systemMessage, primaryProvider, fastModel);
    }

    private hasKeyForProvider(provider: LLMProvider): boolean {
        switch (provider) {
            case 'openai': return !!this.openaiKey && !this.openaiKey.startsWith('your_');
            case 'google': return !!this.googleKey && !this.googleKey.startsWith('your_');
            case 'anthropic': return !!this.anthropicKey && !this.anthropicKey.startsWith('your_');
            case 'nvidia': return !!this.nvidiaKey && !this.nvidiaKey.startsWith('your_');
            case 'openrouter': return !!this.openrouterKey && !this.openrouterKey.startsWith('your_');
            case 'bedrock': return !!this.bedrockAccessKeyId;
            case 'ollama': return true;
            default:
                if (provider === 'groq' as any) return !!this.groqKey && !this.groqKey.startsWith('your_');
                if (provider === 'mistral' as any) return !!this.mistralKey && !this.mistralKey.startsWith('your_');
                if (provider === 'xai' as any) return !!this.xaiKey && !this.xaiKey.startsWith('your_');
                if (provider === 'cerebras' as any) return !!this.cerebrasKey && !this.cerebrasKey.startsWith('your_');
                if (provider === 'deepseek' as any) return !!this.deepseekKey && !this.deepseekKey.startsWith('your_');
                if (provider === 'perplexity' as any) return !!this.perplexityKey && !this.perplexityKey.startsWith('your_');
                return false;
        }
    }

    private getFastModelForProvider(provider: LLMProvider): string {
        switch (provider) {
            case 'openai': return 'gpt-4o-mini';
            case 'google': return 'gemini-flash-lite-latest';
            case 'anthropic': return 'claude-3-5-haiku-latest';
            case 'nvidia': return 'meta/llama-3.3-70b-instruct';
            case 'openrouter': return 'openai/gpt-oss-120b:free';
            case 'bedrock': return this.modelName;
            default: return this.modelName;
        }
    }

    public async call(prompt: string, systemMessage?: string, provider?: LLMProvider, modelOverride?: string): Promise<string> {
        const primaryProvider = provider || this.preferredProvider || this.inferProvider(modelOverride || this.modelName);

        if (this.usePiAI && primaryProvider !== 'ollama') {
            try {
                return await piAiCall(prompt, systemMessage, this.getPiAIOptions(modelOverride, provider));
            } catch (e) {}
        }
        
        const fallbackProvider = this.getFallbackProvider(primaryProvider);
        const executeCall = async (p: LLMProvider, m?: string) => {
            if (p === 'openai') return this.callOpenAI(prompt, systemMessage, m);
            if (p === 'google') return this.callGoogle(prompt, systemMessage, m);
            if (p === 'bedrock') return this.callBedrock(prompt, systemMessage, m);
            if (p === 'openrouter') return this.callOpenRouter(prompt, systemMessage, m);
            if (p === 'nvidia') return this.callNvidia(prompt, systemMessage, m);
            if (p === 'anthropic') return this.callAnthropic(prompt, systemMessage, m);
            if (p === 'ollama') return this.callOllama(prompt, systemMessage, m);
            
            try {
                return await piAiCall(prompt, systemMessage, this.getPiAIOptions(m, p));
            } catch (e) {
                throw new Error(`Provider ${p} not supported by core MultiLLM and pi-ai routing failed: ${(e as Error).message}`);
            }
        };

        const primaryModel = modelOverride || this.modelName;
        return ErrorHandler.withFallback(
            async () => {
                const primaryProviderResolved = provider || this.preferredProvider || this.inferProvider(primaryModel);
                if (!this.hasKeyForProvider(primaryProviderResolved)) {
                    throw new Error(`Primary provider (${primaryProviderResolved}) failed: API key not configured.`);
                }
                return ErrorHandler.withRetry(() => executeCall(primaryProviderResolved, primaryModel), { maxRetries: 2 });
            },
            async () => {
                if (!fallbackProvider) throw new Error(`Primary provider (${primaryProvider}) failed and no fallback available.`);
                const fallbackModel = this.getDefaultModelForProvider(fallbackProvider);
                if (!this.hasKeyForProvider(fallbackProvider)) {
                    throw new Error(`Primary provider (${primaryProvider}) failed and fallback provider (${fallbackProvider}) is not configured.`);
                }
                logger.info(`MultiLLM: Falling back from ${primaryProvider} to ${fallbackProvider} (Using model: ${fallbackModel})`);
                return ErrorHandler.withRetry(() => executeCall(fallbackProvider, fallbackModel), { maxRetries: 1 });
            }
        );
    }

    public async callWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        provider?: LLMProvider,
        modelOverride?: string
    ): Promise<LLMToolResponse> {
        const primaryProvider = provider || this.preferredProvider || this.inferProvider(modelOverride || this.modelName);

        if (this.usePiAI && primaryProvider !== 'ollama') {
            try {
                return await piAiCallWithTools(prompt, systemMessage, tools, this.getPiAIOptions(modelOverride, provider));
            } catch (e) {
                logger.warn(`MultiLLM: pi-ai callWithTools failed, falling back to legacy — ${(e as Error).message}`);
            }
        }
        
        const model = modelOverride || this.modelName;
        const supportsTools = this.supportsNativeToolCalling(primaryProvider);
        if (!supportsTools || tools.length === 0) {
            const textResponse = await this.call(prompt, systemMessage, provider, modelOverride);
            return { content: textResponse, toolCalls: [] };
        }

        const executeToolCall = async (p: LLMProvider, m: string): Promise<LLMToolResponse> => {
            switch (p) {
                case 'openai':
                case 'nvidia':
                    return this.callOpenAIWithTools(prompt, systemMessage, tools, m, p);
                case 'anthropic':
                    return this.callAnthropicWithTools(prompt, systemMessage, tools, m);
                case 'google':
                    return this.callGoogleWithTools(prompt, systemMessage, tools, m);
                case 'openrouter':
                    return this.callOpenRouterWithTools(prompt, systemMessage, tools, m);
                case 'ollama':
                    return this.callOllamaWithTools(prompt, systemMessage, tools, m);
                default:
                    try {
                        return await piAiCallWithTools(prompt, systemMessage, tools, this.getPiAIOptions(m, p));
                    } catch (e) {
                        const text = await this.call(prompt, systemMessage, p, m);
                        return { content: text, toolCalls: [] };
                    }
            }
        };

        const fallbackProvider = this.getFallbackProvider(primaryProvider);
        return ErrorHandler.withFallback(
            async () => {
                if (!this.hasKeyForProvider(primaryProvider)) {
                    throw new Error(`Primary provider (${primaryProvider}) failed: API key not configured.`);
                }
                return ErrorHandler.withRetry(() => executeToolCall(primaryProvider, model), { maxRetries: 2 });
            },
            async () => {
                if (!fallbackProvider) throw new Error(`Primary provider (${primaryProvider}) failed and no fallback available.`);
                if (!this.hasKeyForProvider(fallbackProvider)) {
                    throw new Error(`Primary provider (${primaryProvider}) failed and fallback provider (${fallbackProvider}) is not configured.`);
                }
                const fallbackModel = this.getDefaultModelForProvider(fallbackProvider);
                logger.info(`MultiLLM: Tool call falling back from ${primaryProvider} to ${fallbackProvider}`);
                return ErrorHandler.withRetry(() => executeToolCall(fallbackProvider, fallbackModel), { maxRetries: 1 });
            }
        );
    }

    public supportsNativeToolCalling(provider?: LLMProvider): boolean {
        const p = provider || this.preferredProvider || this.inferProvider(this.modelName);
        return ['openai', 'anthropic', 'google', 'openrouter', 'nvidia', 'ollama'].includes(p);
    }

    private async callOllamaWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        const baseUrl = (this.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
        const url = `${baseUrl}/v1/chat/completions`;
        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });
        const resolvedModel = this.normalizeOllamaModel(model);
        
        const isRemoteBridge = resolvedModel.includes('gemini') || resolvedModel.includes('openai');
        if (!isRemoteBridge) {
            try {
                const psResponse = await fetch(`${baseUrl}/api/ps`);
                if (psResponse.ok) {
                    const psData = await psResponse.json() as any;
                    const isLoaded = (psData.models || []).some((m: any) => m.name === resolvedModel || m.name.startsWith(resolvedModel + ':'));
                    if (!isLoaded) {
                        logger.info(`Ollama: Tool-capable model "${resolvedModel}" is not in memory. Loading...`);
                    }
                }
            } catch (e) {}
        }

        logger.info(`MultiLLM: Requesting tool-call response from Ollama ("${resolvedModel}")...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);
        
        let elapsed = 0;
        const heartbeatId = setInterval(() => {
            elapsed += 15;
            if (elapsed < 180) {
                logger.info(`MultiLLM: Ollama ("${resolvedModel}") is still deliberating tools... [Elapsed: ${elapsed}s]`);
                if (elapsed === 60) {
                    logger.warn(`MultiLLM: Local tool-calling is slow. Ensure you are using a model that natively supports tools (e.g. llama3.1, qwen2.5).`);
                }
            }
        }, 15000);

        try {
            const startTime = Date.now();
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: resolvedModel,
                    messages,
                    temperature: 0.7,
                    tools,
                }),
                signal: controller.signal
            });

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            
            clearTimeout(timeoutId);
            clearInterval(heartbeatId);

            if (!response.ok) {
                const err = await response.text();
                if (response.status === 400 && (err.toLowerCase().includes('tool') || err.toLowerCase().includes('function'))) {
                    logger.warn(`Ollama: Model "${resolvedModel}" does not support native tool calling. Falling back to text-based tools.`);
                    throw new Error('MODEL_DOES_NOT_SUPPORT_TOOLS');
                }
                throw new Error(`Ollama Tool Call API Error: ${response.status} ${err}`);
            }

            const data = await response.json() as any;
            const message = data.choices?.[0]?.message;
            const textContent = message?.content || '';
            const toolCalls: LLMToolCall[] = (message?.tool_calls || []).map((tc: any) => ({
                name: tc.function?.name || '',
                arguments: this.safeParseJson(tc.function?.arguments),
                id: tc.id,
            }));

            this.recordUsage('ollama', resolvedModel, prompt, data, textContent);
            logger.info(`MultiLLM: Ollama ("${resolvedModel}") returned ${toolCalls.length} tool(s) in ${duration}s.`);
            
            return { content: textContent, toolCalls, raw: data };
        } catch (error: any) {
            clearTimeout(timeoutId);
            clearInterval(heartbeatId);
            throw error;
        }
    }

    private async callOpenAIWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string,
        provider: 'openai' | 'nvidia'
    ): Promise<LLMToolResponse> {
        const apiKey = provider === 'nvidia' ? this.nvidiaKey : this.openaiKey;
        const baseUrl = provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
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
        if (provider === 'nvidia') body.max_tokens = 16384;

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
            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM ${provider} tool call error: ${error}`);
            throw error;
        }
    }

    private async callAnthropicWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        if (!this.anthropicKey) throw new Error('Anthropic API key not configured');
        const resolvedModel = this.normalizeAnthropicModel(model);
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
            let textContent = '';
            const toolCalls: LLMToolCall[] = [];
            for (const block of (data.content || [])) {
                if (block.type === 'text') textContent += block.text;
                else if (block.type === 'tool_use') {
                    toolCalls.push({
                        name: block.name,
                        arguments: block.input || {},
                        id: block.id,
                    });
                }
            }
            this.recordUsage('anthropic', resolvedModel, prompt, data, textContent);
            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM Anthropic tool call error: ${error}`);
            throw error;
        }
    }

    private async callGoogleWithTools(
        prompt: string,
        systemMessage: string,
        tools: LLMToolDefinition[],
        model: string
    ): Promise<LLMToolResponse> {
        if (!this.googleKey) throw new Error('Google API key not configured');
        const fullPrompt = systemMessage ? `System: ${systemMessage}\n\nUser: ${prompt}` : prompt;
        const geminiTools = [{
            functionDeclarations: tools.map(t => ({
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
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text) textContent += part.text;
                if (part.functionCall) {
                    toolCalls.push({
                        name: part.functionCall.name,
                        arguments: part.functionCall.args || {},
                    });
                }
            }
            this.recordUsage('google', model, fullPrompt, data, textContent);
            return { content: textContent, toolCalls, raw: data };
        } catch (error) {
            logger.error(`MultiLLM Google tool call error: ${error}`);
            throw error;
        }
    }

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
                    provider: { require: ['tools'] },
                }),
            });
            if (!response.ok) {
                const err = await response.text();
                if (response.status === 404 && err.includes('tool use')) {
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
            return { content: textContent, toolCalls, raw: data };
        } catch (error: any) {
            if (error?.message?.includes('tool use') && error?.message?.includes('404')) {
                const textResponse = await this.callOpenRouter(prompt, systemMessage, model);
                return { content: textResponse, toolCalls: [] };
            }
            throw error;
        }
    }

    private safeParseJson(str: any): Record<string, any> {
        if (typeof str === 'object' && str !== null) return str;
        if (typeof str !== 'string') return {};
        try {
            return JSON.parse(str);
        } catch {
            return {};
        }
    }

    private getFallbackProvider(primaryProvider: LLMProvider): LLMProvider | null {
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
        const configuredFallback = this.fallbackModelNames?.[provider];
        if (configuredFallback) return configuredFallback;
        switch (provider) {
            case 'openai': return 'gpt-4o';
            case 'google': return 'gemini-flash-lite-latest';
            case 'nvidia': return 'moonshotai/kimi-k2.5';
            case 'openrouter': return 'google/gemini-2.0-flash-exp:free';
            case 'anthropic': return 'claude-sonnet-4-5';
            case 'ollama': return 'llama3';
            case 'bedrock': return this.modelName;
            default: return this.modelName;
        }
    }

    public inferProvider(modelName: string): LLMProvider {
        const lower = (modelName || '').toLowerCase();
        if (lower.startsWith('ollama:') || lower.startsWith('local:') || lower.startsWith('ol:')) return 'ollama';
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

    private normalizeOpenRouterModel(modelName: string): string {
        return modelName.replace(/^openrouter:/i, '').replace(/^openrouter\//i, '').replace(/^or:/i, '');
    }
    private normalizeNvidiaModel(modelName: string): string {
        return modelName.replace(/^nvidia:/i, '').replace(/^nv:/i, '');
    }
    private normalizeAnthropicModel(modelName: string): string {
        return modelName.replace(/^anthropic:/i, '').replace(/^ant:/i, '');
    }
    private normalizeOllamaModel(modelName: string): string {
        return modelName.replace(/^ollama:/i, '').replace(/^local:/i, '');
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
                body: JSON.stringify({ model, messages, temperature: 0.7, stream: true }),
            });
            if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let content = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (!line.trim() || line.startsWith(':') || line === 'data: [DONE]') continue;
                        try {
                            const json = JSON.parse(line.replace(/^data: /, ''));
                            const token = json.choices?.[0]?.delta?.content;
                            if (token) {
                                content += token;
                                eventBus.emitToken(token, { model, provider: 'openai' });
                            }
                        } catch (e) {}
                    }
                }
            }
            this.recordUsage('openai', model, prompt, { choices: [{ message: { content } }] }, content);
            return content;
        } catch (error) {
            throw error;
        }
    }

    private async callAnthropic(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.anthropicKey) throw new Error('Anthropic API key not configured');
        const model = this.normalizeAnthropicModel(modelOverride || this.modelName);
        const body: any = {
            model, max_tokens: 16384,
            messages: [{ role: 'user', content: prompt }],
            stream: true
        };
        if (systemMessage) body.system = [{ type: 'text', text: systemMessage, cache_control: { type: 'ephemeral' } }];

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
            if (!response.ok) throw new Error(`Anthropic API Error: ${response.status}`);

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let content = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith('data: ')) continue;
                        try {
                            const json = JSON.parse(line.replace(/^data: /, ''));
                            if (json.type === 'content_block_delta') {
                                const token = json.delta?.text;
                                if (token) {
                                    content += token;
                                    eventBus.emitToken(token, { model, provider: 'anthropic' });
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
            this.recordUsage('anthropic', model, prompt, { content: [{ type: 'text', text: content }] }, content);
            return content;
        } catch (error) {
            throw error;
        }
    }

    private async callOllama(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        const rawModel = modelOverride || this.modelName;
        const model = this.normalizeOllamaModel(rawModel);
        const baseUrl = (this.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        try {
            const response = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, temperature: 0.7, stream: true }),
            });
            if (!response.ok) throw new Error(`Ollama API Error: ${response.status}`);

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let content = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (!line.trim() || line === 'data: [DONE]') continue;
                        try {
                            const json = JSON.parse(line.replace(/^data: /, ''));
                            const token = json.choices?.[0]?.delta?.content;
                            if (token) {
                                content += token;
                                eventBus.emitToken(token, { model, provider: 'ollama' });
                            }
                        } catch (e) {}
                    }
                }
            }
            this.recordUsage('ollama', model, prompt, { choices: [{ message: { content } }] }, content);
            return content;
        } catch (error) {
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
                body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
            });
            if (!response.ok) throw new Error(`Google API Error: ${response.status}`);
            const data = await response.json() as any;
            const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            this.recordUsage('google', model, fullPrompt, data, textOut);
            return textOut;
        } catch (error) {
            throw error;
        }
    }

    private async callNvidia(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.nvidiaKey) throw new Error('NVIDIA API key not configured');
        const model = this.normalizeNvidiaModel(modelOverride || this.modelName);
        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });
        try {
            const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.nvidiaKey}`,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ model, messages, max_tokens: 16384, temperature: 0.7, stream: false }),
            });
            if (!response.ok) throw new Error(`NVIDIA API Error: ${response.status}`);
            const data = await response.json() as any;
            const content = data?.choices?.[0]?.message?.content || '';
            this.recordUsage('nvidia', model, prompt, data, content);
            return content;
        } catch (error) {
            throw error;
        }
    }

    private async callOpenRouter(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        if (!this.openrouterKey) throw new Error('OpenRouter API key not configured');
        const model = this.normalizeOpenRouterModel(modelOverride || this.modelName);
        const base = this.openrouterBaseUrl.replace(/\/+$/, '');
        const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openrouterKey}` },
                body: JSON.stringify({ model, messages, temperature: 0.7 })
            });
            if (!response.ok) throw new Error(`OpenRouter API Error: ${response.status}`);
            const data = await response.json() as any;
            const content = data?.choices?.[0]?.message?.content || '';
            this.recordUsage('openrouter', model, prompt, data, content);
            return content;
        } catch (error) {
            throw error;
        }
    }

    private async callBedrock(prompt: string, systemMessage?: string, modelOverride?: string): Promise<string> {
        const modelId = modelOverride || this.modelName;
        if (!this.bedrockRegion) throw new Error('Bedrock region not configured');
        const body = {
            messages: [systemMessage ? { role: 'user', content: [{ type: 'text', text: `${systemMessage}\n\n${prompt}` }] } : { role: 'user', content: [{ type: 'text', text: prompt }] }],
            max_tokens: 1024, temperature: 0.7
        };
        const client = this.getBedrockClient();
        const command = new InvokeModelCommand({ modelId, body: JSON.stringify(body), contentType: 'application/json', accept: 'application/json' });
        try {
            const response = await client.send(command);
            const decoded = new TextDecoder().decode(response.body as Uint8Array);
            const data = JSON.parse(decoded);
            const textOut = data.output?.message?.content?.find((p: any) => p.text)?.text || data.outputText || JSON.stringify(data);
            this.recordUsage('bedrock', modelId, prompt, data, textOut);
            return textOut;
        } catch (error) {
            throw error;
        }
    }

    private recordUsage(provider: LLMProvider, model: string, prompt: string, data: any, completionText?: string) {
        if (!this.tokenTracker) return;
        let pt = 0, ct = 0, tt = 0, est = true;
        if ((provider === 'openai' || provider === 'openrouter' || provider === 'nvidia') && data?.usage) {
            pt = data.usage.prompt_tokens; ct = data.usage.completion_tokens || 0; tt = data.usage.total_tokens || (pt + ct); est = false;
        } else if (provider === 'google' && data?.usageMetadata) {
            pt = data.usageMetadata.promptTokenCount; ct = data.usageMetadata.candidatesTokenCount || 0; tt = data.usageMetadata.totalTokenCount || (pt + ct); est = false;
        } else if (provider === 'anthropic' && data?.usage) {
            pt = data.usage.input_tokens; ct = data.usage.output_tokens || 0; tt = pt + ct; est = false;
        }
        if (est) {
            pt = this.estimateTokens(prompt); ct = this.estimateTokens(completionText || ''); tt = pt + ct;
        }
        this.tokenTracker.record({ ts: new Date().toISOString(), provider, model, promptTokens: pt, completionTokens: ct, totalTokens: tt, metadata: { estimated: est } });
    }

    private estimateTokens(text: string): number {
        if (!text) return 0;
        let tokens = 0;
        const chunks = text.split(/\s+/).filter(c => c.length > 0);
        for (const chunk of chunks) {
            if (chunk.length <= 4) tokens += 1;
            else if (chunk.length <= 10) tokens += Math.ceil(chunk.length / 5);
            else tokens += Math.ceil(chunk.length / 4.5);
        }
        return Math.max(1, Math.ceil(tokens + (text.match(/\n/g) || []).length));
    }

    public async textToSpeech(text: string, outputPath: string, voice?: string, speed: number = 1.0): Promise<string> {
        const primaryProvider = this.preferredProvider || this.inferProvider(this.modelName);
        if (primaryProvider === 'google' && this.googleKey) return this.textToSpeechGoogle(text, outputPath, voice);
        if (!this.openaiKey) throw new Error('OpenAI API key not configured — required for TTS');
        const selectedVoice = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voice || '') ? voice : 'nova';
        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiKey}` },
                body: JSON.stringify({ model: 'tts-1', input: text, voice: selectedVoice, response_format: 'opus', speed: Math.max(0.25, Math.min(4.0, speed)) })
            });
            if (!response.ok) throw new Error(`OpenAI TTS Error: ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(outputPath, buffer);
            return outputPath;
        } catch (error) {
            throw error;
        }
    }

    private async textToSpeechGoogle(text: string, outputPath: string, voice?: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured — required for TTS');
        const selectedVoice = voice || 'kore';
        const body = { model: 'gemini-2.5-flash-preview-tts', input: text, response_modalities: ['AUDIO'], generation_config: { speech_config: { language: 'en-us', voice: selectedVoice } } };
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.googleKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`Google TTS Error: ${response.status}`);
            const data: any = await response.json();
            const base64 = data?.outputs?.find((o: any) => o?.type === 'audio')?.data;
            if (!base64) throw new Error('Google TTS Error: No audio data');
            const wavPath = outputPath.toLowerCase().endsWith('.wav') ? outputPath : outputPath + '.wav';
            const dir = path.dirname(wavPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            this.writeWavFile(Buffer.from(base64, 'base64'), wavPath, 24000, 1, 16);
            return wavPath;
        } catch (error) {
            throw error;
        }
    }

    private writeWavFile(pcmData: Buffer, outputPath: string, sampleRate: number, channels: number, bitDepth: number): void {
        const header = Buffer.alloc(44);
        header.write('RIFF', 0); header.writeUInt32LE(36 + pcmData.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); header.writeUInt16LE(channels * (bitDepth / 8), 32); header.writeUInt16LE(bitDepth, 34);
        header.write('data', 36); header.writeUInt32LE(pcmData.length, 40);
        fs.writeFileSync(outputPath, Buffer.concat([header, pcmData]));
    }

    public async analyzeMedia(filePath: string, prompt: string): Promise<string> {
        return this.inferProvider(this.modelName) === 'google' ? this.analyzeMediaGoogle(filePath, prompt) : this.analyzeMediaOpenAI(filePath, prompt);
    }

    public async analyzeMediaWithModel(filePath: string, prompt: string, modelName: string): Promise<string> {
        const p = this.inferProvider(modelName);
        if (p === 'google') return this.analyzeMediaGoogle(filePath, prompt, modelName);
        if (p === 'openai') return this.analyzeMediaOpenAI(filePath, prompt);
        return this.analyzeMedia(filePath, prompt);
    }

    private async analyzeMediaGoogle(filePath: string, prompt: string, modelOverride?: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured');
        const model = modelOverride || 'gemini-2.5-flash';
        const body = { contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: getAudioHelperMimeType(filePath), data: fs.readFileSync(filePath).toString('base64') } }] }], ...(model.includes('computer-use') ? { tools: [{ computer_use: {} }] } : {}) };
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`Google Media Error: ${response.status}`);
            const data = await response.json() as any;
            return data.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || JSON.stringify(data.candidates?.[0]?.content?.parts?.[0]);
        } catch (error) {
            throw error;
        }
    }

    private async analyzeMediaOpenAI(filePath: string, prompt: string): Promise<string> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');
        const ext = path.extname(filePath).toLowerCase().substring(1);
        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiKey}` }, body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/${ext};base64,${fs.readFileSync(filePath).toString('base64')}` } }] }] }) });
            const data = await response.json() as any; return data.choices[0].message.content;
        } else if (isAudioFile(filePath)) {
            const compatiblePath = await convertToWhisperCompatible(filePath);
            const formData = new FormData(); formData.append('file', new Blob([fs.readFileSync(compatiblePath)]), path.basename(compatiblePath)); formData.append('model', 'whisper-1');
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': `Bearer ${this.openaiKey}` }, body: formData });
            const data = await response.json() as any; return `Transcription: ${data.text}`;
        }
        return this.call(`${prompt}\n\n[FILE]: ${fs.readFileSync(filePath, 'utf8').substring(0, 15000)}`);
    }

    private getPiAIOptions(modelOverride?: string, providerOverride?: LLMProvider): PiAIAdapterOptions {
        return { provider: providerOverride ?? 'auto', model: modelOverride || this.modelName, apiKeys: { openai: this.openaiKey, google: this.googleKey, anthropic: this.anthropicKey, openrouter: this.openrouterKey, nvidia: this.nvidiaKey, bedrockAccessKeyId: this.bedrockAccessKeyId, bedrockSecretAccessKey: this.bedrockSecretAccessKey, bedrockRegion: this.bedrockRegion, bedrockSessionToken: this.bedrockSessionToken, groq: this.groqKey, mistral: this.mistralKey, cerebras: this.cerebrasKey, xai: this.xaiKey, huggingface: this.huggingfaceKey, kimi: this.kimiKey, minimax: this.minimaxKey, zai: this.zaiKey, perplexity: this.perplexityKey, deepseek: this.deepseekKey, opencode: this.opencodeKey, azureEndpoint: this.azureEndpoint, googleProjectId: this.googleProjectId, googleLocation: this.googleLocation } };
    }

    public async piAiLogin(providerKey: string): Promise<void> { await piAiLogin(providerKey); }
    public isPiAiLinked(providerKey: string): boolean { return isPiAiLinked(providerKey); }
    public async getPiAICatalogue() {
        const providers = await getPiProviders(); const cat: any = {};
        for (const p of providers) {
            const models = await getPiModels(p); if (!models?.length) continue;
            cat[p] = { label: p, models: models.map(m => ({ id: m.id, note: `${m.contextWindow ? Math.round(m.contextWindow/1024)+'k' : ''}` })) };
        }
        return cat;
    }

    public setModel(modelName: string): void {
        this.modelName = modelName;
        logger.info(`MultiLLM: Model changed to ${modelName}`);
    }

    public getModelAvailabilitySummary(): string {
        const providers = [];
        if (this.openaiKey && !this.openaiKey.startsWith('your_')) providers.push('OpenAI');
        if (this.googleKey && !this.googleKey.startsWith('your_')) providers.push('Google (Gemini)');
        if (this.anthropicKey && !this.anthropicKey.startsWith('your_')) providers.push('Anthropic (Claude)');
        if (this.nvidiaKey && !this.nvidiaKey.startsWith('your_')) providers.push('NVIDIA');
        if (this.openrouterKey && !this.openrouterKey.startsWith('your_')) providers.push('OpenRouter');
        if (this.ollamaUrl) providers.push('Ollama (Local)');
        
        return `Active Model: ${this.modelName}\nAvailable Providers: ${providers.join(', ') || 'None configured'}`;
    }

    public async generateImage(prompt: string, outputPath: string, options?: { size?: string, quality?: string, provider?: LLMProvider, model?: string }): Promise<{ success: boolean; filePath?: string; revisedPrompt?: string; error?: string }> {
        const provider = options?.provider || this.preferredProvider || 'openai';
        
        try {
            if (provider === 'google') {
                if (!this.googleKey) return { success: false, error: 'Google API key not configured' };
                const model = options?.model || 'gemini-2.5-flash-image';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseModalities: ["IMAGE"]
                        }
                    }),
                });

                if (!response.ok) {
                    const err = await response.text();
                    return { success: false, error: `Google API Error: ${response.status} ${err}` };
                }

                const data = await response.json() as any;
                const parts = data.candidates?.[0]?.content?.parts || [];
                const imagePart = parts.find((p: any) => p.inlineData || p.inline_data);
                const inlineData = imagePart?.inlineData || imagePart?.inline_data;
                const base64Image = inlineData?.data;
                
                if (!base64Image) return { success: false, error: 'No image returned from Google' };

                const buffer = Buffer.from(base64Image, 'base64');
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(outputPath, buffer);

                return { success: true, filePath: outputPath };
            } else if (provider === 'openai') {
                const model = options?.model || 'dall-e-3';
                if (!this.openaiKey) return { success: false, error: 'OpenAI API key not configured' };
                
                const response = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        prompt,
                        n: 1,
                        size: options?.size || '1024x1024',
                        quality: options?.quality || 'standard',
                    }),
                });

                if (!response.ok) {
                    const err = await response.text();
                    return { success: false, error: `OpenAI API Error: ${response.status} ${err}` };
                }

                const data = await response.json() as any;
                const imageUrl = data.data?.[0]?.url;
                const revisedPrompt = data.data?.[0]?.revised_prompt;
                
                if (!imageUrl) return { success: false, error: 'No image URL returned from OpenAI' };

                const imageResponse = await fetch(imageUrl);
                const buffer = Buffer.from(await imageResponse.arrayBuffer());
                
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(outputPath, buffer);

                return { success: true, filePath: outputPath, revisedPrompt };
            } else {
                return { success: false, error: `Image generation is not yet implemented for provider ${provider} in MultiLLM.` };
            }
        } catch (error: any) {
            logger.error(`MultiLLM: Image generation failed: ${error}`);
            return { success: false, error: error.message || String(error) };
        }
    }

    private getBedrockClient() { return new BedrockRuntimeClient({ region: this.bedrockRegion!, credentials: this.bedrockAccessKeyId && this.bedrockSecretAccessKey ? { accessKeyId: this.bedrockAccessKeyId, secretAccessKey: this.bedrockSecretAccessKey, sessionToken: this.bedrockSessionToken } : undefined }); }
}
