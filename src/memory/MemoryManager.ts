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
    
    // Configurable limits (can be updated via setLimits)
    private contextLimit: number = 20;
    private episodicLimit: number = 5;
    private consolidationThreshold: number = 30;
    private consolidationBatch: number = 20;

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

    /**
     * Configure memory limits. Call this after construction with config values.
     */
    public setLimits(options: {
        contextLimit?: number;
        episodicLimit?: number;
        consolidationThreshold?: number;
        consolidationBatch?: number;
    }) {
        if (options.contextLimit) this.contextLimit = options.contextLimit;
        if (options.episodicLimit) this.episodicLimit = options.episodicLimit;
        if (options.consolidationThreshold) this.consolidationThreshold = options.consolidationThreshold;
        if (options.consolidationBatch) this.consolidationBatch = options.consolidationBatch;
        logger.info(`MemoryManager limits: context=${this.contextLimit}, episodic=${this.episodicLimit}, consolidationThreshold=${this.consolidationThreshold}, consolidationBatch=${this.consolidationBatch}`);
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
        if (shortMemories.length < this.consolidationThreshold) return;

        logger.info(`MemoryManager: Consolidation threshold reached (${this.consolidationThreshold}). Compressing old memories...`);

        const toSummarize = shortMemories.slice(0, this.consolidationBatch);

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
            content: `Summary of ${this.consolidationBatch} historical events: ${summary}`
        });

        // Remove the consolidated short-term memories
        const allMemories = this.storage.get('memories') || [];
        const toSummarizeIds = new Set(toSummarize.map(m => m.id));
        const filtered = allMemories.filter((m: any) => !toSummarizeIds.has(m.id));
        this.storage.save('memories', filtered);

        logger.info(`MemoryManager: Consolidated ${this.consolidationBatch} memories into 1 episodic summary.`);
    }

    public getMemory(id: string): MemoryEntry | null {
        const memories = this.storage.get('memories') || [];
        return memories.find((m: MemoryEntry) => m.id === id) || null;
    }

    public searchMemory(type: 'short' | 'long' | 'episodic'): MemoryEntry[] {
        const memories = this.storage.get('memories') || [];
        return memories.filter((m: MemoryEntry) => m.type === type);
    }

    public getRecentContext(limit?: number): MemoryEntry[] {
        const effectiveLimit = limit ?? this.contextLimit;
        const episodic = this.searchMemory('episodic').slice(-this.episodicLimit);
        const short = this.searchMemory('short');
        
        // Sort all by timestamp (most recent first)
        const sorted = [...short].sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta; // Descending (newest first)
        });
        
        // Take the most recent N
        const recentShort = sorted.slice(0, effectiveLimit);
        
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
            // If content is a JSON string, parse and enhance it with metadata
            let profileData: any;
            try {
                profileData = JSON.parse(content);
            } catch {
                // If not JSON, wrap it in a simple structure
                profileData = { notes: content };
            }
            
            // Add/update metadata
            profileData.jid = jid;
            profileData.lastUpdated = new Date().toISOString();
            if (!profileData.createdAt) {
                profileData.createdAt = new Date().toISOString();
            }
            
            // Save as formatted JSON
            fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
            logger.info(`Contact profile saved for ${jid}`);
        } catch (e) {
            logger.error(`Error saving contact profile for ${jid}: ${e}`);
        }
    }

    public listContactProfiles(): string[] {
        try {
            const files = fs.readdirSync(this.profilesDir);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', '').replace(/_/g, ''));
        } catch (e) {
            logger.error(`Error listing contact profiles: ${e}`);
            return [];
        }
    }
}
