import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/core/PiAIAdapter';
import type { LLMToolDefinition } from '../src/core/MultiLLM';

describe('PiAIAdapter contract normalization', () => {
    it('preserves nested array schemas for tool parameters', () => {
        const tool: LLMToolDefinition = {
            type: 'function',
            function: {
                name: 'telegram_send_buttons',
                description: 'Send Telegram buttons',
                parameters: {
                    type: 'object',
                    properties: {
                        chatId: { type: 'string', description: 'Chat ID' },
                        text: { type: 'string', description: 'Message text' },
                        buttons: {
                            type: 'array',
                            description: 'Button rows',
                            items: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        text: { type: 'string', description: 'Button label' },
                                        callback_data: { type: 'string', description: 'Callback payload' },
                                    },
                                    required: ['text', 'callback_data'],
                                },
                            },
                        },
                    },
                    required: ['chatId', 'text', 'buttons'],
                },
            },
        };

        const [converted] = __test__.topiTools([tool]);
        expect(converted.parameters.properties.buttons.type).toBe('array');
        expect(converted.parameters.properties.buttons.items.type).toBe('array');
        expect(converted.parameters.properties.buttons.items.items.type).toBe('object');
        expect(converted.parameters.properties.buttons.items.items.properties.text.type).toBe('string');
        expect(converted.parameters.properties.buttons.items.items.properties.callback_data.type).toBe('string');
    });

    it('preserves additionalProperties schemas when cloning objects', () => {
        const schema = {
            type: 'object',
            properties: {
                metadata: {
                    type: 'object',
                    additionalProperties: {
                        type: 'string',
                    },
                },
            },
            required: ['metadata'],
        };

        const cloned = __test__.cloneToolSchema(schema);
        expect(cloned.properties.metadata.additionalProperties.type).toBe('string');
        expect(cloned.required).toEqual(['metadata']);
    });

    it('normalizes model prefixes consistently', () => {
        expect(__test__.normalizePiModel('nvidia:moonshotai/kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
        expect(__test__.normalizePiModel('bedrock:anthropic.claude')).toBe('anthropic.claude');
        expect(__test__.normalizePiModel('gpt-5.1')).toBe('gpt-5.1');
    });

    it('maps common model families to the expected provider', () => {
        expect(__test__.toPiProvider('auto', 'gpt-5.1')).toBe('openai');
        expect(__test__.toPiProvider('auto', 'gemini-2.5-pro')).toBe('google');
        expect(__test__.toPiProvider('auto', 'claude-sonnet-4-5')).toBe('anthropic');
        expect(__test__.toPiProvider('auto', 'mistral-large')).toBe('mistral');
    });
});