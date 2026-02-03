import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import fs from 'fs';
import path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TokenTracker } from './TokenTracker';

export type LLMProvider = 'openai' | 'google' | 'bedrock' | 'openrouter' | 'nvidia';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class MultiLLM {
    private openaiKey: string | undefined;
    private openrouterKey: string | undefined;
    private openrouterBaseUrl: string;
    private openrouterReferer?: string;
    private openrouterAppName?: string;
    private googleKey: string | undefined;
    private nvidiaKey: string | undefined;
    private modelName: string;
    private bedrockRegion?: string;
    private bedrockAccessKeyId?: string;
    private bedrockSecretAccessKey?: string;
    private bedrockSessionToken?: string;
    private tokenTracker?: TokenTracker;
    private preferredProvider?: LLMProvider;

    constructor(config?: { apiKey?: string, googleApiKey?: string, nvidiaApiKey?: string, modelName?: string, bedrockRegion?: string, bedrockAccessKeyId?: string, bedrockSecretAccessKey?: string, bedrockSessionToken?: string, tokenTracker?: TokenTracker, openrouterApiKey?: string, openrouterBaseUrl?: string, openrouterReferer?: string, openrouterAppName?: string, llmProvider?: LLMProvider }) {
        this.openaiKey = config?.apiKey || process.env.OPENAI_API_KEY;
        this.openrouterKey = config?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
        this.openrouterBaseUrl = config?.openrouterBaseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
        this.openrouterReferer = config?.openrouterReferer || process.env.OPENROUTER_REFERER;
        this.openrouterAppName = config?.openrouterAppName || process.env.OPENROUTER_APP_NAME;
        this.googleKey = config?.googleApiKey || process.env.GOOGLE_API_KEY;
        this.nvidiaKey = config?.nvidiaApiKey || process.env.NVIDIA_API_KEY;
        this.modelName = config?.modelName || 'gpt-4o';
        this.bedrockRegion = config?.bedrockRegion || process.env.BEDROCK_REGION || process.env.AWS_REGION;
        this.bedrockAccessKeyId = config?.bedrockAccessKeyId || process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
        this.bedrockSecretAccessKey = config?.bedrockSecretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
        this.bedrockSessionToken = config?.bedrockSessionToken || process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;
        this.tokenTracker = config?.tokenTracker;
        this.preferredProvider = config?.llmProvider;

        logger.info(`MultiLLM: Initialized with model ${this.modelName}`);
    }

    public async call(prompt: string, systemMessage?: string, provider?: LLMProvider, modelOverride?: string): Promise<string> {
        const primaryProvider = provider || this.preferredProvider || this.inferProvider(modelOverride || this.modelName);
        
        // Build fallback chain: try all available providers
        const fallbackProvider = this.getFallbackProvider(primaryProvider);

        const executeCall = async (p: LLMProvider, m?: string) => {
            if (p === 'openai') return this.callOpenAI(prompt, systemMessage, m);
            if (p === 'google') return this.callGoogle(prompt, systemMessage, m);
            if (p === 'bedrock') return this.callBedrock(prompt, systemMessage, m);
            if (p === 'openrouter') return this.callOpenRouter(prompt, systemMessage, m);
            if (p === 'nvidia') return this.callNvidia(prompt, systemMessage, m);
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

    private getFallbackProvider(primaryProvider: LLMProvider): LLMProvider | null {
        // Priority order for fallbacks based on what's configured
        const fallbackOrder: LLMProvider[] = ['openai', 'google', 'nvidia', 'openrouter', 'bedrock'];
        
        for (const provider of fallbackOrder) {
            if (provider === primaryProvider) continue;
            
            if (provider === 'openai' && this.openaiKey) return 'openai';
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

    private async analyzeMediaGoogle(filePath: string, prompt: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        const buffer = fs.readFileSync(filePath);
        const mimeType = this.getMimeType(filePath);
        const base64Data = buffer.toString('base64');

        // Use flash for analysis as it's faster and cheaper
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.googleKey}`;

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

    private inferProvider(modelName: string): LLMProvider {
        const lower = modelName.toLowerCase();
        if (lower.includes('bedrock') || lower.startsWith('br:')) return 'bedrock';
        if (lower.includes('gemini')) return 'google';
        if (lower.includes('nvidia') || lower.startsWith('nv:') || lower.startsWith('nvidia:')) return 'nvidia';
        if (lower.startsWith('openrouter:') || lower.startsWith('openrouter/') || lower.startsWith('or:')) return 'openrouter';
        return 'openai';
    }

    private normalizeOpenRouterModel(modelName: string): string {
        return modelName
            .replace(/^openrouter:/i, '')
            .replace(/^openrouter\//i, '')
            .replace(/^or:/i, '');
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

        const model = modelOverride || this.modelName;

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
                    temperature: 1.00,
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

    private recordUsage(provider: LLMProvider, model: string, prompt: string, data: any, completionText?: string) {
        if (!this.tokenTracker) return;

        const promptTokensEstimate = this.estimateTokens(prompt);
        const completionTokensEstimate = this.estimateTokens(completionText || '');

        let promptTokens = promptTokensEstimate;
        let completionTokens = completionTokensEstimate;
        let totalTokens = promptTokens + completionTokens;

        if ((provider === 'openai' || provider === 'openrouter' || provider === 'nvidia') && data?.usage) {
            promptTokens = data.usage.prompt_tokens ?? promptTokens;
            completionTokens = data.usage.completion_tokens ?? completionTokens;
            totalTokens = data.usage.total_tokens ?? (promptTokens + completionTokens);
        }

        if (provider === 'google' && data?.usageMetadata) {
            promptTokens = data.usageMetadata.promptTokenCount ?? promptTokens;
            completionTokens = data.usageMetadata.candidatesTokenCount ?? completionTokens;
            totalTokens = data.usageMetadata.totalTokenCount ?? (promptTokens + completionTokens);
        }

        if (provider === 'bedrock') {
            const usage = data?.usage || data?.Usage || {};
            const inputTokens = usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens;
            const outputTokens = usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens;
            if (inputTokens !== undefined) promptTokens = inputTokens;
            if (outputTokens !== undefined) completionTokens = outputTokens;
            totalTokens = usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens);
        }

        const estimated = (provider === 'openai' && !data?.usage) ||
            (provider === 'nvidia' && !data?.usage) ||
            (provider === 'google' && !data?.usageMetadata) ||
            (provider === 'bedrock' && !data?.usage);

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

    private estimateTokens(text: string): number {
        if (!text) return 0;
        // Rough heuristic: ~4 chars per token
        return Math.ceil(text.length / 4);
    }
}
