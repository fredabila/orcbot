import fs from 'fs';
import path from 'path';

// ── ANSI color helpers (aligned with DESIGN.md) ───────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    brightCyan: '\x1b[96m',
    green: '\x1b[32m',
    brightGreen: '\x1b[92m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    white: '\x1b[37m',
    brightWhite: '\x1b[97m',
    gray: '\x1b[90m',
};

let cachedVersion: string | null = null;
let splashShown = false;

/** Get the package version (cached) */
export function getAppVersion(): string {
    if (cachedVersion) return cachedVersion;
    try {
        const pkgPath = path.join(__dirname, '../../../package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            cachedVersion = pkg.version || '1.0.7';
            return cachedVersion!;
        }
    } catch {
        // Fallback for relative paths in different build dirs
    }

    try {
        const pkgPathAlt = path.join(__dirname, '../../package.json');
        if (fs.existsSync(pkgPathAlt)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPathAlt, 'utf8'));
            cachedVersion = pkg.version || '1.0.7';
            return cachedVersion!;
        }
    } catch {
        // Ignore fallback errors
    }

    cachedVersion = '1.0.7';
    return cachedVersion;
}

/** Check if the full splash logo has been rendered in this session */
export function isSplashShown(): boolean {
    return splashShown;
}

/** Reset splash state (useful for tests or explicit full resets) */
export function resetSplashState(): void {
    splashShown = false;
}

/** Big block-letter OrcBot logo lines */
export function getLogoLines(): string[] {
    return [
        '  ██████╗ ██████╗  ██████╗██████╗  ██████╗ ████████╗',
        ' ██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝',
        ' ██║   ██║██████╔╝██║     ██████╔╝██║   ██║   ██║   ',
        ' ██║   ██║██╔══██╗██║     ██╔══██╗██║   ██║   ██║   ',
        ' ╚██████╔╝██║  ██║╚██████╗██████╔╝╚██████╔╝   ██║   ',
        '  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═════╝  ╚═════╝    ╚═╝   ',
    ];
}

/** Render the full ASCII splash banner */
export function renderSplash(opts: { force?: boolean; forceFull?: boolean } = {}): void {
    const force = opts.force ?? opts.forceFull ?? false;
    if (splashShown && !force) {
        renderCompactHeader();
        return;
    }

    console.log('');
    for (const line of getLogoLines()) {
        console.log(`  ${c.brightCyan}${line}${c.reset}`);
    }

    const ver = getAppVersion();
    console.log(`  ${c.white}Autonomous AI Agent Framework${c.reset}  ${c.gray}│${c.reset}  ${c.brightCyan}v${ver}${c.reset}`);
    console.log(`  ${c.white}by${c.reset} ${c.bold}${c.white}Frederick Abila${c.reset}  ${c.gray}│${c.reset}  ${c.gray}github.com/fredabila/orcbot${c.reset}`);
    console.log(`  ${c.gray}${'─'.repeat(54)}${c.reset}`);
    console.log('');

    splashShown = true;
}

/** Render a single-line compact brand header */
export function renderCompactHeader(status?: string): void {
    const ver = getAppVersion();
    const statusPart = status ? `  ${status}` : '';
    console.log('');
    console.log(`  ${c.brightCyan}${c.bold}orcbot${c.reset} ${c.gray}v${ver}${c.reset}${statusPart}`);
    console.log(`  ${c.gray}${'─'.repeat(40)}${c.reset}`);
}

export interface ScreenHeaderOptions {
    /** Whether to clear/reposition the screen before rendering. Default true */
    clear?: boolean;
    /** Optional live status indicator (e.g. `● ready`, `● running`) */
    status?: string;
    /** Width for the separator line. Defaults to 54 or terminal width */
    width?: number;
}

/**
 * Format a breadcrumb trail into styled ANSI text.
 * Parent screens are dimmed neutral; current screen is bold bright cyan.
 */
export function formatBreadcrumbs(trail: string | string[]): string {
    const segments = Array.isArray(trail) ? trail : [trail];
    if (segments.length === 0) return '';
    if (segments.length === 1) {
        return `${c.brightCyan}${c.bold}${segments[0]}${c.reset}`;
    }

    const parents = segments.slice(0, -1).map(s => `${c.white}${s}${c.reset}`).join(` ${c.gray}›${c.reset} `);
    const current = `${c.brightCyan}${c.bold}${segments[segments.length - 1]}${c.reset}`;
    return `${parents} ${c.gray}›${c.reset} ${current}`;
}

let inAlternateScreen = false;

/** Reset alternate screen state (useful for tests) */
export function resetAlternateScreenState(): void {
    inAlternateScreen = false;
}

/**
 * Enter terminal Alternate Screen Buffer (\x1b[?1049h).
 * Gives the TUI a dedicated, fixed single-page canvas with zero scrollback pollution.
 */
export function enterAlternateScreen(): void {
    if (process.stdout.isTTY && !inAlternateScreen) {
        process.stdout.write('\x1b[?1049h\x1b[H');
        inAlternateScreen = true;

        const restore = () => {
            if (inAlternateScreen) {
                exitAlternateScreen();
            }
        };
        process.once('exit', restore);
        process.once('SIGINT', restore);
    }
}

/**
 * Exit Alternate Screen Buffer (\x1b[?1049l) and restore the user's original shell history.
 */
export function exitAlternateScreen(): void {
    if (inAlternateScreen) {
        if (process.stdout.isTTY) {
            process.stdout.write('\x1b[?1049l');
        }
        inAlternateScreen = false;
    }
}

/** True when the TUI is running in the alternate screen buffer */
export function isAlternateScreen(): boolean {
    return inAlternateScreen;
}

/**
 * Clear the screen and purge scrollback buffer (\x1b[2J\x1b[3J\x1b[H) on a real terminal.
 *
 * \x1b[2J clears the visible screen, \x1b[3J purges accumulated scrollback so old
 * menus do not duplicate or stack up, and \x1b[H homes the cursor to (1,1).
 */
export function clearScreen(): void {
    if (process.stdout.isTTY) {
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    }
}

/**
 * Render a persistent, app-like screen header with breadcrumb navigation.
 * Replaces the repeated 10-line banner and jarring screen wipes.
 */
export function renderScreenHeader(
    breadcrumbs: string | string[],
    opts: ScreenHeaderOptions = {}
): void {
    const shouldClear = opts.clear ?? true;
    if (shouldClear) {
        // Cursor home + erase in display, to avoid the violent flash of a full wipe.
        clearScreen();
    }

    const ver = getAppVersion();
    const trailStr = formatBreadcrumbs(breadcrumbs);
    const statusStr = opts.status ? `  ${opts.status}` : '';
    const width = opts.width ?? Math.min(process.stdout.columns || 80, 80);

    console.log('');
    console.log(`  ${c.brightCyan}${c.bold}orcbot${c.reset} ${c.gray}v${ver}${c.reset}  ${c.gray}│${c.reset}  ${trailStr}${statusStr}`);
    console.log(`  ${c.gray}${'─'.repeat(Math.max(20, width - 4))}${c.reset}`);
}

/**
 * Smart banner: prints the full ASCII logo on initial launch,
 * but falls back to a compact header on repeated submenu calls to prevent flicker.
 */
export function banner(opts: { forceFull?: boolean; force?: boolean } = {}): void {
    const force = opts.forceFull ?? opts.force ?? false;
    if (!splashShown || force) {
        renderSplash({ force });
    } else {
        renderCompactHeader();
    }
}
