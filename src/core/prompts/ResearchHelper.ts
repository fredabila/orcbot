/**
 * ResearchHelper — Activated for deep research, investigation, and multi-step tasks.
 * Provides task persistence rules, follow-up awareness, promise enforcement,
 * continuation strategy, and incomplete work detection.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class ResearchHelper implements PromptHelper {
    readonly name = 'research';
    readonly description = 'Task persistence, follow-ups, promise enforcement, continuation';
    readonly priority = 25;
    readonly alwaysActive = false;

    private static readonly RESEARCH_SIGNALS: RegExp[] = [
        /\bresearch\b/i, /\bdeep dive\b/i, /\binvestigate\b/i, /\bfind out\b/i,
        /\blook up\b/i, /\bsearch for\b/i, /\bcompile\b/i, /\bgather\b/i, /\baggregate\b/i,
        /\banalyze\b/i, /\bexplore\b/i, /\bdiscover\b/i, /\bbrowse\b/i, /\bscrape\b/i,
        /\bcrawl\b/i, /\bdownload\b/i, /\bcollect\b/i, /\bsummarize\b/i, /\breport on\b/i,
        /\bwrite about\b/i, /\bcreate a report\b/i, /\bbuild a\b/i, /\bdevelop a\b/i,
        /\bset up\b/i, /\bconfigure\b/i, /\binstall\b/i, /\bdeploy\b/i, /\bwith pictures\b/i,
        /\bwith images\b/i, /\bcompare\b/i, /\breview\b/i, /\baudit\b/i, /\bscan\b/i,
        /\bcheck all\b/i, /\bfind all\b/i, /\bcomprehensive\b/i, /\bdetailed\b/i,
        /\bthorough\b/i, /\bin-depth\b/i, /\bfull analysis\b/i
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Activate for research tasks or multi-step tasks (step > 2)
        if ((ctx.metadata.currentStep || 1) > 2) return true;
        return ResearchHelper.RESEARCH_SIGNALS.some(rx => rx.test(task));
    }

    getRelatedHelpers(ctx: PromptHelperContext): string[] {
        // Research almost always benefits from memory and browsing
        return ['memory', 'browser'];
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `TASK PERSISTENCE & COMPLETION:
- **Complete The Job**: If you started a multi-step task (account creation, file download, research), you MUST continue until genuine completion or a genuine blocker (not just "I've done a few steps").
- **No Premature Termination**: Do NOT stop mid-task because you've "made progress". The goal is COMPLETION, not partial work. If you can take another step, take it.
- **Blocker Definition**: A "blocker" is: (1) Missing credentials/info from user, (2) CAPTCHA you cannot solve, (3) Permission denied errors. Normal page loads, form fills, and navigation are NOT blockers. Rate limits and "try again later" errors are NOT blockers either — they are scheduling opportunities (see Smart Scheduling).
- **Session Continuity**: You have memory of previous steps. Use it. Don't restart from scratch or forget what you've accomplished.

TASK CONTINUITY & FOLLOW-UP AWARENESS:
- **Incomplete Work Detection**: Before responding, CHECK your recent memory/conversation history for incomplete tasks. If you previously started a task (research, download, build, etc.) and it was interrupted or incomplete, your memory will contain observations like "Got stuck repeating...", "Message budget reached", or step history showing partial progress.
- **Follow-Up Questions**: When a user asks "are you done?", "is it ready?", "what's the status?", or similar follow-ups about a previous task:
  1. CHECK your memory for the original task and its completion status
  2. If the task WAS completed, confirm with results
  3. If the task was NOT completed, you MUST do BOTH: (a) Reply honestly with a status update AND (b) ACTUALLY CONTINUE the work in this same action — do NOT just promise to do it later and terminate
  4. If you cannot continue in the same action (e.g., needs scheduling), use \`schedule_task\` to queue it NOW, don't just promise
- **Promise = Action**: If your response says you "will" do something, "are working on" something, or will "deliver shortly", you MUST either (a) include the tools to actually do it in this same response, or (b) use \`schedule_task\` to guarantee it happens. NEVER send a promise message with goals_met=true and no follow-up tools. Empty promises leave users hanging.
- **Continuation Strategy**: When resuming incomplete research/work, compile whatever partial results exist in your memory and deliver them to the user, then continue gathering more if needed. Partial results are better than no results.

- **File delivery**: Use \`send_file\` to deliver any file produced or downloaded. \`write_file\` alone is a dead end — the user cannot access your local filesystem.

`;
    }
}
