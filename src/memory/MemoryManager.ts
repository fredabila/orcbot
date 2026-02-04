import fs from 'fs';
import { JSONAdapter } from '../storage/JSONAdapter';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { MultiLLM } from '../core/MultiLLM';
import path from 'path';
import os from 'os';
import { DailyMemory } from './DailyMemory';

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
    private dailyMemory: DailyMemory;
    private lastMemoryFlushAt: number = 0;
    private memoryFlushEnabled: boolean = true;
    
    // Configurable limits (can be updated via setLimits)
    private contextLimit: number = 20;
    private episodicLimit: number = 5;
    private consolidationThreshold: number = 30;
    private consolidationBatch: number = 20;
    private memoryFlushSoftThreshold: number = 25; // Trigger flush at this many memories

    constructor(dbPath: string = './memory.json', userPath: string = './USER.md') {
        this.storage = new JSONAdapter(dbPath);
        this.loadUserContext(userPath);

        // Profiles directory in .orcbot
        const dataHome = path.join(os.homedir(), '.orcbot');
        this.profilesDir = path.join(dataHome, 'profiles');
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
        }

        // Initialize daily memory system
        this.dailyMemory = new DailyMemory(dataHome);
    }

    /**
     * Configure memory limits. Call this after construction with config values.
     */
    public setLimits(options: {
        contextLimit?: number;
        episodicLimit?: number;
        consolidationThreshold?: number;
        consolidationBatch?: number;
        memoryFlushSoftThreshold?: number;
        memoryFlushEnabled?: boolean;
    }) {
        if (options.contextLimit) this.contextLimit = options.contextLimit;
        if (options.episodicLimit) this.episodicLimit = options.episodicLimit;
        if (options.consolidationThreshold) this.consolidationThreshold = options.consolidationThreshold;
        if (options.consolidationBatch) this.consolidationBatch = options.consolidationBatch;
        if (options.memoryFlushSoftThreshold) this.memoryFlushSoftThreshold = options.memoryFlushSoftThreshold;
        if (typeof options.memoryFlushEnabled === 'boolean') this.memoryFlushEnabled = options.memoryFlushEnabled;
        logger.info(`MemoryManager limits: context=${this.contextLimit}, episodic=${this.episodicLimit}, consolidationThreshold=${this.consolidationThreshold}, consolidationBatch=${this.consolidationBatch}, memoryFlush=${this.memoryFlushEnabled}`);
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

        // Also save important memories to daily log
        if (entry.type === 'long' || entry.metadata?.important) {
            const category = entry.metadata?.category || 'Important';
            this.dailyMemory.appendToDaily(entry.content, category);
        }
    }

    /**
     * Memory flush - reminds agent to write important memories before consolidation
     * Inspired by OpenClaw's automatic memory flush system
     */
    public async memoryFlush(llm: MultiLLM): Promise<boolean> {
        if (!this.memoryFlushEnabled) return false;

        const shortMemories = this.searchMemory('short');
        
        // Check if we're approaching consolidation threshold
        if (shortMemories.length < this.memoryFlushSoftThreshold) {
            return false;
        }

        // Prevent frequent flushes (at most once per 30 minutes)
        const now = Date.now();
        if (now - this.lastMemoryFlushAt < 30 * 60 * 1000) {
            return false;
        }

        this.lastMemoryFlushAt = now;
        logger.info('MemoryManager: Triggering memory flush - approaching consolidation threshold');

        try {
            // Get recent context for the flush
            const recentContext = shortMemories
                .slice(-10)
                .map(m => `[${m.timestamp}] ${m.content}`)
                .join('\n');

            const flushPrompt = `
# Memory Flush Reminder

The conversation history is approaching the consolidation threshold. Please review recent context and identify any important information that should be stored in long-term memory.

## Recent Context:
${recentContext}

## Instructions:
1. Identify key facts, preferences, or decisions that should be remembered long-term
2. If there are important items, use memory_write to store them
3. Focus on durable information (user preferences, important decisions, learned facts)
4. Ignore temporary conversation context

If there's nothing important to remember, reply with: NO_MEMORY_TO_STORE
Otherwise, write the important information to memory and confirm.
`;

            const response = await llm.call(
                flushPrompt,
                "You are a memory management assistant. Your job is to identify and store important information before it's consolidated."
            );

            logger.info(`Memory flush response: ${response.substring(0, 100)}...`);
            
            // Store the flush event in daily log
            this.dailyMemory.appendToDaily(
                `Memory flush triggered. Response: ${response.substring(0, 200)}...`,
                'System'
            );

            return true;
        } catch (error) {
            logger.error(`Memory flush failed: ${error}`);
            return false;
        }
    }

    public async consolidate(llm: MultiLLM) {
        const shortMemories = this.searchMemory('short');
        if (shortMemories.length < this.consolidationThreshold) return;

        // Try to flush memory before consolidation
        await this.memoryFlush(llm);

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

        // Save episodic summary to both JSON and daily log
        this.saveMemory({
            id: `summary-${Date.now()}`,
            type: 'episodic',
            content: `Summary of ${this.consolidationBatch} historical events: ${summary}`
        });

        // Also store in daily log
        this.dailyMemory.appendToDaily(
            `Consolidated ${this.consolidationBatch} memories:\n\n${summary}`,
            'Consolidation'
        );

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
                .map(f => {
                    // Read the profile file to get the actual JID
                    const profilePath = path.join(this.profilesDir, f);
                    try {
                        const content = fs.readFileSync(profilePath, 'utf-8');
                        const profile = JSON.parse(content);
                        return profile.jid || f.replace('.json', '');
                    } catch (e) {
                        // Fallback to filename if profile can't be parsed
                        return f.replace('.json', '');
                    }
                });
        } catch (e) {
            logger.error(`Error listing contact profiles: ${e}`);
            return [];
        }
    }

    /**
     * Get daily memory instance for direct access
     */
    public getDailyMemory(): DailyMemory {
        return this.dailyMemory;
    }

    /**
     * Get context including daily memory for agent prompts
     */
    public getExtendedContext(): string {
        const parts: string[] = [];

        // Add recent daily memory context
        const dailyContext = this.dailyMemory.readRecentContext();
        if (dailyContext) {
            parts.push('## Recent Daily Memory\n\n' + dailyContext);
        }

        // Add long-term memory
        const longTerm = this.dailyMemory.readLongTerm();
        if (longTerm) {
            parts.push('## Long-Term Memory\n\n' + longTerm.substring(0, 2000)); // Limit size
        }

        return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
    }
}
