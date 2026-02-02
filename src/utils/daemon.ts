import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger';

export interface DaemonOptions {
    pidFile: string;
    logFile: string;
    dataHome: string;
}

export class DaemonManager {
    private options: DaemonOptions;

    constructor(dataHome: string = path.join(os.homedir(), '.orcbot')) {
        this.options = {
            pidFile: path.join(dataHome, 'orcbot.pid'),
            logFile: path.join(dataHome, 'logs', 'orcbot.log'),
            dataHome
        };

        // Ensure directories exist
        const logsDir = path.dirname(this.options.logFile);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }

    /**
     * Check if another instance is already running
     * @returns true if running, false otherwise
     */
    public isRunning(): { running: boolean; pid?: number } {
        if (!fs.existsSync(this.options.pidFile)) {
            return { running: false };
        }

        try {
            const pidStr = fs.readFileSync(this.options.pidFile, 'utf8').trim();
            const pid = parseInt(pidStr, 10);

            if (isNaN(pid)) {
                // Invalid PID file, clean it up
                fs.unlinkSync(this.options.pidFile);
                return { running: false };
            }

            // Check if process is still running
            try {
                // Sending signal 0 tests if process exists without killing it
                process.kill(pid, 0);
                return { running: true, pid };
            } catch (e: any) {
                // Process doesn't exist
                if (e.code === 'ESRCH') {
                    // Clean up stale PID file
                    fs.unlinkSync(this.options.pidFile);
                    return { running: false };
                }
                // Process exists but we don't have permission (still running)
                if (e.code === 'EPERM') {
                    return { running: true, pid };
                }
                throw e;
            }
        } catch (e) {
            logger.warn(`Error checking PID file: ${e}`);
            return { running: false };
        }
    }

    /**
     * Write the current process PID to the PID file
     */
    public writePidFile(): void {
        const pid = process.pid;
        fs.writeFileSync(this.options.pidFile, pid.toString(), 'utf8');
        logger.info(`PID file written: ${this.options.pidFile} (PID: ${pid})`);
    }

    /**
     * Remove the PID file
     */
    public removePidFile(): void {
        if (fs.existsSync(this.options.pidFile)) {
            try {
                fs.unlinkSync(this.options.pidFile);
                logger.info(`PID file removed: ${this.options.pidFile}`);
            } catch (e) {
                logger.warn(`Failed to remove PID file: ${e}`);
            }
        }
    }

    /**
     * Redirect stdout and stderr to log file
     */
    public redirectLogs(): void {
        const logStream = fs.createWriteStream(this.options.logFile, { flags: 'a' });
        
        process.stdout.write = logStream.write.bind(logStream) as any;
        process.stderr.write = logStream.write.bind(logStream) as any;

        // Also redirect console methods
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args: any[]) => {
            logStream.write(args.join(' ') + '\n');
        };

        console.error = (...args: any[]) => {
            logStream.write('[ERROR] ' + args.join(' ') + '\n');
        };

        console.warn = (...args: any[]) => {
            logStream.write('[WARN] ' + args.join(' ') + '\n');
        };

        logger.info(`Logs redirected to: ${this.options.logFile}`);
    }

    /**
     * Daemonize the current process
     */
    public daemonize(): void {
        // Check if already running
        const status = this.isRunning();
        if (status.running) {
            console.error(`OrcBot is already running (PID: ${status.pid})`);
            console.error(`PID file: ${this.options.pidFile}`);
            console.error('Stop the running instance first or remove the PID file if it\'s stale.');
            process.exit(1);
        }

        // Print info before redirecting output
        console.log('Starting OrcBot in daemon mode...');
        console.log(`PID file: ${this.options.pidFile}`);
        console.log(`Log file: ${this.options.logFile}`);
        console.log(`Data directory: ${this.options.dataHome}`);
        console.log('\nTo stop the daemon, run: kill $(cat ' + this.options.pidFile + ')');
        console.log('To view logs, run: tail -f ' + this.options.logFile);
        console.log('');

        // Write PID file
        this.writePidFile();

        // Redirect logs
        this.redirectLogs();

        // Setup cleanup handlers
        this.setupCleanupHandlers();

        logger.info('OrcBot daemon started successfully');
    }

    /**
     * Setup handlers to clean up PID file on exit
     */
    private setupCleanupHandlers(): void {
        const cleanup = () => {
            this.removePidFile();
        };

        // Handle various exit scenarios
        process.on('exit', cleanup);
        process.on('SIGINT', () => {
            logger.info('Received SIGINT, shutting down...');
            cleanup();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            logger.info('Received SIGTERM, shutting down...');
            cleanup();
            process.exit(0);
        });
        process.on('uncaughtException', (err) => {
            logger.error(`Uncaught exception: ${err}`);
            cleanup();
            process.exit(1);
        });
        process.on('unhandledRejection', (reason, promise) => {
            logger.error(`Unhandled rejection at ${promise}: ${reason}`);
            cleanup();
            process.exit(1);
        });
    }

    public getPidFile(): string {
        return this.options.pidFile;
    }

    public getLogFile(): string {
        return this.options.logFile;
    }
}
