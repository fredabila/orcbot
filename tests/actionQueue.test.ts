import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActionQueue, Action } from '../src/memory/ActionQueue';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a temp directory for test files
const tmpDir = path.join(os.tmpdir(), `orcbot-aq-test-${Date.now()}`);
const testFilePath = path.join(tmpDir, 'test-actions.json');

function makeAction(overrides: Partial<Action> = {}): Action {
    return {
        id: `act_${Math.random().toString(36).slice(2, 8)}`,
        type: 'TASK',
        payload: { description: 'Test task' },
        priority: 5,
        status: 'pending',
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

describe('ActionQueue', () => {
    let queue: ActionQueue;

    beforeEach(() => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        // Disable timers in tests to avoid lingering intervals
        queue = new ActionQueue(testFilePath, {
            flushInterval: 999999,
            maintenanceInterval: 999999,
            completedTTL: 5000,     // 5s for testing
            failedTTL: 10000,       // 10s for testing
            staleTimeout: 2000,     // 2s for testing
        });
    });

    afterEach(() => {
        queue.shutdown();
        try {
            if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
            if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
    });

    // ── Core CRUD ────────────────────────────────────────────────────

    it('should push and retrieve actions', () => {
        const action = makeAction({ id: 'a1', priority: 10 });
        queue.push(action);
        expect(queue.getQueue().length).toBe(1);
        expect(queue.getAction('a1')).toBeDefined();
        expect(queue.getAction('a1')!.priority).toBe(10);
    });

    it('should sort by priority on push', () => {
        queue.push(makeAction({ id: 'low', priority: 1 }));
        queue.push(makeAction({ id: 'high', priority: 100 }));
        queue.push(makeAction({ id: 'mid', priority: 50 }));

        const q = queue.getQueue();
        expect(q[0].id).toBe('high');
        expect(q[1].id).toBe('mid');
        expect(q[2].id).toBe('low');
    });

    it('should return next pending action', () => {
        queue.push(makeAction({ id: 'a1', priority: 5 }));
        queue.push(makeAction({ id: 'a2', priority: 10 }));

        const next = queue.getNext();
        expect(next).toBeDefined();
        expect(next!.id).toBe('a2'); // higher priority
    });

    it('should prefer user lane over higher-priority autonomy lane', () => {
        queue.push(makeAction({ id: 'auto-high', priority: 100, lane: 'autonomy' }));
        queue.push(makeAction({ id: 'user-low', priority: 1, lane: 'user' }));

        const next = queue.getNext();
        expect(next).toBeDefined();
        expect(next!.id).toBe('user-low');
    });

    it('should return autonomy lane task when no eligible user lane exists', () => {
        queue.push(makeAction({ id: 'auto-high', priority: 100, lane: 'autonomy' }));
        queue.push(makeAction({ id: 'auto-low', priority: 10, lane: 'autonomy' }));

        const next = queue.getNext();
        expect(next).toBeDefined();
        expect(next!.id).toBe('auto-high');
    });

    it('should update status', () => {
        queue.push(makeAction({ id: 'a1' }));
        queue.updateStatus('a1', 'in-progress');

        const action = queue.getAction('a1');
        expect(action!.status).toBe('in-progress');
        expect(action!.updatedAt).toBeDefined();
    });

    it('should update payload', () => {
        queue.push(makeAction({ id: 'a1', payload: { foo: 1 } }));
        queue.updatePayload('a1', { bar: 2 });

        const action = queue.getAction('a1');
        expect(action!.payload.foo).toBe(1);
        expect(action!.payload.bar).toBe(2);
    });

    it('should skip non-pending actions in getNext', () => {
        queue.push(makeAction({ id: 'a1', status: 'completed' as any }));
        queue.push(makeAction({ id: 'a2', status: 'failed' as any }));

        expect(queue.getNext()).toBeUndefined();
    });

    // ── Filtered Accessors ───────────────────────────────────────────

    it('getActive should only return active statuses', () => {
        queue.push(makeAction({ id: 'pending1' }));
        queue.push(makeAction({ id: 'waiting1' }));
        queue.updateStatus('waiting1', 'waiting');
        queue.push(makeAction({ id: 'done1' }));
        queue.updateStatus('done1', 'completed');

        const active = queue.getActive();
        expect(active.length).toBe(2);
        expect(active.map(a => a.id).sort()).toEqual(['pending1', 'waiting1']);
    });

    it('getCounts should tally correctly', () => {
        queue.push(makeAction({ id: 'a1' }));
        queue.push(makeAction({ id: 'a2' }));
        queue.updateStatus('a2', 'in-progress');
        queue.push(makeAction({ id: 'a3' }));
        queue.updateStatus('a3', 'completed');

        const counts = queue.getCounts();
        expect(counts.pending).toBe(1);
        expect(counts['in-progress']).toBe(1);
        expect(counts.completed).toBe(1);
    });

    // ── In-Memory Cache + Persistence ────────────────────────────────

    it('should persist to disk on flush and survive reload', () => {
        queue.push(makeAction({ id: 'persist1' }));
        queue.flush();

        // Create a new queue instance pointing to the same file
        const queue2 = new ActionQueue(testFilePath, {
            flushInterval: 999999,
            maintenanceInterval: 999999,
        });
        expect(queue2.getAction('persist1')).toBeDefined();
        queue2.shutdown();
    });

    it('should recover from corrupt JSON on disk', () => {
        queue.shutdown();
        // Write garbage to the file
        fs.writeFileSync(testFilePath, '{{{corrupt garbage!!!');

        const queue2 = new ActionQueue(testFilePath, {
            flushInterval: 999999,
            maintenanceInterval: 999999,
        });
        // Should auto-recover: empty queue, corrupt file backed up
        expect(queue2.getQueue().length).toBe(0);
        queue2.shutdown();
    });

    // ── Dependency Chains ────────────────────────────────────────────

    it('getNext should skip actions with unmet dependencies', () => {
        const parent = makeAction({ id: 'parent', priority: 10 });
        const child = makeAction({ id: 'child', priority: 100, dependsOn: 'parent' });

        queue.push(parent);
        queue.push(child);

        // Child has higher priority but depends on parent
        const next = queue.getNext();
        expect(next!.id).toBe('parent');
    });

    it('getNext should unblock child after parent completes', () => {
        const parent = makeAction({ id: 'parent', priority: 10 });
        queue.push(parent);
        queue.push(makeAction({ id: 'child', priority: 100, dependsOn: 'parent' }));

        queue.updateStatus('parent', 'in-progress');
        queue.updateStatus('parent', 'completed');

        const next = queue.getNext();
        expect(next!.id).toBe('child');
    });

    it('pushAfter should set dependency', () => {
        queue.push(makeAction({ id: 'step1' }));
        queue.pushAfter('step1', makeAction({ id: 'step2' }));

        const child = queue.getAction('step2');
        expect(child!.dependsOn).toBe('step1');
    });

    it('pushChain should create sequential dependencies', () => {
        const ids = queue.pushChain([
            makeAction({ id: 'c1' }),
            makeAction({ id: 'c2' }),
            makeAction({ id: 'c3' }),
        ]);

        expect(ids).toEqual(['c1', 'c2', 'c3']);
        expect(queue.getAction('c1')!.dependsOn).toBeUndefined();
        expect(queue.getAction('c2')!.dependsOn).toBe('c1');
        expect(queue.getAction('c3')!.dependsOn).toBe('c2');
    });

    // ── Retry with Backoff ───────────────────────────────────────────

    it('should auto-retry on failure when retry policy allows', () => {
        const action = makeAction({ id: 'retry1' });
        action.retry = { maxAttempts: 3, attempts: 0, baseDelay: 1 };
        queue.push(action);

        queue.updateStatus('retry1', 'in-progress');
        queue.updateStatus('retry1', 'failed');

        const retried = queue.getAction('retry1');
        expect(retried!.status).toBe('pending'); // re-queued
        expect(retried!.retry!.attempts).toBe(1);
        expect(retried!.retry!.nextRetryAt).toBeDefined();
    });


    it('should default to no auto-retry when retry policy is not provided', () => {
        queue.push(makeAction({ id: 'default-no-retry' }));

        queue.updateStatus('default-no-retry', 'in-progress');
        queue.updateStatus('default-no-retry', 'failed');

        const action = queue.getAction('default-no-retry');
        expect(action!.retry!.maxAttempts).toBe(0);
        expect(action!.status).toBe('failed');
        expect(action!.expiresAt).toBeDefined();
    });
    it('should not retry when max attempts exhausted', () => {
        const action = makeAction({ id: 'noretry' });
        // maxAttempts: 0 means no retries at all — fail immediately
        action.retry = { maxAttempts: 0, attempts: 0, baseDelay: 1 };
        queue.push(action);

        queue.updateStatus('noretry', 'in-progress');
        queue.updateStatus('noretry', 'failed');

        const a = queue.getAction('noretry');
        expect(a!.status).toBe('failed');
        expect(a!.expiresAt).toBeDefined();
    });

    it('getNext should respect retry backoff timing', () => {
        const action = makeAction({ id: 'backoff1' });
        action.retry = { maxAttempts: 3, attempts: 0, baseDelay: 3600 }; // 1 hour base
        queue.push(action);

        queue.updateStatus('backoff1', 'in-progress');
        queue.updateStatus('backoff1', 'failed'); // re-queued pending but nextRetryAt is in the future

        // Should NOT be returned by getNext because backoff is in the future
        const next = queue.getNext();
        expect(next?.id).not.toBe('backoff1');
    });

    it('setRetryPolicy should configure retry on existing action', () => {
        queue.push(makeAction({ id: 'configretry' }));
        queue.setRetryPolicy('configretry', 5, 30);

        const action = queue.getAction('configretry');
        expect(action!.retry!.maxAttempts).toBe(5);
        expect(action!.retry!.baseDelay).toBe(30);
    });

    // ── Maintenance: TTL Cleanup ────────────────────────────────────

    it('should clean up expired completed actions', async () => {
        queue.push(makeAction({ id: 'old1' }));
        queue.updateStatus('old1', 'in-progress');
        queue.updateStatus('old1', 'completed');

        // Manually set expiresAt to the past
        const action = queue.getAction('old1');
        action!.expiresAt = new Date(Date.now() - 1000).toISOString();

        queue.runMaintenance();
        expect(queue.getAction('old1')).toBeUndefined();
    });

    // ── Maintenance: Stale Recovery ─────────────────────────────────

    it('should recover stale in-progress actions', async () => {
        queue.push(makeAction({ id: 'stale1' }));
        queue.updateStatus('stale1', 'in-progress');

        // Manually set updatedAt to the past (beyond staleTimeout of 2s)
        const action = queue.getAction('stale1');
        action!.updatedAt = new Date(Date.now() - 5000).toISOString();

        queue.runMaintenance();
        expect(queue.getAction('stale1')!.status).toBe('pending');
    });

    // ── Maintenance: Cascade Failures ────────────────────────────────

    it('should cascade-fail chained actions when parent fails permanently', () => {
        const parent = makeAction({ id: 'parent_fail' });
        parent.retry = { maxAttempts: 1, attempts: 1, baseDelay: 1 }; // exhausted
        queue.push(parent);
        queue.updateStatus('parent_fail', 'in-progress');
        queue.updateStatus('parent_fail', 'failed');

        queue.pushAfter('parent_fail', makeAction({ id: 'child_fail' }));

        queue.runMaintenance();
        expect(queue.getAction('child_fail')!.status).toBe('failed');
    });

    it('should unblock chained action when parent is cleaned up', () => {
        queue.push(makeAction({ id: 'orphan_child', dependsOn: 'nonexistent_parent' }));

        queue.runMaintenance();
        // Dependency should be removed since parent doesn't exist
        expect(queue.getAction('orphan_child')!.dependsOn).toBeUndefined();
    });

    // ── Lifecycle ────────────────────────────────────────────────────

    it('shutdown should flush and stop timers', () => {
        queue.push(makeAction({ id: 'shutdown1' }));
        queue.shutdown();

        // File should exist on disk with the data
        const data = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
        expect(data.some((a: any) => a.id === 'shutdown1')).toBe(true);
    });

    it('reload should re-read from disk', () => {
        queue.push(makeAction({ id: 'reload1' }));
        queue.flush();

        // External edit: add an action directly to disk
        const data = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
        data.push(makeAction({ id: 'external1' }));
        fs.writeFileSync(testFilePath, JSON.stringify(data, null, 2));

        queue.reload();
        expect(queue.getAction('external1')).toBeDefined();
    });
});
