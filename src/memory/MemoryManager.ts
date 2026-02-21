import fs from 'fs';
import { JSONAdapter } from '../storage/JSONAdapter';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { MultiLLM } from '../core/MultiLLM';
import path from 'path';
import { DailyMemory } from './DailyMemory';
import { VectorMemory, ScoredVectorEntry } from './VectorMemory';

dotenv.config();

export interface MemoryEntry {
    id: string;
    type: 'short' | 'long' | 'episodic';
    content: string;
    metadata?: any;
    timestamp?: string;
}

interface ConversationContext {
    platform?: string;
    contactId?: string;
    username?: string;
    sessionScopeId?: string;
    messageType?: string;
    statusContext?: string;
    threadId?: string;
}

export class MemoryManager {
    private storage: JSONAdapter;
    private userContext: any = {};
    private profilesDir: string;
    private dailyMemory: DailyMemory;
    private dataHome: string;
    private lastMemoryFlushAt: number = 0;
    private memoryFlushEnabled: boolean = true;
    public vectorMemory: VectorMemory | null = null;

    // Configurable limits (can be updated via setLimits)
    private contextLimit: number = 20;
    private episodicLimit: number = 5;
    private consolidationThreshold: number = 30;
    private consolidationBatch: number = 20;
    private memoryFlushSoftThreshold: number = 25;  // Trigger flush at this many memories
    private memoryFlushCooldownMinutes: number = 30; // Min minutes between flushes
    private memoryContentMaxLength: number = 1500;   // Hard truncation for stored content (1500 allows full tool observations; step memories are ephemeral)
    private memoryExtendedContextLimit: number = 2000; // Max chars of long-term memory in extended context
    private interactionBatchSize: number = 12;
    private interactionStaleMinutes: number = 10;
    private memoryDedupWindowMinutes: number = 5;
    private userExchangeDefaultLimit: number = 8;
    private pendingConsolidation: Map<string, MemoryEntry[]> = new Map();
    private interactionCache: Map<string, { expiresAt: number; entries: ScoredVectorEntry[] }> = new Map();

