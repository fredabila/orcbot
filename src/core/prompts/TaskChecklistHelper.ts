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

        // Activate when task contains conjunctions suggesting multiple actions
        if (/\b(and then|and also|as well as|in addition|plus|along with)\b/.test(task)) return true;

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
**PROGRESS TRACKING (during execution):**
- After completing each significant step, note what was done and what remains.
- If a step fails, record the failure reason and adjust the remaining plan.
- When updating the user, use a clear format:
  ✅ Completed: [what was done]
  🔄 In progress: [current step]
  ⏳ Remaining: [what's left]
- Do NOT send progress updates for every micro-step — batch updates for meaningful milestones.
${stepsSinceMsg >= 3 ? `- ⚡ You have been working for ${stepsSinceMsg} steps without updating the user. Send a progress update NOW.` : ''}

**MANDATORY PROGRESS CADENCE:**
- For tasks with 4+ steps: send the user a brief progress update at least every 3 deep tool calls.
- The user CANNOT see your internal work. Silence = the user thinking you've stalled or stopped.
- Progress updates should be specific: "Checked X, found Y, now doing Z" — NOT generic "still working."
- If you hit an error, tell the user immediately: "Hit a snag with [X], trying [alternative approach]..."
- If a step takes longer than expected, explain why: "This is taking a moment because [reason]..."

**ERROR RECOVERY & SELF-FIXING (CRITICAL):**
- When a tool fails, READ the error message carefully. The error tells you what went wrong.
- **DO NOT** repeat the same command/tool with the same parameters after a failure. That is the #1 cause of loops.
- **Adapt your approach**: wrong path → fix the path. Missing dependency → install it or find alternative. Permission denied → try with different permissions or different approach.
- **Environment errors**: If a command fails due to the environment (wrong OS, missing tool, wrong shell syntax), use get_system_info to understand the environment, then adjust your command accordingly.
- **Self-diagnosis pattern**: Error → Read error message → Identify root cause → Fix parameters or switch approach → Retry with fix → If still failing, inform user and try fundamentally different method.
- After fixing an error, verify the fix worked before moving on.

**CLI TOOL INTERACTIVITY:**
- When using run_command for CLI tools, be aware that some tools produce interactive output or require specific input formats.
- If a command returns an error about missing tools, try installing them first: run_command("npm install -g <tool>") or run_command("pip install <tool>") or use the package manager appropriate for the environment.
- Parse command output carefully — extract relevant information and use it in subsequent steps.
- If a command produces long output, focus on the relevant sections (errors, results, status).
- Chain commands when appropriate using syntax appropriate for the current shell, or run them as separate run_command calls for sequential execution.

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
