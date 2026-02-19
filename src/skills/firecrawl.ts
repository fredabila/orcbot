/**
 * firecrawl-cli integration for OrcBot
 *
 * Wraps the `firecrawl` CLI (npm install -g firecrawl-cli) as OrcBot native skills.
 * Install with:
 *   install_skill("firecrawl/cli")           ← uses agentskills.io npm resolution
 *   install_npm_dependency("firecrawl-cli")   ← installs the CLI globally
 *
 * Browser coexistence strategy
 * ─────────────────────────────
 * OrcBot already has Playwright-backed browser tools (browser_navigate, browser_click, etc.).
 * Firecrawl provides a complementary CLOUD browser sandbox — a separate execution environment:
 *
 *   Use OrcBot Playwright (browser_navigate) when:
 *     • Simple pages, static HTML, docs sites
 *     • You need to click/type/interact with DOM elements
 *     • Speed matters and the site is not bot-protected
 *     • No API key required
 *
 *   Use firecrawl_scrape / firecrawl_browser when:
 *     • Pages are bot-protected or require JavaScript rendering
 *     • You need clean markdown/JSON output directly (no snapshot parsing)
 *     • You want cloud execution (no local browser needed)
 *     • You need structured data extraction with AI (firecrawl_agent)
 *
 * Both tools can be used in the same session. Firecrawl does NOT replace Playwright.
 *
 * Requires: FIRECRAWL_API_KEY env var or prior `firecrawl login`
 *           OR a self-hosted instance via FIRECRAWL_API_URL (no key needed)
 */

import { execSync, exec } from 'child_process';
import type { AgentContext } from '../core/SkillsManager';

// ─── Shared CLI runner ────────────────────────────────────────────────────────

interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function runFirecrawl(args: string, timeoutMs = 60000): Promise<RunResult> {
    return new Promise(resolve => {
        exec(`firecrawl ${args}`, { timeout: timeoutMs }, (error, stdout, stderr) => {
            resolve({
                stdout: stdout?.trim() || '',
                stderr: stderr?.trim() || '',
                exitCode: error ? (error.code as number || 1) : 0,
            });
        });
    });
}

