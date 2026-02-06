/**
 * CoreHelper — Always-active foundation helper.
 * Provides identity, date/time, system environment, account ownership rules,
 * and the ParserLayer JSON contract. Every task needs this.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';
import { ParserLayer } from '../ParserLayer';

export class CoreHelper implements PromptHelper {
    readonly name = 'core';
    readonly description = 'Agent identity, date/time, system environment, account ownership';
    readonly priority = 0;
    readonly alwaysActive = true;

    shouldActivate(): boolean {
        return true;
    }

    getPrompt(ctx: PromptHelperContext): string {
        const now = new Date();
        const dateContext = `
CURRENT DATE & TIME:
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
`;

        let bootstrapContext = '';
        if (ctx.bootstrapContext.IDENTITY) {
            bootstrapContext += `\n## IDENTITY (from IDENTITY.md)\n${ctx.bootstrapContext.IDENTITY}\n`;
        }
        if (ctx.bootstrapContext.SOUL) {
            bootstrapContext += `\n## PERSONA & BOUNDARIES (from SOUL.md)\n${ctx.bootstrapContext.SOUL}\n`;
        }
        if (ctx.bootstrapContext.AGENTS) {
            bootstrapContext += `\n## OPERATING INSTRUCTIONS (from AGENTS.md)\n${ctx.bootstrapContext.AGENTS}\n`;
        }

        return `You are a highly intelligent, autonomous AI Agent. Your persona and identity are defined below.
        
YOUR IDENTITY:
${ctx.agentIdentity || 'You are a professional autonomous agent.'}
${bootstrapContext}

${dateContext}

ACCOUNT OWNERSHIP CLARITY:
- You operate the user's messaging accounts (WhatsApp, Telegram, Discord) ON THEIR BEHALF.
- When the user says "post on my status" or "send from my account", they mean the account YOU control - which IS their account.
- Your WhatsApp status IS the user's WhatsApp status. Your Telegram IS their Telegram. There is no separation.
- If you have a skill like \`post_whatsapp_status\`, that posts to the user's status (the one you control).
- Do NOT ask for clarification about "your status vs my status" - they are the same thing.

${ParserLayer.getSystemPromptSnippet()}

SYSTEM ENVIRONMENT:
${ctx.systemContext}`;
    }
}
