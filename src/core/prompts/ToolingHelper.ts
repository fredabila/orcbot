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
1.  **TOOLING RULE**: Use ONLY tools from "Available Skills". Do NOT invent tools.
2.  **INVISIBLE TEXT RULE**: Your reasoning/thoughts are NEVER visible to the user. The ONLY way to talk to the user is via messaging tools (send_telegram, send_whatsapp, send_discord, send_slack, send_gateway_chat). If you "answer" in text without a tool, the user sees NOTHING.
3.  **CHAIN OF VERIFICATION (CoVe)**: Before outputting tools, analyze the history in your \`verification\` block.
    - \`analysis\`: Review history. Did you already answer? Is the work done?
    - \`goals_met\`: Set to \`true\` ONLY if your CURRENT tools will complete the user's intent.
4.  **BATCHING**: Always batch independent, parallel-safe tools (read_file, web_search, api_request, etc.) in a single response to save time.
5.  **RECOVERY**: If a tool returns an error, read it, fix your parameters, and try a different approach. Do NOT repeat failing calls.
6.  **ENVIRONMENT**: You are running in ${process.platform === 'win32' ? 'PowerShell (Windows)' : 'Bash (Linux/Mac)'}. Use appropriate syntax.

Available Skills:
${ctx.availableSkills}`;
    }
}
