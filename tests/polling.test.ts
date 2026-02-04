import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PollingManager } from '../src/core/PollingManager';
import { eventBus } from '../src/core/EventBus';

describe('PollingManager', () => {
    let pollingManager: PollingManager;

    beforeEach(() => {
        pollingManager = new PollingManager();
    });

    afterEach(() => {
        if (pollingManager) {
            pollingManager.stop();
        }
    });

    it('should initialize correctly', () => {
        expect(pollingManager).toBeDefined();
        expect(pollingManager.getJobCount()).toBe(0);
    });

    it('should start and stop polling manager', () => {
        const startListener = vi.fn();
        const stopListener = vi.fn();

        eventBus.on('polling:started', startListener);
        eventBus.on('polling:stopped', stopListener);

        pollingManager.start();
        expect(startListener).toHaveBeenCalledOnce();

        pollingManager.stop();
        expect(stopListener).toHaveBeenCalledOnce();

        eventBus.off('polling:started', startListener);
        eventBus.off('polling:stopped', stopListener);
    });

    it('should register a polling job', () => {
        pollingManager.start();
        
        const registerListener = vi.fn();
        eventBus.on('polling:registered', registerListener);

        const jobId = pollingManager.registerJob({
            id: 'test-job',
            description: 'Test polling job',
            checkFn: async () => false,
            intervalMs: 1000
        });

        expect(jobId).toBe('test-job');
        expect(pollingManager.hasJob('test-job')).toBe(true);
        expect(pollingManager.getJobCount()).toBe(1);
        expect(registerListener).toHaveBeenCalledOnce();

        eventBus.off('polling:registered', registerListener);
    });

    it('should cancel a polling job', () => {
        pollingManager.start();

        pollingManager.registerJob({
            id: 'test-job',
            description: 'Test polling job',
            checkFn: async () => false,
            intervalMs: 1000
        });

        expect(pollingManager.hasJob('test-job')).toBe(true);

        const cancelled = pollingManager.cancelJob('test-job');
        expect(cancelled).toBe(true);
        expect(pollingManager.hasJob('test-job')).toBe(false);
        expect(pollingManager.getJobCount()).toBe(0);
    });

    it('should get job status', () => {
        pollingManager.start();

        pollingManager.registerJob({
            id: 'test-job',
            description: 'Test polling job',
            checkFn: async () => false,
            intervalMs: 1000
        });

        const status = pollingManager.getJobStatus('test-job');
        expect(status.exists).toBe(true);
        expect(status.description).toBe('Test polling job');
        expect(status.attempts).toBe(0);
    });

    it('should handle successful job completion', async () => {
        pollingManager.start();

        const successListener = vi.fn();
        eventBus.on('polling:success', successListener);

        return new Promise<void>((resolve) => {
            pollingManager.registerJob({
                id: 'success-job',
                description: 'Job that succeeds',
                checkFn: async () => true, // Always succeeds
                intervalMs: 100,
                onSuccess: (id) => {
                    expect(id).toBe('success-job');
                    eventBus.off('polling:success', successListener);
                    resolve();
                }
            });
        });
    });

    it('should handle max attempts failure', async () => {
        pollingManager.start();

        const failureListener = vi.fn();
        eventBus.on('polling:failure', failureListener);

        return new Promise<void>((resolve) => {
            pollingManager.registerJob({
                id: 'fail-job',
                description: 'Job that fails',
                checkFn: async () => false, // Always fails
                intervalMs: 100,
                maxAttempts: 2,
                onFailure: (id, reason) => {
                    expect(id).toBe('fail-job');
                    // Just check that reason is a string
                    expect(typeof reason).toBe('string');
                    eventBus.off('polling:failure', failureListener);
                    resolve();
                }
            });
        });
    });

    it('should list all active jobs', () => {
        pollingManager.start();

        pollingManager.registerJob({
            id: 'job1',
            description: 'First job',
            checkFn: async () => false,
            intervalMs: 1000
        });

        pollingManager.registerJob({
            id: 'job2',
            description: 'Second job',
            checkFn: async () => false,
            intervalMs: 2000
        });

        const jobs = pollingManager.getActiveJobs();
        expect(jobs.length).toBe(2);
        expect(jobs[0].id).toBe('job1');
        expect(jobs[1].id).toBe('job2');
    });

    it('should clear all jobs on stop', () => {
        pollingManager.start();

        pollingManager.registerJob({
            id: 'job1',
            description: 'First job',
            checkFn: async () => false,
            intervalMs: 1000
        });

        pollingManager.registerJob({
            id: 'job2',
            description: 'Second job',
            checkFn: async () => false,
            intervalMs: 2000
        });

        expect(pollingManager.getJobCount()).toBe(2);

        pollingManager.stop();

        expect(pollingManager.getJobCount()).toBe(0);
    });
});
