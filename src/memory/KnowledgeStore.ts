/**
 * KnowledgeStore — RAG (Retrieval-Augmented Generation) Engine
 * 
 * A file-backed vector store for ingested documents, datasets, and knowledge.
 * Unlike VectorMemory (which indexes conversation memories), KnowledgeStore
 * handles external documents: PDFs, text files, web pages, CSVs, etc.
 * 
 * Architecture:
 * - Documents are chunked into overlapping segments
 * - Chunks are embedded via OpenAI or Google embedding APIs (shared with VectorMemory)
 * - Retrieval is by cosine similarity with optional metadata filtering
 * - Collections allow logical grouping (e.g., "python-docs", "project-specs")
 * - All state persists to ~/.orcbot/knowledge_store.json
 * 
 * The agent interacts via skills: rag_ingest, rag_search, rag_list, rag_delete.
 * DecisionEngine can also auto-retrieve relevant knowledge for task context.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────

export interface KnowledgeChunk {
    id: string;
    /** The original document's identifier */
    documentId: string;
    /** Logical collection name (e.g., "python-docs", "project-specs") */
    collection: string;
    /** The chunk content */
    content: string;
    /** Embedding vector */
    vector: number[];
    /** Chunk position within the document (0-indexed) */
    chunkIndex: number;
    /** Original document metadata */
    metadata: DocumentMetadata;
    /** When this chunk was indexed */
    indexedAt: string;
}

export interface DocumentMetadata {
    /** Original file name or URL */
    source: string;
    /** Document title (if extractable) */
    title?: string;
    /** MIME type or format hint */
    format?: string;
    /** Total chunks this document was split into */
    totalChunks?: number;
    /** Original document size in bytes */
    sizeBytes?: number;
    /** When the document was ingested */
    ingestedAt: string;
    /** Tags for filtering */
    tags?: string[];
    /** Free-form extra metadata */
    [key: string]: any;
}

export interface DocumentRecord {
    id: string;
    source: string;
    title: string;
    collection: string;
    format: string;
    totalChunks: number;
    sizeBytes: number;
    ingestedAt: string;
    tags: string[];
}

export interface KnowledgeSearchResult {
    chunkId: string;
    documentId: string;
    collection: string;
    content: string;
    score: number;
    source: string;
    title?: string;
    chunkIndex: number;
    totalChunks: number;
}

export interface ChunkingOptions {
    /** Target chunk size in characters (default: 800) */
    chunkSize?: number;
    /** Overlap between adjacent chunks in characters (default: 150) */
    overlap?: number;
    /** Whether to try to split on paragraph/sentence boundaries (default: true) */
    respectBoundaries?: boolean;
}

export interface KnowledgeStoreConfig {
    openaiApiKey?: string;
    googleApiKey?: string;
    preferredProvider?: string;
    dimensions?: number;
    maxChunks?: number;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 150;
const DEFAULT_DIMENSIONS = 256;
const DEFAULT_MAX_CHUNKS = 20000;

// ─── KnowledgeStore Class ────────────────────────────────────────────

export class KnowledgeStore {
    private chunks: KnowledgeChunk[] = [];
    private documents: Map<string, DocumentRecord> = new Map();
    private filePath: string;
    private backupPath: string;
    private provider: 'openai' | 'google' | 'none';
    private apiKey: string;
    private dimensions: number;
    private maxChunks: number;
    private isProcessing: boolean = false;

    // Query embedding cache
    private lastQueryText: string = '';
    private lastQueryVector: number[] | null = null;

    constructor(dataDir: string, config: KnowledgeStoreConfig = {}) {
        this.filePath = path.join(dataDir, 'knowledge_store.json');
        this.backupPath = this.filePath + '.bak';
        this.dimensions = config.dimensions || DEFAULT_DIMENSIONS;
        this.maxChunks = config.maxChunks || DEFAULT_MAX_CHUNKS;

        // Provider selection (same logic as VectorMemory)
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

        if (this.provider !== 'none') {
            logger.info(`KnowledgeStore: Initialized with ${this.chunks.length} chunks, ${this.documents.size} documents (provider: ${this.provider})`);
        } else {
            logger.info(`KnowledgeStore: Disabled (no embedding API key)`);
        }
    }

