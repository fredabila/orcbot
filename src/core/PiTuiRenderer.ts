/**
 * PiTuiRenderer — lightweight wrapper around @mariozechner/pi-tui components.
 *
 * pi-tui's full TUI loop owns ProcessTerminal stdin/stdout and cannot be
 * embedded inside inquirer-based prompts.  However, its components are pure
 * render-machines: calling component.render(width) returns string[] with no
 * side-effects and no event loop required.  We exploit this to give the OrcBot
 * CLI polished, differentially-renderable output boxes without touching stdin.
 *
 * Usage
 * ─────
 *   import { piBox, piText, PI_TUI_AVAILABLE } from './PiTuiRenderer';
 *   piBox(['Line 1', 'Line 2'], { title: 'MY BOX' });   // prints to stdout
 *   const lines = piText('Hello world', { width: 60 });  // returns string[]
 */

import { logger } from '../utils/logger';

// ── Lazy pi-tui import ──────────────────────────────────────────────────────

let _piTui: typeof import('@mariozechner/pi-tui') | null | undefined = undefined; // undefined = unchecked

function getPiTui(): typeof import('@mariozechner/pi-tui') | null {
    if (_piTui !== undefined) return _piTui;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _piTui = require('@mariozechner/pi-tui');
        return _piTui!;
    } catch {
        logger.debug('PiTuiRenderer: @mariozechner/pi-tui not available, using fallback renderer');
        _piTui = null;
        return null;
    }
}

/** True when @mariozechner/pi-tui is installed and loadable */
export function isPiTuiAvailable(): boolean {
    return getPiTui() !== null;
}

export const PI_TUI_AVAILABLE = isPiTuiAvailable();

// ── ANSI strip helper (zero-dep) ─────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

// ── Default terminal width ────────────────────────────────────────────────────

function termWidth(): number {
    return process.stdout.columns || 80;
}

// ── Box rendering ─────────────────────────────────────────────────────────────

export interface PiBoxOptions {
    /** Optional title shown in the top border */
    title?: string;
    /** Explicit width in columns; defaults to terminal width minus 4 */
    width?: number;
    /** Horizontal padding inside the box (default 1) */
    paddingX?: number;
    /** Vertical padding inside the box (default 0) */
    paddingY?: number;
    /** chalk-style bg function for the box background, e.g. `(s) => chalk.bgGray(s)` */
    bgFn?: (text: string) => string;
    /** ANSI border color prefix (e.g. '\x1b[36m' for cyan). Default: cyan */
    borderColor?: string;
}

/**
 * Render a box with optional title using pi-tui's Box+Text components when
 * available, falling back to OrcBot's classic ASCII box otherwise.
 *
 * Lines may contain ANSI escape codes — widths are measured by visible chars.
 */
export function piBox(lines: string[], opts: PiBoxOptions = {}) {
    const tui = getPiTui();
    const width = opts.width ?? Math.min(termWidth() - 4, 100);
    const paddingX = opts.paddingX ?? 1;
    const paddingY = opts.paddingY ?? 0;

    if (tui) {
        // ── pi-tui path — render content via pi-tui Text for ANSI-safe word-wrap,
        //                  then frame with OrcBot's double-line border ──────────
        const { Text } = tui;

        // ANSI reset used in border drawing
        const R = '\x1b[0m';
        const border = opts.borderColor ?? '\x1b[36m'; // cyan default

        // Measure the inner content width (box interior)
        const innerWidth = Math.max(width - 2, 1); // 1 char border each side

        // Render each content line through pi-tui's Text for proper wrapping/truncation
        const contentLines: string[] = [];
        for (const line of lines) {
            const t = new Text(line, 0, 0);
            const rendered = t.render(innerWidth - paddingX * 2);
            contentLines.push(...rendered);
        }

        // Build title row
        const titleText = opts.title ?? '';
        const titleStrip = stripAnsi(titleText);
        const topBorderFill = '═'.repeat(Math.max(0, innerWidth - (titleStrip ? titleStrip.length + 3 : 0)));
        const top = titleStrip
            ? `${border}╔═ ${R}\x1b[1m\x1b[97m${titleText}${R}${border} ${topBorderFill}╗${R}`
            : `${border}╔${'═'.repeat(innerWidth)}╗${R}`;
        const bot = `${border}╚${'═'.repeat(innerWidth)}╝${R}`;

        // Top padding rows
        const emptyRow = `${border}║${R}${' '.repeat(innerWidth)}${border}║${R}`;
        process.stdout.write(top + '\n');
        for (let p = 0; p < paddingY; p++) process.stdout.write(emptyRow + '\n');

        // Content rows
        for (const row of contentLines) {
            const visible = stripAnsi(row).length;
            const rightPad = Math.max(0, innerWidth - visible - paddingX);
            process.stdout.write(`${border}║${R}${' '.repeat(paddingX)}${row}${' '.repeat(rightPad)}${border}║${R}\n`);
        }

        // Bottom padding rows
        for (let p = 0; p < paddingY; p++) process.stdout.write(emptyRow + '\n');
        process.stdout.write(bot + '\n');
    } else {
        // ── Fallback: classic OrcBot box ────────────────────────────────────
        const color = opts.borderColor ?? '\x1b[36m'; // cyan
        const reset = '\x1b[0m';
        const pad = paddingX;
        const contentWidth = Math.max(
            opts.title ? stripAnsi(opts.title).length + 4 : 0,
            ...lines.map(l => stripAnsi(l).length + pad * 2),
            40
        );
        const w = Math.min(contentWidth, width);

        const top = opts.title
            ? `${color}╔═ \x1b[1m\x1b[97m${opts.title}${reset}${color} ${'═'.repeat(Math.max(0, w - stripAnsi(opts.title).length - 3))}╗${reset}`
            : `${color}╔${'═'.repeat(w)}╗${reset}`;
        const bot = `${color}╚${'═'.repeat(w)}╝${reset}`;

        console.log(top);
        for (const line of lines) {
            const visible = stripAnsi(line).length;
            const rightPad = Math.max(0, w - visible - pad);
            console.log(`${color}║${reset}${' '.repeat(pad)}${line}${' '.repeat(rightPad)}${color}║${reset}`);
        }
        console.log(bot);
    }
}

