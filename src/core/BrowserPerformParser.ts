export type BrowserPerformTool = 'click' | 'type' | 'press' | 'wait' | 'scroll' | 'hover';

export interface BrowserPerformAction {
    tool: BrowserPerformTool;
    ref?: string;
    text?: string;
    key?: string;
    ms?: number;
    dir?: string;
}

const ALLOWED_TOOLS = new Set<BrowserPerformTool>(['click', 'type', 'press', 'wait', 'scroll', 'hover']);

function parseActionPayload(candidate: string): unknown {
    const trimmed = candidate.trim();
    if (!trimmed) return null;

    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).actions)) {
        return (parsed as any).actions;
    }

    return null;
}

function normalizeAction(action: any): BrowserPerformAction | null {
    if (!action || typeof action !== 'object') return null;

    const tool = String(action.tool || '').trim().toLowerCase() as BrowserPerformTool;
    if (!ALLOWED_TOOLS.has(tool)) return null;

    if (tool === 'click' || tool === 'hover') {
        const ref = String(action.ref || '').trim();
        return ref ? { tool, ref } : null;
    }

    if (tool === 'type') {
        const ref = String(action.ref || '').trim();
        const text = action.text == null ? '' : String(action.text);
        return ref ? { tool, ref, text } : null;
    }

    if (tool === 'press') {
        const key = String(action.key || '').trim();
        return key ? { tool, key } : null;
    }

    if (tool === 'wait') {
        const value = Number(action.ms);
        return { tool, ms: Number.isFinite(value) && value >= 0 ? value : 1000 };
    }

    const dir = String(action.dir || 'down').trim().toLowerCase();
    return { tool, dir: dir || 'down' };
}

function isLikelyJsonBlockStart(text: string, index: number): boolean {
    const opening = text[index];
    let cursor = index + 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

    const nextChar = text[cursor] || '';
    if (opening === '[') {
        return nextChar === '' || ['{', '[', '"', ']', '-', 't', 'f', 'n'].includes(nextChar) || /[0-9]/.test(nextChar);
    }

    if (opening === '{') {
        return nextChar === '' || nextChar === '"' || nextChar === '}';
    }

    return false;
}

function extractBalancedJsonBlock(text: string, startIndex: number): string | null {
    const opening = text[startIndex];
    const closing = opening === '[' ? ']' : opening === '{' ? '}' : '';
    if (!closing) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === opening) {
            depth += 1;
            continue;
        }

        if (char === closing) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(startIndex, index + 1);
            }
        }
    }

    return null;
}

function collectJsonCandidates(response: string): string[] {
    const candidates: string[] = [];
    const trimmed = response.trim();

    if (trimmed) {
        candidates.push(trimmed);
    }

    const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
    for (const match of fencedMatches) {
        const candidate = String(match[1] || '').trim();
        if (candidate) candidates.push(candidate);
    }

    for (let index = 0; index < response.length; index += 1) {
        const char = response[index];
        if ((char === '[' || char === '{') && isLikelyJsonBlockStart(response, index)) {
            const candidate = extractBalancedJsonBlock(response, index);
            if (candidate) candidates.push(candidate);
        }
    }

    return candidates;
}

export function parseBrowserPerformActions(response: string): BrowserPerformAction[] {
    const candidates = collectJsonCandidates(String(response || ''));

    for (const candidate of candidates) {
        try {
            const parsed = parseActionPayload(candidate);
            if (!Array.isArray(parsed)) continue;

            const normalized = parsed
                .map(normalizeAction)
                .filter((action): action is BrowserPerformAction => action !== null);

            if (normalized.length > 0) {
                return normalized;
            }

            if (parsed.length === 0) {
                return [];
            }
        } catch {
            continue;
        }
    }

    throw new Error('No valid JSON action plan found in model response');
}