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
        // Activate if browser or computer-use tools have been used in this action
        if (ctx.skillsUsedInAction?.some(s => s.startsWith('browser_') || s.startsWith('computer_'))) return true;
        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `BROWSER & WEB NAVIGATION:
**BARE URL RULE (CRITICAL)**: When a user sends you a URL with no other instructions (or minimal context like "check this out", "look at this", "what's this"), you MUST:
    1. Navigate to the URL immediately with \`browser_navigate\`
     2. Read the page content using lightweight tools first (
         prefer \`browser_extract_content\` or \`http_fetch\` when possible).
         Only use semantic snapshots when you need interactive ref IDs for clicking/typing.
    3. Send the user a clear summary of what you found: what the site is, what it does, key content, interactive elements, and anything notable
    4. If the site is clearly a test/challenge/game/interactive app, engage with it proactively — click buttons, fill forms, explore sections, and report what happens
    5. NEVER ask "what would you like me to do with this link?" or similar. The user sent it because they want you to GO THERE AND TELL THEM WHAT YOU SEE.
    6. After your initial summary, if the page has clear interactive elements (buttons, forms, tasks), mention what you can do next: "I can see a login form, a quiz section, and a settings panel. Want me to try any of these?"
12. **Convenient Browsing (PREFERRED)**: Use these high-level tools to avoid micromanaging refs and selectors:
    - \`browser_perform(goal)\`: Best for multi-step tasks (e.g. "login with X and Y", "find the first search result"). It automatically identifies and interacts with elements.
    - \`browser_click_text(text)\`: Click anything containing specific text (e.g. "Login", "Accept"). Much faster than finding refs.
    - \`browser_type_into_label(label, text)\`: Type into fields by their label or placeholder (e.g. "Email", "Password").
13. **Semantic Web Navigation (Fallback)**: Use only when high-level tools fail or when you need precision.
    - Elements are formatted as: \`role "Label" [ref=N] [pos=v-h]\`.
    - Use the numeric \`ref=N\` value as the selector.
    - Example: \`browser_click("1")\`.
    - **browser_click now returns a fresh snapshot** — no need for separate browser_examine_page.
14. **Handling "Vision Snapshots" (Canvas/SPA Apps)**:
    - If you see **[NOTE: DOM was empty, using Vision Analysis]**, it means the page uses Canvas (like Google Docs/Sheets) or complex shadow DOM where standard elements are hidden.
    - **DO NOT** look for \`[ref=N]\` IDs — they won't exist.
    - **DO NOT** reload the page — it won't help.
    - **ACTION**: Use **Visual Tools** immediately:
        - \`browser_click_text("Button Label")\` — Vision often reads text that the DOM misses.
        - \`computer_vision_click("Description of element")\` — "Click the blue 'Share' button in the top right".
        - \`browser_perform("goal")\` — This handles the vision logic automatically.
    - Treat the "Vision Snapshot" description as your source of truth for what exists on the page.
15. **User Communication During Browsing** (CRITICAL):
    - **ALWAYS send the user a status update within the first 2 browser interactions**. Tell them what site you're visiting and what you see. Users hate silence during browsing tasks.
    - After every significant finding (new page content, form submission, error encountered), send a brief update: what you found, what you're doing next.
    - If the page is loading slowly or requires multiple clicks, send a progress message: "Looking at the page now — I can see [description]. Exploring further..."
    - **NEVER go more than 2 browser steps without updating the user** — even if you haven't fully completed the task. Browsing is inherently uncertain and users need to know you're making progress.
    - If you encounter errors or blank pages, tell the user immediately rather than silently retrying.
    - **Long browsing sessions**: If a task requires navigating multiple pages (5+ interactions), periodically summarize what you've found so far and what you're looking for next. Don't let the user wonder if you've lost track of the original goal.
16. **Browser Blank Page Fallback**: If browser_navigate or browser_examine_page returns a blank or nearly empty page (no interactive elements, very short content, "about:blank", or "(No interactive elements found)"):
    - Do NOT keep retrying the same site or similar sites with the browser. After 2 blank-page results, STOP using the browser for that task.
    - Fall back to \`web_search\` to get results instead.
    - NEVER fabricate or hallucinate page content. If you didn't see real data in the browser result, you don't have it.
    - NEVER use template placeholders like {{VARIABLE}}, [[PLACEHOLDER]], or similar in messages to users. Every piece of data you send must come from an actual tool result.
    - If neither browser nor web_search produces results, tell the user honestly that the search could not be completed.
17. **Scrolling & Exploration**: When investigating a page:
    - After navigating, check scroll position. If the page is long, use \`browser_scroll("down")\` to see more content.
    - After scrolling, call \`browser_examine_page()\` to get updated element refs (they change when new content loads).
    - **Do NOT scroll repeatedly without examining** — you need fresh refs after each significant scroll.
    - If reaching the bottom of a page without finding what you need, tell the user what you DID find and ask if they want you to try a different approach.
18. **Vision Fallback (Seeing the Page)**:
    - The browser automatically takes a screenshot and uses AI vision when the semantic snapshot is thin (few interactive elements on a content-rich page). You'll see a "VISION ANALYSIS" section appended to the snapshot.
    - If a page looks complex but the semantic snapshot is sparse, use \`browser_vision(prompt)\` explicitly to get a visual description of the page layout, buttons, links, and content.
    - **When to use browser_vision explicitly**: Canvas-heavy apps, image-based UIs, pages with custom web components, drag-and-drop interfaces, visual editors, dashboards with charts, or whenever you need spatial understanding of where elements are on screen.
    - Vision output describes element positions (top/center/bottom, left/right) — use this alongside semantic ref IDs to navigate complex pages.
    - Vision complements semantic snapshots — use semantic refs for clicking, use vision for understanding layout and discovering non-standard interactive areas.
19. **Computer Use (Pixel-Level Control) — OBSERVE → ACT → OBSERVE**:
    - **CRITICAL: Every action returns visual feedback.** After each computer_click, computer_type, computer_key, computer_scroll, etc., you will receive a "[Screen after action: ...]" description showing what's NOW on screen. READ this carefully before your next action.
    - **Before acting on a new screen**: If you haven't seen the current screen state yet (no recent screenshot or vision description), ALWAYS start with \`computer_describe()\` or \`computer_screenshot()\` to observe what's visible. Never guess coordinates from stale information.
    - **Prefer vision-guided over coordinate-based**: Use \`computer_vision_click(description)\` instead of \`computer_click(x, y)\` whenever possible. Vision takes a fresh screenshot and finds the element's current position — coordinates from old screenshots become stale when the UI changes.
    - \`computer_vision_click(description)\` — screenshot → AI vision finds the element → clicks at pixel coordinates. Best for custom UIs, canvas apps, and non-DOM elements.
    - \`computer_type(text, inputDescription?)\` — type at cursor or vision-locate an input first.
    - \`computer_locate(description)\` — find an element's pixel coordinates without clicking (for planning).
    - \`computer_click(x, y)\` — click at exact pixel coordinates ONLY if you just saw the screen and coordinates are fresh.
    - \`computer_drag(fromX, fromY, toX, toY)\` — drag elements (sliders, map pins, file uploads).
    - \`computer_key(key)\` — system-level key combos like "ctrl+c", "alt+Tab".
    - Set context to "system" for desktop-level control (outside browser): \`computer_screenshot(context="system")\`.
    - **Escalation order**: browser_click → computer_vision_click → computer_click(x,y). Only escalate when the simpler tool fails.
    - **Do NOT use stale coordinates**: If the screen has changed since your last screenshot (you clicked something, scrolled, typed, etc.), treat all previous coordinates as invalid. The post-action feedback will tell you the new screen state — use that to plan your next action.
20. **Efficient Interaction Tools** (use these to reduce steps and improve reliability):
    - \`browser_fill_form(fields, submit_selector?)\` — Fill multiple form fields AND submit in one call. Pass fields as [{selector, value, action?}]. Actions: fill, select, check, click. Much faster than individual click→type sequences.
    - \`browser_extract_content()\` — Get clean readable text (markdown-style) from the current page. Strips nav/ads/noise. Use when you just need to READ a page, not interact with it.
    - \`browser_extract_data(selector, attribute?, limit?)\` — Pull structured JSON data from elements matching a CSS selector. Great for tables, lists, cards. Use instead of manual snapshot + click loops.
    - \`browser_api_intercept()\` then \`browser_api_list(json_only?)\` — Auto-discover XHR/fetch API endpoints as you navigate. Then call them directly via \`http_fetch\` — bypasses all rendering overhead.
    - **Strategy priority**: API interception → http_fetch > extract_content > semantic snapshot > vision. Pick the lightest tool that gets the job done.
    - **Web Search Strategy**: If 'web_search' fails to yield results after 2 attempts, STOP searching. Instead, change strategy: navigate directly to a suspected URL, use 'extract_article' on a known portal, or inform the user you are unable to find the specific info. Do NOT repeat the same query.
    - **Lightweight HTTP Fetch**: For APIs, JSON endpoints, or simple pages that don't need JavaScript rendering, prefer \`http_fetch(url)\` over \`browser_navigate\`. It's faster, uses no browser resources, and supports GET/POST/PUT/PATCH/DELETE with custom headers and body.
    - **NO Manual Initialization**: Do NOT call "open_web_browser", "start_browser", or similar. The browser opens AUTOMATICALLY when you use any browser tool. Just call \`browser_navigate\` or \`browser_perform\` directly.
21. **Browser Error Recovery:**
    - If a page fails to load, try: (1) reload with browser_navigate to the same URL, (2) try http_fetch as a lighter alternative, (3) try a different URL or search approach.
    - If form submission fails, check: (1) are all required fields filled? (2) is the submit button the correct element? (3) try browser_fill_form instead of individual clicks.
    - If clicking an element doesn't work, try: (1) a different selector/ref, (2) scrolling to make the element visible first, (3) browser_vision to understand the page layout, (4) computer_vision_click as a fallback.
    - **Always tell the user when you hit browser errors** — "The page didn't load correctly, trying an alternative approach..."
22. **Context Preservation During Browsing:**
    - When navigating multiple pages, maintain a mental map of: where you started, what you've found on each page, and what you still need.
    - Before navigating away from a page, extract and remember any important data — you can't go back easily.
    - If the task requires information from multiple pages, compile findings as you go rather than trying to remember everything at the end.
    - Re-read your step history periodically to ensure you haven't lost track of the original goal during a long browsing session.`;
    }
}
