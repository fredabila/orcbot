import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';
import fs from 'fs';
import path from 'path';

export interface Action {
    id: string;
    type: string;
    payload: any;
    priority: number;
    lane?: 'user' | 'autonomy';
    status: 'pending' | 'waiting' | 'in-progress' | 'completed' | 'failed';
    timestamp: string;
    updatedAt?: string;
    /** Optional: ID of another action that must complete before this one can run */
    dependsOn?: string;
    /** Retry policy — set automatically with defaults, or configured per-action */
    retry?: {
        maxAttempts: number;
        attempts: number;
        /** Next eligible retry time (ISO string). Set automatically on failure. */
        nextRetryAt?: string;
        /** Backoff base in seconds: actual delay = baseDelay * 2^(attempts-1) */
        baseDelay: number;
    };
    /** When this action should be auto-cleaned (ISO string). Set on completion/failure. */
    expiresAt?: string;
}

export interface ActionQueueOptions {
    /** How long (ms) to keep completed actions before auto-cleanup. Default: 24h */
    completedTTL?: number;
    /** How long (ms) to keep failed actions before auto-cleanup. Default: 72h */
    failedTTL?: number;
    /** How long (ms) an in-progress action can run before being considered stale. Default: 30min */
    staleTimeout?: number;
    /** How often (ms) to run maintenance (cleanup + stale recovery). Default: 60s */
    maintenanceInterval?: number;
    /** How often (ms) to flush the in-memory cache to disk. Default: 5s */
    flushInterval?: number;
}

const DEFAULT_COMPLETED_TTL = 24 * 60 * 60 * 1000;     // 24 hours
const DEFAULT_FAILED_TTL = 72 * 60 * 60 * 1000;        // 72 hours
const DEFAULT_STALE_TIMEOUT = 30 * 60 * 1000;           // 30 minutes
const DEFAULT_MAINTENANCE_INTERVAL = 60 * 1000;         // 60 seconds
const DEFAULT_FLUSH_INTERVAL = 5 * 1000;                // 5 seconds

export class ActionQueue {
    private filePath: string;
    private cache: Action[] = [];
    private dirty: boolean = false;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
    private writeLock: boolean = false;

    private completedTTL: number;
    private failedTTL: number;
    private staleTimeout: number;

    constructor(filePath: string = './actions.json', options?: ActionQueueOptions) {
        this.filePath = path.resolve(process.cwd(), filePath);
        this.completedTTL = options?.completedTTL ?? DEFAULT_COMPLETED_TTL;
        this.failedTTL = options?.failedTTL ?? DEFAULT_FAILED_TTL;
        this.staleTimeout = options?.staleTimeout ?? DEFAULT_STALE_TIMEOUT;

        this.initialize();

        // Periodic flush: write dirty cache to disk
        const flushMs = options?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
        this.flushTimer = setInterval(() => this.flush(), flushMs);

        // Periodic maintenance: cleanup expired + recover stale actions
        const maintMs = options?.maintenanceInterval ?? DEFAULT_MAINTENANCE_INTERVAL;
        this.maintenanceTimer = setInterval(() => this.runMaintenance(), maintMs);
    }

    // ─── Initialization ──────────────────────────────────────────────

