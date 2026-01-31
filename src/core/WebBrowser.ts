import { chromium, Browser, Page } from 'playwright';
import { logger } from '../utils/logger';

export class WebBrowser {
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor(private userDataDir?: string) { }

    private async ensureBrowser() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
            const context = await this.browser.newContext();
            this.page = await context.newPage();
        }
    }

    public async navigate(url: string): Promise<string> {
        try {
            await this.ensureBrowser();
            if (!this.page) throw new Error('Failed to create page');

            await this.page.goto(url, { waitUntil: 'networkidle' });
            const title = await this.page.title();
            // Simple text extraction
            const text = await this.page.evaluate(() => document.body.innerText.substring(0, 2000));
            return `Page Loaded: ${title}\nContent Snippet: ${text}`;
        } catch (e) {
            logger.error(`Browser Error: ${e}`);
            return `Failed to navigate: ${e}`;
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
        // Simple duckduckgo fallback via browser
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        return this.navigate(url);
    }
}
