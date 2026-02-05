import { DailyMemory } from '../memory/DailyMemory';
import { logger } from '../utils/logger';
import path from 'path';
import os from 'os';

/**
 * Memory tools for searching and retrieving markdown-based memory files.
 * Inspired by OpenClaw's memory system with memory_search and memory_get tools.
 */

/**
 * Simple text-based search across memory files
 * Returns snippets with context for matching queries
 */
export async function memorySearchSkill(args: any, context: any): Promise<string> {
    try {
        const query = args.query || '';
        if (!query) {
            return 'Error: No search query provided. Use: memory_search query="your search term"';
        }

        const dataHome = context?.config?.getDataHome?.() || process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        const dailyMemory = new DailyMemory(dataHome);
        const results: Array<{
            file: string;
            snippet: string;
            score: number;
        }> = [];

        // Search in long-term memory
        const longTerm = dailyMemory.readLongTerm();
        if (longTerm) {
            const matches = findMatches(longTerm, query, 'MEMORY.md');
            results.push(...matches);
        }

        // Search in recent daily memories (last 7 days)
        const dailyFiles = dailyMemory.listDailyMemories().slice(0, 7);
        for (const fileName of dailyFiles) {
            const content = dailyMemory.readDailyMemory(fileName.replace('.md', ''));
            if (content) {
                const matches = findMatches(content, query, `memory/${fileName}`);
                results.push(...matches);
            }
        }

        // Sort by score (descending)
        results.sort((a, b) => b.score - a.score);

        // Return top 5 results
        const topResults = results.slice(0, 5);
        
        if (topResults.length === 0) {
            return `No matches found for query: "${query}"`;
        }

        const output = [
            `Found ${topResults.length} result(s) for query: "${query}"\n`,
            ...topResults.map((r, i) => 
                `${i + 1}. **${r.file}** (score: ${r.score.toFixed(2)})\n${r.snippet}\n`
            )
        ].join('\n');

        return output;
    } catch (error) {
        logger.error(`Memory search error: ${error}`);
        return `Error searching memory: ${error}`;
    }
}

/**
 * Retrieve the full content of a specific memory file
 */
export async function memoryGetSkill(args: any, context: any): Promise<string> {
    try {
        const filePath = args.path || args.file || '';
        if (!filePath) {
            return 'Error: No file path provided. Use: memory_get path="MEMORY.md" or path="memory/2024-01-15.md"';
        }

        const dataHome = context?.config?.getDataHome?.() || process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        const dailyMemory = new DailyMemory(dataHome);
        
        // Handle different file path formats
        let content: string | null = null;
        
        if (filePath === 'MEMORY.md' || filePath === 'long-term') {
            content = dailyMemory.readLongTerm();
        } else if (filePath === 'today') {
            content = dailyMemory.readToday();
        } else if (filePath === 'yesterday') {
            content = dailyMemory.readYesterday();
        } else if (filePath.startsWith('memory/') || /^\d{4}-\d{2}-\d{2}(\.md)?$/.test(filePath)) {
            // Extract date from path
            const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                content = dailyMemory.readDailyMemory(dateMatch[1]);
            }
        }

        if (!content) {
            return `Error: Memory file not found: ${filePath}\n\nAvailable files:\n- MEMORY.md (long-term)\n- today\n- yesterday\n- memory/YYYY-MM-DD.md`;
        }

        // Optionally limit content length
        const maxLength = args.maxLength || 10000;
        if (content.length > maxLength) {
            content = content.substring(0, maxLength) + `\n\n... (truncated, ${content.length - maxLength} more characters)`;
        }

        return `# Content of ${filePath}\n\n${content}`;
    } catch (error) {
        logger.error(`Memory get error: ${error}`);
        return `Error retrieving memory: ${error}`;
    }
}

/**
 * Write a memory entry to daily log or long-term memory
 */
