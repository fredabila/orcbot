import { logger } from '../utils/logger';
import { Agent } from '../core/Agent';

/**
 * Register Book Log tools with the agent's SkillsManager.
 */
export function registerBookLogSkills(agent: Agent) {
    agent.skills.registerSkill({
        name: 'book_log_add',
        description: 'Add a high-level abstractive summary of a resource (PDF, article, video, etc.) to the Book Log. Use this after reading a significant resource to preserve key insights without clogging context.',
        usage: 'book_log_add(title: string, source: string, summary: string, tags: string[], keyExcerpts: string[], insights: string[], documentId?: string)',
        handler: async (args: any) => {
            if (!args.title || !args.summary) {
                return 'Error: title and summary are required.';
            }

            const entry = agent.bookLog.addEntry({
                title: args.title,
                source: args.source || 'unknown',
                summary: args.summary,
                tags: Array.isArray(args.tags) ? args.tags : [],
                keyExcerpts: Array.isArray(args.keyExcerpts) ? args.keyExcerpts : [],
                insights: Array.isArray(args.insights) ? args.insights : [],
                documentId: args.documentId
            });

            return `Success: Added Book Log entry for "${entry.title}" (ID: ${entry.id}). This high-level info is now searchable and will be used to ground future tasks.`;
        }
    });

    agent.skills.registerSkill({
        name: 'book_log_search',
        description: 'Search the Book Log for high-level summaries and insights about previously read resources. Use this before diving into raw KnowledgeStore chunks.',
        usage: 'book_log_search(query: string)',
        handler: async (args: any) => {
            const query = args.query || args.text || '';
            if (!query) return 'Error: search query is required.';

            const results = agent.bookLog.search(query);
            if (results.length === 0) {
                return `No Book Log entries found matching "${query}".`;
            }

            const formatted = agent.bookLog.formatForPrompt(results.slice(0, 5));
            return `Found ${results.length} relevant Book Log entries:\n\n${formatted}`;
        }
    });

    agent.skills.registerSkill({
        name: 'book_log_list',
        description: 'List recent entries in the Book Log.',
        usage: 'book_log_list(limit?: number)',
        handler: async (args: any) => {
            const limit = args.limit || 10;
            const entries = agent.bookLog.getRecent(limit);
            if (entries.length === 0) return 'The Book Log is currently empty.';

            const list = entries.map(e => `- [${e.dateRead.split('T')[0]}] ${e.title} (${e.tags.join(', ')})`).join('\n');
            return `Recent Book Log Entries:\n${list}\n\nUse book_log_search(title) to see details of a specific entry.`;
        }
    });
}
