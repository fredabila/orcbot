import { describe, expect, it } from 'vitest';
import { ExecutionState, ExecutionStateManager } from '../src/core/ExecutionState';

describe('ExecutionState', () => {
    it('should track execution attempts', () => {
        const state = new ExecutionState('test-action-1');
        
        state.recordAttempt({
            response: { success: true, content: 'First attempt' }
        });
        
        state.recordAttempt({
            error: 'Second attempt failed'
        });
        
        expect(state.attempts.length).toBe(2);
        expect(state.attempts[0].attemptNumber).toBe(1);
        expect(state.attempts[1].attemptNumber).toBe(2);
    });

    it('should track last successful step', () => {
        const state = new ExecutionState('test-action-2');
        
        state.recordAttempt({
            error: 'First failed'
        });
        
        state.recordAttempt({
            response: { success: true, content: 'Success' }
        });
        
        expect(state.lastSuccessfulStep).toBe(2);
    });

    it('should retrieve last successful response', () => {
        const state = new ExecutionState('test-action-3');
        
        const firstSuccess = { success: true, content: 'First success' };
        state.recordAttempt({ response: firstSuccess });
        
        state.recordAttempt({ error: 'Failed' });
        
        const secondSuccess = { success: true, content: 'Second success' };
        state.recordAttempt({ response: secondSuccess });
        
        const last = state.getLastSuccessfulResponse();
        expect(last).toEqual(secondSuccess);
    });

    it('should count consecutive failures', () => {
        const state = new ExecutionState('test-action-4');
        
        state.recordAttempt({ response: { success: true, content: 'Success' } });
        state.recordAttempt({ error: 'Failed 1' });
        state.recordAttempt({ error: 'Failed 2' });
        state.recordAttempt({ error: 'Failed 3' });
        
        expect(state.getConsecutiveFailures()).toBe(3);
    });

    it('should detect if error type was seen before', () => {
        const state = new ExecutionState('test-action-5');
        
        state.recordAttempt({ error: 'Rate limit exceeded' });
        state.recordAttempt({ error: 'Network timeout' });
        
        expect(state.hasSeenErrorType('Rate limit')).toBe(true);
        expect(state.hasSeenErrorType('Context overflow')).toBe(false);
    });

    it('should determine if execution should be abandoned', () => {
        const state = new ExecutionState('test-action-6');
        
        expect(state.shouldAbandon(3)).toBe(false);
        
        state.recordAttempt({ error: 'Fail 1' });
        state.recordAttempt({ error: 'Fail 2' });
        state.recordAttempt({ error: 'Fail 3' });
        
        expect(state.shouldAbandon(3)).toBe(true);
    });

    it('should track compaction status', () => {
        const state = new ExecutionState('test-action-7');
        
        expect(state.shouldTryCompaction()).toBe(true);
        
        state.markCompactionAttempted();
        
        expect(state.shouldTryCompaction()).toBe(false);
        expect(state.compactionAttempted).toBe(true);
    });

    it('should calculate average context size', () => {
        const state = new ExecutionState('test-action-8');
        
        state.recordAttempt({ contextSize: 1000 });
        state.recordAttempt({ contextSize: 2000 });
        state.recordAttempt({ contextSize: 3000 });
        
        expect(state.getAverageContextSize()).toBe(2000);
    });

    it('should generate summary', () => {
        const state = new ExecutionState('test-action-9');
        
        state.recordAttempt({ response: { success: true, content: 'Success' } });
        state.recordAttempt({ error: 'Failed' });
        
        const summary = state.getSummary();
        expect(summary).toContain('test-action-9');
        expect(summary).toContain('1 successes');
        expect(summary).toContain('1 failures');
    });
});

describe('ExecutionStateManager', () => {
    it('should create and retrieve states', () => {
        const manager = new ExecutionStateManager();
        
        const state1 = manager.getState('action-1');
        const state2 = manager.getState('action-1');
        
        expect(state1).toBe(state2); // Should return same instance
        expect(state1.actionId).toBe('action-1');
    });

    it('should remove states', () => {
        const manager = new ExecutionStateManager();
        
        manager.getState('action-1');
        expect(manager.getAllStates().length).toBe(1);
        
        manager.removeState('action-1');
        expect(manager.getAllStates().length).toBe(0);
    });

    it('should calculate statistics', () => {
        const manager = new ExecutionStateManager();
        
        const state1 = manager.getState('action-1');
        state1.recordAttempt({ response: { success: true } });
        state1.recordAttempt({ error: 'Failed' });
        
        const state2 = manager.getState('action-2');
        state2.recordAttempt({ response: { success: true } });
        
        const stats = manager.getStats();
        expect(stats.totalStates).toBe(2);
        expect(stats.totalAttempts).toBe(3);
        expect(stats.avgAttemptsPerState).toBe(1.5);
    });

    it('should prune old states when limit exceeded', () => {
        const manager = new ExecutionStateManager();
        
        // Create more than max states
        for (let i = 0; i < 150; i++) {
            manager.getState(`action-${i}`);
        }
        
        const allStates = manager.getAllStates();
        expect(allStates.length).toBeLessThanOrEqual(100);
    });
});
