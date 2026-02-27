import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../utils/logger';
import { RuntimeTuner } from '../core/RuntimeTuner';
import { BrowserStateManager } from './BrowserStateManager';
import path from 'path';
import os from 'os';
import fs from 'fs';

export type BrowserEngine = 'playwright' | 'lightpanda';

export interface InterceptedApi {
    url: string;
    method: string;
    contentType: string;
    status: number;
    timestamp: number;
    responseSize: number;
    isJson: boolean;
    domain: string;
}

export class WebBrowser {
    private browser: Browser | null = null;
    private _page: Page | null = null; // Renamed from 'page' to '_page'
    private searchCache: Map<string, { ts: number; result: string }> = new Map();
    private context: BrowserContext | null = null;
    private profileDir?: string;
    private profileName: string;
    private profileHistoryPath?: string;
    private headlessMode: boolean = true;
    private lastNavigatedUrl?: string;
    private tuner?: RuntimeTuner;
    private browserEngine: BrowserEngine;
    private lightpandaEndpoint: string;
    private stateManager: BrowserStateManager;
    private _visionAnalyzer?: (screenshotPath: string, prompt: string) => Promise<string>;
    private debugAlwaysSaveArtifacts: boolean;
    private traceEnabled: boolean;
    private traceActive: boolean = false;
    private traceDir: string;
    private traceScreenshots: boolean;
    private traceSnapshots: boolean;
    private tracePath?: string;
    public _blankUrlHistory: Map<string, number> = new Map(); // domain → consecutive blank count
    private _resourceBlockingEnabled: boolean = true; // Can be toggled off for sites that need images/fonts
    private _consoleLogs: string[] = []; // Capture recent console logs
    private _viewportMode: 'desktop' | 'mobile' = 'desktop';

    // API Interception: auto-discover XHR/fetch endpoints during navigation
    private _apiInterceptionEnabled: boolean = false;
    private _interceptedApis: InterceptedApi[] = [];
    private _apiInterceptionMaxEntries: number = 50;

    public get page(): Page | null {
        return this._page;
    }

    /**
     * Set the viewport/device mode for the next browser launch.
     * Restarts the browser to apply changes.
     */
    public async setViewportMode(mode: 'desktop' | 'mobile'): Promise<string> {
        if (this._viewportMode === mode) return `Browser is already in ${mode} mode.`;
        
        this._viewportMode = mode;
        await this.close();
        // ensureBrowser will pick up the new mode
        return `Browser set to ${mode} mode. Next navigation will use ${mode} user agent and viewport.`;
    }

    /**
     * Set a vision analyzer callback for automatic fallback when semantic snapshots are thin.
     * The callback receives a screenshot file path and a prompt, returns a visual description.
     */
    public setVisionAnalyzer(fn: (screenshotPath: string, prompt: string) => Promise<string>): void {
        this._visionAnalyzer = fn;
    }

    constructor(
        private serperApiKey?: string,
        private captchaApiKey?: string,
        private braveSearchApiKey?: string,
        private searxngUrl?: string,
        private searchProviderOrder: string[] = ['serper', 'brave', 'searxng', 'google', 'bing', 'duckduckgo'],
        browserProfileDir?: string,
        browserProfileName?: string,
        tuner?: RuntimeTuner,
        browserEngine?: BrowserEngine,
        lightpandaEndpoint?: string,
        debugOptions?: {
            alwaysSaveArtifacts?: boolean;
            traceEnabled?: boolean;
            traceDir?: string;
            traceScreenshots?: boolean;
            traceSnapshots?: boolean;
        }
    ) {
        this.profileDir = browserProfileDir;
        this.profileName = browserProfileName || 'default';
        this.tuner = tuner;
        this.browserEngine = browserEngine || 'playwright';
        this.lightpandaEndpoint = lightpandaEndpoint || 'ws://127.0.0.1:9222';
        this.stateManager = new BrowserStateManager();
        this.debugAlwaysSaveArtifacts = Boolean(debugOptions?.alwaysSaveArtifacts);
        this.traceEnabled = Boolean(debugOptions?.traceEnabled);
        this.traceDir = debugOptions?.traceDir || path.join(os.homedir(), '.orcbot', 'browser-traces');
        this.traceScreenshots = debugOptions?.traceScreenshots !== false;
        this.traceSnapshots = debugOptions?.traceSnapshots !== false;
    }

    private async ensureBrowser(headlessOverride?: boolean) {
        // Lightpanda is always headless - ignore override for it
        if (this.browserEngine === 'lightpanda') {
            if (!this.browser) {
                await this.connectToLightpanda();
            }
            return;
        }

        if (headlessOverride !== undefined && headlessOverride !== this.headlessMode) {
            this.headlessMode = headlessOverride;
            await this.close();
        }

        if (!this.browser) {
            // Use --disable-blink-features=AutomationControlled to reduce detection
            const profileRoot = this.profileDir || path.join(os.homedir(), '.orcbot', 'browser-profiles');
            const profileName = this.profileName || 'default';
            const userDataDir = path.join(profileRoot, profileName);
            if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

            this.profileHistoryPath = path.join(userDataDir, 'history.json');
            this.profileDir = profileRoot;
            this.profileName = profileName;

            // Clean up stale Chromium lock files left by crashes / unclean shutdowns
            this.cleanStaleLockFiles(userDataDir);

            // Configure viewport/UA based on mode
            const isMobile = this._viewportMode === 'mobile';
            const viewport = isMobile ? { width: 375, height: 812 } : { width: 1280, height: 720 };
            const userAgent = isMobile 
                ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

            // Launch with retry — if first attempt fails due to lock race, clean up and retry once
            const launchOptions = {
                headless: this.headlessMode,
                args: [
                    // ── Anti-detection ──
                    '--disable-blink-features=AutomationControlled',

                    // ── Stability: GPU & rendering ──
                    '--disable-gpu',                          // Prevent GPU-related crashes in headless/VMs
                    '--disable-gpu-sandbox',                  // GPU sandbox can cause exit code 21
                    '--disable-software-rasterizer',          // Avoid software GPU fallback crashes
                    '--disable-gpu-compositing',              // Don't need GPU compositing for scraping
                    '--in-process-gpu',                       // Keep GPU in main process (reduces crash surface)

                    // ── Stability: Sandbox & process model ──
                    '--no-sandbox',                           // Required on many Linux servers / Docker
                    '--disable-setuid-sandbox',               // Complement to --no-sandbox
                    '--disable-dev-shm-usage',                // Use /tmp instead of /dev/shm (often too small in Docker)
                    '--disable-namespace-sandbox',            // Prevents Linux namespace failures

                    // ── Stability: Reduce crash surface ──
                    '--disable-extensions',                   // No extensions to break things
                    '--disable-component-update',             // Don't try to update components
                    '--disable-background-networking',        // No background network requests
                    '--disable-background-timer-throttling',  // Keep timers running in background tabs
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',       // Don't throttle renderers
                    '--disable-breakpad',                     // Disable crash reporting
                    '--disable-hang-monitor',                 // Don't kill "hung" renderers prematurely
                    '--disable-ipc-flooding-protection',      // Prevent false-positive IPC flood kills
                    '--disable-client-side-phishing-detection',
                    '--disable-default-apps',
                    '--disable-popup-blocking',               // Allow popups (useful for auth flows)
                    '--disable-prompt-on-repost',
                    '--disable-sync',                         // No Chrome sync

                    // ── Memory & resource limits ──
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process,PaintHolding,HttpsUpgrades',
                    '--disable-site-isolation-trials',        // Reduce process count (less memory)
                    '--disable-web-security',                 // Allow cross-origin requests (needed for some scraping)
                    '--js-flags=--max-old-space-size=512',    // Cap V8 heap per renderer

                    // ── Networking ──
                    '--ignore-certificate-errors',            // Don't fail on self-signed/expired certs
                    '--allow-running-insecure-content',       // Allow mixed content

                    // ── Rendering ──
                    '--force-color-profile=srgb',
                    '--metrics-recording-only',
                    '--no-first-run',
                    '--password-store=basic',
                    '--use-mock-keychain',
                    '--export-tagged-pdf',

                    // ── Shared memory ──
                    '--disable-shared-memory',                // Fallback when /dev/shm is unavailable

                    // ── Window/display ──
                    ...(this.headlessMode ? [
                        `--window-size=${viewport.width},${viewport.height}`,
                        '--hide-scrollbars',
                        '--mute-audio',
                    ] : []),
                ],
                viewport,
                userAgent,
                deviceScaleFactor: isMobile ? 2 : 1,
                isMobile,
                hasTouch: isMobile,
                timeout: 30000,                               // 30s launch timeout (default is sometimes too short)
                ignoreDefaultArgs: ['--enable-automation'],    // Remove automation flag that sites detect
            };

            try {
                this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
            } catch (launchErr: any) {
                const errMsg = launchErr.message || String(launchErr);
                logger.warn(`Browser: Initial launch failed: ${errMsg.slice(0, 200)}`);

                // ── Attempt 2: Handle specific known failure modes ──

                // Display/headful failure → fall back to headless permanently
                if (!this.headlessMode && /display|DISPLAY|Xlib|X11|cannot open|main display/i.test(errMsg)) {
                    logger.warn(`Browser: Display unavailable — falling back to headless permanently.`);
                    this._displayBroken = true;
                    this.headlessMode = true;
                    launchOptions.headless = true;
                }

                // Profile lock → clean up lock files
                if (/process_singleton|profile|SingletonLock|lock/i.test(errMsg)) {
                    logger.warn(`Browser: Profile lock detected, cleaning up...`);
                    this.cleanStaleLockFiles(userDataDir);
                    await new Promise(r => setTimeout(r, 1500));
                }

                // Crashed / signal / exit code → profile may be corrupted, clean crash files
                if (/crash|signal|exit.?code|gpu.?process|process.*exit/i.test(errMsg)) {
                    logger.warn(`Browser: Crash detected, cleaning crash artifacts...`);
                    this.cleanCrashArtifacts(userDataDir);
                    await new Promise(r => setTimeout(r, 1000));
                }

                // ── Attempt 2: Retry with cleaned state ──
                try {
                    this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
                } catch (retryErr: any) {
                    const retryMsg = retryErr.message || String(retryErr);
                    logger.warn(`Browser: Retry 1 failed: ${retryMsg.slice(0, 200)}`);

                    // If headful retry failed with display, switch to headless
                    if (!launchOptions.headless && /display|DISPLAY|cannot open/i.test(retryMsg)) {
                        this._displayBroken = true;
                        this.headlessMode = true;
                        launchOptions.headless = true;
                    }

                    // ── Attempt 3: Fresh profile as last resort ──
                    // If the profile itself is corrupt, try a temporary fresh profile
                    logger.warn(`Browser: Attempting fresh temporary profile as fallback...`);
                    this.cleanStaleLockFiles(userDataDir);
                    this.cleanCrashArtifacts(userDataDir);
                    await new Promise(r => setTimeout(r, 1000));

                    try {
                        this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
                    } catch (finalErr: any) {
                        // ── Attempt 4: Non-persistent context (no profile at all) ──
                        logger.warn(`Browser: Persistent context failed. Trying non-persistent context as emergency fallback...`);
                        try {
                            const browser = await chromium.launch({
                                headless: true, // Always headless for emergency
                                args: launchOptions.args,
                                timeout: launchOptions.timeout,
                            });
                            this.context = await browser.newContext({
                                viewport: launchOptions.viewport,
                                userAgent: launchOptions.userAgent,
                                deviceScaleFactor: launchOptions.deviceScaleFactor,
                            });
                            this.browser = browser;
                            logger.info(`Browser: Emergency non-persistent context launched successfully.`);
                        } catch (emergencyErr: any) {
                            logger.error(`Browser: All launch attempts failed. Last error: ${emergencyErr.message?.slice(0, 200)}`);
                            throw new Error(
                                `Browser failed to launch after 4 attempts.\n` +
                                `Original: ${errMsg.slice(0, 150)}\n` +
                                `Final: ${emergencyErr.message?.slice(0, 150)}\n` +
                                `Hints: Check if Chromium is installed (npx playwright install chromium), ` +
                                `ensure sufficient memory, and verify no zombie chrome processes.`
                            );
                        }
                    }
                }
            }

            // Sneaky: Remove webdriver property & enhance stealth
            await this.context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                // Hide chrome.runtime (Playwright detection vector)
                if (!(window as any).chrome) {
                    (window as any).chrome = { runtime: {} };
                }
                // Normalize plugins array
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                // Normalize languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
            });

            this._page = await this.context.newPage();
            
            // Selective resource blocking — only block tracking/ads, allow images and fonts
            // since many sites need them for CAPTCHAs, icon-fonts, and layout
            await this._page.route('**/*', route => {
                const type = route.request().resourceType();
                const url = route.request().url();

                // Block known ad/tracking domains (never needed for functionality)
                if (
                    url.includes('google-analytics') || url.includes('googletagmanager.com') ||
                    url.includes('doubleclick') || url.includes('facebook.com/tr') ||
                    url.includes('connect.facebook.net') || url.includes('analytics.') ||
                    url.includes('adservice.google') || url.includes('pagead2.googlesyndication')
                ) {
                    return route.abort();
                }

                // Only block media (video/audio) — images and fonts are needed for
                // CAPTCHA rendering, icon-font buttons, and layout-dependent sites
                if (this._resourceBlockingEnabled && type === 'media') {
                    return route.abort();
                }

                route.continue();
            });

            // Capture console logs for debugging agent visibility
            this._page.on('console', msg => {
                const type = msg.type();
                const text = msg.text();
                // Only keep warnings and errors to reduce noise, unless it's explicitly logged info
                if (['error', 'warning'].includes(type) || (text.length < 200)) {
                    this._consoleLogs.push(`[Console ${type}] ${text.slice(0, 300)}`);
                    if (this._consoleLogs.length > 50) this._consoleLogs.shift();
                }
            });