    private initialize() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
        }
        // Load from disk into in-memory cache
        this.cache = this.readFromDisk();

        eventBus.on('action:push', (action: Action) => {
            this.push(action);
        });
    }

    // ─── Disk I/O (private — only used for initial load and flush) ───

    private readFromDisk(): Action[] {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            const data = fs.readFileSync(this.filePath, 'utf-8');
            if (!data || data.trim().length === 0) return [];
            return JSON.parse(data);
        } catch (e) {
            logger.error(`Failed to read ActionQueue from disk: ${e}`);
            try {
                const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
                if (fs.existsSync(this.filePath)) {
                    fs.renameSync(this.filePath, corruptPath);
                    logger.warn(`ActionQueue: Corrupt file moved to ${corruptPath}`);
                }
                fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
            } catch (recoveryError) {
                logger.error(`ActionQueue recovery failed: ${recoveryError}`);
            }
            return [];
        }
    }

    /**
     * Write the in-memory cache to disk if dirty.
     * Uses atomic write (write temp → rename) to prevent corruption on crash.
     */
    public flush(): void {
        if (!this.dirty || this.writeLock) return;
        this.writeLock = true;
        try {
            const tmpPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2));
            fs.renameSync(tmpPath, this.filePath);
            this.dirty = false;
        } catch (e) {
            logger.error(`Failed to flush ActionQueue to disk: ${e}`);
        } finally {
            this.writeLock = false;
        }
    }

    private markDirty() {
        this.dirty = true;
    }

    private getLane(action: Action): 'user' | 'autonomy' {
        return action.lane === 'autonomy' ? 'autonomy' : 'user';
    }

    private isEligiblePendingAction(action: Action, nowIso: string): boolean {
        if (action.status !== 'pending') return false;

        // Dependency gate: wait for parent to complete
        if (action.dependsOn) {
            const dep = this.cache.find(d => d.id === action.dependsOn);
            if (!dep || dep.status !== 'completed') return false;
        }

        // Session Serialization: Ensure no other action for the same session is "active"
        // Active = in-progress (running now) or waiting (paused for user input)
        const sessionId = action.payload?.sessionScopeId;
        if (sessionId) {
            const sessionBusy = this.cache.some(a => 
                (a.status === 'in-progress' || a.status === 'waiting') && 
                a.payload?.sessionScopeId === sessionId &&
                a.id !== action.id
            );
            if (sessionBusy) return false;
        }

        // Retry backoff: not yet eligible
        if (action.retry?.nextRetryAt && action.retry.nextRetryAt > nowIso) return false;

        return true;
    }

    // ─── Core Operations (all operate on in-memory cache) ────────────

    public push(action: Action) {
        // Ensure retry defaults for new actions
        if (!action.retry) {
            // Default to NO automatic retries.
            //
            // Why: user-facing tasks can be intentionally marked failed by guardrails
            // (e.g. completion audit blocks, exhausted no-tool retries). When retries are
            // enabled by default, those terminal failures silently re-queue the exact same
            // task and the agent appears to "redo" completed work. Callers that genuinely
            // want auto-retry should set an explicit policy via `action.retry` or
            // `setRetryPolicy(...)`.
            action.retry = { maxAttempts: 0, attempts: 0, baseDelay: 60 };
        }
        this.cache.push(action);
        this.cache.sort((a, b) => b.priority - a.priority);
        this.markDirty();
        // Flush immediately on push so the action is durable right away
        this.flush();
        logger.info(`Action pushed and saved: ${action.type} (${action.id})`);
        eventBus.emit('action:queued', action);
    }

    /**
     * Get the next eligible pending action, respecting:
     * - Priority ordering (highest first, maintained by push sort)
     * - Dependency chains (skip if dependsOn action hasn't completed)
     * - Retry backoff (skip if nextRetryAt is in the future)
     * - Lane fairness: user lane is preferred over autonomy lane when both are eligible
     *
     * @param lane — if provided, only return actions belonging to this lane.
     *               Used by parallel workers so each lane has its own independent cursor.
     */
    public getNext(lane?: 'user' | 'autonomy'): Action | undefined {
        const now = new Date().toISOString();

        const eligible = this.cache.filter(a => this.isEligiblePendingAction(a, now));
        if (eligible.length === 0) return undefined;

        // Lane-filtered mode: used by dedicated lane workers
        if (lane !== undefined) {
            return eligible.find(a => this.getLane(a) === lane);
        }

        // Legacy single-worker mode: prefer user lane over autonomy
        const nextUser = eligible.find(a => this.getLane(a) === 'user');
        if (nextUser) return nextUser;

        return eligible[0];
    }

    public updateStatus(id: string, status: Action['status']) {
        const action = this.cache.find(a => a.id === id);
        if (!action) return;

        const oldStatus = action.status;
        action.status = status;
        action.updatedAt = new Date().toISOString();

        // Set expiration TTL on terminal states
        if (status === 'completed') {
            action.expiresAt = new Date(Date.now() + this.completedTTL).toISOString();
        } else if (status === 'failed') {
            // Auto-retry if retry policy allows
            if (action.retry && action.retry.attempts < action.retry.maxAttempts) {
                action.retry.attempts++;
                const delay = action.retry.baseDelay * Math.pow(2, action.retry.attempts - 1);
                action.retry.nextRetryAt = new Date(Date.now() + delay * 1000).toISOString();
                action.status = 'pending'; // Re-queue for retry
                action.expiresAt = undefined;
                logger.info(`Action ${id} scheduled for retry ${action.retry.attempts}/${action.retry.maxAttempts} in ${delay}s`);
            } else {
                action.expiresAt = new Date(Date.now() + this.failedTTL).toISOString();
            }
        }

        this.markDirty();
        this.flush();
        logger.info(`Action ${id} status updated to ${action.status} (persistent)${oldStatus === 'failed' && action.status === 'pending' ? ' [auto-retry]' : ''}`);
    }

    public updatePayload(id: string, payloadPatch: Record<string, any>) {
        const action = this.cache.find(a => a.id === id);
        if (!action) return;

        const currentPayload = (action.payload && typeof action.payload === 'object') ? action.payload : {};
        action.payload = { ...currentPayload, ...payloadPatch };
        action.updatedAt = new Date().toISOString();
        this.markDirty();
        this.flush();
        logger.info(`Action ${id} payload updated (persistent)`);
    }

    /** Returns the full queue (backwards-compatible) */
    public getQueue(): Action[] {
        return this.cache;
    }

    public getAction(id: string): Action | undefined {
        return this.cache.find(action => action.id === id);
    }

    // ─── New: Filtered accessors ─────────────────────────────────────

    /** Get only active actions (pending, in-progress, waiting) — skips the dead weight */
    public getActive(): Action[] {
        return this.cache.filter(a =>
            a.status === 'pending' || a.status === 'in-progress' || a.status === 'waiting'
        );
    }

    /** Quick count by status without copying arrays */
    public getCounts(): Record<Action['status'], number> {
        const counts: Record<string, number> = {
            pending: 0, waiting: 0, 'in-progress': 0, completed: 0, failed: 0
        };
        for (const a of this.cache) {
            counts[a.status] = (counts[a.status] || 0) + 1;
        }
        return counts as Record<Action['status'], number>;
    }

    // ─── New: Action chaining ────────────────────────────────────────

    /**
     * Push an action that depends on another action completing first.
     * Won't be picked up by getNext() until the parent reaches 'completed'.
     */
    public pushAfter(parentId: string, action: Action): void {
        action.dependsOn = parentId;
        this.push(action);
        logger.info(`Action ${action.id} chained after ${parentId}`);
    }

    /**
     * Push an ordered chain of actions where each depends on the previous.
     * Returns the IDs in execution order.
     */
    public pushChain(actions: Action[]): string[] {
        const ids: string[] = [];
        for (let i = 0; i < actions.length; i++) {
            if (i > 0) {
                actions[i].dependsOn = actions[i - 1].id;
            }
            this.push(actions[i]);
            ids.push(actions[i].id);
        }
        logger.info(`Action chain created: ${ids.join(' → ')}`);
        return ids;
    }

    // ─── New: Retry configuration ────────────────────────────────────

    /**
     * Set a retry policy on an existing action.
     * Useful for the agent to mark a task as auto-retryable before it fails.
     */
    public setRetryPolicy(id: string, maxAttempts: number, baseDelay: number = 60): void {
        const action = this.cache.find(a => a.id === id);
        if (!action) return;
        action.retry = {
            maxAttempts,
            attempts: action.retry?.attempts || 0,
            baseDelay,
            nextRetryAt: action.retry?.nextRetryAt
        };
        this.markDirty();
        logger.info(`Action ${id} retry policy: ${maxAttempts} attempts, ${baseDelay}s base delay`);
    }

    // ─── Maintenance: Cleanup + Stale Recovery ───────────────────────

    /**
     * Periodic maintenance (runs on timer):
     * 1. Remove expired completed/failed actions (TTL cleanup)
     * 2. Recover stale in-progress actions (crash recovery)
     * 3. Cascade-fail chained actions whose parent failed permanently
     */
    public runMaintenance(): void {
        const now = new Date().toISOString();
        const nowMs = Date.now();
        let cleaned = 0;
        let recovered = 0;
        let cascaded = 0;

        // 1. TTL Cleanup
        const beforeLen = this.cache.length;
        this.cache = this.cache.filter(a => {
            if (a.expiresAt && a.expiresAt < now) {
                cleaned++;
                return false;
            }
            return true;
        });

        // 2. Stale Recovery: reset stuck in-progress actions to pending
        for (const action of this.cache) {
            if (action.status === 'in-progress' && action.updatedAt) {
                const elapsed = nowMs - new Date(action.updatedAt).getTime();
                if (elapsed > this.staleTimeout) {
                    logger.warn(`ActionQueue: Recovering stale action ${action.id} (stuck in-progress for ${Math.round(elapsed / 60000)}min)`);
                    action.status = 'pending';
                    action.updatedAt = new Date().toISOString();
                    recovered++;
                }
            }
        }

        // 3. Cascade: fail chained actions whose parent failed with no retries left
        for (const action of this.cache) {
            if (action.status === 'pending' && action.dependsOn) {
                const parent = this.cache.find(p => p.id === action.dependsOn);
                if (parent && parent.status === 'failed') {
                    const hasRetriesLeft = parent.retry && parent.retry.attempts < parent.retry.maxAttempts;
                    if (!hasRetriesLeft) {
                        logger.warn(`ActionQueue: Cascade-failing chained action ${action.id} — parent ${action.dependsOn} failed permanently`);
                        action.status = 'failed';
                        action.updatedAt = new Date().toISOString();
                        action.expiresAt = new Date(nowMs + this.failedTTL).toISOString();
                        cascaded++;
                    }
                }
                // If parent was cleaned up / expired, remove the dependency so the action can run
                if (!parent) {
                    logger.info(`ActionQueue: Removing stale dependency ${action.dependsOn} from action ${action.id}`);
                    action.dependsOn = undefined;
                    cascaded++;
                }
            }
        }

        if (cleaned > 0 || recovered > 0 || cascaded > 0) {
            this.markDirty();
            logger.info(`ActionQueue maintenance: cleaned ${cleaned}, recovered ${recovered} stale, cascaded ${cascaded} chained`);
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────

    /**
     * Stop background timers and flush final state to disk.
     * Call during graceful shutdown.
     */
    public shutdown(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = null;
        }
        this.flush();
        logger.info('ActionQueue: Shutdown complete, final state flushed.');
    }

    /**
     * Force reload from disk (useful after external edits or in tests).
     */
    public reload(): void {
        this.cache = this.readFromDisk();
        this.dirty = false;
    }
}
