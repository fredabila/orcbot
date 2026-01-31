import { logger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

export type LLMProvider = 'openai' | 'anthropic' | 'llama';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class MultiLLM {
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        if (this.apiKey) {
            logger.info('MultiLLM: OpenAI provider initialized');
        } else {
            logger.warn('MultiLLM: OpenAI API key not found');
        }
    }

    public async call(provider: LLMProvider, prompt: string, systemMessage?: string): Promise<string> {
        if (provider !== 'openai') {
            throw new Error(`LLM provider ${provider} not yet implemented`);
        }

        if (!this.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const messages: LLMMessage[] = [];
        if (systemMessage) {
            messages.push({ role: 'system', content: systemMessage });
        }
        messages.push({ role: 'user', content: prompt });

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages,
                    temperature: 0.7,
                }),
            });

            const data = await response.json() as { choices?: { message?: { content?: string } }[] };
            return data.choices?.[0]?.message?.content || '';
        } catch (error) {
            logger.error(`MultiLLM call failed: ${error}`);
            throw error;
        }
    }
}
