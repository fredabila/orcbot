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

    private static readonly BROWSER_SIGNALS: RegExp[] = [
        /\bbrowse\b/i, /\bnavigate\b/i, /\bwebsite\b/i, /\bweb page\b/i, /\bwebpage\b/i,
        /\burl\b/i, /\bclick\b/i, /\blogin\b/i, /\bsign in\b/i, /\bsign up\b/i,
        /\bfill form\b/i, /\bsubmit\b/i, /\bopen site\b/i, /\bgo to\b/i, /\bvisit\b/i,
        /\bscrape\b/i, /\bcrawl\b/i, /\bextract\b/i, /\bscreenshot\b/i, /\bdownload from\b/i,
        /\bweb search\b/i, /\bsearch for\b/i, /\bgoogle\b/i, /\blook up\b/i,
        /\bfind online\b/i, /\binternet\b/i, /\bhttp\b/i, /\bbrowser\b/i, /\bsurf\b/i,
        /\baccount\b/i, /\bregister\b/i, /\bcreate account\b/i
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Fast path: keyword match
        if (BrowserHelper.BROWSER_SIGNALS.some(rx => rx.test(task))) return true;
        // URL detection: if the task contains a URL, browser guidance is relevant
        if (/https?:\/\/\S+|www\.\S+|\w+\.(com|org|net|io|dev|app|co)\b/.test(task)) return true;
        // Activate if browser or computer-use tools have been used in this action
        if (ctx.skillsUsedInAction?.some(s => s.startsWith('browser_') || s.startsWith('computer_'))) return true;
        return false;
    }

    getRelatedHelpers(ctx: PromptHelperContext): string[] {
        const related: string[] = [];
        const task = ctx.taskDescription.toLowerCase();
        // Browsing often involves media (images, screenshots)
        if (task.includes('image') || task.includes('screenshot') || task.includes('picture') || task.includes('video')) {
            related.push('media');
        }
        // Browsing often involves research
        if (task.includes('search') || task.includes('find') || task.includes('look up')) {
            related.push('research');
        }
        return related;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `BROWSER & WEB NAVIGATION:
1. **READ FIRST (CRITICAL)**: When you need to gather information from a page, ALWAYS prefer \`browser_extract_content()\` or \`http_fetch(url)\` first. They are 10x faster and more reliable than semantic snapshots. Only use snapshots if you need to interact (click/type).
2. **BARE URL RULE**: When a user sends you a URL, you MUST:
    1. Navigate immediately with \`browser_navigate\` or use \`http_fetch\`.
    2. **NEVER** navigate to the same URL twice in a row. If you are already on the page, proceed to interaction.
    3. **NEVER** use \`write_file\` or \`run_command\` to "draft" web content locally instead of performing the action on the site.
    4. If the task is to "write X here [URL]", you MUST type directly into the site via the browser.
3. **Convenient Browsing (PREFERRED)**: Puppeteer requires active element focus. High-level tools handle this best:
    - \`browser_perform(goal)\`: **STRONGLY PREFERRED** for multi-step tasks (e.g. "type the article into the doc"). It uses advanced focus/caret logic.
    - \`browser_type_into_label(label, text)\`: Best for standard forms.
    - \`browser_click_text(text)\`: Best for navigation.
    - \`browser_run_script(code?, filename?)\`: Use the persistent browser scratchpad for complex DOM workflows, repeatable site-specific automations, and recovery logic that does not fit cleanly into one browser_perform call.
4. **Complex Editors (Canvas, Web IDEs, Rich Text)**: Many modern sites use custom rendering for inputs.
    - **DO NOT** just navigate and wait.
    - You MUST click the main editing area first to trigger the caret and focus.
    - If standard typing fails, \`browser_perform\` will automatically try a JS-injection fallback.
5. **Wait for Success**: If a page looks blank, use \`browser_wait(3000)\` then \`browser_examine_page()\` to refresh your view.
6. **User Communication**: Send a status update every 2 steps. Tell them which site you're on and what you're seeing.
`;
    }
}
