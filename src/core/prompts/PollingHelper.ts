/**
 * PollingHelper — Surfaces polling capabilities so the agent actually uses them.
 *
 * The PollingManager exists but the agent rarely invokes polling skills because
 * no prompt helper explicitly tells it *when* and *why* to use polling instead
 * of busy-looping or giving up. This helper fixes that gap.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class PollingHelper implements PromptHelper {
    readonly name = 'polling';
    readonly description = 'Condition polling, waiting, monitoring, async task tracking';
    readonly priority = 35; // Between development (30) and scheduling (40)
    readonly alwaysActive = false;

    private static readonly POLLING_SIGNALS = [
        'wait for', 'wait until', 'waiting', 'poll', 'polling',
        'monitor', 'monitoring', 'watch for', 'watching',
        'check if', 'check when', 'check whether', 'keep checking',
        'notify me when', 'alert me when', 'tell me when', 'let me know when',
        'is it ready', 'is it done', 'has it finished', 'did it complete',
        'status of', 'status update', 'progress of',
        'until', 'when it', 'once it', 'as soon as',
        'deploy', 'deployment', 'build status', 'ci', 'pipeline',
        'download complete', 'file ready', 'process finished',
        'available', 'becomes available', 'comes back', 'goes live',
        'retry', 'try again', 'attempt again', 'keep trying'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        if (PollingHelper.POLLING_SIGNALS.some(kw => task.includes(kw))) return true;

        // Activate when skills used suggest monitoring needs
        const usedSkills = ctx.skillsUsedInAction || [];
        const monitorSkills = ['run_command', 'browser_navigate', 'web_search'];
        if (usedSkills.filter(s => monitorSkills.includes(s)).length >= 2) return true;

        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `POLLING & CONDITION MONITORING:
You have polling skills available — use them instead of busy-looping or giving up on async tasks.

**Available Polling Skills:**
- \`register_polling_job(id, description, checkCommand, intervalMs, maxAttempts?)\` — Register a background job that periodically runs a shell command. When the command exits with code 0, the condition is met and you'll be notified.
- \`cancel_polling_job(id)\` — Stop a running polling job.
- \`list_polling_jobs()\` — See all active polling jobs and their status.
- \`get_polling_job_status(id)\` — Check a specific job's progress.

**When to Use Polling (instead of looping or giving up):**
1. **Waiting for a process to finish**: Build jobs, deployments, long-running commands, downloads — register a polling job that checks for the completion marker (exit code, output file, status endpoint).
2. **Monitoring for changes**: File modifications, service availability, API readiness — poll at reasonable intervals (e.g., every 10-30 seconds) instead of hammering in a tight loop.
3. **Retry with backoff**: When an operation fails with a transient error (rate limit, timeout, service unavailable), register a polling job to retry rather than immediately retrying in a loop.
4. **Waiting for external events**: User uploads, webhook callbacks, email confirmations — poll periodically rather than blocking the action loop.

**Polling Best Practices:**
- Choose appropriate intervals: 5-10s for fast checks, 30-60s for external services, 5-15min for slow processes.
- Always set \`maxAttempts\` to prevent infinite polling (default to 30-60 attempts).
- Use descriptive job IDs and descriptions so status checks are meaningful.
- When a polling job completes, it auto-creates a follow-up task — you'll handle the result in a new action.

**Anti-Patterns to AVOID:**
- ❌ Running the same command in a loop within one action to "wait" for it to succeed.
- ❌ Telling the user "I'll check back later" without actually scheduling or registering a poll.
- ❌ Giving up on a task because a resource isn't ready yet — register a poll instead.
- ❌ Using \`schedule_task\` for short waits (< 5 min) — use polling instead, it's faster and more precise.`;
    }
}
