/**
 * ToolingHelper — Always-active reasoning & verification helper.
 * Provides Chain of Verification (CoVe), tool usage rules, error recovery,
 * and the fundamental reasoning protocols every task needs.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class ToolingHelper implements PromptHelper {
    readonly name = 'tooling';
    readonly description = 'CoVe verification, tool rules, error recovery, config dedup';
    readonly priority = 5;
    readonly alwaysActive = true;

    shouldActivate(): boolean {
        return true;
    }

    getRelatedHelpers(ctx: PromptHelperContext): string[] {
        // Core tooling often needs TForce for health monitoring
        return ['tforce', 'task-checklist'];
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `CORE OPERATIONAL PROTOCOLS:
1.  **TOOLING RULE**: Use ONLY tools from "Available Skills". Do NOT invent tools. If you need a capability not listed, use run_command or write_file to build it.
2.  **INVISIBLE TEXT RULE**: Your reasoning/thoughts are NEVER visible to the user. The ONLY way to communicate is via messaging tools (send_telegram, send_whatsapp, send_discord, send_slack, send_gateway_chat). Text outside tools = silence.
3.  **CHAIN OF VERIFICATION (CoVe)**: Before every tool call, reason in your \`verification\` block:
    - \`analysis\`: What has happened so far? What did each tool actually return? What is the NEXT concrete action?
    - \`goals_met\`: Set \`true\` ONLY when the user has received (or your current tools WILL deliver) a complete, substantive answer — NOT just internal progress. If you did work but haven't sent the result yet, goals_met is false.
4.  **BATCHING**: Always batch independent, parallel-safe operations (read_file, web_search, api_request, run_command, etc.) in a single response to save steps.
5.  **RECOVERY LADDER** — follow this exact sequence when a tool fails:
    a. Read the full error. Is it a parameter mistake? Fix it and retry once with corrected args.
    b. Is the tool path wrong, URL dead, or resource missing? Switch to an alternative approach (different URL, different command, different tool).
    c. After 2 failed attempts at the same approach: pivot completely — use a different tool or strategy entirely.
    d. After 3 different strategies all fail: send the user an honest message explaining what was tried, what failed, and what they can do. Then set goals_met=true.
    e. NEVER silently give up. If you cannot complete the task, ALWAYS tell the user why.
6.  **TOOL SELECTION DISCIPLINE**:
    - To run system commands: use run_command (PowerShell on Windows, Bash on Linux/Mac)
    - To read/write files: use read_file / write_file (always use absolute paths)
    - To search the web: use web_search first, then browser_navigate for specific pages
    - To get page content: use browser_navigate then browser_examine_page for interactive refs
    - To remember across sessions: use memory_write with a clear category
    - To check what you know: use memory_search or recall_memory before searching the web
7.  **MEMORY & CONTEXT DISCIPLINE**:
    - Before starting research tasks, search memory first — you may already have the answer
    - After completing a task with useful findings, save key facts with memory_write
    - If you are mid-task and your context shows prior steps, trust that history over your prior assumptions
    - If the user references something ("that file", "the link I sent", "last time"), check thread context and memory before asking them to repeat it
8.  **ENVIRONMENT**: You are running in ${process.platform === 'win32' ? 'PowerShell (Windows)' : 'Bash (Linux/Mac)'}. Use appropriate syntax. On Windows: use backslashes for paths in commands, semicolons not &&.

Available Skills:
${ctx.availableSkills}`;
    }
}
