import { TForceContext, TForceSnapshot } from './types';

export class TForceConscienceEngine {
    buildGuidance(context: TForceContext, memoryHighlights: string[]): { guidance: string; shouldEscalate: boolean; riskLevel: TForceSnapshot['riskLevel']; complexity: number } {
        const signals: string[] = [];
        let riskLevel: TForceSnapshot['riskLevel'] = 'low';
        
        // 1. Stagnation Detection
        if (context.noToolSteps >= 2) {
            signals.push('CRITICAL: You are circling without action. Stop theorizing and execute a specific tool NOW.');
            riskLevel = 'medium';
        }

        // 2. Error Recovery Logic
        if (context.lastError) {
            signals.push(`ALERT: Previous step failed with error. Do NOT repeat the exact same parameters. Modify approach or validate environment.`);
            riskLevel = 'medium';
            if (context.consecutiveFailures && context.consecutiveFailures >= 2) {
                signals.push('FATAL LOOP: Multiple consecutive failures detected. Switch to a diagnostic tool or simplify the command.');
                riskLevel = 'high';
            }
        }

        // 3. Complexity & Fatigue Analysis
        const durationMins = context.totalDurationMs ? context.totalDurationMs / 60000 : 0;
        if (context.step > 15 || durationMins > 8) {
            signals.push(`FATIGUE: This task is taking too long (${context.step} steps, ${Math.round(durationMins)}m). You MUST either finish in the next 2 steps or provide a hard blocker report to the user.`);
            riskLevel = 'high';
        }

        // 4. Repetition Guard
        if (context.recentTools.length >= 4) {
            const unique = new Set(context.recentTools.slice(-4));
            if (unique.size === 1) {
                signals.push(`LOOP DETECTED: You have called "${Array.from(unique)[0]}" 4 times in a row. This is ineffective. Try a different strategy.`);
                riskLevel = 'high';
            }
        }

        // 5. Silence/Transparency
        if (context.messagesSent === 0 && context.step > 5) {
            signals.push('GHOSTING: You have worked for 5+ steps without a single message to the user. Send a brief status update.');
            riskLevel = 'medium';
        }

        if (memoryHighlights.length > 0) {
            signals.push(`HISTORY LESSON: Re-read these recent blockers to avoid regression: ${memoryHighlights.join(' | ')}`);
        }

        if (signals.length === 0) {
            signals.push('PATH CLEAR: Stay focused on the primary objective and prefer tools that provide direct evidence over speculation.');
        }

        const complexity = this.calculateComplexity(context);
        const shouldEscalate = riskLevel === 'high' || context.step >= 20;

        return {
            guidance: signals.join(' '),
            shouldEscalate,
            riskLevel,
            complexity
        };
    }

    private calculateComplexity(context: TForceContext): number {
        let score = 10;
        score += context.step * 2;
        if (context.lastError) score += 15;
        if (context.description.length > 200) score += 10;
        if (context.noToolSteps > 0) score += context.noToolSteps * 10;
        return Math.min(100, score);
    }
}
