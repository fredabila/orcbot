import { logger } from '../utils/logger';
import { MultiLLM } from './MultiLLM';

export interface CompactionOptions {
    targetLength: number;
    preserveRecent: number; // Number of recent entries to always preserve
    strategy: 'summarize' | 'truncate';
}

/**
 * Handles context compaction when LLM context windows are exceeded.
 * Inspired by openclaw's auto-compaction approach.
 */
export class ContextCompactor {
    constructor(private llm?: MultiLLM) {}

    /**
     * Compact context by summarizing or truncating
     */
    public async compact(
        content: string,
        options: Partial<CompactionOptions> = {}
    ): Promise<string> {
        const opts: CompactionOptions = {
            targetLength: options.targetLength || Math.floor(content.length * 0.6),
            preserveRecent: options.preserveRecent || 3,
            strategy: options.strategy || 'summarize'
        };

        logger.info(`ContextCompactor: Compacting ${content.length} chars to ~${opts.targetLength} using ${opts.strategy}`);

        if (opts.strategy === 'truncate') {
            return this.truncateCompaction(content, opts);
        } else {
            return this.summarizeCompaction(content, opts);
        }
    }

    /**
     * Simple truncation-based compaction (fast, no LLM required)
     */
    private truncateCompaction(content: string, options: CompactionOptions): string {
        if (content.length <= options.targetLength) {
            return content;
        }

        // Split by lines or entries
        const lines = content.split('\n');
        
        // If no line breaks, just truncate the content
        if (lines.length === 1) {
            const truncated = content.substring(0, options.targetLength);
            logger.info(`ContextCompactor: Truncated from ${content.length} to ${truncated.length} chars`);
            return truncated;
        }
        
        // Preserve header/important sections
        const header: string[] = [];
        const body: string[] = [];
        const recent: string[] = [];
        
        let inHeader = true;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Keep headers (lines starting with # or uppercase sections)
            if (inHeader && (line.startsWith('#') || /^[A-Z\s]+:/.test(line))) {
                header.push(line);
                continue;
            }
            
            inHeader = false;
            
            // Save recent entries
            if (i >= lines.length - options.preserveRecent) {
                recent.push(line);
            } else {
                body.push(line);
            }
        }

        // Calculate how much of body we can keep
        const headerSize = header.join('\n').length;
        const recentSize = recent.join('\n').length;
        const availableForBody = Math.max(0, options.targetLength - headerSize - recentSize - 100);

        // Take body entries from the end (more recent)
        let compactedBody: string[] = [];
        let currentSize = 0;
        for (let i = body.length - 1; i >= 0; i--) {
            const line = body[i];
            if (currentSize + line.length > availableForBody) break;
            compactedBody.unshift(line);
            currentSize += line.length;
        }

        const result = [
            ...header,
            body.length > compactedBody.length ? `\n... [${body.length - compactedBody.length} earlier entries truncated] ...\n` : '',
            ...compactedBody,
            ...recent
        ].join('\n');

        logger.info(`ContextCompactor: Truncated from ${content.length} to ${result.length} chars`);
        return result;
    }

    /**
     * LLM-based summarization (better quality, requires LLM call)
     */
    private async summarizeCompaction(content: string, options: CompactionOptions): Promise<string> {
        if (!this.llm) {
            logger.warn('ContextCompactor: No LLM available, falling back to truncation');
            return this.truncateCompaction(content, options);
        }

        if (content.length <= options.targetLength) {
            return content;
        }

        try {
            const prompt = `Summarize the following context while preserving key information. Target length: ~${Math.floor(options.targetLength / 5)} words.

Content to summarize:
${content}

Provide a concise summary that captures:
1. Key actions taken
2. Important results/outcomes
3. Critical state information
4. Relevant context for continuing the task

Summary:`;

            const systemPrompt = `You are a context summarization assistant. Your job is to compress lengthy context while retaining critical information. Be concise but preserve all important details that would be needed to continue a task.`;

            const summary = await this.llm.call(prompt, systemPrompt);
            
            // If summary is still too long, truncate
            if (summary.length > options.targetLength) {
                logger.warn('ContextCompactor: Summary still too long, applying truncation');
                return summary.substring(0, options.targetLength) + '... [truncated]';
            }

            logger.info(`ContextCompactor: Summarized from ${content.length} to ${summary.length} chars`);
            return summary;
        } catch (error) {
            logger.error(`ContextCompactor: Summarization failed: ${error}, falling back to truncation`);
            return this.truncateCompaction(content, options);
        }
    }

    /**
     * Compact step history by merging similar consecutive steps
     */
    public compactStepHistory(stepHistory: string): string {
        const lines = stepHistory.split('\n');
        const compacted: string[] = [];
        let consecutiveSimilar: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = lines[i + 1];

            // Check if lines are similar (same step type)
            const isSimilar = nextLine && this.areSimilarSteps(line, nextLine);

            if (isSimilar) {
                consecutiveSimilar.push(line);
            } else {
                consecutiveSimilar.push(line);
                
                // Merge consecutive similar steps
                if (consecutiveSimilar.length > 2) {
                    compacted.push(consecutiveSimilar[0]);
                    compacted.push(`... [${consecutiveSimilar.length - 2} similar steps] ...`);
                    compacted.push(consecutiveSimilar[consecutiveSimilar.length - 1]);
                } else {
                    compacted.push(...consecutiveSimilar);
                }
                
                consecutiveSimilar = [];
            }
        }

        return compacted.join('\n');
    }

    /**
     * Check if two step entries are similar
     */
    private areSimilarSteps(step1: string, step2: string): boolean {
        // Extract tool names from steps
        const tool1 = step1.match(/tool[:\s]+([a-z_]+)/i)?.[1];
        const tool2 = step2.match(/tool[:\s]+([a-z_]+)/i)?.[1];

        // Same tool = similar steps
        return tool1 !== undefined && tool1 === tool2;
    }

    /**
     * Estimate token count (rough approximation)
     */
    public static estimateTokens(text: string): number {
        // Rough approximation: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    /**
     * Check if content likely exceeds context window
     */
    public static needsCompaction(text: string, maxTokens: number = 100000): boolean {
        const estimated = this.estimateTokens(text);
        return estimated > maxTokens * 0.8; // Compact at 80% capacity
    }
}
