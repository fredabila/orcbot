import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../utils/logger';
import { RuntimeTuner } from '../core/RuntimeTuner';
import path from 'path';
import os from 'os';
import fs from 'fs';

export type BrowserEngine = 'playwright' | 'lightpanda';

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

    public get page(): Page | null {
        return this._page;
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
        lightpandaEndpoint?: string
    ) {
        this.profileDir = browserProfileDir;
        this.profileName = browserProfileName || 'default';
        this.tuner = tuner;
        this.browserEngine = browserEngine || 'playwright';
        this.lightpandaEndpoint = lightpandaEndpoint || 'ws://127.0.0.1:9222';
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

            this.context = await chromium.launchPersistentContext(userDataDir, {
                headless: this.headlessMode,
                args: ['--disable-blink-features=AutomationControlled'],
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                deviceScaleFactor: 1,
            });

            // Sneaky: Remove webdriver property
            await this.context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            this._page = await this.context.newPage();
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

    // Sites known to block headless browsers aggressively
    private shouldUseHeadful(url: string): boolean {
        // First check if tuner has learned this domain needs headful
        if (this.tuner?.shouldForceHeadful(url)) {
            logger.debug(`Browser: Tuner says ${url} requires headful mode`);
            return true;
        }

        const blockedDomains = [
            'youtube.com',
            'google.com/search',
            'linkedin.com',
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

    private async waitForStablePage(timeout = 10000) {
        if (!this._page) return;
        try {
            await Promise.all([
                this._page.waitForLoadState('load', { timeout }),
                this._page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { }) // Network idle is nice but not critical
            ]);
        } catch (e) {
            logger.warn(`Stable page wait exceeded timeout: ${e}`);
        }
    }

    public async navigate(url: string, waitSelectors: string[] = [], allowHeadfulRetry: boolean = true): Promise<string> {
        try {
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

            logger.info(`Browser: Navigating to ${targetUrl}`);
            await this._page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
            await this.waitForStablePage();

            const bodyTextLength = await this._page.evaluate(() => document.body?.innerText?.trim().length ?? 0).catch(() => 0);
            
            // If page appears empty and we're in headless mode, retry headful
            if (bodyTextLength < 100 && this.headlessMode && allowHeadfulRetry) {
                logger.warn(`Browser: Page appears blocked/empty (${bodyTextLength} chars). Retrying in headful mode...`);
                await this.ensureBrowser(false);
                return this.navigate(url, waitSelectors, false);
            }
            
            if (bodyTextLength === 0) {
                await this._page.waitForTimeout(1200);
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

            const captcha = await this.detectCaptcha();
            const title = await this._page.title();
            const content = await this._page.content();
            const looksBlank = (!title || title.trim().length === 0) && content.replace(/\s+/g, '').length < 1200;

            if (looksBlank && this.headlessMode && allowHeadfulRetry) {
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
                if (fallback) return fallback;
            }

            this.recordProfileHistory({ url: targetUrl, title, timestamp: new Date().toISOString() });
            this.lastNavigatedUrl = targetUrl;
            return `Page Loaded: ${title}\nURL: ${url}${captcha ? `\n[WARNING: ${captcha}]` : ''}`;
        } catch (e) {
            const classified = this.classifyNavigateError(e);
            logger.error(`Browser Error at ${url}: ${classified.raw}`);
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
                args: ['--disable-blink-features=AutomationControlled']
            });

            const context = await tempBrowser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                deviceScaleFactor: 1,
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            const page = await context.newPage();
            await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

            for (const selector of waitSelectors) {
                await page.waitForSelector(selector, { timeout: 10000 }).catch(() => { });
            }

            const title = await page.title();
            const content = await page.content();
            const looksBlank = (!title || title.trim().length === 0) && content.replace(/\s+/g, '').length < 1200;
            if (looksBlank) return null;

            return `Page Loaded: ${title}\nURL: ${targetUrl}\n[NOTE: Loaded via stateless context]`;
        } catch (e) {
            logger.warn(`Browser: Stateless context failed: ${e}`);
            return null;
        } finally {
            if (tempBrowser) await tempBrowser.close();
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
            await this.waitForStablePage();

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
                        return true;
                    });

                    let refCounter = 1;
                    const result: string[] = [];

                    visibleElements.forEach(el => {
                        const refId = refCounter++;
                        el.setAttribute('data-orcbot-ref', refId.toString());

                        const role = el.getAttribute('role') || el.tagName.toLowerCase();
                        const label = el.getAttribute('aria-label') ||
                            el.getAttribute('placeholder') ||
                            el.getAttribute('title') ||
                            (el as any).value ||
                            el.innerText.trim().slice(0, 50);

                        const typeAttr = (el as HTMLInputElement).type ? ` (${(el as HTMLInputElement).type})` : '';
                        result.push(`${role}${typeAttr} "${label || '(no label)'}" [ref=${refId}]`);
                    });

                    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10);
                    headings.forEach(h => {
                        const text = (h as HTMLElement).innerText.trim();
                        if (text) result.unshift(`heading "${text.slice(0, 100)}"`);
                    });

                    return result.join('\n');
                });
            };

            let snapshot = await buildSnapshot();
            let title = await this.page!.title();
            let url = await this.page!.url();
            let contentLength = (await this.page!.content()).length;

            // Track blank reload attempts to prevent infinite loops
            const maxBlankReloads = 1;
            let blankReloadAttempts = 0;

            // For SPAs like YouTube, the URL might briefly show about:blank during navigation
            // Only reload if we have no content AND no title AND the URL is blank
            if ((!url || url === 'about:blank') && contentLength < 500 && blankReloadAttempts < maxBlankReloads) {
                const fallbackUrl = this.lastNavigatedUrl;
                if (fallbackUrl) {
                    logger.warn(`Semantic snapshot: blank URL detected (content: ${contentLength} bytes). Attempting single reload.`);
                    blankReloadAttempts++;
                    await this.page!.goto(fallbackUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => { });
                    await this.waitForStablePage();
                    snapshot = await buildSnapshot();
                    title = await this.page!.title();
                    url = await this.page!.url();
                    contentLength = (await this.page!.content()).length;
                }
            }

            // If URL is still blank but we have content, use the lastNavigatedUrl for display
            if ((!url || url === 'about:blank') && this.lastNavigatedUrl) {
                url = `${this.lastNavigatedUrl} (SPA state)`;
            }

            // Only consider it "blank" if we have almost no content AND no snapshot elements
            // SPAs like YouTube may have minimal HTML but rich snapshots
            const hasSnapshotContent = snapshot && snapshot.length > 50;
            const looksBlank = (!title || title.trim().length === 0) && contentLength < 1200 && !hasSnapshotContent;
            
            if (looksBlank && blankReloadAttempts < maxBlankReloads) {
                logger.warn('Semantic snapshot appears blank; attempting a single reload before returning diagnostics.');
                blankReloadAttempts++;
                await this.page!.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
                await this.waitForStablePage();
                snapshot = await buildSnapshot();
                title = await this.page!.title();
                url = await this.page!.url();
                contentLength = (await this.page!.content()).length;
                
                // Update URL display if still blank
                if ((!url || url === 'about:blank') && this.lastNavigatedUrl) {
                    url = `${this.lastNavigatedUrl} (SPA state)`;
                }
            }

            const diagnostics = `URL: ${url}\nHTML length: ${contentLength}`;
            return `PAGE: "${title}"\n${diagnostics}\n\nSEMANTIC SNAPSHOT:\n${snapshot || '(No interactive elements found)'}`;
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

    public async click(selector: string): Promise<string> {
        try {
            await this.ensureBrowser();

            // Handle ref ID
            let finalSelector = selector;
            if (/^\d+$/.test(selector)) {
                finalSelector = `[data-orcbot-ref="${selector}"]`;
            }

            // Get tuned settings for current domain
            const settings = this.lastNavigatedUrl 
                ? this.tuner?.getBrowserSettingsForDomain(this.lastNavigatedUrl)
                : null;
            const clickTimeout = settings?.clickTimeout || 15000;
            const waitAfterClick = settings?.waitAfterClick || 1000;

            // Wait for element to exist first, then click
            await this.page!.waitForSelector(finalSelector, { timeout: 10000, state: 'attached' }).catch(() => {});
            await this.page!.waitForTimeout(300); // Small delay for dynamic elements
            await this.page!.click(finalSelector, { timeout: clickTimeout });
            await this.waitForStablePage(waitAfterClick); // Wait for any navigation/updates after click
            return `Successfully clicked: ${selector}`;
        } catch (e) {
            // Learn from failure - if timeout, increase timeout for next time
            if (this.lastNavigatedUrl && this.tuner && String(e).includes('Timeout')) {
                try {
                    const domain = new URL(this.lastNavigatedUrl).hostname.replace('www.', '');
                    this.tuner.tuneBrowserForDomain(domain, { clickTimeout: 30000, waitAfterClick: 2000 }, 'Auto-learned: click timed out');
                    logger.info(`Browser: Auto-tuned ${domain} with increased click timeout`);
                } catch {}
            }
            return `Failed to click ${selector}: ${e}`;
        }
    }

    public async type(selector: string, text: string): Promise<string> {
        try {
            await this.ensureBrowser();

            // Handle ref ID
            let finalSelector = selector;
            if (/^\d+$/.test(selector)) {
                finalSelector = `[data-orcbot-ref="${selector}"]`;
            }

            // Get tuned settings for current domain
            const settings = this.lastNavigatedUrl 
                ? this.tuner?.getBrowserSettingsForDomain(this.lastNavigatedUrl)
                : null;
            const typeTimeout = settings?.typeTimeout || 15000;
            const useSlowTyping = settings?.useSlowTyping || false;
            const slowTypingDelay = settings?.slowTypingDelay || 50;

            // Wait for element, focus it, then type
            await this.page!.waitForSelector(finalSelector, { timeout: 10000, state: 'attached' }).catch(() => {});
            await this.page!.waitForTimeout(300); // Small delay for dynamic elements
            
            // Try fill first (fast), fall back to typing character by character
            if (useSlowTyping) {
                // Site requires slow typing - skip fill
                await this.page!.click(finalSelector, { timeout: 5000 });
                await this.page!.keyboard.type(text, { delay: slowTypingDelay });
            } else {
                try {
                    await this.page!.fill(finalSelector, text, { timeout: typeTimeout });
                } catch (fillError) {
                    // Fallback: click element and type character by character (for stubborn inputs)
                    await this.page!.click(finalSelector, { timeout: 5000 });
                    await this.page!.keyboard.type(text, { delay: slowTypingDelay });
                    
                    // Auto-learn: this domain needs slow typing
                    if (this.lastNavigatedUrl && this.tuner) {
                        try {
                            const domain = new URL(this.lastNavigatedUrl).hostname.replace('www.', '');
                            this.tuner.tuneBrowserForDomain(domain, { useSlowTyping: true }, 'Auto-learned: fill() failed, slow typing worked');
                            logger.info(`Browser: Auto-tuned ${domain} to use slow typing`);
                        } catch {}
                    }
                }
            }
            return `Successfully typed into ${selector}: "${text}"`;
        } catch (e) {
            // Learn from failure
            if (this.lastNavigatedUrl && this.tuner && String(e).includes('Timeout')) {
                try {
                    const domain = new URL(this.lastNavigatedUrl).hostname.replace('www.', '');
                    // If it timed out, try increasing the timeout for next time
                    this.tuner.tuneBrowserForDomain(domain, { typeTimeout: 30000, useSlowTyping: true }, 'Auto-learned: type timed out');
                    logger.info(`Browser: Auto-tuned ${domain} with increased type timeout`);
                } catch {}
            }
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

    public async screenshot(): Promise<string> {
        try {
            await this.ensureBrowser();

            // Ensure visual stability before snapping
            await this.page!.waitForLoadState('load');
            await this.page!.waitForTimeout(1000); // 1s "paint wait" to avoid white screens

            const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
            await this.page!.screenshot({ path: screenshotPath, type: 'png' });

            return `Screenshot saved to: ${screenshotPath}. (Verified: Page state is stable)`;
        } catch (e) {
            return `Failed to take screenshot: ${e}`;
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

    public async close() {
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
            return `${cached.result}\n\n[cache]`; 
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

    private async searchGoogle(query: string): Promise<string> {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
            await this.ensureBrowser();
            await this.page!.goto(url, { waitUntil: 'load' });
            await this.page!.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

            const content = await this.page!.content();
            if (content.includes('recaptcha') || content.includes('unusual traffic')) {
                return 'Error: Blocked by Google CAPTCHA';
            }

            // Try multiple selector strategies for resilience
            const results = await this.page!.evaluate(() => {
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
        }
    }

    private async searchBing(query: string): Promise<string> {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        try {
            await this.ensureBrowser();
            await this.page!.goto(url, { waitUntil: 'load' });
            await this.page!.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

            const results = await this.page!.evaluate(() => {
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
        }
    }

    private async searchDuckDuckGo(query: string): Promise<string> {
        // Try HTML version first (more reliable), then JS version as fallback
        const urls = [
            `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
            `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
        ];
        
        for (const url of urls) {
            try {
                await this.ensureBrowser();
                await this.page!.goto(url, { waitUntil: 'load' });
                await this.waitForStablePage();

                const results = await this.page!.evaluate(() => {
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
    }
}