// ── Text rendering ────────────────────────────────────────────────────────────

export interface PiTextOptions {
    width?: number;
    paddingX?: number;
    paddingY?: number;
    bgFn?: (text: string) => string;
}

/**
 * Render a multi-line text block using pi-tui's Text component when available.
 * Returns the array of rendered lines (does NOT print).
 */
export function piTextLines(text: string, opts: PiTextOptions = {}): string[] {
    const tui = getPiTui();
    const width = opts.width ?? Math.min(termWidth(), 100);
    if (tui) {
        const { Text } = tui;
        const comp = new Text(text, opts.paddingX ?? 0, opts.paddingY ?? 0, opts.bgFn);
        return comp.render(width);
    }
    // Fallback: plain split
    return text.split('\n');
}

/**
 * Print a text block via pi-tui's Text component (or plain fallback).
 */
export function piText(text: string, opts: PiTextOptions = {}) {
    for (const line of piTextLines(text, opts)) {
        process.stdout.write(line + '\n');
    }
}

// ── Status indicator helpers ─────────────────────────────────────────────────

/** Render a colored status indicator line inside a pi-tui box */
export function piStatusSection(title: string, kvPairs: Array<[string, string]>, opts: PiBoxOptions = {}) {
    const lines = kvPairs.map(([k, v]) => `\x1b[1m\x1b[37m${k}\x1b[0m  ${v}`);
    piBox(lines, { title, ...opts });
}

// ── Markdown rendering (optional) ────────────────────────────────────────────

export interface PiMarkdownOptions {
    width?: number;
    theme?: Record<string, unknown>;
}

/**
 * Render markdown text using pi-tui's Markdown component when available.
 * Falls back to plain printing.
 */
export function piMarkdown(markdown: string, opts: PiMarkdownOptions = {}) {
    const tui = getPiTui();
    const width = opts.width ?? Math.min(termWidth(), 100);
    if (tui && (tui as any).Markdown) {
        try {
            const { Markdown } = tui as any;
            // Default minimal theme — no chalk dependency required
            const defaultTheme = {
                text: (s: string) => s,
                bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
                italic: (s: string) => `\x1b[3m${s}\x1b[0m`,
                code: (s: string) => `\x1b[96m${s}\x1b[0m`,
                codeBlock: (s: string) => `\x1b[96m${s}\x1b[0m`,
                heading: (s: string, _level: number) => `\x1b[1m\x1b[97m${s}\x1b[0m`,
                link: (s: string) => `\x1b[4m\x1b[94m${s}\x1b[0m`,
                bullet: '  •',
                quotePrefix: (s: string) => `\x1b[90m${s}\x1b[0m`,
            };
            const comp = new Markdown(markdown, opts.theme ?? defaultTheme);
            const rendered = comp.render(width);
            for (const line of rendered) {
                process.stdout.write(line + '\n');
            }
            return;
        } catch {
            // fall through to plain
        }
    }
    process.stdout.write(markdown + '\n');
}
