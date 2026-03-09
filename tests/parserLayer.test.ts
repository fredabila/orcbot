import { describe, expect, it } from 'vitest';
import { ParserLayer } from '../src/core/ParserLayer';

describe('ParserLayer', () => {
    it('parses malformed JSON using JSON5 fallback', () => {
        const raw = `\
\
\`\`\`json
{
  action: 'EXECUTE',
  reasoning: 'Use a tolerant parser',
  verification: {
    goals_met: false,
    analysis: 'Recoverable malformed JSON',
    estimated_steps_remaining: 1,
  },
  tools: [
    { name: 'web_search', metadata: { query: 'orcbot parser', }, },
  ],
}
\`\`\``;

        const result = ParserLayer.normalize(raw);

        expect(result.success).toBe(true);
        expect(result.action).toBe('EXECUTE');
        expect(result.reasoning).toContain('tolerant parser');
        expect(result.verification?.goals_met).toBe(false);
        expect(result.tools?.[0]?.name).toBe('web_search');
        expect(result.tools?.[0]?.metadata?.query).toBe('orcbot parser');
    });

    it('uses tolerant parsing for native tool text content', () => {
        const textContent = `\
\
\`\`\`json
{
  action: 'EXECUTE',
  reasoning: 'Proceed with the send step',
  verification: {
    goals_met: true,
    analysis: 'Task complete',
    estimated_steps_remaining: 0,
  },
}
\`\`\``;

        const result = ParserLayer.normalizeNativeToolResponse(textContent, [
            { name: 'send_telegram', arguments: { chatId: '123', message: 'done' } }
        ]);

        expect(result.action).toBe('EXECUTE');
        expect(result.reasoning).toContain('send step');
        expect(result.verification?.goals_met).toBe(true);
        expect(result.tools?.[0]?.metadata?.chatId).toBe('123');
    });

    it('keeps prompt examples aligned with validator expectations', () => {
        const snippet = ParserLayer.getSystemPromptSnippet();

        expect(snippet).toContain('"name": "browser_navigate", "metadata": { "url": "http://google.com" }');
        expect(snippet).toContain('"verification": {');
        expect(snippet).toContain('"tool": "web_search"');
    });

    it('normalizes common tool metadata aliases before validation', () => {
        const raw = `\
\
\`\`\`json
{
  action: 'EXECUTE',
  verification: { goals_met: false, analysis: 'Continue' },
  tools: [
    { name: 'browser_navigate', metadata: { query: 'https://example.com' } },
    { name: 'send_slack', metadata: { channel: 'C123', message: 'hello' } },
    { name: 'send_gateway_chat', metadata: { sourceId: 'chat-7', message: 'hi' } },
  ],
}
\`\`\``;

        const result = ParserLayer.normalize(raw);

        expect(result.tools?.[0]?.metadata?.url).toBe('https://example.com');
        expect(result.tools?.[1]?.metadata?.channel_id).toBe('C123');
        expect(result.tools?.[2]?.metadata?.chatId).toBe('chat-7');
    });
});