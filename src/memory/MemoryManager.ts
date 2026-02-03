import fs from 'fs';
import { JSONAdapter } from '../storage/JSONAdapter';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { MultiLLM } from '../core/MultiLLM';
import path from 'path';
import os from 'os';

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
    private profilesDir: string;

    constructor(dbPath: string = './memory.json', userPath: string = './USER.md') {
        this.storage = new JSONAdapter(dbPath);
        this.loadUserContext(userPath);

        // Profiles directory in .orcbot
        const dataHome = path.join(os.homedir(), '.orcbot');
        this.profilesDir = path.join(dataHome, 'profiles');
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
        }
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
        const short = this.searchMemory('short');
        
        // Sort all by timestamp (most recent first)
        const sorted = [...short].sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta; // Descending (newest first)
        });
        
        // Take the most recent N
        const recentShort = sorted.slice(0, limit);
        
        // Return episodic summaries + recent short memories, with recent first
        return [...recentShort, ...episodic];
    }

    public getContactProfile(jid: string): string | null {
        const profilePath = path.join(this.profilesDir, `${jid.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
        if (fs.existsSync(profilePath)) {
            try {
                const content = fs.readFileSync(profilePath, 'utf-8');
                return content;
            } catch (e) {
                logger.error(`Error reading contact profile for ${jid}: ${e}`);
            }
        }
        return null;
    }

    public saveContactProfile(jid: string, content: string) {
        const profilePath = path.join(this.profilesDir, `${jid.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
        try {
            fs.writeFileSync(profilePath, content);
            logger.info(`Contact profile saved for ${jid}`);
        } catch (e) {
            logger.error(`Error saving contact profile for ${jid}: ${e}`);
        }
    }
}
