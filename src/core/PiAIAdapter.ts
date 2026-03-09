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

import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import readline from 'readline';
import { logger } from '../utils/logger';
import type { LLMToolDefinition, LLMToolResponse } from './MultiLLM';

// ── Dynamic import guards ──
// pi-ai is an optional peer — we catch import errors so OrcBot degrades
// gracefully when the package is missing or the env doesn't support it.
let piAiLoaded = false;
let getModel: any = null;
let complete: any = null;
let getProviders: any = null;
let getModels: any = null;
let getOAuthApiKey: any = null;
let loginAnthropic: any = null;
let loginAntigravity: any = null;
let loginGeminiCli: any = null;
let loginGitHubCopilot: any = null;
let loginOpenAICodex: any = null;

async function ensurePiAi(): Promise<boolean> {
    if (piAiLoaded) return true;
    try {
        const mod = await import('@mariozechner/pi-ai');
        getModel = mod.getModel;
        complete = mod.complete;
        getProviders = mod.getProviders;
        getModels = mod.getModels;
        getOAuthApiKey = mod.getOAuthApiKey;
        loginAnthropic = mod.loginAnthropic;
        loginAntigravity = mod.loginAntigravity;
        loginGeminiCli = mod.loginGeminiCli;
        loginGitHubCopilot = mod.loginGitHubCopilot;
        loginOpenAICodex = mod.loginOpenAICodex;
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

function cloneToolSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;

    const cloned: any = {};

    for (const key of ['type', 'description', 'title', 'format', 'default', 'enum', 'const', 'nullable']) {
        if (schema[key] !== undefined) cloned[key] = schema[key];
    }

    if (schema.properties && typeof schema.properties === 'object') {
        cloned.properties = Object.fromEntries(
            Object.entries(schema.properties).map(([propName, propSchema]) => [propName, cloneToolSchema(propSchema)])
        );
    }

    if (Array.isArray(schema.required)) {
        cloned.required = [...schema.required];
    }

    if (schema.items !== undefined) {
        cloned.items = Array.isArray(schema.items)
            ? schema.items.map((item: any) => cloneToolSchema(item))
            : cloneToolSchema(schema.items);
    }

    if (schema.additionalProperties !== undefined) {
        cloned.additionalProperties = typeof schema.additionalProperties === 'object'
            ? cloneToolSchema(schema.additionalProperties)
            : schema.additionalProperties;
    }

    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(schema[key])) {
            cloned[key] = schema[key].map((item: any) => cloneToolSchema(item));
        }
    }

    return cloned;
}

