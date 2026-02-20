import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger';

export type SessionStatus = 'running' | 'exited' | 'killed' | 'error';

export interface SessionInfo {
    id: string;
    command: string;
    cwd: string;
    pid?: number;
    status: SessionStatus;
    exitCode?: number;
    startedAt: string;
    lineCount: number;
}

const RING_BUFFER_SIZE = 500; // max lines per session

export class ShellSession {
    public readonly id: string;
    public readonly command: string;
    public readonly cwd: string;
    public readonly startedAt: string;

    private process: ChildProcess;
    private lines: string[] = [];
    private _status: SessionStatus = 'running';
    private _exitCode?: number;
    private _pid?: number;

    constructor(id: string, command: string, cwd: string) {
        this.id = id;
        this.command = command;
        this.cwd = cwd;
        this.startedAt = new Date().toISOString();

        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'powershell.exe' : '/bin/sh';
        const shellFlag = isWindows ? '-Command' : '-c';

        this.process = spawn(shell, [shellFlag, command], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
            windowsHide: true,
        });

        this._pid = this.process.pid;

        this.process.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            const newLines = text.split('\n').filter(l => l !== '');
            this.appendLines(newLines);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            const newLines = text.split('\n').filter(l => l !== '').map(l => `[stderr] ${l}`);
            this.appendLines(newLines);
        });

        this.process.on('close', (code) => {
            this._status = code === null ? 'killed' : 'exited';
            this._exitCode = code ?? undefined;
            this.appendLines([`[session] Process exited with code ${code}`]);
            logger.info(`ShellSession[${id}]: Process exited with code ${code}`);
        });

        this.process.on('error', (err) => {
            this._status = 'error';
            this.appendLines([`[session] Process error: ${err.message}`]);
            logger.error(`ShellSession[${id}]: Process error: ${err.message}`);
        });

        logger.info(`ShellSession[${id}]: Started PID=${this._pid} command="${command}" cwd="${cwd}"`);
    }

    private appendLines(newLines: string[]): void {
        this.lines.push(...newLines);
        // Keep within ring buffer size
        if (this.lines.length > RING_BUFFER_SIZE) {
            this.lines = this.lines.slice(this.lines.length - RING_BUFFER_SIZE);
        }
    }

    get status(): SessionStatus {
        return this._status;
    }

    get pid(): number | undefined {
        return this._pid;
    }

    get exitCode(): number | undefined {
        return this._exitCode;
    }

    /**
     * Read the last `count` lines of output from the session.
     */
    public read(count: number = 50): string[] {
        return this.lines.slice(-count);
    }

    /**
     * Send a line of text to the process's stdin.
     */
    public send(input: string): void {
        if (this._status !== 'running') {
            throw new Error(`Session "${this.id}" is not running (status: ${this._status})`);
        }
        if (!this.process.stdin) {
            throw new Error(`Session "${this.id}" has no writable stdin`);
        }
        // Ensure newline termination
        const line = input.endsWith('\n') ? input : `${input}\n`;
        this.process.stdin.write(line);
        logger.debug(`ShellSession[${this.id}]: Sent input: ${input.trim()}`);
    }

    /**
     * Kill the session process.
     */
    public kill(signal: NodeJS.Signals = 'SIGTERM'): void {
        if (this._status !== 'running') return;
        try {
            this.process.kill(signal);
            this._status = 'killed';
            logger.info(`ShellSession[${this.id}]: Killed with ${signal}`);
        } catch (e) {
            logger.error(`ShellSession[${this.id}]: Failed to kill: ${e}`);
        }
    }

    /**
     * Return a summary info object about this session.
     */
    public info(): SessionInfo {
        return {
            id: this.id,
            command: this.command,
            cwd: this.cwd,
            pid: this._pid,
            status: this._status,
            exitCode: this._exitCode,
            startedAt: this.startedAt,
            lineCount: this.lines.length,
        };
    }
}

// ── Singleton session registry ──────────────────────────────────────────────

class ShellSessionRegistry {
    private sessions: Map<string, ShellSession> = new Map();

    /**
     * Start a new shell session. If a session with the same ID already exists
     * and is still running, throw an error (use a different ID or kill it first).
     */
    public start(id: string, command: string, cwd: string = process.cwd()): ShellSession {
        const existing = this.sessions.get(id);
        if (existing && existing.status === 'running') {
            throw new Error(`Session "${id}" is already running. Stop it first with shell_stop, or use a different ID.`);
        }
        const session = new ShellSession(id, command, cwd);
        this.sessions.set(id, session);
        return session;
    }

    public get(id: string): ShellSession | undefined {
        return this.sessions.get(id);
    }

    public list(): SessionInfo[] {
        return Array.from(this.sessions.values()).map(s => s.info());
    }

    /**
     * Kill a session by ID and remove it from the registry.
     */
    public stop(id: string): void {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`No session found with ID "${id}"`);
        session.kill();
        // Keep the entry in the map for a brief post-mortem window — 
        // the status will show 'killed' until cleaned up.
    }

    /**
     * Clean up sessions that have exited naturally (useful for memory management).
     */
    public cleanup(): void {
        for (const [id, session] of this.sessions.entries()) {
            if (session.status !== 'running') {
                this.sessions.delete(id);
            }
        }
    }
}

export const shellSessions = new ShellSessionRegistry();
