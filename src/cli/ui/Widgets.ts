import inquirer from 'inquirer';
import { piBox } from '../../core/PiTuiRenderer';

// ── ANSI color helpers (zero deps, aligned with DESIGN.md) ───────────────────
// Palette roles come from DESIGN.md: one accent (cyan) plus neutrals,
// and green/yellow/red only where they mark real state.
export const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    inverse: '\x1b[7m',
    strikethrough: '\x1b[9m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
    black: '\x1b[30m',
    gray: '\x1b[90m',
    brightCyan: '\x1b[96m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightRed: '\x1b[91m',
    brightMagenta: '\x1b[95m',
    brightBlue: '\x1b[94m',
    brightWhite: '\x1b[97m',
    bgCyan: '\x1b[46m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
    bgGray: '\x1b[100m',
    bgBlack: '\x1b[40m',
    bgWhite: '\x1b[47m',
};

export const clr = (color: string, text: string): string => `${color}${text}${c.reset}`;
export const bold = (text: string): string => clr(c.bold, text);
export const dim = (text: string): string => clr(c.dim, text);
export const italic = (text: string): string => clr(c.italic, text);
export const cyan = (text: string): string => clr(c.cyan, text);
export const green = (text: string): string => clr(c.green, text);
export const yellow = (text: string): string => clr(c.yellow, text);
export const red = (text: string): string => clr(c.red, text);
export const magenta = (text: string): string => clr(c.magenta, text);
export const blue = (text: string): string => clr(c.blue, text);
export const white = (text: string): string => clr(c.white, text);
export const gray = (text: string): string => clr(c.gray, text);
export const brightCyan = (text: string): string => clr(c.brightCyan, text);
export const brightGreen = (text: string): string => clr(c.brightGreen, text);
export const brightYellow = (text: string): string => clr(c.brightYellow, text);
export const brightRed = (text: string): string => clr(c.brightRed, text);
export const brightMagenta = (text: string): string => clr(c.brightMagenta, text);
export const brightBlue = (text: string): string => clr(c.brightBlue, text);
export const brightWhite = (text: string): string => clr(c.brightWhite, text);

export interface BoxOptions {
    title?: string;
    width?: number;
    color?: string;
    padding?: number;
}

/**
 * Render a box with double-line borders and optional title.
 * Delegates to @mariozechner/pi-tui Box component when available,
 * falling back to classic hand-rolled borders.
 */
export function box(lines: string[], opts: BoxOptions = {}): void {
    piBox(lines, {
        title: opts.title,
        width: opts.width,
        paddingX: opts.padding,
        borderColor: opts.color ?? c.gray,
    });
}

export interface ProgressBarOptions {
    filled?: string;
    empty?: string;
    colorFn?: (s: string) => string;
    invert?: boolean;
}

/**
 * Render a horizontal bar (progress/usage visualization).
 */
export function progressBar(
    value: number,
    max: number,
    width = 20,
    opts: ProgressBarOptions = {}
): string {
    const ratio = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
    const filledLen = Math.round(ratio * width);
    const emptyLen = width - filledLen;
    const filled = (opts.filled || '█').repeat(filledLen);
    const empty = (opts.empty || '░').repeat(emptyLen);

    // Default: green=low, yellow=mid, red=high (capacity usage semantics).
    // Pass invert:true for metrics where high is good (e.g. accuracy %).
    let colorFn: (s: string) => string;
    if (opts.colorFn) {
        colorFn = opts.colorFn;
    } else if (opts.invert) {
        colorFn = ratio > 0.7 ? brightGreen : ratio > 0.4 ? yellow : red;
    } else {
        colorFn = ratio > 0.85 ? red : ratio > 0.6 ? yellow : brightGreen;
    }

    return `${colorFn(filled)}${c.gray}${empty}${c.reset}`;
}

/**
 * State label. Color is the signal (DESIGN.md): green when active, gray when off.
 */
export function statusBadge(ok: boolean, onLabel = 'ON', offLabel = 'OFF'): string {
    return ok ? `${c.brightGreen}${onLabel}${c.reset}` : `${c.gray}${offLabel}${c.reset}`;
}

/**
 * Status dot with label.
 */
export function statusDot(ok: boolean, label?: string): string {
    if (ok) return `${c.brightGreen}●${c.reset}${label ? ` ${c.white}${label}${c.reset}` : ''}`;
    return `${c.gray}○${c.reset}${label ? ` ${c.white}${label}${c.reset}` : ''}`;
}

/**
 * Format key-value line for dashboards and summary screens.
 */
export function kvLine(key: string, value: string, indent = '  '): void {
    console.log(`${indent}  ${c.white}${c.bold}${key}${c.reset}  ${value}`);
}

/**
 * Wait for Enter keypress before returning to previous menu.
 */
export async function waitKeyPress(): Promise<void> {
    await inquirer.prompt([
        {
            type: 'input',
            name: 'continue',
            message: `${c.brightCyan}›${c.reset} ${c.white}Press Enter to continue...${c.reset}`
        }
    ]);
}
