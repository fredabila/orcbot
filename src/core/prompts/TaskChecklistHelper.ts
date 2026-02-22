/**
 * TaskChecklistHelper — Activated for multi-step or complex tasks.
 *
 * Provides checklist generation, progress tracking, and completion verification
 * instructions so the agent can break down work into discrete items and report
 * status to the user at each step.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class TaskChecklistHelper implements PromptHelper {
    readonly name = 'task-checklist';
    readonly description = 'Task breakdown, checklist generation, progress tracking';
    readonly priority = 22; // After core/tooling (0-10), before research (25)
    readonly alwaysActive = false;

    private static readonly CHECKLIST_SIGNALS = [
        'step by step', 'steps', 'checklist', 'todo', 'to-do', 'plan',
        'break down', 'breakdown', 'multi-step', 'multistep', 'phase',
        'track progress', 'track the', 'keep track', 'progress',
        'multiple', 'several', 'all of', 'each of', 'one by one',
        'first', 'then', 'after that', 'finally', 'next',
        'set up', 'configure', 'install and', 'build and', 'create and',
        'research and', 'find and', 'download and', 'compile',
        'migrate', 'refactor', 'upgrade', 'convert', 'transform',
        'audit', 'review all', 'check all', 'scan all', 'update all',
        'comprehensive', 'thorough', 'complete', 'full',
        'project', 'workflow', 'pipeline', 'process'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();

        // Activate for multi-step tasks detected by keywords
        if (TaskChecklistHelper.CHECKLIST_SIGNALS.some(kw => task.includes(kw))) return true;

        // Activate when already past step 2 (implies multi-step work)
        if ((ctx.metadata.currentStep || 1) > 2) return true;

        // Activate for long task descriptions (likely complex)
        if (task.length > 120) return true;

        // Activate when task contains conjunctions/sequencing suggesting multiple actions
        const sequencingMatches = task.match(/\b(and then|and also|as well as|in addition|plus|along with|followed by|before that|after that|finally|next|then)\b/g) || [];
        if (sequencingMatches.length >= 1) return true;

        // Broader fallback for compact instructions like: "do X, Y, and Z"
        const connectorMatches = task.match(/\b(and|then)\b/g) || [];
        if (connectorMatches.length >= 2) return true;

        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        const currentStep = ctx.metadata.currentStep || 1;
        const isEarlyPhase = currentStep <= 2;
        const stepsSinceMsg = ctx.metadata.stepsSinceLastMessage ?? 0;

        return `TASK CHECKLIST & PROGRESS TRACKING:
${isEarlyPhase ? `
**CHECKLIST GENERATION (first steps):**
- Before executing a complex or multi-step task, generate a mental checklist of the discrete steps needed.
- Structure your reasoning as: "To accomplish this, I need to: (1) ..., (2) ..., (3) ..."
- Identify dependencies between steps — which steps must complete before others can start.
- Estimate which steps can be parallelized (use multi-tool calls for independent steps).
- If the task has more than 3 steps, briefly share the plan with the user before starting.
- **ENVIRONMENT CHECK**: If any step involves running commands, CLI tools, or interacting with the server environment, include a verification step FIRST (e.g., check OS with get_system_info, then use an OS-appropriate tool-existence check: on Unix, verify with run_command("which <tool>") or run_command("command -v <tool>"); on Windows/PowerShell, verify with run_command("Get-Command <tool>")).
` : ''}
**PROGRESS TRACKING:**
- Note what was done and what remains after each step; adjust the plan on failures.
- Format updates as: ✅ Done: [...] | 🔄 Now: [...] | ⏳ Next: [...]
- Batch updates for meaningful milestones, not every micro-step.
- **MANDATORY PROGRESS CADENCE**: For channel/user-facing tasks, send a user-visible update at least every 3 deep tool calls (browser actions, run_command, file processing, API calls), even if you're using multi-tool batches.
- **MULTI-TOOL COMMUNICATION GUARDRAIL**: If you queue multiple tool executions in one turn, include or schedule a user update so the user knows what batch is running and what result is expected next.
${stepsSinceMsg >= 3 ? `- ⚡ You have been working for ${stepsSinceMsg} steps without updating the user. Send a progress update NOW.` : ''}

**ERROR RECOVERY:**
- **Self-diagnosis pattern**: (1) read the actual error, (2) identify root cause, (3) change strategy/parameters, (4) retry, (5) report adapted plan.
- Never repeat the exact same failing call without changing inputs or approach.
- If a step fails, explicitly mark what changed in the checklist so continuity is preserved.

**CLI TOOL INTERACTIVITY:**
- Assume commands run in a non-interactive environment unless proven otherwise.
- Add non-interactive flags when relevant (e.g., \'-y\', '--yes', '--no-input', '--batch').
- If a command hangs/timeouts, retry with shell-appropriate syntax and safer flags rather than silently stalling.

**COMPLETION VERIFICATION:**
- Before marking goals_met=true, mentally walk through your original checklist.
- Verify each item is genuinely done, not just attempted.
- If any item was skipped or failed, either complete it or explicitly tell the user what was not accomplished and why.
- A task is COMPLETE only when ALL checklist items are done or accounted for.
- **PREMATURE COMPLETION GATE**: Do NOT set goals_met=true if you have untouched checklist items. If you're tempted to stop early, ask yourself: "Did I actually complete this, or am I just giving up?" If you're giving up, tell the user what you couldn't do and why.

**ADAPTIVE REPLANNING:**
- If you discover mid-task that the original plan needs adjustment (unexpected errors, missing prerequisites, scope change), update your mental checklist.
- Inform the user of plan changes: "I found X, so I'm adjusting the approach to..."
- Never silently drop checklist items — either do them or explain why they're no longer needed.
- **CONTEXT PRESERVATION**: When replanning, re-read your step history to maintain continuity. Don't lose track of what you've already accomplished or what the user originally asked for.`;
    }
}
