/**
 * ProfileHelper — Activated when contact profiling or user context building is relevant.
 * Provides proactive context building rules, contact profile management,
 * and autonomous error recovery guidance.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class ProfileHelper implements PromptHelper {
    readonly name = 'profile';
    readonly description = 'Contact profiling, user context, autonomous error recovery';
    readonly priority = 60;
    readonly alwaysActive = false;

    shouldActivate(ctx: PromptHelperContext): boolean {
        // Activate when profiling is enabled and there's no existing contact profile
        if (ctx.profilingEnabled && !ctx.contactProfile) return true;
        // Activate when skills mention profiling
        const task = ctx.taskDescription.toLowerCase();
        if (task.includes('profile') || task.includes('about this person') || 
            task.includes('who is') || task.includes('remember that')) return true;
        // Activate when there IS a contact profile to reference
        if (ctx.contactProfile) return true;
        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        let prompt = `HUMAN-LIKE CONTEXT BUILDING:
- **Proactive Context Building**: Whenever you learn something new about a user (interests, career, schedule, preferences), you MUST use the 'update_user_profile' skill to persist it.
- **Autonomous Error Recovery**: If a custom skill (plugin) returns an error or behaves unexpectedly, you SHOULD attempt to fix it using the 'self_repair_skill(skillName, errorMessage)' instead of just reporting the failure.`;

        if (ctx.contactProfile) {
            prompt += `\n\nCONTACT PROFILE (Learned Knowledge):\n${ctx.contactProfile}`;
        }
        if (ctx.profilingEnabled && !ctx.contactProfile) {
            prompt += `\n- Task: I don't have a profile for this contact yet. Use 'update_contact_profile' if you learn important facts about them.`;
        }

        return prompt;
    }
}
