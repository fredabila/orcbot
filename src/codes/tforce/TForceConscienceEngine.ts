import { TForceContext } from './types';

export class TForceConscienceEngine {
    buildGuidance(context: TForceContext, memoryHighlights: string[]): { guidance: string; shouldEscalate: boolean } {
        const signals: string[] = [];

        if (context.noToolSteps >= 2) {
            signals.push('You are likely circling without execution. Pick one concrete tool next.');
        }

        if (context.lastError) {
            signals.push('A recent error exists. Prioritize a minimal reproducer and targeted fix.');
        }

        if (context.recentTools.length >= 3) {
            const unique = new Set(context.recentTools.slice(-3));
            if (unique.size <= 1) {
                signals.push('Recent tool calls are repetitive. Change strategy or escalate with a concise blocker report.');
            }
        }

        if (memoryHighlights.length > 0) {
            signals.push(`Remember recent blockers: ${memoryHighlights.join(' | ')}`);
        }

        if (signals.length === 0) {
            signals.push('Stay aligned with the user goal and proceed with the smallest reliable next step.');
        }

        const shouldEscalate = context.noToolSteps >= 3 || (Boolean(context.lastError) && context.step >= 4);
        return {
            guidance: signals.join(' '),
            shouldEscalate
        };
    }
}