export async function memoryWriteSkill(args: any, context: any): Promise<string> {
    try {
        const content = args.content || args.text || '';
        const type = args.type || 'daily'; // 'daily' or 'long-term'
        const category = args.category || args.section;

        if (!content) {
            return 'Error: No content provided. Use: memory_write content="text to remember" type="daily|long-term"';
        }

        const dataHome = context?.config?.getDataHome?.() || process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        const dailyMemory = new DailyMemory(dataHome);

        if (type === 'long-term' || type === 'longterm') {
            dailyMemory.appendToLongTerm(content, category);
            return `✓ Written to long-term memory (MEMORY.md)${category ? ` under section: ${category}` : ''}`;
        } else {
            dailyMemory.appendToDaily(content, category);
            return `✓ Written to today's daily log${category ? ` (category: ${category})` : ''}`;
        }
    } catch (error) {
        logger.error(`Memory write error: ${error}`);
        return `Error writing to memory: ${error}`;
    }
}

/**
 * Get memory statistics and available files
 */
export async function memoryStatsSkill(args: any, context: any): Promise<string> {
    try {
        const dataHome = context?.config?.getDataHome?.() || process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        const dailyMemory = new DailyMemory(dataHome);
        const stats = dailyMemory.getStats();
        const recentFiles = dailyMemory.listDailyMemories().slice(0, 10);

        const output = [
            '# Memory System Statistics\n',
            `**Memory Directory:** ${stats.memoryDir}`,
            `**Long-term Memory:** ${stats.hasLongTerm ? '✓ exists' : '✗ not created'}`,
            `**Daily Memory Files:** ${stats.dailyFiles}\n`,
            '## Recent Daily Logs:',
            ...recentFiles.map(f => `- ${f}`),
            '\n**Available commands:**',
            '- `memory_search query="search term"` - Search across all memory',
            '- `memory_get path="MEMORY.md"` - Read a specific file',
            '- `memory_write content="text" type="daily|long-term"` - Write to memory',
            '- `memory_stats` - Show this information'
        ].join('\n');

        return output;
    } catch (error) {
        logger.error(`Memory stats error: ${error}`);
        return `Error getting memory stats: ${error}`;
    }
}

/**
 * Helper function to find text matches in content
 */
function findMatches(content: string, query: string, fileName: string): Array<{
    file: string;
    snippet: string;
    score: number;
}> {
    const results: Array<{ file: string; snippet: string; score: number }> = [];
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();
        
        if (lineLower.includes(queryLower)) {
            // Calculate a simple relevance score
            const exactMatch = line.includes(query) ? 2 : 1;
            const lengthBonus = 1 / (Math.max(line.length, 1) / 100); // Prefer shorter, focused lines
            const score = exactMatch + lengthBonus;
            
            // Get context (2 lines before and after)
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            const context = lines.slice(start, end);
            
            // Highlight the match - ensure we're highlighting the correct line
            const highlightedContext = context.map((l, idx) => {
                const actualLineIdx = start + idx;
                if (actualLineIdx === i) {
                    return `**>>> ${l}**`; // Highlight matched line
                }
                return `    ${l}`;
            });
            
            results.push({
                file: fileName,
                snippet: highlightedContext.join('\n'),
                score
            });
        }
    }
    
    return results;
}

// Export skill definitions
export const memoryToolsSkills = [
    {
        name: 'memory_search',
        description: 'Search across all memory files (daily logs and long-term memory) for relevant information. Returns snippets with context.',
        usage: 'memory_search query="search term"',
        handler: memorySearchSkill
    },
    {
        name: 'memory_get',
        description: 'Retrieve the full content of a specific memory file. Supports: MEMORY.md, today, yesterday, or memory/YYYY-MM-DD.md',
        usage: 'memory_get path="MEMORY.md"',
        handler: memoryGetSkill
    },
    {
        name: 'memory_write',
        description: 'Write a memory entry to daily log or long-term memory. Use type="daily" for day-to-day notes, type="long-term" for durable facts.',
        usage: 'memory_write content="information to remember" type="daily" category="optional category"',
        handler: memoryWriteSkill
    },
    {
        name: 'memory_stats',
        description: 'Get statistics about the memory system, including available files and storage locations.',
        usage: 'memory_stats',
        handler: memoryStatsSkill
    }
];
