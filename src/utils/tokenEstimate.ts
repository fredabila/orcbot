import { countTokens } from 'gpt-tokenizer';

/**
 * Single source of truth for token counts when a provider has not reported real usage.
 *
 * This replaces two divergent character heuristics — `text.length / 4` in ContextCompactor
 * and a word-length rule in MultiLLM — that disagreed with each other and with every real
 * tokenizer. Both could be off by a wide margin on code, JSON and non-Latin text, which is
 * exactly the content OrcBot passes around, and the compaction threshold is driven by this
 * number.
 *
 * gpt-tokenizer ships the o200k_base BPE vocabulary: exact for GPT-family models, and a far
 * better approximation than a character count for providers that use their own tokenizer.
 *
 * Prefer real usage from the provider wherever it is available (see MultiLLM.recordUsage);
 * this is the fallback for text that was never sent, or sent to a provider that reports none.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return countTokens(text);
}