    // ─── Public API ──────────────────────────────────────────────────

    /** Whether the knowledge store is active */
    public isEnabled(): boolean {
        return this.provider !== 'none';
    }

    /**
     * Ingest a document: chunk it, embed all chunks, and store.
     * Returns the document ID and number of chunks created.
     */
    public async ingest(
        content: string,
        source: string,
        collection: string = 'default',
        options: {
            title?: string;
            format?: string;
            tags?: string[];
            chunkingOptions?: ChunkingOptions;
        } = {}
    ): Promise<{ documentId: string; chunksCreated: number }> {
        if (this.provider === 'none') {
            throw new Error('KnowledgeStore is disabled (no embedding API key configured)');
        }

        if (!content || content.trim().length < 50) {
            throw new Error('Content too short to ingest (minimum 50 characters)');
        }

        const documentId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const title = options.title || this.extractTitle(content, source);
        const format = options.format || this.detectFormat(source);

        // Chunk the document
        const chunks = this.chunkDocument(content, options.chunkingOptions);
        if (chunks.length === 0) {
            throw new Error('Document produced no chunks after processing');
        }

        // Embed all chunks in batches
        const embeddedChunks: KnowledgeChunk[] = [];
        const batchSize = 50;

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const vectors = await this.embedBatch(batch);

            for (let j = 0; j < batch.length; j++) {
                if (vectors[j]) {
                    embeddedChunks.push({
                        id: `${documentId}-chunk-${i + j}`,
                        documentId,
                        collection,
                        content: batch[j],
                        vector: vectors[j]!,
                        chunkIndex: i + j,
                        metadata: {
                            source,
                            title,
                            format,
                            totalChunks: chunks.length,
                            sizeBytes: Buffer.byteLength(content, 'utf-8'),
                            ingestedAt: new Date().toISOString(),
                            tags: options.tags || [],
                        },
                        indexedAt: new Date().toISOString(),
                    });
                }
            }
        }

        if (embeddedChunks.length === 0) {
            throw new Error('All chunk embeddings failed');
        }

        // Evict oldest if over capacity
        while (this.chunks.length + embeddedChunks.length > this.maxChunks) {
            // Remove oldest document's chunks
            const oldestDoc = this.getOldestDocument();
            if (oldestDoc) {
                this.removeDocumentChunks(oldestDoc.id);
                logger.info(`KnowledgeStore: Evicted oldest document "${oldestDoc.title}" to make room`);
            } else {
                break;
            }
        }

        // Store chunks and document record
        this.chunks.push(...embeddedChunks);

        const docRecord: DocumentRecord = {
            id: documentId,
            source,
            title,
            collection,
            format,
            totalChunks: embeddedChunks.length,
            sizeBytes: Buffer.byteLength(content, 'utf-8'),
            ingestedAt: new Date().toISOString(),
            tags: options.tags || [],
        };
        this.documents.set(documentId, docRecord);

        this.saveToDisk();

        logger.info(`KnowledgeStore: Ingested "${title}" → ${embeddedChunks.length} chunks in collection "${collection}"`);
        return { documentId, chunksCreated: embeddedChunks.length };
    }