function checkFirecrawlInstalled(): boolean {
    try {
        execSync('firecrawl --version', { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

const NOT_INSTALLED_MSG =
    'firecrawl-cli is not installed. Run: install_npm_dependency("firecrawl-cli") ' +
    'then authenticate with: run_command("firecrawl login")';

// ─── Skills ───────────────────────────────────────────────────────────────────

/**
 * Firecrawl Scrape — extract clean content from a URL without a local browser.
 * Returns markdown by default; pass format for html, links, images, json, summary, etc.
 *
 * Best for: bot-protected pages, JS-rendered sites, clean article extraction.
 * Use OrcBot's browser_navigate for pages where you need to click or interact.
 */
export const firecrawl_scrape = {
    name: 'firecrawl_scrape',
    description:
        'Scrape a URL using Firecrawl\'s cloud renderer and return clean content. ' +
        'Handles bot-protection, JavaScript rendering, and returns markdown by default. ' +
        'Use this instead of browser_navigate when the page is JS-heavy or bot-protected.',
    usage: 'firecrawl_scrape(url, format?, options?)',
    handler: async (args: any, _ctx?: AgentContext) => {
        if (!checkFirecrawlInstalled()) return NOT_INSTALLED_MSG;

        const url = args.url || args.source;
        if (!url) return 'Error: Missing url parameter.';

        const format = args.format || 'markdown';
        const extraFlags: string[] = [];

        if (args.only_main_content || args.onlyMainContent) extraFlags.push('--only-main-content');
        if (args.wait_for) extraFlags.push(`--wait-for ${args.wait_for}`);
        if (args.screenshot) extraFlags.push('--screenshot');
        if (args.output) extraFlags.push(`-o "${args.output}"`);

        const flags = `--format ${format} ${extraFlags.join(' ')}`.trim();
        const result = await runFirecrawl(`scrape "${url}" ${flags}`, 90000);

        if (result.exitCode !== 0) {
            return `firecrawl scrape failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`;
        }

        const output = result.stdout;
        // Truncate extremely large outputs so they fit in context
        const MAX_CHARS = 12000;
        if (output.length > MAX_CHARS) {
            return output.slice(0, MAX_CHARS) + `\n\n[... truncated — ${output.length - MAX_CHARS} chars omitted. Pass output=<filepath> to save the full result.]`;
        }
        return output;
    },
};

/**
 * Firecrawl Search — web search that optionally scrapes result content.
 */
export const firecrawl_search = {
    name: 'firecrawl_search',
    description:
        'Search the web using Firecrawl and optionally scrape content from results. ' +
        'Supports time filters, location targeting, and news/image sources.',
    usage: 'firecrawl_search(query, limit?, sources?, scrape?, tbs?)',
    handler: async (args: any, _ctx?: AgentContext) => {
        if (!checkFirecrawlInstalled()) return NOT_INSTALLED_MSG;

        const query = args.query || args.q;
        if (!query) return 'Error: Missing query parameter.';

        const limit = args.limit || 5;
        const sources = args.sources || 'web';
        const extraFlags: string[] = [];

        if (args.scrape) extraFlags.push('--scrape');
        if (args.tbs) extraFlags.push(`--tbs ${args.tbs}`);
        if (args.location) extraFlags.push(`--location "${args.location}"`);
        if (args.categories) extraFlags.push(`--categories ${args.categories}`);
        if (args.json || args.format === 'json') extraFlags.push('--json');

        const flags = `--limit ${limit} --sources ${sources} ${extraFlags.join(' ')}`.trim();
        const result = await runFirecrawl(`search "${query}" ${flags}`, 60000);

        if (result.exitCode !== 0) {
            return `firecrawl search failed:\n${result.stderr || result.stdout}`;
        }

        return result.stdout || `No results for: "${query}"`;
    },
};

/**
 * Firecrawl Browser — interact with a cloud browser sandbox session.
 *
 * IMPORTANT — How this differs from OrcBot's Playwright browser:
 *   • OrcBot browser (browser_navigate etc.) → local Playwright on this machine
 *   • firecrawl_browser → cloud sandbox managed by Firecrawl's infrastructure
 *
 * The cloud browser is better for:
 *   • Agent-driven browsing without local resource use
 *   • Sites that block headless Playwright
 *   • Live streaming / recording sessions
 *
 * Uses the `agent-browser` command protocol: "open <url>", "snapshot", "click @ref", etc.
 */
export const firecrawl_browser = {
    name: 'firecrawl_browser',
    description:
        'Execute a command in a Firecrawl cloud browser sandbox. ' +
        'Commands: "open <url>", "snapshot", "click @ref", "fill @ref value", "scrape". ' +
        'This is a CLOUD browser — separate from OrcBot\'s local Playwright browser. ' +
        'Use for agent-driven browsing on bot-protected or resource-heavy pages.',
    usage: 'firecrawl_browser(command, session_id?)',
    handler: async (args: any, _ctx?: AgentContext) => {
        if (!checkFirecrawlInstalled()) return NOT_INSTALLED_MSG;

        const command = args.command || args.cmd;
        if (!command) return 'Error: Missing command. Examples: "open https://example.com", "snapshot", "click @e5"';

        const sessionFlag = args.session_id ? `--session ${args.session_id}` : '';
        const result = await runFirecrawl(`browser execute "${command.replace(/"/g, '\\"')}" ${sessionFlag}`, 60000);

        if (result.exitCode !== 0) {
            // If no session exists yet, hint to launch one
            if (result.stderr.includes('No active session')) {
                return (
                    'No active browser session. Launch one first with:\n' +
                    '  run_command("firecrawl browser launch --stream")\n' +
                    'Then retry your command.'
                );
            }
            return `firecrawl browser execute failed:\n${result.stderr || result.stdout}`;
        }

        return result.stdout || 'Command executed. Use "snapshot" to see the page state.';
    },
};

/**
 * Firecrawl Crawl — crawl an entire website and return structured content.
 */
export const firecrawl_crawl = {
    name: 'firecrawl_crawl',
    description:
        'Crawl an entire website using Firecrawl. Returns a job ID immediately; ' +
        'pass wait=true to block until complete. Use for bulk content extraction.',
    usage: 'firecrawl_crawl(url, limit?, max_depth?, wait?, output?)',
    handler: async (args: any, _ctx?: AgentContext) => {
        if (!checkFirecrawlInstalled()) return NOT_INSTALLED_MSG;

        const url = args.url;
        if (!url) return 'Error: Missing url parameter.';

        const extraFlags: string[] = [];
        if (args.limit) extraFlags.push(`--limit ${args.limit}`);
        if (args.max_depth) extraFlags.push(`--max-depth ${args.max_depth}`);
        if (args.wait) extraFlags.push('--wait --progress');
        if (args.output) extraFlags.push(`-o "${args.output}"`);
        if (args.include_paths) extraFlags.push(`--include-paths ${args.include_paths}`);

        const flags = extraFlags.join(' ');
        // Crawling can take a long time — allow up to 10 minutes
        const result = await runFirecrawl(`crawl "${url}" ${flags}`, args.wait ? 600000 : 30000);

        if (result.exitCode !== 0) {
            return `firecrawl crawl failed:\n${result.stderr || result.stdout}`;
        }

        return result.stdout || 'Crawl started. Use the job ID to check status.';
    },
};

/**
 * Firecrawl Agent — AI-powered structured data extraction from the web.
 */
export const firecrawl_agent = {
    name: 'firecrawl_agent',
    description:
        'Run an AI extraction agent that autonomously browses the web and returns ' +
        'structured data based on a natural language prompt. Useful for competitive research, ' +
        'price monitoring, and any structured data that requires navigating multiple pages.',
    usage: 'firecrawl_agent(prompt, urls?, schema?, wait?)',
    handler: async (args: any, _ctx?: AgentContext) => {
        if (!checkFirecrawlInstalled()) return NOT_INSTALLED_MSG;

        const prompt = args.prompt || args.task;
        if (!prompt) return 'Error: Missing prompt parameter.';

        const extraFlags: string[] = ['--wait']; // default to wait for result
        if (args.urls) extraFlags.push(`--urls "${args.urls}"`);
        if (args.schema) extraFlags.push(`--schema '${JSON.stringify(args.schema)}'`);
        if (args.max_credits) extraFlags.push(`--max-credits ${args.max_credits}`);

        // Agent tasks take 2–10 minutes
        const result = await runFirecrawl(`agent "${prompt.replace(/"/g, '\\"')}" ${extraFlags.join(' ')}`, 600000);

        if (result.exitCode !== 0) {
            return `firecrawl agent failed:\n${result.stderr || result.stdout}`;
        }

        return result.stdout || 'Agent extraction complete (no output).';
    },
};
