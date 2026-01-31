import { logger } from '../utils/logger';

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

    private inferProvider(): LLMProvider {
        const lower = this.modelName.toLowerCase();
        if (lower.includes('gemini')) return 'google';
        return 'openai';
    }

    public async call(prompt: string, systemMessage?: string, provider?: LLMProvider): Promise<string> {
        const activeProvider = provider || this.inferProvider();

        if (activeProvider === 'openai') {
            return this.callOpenAI(prompt, systemMessage);
        } else if (activeProvider === 'google') {
            return this.callGoogle(prompt, systemMessage);
        }

        throw new Error(`Provider ${activeProvider} not supported`);
    }

    private async callOpenAI(prompt: string, systemMessage?: string): Promise<string> {
        if (!this.openaiKey) throw new Error('OpenAI API key not configured');

        const messages: LLMMessage[] = [];
        if (systemMessage) messages.push({ role: 'system', content: systemMessage });
        messages.push({ role: 'user', content: prompt });

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openaiKey}`,
                },
                body: JSON.stringify({
                    model: this.modelName,
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

    private async callGoogle(prompt: string, systemMessage?: string): Promise<string> {
        if (!this.googleKey) throw new Error('Google API key not configured');

        // Gemini doesn't have "system" role in the same way for v1beta, but we can prepend it.
        // Or use the separate 'system_instruction' field if available (checking docs, v1beta just added it but safe to prepend for compatibility).
        // Let's prepend system message to user prompt for robustness.
        const fullPrompt = systemMessage ? `System: ${systemMessage}\n\nUser: ${prompt}` : prompt;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.googleKey}`;

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