    /**
     * Semantic search across the knowledge store.
     * Returns the most relevant chunks ranked by similarity.
     */
    public async search(
        query: string,
        limit: number = 5,
        filter?: {
            collection?: string;
            documentId?: string;
            tags?: string[];
            minScore?: number;
        }
    ): Promise<KnowledgeSearchResult[]> {
        if (this.provider === 'none' || this.chunks.length === 0) return [];

        try {
            // Embed the query (with caching)
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

            // Filter candidates
            let candidates = this.chunks;
            if (filter?.collection) {
                candidates = candidates.filter(c => c.collection === filter.collection);
            }
            if (filter?.documentId) {
                candidates = candidates.filter(c => c.documentId === filter.documentId);
            }
            if (filter?.tags && filter.tags.length > 0) {
                const tagSet = new Set(filter.tags);
                candidates = candidates.filter(c =>
                    c.metadata.tags?.some(t => tagSet.has(t))
                );
            }

            // Score by cosine similarity
            const scored = candidates.map(chunk => ({
                chunk,
                score: this.cosineSimilarity(queryVector, chunk.vector)
            }));

            // Apply minimum score filter
            const minScore = filter?.minScore ?? 0.25;
            const filtered = scored.filter(s => s.score >= minScore);

            // Sort descending by score
            filtered.sort((a, b) => b.score - a.score);

            // Deduplicate: prefer highest-scoring chunk per document, but allow multiple chunks
            // from the same document if they're relevant (just limit to 3 per doc)
            const perDocCount: Record<string, number> = {};
            const results: KnowledgeSearchResult[] = [];

            for (const { chunk, score } of filtered) {
                if (results.length >= limit) break;
                const docCount = perDocCount[chunk.documentId] || 0;
                if (docCount >= 3) continue; // Max 3 chunks per document

                results.push({
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    collection: chunk.collection,
                    content: chunk.content,
                    score,
                    source: chunk.metadata.source,
                    title: chunk.metadata.title,
                    chunkIndex: chunk.chunkIndex,
                    totalChunks: chunk.metadata.totalChunks || 0,
                });
                perDocCount[chunk.documentId] = docCount + 1;
            }

            return results;
        } catch (e) {
            logger.warn(`KnowledgeStore: Search failed: ${e}`);
            return [];
        }
    }

    /**
     * Auto-retrieve relevant knowledge for a task description.
     * Used by DecisionEngine to inject RAG context automatically.
     * Returns a formatted string ready for prompt injection, or empty string.
     */
    public async retrieveForTask(taskDescription: string, limit: number = 3): Promise<string> {
        if (!this.isEnabled() || this.chunks.length === 0) return '';

        try {
            const results = await this.search(taskDescription, limit, { minScore: 0.35 });
            if (results.length === 0) return '';

            const formatted = results.map((r, i) => {
                const docInfo = r.title ? `[${r.title}]` : `[${r.source}]`;
                return `${i + 1}. ${docInfo} (relevance: ${(r.score * 100).toFixed(0)}%, chunk ${r.chunkIndex + 1}/${r.totalChunks}):\n${r.content}`;
            }).join('\n\n');

            return formatted;
        } catch (e) {
            logger.debug(`KnowledgeStore: Auto-retrieve failed: ${e}`);
            return '';
        }
    }

    /** List all ingested documents, optionally filtered by collection */
    public listDocuments(collection?: string): DocumentRecord[] {
        const docs = Array.from(this.documents.values());
        if (collection) {
            return docs.filter(d => d.collection === collection);
        }
        return docs.sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
    }

    /** List all collections with document counts */
    public listCollections(): { name: string; documentCount: number; chunkCount: number }[] {
        const stats: Record<string, { docs: Set<string>; chunks: number }> = {};
        for (const chunk of this.chunks) {
            if (!stats[chunk.collection]) {
                stats[chunk.collection] = { docs: new Set(), chunks: 0 };
            }
            stats[chunk.collection].docs.add(chunk.documentId);
            stats[chunk.collection].chunks++;
        }
        return Object.entries(stats).map(([name, s]) => ({
            name,
            documentCount: s.docs.size,
            chunkCount: s.chunks,
        }));
    }

    /** Delete a document and all its chunks */
    public deleteDocument(documentId: string): boolean {
        if (!this.documents.has(documentId)) return false;

        this.removeDocumentChunks(documentId);
        this.documents.delete(documentId);
        this.saveToDisk();

        logger.info(`KnowledgeStore: Deleted document ${documentId}`);
        return true;
    }

