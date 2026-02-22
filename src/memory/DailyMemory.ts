import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';

/**
 * DailyMemory manages daily markdown-based memory logs inspired by OpenClaw.
 * Each day gets its own memory file (YYYY-MM-DD.md) for append-only logs.
 * This provides a structured, file-based memory system that's easy to inspect and maintain.
 */
export class DailyMemory {
    private memoryDir: string;
    private longTermMemoryPath: string;

    constructor(dataHome: string = path.join(os.homedir(), '.orcbot')) {
        this.memoryDir = path.join(dataHome, 'memory');
        this.longTermMemoryPath = path.join(dataHome, 'MEMORY.md');
        
        // Ensure memory directory exists
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
            logger.info(`Created daily memory directory at ${this.memoryDir}`);
        }
    }

    /**
     * Get the path for today's memory file
     */
    private getTodayMemoryPath(): string {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.memoryDir, `${today}.md`);
    }

    /**
     * Get the path for yesterday's memory file
     */
    private getYesterdayMemoryPath(): string {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const dateStr = yesterday.toISOString().split('T')[0];
        return path.join(this.memoryDir, `${dateStr}.md`);
    }

    /**
     * Append a memory entry to today's log
     */
    public appendToDaily(content: string, category?: string): void {
        const todayPath = this.getTodayMemoryPath();
        const timestamp = new Date().toISOString();
        const header = category ? `## [${timestamp}] ${category}\n\n` : `## [${timestamp}]\n\n`;
        const entry = `${header}${content}\n\n---\n\n`;

        try {
            // Create file with header if it doesn't exist
            if (!fs.existsSync(todayPath)) {
                const today = new Date().toISOString().split('T')[0];
                const fileHeader = `# Daily Memory Log - ${today}\n\n`;
                fs.writeFileSync(todayPath, fileHeader);
                logger.info(`Created new daily memory file: ${todayPath}`);
            }

            fs.appendFileSync(todayPath, entry);
            logger.debug(`Appended memory to daily log: ${category || 'general'}`);
        } catch (error) {
            logger.error(`Failed to append to daily memory: ${error}`);
        }
    }

    /**
     * Read today's memory log
     */
    public readToday(): string | null {
        const todayPath = this.getTodayMemoryPath();
        return this.readMemoryFile(todayPath);
    }

    /**
     * Read yesterday's memory log
     */
    public readYesterday(): string | null {
        const yesterdayPath = this.getYesterdayMemoryPath();
        return this.readMemoryFile(yesterdayPath);
    }

    /**
     * Read recent context (today + yesterday)
     */
    public readRecentContext(): string {
        const parts: string[] = [];
        
        const yesterday = this.readYesterday();
        if (yesterday) {
            parts.push('# Yesterday\'s Memory\n\n' + yesterday);
        }
        
        const today = this.readToday();
        if (today) {
            parts.push('# Today\'s Memory\n\n' + today);
        }
        
        return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
    }

    /**
     * Write to long-term memory file (MEMORY.md)
     * This is for curated, durable facts and preferences
     */
    public appendToLongTerm(content: string, section?: string): void {
        try {
            // Create file with header if it doesn't exist
            if (!fs.existsSync(this.longTermMemoryPath)) {
                const header = `# Long-Term Memory\n\nThis file contains curated, durable facts, preferences, and important information.\n\n---\n\n`;
                fs.writeFileSync(this.longTermMemoryPath, header);
                logger.info(`Created long-term memory file: ${this.longTermMemoryPath}`);
            }

            const timestamp = new Date().toISOString();
            const entry = section 
                ? `## ${section}\n\n_Updated: ${timestamp}_\n\n${content}\n\n---\n\n`
                : `## Entry - ${timestamp}\n\n${content}\n\n---\n\n`;

            fs.appendFileSync(this.longTermMemoryPath, entry);
            logger.info('Appended to long-term memory');
        } catch (error) {
            logger.error(`Failed to append to long-term memory: ${error}`);
        }
    }

    /**
     * Read long-term memory
     */
    public readLongTerm(): string | null {
        return this.readMemoryFile(this.longTermMemoryPath);
    }

    /**
     * List all daily memory files
     */
    public listDailyMemories(): string[] {
        try {
            const files = fs.readdirSync(this.memoryDir);
            return files
                .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
                .map(f => f.replace('.md', ''))
                .sort()
                .reverse(); // Most recent first
        } catch (error) {
            logger.error(`Failed to list daily memories: ${error}`);
            return [];
        }
    }

    /**
     * Read a specific daily memory file by date
     */
    public readDailyMemory(dateStr: string): string | null {
        const filePath = path.join(this.memoryDir, `${dateStr}.md`);
        return this.readMemoryFile(filePath);
    }

    /**
     * Helper to read a memory file
     */
    private readMemoryFile(filePath: string): string | null {
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
        } catch (error) {
            logger.error(`Failed to read memory file ${filePath}: ${error}`);
        }
        return null;
    }

    /**
     * Get summary statistics
     */
    public getStats(): {
        dailyFiles: number;
        hasLongTerm: boolean;
        memoryDir: string;
        longTermPath: string;
    } {
        return {
            dailyFiles: this.listDailyMemories().length,
            hasLongTerm: fs.existsSync(this.longTermMemoryPath),
            memoryDir: this.memoryDir,
            longTermPath: this.longTermMemoryPath
        };
    }
}
