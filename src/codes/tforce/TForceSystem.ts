import { TForceConscienceEngine } from './TForceConscienceEngine';
import { TForceErrorFixerEngine } from './TForceErrorFixerEngine';
import { TForceMemoryEngine } from './TForceMemoryEngine';
import { TForceContext, TForceIncident, TForceSnapshot } from './types';

export class TForceSystem {
    private readonly conscience = new TForceConscienceEngine();
    private readonly fixer = new TForceErrorFixerEngine();
    private readonly memory: TForceMemoryEngine;

    constructor(maxIncidentsPerAction: number = 30) {
        this.memory = new TForceMemoryEngine(maxIncidentsPerAction);
    }

    recordIncident(incident: TForceIncident): void {
        this.memory.recordIncident(incident);
    }

    getSnapshot(context: TForceContext): TForceSnapshot {
        const memoryHighlights = this.memory.getRecentHighlights(context.actionId);
        const conscience = this.conscience.buildGuidance(context, memoryHighlights);
        const recoveryPlan = this.fixer.buildRecoveryPlan(context.lastError, context.description);

        return {
            actionId: context.actionId,
            step: context.step,
            conscienceGuidance: conscience.guidance,
            recoveryPlan,
            memoryHighlights,
            shouldEscalate: conscience.shouldEscalate
        };
    }
}
