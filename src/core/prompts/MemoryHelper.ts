/**
 * MemoryHelper — Activated for tasks requiring historical context, fact retrieval, or person/project recall.
 * Provides guidance on selecting the right memory tool (semantic vs literal vs log).
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class MemoryHelper implements PromptHelper {
    readonly name = 'memory';
    readonly description = 'Historical context retrieval, semantic recall, and log searching';
    readonly priority = 20;
    readonly alwaysActive = false;

    private static readonly MEMORY_SIGNALS: RegExp[] = [
        /\bremember\b/i, /\brecall\b/i, /\blook up\b/i, /\bfind in history\b/i, /\bpast\b/i,
        /\bprevious\b/i, /\bearlier\b/i, /\bhistory\b/i, /\blog\b/i, /\bjournal\b/i,
        /\blearning\b/i, /\bfact\b/i, /\bpreference\b/i, /\bhave we\b/i, /\bdid i\b/i,
        /\bdid you\b/i, /\bwhat was\b/i, /\bwhere was\b/i, /\bwhen was\b/i, /\bcontext\b/i,
        /\bbackground\b/i, /\brelationship\b/i, /\bperson\b/i, /\bcontact\b/i, /\bprofile\b/i
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        return MemoryHelper.MEMORY_SIGNALS.some(rx => rx.test(task));
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `MEMORY & HISTORY RETRIEVAL STRATEGY:
You have a multi-layered memory system. Choose the right tool based on your needs:

1. **Semantic Recall (\`recall_memory\`)**: Use this for broad, meaning-based searches. 
   - Best for: "What did we talk about regarding the project?", "Do I know any facts about Bob?", "Have we discussed this before?"
   - Searches across all platforms and time periods.

2. **Literal Log Search (\`search_memory_logs\`)**: Use this for exact matches or when semantic search fails.
   - Best for: Finding specific dates, exact technical snippets, unique names, or looking through your daily self-reflections.
   - Searches your raw file-based daily logs, JOURNAL.md, and LEARNING.md.

3. **Chat-Specific History (\`search_chat_history\`)**: Use this when you know exactly who you were talking to.
   - Best for: "What was the last thing Alice sent me?", "Search my WhatsApp chat with +123456 for a link."
   - Target a specific contact ID (JID) and platform.

4. **Contact Context (\`get_whatsapp_context\`)**: Use this to quickly profile a person.
   - Best for: "Who is this person?", "Give me a summary of my relationship with Bob."

RECOVERY FROM "LEFT HANGING":
- If a search returns no results, do NOT give up. Try a broader query, use a different tool (e.g., switch from semantic to literal), or use \`list_memory_logs\` to see if you are searching in a valid date range.
- If you find a relevant log date via search, you can read the full day's log using \`read_memory_log(date)\`.

MEMORY CITATIONS & TRANSPARENCY:
When you use information retrieved from your memory, you MUST cite the source in your response. This builds trust and allows the user to know where the data came from.
- Format: Use square brackets like \`[Ref: source]\` at the end of the sentence or paragraph.
- Sources:
  - \`[Ref: MEMORY.md]\` for long-term facts.
  - \`[Ref: Daily Log YYYY-MM-DD]\` for daily memories.
  - \`[Ref: Chat history]\` for past conversations.
  - \`[Ref: User Profile]\` for personal preferences found in USER.md.
- Example: "You mentioned you prefer morning notifications [Ref: User Profile]."
`;
    }
}
