import winston from 'winston';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getOrcBotDataHome } from './dataHome';

dotenv.config();

const logDir = process.env.ORCBOT_LOG_DIR
    || path.join(getOrcBotDataHome(), 'logs');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, printf, colorize } = winston.format;

const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});

const consoleTransport = new winston.transports.Console();

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        colorize(),
        myFormat
    ),
    transports: [
        consoleTransport,
        new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
    ],
});

// ── Interactive-TUI console suppression ──────────────────────────────────────
// The TUI prompt layer (@clack/prompts) redraws differentially: it moves the
// cursor up by the height of its *previous* frame and rewrites in place. That
// arithmetic is only valid while it owns stdout exclusively. A winston Console
// write in between (config hot-reload debounce, config:changed, save/sync)
// pushes extra lines, so the up-move lands off the frame origin, the old frame
// is never erased, and menus visibly duplicate and smear.
//
// Suspending only the Console transport keeps both File transports recording,
// so nothing is lost from the logs while the screen is muted.

let consoleSuspendDepth = 0;
let silentBeforeSuspend: boolean | undefined;

/** Mute console log output while an interactive full-screen UI owns stdout. */
export function suspendConsoleLogging(): void {
    if (consoleSuspendDepth === 0) {
        silentBeforeSuspend = consoleTransport.silent;
        consoleTransport.silent = true;
    }
    consoleSuspendDepth++;
}

/** Restore console log output once the interactive UI releases stdout. */
export function resumeConsoleLogging(): void {
    if (consoleSuspendDepth === 0) return;
    consoleSuspendDepth--;
    if (consoleSuspendDepth === 0) {
        consoleTransport.silent = silentBeforeSuspend ?? false;
    }
}

/** True while console log output is muted for an interactive UI. */
export function isConsoleLoggingSuspended(): boolean {
    return consoleSuspendDepth > 0;
}
