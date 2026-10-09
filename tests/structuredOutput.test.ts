import { describe, expect, it, vi, afterEach } from 'vitest';
import { MultiLLM } from '../src/core/MultiLLM';

/** Minimal SSE response stand-in for the streaming text paths. */
function streamResponse(text: string) {
    const encoder = new TextEncoder();
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
    let drained = false;
    return {
        ok: true,
        status: 200,
        text: async () => text,
        json: async () => ({}),
        body: {
            getReader: () => ({
                read: async () => {
                    if (drained) return { done: true, value: undefined };
                    drained = true;
                    return { done: false, value: encoder.encode(payload) };
                },
            }),
        },
    };
}

/** Minimal non-streaming JSON response stand-in (Google/Ollama tool paths use these). */
function jsonResponse(payload: any) {
    return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}

function errorResponse(status: number, detail: string) {
    return {
        ok: false,
        status,
        text: async () => detail,
        json: async () => ({ error: { message: detail } }),
    };
}

function bodyOf(fetchMock: any, callIndex: number) {
    return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

describe('MultiLLM structured output', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('requests a native JSON response for OpenAI when jsonMode is set', async () => {
        const fetchMock = vi.fn(async () => streamResponse('{"ok":true}'));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'test-key' });

        const result = await llm.call('decide', 'system', 'openai', 'gpt-4o', { jsonMode: true });

        expect(result).toBe('{"ok":true}');
        expect(bodyOf(fetchMock, 0).response_format).toEqual({ type: 'json_object' });
    });

    it('leaves the request untouched when jsonMode is not requested', async () => {
        const fetchMock = vi.fn(async () => streamResponse('plain text'));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'test-key' });

        await llm.call('decide', 'system', 'openai', 'gpt-4o');

        expect(bodyOf(fetchMock, 0)).not.toHaveProperty('response_format');
    });

    it('uses Gemini\'s responseMimeType instead of response_format', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'gemini-2.5-flash', googleApiKey: 'test-key' });

        await llm.call('decide', 'system', 'google', 'gemini-2.5-flash', { jsonMode: true });

        const body = bodyOf(fetchMock, 0);
        expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
        expect(body).not.toHaveProperty('response_format');
    });

    it('ignores jsonMode on providers with no equivalent, such as Anthropic', async () => {
        const fetchMock = vi.fn(async () => {
            const encoder = new TextEncoder();
            const payload = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: '{"ok":true}' } })}\n\n`;
            let drained = false;
            return {
                ok: true,
                status: 200,
                text: async () => '',
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (drained) return { done: true, value: undefined };
                            drained = true;
                            return { done: false, value: encoder.encode(payload) };
                        },
                    }),
                },
            };
        });
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'claude-sonnet-4-5', anthropicApiKey: 'test-key' });

        const result = await llm.call('decide', 'system', 'anthropic', 'claude-sonnet-4-5', { jsonMode: true });

        expect(result).toBe('{"ok":true}');
        const body = bodyOf(fetchMock, 0);
        expect(body).not.toHaveProperty('response_format');
        expect(body).not.toHaveProperty('generationConfig');
    });

    it('degrades to plain text when the provider rejects the JSON response mode', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(errorResponse(400, '{"error":{"message":"response_format is not supported for this model"}}'))
            .mockResolvedValueOnce(streamResponse('{"ok":true}'));
        vi.stubGlobal('fetch', fetchMock);
        const llm = new MultiLLM({ modelName: 'gpt-4o', apiKey: 'test-key' });

        const result = await llm.call('decide', 'system', 'openai', 'gpt-4o', { jsonMode: true });

        expect(result).toBe('{"ok":true}');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(bodyOf(fetchMock, 0).response_format).toEqual({ type: 'json_object' });
        expect(bodyOf(fetchMock, 1)).not.toHaveProperty('response_format');
    });

    it('surfaces the provider error body instead of only the status code', async () => {
        const error = await (MultiLLM as any).providerError('OpenAI', errorResponse(429, '{"error":{"message":"rate limit exceeded"}}'));

        expect(error.message).toContain('OpenAI API Error: 429');
        expect(error.message).toContain('rate limit exceeded');
    });

    it('redacts credential-shaped text out of the provider error body', async () => {
        // These strings reach logs and memory, so nothing key-shaped should ride along.
        const body = JSON.stringify({
            error: {
                message: 'invalid api_key sk-abcdefghijklmnopqrstuvwxyz provided',
                authorization: 'Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
                apiKey: 'AIzaSyA1234567890abcdefghijklmnop',
            },
        });

        const error = await (MultiLLM as any).providerError('OpenAI', errorResponse(401, body));

        expect(error.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
        expect(error.message).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
        expect(error.message).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
        expect(error.message).toContain('OpenAI API Error: 401');
    });

    it('caps the embedded provider detail so a large body cannot flood logs', async () => {
        const error = await (MultiLLM as any).providerError('OpenAI', errorResponse(400, 'x'.repeat(5000)));

        expect(error.message.length).toBeLessThan(300);
    });

    it('only treats genuine JSON-mode rejections as degradable', () => {
        const isRejection = (MultiLLM as any).isStructuredOutputRejection.bind(MultiLLM);

        expect(isRejection(new Error('OpenAI API Error: 400 - response_format is not supported'))).toBe(true);
        expect(isRejection(new Error('Google API Error: 400 - Unknown name "responseMimeType"'))).toBe(true);
        expect(isRejection(new Error('OpenAI API Error: 429 - rate limit exceeded'))).toBe(false);
        expect(isRejection(new Error('fetch failed'))).toBe(false);
    });
});