    constructor(dbPath: string = './memory.json', userPath: string = './USER.md') {
        this.storage = new JSONAdapter(dbPath);
        this.loadUserContext(userPath);

        // Derive data directory from the configured memory database location.
        // This keeps *all* file-backed state co-located (and supports ORCBOT_DATA_DIR).
        const dataHome = path.dirname(path.resolve(dbPath));
        this.dataHome = dataHome;
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
        memoryFlushCooldownMinutes?: number;
        memoryContentMaxLength?: number;
        memoryExtendedContextLimit?: number;
        interactionBatchSize?: number;
        interactionStaleMinutes?: number;
        memoryDedupWindowMinutes?: number;
        userExchangeDefaultLimit?: number;
    }) {
        if (typeof options.contextLimit === 'number') this.contextLimit = options.contextLimit;
        if (typeof options.episodicLimit === 'number') this.episodicLimit = options.episodicLimit;
        if (typeof options.consolidationThreshold === 'number') this.consolidationThreshold = options.consolidationThreshold;
        if (typeof options.consolidationBatch === 'number') this.consolidationBatch = options.consolidationBatch;
        if (typeof options.memoryFlushSoftThreshold === 'number') this.memoryFlushSoftThreshold = options.memoryFlushSoftThreshold;
        if (typeof options.memoryFlushEnabled === 'boolean') this.memoryFlushEnabled = options.memoryFlushEnabled;
        if (typeof options.memoryFlushCooldownMinutes === 'number') this.memoryFlushCooldownMinutes = options.memoryFlushCooldownMinutes;
        if (typeof options.memoryContentMaxLength === 'number') this.memoryContentMaxLength = options.memoryContentMaxLength;
        if (typeof options.memoryExtendedContextLimit === 'number') this.memoryExtendedContextLimit = options.memoryExtendedContextLimit;
        if (typeof options.interactionBatchSize === 'number') this.interactionBatchSize = options.interactionBatchSize;
        if (typeof options.interactionStaleMinutes === 'number') this.interactionStaleMinutes = options.interactionStaleMinutes;
        if (typeof options.memoryDedupWindowMinutes === 'number') this.memoryDedupWindowMinutes = options.memoryDedupWindowMinutes;
        if (typeof options.userExchangeDefaultLimit === 'number') this.userExchangeDefaultLimit = options.userExchangeDefaultLimit;
        logger.info(`MemoryManager limits: context=${this.contextLimit}, episodic=${this.episodicLimit}, consolidationThreshold=${this.consolidationThreshold}, consolidationBatch=${this.consolidationBatch}, memoryFlush=${this.memoryFlushEnabled}, flushCooldown=${this.memoryFlushCooldownMinutes}m, contentMax=${this.memoryContentMaxLength}`);
    }

    /**
     * Initialize vector memory for semantic search.
     * Call after construction with API keys from config.
     * If no embedding API key is available, vector memory silently remains disabled.
     */
    public initVectorMemory(config: { openaiApiKey?: string; googleApiKey?: string; preferredProvider?: string; dimensions?: number; maxEntries?: number }): void {
        const vectorPath = path.join(this.dataHome, 'vector_memory.json');
        this.vectorMemory = new VectorMemory(vectorPath, {
            openaiApiKey: config.openaiApiKey,
            googleApiKey: config.googleApiKey,
            preferredProvider: config.preferredProvider,
            dimensions: config.dimensions,
            maxEntries: config.maxEntries
        });
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
        const ts = new Date().toISOString();
        const maxContentLength = this.memoryContentMaxLength;
        const rawContent = (entry.content || '').toString();
        const content = rawContent.length > maxContentLength
            ? `${rawContent.slice(0, maxContentLength)}...[truncated]`
            : rawContent;

        const normalizedEntry: MemoryEntry = {
            ...entry,
            content,
            metadata: {
                ...(entry.metadata || {}),
                memoryContentTruncated: rawContent.length > maxContentLength ? true : (entry.metadata?.memoryContentTruncated || false)
            }
        };

        if (this.isDuplicateMemory(normalizedEntry, memories)) {
            logger.debug(`MemoryManager: Deduplicated repeated memory event ${entry.id}`);
            return;
        }

        memories.push({ ...normalizedEntry, timestamp: ts });
        this.storage.save('memories', memories);
        logger.info(`Memory saved: [${entry.type}] ${entry.id}${rawContent.length > maxContentLength ? ' (truncated)' : ''}`);

        // Queue for vector embedding (non-blocking, skips short/system content automatically)
        if (this.vectorMemory?.isEnabled()) {
            this.vectorMemory.queue(normalizedEntry.id, normalizedEntry.content, normalizedEntry.type, normalizedEntry.metadata, ts);
        }

        this.trackInteractionForConsolidation({ ...normalizedEntry, timestamp: ts });
        this.upsertContactProfileFromMemory({ ...normalizedEntry, timestamp: ts });

        // Also save important memories to daily log
        if (normalizedEntry.type === 'long' || normalizedEntry.metadata?.important) {
            const category = normalizedEntry.metadata?.category || 'Important';
            this.dailyMemory.appendToDaily(normalizedEntry.content, category);
        }
    }

    private isDuplicateMemory(entry: MemoryEntry, existingMemories: MemoryEntry[]): boolean {
        const md = entry.metadata || {};
        const dedupKey = md.messageId || md.eventId || md.statusMessageId;
        const cutoff = Date.now() - (this.memoryDedupWindowMinutes * 60 * 1000);
        return existingMemories.some((candidate: MemoryEntry) => {
            const ts = candidate.timestamp ? new Date(candidate.timestamp).getTime() : 0;
            if (ts < cutoff) return false;
            const cmd = candidate.metadata || {};
            if (dedupKey && (cmd.messageId === dedupKey || cmd.eventId === dedupKey || cmd.statusMessageId === dedupKey)) {
                return true;
            }
            const sameSource = (cmd.source || '') === (md.source || '');
            const sameContact = (cmd.sourceId || cmd.senderId || '') === (md.sourceId || md.senderId || '');
            return sameSource && sameContact && (candidate.content || '') === (entry.content || '');
        });
    }

    private buildInteractionKey(entry: MemoryEntry): string | null {
        const md = entry.metadata || {};
        const source = (md.source || '').toString().toLowerCase();
        const contact = (md.sourceId || md.senderId || md.userId || '').toString();
        if (!source || !contact) return null;
        return `${source}:${contact}`;
    }

    private trackInteractionForConsolidation(entry: MemoryEntry): void {
        if (entry.type !== 'short') return;
        const key = this.buildInteractionKey(entry);
        if (!key) return;
        const bucket = this.pendingConsolidation.get(key) || [];
        bucket.push(entry);
        this.pendingConsolidation.set(key, bucket.slice(-Math.max(this.interactionBatchSize * 2, 20)));
    }

    public async consolidateInteractions(llm: MultiLLM, reason: 'threshold' | 'heartbeat' | 'session_end' = 'heartbeat'): Promise<number> {
        let consolidated = 0;
        const now = Date.now();
        const staleMs = this.interactionStaleMinutes * 60 * 1000;
        for (const [key, entries] of this.pendingConsolidation.entries()) {
            if (entries.length === 0) continue;
            const newestTs = new Date(entries[entries.length - 1].timestamp || 0).getTime();
            const isStale = now - newestTs >= staleMs;
            const shouldRun = entries.length >= this.interactionBatchSize || isStale || reason === 'session_end';
            if (!shouldRun) continue;

            const tail = entries.slice(-this.interactionBatchSize);
            const summary = await this.summarizeInteractionBatch(llm, tail, key, reason);
            this.saveMemory(summary);
            this.pendingConsolidation.delete(key);
            consolidated++;
        }
        return consolidated;
    }

    private async summarizeInteractionBatch(llm: MultiLLM, entries: MemoryEntry[], key: string, reason: string): Promise<MemoryEntry> {
        const [platform, contactId] = key.split(':');
        const structuredContext = entries.map((e) => {
            const md = e.metadata || {};
            return {
                t: e.timestamp,
                role: md.role || 'event',
                messageType: md.messageType || md.type || 'text',
                statusContext: md.statusContext || md.statusReplyTo || undefined,
                content: (e.content || '').toString().slice(0, 280)
            };
        });
        const prompt = `Create a concise episodic memory JSON with keys: summary, facts, pending, tone, preferences, confidence(0-1).
Context platform=${platform}, contact=${contactId}, reason=${reason}.
Events:\n${JSON.stringify(structuredContext, null, 2)}`;
        let llmSummary = 'No summary available.';
        try {
            llmSummary = await llm.call(prompt, 'You consolidate social conversations into durable memory. Keep summary brief and factual.');
        } catch (e) {
            logger.warn(`MemoryManager: interaction consolidation fallback for ${key}: ${e}`);
            llmSummary = structuredContext.map(s => `${s.role}: ${s.content}`).join(' | ').slice(0, 600);
        }
        return {
            id: `episodic-${platform}-${contactId}-${Date.now()}`,
            type: 'episodic',
            content: `Interaction summary (${platform}/${contactId}): ${llmSummary}`,
            metadata: {
                source: platform,
                sourceId: contactId,
                reason,
                interactionCount: entries.length,
                structured: true,
                messageTypes: [...new Set(entries.map(e => (e.metadata?.messageType || e.metadata?.type || 'text').toString()))],
                timeRange: {
                    from: entries[0]?.timestamp,
                    to: entries[entries.length - 1]?.timestamp
                }
            }
        };
    }

    /**
     * Force pending memory writes to disk immediately.
     * Call at step boundaries, action completion, or shutdown.
     */
    public flushToDisk(): void {
        this.storage.flush();
    }

    /**
     * Shut down memory system cleanly: flush all pending writes.
     */
    public shutdown(): void {
        this.storage.shutdown();
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

        // Prevent frequent flushes (cooldown is configurable)
        const now = Date.now();
        if (now - this.lastMemoryFlushAt < this.memoryFlushCooldownMinutes * 60 * 1000) {
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

        // Preserve metadata index: which conversations, channels, and contacts are referenced
        const metaIndex: { sources: Set<string>; contacts: Set<string>; skills: Set<string> } = {
            sources: new Set(),
            contacts: new Set(),
            skills: new Set()
        };
        for (const m of toSummarize) {
            if (m.metadata?.source) metaIndex.sources.add(m.metadata.source);
            if (m.metadata?.sourceId) metaIndex.contacts.add(m.metadata.sourceId);
            if (m.metadata?.senderId) metaIndex.contacts.add(m.metadata.senderId);
            if (m.metadata?.tool) metaIndex.skills.add(m.metadata.tool);
        }

        const summaryPrompt = `
Summarize the following conversation history concisely. 
Identify key actions taken, facts learned, and the current state of tasks.
Keep it as a narrative historical log.

History:
${toSummarize.map(m => `[${m.timestamp}] ${m.content}`).join('\n')}
`;
        const summary = await llm.call(summaryPrompt, "You are a memory consolidation engine.");

        // Save episodic summary WITH metadata so thread context can still find it
        this.saveMemory({
            id: `summary-${Date.now()}`,
            type: 'episodic',
            content: `Summary of ${this.consolidationBatch} historical events: ${summary}`,
            metadata: {
                consolidatedFrom: toSummarize.length,
                sources: Array.from(metaIndex.sources),
                contacts: Array.from(metaIndex.contacts),
                skills: Array.from(metaIndex.skills),
                timeRange: {
                    from: toSummarize[0]?.timestamp,
                    to: toSummarize[toSummarize.length - 1]?.timestamp
                }
            }
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

        await this.consolidateInteractions(llm, 'threshold');
    }

    public getMemory(id: string): MemoryEntry | null {
        const memories = this.storage.get('memories') || [];
        return memories.find((m: MemoryEntry) => m.id === id) || null;
    }

    public searchMemory(type: 'short' | 'long' | 'episodic', sessionScopeId?: string): MemoryEntry[] {
        const memories = this.storage.get('memories') || [];
        return memories.filter((m: MemoryEntry) => {
            if (m.type !== type) return false;
            if (sessionScopeId && m.metadata?.sessionScopeId !== sessionScopeId) return false;
            return true;
        });
    }

    /**
     * Delete a specific memory by its ID.
     */
    public deleteMemory(id: string): boolean {
        const allMemories = this.storage.get('memories') || [];
        const before = allMemories.length;
        const filtered = allMemories.filter((m: MemoryEntry) => m.id !== id);

        if (filtered.length < before) {
            this.storage.save('memories', filtered);
            // Also remove from vector store if enabled
            if (this.vectorMemory?.isEnabled()) {
                this.vectorMemory.remove([id]);
            }
            return true;
        }
        return false;
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
        const qualityShort = this.filterContextMemories(recentShort);
        const qualityEpisodic = this.filterContextMemories(episodic);

        // Return episodic summaries + recent short memories, with recent first
        return [...qualityShort, ...qualityEpisodic];
    }

    /**
     * Lightweight memory quality controller for prompt injection:
     * - remove exact duplicate content
     * - throttle repetitive [SYSTEM:] memories per skill/tool
     */
    private filterContextMemories(memories: MemoryEntry[]): MemoryEntry[] {
        const seenContent = new Set<string>();
        const systemPerSkill = new Map<string, number>();
        const filtered: MemoryEntry[] = [];

        for (const m of memories) {
            const content = (m.content || '').toString().trim();
            const normalized = content.toLowerCase().replace(/\s+/g, ' ');
            if (!normalized) continue;

            // 1) Exact duplicate suppression
            if (seenContent.has(normalized)) continue;
            seenContent.add(normalized);

            // 2) System-noise throttling (keep at most 2 system notes per tool/skill)
            const isSystem = normalized.startsWith('[system:');
            if (isSystem) {
                const skillKey = String(m.metadata?.skill || m.metadata?.tool || 'system');
                const count = systemPerSkill.get(skillKey) || 0;
                if (count >= 2) continue;
                systemPerSkill.set(skillKey, count + 1);
            }

            filtered.push(m);
        }

        return filtered;
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

    private upsertContactProfileFromMemory(entry: MemoryEntry): void {
        const md = entry.metadata || {};
        const source = (md.source || '').toString();
        const contactId = (md.sourceId || md.senderId || md.userId || '').toString();
        if (!source || !contactId) return;
        const profileKey = `${source}:${contactId}`;
        const existingRaw = this.getContactProfile(profileKey);
        let profile: any = {};
        if (existingRaw) {
            try { profile = JSON.parse(existingRaw); } catch { profile = { notes: existingRaw }; }
        }

        profile.identity = profile.identity || {};
        profile.identity.primary = profile.identity.primary || { platform: source, id: contactId };
        profile.identity.aliases = Array.isArray(profile.identity.aliases) ? profile.identity.aliases : [];
        if (!profile.identity.aliases.find((a: any) => a.platform === source && a.id === contactId)) {
            profile.identity.aliases.push({ platform: source, id: contactId, seenAt: entry.timestamp });
        }
        if (md.senderName || md.username) {
            profile.displayName = md.senderName || md.username;
        }
        profile.lastSeenAt = entry.timestamp;
        profile.lastMessageType = md.messageType || md.type || profile.lastMessageType;
        profile.platform = source;
        profile.platformIds = profile.platformIds || {};
        profile.platformIds[source] = contactId;
        if (md.crossPlatformHint) {
            profile.crossPlatformHints = Array.isArray(profile.crossPlatformHints) ? profile.crossPlatformHints : [];
            profile.crossPlatformHints.push({ hint: md.crossPlatformHint, timestamp: entry.timestamp });
            profile.crossPlatformHints = profile.crossPlatformHints.slice(-20);
        }
        this.saveContactProfile(profileKey, JSON.stringify(profile));
    }

    public getUserRecentExchanges(context: ConversationContext, limit?: number): MemoryEntry[] {
        const source = (context.platform || '').toLowerCase();
        const contact = (context.contactId || '').toString();
        if (!source || !contact) return [];
        const max = Math.max(2, limit ?? this.userExchangeDefaultLimit);
        return this.searchMemory('short')
            .filter((m) => {
                const md = m.metadata || {};
                const mSource = (md.source || '').toString().toLowerCase();
                const mContact = (md.sourceId || md.senderId || md.userId || md.chatId || '').toString();
                return mSource === source && mContact === contact;
            })
            .sort((a, b) => (new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()))
            .slice(0, max)
            .reverse();
    }

    public getUnresolvedThreads(context: ConversationContext, limit: number = 5): MemoryEntry[] {
        const exchanges = this.getUserRecentExchanges(context, 30);
        const unresolved = exchanges.filter((m) => {
            const content = (m.content || '').toLowerCase();
            return content.includes('pending') || content.includes('todo') || content.includes('follow up') || content.includes('need to') || content.includes('unresolved');
        });
        return unresolved.slice(-limit);
    }

    public async warmConversationCache(context: ConversationContext, query: string, topK: number = 6): Promise<ScoredVectorEntry[]> {
        if (!this.vectorMemory?.isEnabled()) return [];
        const source = (context.platform || '').toLowerCase();
        const contact = (context.contactId || '').toString();
        const key = `${source}:${contact}:${query}`;
        const now = Date.now();
        const cached = this.interactionCache.get(key);
        if (cached && cached.expiresAt > now) return cached.entries;

        const filterSource = source || undefined;
        const hits = await this.semanticSearch(query, Math.max(topK * 2, 8), { source: filterSource });
        const ranked = hits
            .filter(h => {
                if (!contact) return true;
                const md = h.metadata || {};
                const mContact = (md.sourceId || md.senderId || md.userId || md.chatId || '').toString();
                return mContact === contact;
            })
            .map(h => ({ ...h, score: this.applyRecencyBoost(h.score, h.timestamp) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        this.interactionCache.set(key, { expiresAt: now + 60_000, entries: ranked });
        return ranked;
    }

    private applyRecencyBoost(score: number, timestamp?: string): number {
        if (!timestamp) return score;
        const ageHours = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60));
        const recencyWeight = Math.exp(-ageHours / 72); // ~3 day half-life
        return (score * 0.8) + (recencyWeight * 0.2);
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
     * Get all memories for a specific action (step observations + system injections).
     * This is the authoritative source for action-scoped context.
     */
    public getActionMemories(actionId: string): MemoryEntry[] {
        const prefix = `${actionId}-step-`;
        const all = this.searchMemory('short');
        return all.filter(m => m.id && m.id.startsWith(prefix))
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return ta - tb; // Chronological (oldest first)
            });
    }

    /**
     * Count how many step-observation memories exist for an action.
     * Useful for deciding when to compact step history.
     */
    public getActionStepCount(actionId: string): number {
        const prefix = `${actionId}-step-`;
        const all = this.searchMemory('short');
        return all.filter(m => m.id && m.id.startsWith(prefix)).length;
    }

    /**
     * Remove all step-scoped memories for a completed action.
     * Prevents stale action context from polluting future decisions.
     * Should be called after an action completes and its episodic summary is saved.
     */
    public cleanupActionMemories(actionId: string): number {
        const prefix = `${actionId}-step-`;
        const allMemories = this.storage.get('memories') || [];
        const before = allMemories.length;
        const removedIds: string[] = [];
        const filtered = allMemories.filter((m: MemoryEntry) => {
            if (m.id && m.id.startsWith(prefix)) {
                removedIds.push(m.id);
                return false;
            }
            return true;
        });
        if (filtered.length < before) {
            this.storage.save('memories', filtered);
            // Also remove from vector store
            if (this.vectorMemory?.isEnabled() && removedIds.length > 0) {
                this.vectorMemory.remove(removedIds);
            }
            logger.info(`MemoryManager: Cleaned up ${removedIds.length} step memories for completed action ${actionId}`);
            return removedIds.length;
        }
        return 0;
    }

    /**
     * Semantic search over all indexed memories using vector embeddings.
     * Returns results ranked by cosine similarity to the query.
     * Falls back to empty array if vector memory is not enabled.
     */
    public async semanticSearch(
        query: string,
        limit: number = 10,
        filter?: { type?: string; source?: string; excludeIds?: Set<string> }
    ): Promise<ScoredVectorEntry[]> {
        if (!this.vectorMemory?.isEnabled()) return [];
        const hits = await this.vectorMemory.search(query, limit, filter);
        return hits
            .map(h => ({ ...h, score: this.applyRecencyBoost(h.score, h.timestamp) }))
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Semantic recall — deep long-term memory retrieval across ALL memory types.
     * Unlike semanticSearch which is typically filtered by source, this searches
     * the entire vector store for the most relevant memories regardless of channel.
     * 
     * Returns deduplicated results excluding specified IDs (e.g., already-shown memories).
     * This is the agent's "remember anything relevant" capability.
     */
    public async semanticRecall(
        query: string,
        limit: number = 8,
        excludeIds?: Set<string>
    ): Promise<ScoredVectorEntry[]> {
        if (!this.vectorMemory?.isEnabled()) return [];
        try {
            const results = await this.vectorMemory.search(query, limit * 2, { excludeIds });
            // Filter out very low similarity hits (noise)
            const meaningful = results.filter(r => r.score > 0.25);
            return meaningful.slice(0, limit);
        } catch (e) {
            logger.warn(`MemoryManager: semanticRecall failed: ${e}`);
            return [];
        }
    }

    /**
     * Get semantically relevant episodic summaries for a given task.
     * Returns episodic memories ranked by relevance to the query, not just recency.
     * Falls back to recency-based retrieval if vector memory is unavailable.
     */
    public async getRelevantEpisodicMemories(
        query: string,
        limit: number = 5
    ): Promise<MemoryEntry[]> {
        if (!this.vectorMemory?.isEnabled()) {
            // Fallback: return most recent episodic memories
            return this.searchMemory('episodic').slice(-limit);
        }

        try {
            const semanticHits = await this.vectorMemory.search(query, limit * 2, { type: 'episodic' });
            if (semanticHits.length < 2) {
                // Not enough semantic hits — fall back to recency
                return this.searchMemory('episodic').slice(-limit);
            }

            // Cross-reference with actual memory entries to get full metadata
            const allEpisodic = this.searchMemory('episodic');
            const episodicById = new Map(allEpisodic.map(m => [m.id, m]));

            const relevant = semanticHits
                .map(h => episodicById.get(h.id))
                .filter(Boolean) as MemoryEntry[];

            // Always include the most recent episodic memory for continuity
            const mostRecent = allEpisodic.slice(-1);
            const merged: MemoryEntry[] = [];
            const seen = new Set<string>();
            for (const m of [...relevant, ...mostRecent]) {
                if (m.id && !seen.has(m.id)) {
                    seen.add(m.id);
                    merged.push(m);
                }
            }

            return merged.slice(0, limit);
        } catch (e) {
            logger.warn(`MemoryManager: getRelevantEpisodicMemories failed: ${e}`);
            return this.searchMemory('episodic').slice(-limit);
        }
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
            parts.push('## Long-Term Memory\n\n' + longTerm.substring(0, this.memoryExtendedContextLimit));
        }

        return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
    }
}