            await this.ensureTracing();
        }
    }

    private async ensureTracing(): Promise<void> {
        if (!this.traceEnabled || this.traceActive || !this.context) return;
        try {
            if (!fs.existsSync(this.traceDir)) {
                fs.mkdirSync(this.traceDir, { recursive: true });
            }
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.tracePath = path.join(this.traceDir, `trace-${stamp}.zip`);
            await this.context.tracing.start({
                screenshots: this.traceScreenshots,
                snapshots: this.traceSnapshots,
                sources: false
            });
            this.traceActive = true;
            logger.info(`Browser: Trace started (${this.tracePath})`);
        } catch (e) {
            logger.warn(`Browser: Trace start failed: ${e}`);
            this.traceEnabled = false;
        }
    }

    private async stopTracing(): Promise<void> {
        if (!this.traceActive || !this.context) return;
        try {
            if (this.tracePath) {
                await this.context.tracing.stop({ path: this.tracePath });
                logger.info(`Browser: Trace saved (${this.tracePath})`);
            } else {
                await this.context.tracing.stop();
            }
        } catch (e) {
            logger.warn(`Browser: Trace stop failed: ${e}`);
        } finally {
            this.traceActive = false;
        }
    }

    /**
     * Connect to Lightpanda browser via CDP (Chrome DevTools Protocol).
     * Lightpanda must be running: ./lightpanda serve --host 127.0.0.1 --port 9222
     */
    private async connectToLightpanda(): Promise<void> {
        // Clean up any existing connections first
        if (this._page) {
            try { await this._page.close(); } catch {}
            this._page = null;
        }
        if (this.context) {
            try { await this.context.close(); } catch {}
            this.context = null;
        }
        if (this.browser) {
            try { await this.browser.close(); } catch {}
            this.browser = null;
        }

        try {
            logger.info(`Browser: Connecting to Lightpanda at ${this.lightpandaEndpoint}`);
            
            // Connect via CDP websocket endpoint
            this.browser = await chromium.connectOverCDP(this.lightpandaEndpoint);
            
            // Always create a fresh context and page for stability
            // Close any existing pages/contexts from previous sessions
            const existingContexts = this.browser.contexts();
            for (const ctx of existingContexts) {
                const pages = ctx.pages();
                for (const page of pages) {
                    try { await page.close(); } catch {}
                }
            }
            
            // Create fresh context and page
            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            this._page = await this.context.newPage();
            await this.ensureTracing();
            
            logger.info('Browser: Connected to Lightpanda successfully');
        } catch (error: any) {
            logger.error(`Browser: Failed to connect to Lightpanda at ${this.lightpandaEndpoint}: ${error.message}`);
            logger.warn('Browser: Make sure Lightpanda is running. Falling back to Playwright...');
            
            // Fallback to Playwright
            this.browserEngine = 'playwright';
            this.browser = null;
            this.context = null;
            this._page = null;
            await this.ensureBrowser();
        }
    }

    /**
     * Remove stale Chromium lock files and kill orphaned Chromium processes
     * that prevent browser launch after a crash or unclean shutdown.
     * On Linux, SingletonLock is a symlink encoding "hostname-pid".
     */
    private cleanStaleLockFiles(userDataDir: string): void {
        // Step 1: Try to detect and kill stale Chromium processes using this profile
        this.killStaleChromiumProcesses(userDataDir);

        // Step 2: Remove lock files (regular files on Windows, symlinks on Linux)
        const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
        for (const name of lockFiles) {
            const lockPath = path.join(userDataDir, name);
            try {
                // Use lstatSync to detect both files and symlinks (existsSync resolves symlinks)
                let exists = false;
                try { fs.lstatSync(lockPath); exists = true; } catch { /* doesn't exist */ }
                
                if (exists) {
                    fs.unlinkSync(lockPath);
                    logger.info(`Browser: Removed stale lock file ${name}`);
                }
            } catch (err: any) {
                logger.warn(`Browser: Could not remove lock file ${name}: ${err.message}`);
            }
        }
    }

    /**
     * Detect and kill orphaned Chromium processes that hold the profile lock.
     * Reads the PID from SingletonLock (symlink target on Linux: "hostname-pid")
     * and kills it if it's a stale chrome process.
     */
    private killStaleChromiumProcesses(userDataDir: string): void {
        try {
            const lockPath = path.join(userDataDir, 'SingletonLock');
            let stalePid: number | null = null;

            // On Linux/macOS, SingletonLock is a symlink whose target is "hostname-pid"
            try {
                const target = fs.readlinkSync(lockPath);
                const match = target.match(/-(\d+)$/);
                if (match) {
                    stalePid = parseInt(match[1], 10);
                }
            } catch {
                // Not a symlink or doesn't exist — try reading as file (Windows)
                try {
                    const content = fs.readFileSync(lockPath, 'utf-8').trim();
                    const pid = parseInt(content, 10);
                    if (!isNaN(pid)) stalePid = pid;
                } catch { /* doesn't exist */ }
            }

            if (stalePid && stalePid > 0) {
                try {
                    // Check if process is alive
                    process.kill(stalePid, 0);
                    // It's alive — kill it
                    logger.warn(`Browser: Killing stale Chromium process PID ${stalePid} holding profile lock`);
                    process.kill(stalePid, 'SIGKILL');
                    // Give the OS a moment to release file handles
                    const { execSync } = require('child_process');
                    try { execSync('sleep 0.5 2>/dev/null || timeout /t 1 /nobreak >nul 2>&1', { timeout: 3000 }); } catch { /* ok */ }
                } catch {
                    // Process doesn't exist — lock file is truly stale, cleanup will handle it
                    logger.debug(`Browser: Stale lock references PID ${stalePid} which is no longer running`);
                }
            }

            // Also try to find any orphaned chrome processes using this profile dir
            if (process.platform !== 'win32') {
                try {
                    const { execSync } = require('child_process');
                    const result = execSync(`pgrep -f "${userDataDir}" 2>/dev/null || true`, {
                        encoding: 'utf-8',
                        timeout: 5000
                    }).trim();
                    if (result) {
                        const pids = result.split('\n').map(p => parseInt(p.trim(), 10)).filter(p => p > 0 && p !== process.pid);
                        for (const pid of pids) {
                            try {
                                logger.warn(`Browser: Killing orphaned Chromium process PID ${pid}`);
                                process.kill(pid, 'SIGKILL');
                            } catch { /* already dead */ }
                        }
                        if (pids.length > 0) {
                            try { execSync('sleep 0.5', { timeout: 3000 }); } catch { /* ok */ }
                        }
                    }
                } catch { /* pgrep not available or failed — that's fine */ }
            }
        } catch (err: any) {
            logger.debug(`Browser: Stale process cleanup failed (non-fatal): ${err.message}`);
        }
    }

    /**
     * Clean crash artifacts from the profile directory.
     * GPU cache, crash reports, and corrupt session data can prevent re-launch.
     */
    private cleanCrashArtifacts(userDataDir: string): void {
        const dirsToClean = ['GPUCache', 'ShaderCache', 'GrShaderCache', 'Crashpad', 'crash_reports', 'BrowserMetrics'];
        const filesToClean = ['Local State.tmp', 'lockfile', '.org.chromium.Chromium.lock'];

        for (const dir of dirsToClean) {
            const target = path.join(userDataDir, dir);
            try {
                if (fs.existsSync(target)) {
                    fs.rmSync(target, { recursive: true, force: true });
                    logger.debug(`Browser: Cleaned crash artifact dir: ${dir}`);
                }
            } catch { /* best-effort */ }
            // Also check in Default subfolder
            const defaultTarget = path.join(userDataDir, 'Default', dir);
            try {
                if (fs.existsSync(defaultTarget)) {
                    fs.rmSync(defaultTarget, { recursive: true, force: true });
                }
            } catch { /* best-effort */ }
        }

        for (const file of filesToClean) {
            const target = path.join(userDataDir, file);
            try {
                if (fs.existsSync(target)) {
                    fs.unlinkSync(target);
                    logger.debug(`Browser: Cleaned crash artifact file: ${file}`);
                }
            } catch { /* best-effort */ }
        }
    }

    private recordProfileHistory(entry: { url: string; title?: string; timestamp: string }) {
        if (!this.profileHistoryPath) return;
        try {
            const existing = fs.existsSync(this.profileHistoryPath)
                ? JSON.parse(fs.readFileSync(this.profileHistoryPath, 'utf-8'))
                : [];
            existing.push(entry);
            fs.writeFileSync(this.profileHistoryPath, JSON.stringify(existing.slice(-200), null, 2));
        } catch (e) {
            logger.warn(`Browser profile history write failed: ${e}`);
        }
    }

    /**
     * Detect if we're in a headless environment (no X11/Wayland display).
     * On such servers, headful mode is impossible.
     * Checks both env vars AND tracks actual launch failures.
     */
    private _displayBroken = false; // Set true if headful launch ever fails with display error
    private isHeadlessEnvironment(): boolean {
        if (process.platform === 'win32' || process.platform === 'darwin') return false;
        // If a previous headful launch failed with display error, don't try again
        if (this._displayBroken) return true;
        return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    }

    // Sites known to block headless browsers aggressively
    private shouldUseHeadful(url: string): boolean {
        // Cannot go headful on a server with no display
        if (this.isHeadlessEnvironment()) return false;

        // First check if tuner has learned this domain needs headful
        if (this.tuner?.shouldForceHeadful(url)) {
            logger.debug(`Browser: Tuner says ${url} requires headful mode`);
            return true;
        }

        const blockedDomains = [
            'youtube.com',
            'google.com/search',
            'instagram.com',
            'facebook.com',
            'twitter.com',
            'x.com',
            'tiktok.com',
            'amazon.com',
            'netflix.com',
            // YouTube downloader sites - heavily bot-protected
            'y2mate',
            'savefrom.net',
            'ssyoutube',
            'ytmp3',
            'yt1s',
            'snaptik',
            'ssstik',
            'turboscribe'
        ];
        
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            const pathname = new URL(url).pathname.toLowerCase();
            return blockedDomains.some(domain => {
                if (domain.includes('/')) {
                    const [domainPart, pathPart] = domain.split('/');
                    return hostname.includes(domainPart) && pathname.includes('/' + pathPart);
                }
                return hostname.includes(domain);
            });
        } catch {
            return false;
        }
    }

    private lastNavigateTimestamp: number = 0;
    private lastInteractionTimestamp: number = 0;

    /**
     * Wait for the DOM to settle (stop mutating) for a given debounce period.
     * Uses MutationObserver to detect visual/structural changes.
     * Much safer and faster than fixed sleeps or network idle.
     */
    private async waitForDomSettle(debounceMs: number = 300, maxWaitMs: number = 5000): Promise<void> {
        if (!this._page) return;
        try {
            await this._page.evaluate(({ debounce, max }) => {
                return new Promise<void>((resolve) => {
                    let timer: any;
                    const start = Date.now();
                    
                    const observer = new MutationObserver(() => {
                        clearTimeout(timer);
                        // Safety hatch: if we wait too long, just give up and proceed
                        if (Date.now() - start > max) {
                            observer.disconnect();
                            resolve();
                            return;
                        }
                        timer = setTimeout(() => {
                            observer.disconnect();
                            resolve();
                        }, debounce);
                    });
                    
                    if (document.body) {
                        observer.observe(document.body, { 
                            childList: true, 
                            subtree: true, 
                            attributes: true, 
                            characterData: true 
                        });
                    }
                    
                    // Initial kick-off in case there are no mutations at all
                    timer = setTimeout(() => {
                        observer.disconnect();
                        resolve();
                    }, debounce);
                });
            }, { debounce: debounceMs, max: maxWaitMs });
        } catch (e) {
            // Ignore errors (e.g. navigation happened during wait)
        }
    }

    private async waitForStablePage(timeout = 10000) {
        if (!this._page) return;
        try {
            // Phase 1: Wait for basic load events (fast failover)
            await Promise.all([
                this._page.waitForLoadState('load', { timeout: Math.min(timeout, 5000) }),
                this._page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 5000) }).catch(() => {})
            ]);
        } catch (e) {
            // Ignore timeouts here, we rely on DOM settle next
        }

        // Phase 2: Event-driven DOM Settle (The "Safer" Wait)
        // Waits until the page actually stops changing.
        await this.waitForDomSettle(400, Math.min(timeout, 8000));

        // Phase 3: Final check for meaningful content (SPA empty shell detection)
        // If DOM settled but page is still empty, wait a bit longer to see if it hydrates
        try {
            const bodyLength = await this._page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
            if (bodyLength < 50) {
                // Page seems empty, give it one last chance (maybe a slow API call triggers render)
                logger.debug('Browser: Page seems empty after settle, waiting extra...');
                await this.waitForDomSettle(1000, 4000); 
            }
        } catch {}
    }

    public async navigate(url: string, waitSelectors: string[] = [], allowHeadfulRetry: boolean = true): Promise<string> {
        try {
            const navStart = Date.now();
            // Check for navigation loop
            if (this.stateManager.detectNavigationLoop(url)) {
                const error = `Navigation loop detected for ${url}. Aborting to prevent infinite loop.`;
                this.stateManager.recordNavigation(url, 'navigate', false, error);
                return `Error: ${error}\n\nSuggestion: Try a different URL or strategy.`;
            }

            // Check circuit breaker
            if (this.stateManager.isCircuitOpen('navigate', url)) {
                const error = `Circuit breaker open for ${url} (too many recent failures).`;
                this.stateManager.recordNavigation(url, 'navigate', false, error);
                return `Error: ${error}\n\nSuggestion: Wait a moment or try a different approach.`;
            }

            // Check if this domain has repeatedly returned blank pages
            // Threshold is 5 to avoid premature blocking — many sites need multiple
            // attempts with different strategies (headful, ephemeral, resource unblocking)
            try {
                const blankCheckUrl = url.startsWith('http') ? url : 'https://' + url;
                const blankDomain = new URL(blankCheckUrl).hostname.replace('www.', '');
                const blankCount = this._blankUrlHistory.get(blankDomain) || 0;
                if (blankCount >= 5) {
                    const error = `This site (${blankDomain}) has returned blank/empty pages ${blankCount} time(s). It likely requires JavaScript rendering that is unavailable in this browser mode.`;
                    logger.warn(`Browser: Blocking navigation to ${blankDomain} — ${blankCount} prior blank pages`);
                    this.stateManager.recordNavigation(url, 'navigate', false, error);
                    return `Error: ${error}\n\nSuggestion: Try extract_article(url) or http_fetch(url) as alternatives. If you must interact with this site, try computer_vision_click for visual-based interaction.`;
                }
                // On 3rd blank attempt, disable resource blocking for this navigation
                // (some sites need images/fonts to render properly)
                if (blankCount >= 2) {
                    this._resourceBlockingEnabled = false;
                    logger.info(`Browser: Disabling resource blocking for ${blankDomain} (${blankCount} prior blanks)`);
                }
            } catch {}

            const needsGoogleForms = /docs\.google\.com\/forms/i.test(url);
            const needsHeadful = this.shouldUseHeadful(url);
            
            if (needsHeadful && this.headlessMode) {
                logger.warn(`Browser: Detected bot-protected site (${new URL(url).hostname}). Switching to headful mode.`);
                await this.ensureBrowser(false);
            } else {
                await this.ensureBrowser();
            }
            if (!this._page) throw new Error('Failed to create page');

            // Check if page is still valid (not detached)
            try {
                await this._page.evaluate(() => true);
            } catch (e: any) {
                if (e.message?.includes('detached') || e.message?.includes('Target closed')) {
                    logger.warn('Browser: Page is detached, reinitializing...');
                    await this.close();
                    await this.ensureBrowser();
                    if (!this._page) throw new Error('Failed to reinitialize page');
                }
            }

            // Auto-fix protocol if missing
            let targetUrl = url;
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                targetUrl = 'https://' + targetUrl;
            }

            logger.info(`Browser: Navigating to ${targetUrl} (engine=${this.browserEngine}, headless=${this.headlessMode})`);
            this._consoleLogs = []; // Clear logs for new navigation
            
            // Use 'load' + stable wait instead of 'domcontentloaded' which is too early for modern SPAs
            await this._page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
            await this.waitForStablePage(15000);
            this.lastNavigateTimestamp = Date.now();

            const bodyTextLength = await this._page.evaluate(() => document.body?.innerText?.trim().length ?? 0).catch(() => 0);
            const navTitle = await this._page.title().catch(() => '');
            const navElapsed = Date.now() - navStart;
            logger.info(`Browser: Loaded ${targetUrl} in ${navElapsed}ms (title="${navTitle}", text=${bodyTextLength})`);
            
            // If page appears truly empty and we're in headless mode, retry headful (only if display available)
            if (bodyTextLength < 50 && this.headlessMode && allowHeadfulRetry && !this.isHeadlessEnvironment()) {
                logger.warn(`Browser: Page appears blocked/empty (${bodyTextLength} chars). Retrying in headful mode...`);
                await this.ensureBrowser(false);
                return this.navigate(url, waitSelectors, false);
            }
            
            if (bodyTextLength < 50) {
                // Give modern sites extra time to hydrate if they're truly empty
                await this._page.waitForTimeout(3000);
                await this._page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            }

            const effectiveWaitSelectors = [...waitSelectors];
            if (needsGoogleForms) {
                effectiveWaitSelectors.push(
                    'form',
                    'div[role="list"]',
                    'div[role="listitem"]',
                    '.freebirdFormviewerViewFormContent'
                );
            }

            for (const selector of effectiveWaitSelectors) {
                await this._page.waitForSelector(selector, { timeout: 10000 }).catch(() => { });
            }

            // Auto-handle Cloudflare challenges before checking content
            await this.handleCloudflareChallenge();

            // Auto-dismiss cookie consent banners and overlays
            await this.autoDismissOverlays();

            const captcha = await this.detectCaptcha();
            const title = await this._page.title();
            const content = await this._page.content();
            
            // looksBlank: conservative check — only flag truly empty pages.
            // Many legitimate pages have short content (login forms, redirects, SPAs hydrating).
            // Require BOTH no title AND very little visible text to flag as blank.
            const strippedContentLen = content.replace(/\s+/g, '').length;
            const looksBlank = (
                bodyTextLength < 30 && strippedContentLen < 800
            ) || (
                (!title || title.trim().length === 0) && bodyTextLength < 50 && strippedContentLen < 1200
            );

            if (this.debugAlwaysSaveArtifacts) {
                await this.saveDebugArtifacts('navigate', content).catch(() => null);
            }

            if (looksBlank && this.headlessMode && allowHeadfulRetry && !this.isHeadlessEnvironment()) {
                logger.warn('Browser: Page appears blank in headless mode. Retrying headful...');
                // Auto-learn: this domain needs headful
                if (this.tuner) {
                    try {
                        const domain = new URL(url).hostname.replace('www.', '');
                        this.tuner.markDomainAsHeadful(domain, 'Auto-learned: headless returned blank page');
                        logger.info(`Browser: Auto-tuned ${domain} to require headful mode`);
                    } catch {}
                }
                await this.ensureBrowser(false);
                return this.navigate(url, waitSelectors, false);
            }

            if (looksBlank && !allowHeadfulRetry) {
                logger.warn('Browser: Persistent profile returned blank page. Retrying with stateless context...');
                const fallback = await this.navigateEphemeral(targetUrl, effectiveWaitSelectors);
                if (fallback) {
                    this.stateManager.recordNavigation(targetUrl, 'navigate', true);
                    return fallback;
                }
            }

            // Track blank URL domains to prevent repeated failures
            try {
                const trackDomain = new URL(targetUrl).hostname.replace('www.', '');
                if (looksBlank) {
                    const prevCount = this._blankUrlHistory.get(trackDomain) || 0;
                    this._blankUrlHistory.set(trackDomain, prevCount + 1);
                    logger.warn(`Browser: Domain ${trackDomain} returned blank page (count: ${prevCount + 1})`);
                } else {
                    // Success — clear blank history for this domain and re-enable resource blocking
                    this._blankUrlHistory.delete(trackDomain);
                    this._resourceBlockingEnabled = true;
                }
            } catch {}

            this.recordProfileHistory({ url: targetUrl, title, timestamp: new Date().toISOString() });
            this.lastNavigatedUrl = targetUrl;
            this.stateManager.recordNavigation(targetUrl, 'navigate', true);
            if (looksBlank) {
                const debug = await this.saveDebugArtifacts('blank-navigate', content).catch(() => null);
                if (debug?.screenshotPath || debug?.htmlPath) {
                    logger.warn(`Browser: Blank page diagnostics saved (${debug.screenshotPath || 'no screenshot'}, ${debug.htmlPath || 'no html'})`);
                }
            }
            const blankWarning = looksBlank ? '\n\n[WARNING: Page appears blank or nearly empty. Try: (1) browser_wait(3000) then browser_examine_page(), (2) extract_article(url), (3) http_fetch(url). The site may need more time to render or may block automated browsers.]' : '';
            return `Page Loaded: ${title}\nURL: ${url}${captcha ? `\n[WARNING: ${captcha}]` : ''}${blankWarning}`;
        } catch (e) {
            const classified = this.classifyNavigateError(e);
            logger.error(`Browser Error at ${url}: ${classified.raw}`);
            this.stateManager.recordNavigation(url, 'navigate', false, classified.message);
            return `Error: ${classified.message}`;
        }
    }

    private classifyNavigateError(error: unknown): { message: string; raw: string } {
        const raw = String(error);
        const lower = raw.toLowerCase();

        // Missing shared library / dependency (common on Linux servers)
        const libMatch = raw.match(/error while loading shared libraries:\s*([^\s:]+)|([^\s:]+\.so\.[0-9]+)/i);
        if (libMatch) {
            const libName = (libMatch[1] || libMatch[2] || 'a required library').trim();
            return {
                raw,
                message: `Browser dependency missing: ${libName}. Install the required system library and retry.`
            };
        }

        if (lower.includes('err_name_not_resolved')) {
            return { raw, message: 'DNS lookup failed (host not found). The URL may be incorrect.' };
        }
        if (lower.includes('err_connection_timed_out')) {
            return { raw, message: 'Connection timed out. The site may be down or blocking automated access.' };
        }
        if (lower.includes('err_connection_refused')) {
            return { raw, message: 'Connection refused by the host.' };
        }
        if (lower.includes('net::err_cert') || lower.includes('certificate')) {
            return { raw, message: 'SSL certificate error while connecting to the site.' };
        }

        return { raw, message: `Failed to navigate: ${raw}` };
    }

    private async navigateEphemeral(targetUrl: string, waitSelectors: string[]): Promise<string | null> {
        let tempBrowser: Browser | null = null;
        try {
            tempBrowser = await chromium.launch({
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--ignore-certificate-errors',
                ],
                ignoreDefaultArgs: ['--enable-automation'],
            });

            const context = await tempBrowser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                deviceScaleFactor: 1,
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            });

            const page = await context.newPage();
            await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

            for (const selector of waitSelectors) {
                await page.waitForSelector(selector, { timeout: 10000 }).catch(() => { });
            }

            const title = await page.title();
            const content = await page.content();
            const ephBodyText = await page.evaluate(() => document.body?.innerText?.trim().length ?? 0).catch(() => 0);
            const ephLooksBlank = ephBodyText < 30 && content.replace(/\s+/g, '').length < 800;
            if (ephLooksBlank) return null;

            return `Page Loaded: ${title}\nURL: ${targetUrl}\n[NOTE: Loaded via stateless context]`;
        } catch (e) {
            logger.warn(`Browser: Stateless context failed: ${e}`);
            return null;
        } finally {
            if (tempBrowser) await tempBrowser.close();
        }
    }

    /**
     * Auto-dismiss cookie consent banners and common overlays that block content.
     * Runs after navigation to clear the way for content extraction.
     */
    private async autoDismissOverlays(): Promise<void> {
        if (!this._page) return;
        try {
            await this._page.evaluate(() => {
                // Common cookie consent / overlay selectors and text patterns
                const dismissSelectors = [
                    // Cookie consent buttons
                    '[id*="cookie"] button', '[class*="cookie"] button',
                    '[id*="consent"] button', '[class*="consent"] button',
                    '[id*="gdpr"] button', '[class*="gdpr"] button',
                    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
                    '[aria-label*="accept" i]',
                    // Common cookie banner frameworks
                    '.cc-btn.cc-dismiss', '#onetrust-accept-btn-handler',
                    '.js-cookie-consent-agree', '#cookie-notice .btn',
                    '.cookie-banner button', '.cookie-popup button',
                    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                    '[data-testid="cookie-policy-dialog-accept-button"]',
                    '.fc-cta-consent', // Funding Choices
                ];

                const acceptTexts = [
                    'accept all', 'accept cookies', 'accept', 'agree',
                    'got it', 'ok', 'i agree', 'allow all', 'allow cookies',
                    'continue', 'dismiss', 'close',
                ];

                // Try selector-based dismissal first
                for (const sel of dismissSelectors) {
                    const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                    for (const el of els) {
                        const text = (el.innerText || el.textContent || '').toLowerCase().trim();
                        if (acceptTexts.some(t => text.includes(t)) || el.tagName === 'BUTTON') {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                el.click();
                                return;
                            }
                        }
                    }
                }

                // Fallback: find any visible button with accept-like text
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn, a.button')) as HTMLElement[];
                for (const btn of allButtons) {
                    const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                    if (acceptTexts.some(t => text === t || text.startsWith(t))) {
                        const rect = btn.getBoundingClientRect();
                        // Only click if it's in a likely overlay position (top or bottom of viewport)
                        if (rect.width > 0 && rect.height > 0 && (rect.top > window.innerHeight * 0.6 || rect.top < window.innerHeight * 0.3)) {
                            btn.click();
                            return;
                        }
                    }
                }
            });
        } catch {
            // Best effort — don't fail navigation over overlay dismissal
        }
    }

    /**
     * Handle Cloudflare challenges — wait for the challenge to auto-resolve
     * (Turnstile often resolves automatically with a real browser).
     */
    private async handleCloudflareChallenge(): Promise<boolean> {
        if (!this._page) return false;
        try {
            const content = await this._page.content();
            const isCloudflare = content.includes('cf-turnstile') || 
                                 content.includes('challenges.cloudflare.com') ||
                                 content.includes('Just a moment') ||
                                 content.includes('Checking your browser');
            
            if (!isCloudflare) return false;

            logger.info('Browser: Cloudflare challenge detected, waiting for auto-resolution...');
            
            // Cloudflare Turnstile often resolves automatically in a real browser.
            // Wait up to 15s for the challenge page to redirect.
            for (let i = 0; i < 15; i++) {
                await this._page.waitForTimeout(1000);
                const currentContent = await this._page.content().catch(() => '');
                const stillChallenge = currentContent.includes('cf-turnstile') || 
                                       currentContent.includes('challenges.cloudflare.com') ||
                                       currentContent.includes('Just a moment');
                if (!stillChallenge) {
                    logger.info('Browser: Cloudflare challenge resolved automatically');
                    await this.waitForStablePage(5000);
                    return true;
                }
                
                // Try clicking the Turnstile checkbox if visible
                if (i === 3) {
                    await this._page.evaluate(() => {
                        const iframe = document.querySelector('iframe[src*="challenges.cloudflare"]') as HTMLIFrameElement;
                        if (iframe) {
                            // Can't access cross-origin iframe, but clicking near it sometimes helps
                            const rect = iframe.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                const clickEvent = new MouseEvent('click', {
                                    clientX: rect.left + rect.width / 2,
                                    clientY: rect.top + rect.height / 2,
                                    bubbles: true
                                });
                                document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.dispatchEvent(clickEvent);
                            }
                        }
                    }).catch(() => {});
                }
            }
            
            logger.warn('Browser: Cloudflare challenge did not resolve within timeout');
            return false;
        } catch {
            return false;
        }
    }

    public async detectCaptcha(): Promise<string | null> {
        if (!this._page) return null;

        let retries = 3;
        while (retries > 0) {
            try {
                const content = await this._page.content();
                if (content.includes('g-recaptcha') || content.includes('recaptcha/api.js')) return 'Google reCAPTCHA';
                if (content.includes('h-captcha') || content.includes('hcaptcha.com')) return 'hCaptcha';
                if (content.includes('cf-turnstile') || content.includes('challenges.cloudflare.com')) return 'Cloudflare Turnstile';
                if (content.includes('Please verify you are a human') || content.includes('Verify you are human')) {
                    // Check if there is a simple button/checkbox we can just click
                    const hasButton = await this._page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], input[type="checkbox"]'));
                        return buttons.some(b => b.textContent?.includes('Verify') || b.textContent?.includes('human') || (b as HTMLElement).innerText?.includes('Verify'));
                    });
                    return hasButton ? 'Verification Button/Checkbox' : 'Generic CAPTCHA Page';
                }
                return null;
            } catch (e: any) {
                if (e.message.includes('navigating')) {
                    logger.info(`detectCaptcha: Page is navigating, waiting and retrying... (${retries} left)`);
                    await this._page.waitForTimeout(500);
                    retries--;
                    continue;
                }
                throw e;
            }
        }
        return null;
    }

    public async solveCaptcha(): Promise<string> {
        if (!this.captchaApiKey) return 'Error: No captchaApiKey configured.';
        if (!this.page) return 'Error: Browser not initialized.';

        const type = await this.detectCaptcha();
        if (!type) return 'No CAPTCHA detected on the current page.';

        logger.info(`Attempting to solve ${type}...`);

        // Handle simple button/checkbox first
        if (type === 'Verification Button/Checkbox') {
            try {
                await this.page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], input[type="checkbox"]')) as HTMLElement[];
                    const target = buttons.find(b => b.textContent?.includes('Verify') || b.textContent?.includes('human') || b.innerText?.includes('Verify'));
                    if (target) target.click();
                });
                await this.page.waitForTimeout(2000);
                const stillThere = await this.detectCaptcha();
                return stillThere ? `Clicked verification button but ${stillThere} remains.` : 'Successfully bypassed verification button.';
            } catch (e) {
                return `Failed to click verification button: ${e}`;
            }
        }

        try {
            // 1. Identify and extract SiteKey/Data
            const taskData = await this.page.evaluate(() => {
                const re = document.querySelector('[data-sitekey]');
                if (re) return { sitekey: re.getAttribute('data-sitekey'), type: 'userrecaptcha' };
                const h = document.querySelector('[data-sitekey][src*="hcaptcha"]');
                if (h) return { sitekey: h.getAttribute('data-sitekey'), type: 'hcaptcha' };
                return null;
            });

            if (!taskData || !taskData.sitekey) return `Error: Could not extract sitekey for ${type}.`;

            // 2. Submit to 2Captcha API
            const pageUrl = this.page.url();
            const submitUrl = `https://2captcha.com/in.php?key=${this.captchaApiKey}&method=${taskData.type}&googlekey=${taskData.sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;

            const submitRes = await fetch(submitUrl);
            const submitJson = await submitRes.json() as any;

            if (submitJson.status !== 1) return `2Captcha Error: ${submitJson.request}`;
            const requestId = submitJson.request;

            // 3. Poll for result
            logger.info(`CAPTCHA submitted (ID: ${requestId}). Polling for result...`);
            let token = '';
            for (let i = 0; i < 20; i++) { // Max 100 seconds
                await new Promise(r => setTimeout(r, 5000));
                const resUrl = `https://2captcha.com/res.php?key=${this.captchaApiKey}&action=get&id=${requestId}&json=1`;
                const resRes = await fetch(resUrl);
                const resJson = await resRes.json() as any;

                if (resJson.status === 1) {
                    token = resJson.request;
                    break;
                }
                if (resJson.request !== 'CAPCHA_NOT_READY') return `2Captcha Error: ${resJson.request}`;
            }

            if (!token) return 'Error: Timed out waiting for CAPTCHA solution.';

            // 4. Inject token and submit
            await this.page.evaluate((t) => {
                const g = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement;
                if (g) g.innerHTML = t;
                const h = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement;
                if (h) h.innerHTML = t;

                // Try to find and call the callback
                const callback = (window as any).___grecaptcha_cfg?.clients[0]?.aa?.l?.callback;
                if (callback) callback(t);

                // Or find a submit button
                const submit = document.querySelector('input[type="submit"], button[type="submit"]') as HTMLElement;
                if (submit) submit.click();
            }, token);

            await this.page.waitForTimeout(3000);
            const finalCheck = await this.detectCaptcha();
            return finalCheck ? `Token injected but ${finalCheck} persists. Manual action may be needed.` : 'Successfully solved CAPTCHA and bypassed page.';

        } catch (e) {
            return `Failed to solve CAPTCHA via API: ${e}`;
        }
    }

    public async getSemanticSnapshot(): Promise<string> {
        try {
            await this.ensureBrowser();

            // Skip redundant stable-page wait if we just interacted/navigated recently.
            // We only need the heavy 'waitForStablePage' if the page has been sitting idle for a while
            // (potential background updates) or if we're recovering from a blank state.
            // Previous logic double-waited after every click, causing massive slowness.
            const timeSinceNavigate = Date.now() - this.lastNavigateTimestamp;
            const timeSinceInteraction = Date.now() - this.lastInteractionTimestamp;
            const currentUrl = this.page?.url() || '';
            const isBlankUrl = !currentUrl || currentUrl === 'about:blank';
            
            // Only wait if it's been >15s since nav AND >4s since last click/type.
            // If we just clicked (e.g. 500ms ago), the click method already handled the immediate settle.
            const needsStableWait = (timeSinceNavigate > 15000 && timeSinceInteraction > 4000) || isBlankUrl;
            
            if (needsStableWait) {
                await this.waitForStablePage(isBlankUrl ? 8000 : undefined);
            }

            if (this.page?.isClosed() && this.lastNavigatedUrl) {
                logger.warn('Semantic snapshot: page is closed, re-opening last URL.');
                this._page = await this.context?.newPage() || this._page;
                if (this._page) {
                    await this._page.goto(this.lastNavigatedUrl, { waitUntil: 'load', timeout: 30000 });
                    await this.waitForStablePage();
                }
            }
            const buildSnapshot = async () => {
                return this.page!.evaluate(() => {
                    const interactiveSelectors = [
                        'a', 'button', 'input', 'select', 'textarea', 'summary',
                        '[contenteditable="true"]',
                        '[tabindex]:not([tabindex="-1"])',
                        '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
                        '[role="switch"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
                        '[role="menuitemradio"]', '[role="tab"]', '[role="tablist"]',
                        '[role="combobox"]', '[role="listbox"]', '[role="option"]',
                        '[role="textbox"]', '[role="searchbox"]', '[role="spinbutton"]',
                        '[role="slider"]', '[role="progressbar"]', '[role="scrollbar"]',
                        '[role="tree"]', '[role="treeitem"]', '[role="grid"]', '[role="row"]',
                        '[role="cell"]', '[role="gridcell"]', '[role="columnheader"]', '[role="rowheader"]',
                        '[role="dialog"]', '[role="alertdialog"]', '[role="tooltip"]',
                        '[onclick]', '[onmousedown]', '[onmouseup]', '[onkeydown]', '[onkeyup]'
                    ];

                    const elements = Array.from(document.querySelectorAll(interactiveSelectors.join(','))) as HTMLElement[];
                    const visibleElements = elements.filter(el => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                        if (!isVisible) return false;
                        
                        // Check if element is actually on screen
                        if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
                            return false;
                        }
                        return true;
                    });

                    let refCounter = 1;
                    const result: string[] = [];

                    visibleElements.forEach(el => {
                        const refId = refCounter++;
                        el.setAttribute('data-orcbot-ref', refId.toString());

                        const rect = el.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const vPos = centerY < window.innerHeight / 3 ? 'top' : centerY < (window.innerHeight * 2) / 3 ? 'middle' : 'bottom';
                        const hPos = centerX < window.innerWidth / 3 ? 'left' : centerX < (window.innerWidth * 2) / 3 ? 'center' : 'right';
                        const pos = `${vPos}-${hPos}`;

                        const role = el.getAttribute('role') || el.tagName.toLowerCase();
                        let label = el.getAttribute('aria-label') ||
                            el.getAttribute('placeholder') ||
                            el.getAttribute('title') ||
                            (el as any).value ||
                            el.innerText.trim().slice(0, 60);

                        if (!label || label.trim().length === 0) {
                            // Try to derive label from ID or class if desperately needed
                            label = el.id || el.className.toString().split(' ')[0] || '(no label)';
                        }

                        const typeAttr = (el as HTMLInputElement).type ? ` (${(el as HTMLInputElement).type})` : '';
                        result.push(`${role}${typeAttr} "${label.replace(/\n/g, ' ')}" [ref=${refId}] [pos=${pos}]`);
                    });

                    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10);
                    headings.forEach(h => {
                        const text = (h as HTMLElement).innerText.trim();
                        if (text) result.unshift(`heading "${text.slice(0, 100)}"`);
                    });

                    return result.join('\n');
                });
            };

            // Execute snapshot build early so we have metrics for the vision check
            const snapshotStart = Date.now();
            let snapshot = await buildSnapshot();
            let title = await this.page!.title();
            let url = this.page!.url();
            let contentLength = (await this.page!.content()).length;
            
            // Calculate metrics for blank check
            const interactiveLineCount = (snapshot || '').split('\n').filter(l => l.includes('[ref=')).length;

            // Track recovery reload attempts to prevent churn and repeated full reloads
            const maxRecoveryReloads = 1;
            let recoveryReloadAttempts = 0;

            // SPAs often transition through about:blank briefly during client-side navigation.
            // Wait up to 3s for the URL to become non-blank before considering a reload.
            if ((!url || url === 'about:blank') && contentLength < 500) {
                for (let i = 0; i < 6; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    url = this.page!.url();
                    contentLength = (await this.page!.content()).length;
                    if (url && url !== 'about:blank') break;
                }
            }

            // If still blank after the 3s poll, reload the last known URL immediately.
            // Don't add more settle waits — the poll already proved the page isn't recovering on its own.
            if ((!url || url === 'about:blank') && contentLength < 500 && recoveryReloadAttempts < maxRecoveryReloads) {
                const fallbackUrl = this.lastNavigatedUrl;
                if (fallbackUrl) {
                    logger.info(`Semantic snapshot: blank URL detected (content: ${contentLength} bytes). Reloading ${fallbackUrl}.`);
                    recoveryReloadAttempts++;
                    await this.page!.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                    // Shorter stabilization — the site already loaded once, this is a recovery reload
                    await this.waitForStablePage(5000);
                    snapshot = await buildSnapshot();
                    title = await this.page!.title();
                    url = this.page!.url();
                    contentLength = (await this.page!.content()).length;
                }
            }

            // If URL is still blank but we have content, use the lastNavigatedUrl for display
            if ((!url || url === 'about:blank') && this.lastNavigatedUrl) {
                url = `${this.lastNavigatedUrl} (SPA state)`;
            }

            // Only consider it "blank" if we have almost no content AND no snapshot elements AND no title
            // interactiveLineCount calculated at start of function
            const hasSnapshotContent = snapshot && snapshot.length > 50;
            const hasTitle = title && title.trim().length > 0 && !title.includes('about:blank');
            const looksBlank = !hasTitle && contentLength < 800 && !hasSnapshotContent;
            
            // Vision Fallback: If page looks blank to the DOM (Canvas/SPA), trust the eyes (Vision).
            // Do NOT reload. Reloading canvas apps like Google Docs just gives another blank DOM.
            if (this._visionAnalyzer && (looksBlank || interactiveLineCount < 3)) {
                try {
                    logger.info(`Semantic snapshot thin (${interactiveLineCount} elements, ${contentLength} bytes) — triggering auto-vision`);
                    const screenshotResult = await this.screenshot();
                    if (!String(screenshotResult).startsWith('Failed')) {
                        const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
                        if (fs.existsSync(screenshotPath)) {
                            const visionDescription = await this._visionAnalyzer(
                                screenshotPath,
                                'Describe the visible page layout and content. List ALL interactive elements you can see: buttons, links, input fields, menus, tabs, icons, and any clickable areas. For each element, describe its position (top/center/bottom, left/center/right) and what it appears to do. Also describe any visible text, headings, images, or important content areas.'
                            );
                            
                            // If vision sees something, return that instead of the "blank" DOM snapshot
                            if (visionDescription && visionDescription.length > 50) {
                                return `PAGE: "${title}"\nURL: ${url}\n\n[NOTE: DOM was empty, using Vision Analysis]\n\nVISION SNAPSHOT:\n${visionDescription}`;
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`Auto-vision fallback failed: ${e}`);
                }
            }

            // interactiveLineCount calculated above
            const snapshotElapsed = Date.now() - snapshotStart;
            // Demote to debug to reduce log noise - users don't need to see this every time
            logger.debug(`Semantic snapshot: url="${url}" title="${title}" html=${contentLength} elements=${interactiveLineCount} in ${snapshotElapsed}ms`);
            const diagnostics = `URL: ${url}\nHTML length: ${contentLength}`;
            const baseResult = `PAGE: "${title}"\n${diagnostics}\n\nSEMANTIC SNAPSHOT:\n${snapshot || '(No interactive elements found)'}`;

            if (this.debugAlwaysSaveArtifacts) {
                const html = await this.page!.content().catch(() => '');
                await this.saveDebugArtifacts('snapshot', html).catch(() => null);
            }

            // Auto-vision fallback: if the page has substantial HTML but the semantic snapshot
            // found very few interactive elements, use vision to describe what's actually visible.
            // This helps with canvas-heavy pages, image-based UIs, and SPAs with custom components.
            const hasSubstantialContent = contentLength > 1500;
            const snapshotIsThin = interactiveLineCount < 5 && (!snapshot || snapshot.length < 200);

            if (this._visionAnalyzer && hasSubstantialContent && snapshotIsThin) {
                try {
                    logger.info(`Semantic snapshot thin (${interactiveLineCount} elements, ${contentLength} bytes HTML) — triggering auto-vision fallback`);
                    const screenshotResult = await this.screenshot();
                    if (!String(screenshotResult).startsWith('Failed')) {
                        const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
                        if (fs.existsSync(screenshotPath)) {
                            const visionDescription = await this._visionAnalyzer(
                                screenshotPath,
                                'Describe the visible page layout and content. List ALL interactive elements you can see: buttons, links, input fields, menus, tabs, icons, and any clickable areas. For each element, describe its position (top/center/bottom, left/center/right) and what it appears to do. Also describe any visible text, headings, images, or important content areas.'
                            );
                            if (visionDescription && visionDescription.length > 20) {
                                return baseResult + `\n\nVISION ANALYSIS (auto-fallback — semantic snapshot was thin):\n${visionDescription}`;
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`Auto-vision fallback failed: ${e}`);
                }
            }

            if (looksBlank) {
                const html = await this.page!.content().catch(() => '');
                const debug = await this.saveDebugArtifacts('blank-snapshot', html).catch(() => null);
                if (debug?.screenshotPath || debug?.htmlPath) {
                    logger.warn(`Semantic snapshot blank: saved diagnostics (${debug.screenshotPath || 'no screenshot'}, ${debug.htmlPath || 'no html'})`);
                }
            }

            // Append console logs if any errors/warnings are present
            if (this._consoleLogs.length > 0) {
                const errors = this._consoleLogs.filter(l => l.includes('[Console error]'));
                if (errors.length > 0) {
                    return baseResult + `\n\nPAGE CONSOLE ERRORS:\n${errors.slice(-5).join('\n')}`;
                }
            }

            return baseResult;
        } catch (e) {
            return `Failed to get semantic snapshot: ${e}`;
        }
    }

    public async wait(ms: number): Promise<string> {
        try {
            await this.ensureBrowser();
            await this.page!.waitForTimeout(ms);
            return `Waited for ${ms}ms`;
        } catch (e) {
            return `Wait failed: ${e}`;
        }
    }

    public async waitForSelector(selector: string, timeout: number = 15000): Promise<string> {
        try {
            await this.ensureBrowser();
            await this.page!.waitForSelector(selector, { timeout });
            return `Element found: ${selector}`;
        } catch (e) {
            return `Timed out waiting for selector: ${selector}`;
        }
    }

    /**
     * Resolve a selector — handles numeric ref IDs by looking up data-orcbot-ref attributes.
     * If the ref attribute was removed by SPA re-render, attempts to re-attach it by
     * finding the Nth interactive element (the ref assignment order matches snapshot order).
     */
    private async resolveSelector(selector: string): Promise<string | null> {
        if (!/^\d+$/.test(selector)) return selector;

        const refSelector = `[data-orcbot-ref="${selector}"]`;

        // Fast path: ref attribute still present
        const exists = await this.page!.$(refSelector).catch(() => null);
        if (exists) return refSelector;

        // Slow path: SPA re-rendered and cleared data-orcbot-ref attributes.
        // Re-run the same selector logic that getSemanticSnapshot uses and re-attach refs.
        logger.debug(`Browser: Ref ${selector} not found in DOM, re-attaching refs...`);
        const reattached = await this.page!.evaluate((targetRef: number) => {
            const selectors = [
                'a', 'button', 'input', 'select', 'textarea', 'summary',
                '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
                '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
                '[role="switch"]', '[role="menuitem"]', '[role="tab"]', '[role="combobox"]',
                '[role="listbox"]', '[role="option"]', '[role="textbox"]', '[role="searchbox"]',
                '[onclick]', '[onmousedown]', '[onkeydown]'
            ];
            const elements = Array.from(document.querySelectorAll(selectors.join(','))) as HTMLElement[];
            const visible = elements.filter(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            });
            let counter = 1;
            for (const el of visible) {
                el.setAttribute('data-orcbot-ref', counter.toString());
                if (counter === targetRef) return true;
                counter++;
            }
            return false;
        }, parseInt(selector)).catch(() => false);

        if (reattached) {
            logger.debug(`Browser: Successfully re-attached ref ${selector}`);
            return refSelector;
        }

        // Second fallback: refresh semantic snapshot to re-attach refs, then re-check
        // DISABLED: This causes reload loops on "blank" SPAs. Let the agent fail and retry cleanly.
        /*
        logger.warn(`Browser: Could not re-attach ref ${selector} — refreshing snapshot`);
        try {
            await this.getSemanticSnapshot();
            const existsAfter = await this.page!.$(refSelector).catch(() => null);
            if (existsAfter) return refSelector;
        } catch (e) {
            logger.debug(`Browser: Snapshot refresh failed while re-attaching ref ${selector}: ${e}`);
        }
        */

        logger.warn(`Browser: Ref ${selector} is stale — element may no longer exist`);
        return null;
    }

    /**
     * Lightweight post-interaction wait — settles the page after a click/type/select
     * without the full SPA poll that waitForStablePage does.
     * Uses DOM settle to catch micro-updates (dropdowns, validation messages).
     */
    private async waitAfterInteraction(maxMs: number = 2000): Promise<void> {
        if (!this._page) return;
        try {
            // Wait for network to settle briefly
            const networkTimeout = Math.min(maxMs, 600);
            await this._page.waitForLoadState('networkidle', { timeout: networkTimeout }).catch(() => {});
            
            // Wait for visual updates to finish (150ms debounce)
            await this.waitForDomSettle(150, 1500);
        } catch {
            // Best effort
        }
    }

    private async withRetries<T>(
        operationName: string,
        fn: (attempt: number) => Promise<T>,
        options: { attempts?: number; baseDelayMs?: number } = {}
    ): Promise<T> {
        const attempts = Math.max(1, options.attempts ?? 3);
        const baseDelayMs = Math.max(100, options.baseDelayMs ?? 250);
        let lastError: unknown;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await fn(attempt);
            } catch (error) {
                lastError = error;
                if (attempt >= attempts) break;

                const backoff = Math.min(baseDelayMs * attempt, 1200);
                logger.debug(`Browser: ${operationName} attempt ${attempt}/${attempts} failed; retrying in ${backoff}ms: ${error}`);
                if (this.page) {
                    await this.page.waitForLoadState('domcontentloaded', { timeout: backoff }).catch(() => {});
                    await this.page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: backoff }).catch(() => {});
                }
            }
        }

        throw lastError;
    }

    private async captureInteractionDiagnostics(tag: string): Promise<string | undefined> {
        try {
            const debug = await this.saveDebugArtifacts(tag).catch(() => null);
            return debug?.screenshotPath;
        } catch {
            return undefined;
        }
    }

    private async verifyFieldValue(selector: string, expected: string): Promise<boolean> {
        if (!this.page) return false;
        return this.page.evaluate(({ sel, val }) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return false;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                return el.value === val;
            }
            if (el.isContentEditable) {
                return (el.textContent || '').trim() === val;
            }
            return false;
        }, { sel: selector, val: expected }).catch(() => false);
    }

    public async click(selector: string): Promise<string> {
        try {
            await this.ensureBrowser();
            logger.info(`Browser: Click ${selector} (url=${this.lastNavigatedUrl || 'unknown'})`);

            // Resolve ref ID → CSS selector (with re-attachment if SPA re-rendered)
            const finalSelector = await this.resolveSelector(selector);
            if (!finalSelector) {
                return `Error: Ref ${selector} is stale. Run browser_examine_page to get a new ref.`;
            }

            // Check for action loop
            if (this.stateManager.detectActionLoop('click', selector)) {
                const error = `Action loop detected: clicking ${selector} repeatedly.`;
                this.stateManager.recordAction('click', this.lastNavigatedUrl || 'unknown', selector, false, error);
                return `Error: ${error}\n\nSuggestion: Element may not be responding. Try a different selector or approach.`;
            }

            // Check circuit breaker
            if (this.stateManager.isCircuitOpen('click', this.lastNavigatedUrl || '', selector)) {
                const error = `Circuit breaker open for clicking ${selector} (too many recent failures).`;
                this.stateManager.recordAction('click', this.lastNavigatedUrl || 'unknown', selector, false, error);
                return `Error: ${error}\n\nSuggestion: Wait a moment or try a different element.`;
            }

            // Get tuned settings for current domain
            const settings = this.lastNavigatedUrl 
                ? this.tuner?.getBrowserSettingsForDomain(this.lastNavigatedUrl)
                : null;
            const waitAfterClick = settings?.waitAfterClick || 1500;

            // MULTI-STRATEGY CLICK: try progressively more aggressive approaches
            // Strategy 1: Standard Playwright click (waits for actionability — visible, stable, enabled)
            let clicked = false;
            let lastError: any;

            try {
                // Reduced timeout to failover to force-click faster (1.5s instead of 5s)
                await this.page!.click(finalSelector, { timeout: 1500 });
                clicked = true;
            } catch (e1) {
                lastError = e1;
                logger.debug(`Browser: Standard click failed for ${selector}: ${e1}`);

                // Strategy 2: Force click (skip actionability checks — works for overlapping/animated elements)
                try {
                    await this.page!.click(finalSelector, { force: true, timeout: 3000 });
                    clicked = true;
                    logger.debug(`Browser: Force click succeeded for ${selector}`);
                } catch (e2) {
                    lastError = e2;
                    logger.debug(`Browser: Force click failed for ${selector}: ${e2}`);

                    // Strategy 3: JavaScript click (bypasses Playwright entirely — works for custom web components)
                    try {
                        const jsClicked = await this.page!.evaluate((sel: string) => {
                            const el = document.querySelector(sel) as HTMLElement;
                            if (!el) return false;
                            // Scroll into view first
                            el.scrollIntoView({ block: 'center', behavior: 'instant' });
                            el.click();
                            return true;
                        }, finalSelector);

                        if (jsClicked) {
                            clicked = true;
                            logger.debug(`Browser: JS click succeeded for ${selector}`);
                        } else {
                            lastError = new Error('Element not found for JS click');
                        }
                    } catch (e3) {
                        lastError = e3;
                        logger.debug(`Browser: JS click also failed for ${selector}: ${e3}`);
                    }
                }
            }

            if (!clicked) {
                // Learn from failure
                if (this.lastNavigatedUrl && this.tuner && String(lastError).includes('Timeout')) {
                    try {
                        const domain = new URL(this.lastNavigatedUrl).hostname.replace('www.', '');
                        this.tuner.tuneBrowserForDomain(domain, { waitAfterClick: 2000 }, 'Auto-learned: click timed out');
                    } catch {}
                }
                const error = String(lastError);
                this.stateManager.recordAction('click', this.lastNavigatedUrl || 'unknown', selector, false, error);
                
                // Provide actionable fallback suggestions based on failure type
                const suggestions: string[] = [];
                if (error.includes('not visible') || error.includes('outside of the viewport')) {
                    suggestions.push('The element may be off-screen. Try browser_scroll("down") to bring it into view, then browser_examine_page() to get fresh refs.');
                } else if (error.includes('intercept') || error.includes('overlay') || error.includes('pointer')) {
                    suggestions.push('Another element is covering this one (modal, popup, cookie banner). Try closing the overlay first, or use browser_vision to see what is blocking it.');
                } else if (error.includes('detached') || error.includes('not found')) {
                    suggestions.push('The element no longer exists in the DOM (page may have re-rendered). Call browser_examine_page() to get fresh element refs.');
                } else if (error.includes('Timeout')) {
                    suggestions.push('The element exists but is not becoming interactive (may be disabled or loading). Try browser_wait(2000) then retry, or use computer_vision_click to click it by visual position.');
                }
                if (suggestions.length === 0) {
                    suggestions.push('Try browser_examine_page() to get fresh refs, or use browser_vision("describe clickable elements") to see the page visually.');
                }
                return `Failed to click ${selector}: ${lastError}\n\nSuggestions:\n${suggestions.map(s => `• ${s}`).join('\n')}`;
            }

            // Lightweight post-click stabilization (not full SPA poll)
            await this.waitAfterInteraction(waitAfterClick);
            this.lastInteractionTimestamp = Date.now();
            
            this.stateManager.recordAction('click', this.lastNavigatedUrl || 'unknown', selector, true);

            // Return a mini-snapshot of the page state after click so the agent knows what happened
            const url = this.page!.url();
            const title = await this.page!.title().catch(() => '');
            const urlChanged = url !== this.lastNavigatedUrl;
            logger.info(`Browser: Clicked ${selector}${urlChanged ? ` -> ${url}` : ''}`);
            return `Successfully clicked: ${selector}${urlChanged ? `\nPage navigated to: "${title}" (${url})` : ''}`;
        } catch (e) {
            const error = String(e);
            this.stateManager.recordAction('click', this.lastNavigatedUrl || 'unknown', selector, false, error);
            return `Failed to click ${selector}: ${e}`;
        }
    }

    public async type(selector: string, text: string): Promise<string> {
        try {
            await this.ensureBrowser();
            logger.info(`Browser: Type ${selector} (len=${text.length})`);

            // Resolve ref ID → CSS selector (with re-attachment if SPA re-rendered)
            const finalSelector = await this.resolveSelector(selector);
            if (!finalSelector) {
                return `Error: Ref ${selector} is stale. Run browser_examine_page to get a new ref.`;
            }

            // Check for action loop
            if (this.stateManager.detectActionLoop('type', selector)) {
                const error = `Action loop detected: typing in ${selector} repeatedly.`;
                this.stateManager.recordAction('type', this.lastNavigatedUrl || 'unknown', selector, false, error);
                return `Error: ${error}\n\nSuggestion: Element may already be filled or not accepting input.`;
            }

            // Get tuned settings for current domain
            const settings = this.lastNavigatedUrl 
                ? this.tuner?.getBrowserSettingsForDomain(this.lastNavigatedUrl)
                : null;
            const useSlowTyping = settings?.useSlowTyping || false;
            const slowTypingDelay = settings?.slowTypingDelay || 50;

            // MULTI-STRATEGY TYPE: try progressively more approaches
            let typed = false;
            let lastError: any;

            // Strategy 1: Playwright fill() — fast, works on standard inputs/textareas
            if (!useSlowTyping) {
                try {
                    await this.page!.fill(finalSelector, text, { timeout: 5000 });
                    typed = true;
                } catch (e) {
                    lastError = e;
                    logger.debug(`Browser: fill() failed for ${selector}: ${e}`);
                }
            }

            // Strategy 2: Click + keyboard.type() — works for custom inputs, contenteditable
            if (!typed) {
                try {
                    // Try clicking with force to focus the element
                    await this.page!.click(finalSelector, { force: true, timeout: 3000 });
                    // Clear existing content first
                    await this.page!.keyboard.press('Control+a');
                    await this.page!.keyboard.press('Backspace');
                    await this.page!.keyboard.type(text, { delay: slowTypingDelay });
                    typed = true;
                    logger.debug(`Browser: Click+type succeeded for ${selector}`);

                    // Auto-learn: this domain needs slow typing
                    if (this.lastNavigatedUrl && this.tuner) {
                        try {
                            const domain = new URL(this.lastNavigatedUrl).hostname.replace('www.', '');
                            this.tuner.tuneBrowserForDomain(domain, { useSlowTyping: true }, 'Auto-learned: fill() failed');
                        } catch {}
                    }
                } catch (e) {
                    lastError = e;
                    logger.debug(`Browser: Click+type failed for ${selector}: ${e}`);
                }
            }

            // Strategy 3: JS-based focus + input event dispatch — for highly custom components
            if (!typed) {
                try {
                    const jsTyped = await this.page!.evaluate(({ sel, val }: { sel: string; val: string }) => {
                        const el = document.querySelector(sel) as HTMLElement;
                        if (!el) return false;
                        el.scrollIntoView({ block: 'center', behavior: 'instant' });
                        el.focus();
                        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                            el.value = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        } else if (el.isContentEditable) {
                            el.textContent = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                        } else {
                            return false;
                        }
                        return true;
                    }, { sel: finalSelector, val: text });

                    if (jsTyped) {
                        typed = true;
                        logger.debug(`Browser: JS type succeeded for ${selector}`);
                    } else {
                        lastError = new Error('Element not found or not typeable via JS');
                    }
                } catch (e) {
                    lastError = e;
                }
            }

            if (!typed) {
                const error = String(lastError);
                this.stateManager.recordAction('type', this.lastNavigatedUrl || 'unknown', selector, false, error);
                return `Failed to type in ${selector}: ${lastError}`;
            }

            await this.waitAfterInteraction(1000);
            this.lastInteractionTimestamp = Date.now();
            this.stateManager.recordAction('type', this.lastNavigatedUrl || 'unknown', selector, true);
            logger.info(`Browser: Typed ${selector} (len=${text.length})`);
            return `Successfully typed into ${selector}: "${text}"`;
        } catch (e) {
            const error = String(e);
            this.stateManager.recordAction('type', this.lastNavigatedUrl || 'unknown', selector, false, error);
            return `Failed to type in ${selector}: ${e}`;
        }
    }

    public async press(key: string): Promise<string> {
        try {
            await this.ensureBrowser();
            await this.page!.keyboard.press(key);
            return `Successfully pressed key: ${key}`;
        } catch (e) {
            return `Failed to press key ${key}: ${e}`;
        }
    }

    public async goBack(): Promise<string> {
        try {
            await this.ensureBrowser();
            await this.page!.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
            await this.waitAfterInteraction(2000);
            const title = await this.page!.title().catch(() => '');
            const url = this.page!.url();
            this.lastNavigatedUrl = url;
            return `Navigated back to: "${title}" (${url})`;
        } catch (e) {
            return `Failed to go back: ${e}`;
        }
    }

    public async scrollPage(direction: 'up' | 'down', amount?: number): Promise<string> {
        try {
            await this.ensureBrowser();
            const pixels = amount || 600;
            const delta = direction === 'down' ? pixels : -pixels;
            await this.page!.evaluate((d: number) => window.scrollBy(0, d), delta);
            await this.page!.waitForTimeout(300); // Brief settle for lazy-loaded content

            // Return scroll position info
            const info = await this.page!.evaluate(() => {
                const scrollTop = window.scrollY;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = window.innerHeight;
                const atBottom = scrollTop + clientHeight >= scrollHeight - 50;
                const atTop = scrollTop <= 10;
                return { scrollTop: Math.round(scrollTop), scrollHeight, clientHeight, atBottom, atTop };
            }).catch(() => ({ scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: false, atTop: false }));

            return `Scrolled ${direction} ${pixels}px. Position: ${info.scrollTop}/${info.scrollHeight}px${info.atTop ? ' (at top)' : ''}${info.atBottom ? ' (at bottom)' : ''}`;
        } catch (e) {
            return `Failed to scroll ${direction}: ${e}`;
        }
    }

    public async hover(selector: string): Promise<string> {
        try {
            await this.ensureBrowser();
            const finalSelector = await this.resolveSelector(selector);
            if (!finalSelector) {
                return `Error: Ref ${selector} is stale. Run browser_examine_page to get a new ref.`;
            }
            
            try {
                await this.page!.hover(finalSelector, { timeout: 5000 });
            } catch {
                // Fallback: force hover via JS
                await this.page!.evaluate((sel: string) => {
                    const el = document.querySelector(sel) as HTMLElement;
                    if (el) {
                        el.scrollIntoView({ block: 'center', behavior: 'instant' });
                        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    }
                }, finalSelector);
            }
            await this.page!.waitForTimeout(500); // Wait for hover effects/tooltips/menus
            return `Successfully hovered over: ${selector}`;
        } catch (e) {
            return `Failed to hover over ${selector}: ${e}`;
        }
    }

    public async selectOption(selector: string, value: string): Promise<string> {
        try {
            await this.ensureBrowser();
            const finalSelector = await this.resolveSelector(selector);
            if (!finalSelector) {
                return `Error: Ref ${selector} is stale. Run browser_examine_page to get a new ref.`;
            }

            try {
                // Try Playwright's selectOption — works for <select> elements
                const selected = await this.page!.selectOption(finalSelector, { label: value }, { timeout: 5000 })
                    .catch(() => this.page!.selectOption(finalSelector, { value }, { timeout: 3000 }));
                await this.waitAfterInteraction(1000);
                this.lastInteractionTimestamp = Date.now();
                return `Successfully selected "${value}" in ${selector} (values: ${selected.join(', ')})`;
            } catch {
                // Fallback for custom dropdown components: click to open, then find and click the option
                await this.page!.click(finalSelector, { force: true, timeout: 3000 }).catch(() => {});
                await this.page!.waitForTimeout(500);
                
                // Look for the option text in visible elements
                const optionClicked = await this.page!.evaluate((optionText: string) => {
                    const candidates = Array.from(document.querySelectorAll(
                        '[role="option"], [role="listbox"] *, li, .option, [class*="option"], [class*="dropdown"] *'
                    )) as HTMLElement[];
                    for (const el of candidates) {
                        if (el.innerText?.trim().toLowerCase() === optionText.toLowerCase() ||
                            el.textContent?.trim().toLowerCase() === optionText.toLowerCase()) {
                            el.scrollIntoView({ block: 'center' });
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }, value);

                if (optionClicked) {
                    await this.waitAfterInteraction(1000);
                    return `Successfully selected "${value}" in ${selector} (custom dropdown)`;
                }
                return `Failed to select "${value}" in ${selector}: Option not found. Try browser_click on the specific option after opening the dropdown.`;
            }
        } catch (e) {
            return `Failed to select option in ${selector}: ${e}`;
        }
    }

    public async clickText(text: string, selectorHint: string = 'button, a, [role="button"], input[type="button"], input[type="submit"]'): Promise<string> {
        try {
            await this.ensureBrowser();
            logger.info(`Browser: Click text "${text}" (hint=${selectorHint})`);

            const clicked = await this.page!.evaluate(({ txt, sel }) => {
                const elements = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                const target = elements.find(el => 
                    el.innerText?.toLowerCase().includes(txt.toLowerCase()) || 
                    el.textContent?.toLowerCase().includes(txt.toLowerCase()) ||
                    (el as HTMLInputElement).value?.toLowerCase().includes(txt.toLowerCase()) ||
                    el.getAttribute('aria-label')?.toLowerCase().includes(txt.toLowerCase()) ||
                    el.getAttribute('title')?.toLowerCase().includes(txt.toLowerCase())
                );

                if (target) {
                    target.scrollIntoView({ block: 'center' });
                    target.click();
                    return true;
                }
                return false;
            }, { txt: text, sel: selectorHint });

            if (!clicked) {
                // Fallback: try any element if hint failed
                const anyClicked = await this.page!.evaluate(({ txt }) => {
                    // Expanded fallback list
                    const elements = Array.from(document.querySelectorAll('a, button, span, div, p, li, h1, h2, h3, h4, h5, h6')) as HTMLElement[];
                    
                    // Prioritize: 
                    // 1. Exact-ish match (trimmed)
                    // 2. Contains match
                    const target = elements.find(el => {
                        const inner = el.innerText?.trim().toLowerCase() || '';
                        const text = txt.toLowerCase();
                        if (inner === text) return true;
                        if (inner.includes(text) && inner.length < 200) return true;
                        return false;
                    });

                    if (target) {
                        target.scrollIntoView({ block: 'center' });
                        target.click();
                        return true;
                    }
                    return false;
                }, { txt: text });

                if (!anyClicked) return `Error: Could not find any element containing text "${text}".`;
            }

            await this.waitAfterInteraction(1500);
            this.lastInteractionTimestamp = Date.now();
            return `Successfully clicked element with text: "${text}"`;
        } catch (e) {
            return `Failed to click text "${text}": ${e}`;
        }
    }

    public async typeIntoLabel(label: string, text: string): Promise<string> {
        try {
            await this.ensureBrowser();
            logger.info(`Browser: Type into label "${label}" -> "${text}"`);

            const typed = await this.page!.evaluate(({ lbl, val }) => {
                // Try to find input associated with a label
                const labels = Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
                const targetLabel = labels.find(l => l.innerText?.toLowerCase().includes(lbl.toLowerCase()));
                
                let input: HTMLInputElement | null = null;
                if (targetLabel) {
                    if (targetLabel.htmlFor) {
                        input = document.getElementById(targetLabel.htmlFor) as HTMLInputElement;
                    }
                    if (!input) {
                        input = targetLabel.querySelector('input, textarea, select');
                    }
                }

                // If no label found, try placeholders or aria-labels
                if (!input) {
                    const inputs = Array.from(document.querySelectorAll('input, textarea, [role="textbox"]')) as HTMLInputElement[];
                    input = inputs.find(i => 
                        i.placeholder?.toLowerCase().includes(lbl.toLowerCase()) || 
                        i.getAttribute('aria-label')?.toLowerCase().includes(lbl.toLowerCase()) ||
                        i.name?.toLowerCase().includes(lbl.toLowerCase())
                    ) || null;
                }

                if (input) {
                    input.scrollIntoView({ block: 'center' });
                    input.focus();
                    input.value = val;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return false;
            }, { lbl: label, val: text });

            if (!typed) return `Error: Could not find input field associated with label/placeholder "${label}".`;

            await this.waitAfterInteraction(1000);
            this.lastInteractionTimestamp = Date.now();
            return `Successfully typed into field "${label}": "${text}"`;
        } catch (e) {
            return `Failed to type into label "${label}": ${e}`;
        }
    }

    public async screenshot(): Promise<string> {
        try {
            await this.ensureBrowser();

            // Ensure visual stability before snapping
            // Reduced wait times for speed
            await this.page!.waitForLoadState('load', { timeout: 2000 }).catch(() => {});
            await this.page!.waitForTimeout(150); // Minimal paint wait

            const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
            await this.page!.screenshot({ path: screenshotPath, type: 'png' });

            const minBytes = 15000;
            try {
                const size = fs.statSync(screenshotPath).size;
                if (size < minBytes) {
                    logger.warn(`Browser: Screenshot looks blank/small (${size} bytes). Retrying...`);
                    // If still blank and we have a URL, try one more reload
                    if (this.lastNavigatedUrl) {
                        await this.page!.goto(this.lastNavigatedUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
                        await this.waitForStablePage(3000);
                    } else {
                        await this.page!.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
                        await this.page!.waitForTimeout(1200);
                    }
                    await this.page!.screenshot({ path: screenshotPath, type: 'png' });
                    const retrySize = fs.statSync(screenshotPath).size;
                    if (retrySize < minBytes) {
                        return `Screenshot saved to: ${screenshotPath}. (Warning: image appears blank; ${retrySize} bytes)`;
                    }
                }
            } catch {
                // Best effort
            }

            return `Screenshot saved to: ${screenshotPath}. (Verified: Page state is stable)`;
        } catch (e) {
            return `Failed to take screenshot: ${e}`;
        }
    }

    private async saveDebugArtifacts(tag: string, html?: string): Promise<{ screenshotPath?: string; htmlPath?: string } | null> {
        try {
            if (!this.page) return null;
            const debugDir = path.join(os.homedir(), '.orcbot', 'browser-debug');
            if (!fs.existsSync(debugDir)) {
                fs.mkdirSync(debugDir, { recursive: true });
            }
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const base = `${tag}-${stamp}`;
            const screenshotPath = path.join(debugDir, `${base}.png`);
            await this.page.screenshot({ path: screenshotPath, type: 'png' });
            let htmlPath: string | undefined;
            if (html && html.trim().length > 0) {
                htmlPath = path.join(debugDir, `${base}.html`);
                fs.writeFileSync(htmlPath, html, 'utf-8');
            }
            return { screenshotPath, htmlPath };
        } catch (e) {
            logger.warn(`Browser: Failed to save debug artifacts (${tag}): ${e}`);
            return null;
        }
    }

    public async evaluate(script: string): Promise<string> {
        try {
            await this.ensureBrowser();
            const result = await this.page!.evaluate((s) => {
                try {
                    // eslint-disable-next-line no-eval
                    return eval(s);
                } catch (err) {
                    return `Script Error: ${err}`;
                }
            }, script);
            return typeof result === 'object' ? JSON.stringify(result) : String(result);
        } catch (e) {
            return `Failed to evaluate script: ${e}`;
        }
    }

    // ─── API INTERCEPTION ──────────────────────────────────────────────────────

    /**
     * Enable API interception on the current page.
     * Listens for XHR/fetch responses and records their URLs, methods, content types.
     * The agent can later call these endpoints directly via http_fetch.
     */
    public async enableApiInterception(): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this._page) return 'Error: No browser page.';
            if (this._apiInterceptionEnabled) return 'API interception already active.';

            this._interceptedApis = [];
            this._apiInterceptionEnabled = true;

            this._page.on('response', async (response) => {
                try {
                    const request = response.request();
                    const resourceType = request.resourceType();

                    // Only track API-like requests (XHR, fetch), skip images/scripts/stylesheets
                    if (!['xhr', 'fetch'].includes(resourceType)) return;

                    const url = response.url();
                    const method = request.method();
                    const contentType = response.headers()['content-type'] || '';
                    const status = response.status();

                    // Skip tracking errors, redirects, and non-data responses
                    if (status < 200 || status >= 400) return;

                    // Estimate response size from content-length header
                    const contentLength = parseInt(response.headers()['content-length'] || '0', 10);
                    const isJson = contentType.includes('json');
                    let domain = '';
                    try { domain = new URL(url).hostname; } catch {}

                    // Deduplicate: skip if we already have this exact URL+method
                    const exists = this._interceptedApis.some(a => a.url === url && a.method === method);
                    if (exists) return;

                    this._interceptedApis.push({
                        url,
                        method,
                        contentType,
                        status,
                        timestamp: Date.now(),
                        responseSize: contentLength,
                        isJson,
                        domain
                    });

                    // Cap stored entries
                    if (this._interceptedApis.length > this._apiInterceptionMaxEntries) {
                        this._interceptedApis = this._interceptedApis.slice(-this._apiInterceptionMaxEntries);
                    }

                    logger.debug(`API intercepted: ${method} ${url} (${contentType}, ${status})`);
                } catch {
                    // Best effort — don't crash on listener errors
                }
            });

            logger.info('Browser: API interception enabled');
            return 'API interception enabled. Navigate pages normally — discovered API endpoints will be collected automatically.';
        } catch (e) {
            return `Failed to enable API interception: ${e}`;
        }
    }

    /**
     * Get all intercepted API endpoints, optionally filtered by JSON only.
     */
    public getInterceptedApis(jsonOnly: boolean = false): InterceptedApi[] {
        if (jsonOnly) return this._interceptedApis.filter(a => a.isJson);
        return [...this._interceptedApis];
    }

    /**
     * Format intercepted APIs as a readable string for the agent.
     */
    public formatInterceptedApis(jsonOnly: boolean = false): string {
        const apis = this.getInterceptedApis(jsonOnly);
        if (apis.length === 0) {
            return 'No API endpoints intercepted yet. Navigate to a page first.';
        }

        const lines = apis.map((a, i) => {
            const size = a.responseSize > 0 ? ` ${Math.round(a.responseSize / 1024)}KB` : '';
            return `${i + 1}. ${a.method} ${a.url} [${a.status}${a.isJson ? ' JSON' : ''} ${a.contentType.split(';')[0]}${size}]`;
        });

        return `Intercepted API Endpoints (${apis.length}):\n${lines.join('\n')}\n\nTip: Use http_fetch(url, method) to call these endpoints directly — much faster than browser navigation.`;
    }

    public clearInterceptedApis(): void {
        this._interceptedApis = [];
    }

    // ─── CONTENT EXTRACTION ────────────────────────────────────────────────────

    /**
     * Extract readable text content from the current page (readability-style).
     * Strips nav, footer, ads, scripts — returns the main body text.
     * Much lighter than a full semantic snapshot when the agent just needs info.
     */
    public async extractContent(): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this._page) return 'Error: No browser page.';

            const result = await this._page.evaluate(() => {
                // Remove noise elements
                const noiseSelectors = [
                    'script', 'style', 'noscript', 'iframe', 'svg',
                    'nav', 'footer', 'header',
                    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
                    '.cookie-banner', '.cookie-consent', '#cookie-notice',
                    '.ad', '.ads', '.advertisement', '[class*="advert"]',
                    '.sidebar', 'aside',
                    '.popup', '.modal', '.overlay'
                ];

                // Clone body so we don't destroy the real DOM
                const clone = document.body.cloneNode(true) as HTMLElement;
                for (const sel of noiseSelectors) {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                }

                // Try to find the main content area
                const mainSelectors = ['main', 'article', '[role="main"]', '#content', '#main', '.content', '.post', '.article'];
                let contentEl: HTMLElement | null = null;
                for (const sel of mainSelectors) {
                    contentEl = clone.querySelector(sel);
                    if (contentEl && contentEl.innerText.trim().length > 200) break;
                    contentEl = null;
                }

                const source = contentEl || clone;
                const title = document.title || '';
                const url = window.location.href;

                // Extract text with basic structure preservation
                const lines: string[] = [];
                const walk = (node: Node, depth: number = 0) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent?.trim();
                        if (text && text.length > 1) lines.push(text);
                        return;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const el = node as HTMLElement;
                    const tag = el.tagName.toLowerCase();

                    // Add line breaks before block elements
                    if (['p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                        lines.push('');
                    }
                    // Prefix headings
                    if (/^h[1-6]$/.test(tag)) {
                        const level = parseInt(tag[1]);
                        lines.push('#'.repeat(level) + ' ' + el.innerText.trim());
                        return; // Don't walk children of headings
                    }
                    // List items
                    if (tag === 'li') {
                        lines.push('- ' + el.innerText.trim());
                        return;
                    }
                    // Links — include href inline
                    if (tag === 'a') {
                        const href = (el as HTMLAnchorElement).href;
                        const text = el.innerText.trim();
                        if (text && href && !href.startsWith('javascript:')) {
                            lines.push(`[${text}](${href})`);
                        }
                        return;
                    }

                    for (const child of Array.from(node.childNodes)) {
                        walk(child, depth + 1);
                    }
                };

                walk(source);

                // Clean up: remove empty lines, collapse whitespace
                const cleaned = lines
                    .map(l => l.replace(/\s+/g, ' ').trim())
                    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]?.length > 0))
                    .join('\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();

                return { title, url, text: cleaned, length: cleaned.length };
            });

            if (!result || result.length < 20) {
                return 'Error: Could not extract meaningful content from this page.';
            }

            // Truncate very long extractions
            const maxLen = 10000;
            let text = result.text;
            if (text.length > maxLen) {
                text = text.substring(0, maxLen) + `\n\n... [truncated, ${result.length} total chars]`;
            }

            return `PAGE: "${result.title}"\nURL: ${result.url}\nExtracted: ${result.length} chars\n\n${text}`;
        } catch (e) {
            return `Failed to extract content: ${e}`;
        }
    }

    // ─── DATA EXTRACTION ───────────────────────────────────────────────────────

    /**
     * Extract structured data from elements matching a CSS selector.
     * Optionally extract specific attributes. Returns JSON-formatted results.
     */
    public async extractData(
        selector: string,
        options: { attribute?: string; limit?: number; includeHtml?: boolean } = {}
    ): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this._page) return 'Error: No browser page.';

            const { attribute, limit = 50, includeHtml = false } = options;

            const data = await this._page.evaluate(({ sel, attr, lim, html }) => {
                const elements = Array.from(document.querySelectorAll(sel)).slice(0, lim) as HTMLElement[];
                return elements.map((el, i) => {
                    const result: Record<string, any> = { index: i };

                    if (attr) {
                        result.value = el.getAttribute(attr) || '';
                    } else {
                        result.text = el.innerText?.trim().slice(0, 500) || '';
                        result.tag = el.tagName.toLowerCase();

                        // Auto-extract common useful attributes
                        const href = el.getAttribute('href');
                        const src = el.getAttribute('src');
                        const value = (el as HTMLInputElement).value;
                        const name = el.getAttribute('name');
                        const id = el.getAttribute('id');
                        const cls = el.className?.toString().slice(0, 100);

                        if (href) result.href = href;
                        if (src) result.src = src;
                        if (value) result.value = value;
                        if (name) result.name = name;
                        if (id) result.id = id;
                        if (cls) result.class = cls;
                    }

                    if (html) {
                        result.outerHtml = el.outerHTML.slice(0, 1000);
                    }

                    return result;
                });
            }, { sel: selector, attr: attribute, lim: limit, html: includeHtml });

            if (!data || data.length === 0) {
                return `No elements found matching "${selector}".`;
            }

            return `Extracted ${data.length} element(s) matching "${selector}":\n${JSON.stringify(data, null, 2)}`;
        } catch (e) {
            return `Failed to extract data: ${e}`;
        }
    }

    // ─── FORM FILL ─────────────────────────────────────────────────────────────

    /**
     * Batch fill and optionally submit a form.
     * `fields` is an array of { selector, value, action? } where action defaults to 'fill'.
     * Reduces a multi-step click→type→click→type flow to a single call.
     */
    public async fillForm(
        fields: Array<{ selector: string; value: string; action?: 'fill' | 'select' | 'check' | 'click' }>,
        submitSelector?: string
    ): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this._page) return 'Error: No browser page.';

            const results: string[] = [];
            let failCount = 0;

            for (const field of fields) {
                const { value, action = 'fill' } = field;
                const resolvedSelector = await this.resolveSelector(field.selector);
                if (!resolvedSelector) {
                    results.push(`SKIP ${field.selector}: stale ref`);
                    failCount++;
                    continue;
                }

                try {
                    const locator = this._page.locator(resolvedSelector).first();
                    await locator.waitFor({ state: 'attached', timeout: 7000 });

                    switch (action) {
                        case 'fill': {
                            await this.withRetries(`fill(${field.selector})`, async (attempt) => {
                                await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                                await locator.fill(value, { timeout: 4000 });
                                const verified = await this.verifyFieldValue(resolvedSelector, value);
                                if (!verified) {
                                    await locator.click({ timeout: 3000, force: attempt > 1 });
                                    await this._page!.keyboard.press('Control+a');
                                    await this._page!.keyboard.press('Backspace');
                                    await this._page!.keyboard.type(value, { delay: 20 });
                                }

                                const finalVerified = await this.verifyFieldValue(resolvedSelector, value);
                                if (!finalVerified) {
                                    throw new Error('Value verification failed after typing.');
                                }
                            }, { attempts: 3, baseDelayMs: 350 });
                            results.push(`OK fill "${field.selector}" = "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`);
                            break;
                        }

                        case 'select': {
                            await this.withRetries(`select(${field.selector})`, async () => {
                                await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                                const selected = await this._page!.selectOption(resolvedSelector, { label: value }, { timeout: 4000 })
                                    .catch(() => this._page!.selectOption(resolvedSelector, { value }, { timeout: 3000 }));
                                if (!selected || selected.length === 0) throw new Error('No select value was applied.');
                            }, { attempts: 2, baseDelayMs: 300 });
                            results.push(`OK select "${field.selector}" = "${value}"`);
                            break;
                        }

                        case 'check': {
                            const isChecked = await locator.isChecked();
                            const wantChecked = value.toLowerCase() !== 'false' && value !== '0';
                            if (isChecked !== wantChecked) {
                                await this.withRetries(`check(${field.selector})`, async () => {
                                    await locator.click({ force: true, timeout: 3500 });
                                    const nowChecked = await locator.isChecked();
                                    if (nowChecked !== wantChecked) throw new Error('Checkbox state did not change as expected.');
                                }, { attempts: 2, baseDelayMs: 250 });
                            }
                            results.push(`OK check "${field.selector}" = ${wantChecked}`);
                            break;
                        }

                        case 'click': {
                            await this.withRetries(`click(${field.selector})`, async (attempt) => {
                                await locator.click({ timeout: 4500, force: attempt > 1 });
                            }, { attempts: 2, baseDelayMs: 300 });
                            results.push(`OK click "${field.selector}"`);
                            break;
                        }
                    }
                } catch (e) {
                    const screenshotPath = await this.captureInteractionDiagnostics(`fillform-${action}-failure`);
                    const screenshotNote = screenshotPath ? ` [diag: ${screenshotPath}]` : '';
                    results.push(`FAIL ${action} "${field.selector}": ${String(e).slice(0, 120)}${screenshotNote}`);
                    failCount++;
                }
            }

            // Submit if requested
            if (submitSelector) {
                const resolvedSubmit = await this.resolveSelector(submitSelector);
                if (resolvedSubmit) {
                    try {
                        const beforeUrl = this._page.url();
                        await this.withRetries(`submit(${submitSelector})`, async (attempt) => {
                            const submitLocator = this._page!.locator(resolvedSubmit).first();
                            await submitLocator.waitFor({ state: 'visible', timeout: 7000 });
                            await submitLocator.click({ timeout: 6000, force: attempt > 1 });
                        }, { attempts: 2, baseDelayMs: 400 });

                        await Promise.race([
                            this._page.waitForURL(url => url.toString() !== beforeUrl, { timeout: 8000 }).catch(() => null),
                            this._page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => null),
                            this._page.waitForSelector('[role="alert"], .error, .success, .notification, [aria-invalid="true"]', { timeout: 8000 }).catch(() => null)
                        ]);

                        await this.waitAfterInteraction(3000);
                        const title = await this._page.title().catch(() => '');
                        const url = this._page.url();
                        const changed = beforeUrl !== url;
                        results.push(`OK submit "${submitSelector}" → "${title}" (${url})${changed ? ' [url changed]' : ''}`);
                    } catch (e) {
                        const screenshotPath = await this.captureInteractionDiagnostics('fillform-submit-failure');
                        const screenshotNote = screenshotPath ? ` [diag: ${screenshotPath}]` : '';
                        results.push(`FAIL submit "${submitSelector}": ${e}${screenshotNote}`);
                        failCount++;
                    }
                } else {
                    results.push(`SKIP submit "${submitSelector}": stale ref`);
                    failCount++;
                }
            }

            const summary = failCount === 0
                ? `Form filled successfully (${fields.length} fields${submitSelector ? ' + submit' : ''}).`
                : `Form partially filled (${fields.length - failCount}/${fields.length} fields OK, ${failCount} failed).`;

            return `${summary}\n\nDetails:\n${results.join('\n')}`;
        } catch (e) {
            return `Failed to fill form: ${e}`;
        }
    }

    public async startTrace(): Promise<string> {
        this.traceEnabled = true;
        await this.ensureBrowser();
        await this.ensureTracing();
        if (this.traceActive && this.tracePath) {
            return `Browser trace started. Output: ${this.tracePath}`;
        }
        return 'Browser trace start failed or tracing already active.';
    }

    public async stopTrace(): Promise<string> {
        await this.stopTracing();
        if (this.tracePath) {
            return `Browser trace saved: ${this.tracePath}`;
        }
        return 'Browser trace stopped.';
    }

    public async close() {
        await this.stopTracing();
        if (this.browserEngine === 'lightpanda' && this.browser) {
            // For Lightpanda, just disconnect - don't close the server
            try {
                await this.browser.close();
            } catch (e) {
                // Ignore disconnect errors
            }
            this.browser = null;
            this.context = null;
            this._page = null;
            return;
        }

        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this._page = null;
    }

    public getBrowserEngine(): BrowserEngine {
        return this.browserEngine;
    }

    public async switchProfile(profileName: string, profileDir?: string): Promise<string> {
        if (!profileName) return 'Error: Missing profileName.';

        this.profileName = profileName;
        if (profileDir) this.profileDir = profileDir;

        await this.close();
        await this.ensureBrowser();

        return `Browser profile switched to ${this.profileName}`;
    }

    public async search(query: string): Promise<string> {
        const normalized = query.trim().toLowerCase();
        const cached = this.searchCache.get(normalized);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
            return cached.result;
        }

        // Check if any API keys are configured
        const hasApiKeys = !!(this.serperApiKey || this.braveSearchApiKey || this.searxngUrl);
        
        // Smart provider ordering: prioritize browser-based if no API keys
        let providers = this.searchProviderOrder.length > 0
            ? this.searchProviderOrder
            : hasApiKeys 
                ? ['serper', 'brave', 'searxng', 'duckduckgo', 'bing', 'google']  // API-first when available
                : ['duckduckgo', 'bing', 'google'];  // Browser-only when no APIs
        
        if (!hasApiKeys) {
            logger.info('No search API keys configured. Using browser-based search providers.');
        }

        for (const provider of providers) {
            let result = '';
            if (provider === 'serper' && this.serperApiKey) {
                result = await this.searchSerper(query);
                if (!result.includes('Error')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('Serper API failed, falling back to next provider.');
                continue;
            }

            if (provider === 'brave' && this.braveSearchApiKey) {
                result = await this.searchBrave(query);
                if (!result.includes('Error')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('Brave Search API failed, falling back to next provider.');
                continue;
            }

            if (provider === 'searxng' && this.searxngUrl) {
                result = await this.searchSearxng(query);
                if (!result.includes('Error')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('SearxNG failed, falling back to next provider.');
                continue;
            }

            if (provider === 'google') {
                result = await this.searchGoogle(query);
                if (!result.includes('CAPTCHA') && !result.includes('Error: No results')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('Google search blocked or empty, trying next provider...');
                continue;
            }

            if (provider === 'bing') {
                result = await this.searchBing(query);
                if (!result.includes('Error: No results')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('Bing failed, trying next provider...');
                continue;
            }

            if (provider === 'duckduckgo') {
                result = await this.searchDuckDuckGo(query);
                if (!result.includes('Error: No results')) {
                    this.searchCache.set(normalized, { ts: Date.now(), result });
                    return result;
                }
                logger.warn('DuckDuckGo failed, no results.');
                continue;
            }
        }

        return 'Error: All search providers failed.';
    }

    private async searchBrave(query: string): Promise<string> {
        try {
            const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.braveSearchApiKey as string
                }
            });

            if (!response.ok) return `Brave Search Error: ${response.status}`;
            const data = await response.json() as any;
            const results = (data?.web?.results || []).slice(0, 5).map((r: any) =>
                `[${r.title}](${r.url})\n${r.description || ''}`
            ).join('\n\n');

            return results.length > 0 ? `Search Results (via Brave):\n\n${results}` : 'Error: No results from Brave.';
        } catch (e) {
            return `Brave Search Error: ${e}`;
        }
    }

    private async searchSearxng(query: string): Promise<string> {
        try {
            const baseUrl = this.searxngUrl?.replace(/\/$/, '');
            const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
            const response = await fetch(url);
            if (!response.ok) return `SearxNG Error: ${response.status}`;
            const data = await response.json() as any;
            const results = (data?.results || []).slice(0, 5).map((r: any) =>
                `[${r.title}](${r.url})\n${r.content || ''}`
            ).join('\n\n');
            return results.length > 0 ? `Search Results (via SearxNG):\n\n${results}` : 'Error: No results from SearxNG.';
        } catch (e) {
            return `SearxNG Error: ${e}`;
        }
    }

    private async searchSerper(query: string): Promise<string> {
        try {
            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': this.serperApiKey!,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ q: query })
            });
            const data = await response.json() as any;
            if (data.organic) {
                const results = data.organic.slice(0, 5).map((r: any) =>
                    `[${r.title}](${r.link})\n${r.snippet}`
                ).join('\n\n');
                return `Search Results (via Serper):\n\n${results}`;
            }
            return 'Error: No results from Serper.';
        } catch (e) {
            return `Serper Error: ${e}`;
        }
    }

    /**
     * Create an isolated page for search operations so we don't clobber the user's
     * current browsing context. Returns the page and a cleanup function.
     */
    private async createSearchPage(): Promise<{ page: Page; cleanup: () => Promise<void> }> {
        await this.ensureBrowser();
        if (!this.context) throw new Error('No browser context');
        
        const searchPage = await this.context.newPage();
        
        // Block heavy resources on search pages for speed
        await searchPage.route('**/*', route => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font'].includes(type)) {
                return route.abort();
            }
            const url = route.request().url();
            if (url.includes('google-analytics') || url.includes('doubleclick') || url.includes('facebook.com/tr')) {
                return route.abort();
            }
            route.continue();
        });

        return {
            page: searchPage,
            cleanup: async () => {
                try { await searchPage.close(); } catch {}
            }
        };
    }

    private async searchGoogle(query: string): Promise<string> {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        let searchCtx: { page: Page; cleanup: () => Promise<void> } | null = null;
        try {
            searchCtx = await this.createSearchPage();
            const searchPage = searchCtx.page;
            
            await searchPage.goto(url, { waitUntil: 'load', timeout: 45000 });
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

            const content = await searchPage.content();
            if (content.includes('recaptcha') || content.includes('unusual traffic')) {
                return 'Error: Blocked by Google CAPTCHA';
            }

            // Try multiple selector strategies for resilience
            const results = await searchPage.evaluate(() => {
                // Strategy 1: Modern Google selectors
                let items = Array.from(document.querySelectorAll('div.g'));
                
                // Strategy 2: Alternative container selectors
                if (items.length === 0) {
                    items = Array.from(document.querySelectorAll('[data-hveid] [data-ved]')).filter(el => 
                        el.querySelector('a[href^="http"]') && el.querySelector('h3')
                    );
                }
                
                // Strategy 3: Any element with h3 + link structure
                if (items.length === 0) {
                    items = Array.from(document.querySelectorAll('div')).filter(el => {
                        const h3 = el.querySelector('h3');
                        const link = el.querySelector('a[href^="http"]');
                        return h3 && link && !el.closest('[role="navigation"]');
                    });
                }

                return items.slice(0, 5).map(item => {
                    const h3 = item.querySelector('h3');
                    const title = h3?.textContent || h3?.innerText || '';
                    const linkEl = item.querySelector('a[href^="http"]') as HTMLAnchorElement;
                    const link = linkEl?.href || '';
                    
                    // Try multiple snippet selectors
                    const snippetEl = item.querySelector('div.VwiC3b') 
                        || item.querySelector('div.kb0Bss')
                        || item.querySelector('[data-sncf]')
                        || item.querySelector('div > div > div:nth-child(2)');
                    const snippet = (snippetEl as HTMLElement)?.innerText || '';
                    
                    return title && link ? { title, link, snippet } : null;
                }).filter(Boolean);
            });

            if (!results || results.length === 0) return 'Error: No results found on Google.';

            const formatted = results.map((r: any) => `[${r.title}](${r.link})\n${r.snippet}`).join('\n\n');
            return `Search Results (via Google):\n\n${formatted}`;
        } catch (e) {
            return `Google Search Error: ${e}`;
        } finally {
            if (searchCtx) await searchCtx.cleanup();
        }
    }

    private async searchBing(query: string): Promise<string> {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        let searchCtx: { page: Page; cleanup: () => Promise<void> } | null = null;
        try {
            searchCtx = await this.createSearchPage();
            const searchPage = searchCtx.page;
            
            await searchPage.goto(url, { waitUntil: 'load', timeout: 45000 });
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

            const results = await searchPage.evaluate(() => {
                // Strategy 1: Standard Bing selectors
                let items = Array.from(document.querySelectorAll('li.b_algo'));
                
                // Strategy 2: Alternative container
                if (items.length === 0) {
                    items = Array.from(document.querySelectorAll('.b_results > li')).filter(el => 
                        el.querySelector('h2') && el.querySelector('a[href^="http"]')
                    );
                }
                
                // Strategy 3: Any list item with link structure
                if (items.length === 0) {
                    items = Array.from(document.querySelectorAll('li')).filter(el => {
                        const hasTitle = el.querySelector('h2 a') || el.querySelector('a h2');
                        return hasTitle && !el.closest('nav');
                    });
                }

                return items.slice(0, 5).map(item => {
                    const titleLink = item.querySelector('h2 a') as HTMLAnchorElement 
                        || item.querySelector('a h2')?.closest('a') as HTMLAnchorElement;
                    const title = titleLink?.textContent || '';
                    const link = titleLink?.href || '';
                    
                    const snippetEl = item.querySelector('div.b_caption p') 
                        || item.querySelector('.b_caption')
                        || item.querySelector('p');
                    const snippet = (snippetEl as HTMLElement)?.innerText || '';
                    
                    return title && link ? { title, link, snippet } : null;
                }).filter(Boolean);
            });

            if (!results || results.length === 0) return 'Error: No results found on Bing.';

            const formatted = results.map((r: any) => `[${r.title}](${r.link})\n${r.snippet}`).join('\n\n');
            return `Search Results (via Bing):\n\n${formatted}`;
        } catch (e) {
            return `Bing Search Error: ${e}`;
        } finally {
            if (searchCtx) await searchCtx.cleanup();
        }
    }

    private async searchDuckDuckGo(query: string): Promise<string> {
        // Try HTML version first (more reliable), then JS version as fallback
        const urls = [
            `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
            `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
        ];
        
        let searchCtx: { page: Page; cleanup: () => Promise<void> } | null = null;
        try {
            searchCtx = await this.createSearchPage();
            const searchPage = searchCtx.page;

            for (const url of urls) {
                try {
                    await searchPage.goto(url, { waitUntil: 'load', timeout: 45000 });
                    await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

                    const results = await searchPage.evaluate(() => {
                        // Strategy 1: HTML version selectors
                        let items = Array.from(document.querySelectorAll('.result, .result__body'));
                        
                        // Strategy 2: Lite version selectors
                        if (items.length === 0) {
                            items = Array.from(document.querySelectorAll('tr')).filter(el => 
                                el.querySelector('a.result-link') || el.querySelector('a[href^="http"]')
                            );
                        }
                        
                        // Strategy 3: Generic link-based extraction
                        if (items.length === 0) {
                            const links = Array.from(document.querySelectorAll('a[href^="http"]')).filter(a => {
                                const href = (a as HTMLAnchorElement).href;
                                return !href.includes('duckduckgo.com') && 
                                       !href.includes('duck.co') &&
                                       a.textContent && a.textContent.length > 10;
                            });
                            return links.slice(0, 5).map(a => ({
                                title: a.textContent?.trim() || '',
                                link: (a as HTMLAnchorElement).href,
                                snippet: ''
                            })).filter(r => r.title && r.link);
                        }

                        return items.slice(0, 5).map(item => {
                            // HTML version extraction
                            const titleEl = item.querySelector('.result__title a, .result__a, a.result-link') as HTMLAnchorElement;
                            if (titleEl) {
                                return {
                                    title: titleEl.innerText || titleEl.textContent || '',
                                    link: titleEl.href,
                                    snippet: (item.querySelector('.result__snippet, .result__body') as HTMLElement)?.innerText || ''
                                };
                            }
                            
                            // Lite version extraction
                            const liteLink = item.querySelector('a[href^="http"]') as HTMLAnchorElement;
                            if (liteLink) {
                                return {
                                    title: liteLink.textContent?.trim() || '',
                                    link: liteLink.href,
                                snippet: ''
                            };
                        }
                        
                        return null;
                    }).filter(Boolean);
                });

                    if (results && results.length > 0) {
                        const formatted = results.map((r: any) => `[${r.title}](${r.link})\n${r.snippet}`).join('\n\n');
                        return `Search Results (via DuckDuckGo):\n\n${formatted}`;
                    }
                } catch (e) {
                    logger.debug(`DuckDuckGo search failed for ${url}: ${e}`);
                    continue;
                }
            }

            return 'Error: No results found on DuckDuckGo.';
        } catch (e) {
            return `DuckDuckGo Search Error: ${e}`;
        } finally {
            if (searchCtx) await searchCtx.cleanup();
        }
    }

    /**
     * Get browser state summary for agent context
     */
    public getStateSummary(): string {
        return this.stateManager.getStateSummary();
    }

    /**
     * Get browser diagnostics for debugging
     */
    public getDiagnostics(): any {
        return this.stateManager.getDiagnostics();
    }

    /**
     * Reset browser state tracking (useful after completing a task)
     */
    public resetState(): void {
        this.stateManager.reset();
        this._blankUrlHistory.clear();
        this._resourceBlockingEnabled = true;
        logger.info('Browser state reset');
    }

    /**
     * Reset blank page tracking for a specific domain or all domains.
     * Allows retrying sites that were previously flagged as blank.
     */
    public resetBlankHistory(domain?: string): void {
        if (domain) {
            this._blankUrlHistory.delete(domain);
            this._blankUrlHistory.delete(domain.replace('www.', ''));
            logger.info(`Browser: Reset blank history for ${domain}`);
        } else {
            this._blankUrlHistory.clear();
            logger.info('Browser: Reset all blank history');
        }
        this._resourceBlockingEnabled = true;
    }
}
