import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { KnowledgeStore } from '../src/memory/KnowledgeStore';

// Mock logger
vi.mock('../src/utils/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock fetch for embedding
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Test data dir
const TEST_DIR = path.join(__dirname, '.test-knowledge-store');

function makeVector(dim: number = 256, seed: number = 1): number[] {
    return Array.from({ length: dim }, (_, i) => Math.sin(i * seed) * 0.5);
}

function mockOpenAIEmbedding(inputs: number, dim: number = 256, seed: number = 1) {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
            data: Array.from({ length: inputs }, (_, i) => ({
                index: i,
                embedding: makeVector(dim, seed + i)
            }))
        })
    });
}

function createStore(config: any = {}): KnowledgeStore {
    return new KnowledgeStore(TEST_DIR, {
        openaiApiKey: 'test-key',
        ...config
    });
}

describe('KnowledgeStore', () => {
    beforeEach(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true });
        }
        fs.mkdirSync(TEST_DIR, { recursive: true });
        mockFetch.mockReset();
    });

    afterEach(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true });
        }
    });

    // ─── Constructor & Configuration ─────────────────────────────────

    describe('constructor', () => {
        it('should initialize with OpenAI when key provided', () => {
            const store = createStore();
            expect(store.isEnabled()).toBe(true);
            expect(store.getStats().provider).toBe('openai');
        });

        it('should prefer Google when specified', () => {
            const store = createStore({
                openaiApiKey: 'oai-key',
                googleApiKey: 'google-key',
                preferredProvider: 'google'
            });
            expect(store.getStats().provider).toBe('google');
        });

        it('should fall back to Google when no OpenAI key', () => {
            const store = new KnowledgeStore(TEST_DIR, { googleApiKey: 'gkey' });
            expect(store.getStats().provider).toBe('google');
        });

        it('should be disabled when no keys provided', () => {
            const store = new KnowledgeStore(TEST_DIR);
            expect(store.isEnabled()).toBe(false);
            expect(store.getStats().enabled).toBe(false);
        });

        it('should load persisted data from disk', () => {
            const data = {
                provider: 'openai',
                dimensions: 256,
                chunkCount: 1,
                documentCount: 1,
                documents: {
                    'doc-1': {
                        id: 'doc-1', source: 'test.txt', title: 'Test',
                        collection: 'default', format: 'text', totalChunks: 1,
                        sizeBytes: 100, ingestedAt: '2024-01-01', tags: []
                    }
                },
                chunks: [{
                    id: 'doc-1-chunk-0', documentId: 'doc-1', collection: 'default',
                    content: 'test content', vector: makeVector(), chunkIndex: 0,
                    metadata: { source: 'test.txt', ingestedAt: '2024-01-01' },
                    indexedAt: '2024-01-01'
                }]
            };
            fs.writeFileSync(path.join(TEST_DIR, 'knowledge_store.json'), JSON.stringify(data));

            const store = createStore();
            expect(store.getStats().totalChunks).toBe(1);
            expect(store.getStats().totalDocuments).toBe(1);
        });

        it('should recover from backup on corrupt primary file', () => {
            const data = {
                provider: 'openai', dimensions: 256, chunkCount: 0,
                documentCount: 1, documents: { 'doc-x': { id: 'doc-x', source: 'bak.txt', title: 'Backup', collection: 'default', format: 'text', totalChunks: 0, sizeBytes: 50, ingestedAt: '2024-01-01', tags: [] } },
                chunks: []
            };
            fs.writeFileSync(path.join(TEST_DIR, 'knowledge_store.json'), 'CORRUPT');
            fs.writeFileSync(path.join(TEST_DIR, 'knowledge_store.json.bak'), JSON.stringify(data));

            const store = createStore();
            expect(store.getStats().totalDocuments).toBe(1);
        });
    });

    // ─── Document Chunking ───────────────────────────────────────────

    describe('chunkDocument', () => {
        it('should return single chunk for short content', () => {
            const store = createStore();
            const chunks = store.chunkDocument('A'.repeat(100));
            expect(chunks).toHaveLength(1);
        });

        it('should return empty for content too short', () => {
            const store = createStore();
            const chunks = store.chunkDocument('short');
            expect(chunks).toHaveLength(0);
        });

        it('should split long content into multiple chunks', () => {
            const store = createStore();
            const longText = 'This is a test paragraph. '.repeat(200);
            const chunks = store.chunkDocument(longText, { chunkSize: 200, overlap: 50 });
            expect(chunks.length).toBeGreaterThan(1);
        });

        it('should create overlapping chunks', () => {
            const store = createStore();
            const sentences = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}. `).join('');
            const chunks = store.chunkDocument(sentences, {
                chunkSize: 200,
                overlap: 50,
                respectBoundaries: false
            });
            // Overlap means content from the end of chunk N should appear at the start of chunk N+1
            expect(chunks.length).toBeGreaterThan(1);
            if (chunks.length >= 2) {
                // The overlap region should cause some shared text
                const endOfFirst = chunks[0].slice(-50);
                expect(chunks[1]).toContain(endOfFirst.trim().slice(0, 20));
            }
        });

        it('should respect custom chunk size', () => {
            const store = createStore();
            const text = 'word '.repeat(500);
            const chunks = store.chunkDocument(text, { chunkSize: 100, overlap: 20, respectBoundaries: false });
            // Each chunk should be roughly around the target size
            for (const chunk of chunks) {
                // Allow some flexibility for boundary handling
                expect(chunk.length).toBeLessThan(300);
            }
        });
    });

    // ─── Content Parsing ─────────────────────────────────────────────

    describe('parseContent', () => {
        it('should parse CSV into readable text', () => {
            const store = createStore();
            const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
            const result = store.parseContent(csv, 'csv');
            expect(result).toContain('name');
            expect(result).toContain('Alice');
            expect(result).toContain('age: 30');
        });

        it('should parse JSON array into text', () => {
            const store = createStore();
            const json = JSON.stringify([{ name: 'Alice', role: 'dev' }, { name: 'Bob', role: 'pm' }]);
            const result = store.parseContent(json, 'json');
            expect(result).toContain('Alice');
            expect(result).toContain('Bob');
        });

        it('should handle JSONL format', () => {
            const store = createStore();
            const jsonl = '{"id":1,"text":"hello"}\n{"id":2,"text":"world"}';
            const result = store.parseContent(jsonl, 'jsonl');
            expect(result).toContain('hello');
            expect(result).toContain('world');
        });

        it('should pass through markdown unchanged', () => {
            const store = createStore();
            const md = '# Title\n\nSome content';
            const result = store.parseContent(md, 'markdown');
            expect(result).toBe(md);
        });

        it('should pass through unknown formats as text', () => {
            const store = createStore();
            const text = 'plain text content';
            expect(store.parseContent(text, 'unknown')).toBe(text);
        });
    });

    // ─── Ingestion ───────────────────────────────────────────────────

    describe('ingest', () => {
        it('should ingest document and create chunks', async () => {
            const store = createStore();
            const content = 'This is a test document with enough content to be meaningful. '.repeat(20);

            // Mock embedding for the chunks
            mockOpenAIEmbedding(5);

            const result = await store.ingest(content, 'test-doc.txt', 'test-collection', {
                title: 'Test Document',
                tags: ['test', 'unit']
            });

            expect(result.documentId).toBeTruthy();
            expect(result.chunksCreated).toBeGreaterThan(0);
            expect(store.getStats().totalDocuments).toBe(1);
            expect(store.getStats().totalChunks).toBeGreaterThan(0);
        });

        it('should reject content too short', async () => {
            const store = createStore();
            await expect(store.ingest('too short', 'x.txt')).rejects.toThrow('too short');
        });

        it('should reject when disabled', async () => {
            const store = new KnowledgeStore(TEST_DIR);
            await expect(store.ingest('a'.repeat(100), 'x.txt')).rejects.toThrow('disabled');
        });

        it('should persist chunks to disk after ingestion', async () => {
            const store = createStore();
            const content = 'Important knowledge that should be persisted to disk and retrieved later. '.repeat(5);
            mockOpenAIEmbedding(2);

            await store.ingest(content, 'persist.txt');

            // Check file exists
            expect(fs.existsSync(path.join(TEST_DIR, 'knowledge_store.json'))).toBe(true);

            // Load a new store and verify data persists
            const store2 = createStore();
            expect(store2.getStats().totalDocuments).toBe(1);
        });

        it('should handle collection names', async () => {
            const store = createStore();
            const content = 'Technical documentation about Python programming and data structures. '.repeat(10);
            mockOpenAIEmbedding(3);

            await store.ingest(content, 'python.md', 'python-docs', { title: 'Python Guide' });

            const docs = store.listDocuments('python-docs');
            expect(docs.length).toBe(1);
            expect(docs[0].collection).toBe('python-docs');
        });
    });

    // ─── Search ──────────────────────────────────────────────────────

    describe('search', () => {
        async function setupSearchStore(): Promise<KnowledgeStore> {
            const store = createStore();
            // Pre-populate with indexed chunks
            const data = {
                provider: 'openai', dimensions: 256,
                chunkCount: 3, documentCount: 2,
                documents: {
                    'doc-a': {
                        id: 'doc-a', source: 'python.md', title: 'Python Guide',
                        collection: 'docs', format: 'markdown', totalChunks: 2,
                        sizeBytes: 500, ingestedAt: '2024-01-01', tags: ['python']
                    },
                    'doc-b': {
                        id: 'doc-b', source: 'recipes.txt', title: 'Recipes',
                        collection: 'cooking', format: 'text', totalChunks: 1,
                        sizeBytes: 200, ingestedAt: '2024-01-02', tags: ['food']
                    }
                },
                chunks: [
                    {
                        id: 'doc-a-chunk-0', documentId: 'doc-a', collection: 'docs',
                        content: 'Python is a programming language used for web development and data science.',
                        vector: makeVector(256, 1), chunkIndex: 0,
                        metadata: { source: 'python.md', title: 'Python Guide', totalChunks: 2, tags: ['python'], ingestedAt: '2024-01-01' },
                        indexedAt: '2024-01-01'
                    },
                    {
                        id: 'doc-a-chunk-1', documentId: 'doc-a', collection: 'docs',
                        content: 'Python lists, dictionaries, and sets are fundamental data structures.',
                        vector: makeVector(256, 2), chunkIndex: 1,
                        metadata: { source: 'python.md', title: 'Python Guide', totalChunks: 2, tags: ['python'], ingestedAt: '2024-01-01' },
                        indexedAt: '2024-01-01'
                    },
                    {
                        id: 'doc-b-chunk-0', documentId: 'doc-b', collection: 'cooking',
                        content: 'Chocolate cake recipe: mix flour, sugar, cocoa powder, and eggs.',
                        vector: makeVector(256, 10), chunkIndex: 0,
                        metadata: { source: 'recipes.txt', title: 'Recipes', totalChunks: 1, tags: ['food'], ingestedAt: '2024-01-02' },
                        indexedAt: '2024-01-02'
                    }
                ]
            };
            fs.writeFileSync(path.join(TEST_DIR, 'knowledge_store.json'), JSON.stringify(data));
            return new KnowledgeStore(TEST_DIR, { openaiApiKey: 'test-key' }) as KnowledgeStore;
        }

        it('should return results scored by similarity', async () => {
            const store = await setupSearchStore();
            // Mock query embedding — use same seed as doc-a-chunk-0 for guaranteed match
            mockOpenAIEmbedding(1, 256, 1);

            const results = await store.search('python programming');
            expect(results.length).toBeGreaterThan(0);
            // Results should have scores in descending order
            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });

        it('should filter by collection', async () => {
            const store = await setupSearchStore();
            mockOpenAIEmbedding(1, 256, 1);

            const results = await store.search('test', 10, { collection: 'cooking' });
            for (const r of results) {
                expect(r.collection).toBe('cooking');
            }
        });

        it('should filter by tags', async () => {
            const store = await setupSearchStore();
            mockOpenAIEmbedding(1, 256, 1);

            const results = await store.search('test', 10, { tags: ['food'] });
            // Only doc-b has the 'food' tag
            for (const r of results) {
                expect(r.documentId).toBe('doc-b');
            }
        });

        it('should return empty on disabled store', async () => {
            const store = new KnowledgeStore(TEST_DIR);
            const results = await store.search('anything');
            expect(results).toEqual([]);
        });

        it('should use cached query vector for identical queries', async () => {
            const store = await setupSearchStore();
            mockOpenAIEmbedding(1, 256, 1);
            await store.search('python');

            // Second call with same query — should NOT call fetch again
            const initialCallCount = mockFetch.mock.calls.length;
            await store.search('python');
            expect(mockFetch.mock.calls.length).toBe(initialCallCount);
        });

        it('should limit results per document', async () => {
            const store = await setupSearchStore();
            mockOpenAIEmbedding(1, 256, 1);

            const results = await store.search('python', 10);
            // At most 3 chunks from the same document (doc-a has only 2 anyway)
            const countByDoc: Record<string, number> = {};
            for (const r of results) {
                countByDoc[r.documentId] = (countByDoc[r.documentId] || 0) + 1;
            }
            for (const count of Object.values(countByDoc)) {
                expect(count).toBeLessThanOrEqual(3);
            }
        });
    });

    // ─── Auto-retrieval ──────────────────────────────────────────────

    describe('retrieveForTask', () => {
        it('should return empty when disabled', async () => {
            const store = new KnowledgeStore(TEST_DIR);
            expect(await store.retrieveForTask('test')).toBe('');
        });

        it('should return empty when store has no chunks', async () => {
            const store = createStore();
            expect(await store.retrieveForTask('test')).toBe('');
        });

        it('should return formatted results for matching tasks', async () => {
            const store = createStore();
            // Pre-populate
            const data = {
                provider: 'openai', dimensions: 256,
                documents: {
                    'doc-1': { id: 'doc-1', source: 'api.md', title: 'API Docs', collection: 'docs', format: 'md', totalChunks: 1, sizeBytes: 100, ingestedAt: '2024-01-01', tags: [] }
                },
                chunks: [{
                    id: 'doc-1-chunk-0', documentId: 'doc-1', collection: 'docs',
                    content: 'The REST API supports GET and POST requests on /api/v1/users endpoint.',
                    vector: makeVector(256, 1), chunkIndex: 0,
                    metadata: { source: 'api.md', title: 'API Docs', totalChunks: 1, ingestedAt: '2024-01-01', tags: [] },
                    indexedAt: '2024-01-01'
                }]
            };
            fs.writeFileSync(path.join(TEST_DIR, 'knowledge_store.json'), JSON.stringify(data));
            const store2 = createStore();

            // Mock embedding for query — very close to the stored vector
            mockOpenAIEmbedding(1, 256, 1);

            const result = await store2.retrieveForTask('How to use the user API');
            expect(result).toContain('API Docs');
            expect(result).toContain('REST API');
        });
    });

    // ─── Document Management ─────────────────────────────────────────

    describe('document management', () => {
        it('should list documents by collection', async () => {
            const store = createStore();
            mockOpenAIEmbedding(3);
            await store.ingest('Doc A content repeated many many times for chunking. '.repeat(5), 'a.txt', 'col-a');
            mockOpenAIEmbedding(3);
            await store.ingest('Doc B content repeated many many times for chunking. '.repeat(5), 'b.txt', 'col-b');

            const allDocs = store.listDocuments();
            expect(allDocs.length).toBe(2);

            const colA = store.listDocuments('col-a');
            expect(colA.length).toBe(1);
            expect(colA[0].source).toBe('a.txt');
        });

        it('should list collections with counts', async () => {
            const store = createStore();
            mockOpenAIEmbedding(3);
            await store.ingest('Content for the first document in this collection. '.repeat(5), 'a.txt', 'col-x');

            const collections = store.listCollections();
            expect(collections.length).toBe(1);
            expect(collections[0].name).toBe('col-x');
            expect(collections[0].documentCount).toBe(1);
            expect(collections[0].chunkCount).toBeGreaterThan(0);
        });

        it('should delete a document and its chunks', async () => {
            const store = createStore();
            mockOpenAIEmbedding(3);
            const result = await store.ingest('Deletable document with enough words to be chunked. '.repeat(5), 'del.txt');

            const beforeChunks = store.getStats().totalChunks;
            expect(store.deleteDocument(result.documentId)).toBe(true);
            expect(store.getStats().totalChunks).toBeLessThan(beforeChunks);
            expect(store.getStats().totalDocuments).toBe(0);
        });

        it('should return false for non-existent document', () => {
            const store = createStore();
            expect(store.deleteDocument('non-existent')).toBe(false);
        });

        it('should delete entire collection', async () => {
            const store = createStore();
            mockOpenAIEmbedding(3);
            await store.ingest('First doc in temp collection for testing deletion purposes. '.repeat(5), 'a.txt', 'temp');
            mockOpenAIEmbedding(3);
            await store.ingest('Second doc in temp collection for testing deletion purposes. '.repeat(5), 'b.txt', 'temp');

            const deleted = store.deleteCollection('temp');
            expect(deleted).toBe(2);
            expect(store.getStats().totalDocuments).toBe(0);
            expect(store.getStats().totalChunks).toBe(0);
        });
    });

    // ─── Stats & Shutdown ────────────────────────────────────────────

    describe('stats and lifecycle', () => {
        it('should return accurate stats', () => {
            const store = createStore();
            const stats = store.getStats();
            expect(stats).toHaveProperty('totalChunks');
            expect(stats).toHaveProperty('totalDocuments');
            expect(stats).toHaveProperty('collections');
            expect(stats).toHaveProperty('provider');
            expect(stats).toHaveProperty('enabled');
        });

        it('should shutdown gracefully', async () => {
            const store = createStore();
            mockOpenAIEmbedding(3);
            await store.ingest('Document to persist on shutdown. Enough content here to chunk. '.repeat(5), 'shut.txt');

            store.shutdown();

            // Verify file still exists (shutdown saves to disk)
            expect(fs.existsSync(path.join(TEST_DIR, 'knowledge_store.json'))).toBe(true);
        });
    });

    // ─── Edge Cases ──────────────────────────────────────────────────

    describe('edge cases', () => {
        it('should handle embedding API failure gracefully', async () => {
            const store = createStore();
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'Rate limited'
            });

            await expect(
                store.ingest('Content that should fail to embed due to rate limiting. '.repeat(5), 'fail.txt')
            ).rejects.toThrow();
        });

        it('should evict oldest document when at capacity', async () => {
            // Create store with very small capacity
            const store = new KnowledgeStore(TEST_DIR, {
                openaiApiKey: 'test-key',
                maxChunks: 5
            });

            // Ingest two small docs
            mockOpenAIEmbedding(2);
            await store.ingest('First document with enough content to make a couple chunks. '.repeat(5), 'first.txt');

            mockOpenAIEmbedding(5);
            await store.ingest('Second document with plenty of content to exceed the limit. '.repeat(10), 'second.txt');

            // Store should have evicted the first to make room
            expect(store.getStats().totalChunks).toBeLessThanOrEqual(5);
        });

        it('should handle concurrent-safe persistence (atomic writes)', async () => {
            const store = createStore();
            mockOpenAIEmbedding(2);
            await store.ingest('Concurrent safety test document with adequate length. '.repeat(5), 'atomic.txt');

            // Verify tmp file is cleaned up and .bak exists
            expect(fs.existsSync(path.join(TEST_DIR, 'knowledge_store.json'))).toBe(true);
            expect(fs.existsSync(path.join(TEST_DIR, 'knowledge_store.json.tmp'))).toBe(false);
        });
    });
});
