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
        const openaiKey = (config.openaiApiKey && !config.openaiApiKey.includes('_key_here')) ? config.openaiApiKey : undefined;
        const googleKey = (config.googleApiKey && !config.googleApiKey.includes('_key_here')) ? config.googleApiKey : undefined;

        if (preferGoogle && googleKey) {
            this.provider = 'google';
            this.apiKey = googleKey;
        } else if (openaiKey) {
            this.provider = 'openai';
            this.apiKey = openaiKey;
        } else if (googleKey) {
            this.provider = 'google';
            this.apiKey = googleKey;
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
     * Whether full vector (embedding) search is active.
     * Note: keyword (BM25) search works regardless of this flag.
     */
    public isEnabled(): boolean {
        return this.provider !== 'none';
    }

    /**
     * Whether any form of search is available (BM25 always works; vectors need an API key).
     */
    public isSearchable(): boolean {
        return this.entries.length > 0;
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
     * Hybrid search: blends vector cosine similarity + BM25 keyword scoring,
     * weights by recency (temporal decay), and applies MMR re-ranking to
     * avoid returning near-duplicate results.
     *
     * Falls back to BM25-only when no embedding provider is configured,
     * so memory search works even without an API key.
     */
    public async search(
        query: string,
        limit: number = 10,
        filter?: {
            type?: string;
            source?: string;
            excludeIds?: Set<string>;
            metadata?: Record<string, any>;
        }
    ): Promise<ScoredVectorEntry[]> {
        if (this.entries.length === 0) return [];

        // Flush pending first so fresh memories are searchable
        if (this.provider !== 'none' && this.pendingQueue.length > 0) {
            await this.flush();
        }

        // Apply structural filters first
        let candidates = this.entries;
        if (filter?.type) candidates = candidates.filter(e => e.type === filter.type);
        if (filter?.source) candidates = candidates.filter(e => e.metadata?.source === filter.source);
        if (filter?.metadata) {
            candidates = candidates.filter(e => {
                const emd = e.metadata || {};
                for (const [key, val] of Object.entries(filter.metadata!)) {
                    if (emd[key] !== val) return false;
                }
                return true;
            });
        }
        if (filter?.excludeIds) candidates = candidates.filter(e => !filter.excludeIds!.has(e.id));
        if (candidates.length === 0) return [];

        try {
            // ── BM25 keyword scores (zero-dep, always available) ──────────────
            const bm25Scores = this.computeBm25Scores(query, candidates);

            // ── Vector cosine scores (only when embedding API available) ───────
            let vectorScores: number[] | null = null;
            if (this.provider !== 'none') {
                let queryVector: number[];
                if (query === this.lastQueryText && this.lastQueryVector) {
                    queryVector = this.lastQueryVector;
                } else {
                    const [vec] = await this.embedBatch([query]);
                    if (vec) {
                        queryVector = vec;
                        this.lastQueryText = query;
                        this.lastQueryVector = queryVector;
                    } else {
                        queryVector = [];
                    }
                }
                if (queryVector.length > 0) {
                    vectorScores = candidates.map(e => this.cosineSimilarity(queryVector, e.vector));
                }
            }

            // ── Hybrid fusion + temporal decay ─────────────────────────────────
            // Weights: 60% vector (when available), 40% BM25; scale BM25 to [0,1]
            const maxBm25 = Math.max(...bm25Scores, 1e-9);
            const scored: ScoredVectorEntry[] = candidates.map((entry, i) => {
                const bm25Norm = bm25Scores[i] / maxBm25;
                const vecScore = vectorScores ? vectorScores[i] : 0;
                const hybrid = vectorScores
                    ? 0.60 * vecScore + 0.40 * bm25Norm
                    : bm25Norm;
                // Temporal decay: half-life 7 days (e^(-ln2/7 * ageDays))
                const recency = this.recencyScore(entry.timestamp);
                return { ...entry, score: hybrid * (0.75 + 0.25 * recency) };
            });

            scored.sort((a, b) => b.score - a.score);

            // ── MMR re-ranking: balance relevance vs. diversity ────────────────
            // Only run MMR when we have vector data (need vectors for sim comparison)
            if (vectorScores && scored.length > limit) {
                return this.mmrRerank(scored, limit, 0.65);
            }
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

    // ── BM25 keyword search ───────────────────────────────────────

    /** Tokenise text: lowercase, strip punctuation, drop stop-words, min 2 chars. */
    private tokenize(text: string): string[] {
        const STOP = new Set(['the','a','an','is','in','on','at','to','of','and','or','but','for','with','it','be','was','are','has','had','that','this','from','by']);
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 2 && !STOP.has(t));
    }

    /**
     * Compute BM25 scores for each candidate against the query.
     * Returns a parallel array of raw BM25 scores (not normalised).
     */
    private computeBm25Scores(query: string, candidates: VectorEntry[]): number[] {
        const k1 = 1.5, b = 0.75;
        const queryTerms = this.tokenize(query);
        if (queryTerms.length === 0) return candidates.map(() => 0);

        // Build per-document token maps and compute average document length
        const docTokens = candidates.map(e => this.tokenize(e.content));
        const avgDocLen = docTokens.reduce((s, t) => s + t.length, 0) / (docTokens.length || 1);

        // Document frequency per term
        const df = new Map<string, number>();
        for (const terms of docTokens) {
            for (const term of new Set(terms)) {
                df.set(term, (df.get(term) || 0) + 1);
            }
        }
        const N = candidates.length;

        return docTokens.map(terms => {
            const tf = new Map<string, number>();
            for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
            const docLen = terms.length;
            let score = 0;
            for (const term of queryTerms) {
                const freq = tf.get(term) || 0;
                if (freq === 0) continue;
                const docFreq = df.get(term) || 0;
                const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
                const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * docLen / avgDocLen));
                score += idf * tfNorm;
            }
            return score;
        });
    }

    // ── Temporal decay ────────────────────────────────────────────

    /** Recency score in [0,1]: 1.0 = now, 0.5 = 7 days ago, ~0 = 30+ days ago. */
    private recencyScore(timestamp: string): number {
        const ageDays = (Date.now() - new Date(timestamp).getTime()) / 86_400_000;
        return Math.exp(-0.099 * ageDays); // half-life ≈ 7 days
    }

    // ── MMR re-ranking ────────────────────────────────────────────

    /**
     * Maximal Marginal Relevance: greedily selects `limit` results that
     * balance relevance (score) with diversity (low similarity to already-selected).
     * lambda = 1 → pure relevance; lambda = 0 → pure diversity.
     */
    private mmrRerank(candidates: ScoredVectorEntry[], limit: number, lambda: number = 0.65): ScoredVectorEntry[] {
        const selected: ScoredVectorEntry[] = [];
        const remaining = [...candidates];

        while (selected.length < limit && remaining.length > 0) {
            let bestIdx = 0;
            let bestScore = -Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const relevance = remaining[i].score;
                const maxSim = selected.length === 0 ? 0
                    : Math.max(...selected.map(s =>
                        (remaining[i].vector?.length && s.vector?.length)
                            ? this.cosineSimilarity(remaining[i].vector, s.vector)
                            : 0
                    ));
                const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
                if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
            }
            selected.push(remaining.splice(bestIdx, 1)[0]);
        }
        return selected;
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
