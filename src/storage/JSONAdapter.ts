import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export class JSONAdapter {
    private filePath: string;
    private backupPath: string;
    private tmpPath: string;
    private cache: any = null;
    private writeLock: boolean = false;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.backupPath = filePath + '.bak';
        this.tmpPath = filePath + '.tmp';
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
        this.atomicWrite();
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