    /** Delete an entire collection */
    public deleteCollection(collection: string): number {
        const docsToDelete = Array.from(this.documents.values())
            .filter(d => d.collection === collection);
        
        for (const doc of docsToDelete) {
            this.removeDocumentChunks(doc.id);
            this.documents.delete(doc.id);
        }

        this.saveToDisk();
        logger.info(`KnowledgeStore: Deleted collection "${collection}" (${docsToDelete.length} documents)`);
        return docsToDelete.length;
    }

    /** Get stats for monitoring */
    public getStats(): {
        totalChunks: number;
        totalDocuments: number;
        collections: number;
        provider: string;
        enabled: boolean;
    } {
        return {
            totalChunks: this.chunks.length,
            totalDocuments: this.documents.size,
            collections: this.listCollections().length,
            provider: this.provider,
            enabled: this.isEnabled(),
        };
    }

    /** Graceful shutdown */
    public shutdown(): void {
        if (this.chunks.length > 0 || this.documents.size > 0) {
            this.saveToDisk();
        }
        logger.info(`KnowledgeStore: Shutdown (${this.chunks.length} chunks, ${this.documents.size} documents)`);
    }

    // ─── Document Chunking ───────────────────────────────────────────

    /**
     * Split document content into overlapping chunks for embedding.
     * Tries to respect paragraph and sentence boundaries when possible.
     */
    public chunkDocument(content: string, options: ChunkingOptions = {}): string[] {
        const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        const overlap = options.overlap || DEFAULT_OVERLAP;
        const respectBoundaries = options.respectBoundaries !== false;

        // Normalize whitespace
        const cleaned = content.replace(/\r\n/g, '\n').replace(/\t/g, '    ').trim();
        if (cleaned.length <= chunkSize) {
            return cleaned.length >= 50 ? [cleaned] : [];
        }

        const chunks: string[] = [];
        let start = 0;

        while (start < cleaned.length) {
            let end = start + chunkSize;

            if (end >= cleaned.length) {
                // Last chunk — take everything remaining
                const lastChunk = cleaned.slice(start).trim();
                if (lastChunk.length >= 50) chunks.push(lastChunk);
                break;
            }

            if (respectBoundaries) {
                // Try to find a natural break point near the end
                const searchWindow = cleaned.slice(Math.max(start, end - 200), end + 100);
                const windowOffset = Math.max(start, end - 200);

                // Prefer paragraph break
                const paraBreak = searchWindow.lastIndexOf('\n\n');
                if (paraBreak > 50) {
                    end = windowOffset + paraBreak;
                } else {
                    // Try sentence break
                    const sentBreak = searchWindow.search(/[.!?]\s+(?=[A-Z])/);
                    if (sentBreak > 50) {
                        end = windowOffset + sentBreak + 1;
                    }
                    // else: just cut at chunkSize (hard break)
                }
            }

            const chunk = cleaned.slice(start, end).trim();
            if (chunk.length >= 50) chunks.push(chunk);

            // Advance with overlap
            start = end - overlap;
            if (start <= 0) start = end; // Safety: prevent infinite loop
        }

        return chunks;
    }

    /**
     * Parse structured data formats into text suitable for chunking.
     * Supports: CSV, JSON, and plain text.
     */
    public parseContent(content: string, format: string): string {
        switch (format.toLowerCase()) {
            case 'csv':
            case 'tsv':
                return this.parseCSV(content, format === 'tsv' ? '\t' : ',');
            case 'json':
            case 'jsonl':
                return this.parseJSON(content);
            case 'markdown':
            case 'md':
                return content; // Already text-friendly
            default:
                return content; // Plain text, HTML (tags are noise but okay for embedding)
        }
    }

    // ─── Content Parsers ─────────────────────────────────────────────

    private parseCSV(content: string, delimiter: string = ','): string {
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return content;

        // First line is headers
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const rows: string[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
            const record = headers.map((h, idx) => `${h}: ${values[idx] || ''}`).join(', ');
            rows.push(record);
        }

        return `Dataset with columns: ${headers.join(', ')}\n\nRecords:\n${rows.join('\n')}`;
    }

