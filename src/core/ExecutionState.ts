import { logger } from '../utils/logger';
import { StandardResponse } from './ParserLayer';

export interface ExecutionAttempt {
    attemptNumber: number;
    timestamp: Date;
    response?: StandardResponse;
    error?: any;
    contextSize?: number;
    compactionApplied?: boolean;
}

/**
 * Tracks execution state for a single action to enable sophisticated recovery strategies.
 * Inspired by openclaw's state management approach.
 */
export class ExecutionState {
    public actionId: string;
    public attempts: ExecutionAttempt[] = [];
    public compactionAttempted: boolean = false;
    public lastSuccessfulStep?: number;
    public totalTokensUsed: number = 0;
    public createdAt: Date;

    constructor(actionId: string) {
        this.actionId = actionId;
        this.createdAt = new Date();
    }

    /**
     * Record an execution attempt
     */
    public recordAttempt(attempt: Partial<ExecutionAttempt>): void {
        const fullAttempt: ExecutionAttempt = {
            attemptNumber: this.attempts.length + 1,
            timestamp: new Date(),
            ...attempt
        };
        this.attempts.push(fullAttempt);
        
        if (fullAttempt.response && !fullAttempt.error) {
            this.lastSuccessfulStep = fullAttempt.attemptNumber;
        }

        logger.debug(`ExecutionState: Recorded attempt ${fullAttempt.attemptNumber} for action ${this.actionId}`);
    }

    /**
     * Get the last successful response
     */
    public getLastSuccessfulResponse(): StandardResponse | undefined {
        for (let i = this.attempts.length - 1; i >= 0; i--) {
            const attempt = this.attempts[i];
            if (attempt.response && !attempt.error) {
                return attempt.response;
            }
        }
        return undefined;
    }

    /**
     * Check if we've seen a specific error type before
     */
    public hasSeenErrorType(errorType: string): boolean {
        return this.attempts.some(a => a.error && String(a.error).includes(errorType));
    }

    /**
     * Get number of consecutive failures
     */
    public getConsecutiveFailures(): number {
        let count = 0;
        for (let i = this.attempts.length - 1; i >= 0; i--) {
            if (this.attempts[i].error) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }

    /**
     * Check if execution should be abandoned
     */
    public shouldAbandon(maxAttempts: number = 5): boolean {
        return this.attempts.length >= maxAttempts;
    }

    /**
     * Get summary for logging
     */
    public getSummary(): string {
        const successCount = this.attempts.filter(a => !a.error).length;
        const failCount = this.attempts.filter(a => a.error).length;
        return `Action ${this.actionId}: ${successCount} successes, ${failCount} failures, compaction: ${this.compactionAttempted}`;
    }

    /**
     * Mark that context compaction has been attempted
     */
    public markCompactionAttempted(): void {
        this.compactionAttempted = true;
        logger.info(`ExecutionState: Context compaction attempted for action ${this.actionId}`);
    }

    /**
     * Check if we should try compaction
     */
    public shouldTryCompaction(): boolean {
        return !this.compactionAttempted;
    }

    /**
     * Get average context size from attempts
     */
    public getAverageContextSize(): number {
        const sizes = this.attempts
            .filter(a => a.contextSize !== undefined)
            .map(a => a.contextSize!);
        
        if (sizes.length === 0) return 0;
        return Math.floor(sizes.reduce((sum, s) => sum + s, 0) / sizes.length);
    }
}

/**
 * Manages execution states for multiple actions
 */
export class ExecutionStateManager {
    private states: Map<string, ExecutionState> = new Map();
    private maxStates: number = 100; // Prevent memory leaks

    /**
     * Get or create execution state for an action
     */
    public getState(actionId: string): ExecutionState {
        let state = this.states.get(actionId);
        if (!state) {
            state = new ExecutionState(actionId);
            this.states.set(actionId, state);
            this.pruneOldStates();
        }
        return state;
    }

    /**
     * Remove state for completed action
     */
    public removeState(actionId: string): void {
        this.states.delete(actionId);
    }

    /**
     * Prune old states to prevent memory leaks
     */
    private pruneOldStates(): void {
        if (this.states.size <= this.maxStates) return;

        // Remove oldest states
        const sorted = Array.from(this.states.entries())
            .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());

        const toRemove = sorted.slice(0, this.states.size - this.maxStates);
        for (const [actionId] of toRemove) {
            this.states.delete(actionId);
            logger.debug(`ExecutionStateManager: Pruned state for action ${actionId}`);
        }
    }

    /**
     * Get all active states
     */
    public getAllStates(): ExecutionState[] {
        return Array.from(this.states.values());
    }

    /**
     * Get statistics
     */
    public getStats(): { totalStates: number; totalAttempts: number; avgAttemptsPerState: number } {
        const states = this.getAllStates();
        const totalAttempts = states.reduce((sum, s) => sum + s.attempts.length, 0);
        return {
            totalStates: states.length,
            totalAttempts,
            avgAttemptsPerState: states.length > 0 ? totalAttempts / states.length : 0
        };
    }
}
