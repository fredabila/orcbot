import { describe, it, expect } from 'vitest';
import { PromptRouter } from '../src/core/prompts/PromptRouter';
import { AntiSlopHelper } from '../src/core/prompts/AntiSlopHelper';
import type { PromptHelperContext } from '../src/core/prompts/PromptHelper';

function makeContext(overrides: Partial<PromptHelperContext> = {}): PromptHelperContext {
    return {
        taskDescription: 'Say hello to the user',
        metadata: { source: 'whatsapp', sourceId: '123@s.whatsapp.net', currentStep: 1, messagesSent: 0 },
        availableSkills: '',
        agentIdentity: 'TestAgent',
        isFirstStep: true,
        systemContext: 'win32',
        bootstrapContext: {},
        ...overrides,
    };
}

describe('AntiSlopHelper', () => {
    it('is always active regardless of task', () => {
        const helper = new AntiSlopHelper();
        expect(helper.alwaysActive).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'run a build' }))).toBe(true);
    });

    it('carries the text-relevant antislop rules', () => {
        const prompt = new AntiSlopHelper().getPrompt(makeContext());
        expect(prompt).toContain('ANTI-SLOP WRITING');
        expect(prompt).toContain('em dash');
        expect(prompt).toMatch(/NEVER invent numbers/);
        expect(prompt).toContain('BANNED buzzwords');
    });
});

describe('PromptRouter integration', () => {
    it('includes antislop in the composed system prompt for channel messages', async () => {
        const router = new PromptRouter();
        const result = await router.route(makeContext());
        expect(result.activeHelpers).toContain('antislop');
        expect(result.composedPrompt).toContain('ANTI-SLOP WRITING');
    });

    it('keeps antislop in heartbeat prompts too', async () => {
        const router = new PromptRouter();
        const result = await router.route(makeContext({ isHeartbeat: true }));
        expect(result.activeHelpers).toContain('antislop');
    });
});
