import fs from 'fs';
import { logger } from '../utils/logger';

/**
 * Lightweight file-backed vector memory for semantic search.
 * Computes embeddings via OpenAI or Google API, stores them as JSON,
 * and retrieves by cosine similarity.
 *
 * Design principles:
 * - Non-blocking: queue() returns immediately; embedding happens in background batches
 * - Graceful degradation: if no API key, silently becomes a no-op
 * - File-backed: atomic writes (temp→rename) with .bak recovery
 * - Zero extra deps: uses global fetch + cosine similarity math
 */

export interface VectorEntry {
    id: string;
    vector: number[];
    content: string;
    type: 'short' | 'long' | 'episodic';
    metadata?: any;
    timestamp: string;
}

export interface ScoredVectorEntry extends VectorEntry {
    score: number;
}

interface PendingEntry {
    id: string;
    content: string;
    type: string;
    metadata?: any;
    timestamp: string;
}

interface VectorMemoryConfig {
    openaiApiKey?: string;
    googleApiKey?: string;
    /** Hint which provider to prefer for embeddings. Follows llmProvider config. */
    preferredProvider?: string;
    dimensions?: number;
    maxEntries?: number;
    flushIntervalMs?: number;
}

export class VectorMemory {
    private entries: VectorEntry[] = [];
    private filePath: string;
    private backupPath: string;
    private pendingQueue: PendingEntry[] = [];
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private dimensions: number;
    private maxEntries: number;
    private provider: 'openai' | 'google' | 'none';
    private apiKey: string;
    private isProcessing: boolean = false;

    // Cache the last query embedding to avoid redundant API calls
    // (same task description across multiple steps of one action)
    private lastQueryText: string = '';
    private lastQueryVector: number[] | null = null;

    constructor(filePath: string, config: VectorMemoryConfig = {}) {
        this.filePath = filePath;
        this.backupPath = filePath + '.bak';
        this.dimensions = config.dimensions || 256;
        this.maxEntries = config.maxEntries || 5000;

        // Determine embedding provider.
        // If user has set llmProvider (e.g. 'google'), prefer that for embeddings too.
        // Otherwise default to whichever key is available (OpenAI first as it has
        // better batch embedding support).
        const preferGoogle = config.preferredProvider === 'google';
        if (preferGoogle && config.googleApiKey) {
            this.provider = 'google';
            this.apiKey = config.googleApiKey;
        } else if (config.openaiApiKey) {
            this.provider = 'openai';
            this.apiKey = config.openaiApiKey;
        } else if (config.googleApiKey) {
            this.provider = 'google';
            this.apiKey = config.googleApiKey;
        } else {
            this.provider = 'none';
            this.apiKey = '';
        }

        this.loadFromDisk();

        // Start periodic background flush
        if (this.provider !== 'none') {
            const interval = config.flushIntervalMs || 10000;
            this.flushTimer = setInterval(() => this.flush().catch(e =>
                logger.warn(`VectorMemory: Background flush error: ${e}`)
            ), interval);
            logger.info(`VectorMemory: Initialized with ${this.entries.length} vectors (provider: ${this.provider}, dims: ${this.dimensions})`);
        } else {
            logger.info(`VectorMemory: Disabled (no embedding API key configured)`);
        }
    }

    /**
     * Whether vector memory is active (has an embedding provider).
     */
    public isEnabled(): boolean {
        return this.provider !== 'none';
    }

    /**
     * Queue a memory for background embedding. Returns immediately.
     * Skips very short content and already-indexed entries.
     */
    public queue(id: string, content: string, type: string, metadata?: any, timestamp?: string): void {
        if (this.provider === 'none') return;
        if (!content || content.length < 20) return;
        // Don't re-embed existing entries
        if (this.entries.some(e => e.id === id)) return;
        // Don't double-queue
        if (this.pendingQueue.some(p => p.id === id)) return;

        this.pendingQueue.push({
            id,
            content: content.slice(0, 1000), // Cap embedding input
            type,
            metadata,
            timestamp: timestamp || new Date().toISOString()
        });
    }

