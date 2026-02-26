import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface BookLogEntry {
    id: string;
    title: string;
    source: string;
    dateRead: string;
    summary: string;
    tags: string[];
    keyExcerpts: string[];
    insights: string[];
    documentId?: string; // Link to raw KnowledgeStore document
}

/**
 * BookLogManager - Manages high-level abstractive summaries of ingested resources.
 * Acts as a middle layer between raw document chunks and active agent context.
 */
export class BookLogManager {
    private filePath: string;
    private entries: BookLogEntry[] = [];

    constructor(dataDir: string) {
        this.filePath = path.join(dataDir, 'book_log.json');
        this.load();
    }

    /**
     * Add a new entry to the book log.
     */
    public addEntry(entry: Omit<BookLogEntry, 'id' | 'dateRead'>): BookLogEntry {
        const newEntry: BookLogEntry = {
            ...entry,
            id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            dateRead: new Date().toISOString()
        };
        this.entries.push(newEntry);
        this.save();
        logger.info(`BookLog: Added entry for "${newEntry.title}"`);
        return newEntry;
    }

    /**
     * Search the book log by title, tags, or content.
     */
    public search(query: string): BookLogEntry[] {
        const q = query.toLowerCase();
        return this.entries.filter(e => 
            e.title.toLowerCase().includes(q) ||
            e.tags.some(t => t.toLowerCase().includes(q)) ||
            e.summary.toLowerCase().includes(q)
        ).sort((a, b) => b.dateRead.localeCompare(a.dateRead));
    }

    /**
     * Get recent entries for context.
     */
    public getRecent(limit: number = 5): BookLogEntry[] {
        return [...this.entries]
            .sort((a, b) => b.dateRead.localeCompare(a.dateRead))
            .slice(0, limit);
    }

    /**
     * Delete an entry.
     */
    public deleteEntry(id: string): boolean {
        const initialLen = this.entries.length;
        this.entries = this.entries.filter(e => e.id !== id);
        if (this.entries.length < initialLen) {
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Load log from disk.
     */
    private load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                this.entries = JSON.parse(data);
            } catch (e) {
                logger.error(`BookLog: Failed to load: ${e}`);
                this.entries = [];
            }
        }
    }

    /**
     * Save log to disk.
     */
    private save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
        } catch (e) {
            logger.error(`BookLog: Failed to save: ${e}`);
        }
    }

    /**
     * Format entries for inclusion in a prompt.
     */
    public formatForPrompt(entries: BookLogEntry[]): string {
        if (entries.length === 0) return '';
        
        return entries.map(e => {
            const insightsStr = e.insights.map(i => `- ${i}`).join('\n');
            const excerptsStr = e.keyExcerpts.map(ex => `> ${ex}`).join('\n');
            
            return `--- BOOK LOG ENTRY ---
TITLE: ${e.title}
SOURCE: ${e.source}
DATE: ${e.dateRead.split('T')[0]}
TAGS: ${e.tags.join(', ')}
SUMMARY: ${e.summary}
INSIGHTS:
${insightsStr}
KEY EXCERPTS:
${excerptsStr}
----------------------`;
        }).join('\n\n');
    }
}
