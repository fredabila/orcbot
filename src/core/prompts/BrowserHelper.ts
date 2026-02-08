/**
 * BrowserHelper — Activated for tasks that involve web browsing/navigation.
 * Provides semantic snapshot navigation rules, blank page fallback,
 * web search strategy, and template placeholder guards.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class BrowserHelper implements PromptHelper {
    readonly name = 'browser';
    readonly description = 'Semantic web navigation, blank page fallback, search strategy';
    readonly priority = 30;
    readonly alwaysActive = false;

    private static readonly BROWSER_SIGNALS = [
        'browse', 'navigate', 'website', 'web page', 'webpage', 'url',
        'click', 'login', 'sign in', 'sign up', 'fill form', 'submit',
        'open site', 'go to', 'visit', 'scrape', 'crawl', 'extract',
        'screenshot', 'download from', 'web search', 'search for',
        'google', 'look up', 'find online', 'internet', 'http',
        'browser', 'surf', 'account', 'register', 'create account'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Fast path: keyword match
        if (BrowserHelper.BROWSER_SIGNALS.some(kw => task.includes(kw))) return true;
        // URL detection: if the task contains a URL, browser guidance is relevant
        if (/https?:\/\/\S+|www\.\S+|\w+\.(com|org|net|io|dev|app|co)\b/.test(task)) return true;
        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `BROWSER & WEB NAVIGATION:
12. **Semantic Web Navigation**: When using browser tools, you will receive a "Semantic Snapshot".
    - Elements are formatted as: \`role "Label" [ref=N]\`.
    - You MUST use the numeric \`ref=N\` value as the selector for \`browser_click\` and \`browser_type\`.
    - Example: \`browser_click("1")\` to click a button labeled \`button "Sign In" [ref=1]\`.
    - This is more reliable than CSS selectors.
13. **Browser Blank Page Fallback**: If browser_navigate or browser_examine_page returns a blank or nearly empty page (no interactive elements, very short content, "about:blank", or "(No interactive elements found)"):
    - Do NOT keep retrying the same site or similar sites with the browser. After 2 blank-page results, STOP using the browser for that task.
    - Fall back to \`web_search\` to get results instead.
    - NEVER fabricate or hallucinate page content. If you didn't see real data in the browser result, you don't have it.
    - NEVER use template placeholders like {{VARIABLE}}, [[PLACEHOLDER]], or similar in messages to users. Every piece of data you send must come from an actual tool result.
    - If neither browser nor web_search produces results, tell the user honestly that the search could not be completed.
14. **Vision Fallback (Seeing the Page)**:
    - The browser automatically takes a screenshot and uses AI vision when the semantic snapshot is thin (few interactive elements on a content-rich page). You'll see a "VISION ANALYSIS" section appended to the snapshot.
    - If a page looks complex but the semantic snapshot is sparse, use \`browser_vision(prompt)\` explicitly to get a visual description of the page layout, buttons, links, and content.
    - **When to use browser_vision explicitly**: Canvas-heavy apps, image-based UIs, pages with custom web components, drag-and-drop interfaces, visual editors, dashboards with charts, or whenever you need spatial understanding of where elements are on screen.
    - Vision output describes element positions (top/center/bottom, left/right) — use this alongside semantic ref IDs to navigate complex pages.
    - Vision complements semantic snapshots — use semantic refs for clicking, use vision for understanding layout and discovering non-standard interactive areas.
- **Web Search Strategy**: If 'web_search' fails to yield results after 2 attempts, STOP searching. Instead, change strategy: navigate directly to a suspected URL, use 'extract_article' on a known portal, or inform the user you are unable to find the specific info. Do NOT repeat the same query.
- **Lightweight HTTP Fetch**: For APIs, JSON endpoints, or simple pages that don't need JavaScript rendering, prefer \`http_fetch(url)\` over \`browser_navigate\`. It's faster, uses no browser resources, and supports GET/POST/PUT/PATCH/DELETE with custom headers and body.`;
    }
}
