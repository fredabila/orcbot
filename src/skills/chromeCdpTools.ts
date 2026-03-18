import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Internal Chrome CDP tools for OrcBot.
 * Wraps pasky/chrome-cdp-skill (cdp.mjs) to provide direct access to the user's Chrome browser.
 */
export function registerChromeCdpTools(agent: Agent) {

    /**
     * Helper to locate the cdp.mjs script.
     * Looks for it in the local package directory (handles both src/ and dist/ paths).
     */
    function findCdpScript(): string | null {
        // In dist, it might be in dist/skills/chrome-cdp/cdp.mjs
        // In src, it's in src/skills/chrome-cdp/cdp.mjs
        const possiblePaths = [
            path.join(__dirname, 'chrome-cdp', 'cdp.mjs'),
            path.join(process.cwd(), 'src', 'skills', 'chrome-cdp', 'cdp.mjs'),
            path.join(process.cwd(), 'dist', 'skills', 'chrome-cdp', 'cdp.mjs')
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    /**
     * Helper to execute a cdp.mjs command.
     */
    async function executeCdp(args: string[]): Promise<string> {
        const scriptPath = findCdpScript();
        if (!scriptPath) {
            return 'Error: chrome-cdp skill (cdp.mjs) not found. Ensure it is installed in ~/.orcbot/plugins/skills/chrome-cdp/';
        }

        return new Promise((resolve) => {
            const nodeArgs = [scriptPath, ...args];
            logger.info(`Executing Chrome CDP: node ${nodeArgs.join(' ')}`);
            
            const child = spawn('node', nodeArgs, { shell: true });
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code) => {
                if (code !== 0) {
                    resolve(`Error (Exit Code ${code}):\n${stderr}\n${stdout}`);
                } else {
                    resolve(stdout || stderr);
                }
            });

            // Handle potential spawn errors (e.g., node not found)
            child.on('error', (err) => {
                resolve(`Process error: ${err.message}`);
            });
        });
    }

    /**
     * List open pages in the local Chrome browser.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_list',
        description: 'List all open tabs and pages in the user\'s local Chrome browser. Returns targetId (prefix used for other commands), title, and URL.',
        usage: 'chrome_cdp_list()',
        isResearch: true,
        handler: async () => executeCdp(['list'])
    });

    /**
     * Capture a screenshot of an open page.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_shot',
        description: 'Capture a screenshot of the specified target tab in Chrome.',
        usage: 'chrome_cdp_shot({ target, outputPath? })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, outputPath } = args;
            if (!target) return 'Error: target (targetId prefix) is required.';
            const cmdArgs = ['shot', target];
            if (outputPath) cmdArgs.push(outputPath);
            return executeCdp(cmdArgs);
        }
    });

    /**
     * Get an accessibility tree snapshot (compact structure) of a page.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_snap',
        description: 'Get a compact accessibility tree snapshot of the specified target tab. Best for understanding page structure and interactive elements.',
        usage: 'chrome_cdp_snap({ target })',
        isResearch: true,
        handler: async (args: any) => {
            const { target } = args;
            if (!target) return 'Error: target (targetId prefix) is required.';
            return executeCdp(['snap', target]);
        }
    });

    /**
     * Evaluate JavaScript in the specified page.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_eval',
        description: 'Evaluate a JavaScript expression in the context of the specified target tab.',
        usage: 'chrome_cdp_eval({ target, expression })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, expression } = args;
            if (!target || !expression) return 'Error: target and expression are required.';
            return executeCdp(['eval', target, expression]);
        }
    });

    /**
     * Get the HTML content of a page or specific element.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_html',
        description: 'Get the full HTML or HTML of a specific element (via selector) in the specified target tab.',
        usage: 'chrome_cdp_html({ target, selector? })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, selector } = args;
            if (!target) return 'Error: target is required.';
            const cmdArgs = ['html', target];
            if (selector) cmdArgs.push(selector);
            return executeCdp(cmdArgs);
        }
    });

    /**
     * Navigate the specified tab to a new URL.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_nav',
        description: 'Navigate the specified target tab to a new URL and wait for it to load.',
        usage: 'chrome_cdp_nav({ target, url })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, url } = args;
            if (!target || !url) return 'Error: target and url are required.';
            return executeCdp(['nav', target, url]);
        }
    });

    /**
     * Click an element by its CSS selector.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_click',
        description: 'Click a visible element in the specified target tab using a CSS selector.',
        usage: 'chrome_cdp_click({ target, selector })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, selector } = args;
            if (!target || !selector) return 'Error: target and selector are required.';
            return executeCdp(['click', target, selector]);
        }
    });

    /**
     * Type text into the currently focused element.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_type',
        description: 'Type text into the currently focused element in the specified target tab. Works across cross-origin iframes. Use chrome_cdp_click first to focus.',
        usage: 'chrome_cdp_type({ target, text })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, text } = args;
            if (!target || !text) return 'Error: target and text are required.';
            return executeCdp(['type', target, text]);
        }
    });

    /**
     * Execute a raw CDP command.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_raw',
        description: 'Execute a raw Chrome DevTools Protocol command. Requires method and optional JSON params.',
        usage: 'chrome_cdp_raw({ target, method, params? })',
        isResearch: true,
        handler: async (args: any) => {
            const { target, method, params } = args;
            if (!target || !method) return 'Error: target and method are required.';
            const cmdArgs = ['evalraw', target, method];
            if (params) {
                cmdArgs.push(typeof params === 'string' ? params : JSON.stringify(params));
            }
            return executeCdp(cmdArgs);
        }
    });

    /**
     * Instructions on how to enable Chrome CDP.
     */
    agent.skills.registerSkill({
        name: 'chrome_cdp_help',
        description: 'Get instructions on how to enable Remote Debugging in Chrome so OrcBot can interact with your browser.',
        usage: 'chrome_cdp_help()',
        handler: async () => {
            return `HOW TO ENABLE CHROME REMOTE DEBUGGING:
1. Open Google Chrome.
2. Navigate to: chrome://inspect/#remote-debugging
3. Toggle the "Discover network targets" switch to ON.
4. Ensure Chrome is running before using chrome_cdp_* tools.
5. If running on a different port than 9222, you may need to adjust the CDP_URL in the skill.`;
        }
    });
}