/** Converts OrcBot LLMToolDefinition[] to pi-ai Tool[] */
function topiTools(tools: LLMToolDefinition[]): any[] {
    return tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: cloneToolSchema(t.function.parameters),
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
        huggingface?: string;
        kimi?: string;
        minimax?: string;
        zai?: string;
        perplexity?: string;
        deepseek?: string;
        opencode?: string;
        azureEndpoint?: string;
        googleProjectId?: string;
        googleLocation?: string;
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

    const piProvider = resolvePiProvider(opts.provider, opts.model, opts.apiKeys);
    const piModel = normalizePiModel(opts.model);
    const apiCreds = await resolveApiCredentials(piProvider, opts.apiKeys);

    let model: any;
    try {
        model = getModel(piProvider, piModel);
        if (!model) {
            throw new Error(`getModel returned undefined for ${piProvider}/${piModel}`);
        }
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
    if (apiCreds.apiKey) callOpts.apiKey = apiCreds.apiKey;
    if (apiCreds.baseUrl) callOpts.baseUrl = apiCreds.baseUrl;
    if (apiCreds.project) callOpts.project = apiCreds.project;
    if (apiCreds.location) callOpts.location = apiCreds.location;

    const response = await complete(model, context, callOpts);
    return extractPiAiText(response);
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

    const piProvider = resolvePiProvider(opts.provider, opts.model, opts.apiKeys);
    const piModel = normalizePiModel(opts.model);
    const apiCreds = await resolveApiCredentials(piProvider, opts.apiKeys);

    let model: any;
    try {
        model = getModel(piProvider, piModel);
        if (!model) {
            throw new Error(`getModel returned undefined for ${piProvider}/${piModel}`);
        }
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
    if (apiCreds.apiKey) callOpts.apiKey = apiCreds.apiKey;
    if (apiCreds.baseUrl) callOpts.baseUrl = apiCreds.baseUrl;
    if (apiCreds.project) callOpts.project = apiCreds.project;
    if (apiCreds.location) callOpts.location = apiCreds.location;

    try {
        const response = await complete(model, context, callOpts);

        return {
            content: extractPiAiText(response),
            toolCalls: extractPiAiToolCalls(response),
            raw: response,
        };
    } catch (e) {
        logger.error(`PiAIAdapter: complete() crashed for provider=${piProvider}, model=${piModel}. Error: ${(e as Error).message}`);
        // Log keys being used (masking for safety)
        const maskedKey = apiCreds.apiKey ? `${apiCreds.apiKey.slice(0, 4)}...${apiCreds.apiKey.slice(-4)}` : 'MISSING';
        logger.error(`PiAIAdapter: Context info — API Key: ${maskedKey}, BaseURL: ${apiCreds.baseUrl || 'default'}`);
        throw e;
    }
}

/** Centralized text extraction from PI AI response, handling text, thinking, and errors. */
function extractPiAiText(response: any): string {
    if (response.errorMessage) {
        throw new Error(`PiAI Model Error: ${response.errorMessage}`);
    }

    const content = response.content || [];

    // Combine text and thinking blocks. 
    // We wrap thinking in tags to preserve the model's reasoning for OrcBot's internal processing.
    const parts = content.map((block: any) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'thinking') return `\n<thinking>\n${block.thinking}\n</thinking>\n`;
        return '';
    });

    const text = parts.join('').trim();

    if (!text && !content.some((b: any) => b.type === 'toolCall')) {
        if (response.stopReason === 'length') {
            logger.warn('PiAIAdapter: Model response truncated due to length.');
        } else if (response.stopReason === 'error') {
            logger.error('PiAIAdapter: Model reported an unspecified error.');
        } else {
            logger.debug(`PiAIAdapter: Empty response received (stopReason: ${response.stopReason})`);
        }
    }

    return text;
}

/** Standardized tool call extraction from PI AI response. */
function extractPiAiToolCalls(response: any): LLMToolResponse['toolCalls'] {
    const content = response.content || [];
    return content
        .filter((b: any) => b.type === 'toolCall')
        .map((b: any) => ({
            id: b.id,
            name: b.name,
            arguments: b.arguments,
        }));
}

/**
 * Prefer cached pi-ai OAuth providers when no direct API key is configured.
 * This avoids forcing OPENAI_API_KEY for users who completed the interactive
 * OpenAI Codex / ChatGPT auth flow via pi-ai.
 */
function resolvePiProvider(provider: string, model: string, keys: PiAIAdapterOptions['apiKeys']): string {
    const inferredProvider = toPiProvider(provider, model);

    if (inferredProvider === 'openai' && !keys.openai && isPiAiLinked('openai-codex')) {
        return 'openai-codex';
    }

    if (inferredProvider === 'google' && !keys.google) {
        if (isPiAiLinked('google-gemini-cli')) return 'google-gemini-cli';
        if (isPiAiLinked('google-antigravity')) return 'google-antigravity';
    }

    if (inferredProvider === 'anthropic' && !keys.anthropic && isPiAiLinked('anthropic')) {
        return 'anthropic';
    }

    return inferredProvider;
}

