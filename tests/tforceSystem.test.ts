import { describe, expect, it } from 'vitest';
import { TForceSystem } from '../src/codes/tforce/TForceSystem';

describe('TForceSystem', () => {
    it('builds conscience guidance and escalation signal from incidents', () => {
        const tforce = new TForceSystem(5);
        tforce.recordIncident({
            actionId: 'a1',
            step: 1,
            source: 'decision',
            summary: 'No tools produced (1/3)',
            timestamp: new Date().toISOString()
        });

        const snapshot = tforce.getSnapshot({
            actionId: 'a1',
            description: 'Debug a failing build pipeline',
            step: 4,
            noToolSteps: 3,
            recentTools: ['run_command', 'run_command', 'run_command'],
            lastError: 'Timeout while executing command'
        });

        expect(snapshot.memoryHighlights.length).toBeGreaterThan(0);
        expect(snapshot.conscienceGuidance.toLowerCase()).toContain('circling');
        expect(snapshot.recoveryPlan.join(' ').toLowerCase()).toContain('retry');
        expect(snapshot.shouldEscalate).toBe(true);
    });
});
