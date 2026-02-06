/**
 * SchedulingHelper — Activated for tasks involving time, reminders, or recurring work.
 * Provides smart scheduling rules, temporal blocker handling, cron patterns,
 * and proactive deferral strategies.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class SchedulingHelper implements PromptHelper {
    readonly name = 'scheduling';
    readonly description = 'Smart scheduling, reminders, cron, temporal blockers';
    readonly priority = 40;
    readonly alwaysActive = false;

    private static readonly SCHEDULING_SIGNALS = [
        'remind', 'schedule', 'later', 'tomorrow', 'tonight', 'morning',
        'evening', 'next week', 'in an hour', 'in minutes', 'at noon',
        'every day', 'every morning', 'every week', 'recurring', 'repeat',
        'cron', 'daily', 'weekly', 'monthly', 'periodic', 'regularly',
        'timer', 'alarm', 'deadline', 'by end of day', 'before',
        'follow up', 'check back', 'retry later', 'try again',
        'rate limit', 'cooldown', 'wait', 'postpone', 'defer',
        'monitor', 'keep checking', 'watch for', 'alert me when',
        'send at', 'post at', 'do this at', 'wake me'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        return SchedulingHelper.SCHEDULING_SIGNALS.some(kw => task.includes(kw));
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `SMART SCHEDULING:
You have two scheduling skills — use them proactively:
- \`schedule_task(time_or_cron, task_description)\` — one-off future task. Supports cron syntax OR relative time like "in 15 minutes", "in 2 hours", "in 1 day".
- \`heartbeat_schedule(schedule, task_description, priority?)\` — recurring task. Use for "every morning", "every 2 hours", "daily", etc.

When to schedule:
1. **User explicitly asks**: "Remind me to X tomorrow", "Post this at 3pm", "Check for updates every morning", "Do this in 2 hours", "Send me a summary every Friday". ALWAYS honor these with the appropriate scheduling skill.
2. **Temporal blockers**: Rate limits ("wait 11 minutes"), cooldowns, "service unavailable — try later", API quota resets. DO NOT just inform the user and stop. Schedule the retry automatically, THEN tell the user you've scheduled it.
3. **Smart deferral**: If a task logically depends on a future condition (e.g., "check if my order shipped" when it was just placed, "see if they responded" right after sending), suggest scheduling a follow-up check rather than making the user remember to ask again.
4. **Recurring patterns**: If the user asks you to do something that implies repetition ("keep me updated on X", "monitor this", "let me know when Y changes"), use \`heartbeat_schedule\` to set up periodic checks.

After scheduling, ALWAYS confirm to the user what you scheduled and when it will run. Be specific: "I've scheduled a retry for 12 minutes from now" not "I'll try again later".`;
    }
}
