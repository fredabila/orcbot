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

        return `TASK CHECKLIST & PROGRESS TRACKING:
${isEarlyPhase ? `
**CHECKLIST GENERATION (first steps):**
- Before executing a complex or multi-step task, generate a mental checklist of the discrete steps needed.
- Structure your reasoning as: "To accomplish this, I need to: (1) ..., (2) ..., (3) ..."
- Identify dependencies between steps — which steps must complete before others can start.
- Estimate which steps can be parallelized (use multi-tool calls for independent steps).
- If the task has more than 3 steps, briefly share the plan with the user before starting.
` : ''}
**PROGRESS TRACKING (during execution):**
- After completing each significant step, note what was done and what remains.
- If a step fails, record the failure reason and adjust the remaining plan.
- When updating the user, use a clear format:
  ✅ Completed: [what was done]
  🔄 In progress: [current step]
  ⏳ Remaining: [what's left]
- Do NOT send progress updates for every micro-step — batch updates for meaningful milestones.

**COMPLETION VERIFICATION:**
- Before marking goals_met=true, mentally walk through your original checklist.
- Verify each item is genuinely done, not just attempted.
- If any item was skipped or failed, either complete it or explicitly tell the user what was not accomplished and why.
- A task is COMPLETE only when ALL checklist items are done or accounted for.

**ADAPTIVE REPLANNING:**
- If you discover mid-task that the original plan needs adjustment (unexpected errors, missing prerequisites, scope change), update your mental checklist.
- Inform the user of plan changes: "I found X, so I'm adjusting the approach to..."
- Never silently drop checklist items — either do them or explain why they're no longer needed.`;
    }
}
