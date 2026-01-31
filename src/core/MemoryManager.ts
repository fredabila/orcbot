import fs from 'fs';
import { JSONAdapter } from '../storage/JSONAdapter';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { MultiLLM } from './MultiLLM';

dotenv.config();

export interface MemoryEntry {
    id: string;
    type: 'short' | 'long' | 'episodic';
    content: string;
    metadata?: any;
    timestamp?: string;
}

export class MemoryManager {
    private storage: JSONAdapter;
    private userContext: any = {};

    constructor(dbPath: string = './memory.json', userPath: string = './USER.md') {
        this.storage = new JSONAdapter(dbPath);
        this.loadUserContext(userPath);
    }

    public refreshUserContext(userPath: string) {
        this.loadUserContext(userPath);
    }

    private loadUserContext(userPath: string) {
        if (fs.existsSync(userPath)) {
            try {
                const content = fs.readFileSync(userPath, 'utf-8');
                this.userContext = { raw: content };
                logger.info('User context loaded from USER.md');
            } catch (error) {
                logger.error(`Error loading USER.md: ${error}`);
            }
        } else {
            logger.warn('USER.md not found. Starting with empty user context.');
        }
    }

    public getUserContext() {
        return this.userContext;
    }

    public saveMemory(entry: MemoryEntry) {
        const memories = this.storage.get('memories') || [];
        memories.push({ ...entry, timestamp: new Date().toISOString() });
        this.storage.save('memories', memories);
        logger.info(`Memory saved: [${entry.type}] ${entry.id}`);
    }

    public async consolidate(llm: MultiLLM) {
        const shortMemories = this.searchMemory('short');
        if (shortMemories.length < 30) return;

        logger.info('MemoryManager: Consolidation threshold reached (30). Compressing old memories...');

        const toSummarize = shortMemories.slice(0, 20);

        const summaryPrompt = `
Summarize the following conversation history concisely. 
Identify key actions taken, facts learned, and the current state of tasks.
Keep it as a narrative historical log.

History:
${toSummarize.map(m => `[${m.timestamp}] ${m.content}`).join('\n')}
`;
        const summary = await llm.call(summaryPrompt, "You are a memory consolidation engine.");

        // Save episodic summary
        this.saveMemory({
            id: `summary-${Date.now()}`,
            type: 'episodic',
            content: `Summary of 20 historical events: ${summary}`
        });

        // Remove the 20 short-term memories
        const allMemories = this.storage.get('memories') || [];
        const toSummarizeIds = new Set(toSummarize.map(m => m.id));
        const filtered = allMemories.filter((m: any) => !toSummarizeIds.has(m.id));
        this.storage.save('memories', filtered);

        logger.info(`MemoryManager: Consolidated 20 memories into 1 episodic summary.`);
    }

    public getMemory(id: string): MemoryEntry | null {
        const memories = this.storage.get('memories') || [];
        return memories.find((m: MemoryEntry) => m.id === id) || null;
    }

    public searchMemory(type: 'short' | 'long' | 'episodic'): MemoryEntry[] {
        const memories = this.storage.get('memories') || [];
        return memories.filter((m: MemoryEntry) => m.type === type);
    }

    public getRecentContext(limit: number = 20): MemoryEntry[] {
        const episodic = this.searchMemory('episodic').slice(-5); // Include last 5 summaries
        const short = this.searchMemory('short').slice(-limit);
        return [...episodic, ...short];
    }
}
