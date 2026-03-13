import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/Agent';
import { parseExecutionPlan } from '../src/core/SimulationEngine';

describe('Execution plan checklist normalization', () => {
    it('parses checklist items and folds fallback lines into the preceding step', () => {
        const parsed = parseExecutionPlan(`STEP BUDGET: 7 steps\n1. Inspect the repo layout\n↳ FALLBACK: read the AGENTS guide if structure is unclear\n2. Run the focused tests`);

        expect(parsed.stepBudget).toBe(7);
        expect(parsed.checklistItems).toEqual([
            'Inspect the repo layout (Fallback: read the AGENTS guide if structure is unclear)',
            'Run the focused tests'
        ]);
    });

    it('builds the checklist preview from the same parsed plan structure', () => {
        const agent = Object.create(Agent.prototype) as any;
        agent.config = {
            get: (key: string) => key === 'reasoningChecklistMaxItems' ? 5 : undefined
        };
        agent.isRobustReasoningEnabled = () => false;

        const preview = agent.buildChecklistPreviewMessage(`STEP BUDGET: 7 steps\n1. Inspect the repo layout\n↳ FALLBACK: read the AGENTS guide if structure is unclear\n2. Run the focused tests`);

        expect(preview).toContain('STEP BUDGET: 7 steps');
        expect(preview).toContain('1. Inspect the repo layout (Fallback: read the AGENTS guide if structure is unclear)');
        expect(preview).toContain('2. Run the focused tests');
    });
});