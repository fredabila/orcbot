import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export class JSONAdapter {
    private filePath: string;
    private backupPath: string;
    private tmpPath: string;
    private cache: any = null;
    private writeLock: boolean = false;

    // ── Write-behind buffer ──
    // Instead of writing to disk on every save(), we mark the cache as dirty
    // and flush periodically (default 500ms) or on explicit flush() call.
    // This coalesces multiple saves per step into a single disk write.
    private _dirty: boolean = false;
    private _flushTimer: ReturnType<typeof setTimeout> | null = null;
    private _flushIntervalMs: number = 500;

    constructor(filePath: string, options?: { flushIntervalMs?: number }) {
        this.filePath = filePath;
        this.backupPath = filePath + '.bak';
        this.tmpPath = filePath + '.tmp';
        if (options?.flushIntervalMs !== undefined) {
            this._flushIntervalMs = options.flushIntervalMs;
        }
        this.initialize();
    }

    private initialize() {
        if (!fs.existsSync(this.filePath) || fs.statSync(this.filePath).size === 0) {
            // Check for backup recovery
            if (fs.existsSync(this.backupPath)) {
                try {
                    const backup = fs.readFileSync(this.backupPath, 'utf-8');
                    this.cache = JSON.parse(backup);
                    this.atomicWrite(); // Restore from backup
                    logger.warn(`JSONAdapter: Recovered from backup for ${this.filePath}`);
                    return;
                } catch {
                    // Backup also corrupt, start fresh
                }
            }
            this.cache = {};
            this.atomicWrite();
            logger.info(`JSON fallback storage initialized at ${this.filePath}`);
        } else {
            this.read(); // Load into cache
        }
    }

    /**
     * Atomic write: write to temp file, then rename.
     * Keeps a .bak copy of the previous version for crash recovery.
     */
    private atomicWrite(): void {
        if (this.writeLock) return;
        this.writeLock = true;
        try {
            const data = JSON.stringify(this.cache, null, 2);
            // Write to temp file first
            fs.writeFileSync(this.tmpPath, data, 'utf-8');
            // Backup current file (if exists)
            if (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > 0) {
                try { fs.copyFileSync(this.filePath, this.backupPath); } catch { /* best-effort */ }
            }
            // Atomic rename
            fs.renameSync(this.tmpPath, this.filePath);
        } catch (error) {
            logger.error(`JSONAdapter: Atomic write failed for ${this.filePath}: ${error}`);
            // Fallback: direct write
            try {
                fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
            } catch (e2) {
                logger.error(`JSONAdapter: Fallback write also failed: ${e2}`);
            }
        } finally {
            this.writeLock = false;
        }
    }

    public save(key: string, value: any) {
        if (!this.cache) this.read();
        this.cache[key] = value;
        this._scheduleDeferredWrite();
    }

    /**
     * Schedule a deferred disk write. Multiple save() calls within the flush
     * interval are coalesced into a single atomicWrite(), eliminating redundant
     * blocking I/O during high-frequency save bursts (e.g., multiple memory
     * saves per agent step).
     */
    private _scheduleDeferredWrite(): void {
        this._dirty = true;
        if (this._flushTimer) return; // Already scheduled
        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            if (this._dirty) {
                this.atomicWrite();
                this._dirty = false;
            }
        }, this._flushIntervalMs);
    }

    /**
     * Force an immediate flush of any pending writes to disk.
     * Call this at step boundaries, action completion, or shutdown.
     */
    public flush(): void {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        if (this._dirty) {
            this.atomicWrite();
            this._dirty = false;
        }
    }

    /**
     * Shut down the adapter cleanly: flush pending writes and cancel timers.
     */
    public shutdown(): void {
        this.flush();
    }

    public get(key: string) {
        if (!this.cache) this.read();
        return this.cache[key];
    }

    private read() {
        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            this.cache = JSON.parse(content);
            return this.cache;
        } catch (error) {
            logger.error(`JSONAdapter: Error reading from ${this.filePath}: ${error}`);
            // Try backup recovery
            if (fs.existsSync(this.backupPath)) {
                try {
                    const backup = fs.readFileSync(this.backupPath, 'utf-8');
                    this.cache = JSON.parse(backup);
                    logger.warn(`JSONAdapter: Recovered from backup after read error`);
                    this.atomicWrite(); // Restore the main file
                    return this.cache;
                } catch {
                    logger.error(`JSONAdapter: Backup also unreadable, starting fresh`);
                }
            }
            this.cache = this.cache || {};
            return this.cache;
        }
    }
}