    private parseJSON(content: string): string {
        try {
            // Handle JSONL (one JSON object per line)
            if (content.trim().startsWith('{') && content.includes('\n{')) {
                const lines = content.split('\n').filter(l => l.trim());
                const parsed = lines.slice(0, 200).map(l => {
                    try { return JSON.parse(l); } catch { return null; }
                }).filter(Boolean);

                return parsed.map(obj =>
                    Object.entries(obj as Record<string, any>)
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                        .join(', ')
                ).join('\n');
            }

            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                return parsed.slice(0, 200).map(item =>
                    typeof item === 'object'
                        ? Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(', ')
                        : String(item)
                ).join('\n');
            }

            return JSON.stringify(parsed, null, 2);
        } catch {
            return content; // Fallback to raw
        }
    }

    // ─── Helper Methods ──────────────────────────────────────────────

    private extractTitle(content: string, source: string): string {
        // Try to extract a title from the first line or heading
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
            const first = lines[0].trim();
            // Markdown heading
            const headingMatch = first.match(/^#+\s+(.+)/);
            if (headingMatch) return headingMatch[1].slice(0, 100);
            // If first line is short enough, use it as title
            if (first.length <= 100 && first.length >= 3) return first;
        }
        // Fall back to source filename or URL
        return path.basename(source).replace(/\.[^.]+$/, '') || source.slice(0, 80);
    }

    private detectFormat(source: string): string {
        const ext = path.extname(source).toLowerCase().replace('.', '');
        const formatMap: Record<string, string> = {
            'txt': 'text', 'md': 'markdown', 'csv': 'csv', 'tsv': 'tsv',
            'json': 'json', 'jsonl': 'jsonl', 'html': 'html', 'htm': 'html',
            'pdf': 'pdf', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
            'py': 'python', 'js': 'javascript', 'ts': 'typescript',
        };
        return formatMap[ext] || 'text';
    }

    private getOldestDocument(): DocumentRecord | null {
        let oldest: DocumentRecord | null = null;
        for (const doc of this.documents.values()) {
            if (!oldest || doc.ingestedAt < oldest.ingestedAt) {
                oldest = doc;
            }
        }
        return oldest;
    }

    private removeDocumentChunks(documentId: string): void {
        this.chunks = this.chunks.filter(c => c.documentId !== documentId);
    }

    // ─── Embedding API ───────────────────────────────────────────────

    private async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
        if (this.provider === 'openai') return this.embedOpenAI(texts);
        if (this.provider === 'google') return this.embedGoogle(texts);
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

    // ─── Math ────────────────────────────────────────────────────────

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

    // ─── Persistence ─────────────────────────────────────────────────

    private loadFromDisk(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                this.chunks = Array.isArray(data.chunks) ? data.chunks : [];
                if (data.documents && typeof data.documents === 'object') {
                    this.documents = new Map(Object.entries(data.documents));
                }
            }
        } catch (e) {
            try {
                if (fs.existsSync(this.backupPath)) {
                    const raw = fs.readFileSync(this.backupPath, 'utf-8');
                    const data = JSON.parse(raw);
                    this.chunks = Array.isArray(data.chunks) ? data.chunks : [];
                    if (data.documents && typeof data.documents === 'object') {
                        this.documents = new Map(Object.entries(data.documents));
                    }
                    logger.warn(`KnowledgeStore: Recovered from backup (${this.chunks.length} chunks)`);
                }
            } catch {
                this.chunks = [];
                this.documents = new Map();
            }
        }
    }

    private saveToDisk(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const data = JSON.stringify({
                provider: this.provider,
                dimensions: this.dimensions,
                chunkCount: this.chunks.length,
                documentCount: this.documents.size,
                documents: Object.fromEntries(this.documents),
                chunks: this.chunks
            });

            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, data, 'utf-8');
            if (fs.existsSync(this.filePath)) {
                try { fs.copyFileSync(this.filePath, this.backupPath); } catch { /* best-effort */ }
            }
            fs.renameSync(tmpPath, this.filePath);
        } catch (e) {
            logger.error(`KnowledgeStore: Failed to save: ${e}`);
        }
    }
}
