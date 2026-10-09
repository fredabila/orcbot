import { describe, expect, it } from 'vitest';
import { countTokens } from 'gpt-tokenizer';
import { estimateTokens } from '../src/utils/tokenEstimate';

describe('estimateTokens', () => {
    it('returns zero for empty input', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('matches the tokenizer it wraps', () => {
        const text = 'Summarise src/core/Agent.ts and report the guardrail thresholds.';
        expect(estimateTokens(text)).toBe(countTokens(text));
    });

    it('is far more accurate than a character-count guess on non-Latin text', () => {
        // The old heuristic (length / 4) badly under-counts CJK: four characters are four
        // tokens, not one. This is the kind of text the character guess got most wrong.
        const cjk = '你好世界';

        expect(estimateTokens(cjk)).toBe(countTokens(cjk));
        expect(estimateTokens(cjk)).toBeGreaterThan(Math.ceil(cjk.length / 4));
    });

    it('tracks length monotonically', () => {
        const short = estimateTokens('hello world');
        const long = estimateTokens('hello world '.repeat(50));
        expect(long).toBeGreaterThan(short);
    });
});
