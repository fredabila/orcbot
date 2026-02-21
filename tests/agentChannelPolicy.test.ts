import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/Agent';

describe('Agent channel tool policy', () => {
    it('allows send_email from non-email source channels when email delivery is configured', () => {
        const agent = Object.create(Agent.prototype) as any;
        agent.TOOL_CHANNEL_MAP = { send_email: 'email' };
        agent.CROSS_CHANNEL_EXEMPT_TOOLS = new Set(['send_email']);
        agent.config = { get: () => undefined };
        agent.getOrCreateEmailChannel = () => ({ name: 'Email' });

        const result = agent.evaluateChannelToolPolicy(
            { payload: { source: 'telegram' }, lane: 'user' },
            'send_email'
        );

        expect(result).toEqual({ allowed: true });
    });

    it('still blocks non-exempt cross-channel sends', () => {
        const agent = Object.create(Agent.prototype) as any;
        agent.TOOL_CHANNEL_MAP = { send_discord: 'discord' };
        agent.CROSS_CHANNEL_EXEMPT_TOOLS = new Set(['send_email']);
        agent.config = { get: () => undefined };
        agent.discord = { sendMessage: async () => undefined };

        const result = agent.evaluateChannelToolPolicy(
            { payload: { source: 'telegram' }, lane: 'user' },
            'send_discord'
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Cross-channel send blocked');
    });
});