/** Resolve the right API key or credentials for a pi-ai provider name */
async function resolveApiCredentials(piProvider: string, keys: PiAIAdapterOptions['apiKeys']): Promise<{ apiKey?: string; baseUrl?: string; project?: string; location?: string }> {
    switch (piProvider) {
        case 'openai': return { apiKey: keys.openai };
        case 'google': return { apiKey: keys.google };
        case 'anthropic': return { apiKey: keys.anthropic };
        case 'openrouter': return { apiKey: keys.openrouter || keys.nvidia };
        case 'amazon-bedrock': return {}; // Bedrock uses env-based AWS credentials
        case 'groq': return { apiKey: keys.groq };
        case 'mistral': return { apiKey: keys.mistral };
        case 'cerebras': return { apiKey: keys.cerebras };
        case 'xai': return { apiKey: keys.xai };
        case 'huggingface': return { apiKey: keys.huggingface };
        case 'kimi-coding': return { apiKey: keys.kimi };
        case 'minimax':
        case 'minimax-cn':
            return { apiKey: keys.minimax };
        case 'zai': return { apiKey: keys.zai };
        case 'perplexity': return { apiKey: keys.perplexity };
        case 'deepseek': return { apiKey: keys.deepseek };
        case 'opencode': return { apiKey: keys.opencode };
        case 'azure-openai-responses':
            return { apiKey: keys.openai, baseUrl: keys.azureEndpoint };
        case 'google-vertex':
            return { project: keys.googleProjectId, location: keys.googleLocation };
        case 'google-antigravity':
        case 'google-gemini-cli':
        case 'github-copilot':
        case 'openai-codex':
            return { apiKey: await loadOAuthApiKey(piProvider) };
        default: return { apiKey: keys.openai };
    }
}

async function loadOAuthApiKey(providerKey: string): Promise<string | undefined> {
    try {
        if (!fs.existsSync(PI_AI_AUTH)) return undefined;

        const rawAuth = JSON.parse(fs.readFileSync(PI_AI_AUTH, 'utf8'));
        if (!rawAuth?.[providerKey]) return undefined;

        const normalizedAuth: Record<string, any> = { ...rawAuth };
        const providerCreds = normalizedAuth[providerKey];

        if (providerCreds && !providerCreds.type) {
            normalizedAuth[providerKey] = { type: 'oauth', ...providerCreds };
        }

        if (getOAuthApiKey) {
            const result = await getOAuthApiKey(providerKey, normalizedAuth);
            if (result?.apiKey) {
                normalizedAuth[providerKey] = { type: 'oauth', ...result.newCredentials };
                fs.writeFileSync(PI_AI_AUTH, JSON.stringify(normalizedAuth, null, 2), 'utf8');
                return result.apiKey;
            }
        }

        return providerCreds.access || providerCreds.apiKey;
    } catch (e) {
        logger.error(`PiAIAdapter: Failed to load OAuth API key for ${providerKey} — ${(e as Error).message}`);
        return undefined;
    }
}

export async function getPiProviders(): Promise<string[]> {
    if (!(await ensurePiAi())) return [];
    return getProviders();
}

export async function getPiModels(provider: string): Promise<any[]> {
    if (!(await ensurePiAi())) return [];
    return getModels(provider);
}

