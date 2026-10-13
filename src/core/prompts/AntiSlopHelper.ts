/**
 * AntiSlopHelper — always active.
 *
 * Injects the text subset of the antislop skill (`antislop.md`) that governs user-facing writing,
 * so replies to the owner and to external contacts never read like generic AI output. The skill's
 * UI, layout, motion and asset rules do not apply to chat text and are intentionally omitted.
 *
 * Mapped rules: R-02 (no em dash), R-16 (no buzzwords), R-17 (no unsourced numbers),
 * R-18/R-36/R-38 (no fabricated testimonials/claims/content), plus the specificity bar (R-31/C-1).
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class AntiSlopHelper implements PromptHelper {
    readonly name = 'antislop';
    readonly description = 'Anti-slop writing rules for all user-facing text';
    readonly priority = 11;
    readonly alwaysActive = true;

    shouldActivate(_ctx: PromptHelperContext): boolean {
        return true;
    }

    getPrompt(_ctx: PromptHelperContext): string {
        return `ANTI-SLOP WRITING (applies to EVERY message you send, to the owner or anyone else):
- NEVER use the em dash character (—). Use a comma, period, colon, or parentheses instead.
- BANNED buzzwords: "AI Powered", "Next Generation", "Revolutionary", "Seamless", "Cutting Edge", "Intelligent", "Ultimate", "Powerful", "Effortless", "game-changer", "unleash", "supercharge". Name the concrete thing instead.
- NEVER invent numbers, statistics, testimonials, names, job titles, or security, compliance, or performance claims. If you have no real data, say so plainly or leave it out. Empty is better than fabricated.
- Do not present something as working, secure, or fast unless it actually is in this task. No "demo without a product".
- Be specific and concrete. Cut filler, hedging, and template phrasing.
- Match the reader's tone and length. Plain and direct beats corporate-cheerful or salesy.
- Write like a capable human: no hollow acknowledgments, no "As an AI...", and do not restate the request back to the reader.`;
    }
}
