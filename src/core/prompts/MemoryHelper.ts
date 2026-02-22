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

    private static readonly MEMORY_SIGNALS = [
        'remember', 'recall', 'look up', 'find in history', 'past', 'previous',
        'earlier', 'history', 'log', 'journal', 'learning', 'fact', 'preference',
        'have we', 'did i', 'did you', 'what was', 'where was', 'when was',
        'context', 'background', 'relationship', 'person', 'contact', 'profile'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        return MemoryHelper.MEMORY_SIGNALS.some(kw => task.includes(kw));
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
`;
    }
}
