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

    private static readonly SCHEDULING_SIGNALS: RegExp[] = [
        /\bremind\b/i, /\bschedule\b/i, /\blater\b/i, /\btomorrow\b/i, /\btonight\b/i,
        /\bmorning\b/i, /\bevening\b/i, /\bnext week\b/i, /\bin an hour\b/i,
        /\bin minutes\b/i, /\bat noon\b/i, /\bevery day\b/i, /\bevery morning\b/i,
        /\bevery week\b/i, /\brecurring\b/i, /\brepeat\b/i, /\bcron\b/i, /\bdaily\b/i,
        /\bweekly\b/i, /\bmonthly\b/i, /\bperiodic\b/i, /\bregularly\b/i, /\btimer\b/i,
        /\balarm\b/i, /\bdeadline\b/i, /\bby end of day\b/i, /\bbefore\b/i, /\bfollow up\b/i,
        /\bcheck back\b/i, /\bretry later\b/i, /\btry again\b/i, /\brate limit\b/i,
        /\bcooldown\b/i, /\bwait\b/i, /\bpostpone\b/i, /\bdefer\b/i, /\bmonitor\b/i,
        /\bkeep checking\b/i, /\bwatch for\b/i, /\balert me when\b/i, /\bsend at\b/i,
        /\bpost at\b/i, /\bdo this at\b/i, /\bwake me\b/i
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        return SchedulingHelper.SCHEDULING_SIGNALS.some(rx => rx.test(task));
    }

    getRelatedHelpers(ctx: PromptHelperContext): string[] {
        // Scheduling often involves communication (reminders)
        return ['communication'];
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `PROACTIVE SCHEDULING & HEARTBEATS:
You have advanced scheduling skills — use them to "own" your work autonomously. 
- \`schedule_task(time_or_cron, task_description)\` — one-off future task.
- \`heartbeat_schedule(schedule, task_description, priority?)\` — recurring task.
- \`heartbeat_list()\` / \`heartbeat_remove(id)\` — manage recurring workflows.

CORE PRINCIPLES:
1. **Promise = Action**: If you say you "will check" something later, you MUST use \`schedule_task\` now. Never leave the user hanging on a promise without a system-tracked follow-up.
2. **Autonomous Monitoring**: If the user asks for ongoing updates ("keep me posted on X", "alert me if Y changes"), do NOT wait for them to ask again. Setup a \`heartbeat_schedule\` (e.g., "every 2 hours", "daily at 9am") to check autonomously.
3. **Proactive Summaries**: If you've done a lot of work today, suggest a \`heartbeat_schedule\` to provide a daily summary of your progress at a specific time.
4. **Temporal Blockers**: If hit by rate limits or "try again in X minutes", schedule the retry automatically. DO NOT just report the failure.

When to use Heartbeats (Recurring):
- Daily morning briefings / Evening summaries.
- Hourly price/news/stock/crypto monitoring.
- Periodic health checks on servers/services.
- "Keep-alive" interactions for long-running research.

When to use Schedule (One-off):
- Reminders for the user.
- Retrying a failed task after a cooldown.
- Following up on a pending response/email.

After scheduling, ALWAYS confirm the ID and time to the user: "I've scheduled a recurring check for this every morning (ID: hb_abc123)."`;
    }
}
