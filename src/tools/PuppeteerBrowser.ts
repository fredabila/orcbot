import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class PuppeteerBrowser {
    private browser: Browser | null = null;
    private _page: Page | null = null;
    private profileDir?: string;
    private profileName: string;
    private headlessMode: boolean = true;
    private lastNavigatedUrl?: string;

    constructor(
        browserProfileDir?: string,
        browserProfileName?: string
    ) {
        this.profileDir = browserProfileDir;
        this.profileName = browserProfileName || 'default';
    }

    public get page(): Page | null {
        return this._page;
    }

    private async ensureBrowser() {
        if (this.browser && this._page && !this._page.isClosed()) {
            return;
        }

        const profileRoot = this.profileDir || path.join(os.homedir(), '.orcbot', 'puppeteer-profiles');
        const userDataDir = path.join(profileRoot, this.profileName);
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

        this.browser = await puppeteer.launch({
            headless: this.headlessMode,
            userDataDir: userDataDir,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const pages = await this.browser.pages();
        this._page = pages.length > 0 ? pages[0] : await this.browser.newPage();
        
        await this._page.setViewport({ width: 1280, height: 720 });
        await this._page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    }

    public async navigate(url: string): Promise<string> {
        try {
            await this.ensureBrowser();
            console.log(`[Puppeteer] Navigating to ${url}...`);
            await this._page!.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            this.lastNavigatedUrl = url;
            const title = await this._page!.title();
            return `Successfully navigated to ${url}. Page title: "${title}"`;
        } catch (e) {
            return `Failed to navigate to ${url}: ${e}`;
        }
    }

    public async wait(ms: number): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, ms));
        return `Waited for ${ms}ms`;
    }

    public async click(selector: string): Promise<string> {
        try {
            await this.ensureBrowser();
            await this._page!.click(selector);
            return `Successfully clicked element matching "${selector}"`;
        } catch (e) {
            // Try clicking by ref if selector is just a number
            if (/^\d+$/.test(selector)) {
                try {
                    await this._page!.click(`[data-orcbot-ref="${selector}"]`);
                    return `Successfully clicked element with ref=${selector}`;
                } catch (e2) {
                    return `Failed to click element with ref=${selector}: ${e2}`;
                }
            }
            return `Failed to click element matching "${selector}": ${e}`;
        }
    }

    public async type(selector: string, text: string): Promise<string> {
        try {
            await this.ensureBrowser();
            await this._page!.type(selector, text, { delay: 50 });
            return `Successfully typed "${text}" into element matching "${selector}"`;
        } catch (e) {
            if (/^\d+$/.test(selector)) {
                try {
                    await this._page!.type(`[data-orcbot-ref="${selector}"]`, text, { delay: 50 });
                    return `Successfully typed "${text}" into element with ref=${selector}`;
                } catch (e2) {
                    return `Failed to type into element with ref=${selector}: ${e2}`;
                }
            }
            return `Failed to type into element matching "${selector}": ${e}`;
        }
    }

    public async getSemanticSnapshot(): Promise<string> {
        try {
            await this.ensureBrowser();
            
            const result = await this._page!.evaluate(() => {
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
                    
                    if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
                        return false;
                    }
                    return true;
                });

                let refCounter = 1;
                const lines: string[] = [];

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
                        el.getAttribute('alt') ||
                        (el as any).value ||
                        el.innerText.trim().slice(0, 80);

                    if (!label || label.trim().length === 0) {
                        const labelledBy = el.getAttribute('aria-labelledby');
                        if (labelledBy) {
                            const lbEl = document.getElementById(labelledBy);
                            if (lbEl) label = lbEl.innerText.trim();
                        }
                        if (!label && el.id) {
                            const associatedLabel = document.querySelector(`label[for="${el.id}"]`) as HTMLElement;
                            if (associatedLabel) label = associatedLabel.innerText.trim();
                        }
                    }

                    if (!label || label.trim().length === 0) {
                        label = el.id || el.className.toString().split(' ')[0] || '(no label)';
                    }

                    const typeAttr = (el as HTMLInputElement).type ? ` (${(el as HTMLInputElement).type})` : '';
                    lines.push(`${role}${typeAttr} "${label.replace(/\n/g, ' ')}" [ref=${refId}] [pos=${pos}]`);
                });

                const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10);
                headings.forEach(h => {
                    const text = (h as HTMLElement).innerText.trim();
                    if (text) lines.unshift(`heading "${text.slice(0, 100)}"`);
                });

                return lines.join('\n');
            });

            const title = await this._page!.title();
            const url = this._page!.url();
            return `Page: ${title}\nURL: ${url}\n\n${result}`;
        } catch (e) {
            return `Failed to get semantic snapshot: ${e}`;
        }
    }

    public async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this._page = null;
        }
    }
}
