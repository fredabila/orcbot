import { describe, expect, it } from 'vitest';
import { ContextCompactor } from '../src/core/ContextCompactor';

describe('ContextCompactor', () => {
    describe('truncateCompaction', () => {
        it('should preserve content that fits within target', async () => {
            const compactor = new ContextCompactor();
            const content = 'Short content';
            
            const compacted = await compactor.compact(content, {
                targetLength: 100,
                strategy: 'truncate'
            });
            
            expect(compacted).toBe(content);
        });

        it('should preserve headers and recent entries', async () => {
            const compactor = new ContextCompactor();
            const content = `# Header Section
Some context here
Middle content
Recent entry 1
Recent entry 2
Recent entry 3`;
            
            const compacted = await compactor.compact(content, {
                targetLength: 80,
                preserveRecent: 3,
                strategy: 'truncate'
            });
            
            expect(compacted).toContain('# Header Section');
            expect(compacted).toContain('Recent entry 3');
        });

        it('should add truncation marker', async () => {
            const compactor = new ContextCompactor();
            const content = Array(100).fill('Line of content').join('\n');
            
            const compacted = await compactor.compact(content, {
                targetLength: 200,
                strategy: 'truncate'
            });
            
            expect(compacted).toContain('truncated');
            expect(compacted.length).toBeLessThan(content.length);
        });
    });

    describe('compactStepHistory', () => {
        it('should merge consecutive similar steps', () => {
            const compactor = new ContextCompactor();
            const history = `[Step 1] tool: web_search result: Found item
[Step 2] tool: web_search result: Found another
[Step 3] tool: web_search result: Found third
[Step 4] tool: send_telegram message sent`;
            
            const compacted = compactor.compactStepHistory(history);
            
            expect(compacted).toContain('[Step 1]');
            expect(compacted).toContain('[Step 4]');
            expect(compacted).toContain('similar steps');
        });

        it('should not merge different tool types', () => {
            const compactor = new ContextCompactor();
            const history = `[Step 1] tool: web_search result: Found
[Step 2] tool: send_telegram sent message
[Step 3] tool: web_search result: Found again`;
            
            const compacted = compactor.compactStepHistory(history);
            
            // All steps should be preserved since they're different tools
            expect(compacted).toContain('[Step 1]');
            expect(compacted).toContain('[Step 2]');
            expect(compacted).toContain('[Step 3]');
        });
    });

    describe('utility methods', () => {
        it('should estimate tokens correctly', () => {
            const text = 'a'.repeat(400); // 400 chars
            const tokens = ContextCompactor.estimateTokens(text);
            
            expect(tokens).toBe(100); // 400 / 4 = 100 tokens
        });

        it('should detect when compaction is needed', () => {
            const smallText = 'a'.repeat(1000); // 250 tokens
            const largeText = 'a'.repeat(400000); // 100k tokens
            
            expect(ContextCompactor.needsCompaction(smallText, 100000)).toBe(false);
            expect(ContextCompactor.needsCompaction(largeText, 100000)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle empty content', async () => {
            const compactor = new ContextCompactor();
            const compacted = await compactor.compact('', { strategy: 'truncate' });
            
            expect(compacted).toBe('');
        });

        it('should handle content with no line breaks', async () => {
            const compactor = new ContextCompactor();
            const content = 'a'.repeat(1000);
            
            const compacted = await compactor.compact(content, {
                targetLength: 500,
                strategy: 'truncate'
            });
            
            expect(compacted.length).toBeLessThanOrEqual(500);
        });

        it('should handle content that is exactly at target length', async () => {
            const compactor = new ContextCompactor();
            const content = 'a'.repeat(100);
            
            const compacted = await compactor.compact(content, {
                targetLength: 100,
                strategy: 'truncate'
            });
            
            expect(compacted).toBe(content);
        });
    });
});
