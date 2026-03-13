import { describe, expect, it } from 'vitest';
import { TForceMemoryEngine } from '../src/codes/tforce/TForceMemoryEngine';

describe('TForceMemoryEngine', () => {
    it('keeps only the most recent incidents per action', () => {
        const engine = new TForceMemoryEngine(2, 10);

        engine.recordIncident({
            actionId: 'a1',
            step: 1,
            source: 'decision',
            summary: 'first',
            timestamp: new Date().toISOString()
        });
        engine.recordIncident({
            actionId: 'a1',
            step: 2,
            source: 'decision',
            summary: 'second',
            timestamp: new Date().toISOString()
        });
        engine.recordIncident({
            actionId: 'a1',
            step: 3,
            source: 'decision',
            summary: 'third',
            timestamp: new Date().toISOString()
        });

        const highlights = engine.getRecentHighlights('a1', 10);
        expect(highlights).toHaveLength(2);
        expect(highlights.join(' | ')).toContain('step2');
        expect(highlights.join(' | ')).toContain('step3');
        expect(highlights.join(' | ')).not.toContain('step1');
    });

    it('evicts least-recently-touched actions when tracked-action limit is exceeded', () => {
        const engine = new TForceMemoryEngine(5, 2);

        engine.recordIncident({
            actionId: 'a1',
            step: 1,
            source: 'decision',
            summary: 'a1',
            timestamp: new Date().toISOString()
        });
        engine.recordIncident({
            actionId: 'a2',
            step: 1,
            source: 'decision',
            summary: 'a2',
            timestamp: new Date().toISOString()
        });
        engine.recordIncident({
            actionId: 'a3',
            step: 1,
            source: 'decision',
            summary: 'a3',
            timestamp: new Date().toISOString()
        });

        expect(engine.getRecentHighlights('a1')).toHaveLength(0);
        expect(engine.getRecentHighlights('a2')).toHaveLength(1);
        expect(engine.getRecentHighlights('a3')).toHaveLength(1);
    });
});
