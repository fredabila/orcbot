import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import fs from 'fs';
import path from 'path';

export type LLMProvider = 'openai' | 'google';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class MultiLLM {
    private openaiKey: string | undefined;
    private googleKey: string | undefined;
    private modelName: string;

    constructor(config?: { apiKey?: string, googleApiKey?: string, modelName?: string }) {
        this.openaiKey = config?.apiKey || process.env.OPENAI_API_KEY;
        this.googleKey = config?.googleApiKey || process.env.GOOGLE_API_KEY;
        this.modelName = config?.modelName || 'gpt-4o';

        logger.info(`MultiLLM: Initialized with model ${this.modelName}`);
    }

    public async call(prompt: string, systemMessage?: string, provider?: LLMProvider, modelOverride?: string): Promise<string> {
        const primaryProvider = provider || this.inferProvider(modelOverride || this.modelName);
        const fallbackProvider: LLMProvider | null = (primaryProvider === 'google' && this.openaiKey) ? 'openai' :
            (primaryProvider === 'openai' && this.googleKey) ? 'google' : null;

        const executeCall = async (p: LLMProvider, m?: string) => {
            if (p === 'openai') return this.callOpenAI(prompt, systemMessage, m);
            if (p === 'google') return this.callGoogle(prompt, systemMessage, m);
            throw new Error(`Provider ${p} not supported`);
        };

        const primaryModel = modelOverride || this.modelName;

        return ErrorHandler.withFallback(
            () => ErrorHandler.withRetry(() => executeCall(primaryProvider, primaryModel), { maxRetries: 2 }),
            async () => {
                if (!fallbackProvider) throw new Error(`Primary provider (${primaryProvider}) failed and no fallback available.`);

                const fallbackModel = (fallbackProvider === 'openai') ? 'gpt-4o' : 'gemini-1.5-flash';
                logger.info(`MultiLLM: Falling back from ${primaryProvider} to ${fallbackProvider} (Using model: ${fallbackModel})`);

                return ErrorHandler.withRetry(() => executeCall(fallbackProvider, fallbackModel), { maxRetries: 1 });
            }
        );
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
            if (data.candidates && data.candidates[0].content) {
                return data.candidates[0].content.parts[0].text;
            }
            throw new Error('No analytical content in Gemini response');
        } catch (error) {
            logger.error(`MultiLLM Google Media Error: ${error}`);
            throw error;
        }
    }

    private async analyzeMediaOpenAI(filePath: string, prompt: string): Promise<string> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');

        const ext = path.extname(filePath).toLowerCase().substring(1);
        const mimeType = this.getMimeType(filePath);

        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            const buffer = fs.readFileSync(filePath);
            const base64Data = buffer.toString('base64');

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
                                    image_url: { url: `data:${mimeType};base64,${base64Data}` }
                                }
                            ]
                        }
                    ]
                }),
            });

            if (!response.ok) throw new Error(`OpenAI Vision Error: ${response.status}`);
            const data = await response.json() as any;
            return data.choices[0].message.content;
        } else if (['mp3', 'm4a', 'wav', 'ogg'].includes(ext)) {
            const formData = new FormData();
            const buffer = fs.readFileSync(filePath);
            // In Node environments, global FormData might behave differently. 
            // We'll use a hack to send it or recommend using Gemini for high-fidelity audio analysis.
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

    private inferProvider(modelName: string): LLMProvider {
        const lower = modelName.toLowerCase();
        if (lower.includes('gemini')) return 'google';
        return 'openai';
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
            return data.choices[0].message.content;
        } catch (error) {
            logger.error(`MultiLLM OpenAI Error: ${error}`);
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
            if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                return data.candidates[0].content.parts[0].text;
            }
            throw new Error('No content in Gemini response');
        } catch (error) {
            logger.error(`MultiLLM Google Error: ${error}`);
            throw error;
        }
    }
}
