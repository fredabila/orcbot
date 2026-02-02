import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DaemonManager } from '../src/utils/daemon';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Magic number for testing non-existent process
const NON_EXISTENT_PID = 99999999;

describe('DaemonManager', () => {
  const testDataDir = path.join(os.tmpdir(), 'orcbot-test-daemon-' + Date.now());
  let daemonManager: DaemonManager;

  beforeEach(() => {
    // Create a temporary directory for tests
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    daemonManager = new DaemonManager(testDataDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should not detect a running daemon when no PID file exists', () => {
    const status = daemonManager.isRunning();
    expect(status.running).toBe(false);
    expect(status.pid).toBeUndefined();
  });

  it('should write and read PID file correctly', () => {
    daemonManager.writePidFile();
    
    const pidFile = daemonManager.getPidFile();
    expect(fs.existsSync(pidFile)).toBe(true);
    
    const pidContent = fs.readFileSync(pidFile, 'utf8');
    expect(parseInt(pidContent, 10)).toBe(process.pid);
  });

  it('should detect current process as running after writing PID', () => {
    daemonManager.writePidFile();
    
    const status = daemonManager.isRunning();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
  });

  it('should clean up stale PID file for non-existent process', () => {
    const pidFile = daemonManager.getPidFile();
    fs.writeFileSync(pidFile, NON_EXISTENT_PID.toString(), 'utf8');
    
    const status = daemonManager.isRunning();
    expect(status.running).toBe(false);
    // PID file should be cleaned up
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('should remove PID file when requested', () => {
    daemonManager.writePidFile();
    const pidFile = daemonManager.getPidFile();
    expect(fs.existsSync(pidFile)).toBe(true);
    
    daemonManager.removePidFile();
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('should handle invalid PID file content', () => {
    const pidFile = daemonManager.getPidFile();
    fs.writeFileSync(pidFile, 'invalid-pid', 'utf8');
    
    const status = daemonManager.isRunning();
    expect(status.running).toBe(false);
    // Invalid PID file should be cleaned up
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('should return correct PID and log file paths', () => {
    const pidFile = daemonManager.getPidFile();
    const logFile = daemonManager.getLogFile();
    
    expect(pidFile).toBe(path.join(testDataDir, 'orcbot.pid'));
    expect(logFile).toBe(path.join(testDataDir, 'logs', 'orcbot.log'));
  });

  it('should create logs directory if it does not exist', () => {
    const logsDir = path.dirname(daemonManager.getLogFile());
    expect(fs.existsSync(logsDir)).toBe(true);
  });
});
