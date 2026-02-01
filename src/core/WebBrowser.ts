import { chromium, Browser, Page } from 'playwright';
import { logger } from '../utils/logger';
import path from 'path';
import os from 'os';

export class WebBrowser {
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor(
        private serperApiKey?: string,
        private captchaApiKey?: string
    ) { }

    private async ensureBrowser() {
        if (!this.browser) {
            // Use --disable-blink-features=AutomationControlled to reduce detection
            this.browser = await chromium.launch({
                headless: true,
                args: ['--disable-blink-features=AutomationControlled']
            });
            const context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                deviceScaleFactor: 1,
            });

            // Sneaky: Remove webdriver property
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            this.page = await context.newPage();
        }
    }

    private async waitForStablePage(timeout = 10000) {
        if (!this.page) return;
        try {
            await Promise.all([
                this.page.waitForLoadState('load', { timeout }),
                this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { }) // Network idle is nice but not critical
            ]);
        } catch (e) {
            logger.warn(`Stable page wait exceeded timeout: ${e}`);
        }
    }

    public async navigate(url: string, waitSelectors: string[] = []): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this.page) throw new Error('Failed to create page');

            await this.page.goto(url, { waitUntil: 'load', timeout: 60000 });
            await this.waitForStablePage();

            for (const selector of waitSelectors) {
                await this.page.waitForSelector(selector, { timeout: 10000 });
            }

            const captcha = await this.detectCaptcha();
            const title = await this.page.title();
            return `Page Loaded: ${title}\nURL: ${url}${captcha ? `\n[WARNING: ${captcha}]` : ''}`;
        } catch (e) {
            logger.error(`Browser Error at ${url}: ${e}`);
            return `Failed to navigate: ${e}`;
        }
    }

    public async detectCaptcha(): Promise<string | null> {
        if (!this.page) return null;

        let retries = 3;
        while (retries > 0) {
            try {
                const content = await this.page.content();
                if (content.includes('g-recaptcha') || content.includes('recaptcha/api.js')) return 'Google reCAPTCHA';
                if (content.includes('h-captcha') || content.includes('hcaptcha.com')) return 'hCaptcha';
                if (content.includes('cf-turnstile') || content.includes('challenges.cloudflare.com')) return 'Cloudflare Turnstile';
                if (content.includes('Please verify you are a human') || content.includes('Verify you are human')) {
                    // Check if there is a simple button/checkbox we can just click
                    const hasButton = await this.page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], input[type="checkbox"]'));
                        return buttons.some(b => b.textContent?.includes('Verify') || b.textContent?.includes('human') || (b as HTMLElement).innerText?.includes('Verify'));
                    });
                    return hasButton ? 'Verification Button/Checkbox' : 'Generic CAPTCHA Page';
                }
                return null;
            } catch (e: any) {
                if (e.message.includes('navigating')) {
                    logger.info(`detectCaptcha: Page is navigating, waiting and retrying... (${retries} left)`);
                    await this.page.waitForTimeout(500);
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

            const snapshot = await this.page!.evaluate(() => {
                const interactiveSelectors = [
                    'a', 'button', 'input', 'select', 'textarea',
                    '[role="button"]', '[role="link"]', '[role="checkbox"]',
                    '[role="menuitem"]', '[role="tab"]', '[onclick]'
                ];

                const elements = Array.from(document.querySelectorAll(interactiveSelectors.join(','))) as HTMLElement[];
                const visibleElements = elements.filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    if (!isVisible) return false;

                    // Simple check if element is actually visible in viewport or at least has content
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

                // Also include headings for context
                const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10);
                headings.forEach(h => {
                    const text = (h as HTMLElement).innerText.trim();
                    if (text) result.unshift(`heading "${text.slice(0, 100)}"`);
                });

                return result.join('\n');
            });

            const title = await this.page!.title();
            return `PAGE: "${title}"\n\nSEMANTIC SNAPSHOT:\n${snapshot || '(No interactive elements found)'}`;
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

            await this.page!.click(finalSelector, { timeout: 15000 });
            return `Successfully clicked: ${selector}`;
        } catch (e) {
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

            await this.page!.fill(finalSelector, text, { timeout: 15000 });
            return `Successfully typed into ${selector}: "${text}"`;
        } catch (e) {
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

    public async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    public async search(query: string): Promise<string> {
        if (this.serperApiKey) {
            const serperResult = await this.searchSerper(query);
            if (!serperResult.includes('Error')) return serperResult;
            logger.warn('Serper API failed, falling back to browser search.');
        }

        // Try Google first
        const googleResult = await this.searchGoogle(query);
        if (!googleResult.includes('CAPTCHA') && googleResult.length > 50) return googleResult;

        // Fallback to Bing
        logger.warn('Google search blocked or empty, trying Bing...');
        const bingResult = await this.searchBing(query);
        if (bingResult.length > 50) return bingResult;

        // Final fallback to DuckDuckGo
        logger.warn('Bing failed, falling back to DuckDuckGo.');
        return this.navigate(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
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

            if (await this.page!.content().then(c => c.includes('recaptcha'))) {
                return 'Error: Blocked by Google CAPTCHA';
            }

            const results = await this.page!.evaluate(() => {
                const items = Array.from(document.querySelectorAll('div.g'));
                return items.slice(0, 5).map(item => {
                    const title = (item.querySelector('h3') as HTMLElement)?.innerText;
                    const link = (item.querySelector('a') as HTMLAnchorElement)?.href;
                    const snippet = (item.querySelector('div.VwiC3b') as HTMLElement)?.innerText || (item.querySelector('div.kb0Bss') as HTMLElement)?.innerText;
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
                const items = Array.from(document.querySelectorAll('li.b_algo'));
                return items.slice(0, 5).map(item => {
                    const title = (item.querySelector('h2 a') as HTMLElement)?.innerText;
                    const link = (item.querySelector('h2 a') as HTMLAnchorElement)?.href;
                    const snippet = (item.querySelector('div.b_caption p') as HTMLElement)?.innerText;
                    return title && link ? { title, link, snippet } : null;
                }).filter(Boolean);
            });

            const formatted = results.map((r: any) => `[${r.title}](${r.link})\n${r.snippet}`).join('\n\n');
            return `Search Results (via Bing):\n\n${formatted}`;
        } catch (e) {
            return `Bing Search Error: ${e}`;
        }
    }
}
