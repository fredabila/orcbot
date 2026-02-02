import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger';

export interface DaemonOptions {
    pidFile: string;
    logFile: string;
    dataDir: string;
}

export class DaemonManager {
    private pidFile: string;
    private logFile: string;
    private dataDir: string;

    constructor(options: DaemonOptions) {
        this.pidFile = options.pidFile;
        this.logFile = options.logFile;
        this.dataDir = options.dataDir;
    }

    /**
     * Check if a daemon is already running
     */
    public isRunning(): { running: boolean; pid?: number } {
        if (!fs.existsSync(this.pidFile)) {
            return { running: false };
        }

        try {
            const pidContent = fs.readFileSync(this.pidFile, 'utf8').trim();
            const pid = parseInt(pidContent, 10);

            if (isNaN(pid)) {
                // Invalid PID file, consider it not running
                return { running: false };
            }

            // Check if process is actually running
            try {
                process.kill(pid, 0); // Signal 0 checks if process exists without killing it
                return { running: true, pid };
            } catch (e) {
                // Process doesn't exist, stale PID file
                return { running: false };
            }
        } catch (error) {
            logger.error(`Error reading PID file: ${error}`);
            return { running: false };
        }
    }

    /**
     * Write the PID file
     */
    public writePidFile(pid: number): void {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }

            fs.writeFileSync(this.pidFile, pid.toString(), 'utf8');
            logger.info(`PID file written: ${this.pidFile} (PID: ${pid})`);
        } catch (error) {
            logger.error(`Failed to write PID file: ${error}`);
            throw error;
        }
    }

    /**
     * Remove the PID file
     */
    public removePidFile(): void {
        try {
            if (fs.existsSync(this.pidFile)) {
                fs.unlinkSync(this.pidFile);
                logger.info(`PID file removed: ${this.pidFile}`);
            }
        } catch (error) {
            logger.error(`Failed to remove PID file: ${error}`);
        }
    }

    /**
     * Setup log file for daemon mode
     */
    public setupDaemonLogging(): void {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Redirect stdout and stderr to log file
        const logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
        process.stdout.write = logStream.write.bind(logStream);
        process.stderr.write = logStream.write.bind(logStream);
    }

    /**
     * Daemonize the current process
     * Note: This implementation detaches the process without forking,
     * so the PID written is for the actual daemon process.
     */
    public daemonize(): void {
        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Check if already running
        const status = this.isRunning();
        if (status.running) {
            console.error(`\n❌ OrcBot daemon is already running (PID: ${status.pid})`);
            console.error(`   PID file: ${this.pidFile}`);
            console.error(`   To stop it, run: kill ${status.pid}`);
            process.exit(1);
        }

        // Display daemon startup info before detaching
        console.log('\n✅ Starting OrcBot in daemon mode...');
        console.log(`   PID file: ${this.pidFile}`);
        console.log(`   Log file: ${this.logFile}`);
        console.log(`   Data dir: ${this.dataDir}`);
        console.log('\n   To view logs: tail -f ' + this.logFile);
        console.log('   To stop: kill $(cat ' + this.pidFile + ')');
        console.log('');

        // Write PID file before forking (in case parent exits quickly)
        this.writePidFile(process.pid);

        // Setup cleanup on exit
        const cleanup = () => {
            this.removePidFile();
        };

        process.on('exit', cleanup);
        process.on('SIGINT', () => {
            cleanup();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            cleanup();
            process.exit(0);
        });

        // Setup daemon logging
        this.setupDaemonLogging();

        // Detach from terminal by ignoring SIGHUP
        // This allows the process to continue running after terminal closes
        process.on('SIGHUP', () => {
            logger.info('Received SIGHUP, continuing in background...');
        });

        // Unref stdin/stdout/stderr so Node doesn't wait for them
        if (process.stdin) process.stdin.unref();
        if (process.stdout && typeof (process.stdout as any).unref === 'function') {
            (process.stdout as any).unref();
        }
        if (process.stderr && typeof (process.stderr as any).unref === 'function') {
            (process.stderr as any).unref();
        }

        logger.info('OrcBot daemon started successfully');
    }

    /**
     * Get daemon status
     */
    public getStatus(): string {
        const status = this.isRunning();
        if (status.running) {
            return `OrcBot daemon is running (PID: ${status.pid})\nPID file: ${this.pidFile}\nLog file: ${this.logFile}`;
        } else {
            return 'OrcBot daemon is not running';
        }
    }

    /**
     * Create a default DaemonManager instance with standard paths
     */
    public static createDefault(): DaemonManager {
        const dataDir = path.join(os.homedir(), '.orcbot');
        const pidFile = path.join(dataDir, 'orcbot.pid');
        const logFile = path.join(dataDir, 'daemon.log');

        return new DaemonManager({ pidFile, logFile, dataDir });
    }
}
