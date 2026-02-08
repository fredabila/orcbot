import { describe, expect, it } from 'vitest';
import { ResponseValidator } from '../src/core/ResponseValidator';
import { StandardResponse } from '../src/core/ParserLayer';

describe('ResponseValidator', () => {
    const allowedTools = ['send_telegram', 'send_whatsapp', 'web_search', 'browser_navigate', 'write_file', 'run_command'];

    describe('Tool name validation', () => {
        it('should accept valid tool names', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'Hello' } }
                ],
                verification: { goals_met: false, analysis: 'Sending message' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(true);
            expect(validation.errors.length).toBe(0);
        });

        it('should reject unknown tool names', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'unknown_tool', metadata: {} }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('Unknown tool: unknown_tool');
        });

        it('should reject empty tool names', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: '', metadata: {} }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('empty name'))).toBe(true);
        });

        it('should warn about duplicate tool calls', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'Hello' } },
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'Hello' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.warnings.some(w => w.includes('Duplicate'))).toBe(true);
        });
    });

    describe('Messaging tools validation', () => {
        it('should require message metadata for send_telegram', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'message\''))).toBe(true);
        });

        it('should require chatId for send_telegram', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'send_telegram', metadata: { message: 'Hello' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'chatId\''))).toBe(true);
        });

        it('should reject empty messages', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123', message: '   ' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('empty message'))).toBe(true);
        });
    });

    describe('Search tools validation', () => {
        it('should require query for web_search', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'web_search', metadata: {} }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'query\''))).toBe(true);
        });

        it('should accept query or q parameter', () => {
            const response1: StandardResponse = {
                success: true,
                tools: [
                    { name: 'web_search', metadata: { query: 'test' } }
                ]
            };

            const response2: StandardResponse = {
                success: true,
                tools: [
                    { name: 'web_search', metadata: { q: 'test' } }
                ]
            };

            const validation1 = ResponseValidator.validateResponse(response1, allowedTools);
            const validation2 = ResponseValidator.validateResponse(response2, allowedTools);
            
            expect(validation1.valid).toBe(true);
            expect(validation2.valid).toBe(true);
        });

        it('should reject empty search queries', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'web_search', metadata: { query: '  ' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('empty query'))).toBe(true);
        });
    });

    describe('Browser tools validation', () => {
        it('should require url for browser_navigate', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'browser_navigate', metadata: {} }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'url\''))).toBe(true);
        });
    });

    describe('File operation validation', () => {
        it('should require path for write_file', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'write_file', metadata: { content: 'test' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'path\''))).toBe(true);
        });

        it('should require content for write_file', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'write_file', metadata: { path: '/tmp/test.txt' } }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'content\''))).toBe(true);
        });
    });

    describe('Command execution validation', () => {
        it('should require command for run_command', () => {
            const response: StandardResponse = {
                success: true,
                tools: [
                    { name: 'run_command', metadata: {} }
                ]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('missing required \'command\''))).toBe(true);
        });
    });

    describe('Verification validation', () => {
        it('should require boolean goals_met', () => {
            const response: StandardResponse = {
                success: true,
                verification: { goals_met: 'yes' as any, analysis: 'Done' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('must be a boolean'))).toBe(true);
        });

        it('should warn about empty analysis', () => {
            const response: StandardResponse = {
                success: true,
                verification: { goals_met: false, analysis: '' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.warnings.some(w => w.includes('analysis is empty'))).toBe(true);
        });
    });

    describe('General response validation', () => {
        it('should warn about missing reasoning when no tools are present', () => {
            const response: StandardResponse = {
                success: true,
                tools: []
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.warnings.some(w => w.includes('No reasoning'))).toBe(true);
        });

        it('should NOT warn about missing reasoning when tools are present', () => {
            const response: StandardResponse = {
                success: true,
                tools: [{ name: 'send_telegram', metadata: { chatId: '123', message: 'Hi' } }]
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.warnings.some(w => w.includes('No reasoning'))).toBe(false);
        });

        it('should warn about goals_met=true with tools', () => {
            const response: StandardResponse = {
                success: true,
                tools: [{ name: 'send_telegram', metadata: { chatId: '123', message: 'Hi' } }],
                verification: { goals_met: true, analysis: 'Done' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.warnings.some(w => w.includes('goals_met=true but also includes tools'))).toBe(true);
        });

        it('should pass comprehensive valid response', () => {
            const response: StandardResponse = {
                success: true,
                reasoning: 'User requested a greeting',
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'Hello!' } }
                ],
                verification: { goals_met: false, analysis: 'Sending message' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(true);
            expect(validation.errors.length).toBe(0);
        });

        it('should warn about goals_met with tools but still be valid', () => {
            const response: StandardResponse = {
                success: true,
                reasoning: 'User requested a greeting',
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123', message: 'Hello!' } }
                ],
                verification: { goals_met: true, analysis: 'Message sent successfully' }
            };

            const validation = ResponseValidator.validateResponse(response, allowedTools);
            expect(validation.valid).toBe(true);
            expect(validation.warnings.some(w => w.includes('goals_met=true but also includes tools'))).toBe(true);
        });
    });
});