/** Triggers an interactive OAuth login flow for certain providers. */
export async function piAiLogin(providerKey: string): Promise<void> {
    if (!(await ensurePiAi())) return;

    logger.info(`PiAIAdapter: Triggering login for ${providerKey}`);

    const onAuth = (opts: any) => {
        const url = typeof opts === 'string' ? opts : opts.url;
        console.log('\n\n' + '  '.repeat(1) + '🔑 Authorization Required');
        console.log('  '.repeat(1) + `URL: ${url}`);
        if (opts.devCode) console.log('  '.repeat(1) + `Device Code: ${opts.devCode}`);
        if (opts.instructions) console.log('  '.repeat(1) + `Instructions: ${opts.instructions}`);
        console.log('  '.repeat(1) + 'If this OrcBot instance is running on a server, finish login in your browser and then paste the FULL redirect URL or auth code back into the terminal when prompted.');
        console.log('\n  Opening browser for authorization...\n');

        const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} "${url}"`, (error) => {
            if (error) {
                logger.warn(`PiAIAdapter: Failed to auto-open browser for ${providerKey} — ${error.message}`);
            }
        });
    };

    const onProgress = (msg: string) => logger.info(`PiAIAdapter: ${msg}`);
    const onPrompt = async (prompt: { message: string }) => promptForOAuthInput(providerKey, prompt.message);
    const onManualCodeInput = async () => promptForOAuthInput(
        providerKey,
        'Paste the FULL redirect URL from the browser address bar, or just the authorization code'
    );

    try {
        let creds: any = null;
        switch (providerKey) {
            case 'anthropic':
                if (loginAnthropic) creds = await loginAnthropic((url: string) => onAuth(url), () => onPrompt({ message: 'Paste the device code shown in the browser flow' }));
                break;
            case 'google-antigravity':
                if (loginAntigravity) creds = await loginAntigravity(onAuth, onProgress, onManualCodeInput);
                break;
            case 'google-gemini-cli':
                if (loginGeminiCli) creds = await loginGeminiCli(onAuth, onProgress, onManualCodeInput);
                break;
            case 'github-copilot':
                if (loginGitHubCopilot) creds = await loginGitHubCopilot({ onAuth, onPrompt, onProgress, onManualCodeInput });
                break;
            case 'openai-codex':
                if (loginOpenAICodex) creds = await loginOpenAICodex({ onAuth, onPrompt, onProgress, onManualCodeInput });
                break;
            default:
                logger.warn(`PiAIAdapter: No login handler for ${providerKey}`);
        }

        if (creds) {
            savePiAiAuth(providerKey, creds);
            logger.info(`PiAIAdapter: Saved credentials for ${providerKey}`);
            console.log(`\nSaved OAuth credentials for ${providerKey} to ${PI_AI_AUTH}`);
            console.log(`You can now use ${providerKey} from this OrcBot instance.\n`);
        } else {
            console.log(`\nOAuth login for ${providerKey} did not return credentials.\n`);
        }
    } catch (e) {
        logger.error(`PiAIAdapter: Login failed — ${(e as Error).message}`);
        console.error(`\nOAuth login failed for ${providerKey}: ${(e as Error).message}\n`);
    }
}

function canPromptForOAuthInput(): boolean {
    return !!process.stdin?.isTTY && !!process.stdout?.isTTY;
}

async function promptForOAuthInput(providerKey: string, message: string): Promise<string> {
    if (!canPromptForOAuthInput()) {
        throw new Error(
            `OAuth login for ${providerKey} requires manual redirect/code input, but this OrcBot process has no interactive terminal. Run the login from an attached terminal, or complete the OAuth flow on the same host that owns the localhost callback.`
        );
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        const answer = await new Promise<string>((resolve) => {
            rl.question(`\n${message}: `, resolve);
        });
        return answer.trim();
    } finally {
        rl.close();
    }
}

const PI_AI_DIR = path.join(os.homedir(), '.pi-ai');
const PI_AI_AUTH = path.join(PI_AI_DIR, 'auth.json');

function savePiAiAuth(providerKey: string, credentialsJson: string) {
    try {
        let existing: Record<string, any> = {};
        if (fs.existsSync(PI_AI_AUTH)) {
            existing = JSON.parse(fs.readFileSync(PI_AI_AUTH, 'utf8'));
        }

        // Some login functions return a JSON string, others might return an object
        const creds = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;

        existing[providerKey] = { type: 'oauth', ...creds };

        if (!fs.existsSync(PI_AI_DIR)) {
            fs.mkdirSync(PI_AI_DIR, { recursive: true });
        }
        fs.writeFileSync(PI_AI_AUTH, JSON.stringify(existing, null, 2), 'utf8');
    } catch (e) {
        logger.error(`PiAIAdapter: Failed to save auth — ${(e as Error).message}`);
    }
}

/** Check if a provider has active credentials in the pi-ai cache. */
export function isPiAiLinked(providerKey: string): boolean {
    try {
        if (!fs.existsSync(PI_AI_AUTH)) return false;
        const auth = JSON.parse(fs.readFileSync(PI_AI_AUTH, 'utf8'));
        return !!auth[providerKey];
    } catch (e) {
        return false;
    }
}

export const __test__ = {
    cloneToolSchema,
    topiTools,
    normalizePiModel,
    toPiProvider,
};
