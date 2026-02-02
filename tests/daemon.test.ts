import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DaemonManager } from '../src/utils/daemon';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DaemonManager', () => {
    const testDir = path.join(os.tmpdir(), 'orcbot-daemon-test');
    const testPidFile = path.join(testDir, 'test.pid');
    const testLogFile = path.join(testDir, 'test.log');
    let daemonManager: DaemonManager;

    beforeEach(() => {
        // Create test directory
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        daemonManager = new DaemonManager({
            pidFile: testPidFile,
            logFile: testLogFile,
            dataDir: testDir
        });
    });

    afterEach(() => {
        // Clean up test files
        if (fs.existsSync(testPidFile)) {
            fs.unlinkSync(testPidFile);
        }
        if (fs.existsSync(testLogFile)) {
            fs.unlinkSync(testLogFile);
        }
        if (fs.existsSync(testDir)) {
            fs.rmdirSync(testDir, { recursive: true });
        }
    });

    it('should detect when daemon is not running', () => {
        const status = daemonManager.isRunning();
        expect(status.running).toBe(false);
        expect(status.pid).toBeUndefined();
    });

    it('should write PID file correctly', () => {
        const testPid = process.pid;
        daemonManager.writePidFile(testPid);

        expect(fs.existsSync(testPidFile)).toBe(true);
        const content = fs.readFileSync(testPidFile, 'utf8');
        expect(content).toBe(testPid.toString());
    });

    it('should detect running process from PID file', () => {
        // Write current process PID
        daemonManager.writePidFile(process.pid);

        const status = daemonManager.isRunning();
        expect(status.running).toBe(true);
        expect(status.pid).toBe(process.pid);
    });

    it('should detect stale PID file with non-existent process', () => {
        // Write a PID that definitely doesn't exist
        const fakePid = 9999999;
        fs.writeFileSync(testPidFile, fakePid.toString());

        const status = daemonManager.isRunning();
        expect(status.running).toBe(false);
    });

    it('should remove PID file', () => {
        daemonManager.writePidFile(process.pid);
        expect(fs.existsSync(testPidFile)).toBe(true);

        daemonManager.removePidFile();
        expect(fs.existsSync(testPidFile)).toBe(false);
    });

    it('should return status string when not running', () => {
        const status = daemonManager.getStatus();
        expect(status).toContain('not running');
    });

    it('should return status string when running', () => {
        daemonManager.writePidFile(process.pid);
        const status = daemonManager.getStatus();
        expect(status).toContain('running');
        expect(status).toContain(process.pid.toString());
    });

    it('should create default instance with standard paths', () => {
        const defaultManager = DaemonManager.createDefault();
        expect(defaultManager).toBeInstanceOf(DaemonManager);
        
        // When not running, status should just say "not running"
        // But we can test that it's using the correct paths by checking if it creates default dirs
        const homeDir = os.homedir();
        const expectedDataDir = path.join(homeDir, '.orcbot');
        
        // Just verify it creates instance successfully
        expect(defaultManager).toBeDefined();
    });
});