    /**
     * Process the pending queue: embed texts in batch and index them.
     */
    public async flush(): Promise<void> {
        if (this.provider === 'none' || this.pendingQueue.length === 0 || this.isProcessing) return;

        this.isProcessing = true;
        const batch = this.pendingQueue.splice(0, 50); // Process up to 50 at a time

        try {
            const texts = batch.map(b => b.content);
            const vectors = await this.embedBatch(texts);

            let indexed = 0;
            for (let i = 0; i < batch.length; i++) {
                if (vectors[i]) {
                    this.entries.push({
                        id: batch[i].id,
                        vector: vectors[i]!,
                        content: batch[i].content,
                        type: batch[i].type as VectorEntry['type'],
                        metadata: batch[i].metadata,
                        timestamp: batch[i].timestamp
                    });
                    indexed++;
                }
            }

            // Evict oldest if over capacity
            if (this.entries.length > this.maxEntries) {
                const overage = this.entries.length - this.maxEntries;
                this.entries.splice(0, overage);
            }

            this.saveToDisk();
            if (indexed > 0) {
                logger.debug(`VectorMemory: Indexed ${indexed} entries (${this.entries.length} total, ${this.pendingQueue.length} pending)`);
            }
        } catch (e) {
            // Put failed batch back for retry
            this.pendingQueue.unshift(...batch);
            logger.warn(`VectorMemory: Embedding batch failed, will retry: ${e}`);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Semantic search: returns top N entries most similar to query.
     * Flushes pending entries first so fresh memories are searchable.
     */
    public async search(
        query: string,
        limit: number = 10,
        filter?: { type?: string; source?: string; excludeIds?: Set<string> }
    ): Promise<ScoredVectorEntry[]> {
        if (this.provider === 'none' || this.entries.length === 0) return [];

        // Flush pending first so fresh memories are searchable
        if (this.pendingQueue.length > 0) {
            await this.flush();
        }

        try {
            // Use cached query vector if same text (common: same task across steps)
            let queryVector: number[];
            if (query === this.lastQueryText && this.lastQueryVector) {
                queryVector = this.lastQueryVector;
            } else {
                const [vec] = await this.embedBatch([query]);
                if (!vec) return [];
                queryVector = vec;
                this.lastQueryText = query;
                this.lastQueryVector = queryVector;
            }

            let candidates = this.entries;

            // Apply filters
            if (filter?.type) {
                candidates = candidates.filter(e => e.type === filter.type);
            }
            if (filter?.source) {
                candidates = candidates.filter(e =>
                    e.metadata?.source === filter.source
                );
            }
            if (filter?.excludeIds) {
                candidates = candidates.filter(e => !filter.excludeIds!.has(e.id));
            }

            // Score and rank by cosine similarity
            const scored: ScoredVectorEntry[] = candidates.map(entry => ({
                ...entry,
                score: this.cosineSimilarity(queryVector, entry.vector)
            }));

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, limit);
        } catch (e) {
            logger.warn(`VectorMemory: Search failed: ${e}`);
            return [];
        }
    }

    /**
     * Remove entries by ID (e.g., when cleaning up completed action memories).
     */
    public remove(ids: string[]): void {
        if (this.provider === 'none') return;
        const idSet = new Set(ids);
        const before = this.entries.length;
        this.entries = this.entries.filter(e => !idSet.has(e.id));
        if (this.entries.length < before) {
            this.saveToDisk();
            logger.debug(`VectorMemory: Removed ${before - this.entries.length} entries`);
        }
        // Also remove from pending queue
        this.pendingQueue = this.pendingQueue.filter(p => !idSet.has(p.id));
    }

    /**
     * Get stats for diagnostics.
     */
    public getStats(): { indexed: number; pending: number; provider: string; dimensions: number } {
        return {
            indexed: this.entries.length,
            pending: this.pendingQueue.length,
            provider: this.provider,
            dimensions: this.dimensions
        };
    }

    /**
     * Graceful shutdown: stop timers and save current state.
     */
    public shutdown(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.entries.length > 0) {
            this.saveToDisk();
        }
        logger.info(`VectorMemory: Shutdown complete (${this.entries.length} vectors saved)`);
    }

    // ── Embedding API calls ──────────────────────────────────────

    private async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
        if (this.provider === 'openai') {
            return this.embedOpenAI(texts);
        } else if (this.provider === 'google') {
            return this.embedGoogle(texts);
        }
        return texts.map(() => null);
    }

    private async embedOpenAI(texts: string[]): Promise<(number[] | null)[]> {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: texts,
                dimensions: this.dimensions
            })
        });

        if (!response.ok) {
            const err = await response.text().catch(() => 'unknown');
            throw new Error(`OpenAI embedding API ${response.status}: ${err}`);
        }

        const data = await response.json() as any;
        const result: (number[] | null)[] = texts.map(() => null);
        for (const item of data.data || []) {
            if (item.embedding && typeof item.index === 'number') {
                result[item.index] = item.embedding;
            }
        }
        return result;
    }

    private async embedGoogle(texts: string[]): Promise<(number[] | null)[]> {
        const model = 'gemini-embedding-001';
        const requests = texts.map(text => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions
        }));

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests })
            }
        );

        if (!response.ok) {
            const err = await response.text().catch(() => 'unknown');
            throw new Error(`Google embedding API ${response.status}: ${err}`);
        }

        const data = await response.json() as any;
        return (data.embeddings || []).map((e: any) => e?.values || null);
    }

    // ── Math ─────────────────────────────────────────────────────

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    // ── Persistence ──────────────────────────────────────────────

    private loadFromDisk(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                this.entries = Array.isArray(data.entries) ? data.entries : [];
            }
        } catch (e) {
            // Try backup recovery
            try {
                if (fs.existsSync(this.backupPath)) {
                    const raw = fs.readFileSync(this.backupPath, 'utf-8');
                    const data = JSON.parse(raw);
                    this.entries = Array.isArray(data.entries) ? data.entries : [];
                    logger.warn(`VectorMemory: Recovered ${this.entries.length} vectors from backup`);
                }
            } catch {
                this.entries = [];
            }
        }
    }

    private saveToDisk(): void {
        try {
            const data = JSON.stringify({
                provider: this.provider,
                dimensions: this.dimensions,
                count: this.entries.length,
                entries: this.entries
            });
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, data, 'utf-8');
            if (fs.existsSync(this.filePath)) {
                try { fs.copyFileSync(this.filePath, this.backupPath); } catch { /* best-effort */ }
            }
            fs.renameSync(tmpPath, this.filePath);
        } catch (e) {
            logger.error(`VectorMemory: Failed to save: ${e}`);
        }
    }
}
