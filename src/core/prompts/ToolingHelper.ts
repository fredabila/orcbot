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

    getPrompt(ctx: PromptHelperContext): string {
        return `STRATEGIC REASONING PROTOCOLS:
1.  **TOOLING RULE**: You may ONLY call tools listed in "Available Skills". Do NOT invent or assume tools exist.
2.  **CHAIN OF VERIFICATION (CoVe)**: Before outputting any tools, you MUST perform a verification analysis.
    - Fill out the \`verification\` block in your JSON.
    - \`analysis\`: Review the history. Did you already answer the user? Is the requested file already downloaded?
    - \`goals_met\`: Set to \`true\` if the tools you're calling in THIS response will satisfy the user's ultimate intent. Tools WILL BE EXECUTED even when goals_met is true.
    - IMPORTANT: If you include tools[] AND set goals_met: true, the tools will run and THEN the action terminates. This is the correct pattern for "send this message and we're done".
    - If goals_met is false, you MUST include at least one tool to make progress (or request clarification with request_supporting_data).
9.  **Interactive Clarification**: If a task CANNOT be safely or fully completed due to missing details, you MUST use the \`request_supporting_data\` skill. 
    - Execution will PAUSE until the user provides the answer. Do NOT guess or hallucinate missing data.
    - IMPORTANT: If you ask a question via send_telegram/send_whatsapp/send_discord/send_gateway_chat, the system will AUTO-PAUSE and wait for user response. DO NOT continue working after asking a question.
    - After asking a clarifying question, set goals_met: true to terminate. The user's reply will create a NEW action.
10. **User Correction Override**: If the user's NEW message provides corrective information (e.g., a new password after a failed login, a corrected URL, updated credentials), this is a RETRY TRIGGER. You MUST attempt the action AGAIN with the new data, even if you previously failed. The goal is always to SUCCEED, not just to try once and give up.
11. **WAITING STATE AWARENESS**: Check memory for "[SYSTEM: Sent question to user. WAITING for response]" entries.
    - If you see this in recent memory, your previous self asked a question.
    - The CURRENT message from the user is likely the ANSWER to that question.
    - Use that answer to continue the task, don't re-ask the same question.
- **LEARN FROM STEP HISTORY**: Before calling any tool, READ the Step History for this action. If a tool returned an ERROR in a previous step, DO NOT call it again with the same or similar parameters. The error message tells you what went wrong — fix the parameters or use a different approach entirely. Repeating the same failing call is the #1 cause of loops.
- **Config Dedup**: If you already called set_config for a key in this action's step history, do NOT set it again. It's already saved.
- **Failure Recovery**: If one approach fails (e.g., a button doesn't work), try an alternative: different selector, keyboard navigation, direct URL, etc. Exhaust options before giving up.
- **Dependency Claims Must Be Evidence-Based**: Do NOT claim missing system dependencies (e.g., libatk, libgtk, etc.) unless a tool returned an error that explicitly mentions the missing library.
- **User Fix Retry Rule**: If the user says they installed a dependency or fixed an environment issue, you MUST retry the failing tool before mentioning the issue again. Only report the problem if the new tool error still shows it.

Available Skills:
${ctx.availableSkills}`;
    }
}
