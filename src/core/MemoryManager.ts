import fs from 'fs';
import { JSONAdapter } from '../storage/JSONAdapter';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';

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

    constructor() {
        const dbPath = process.env.MEMORY_DB_PATH || './memory.json';
        this.storage = new JSONAdapter(dbPath);
        this.loadUserContext();
    }

    private loadUserContext() {
        const userPath = process.env.USER_FILE_PATH || './USER.md';
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

    public getMemory(id: string): MemoryEntry | null {
        const memories = this.storage.get('memories') || [];
        return memories.find((m: MemoryEntry) => m.id === id) || null;
    }

    public searchMemory(type: 'short' | 'long' | 'episodic'): MemoryEntry[] {
        const memories = this.storage.get('memories') || [];
        return memories.filter((m: MemoryEntry) => m.type === type);
    }

    public getRecentContext(limit: number = 5): MemoryEntry[] {
        return this.searchMemory('short').slice(0, limit);
    }
}
