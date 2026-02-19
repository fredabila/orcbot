import { describe, expect, it } from 'vitest';
import { PromptRouter } from '../src/core/prompts/PromptRouter';
import { PromptHelperContext } from '../src/core/prompts/PromptHelper';

function makeContext(taskDescription: string): PromptHelperContext {
    return {
        taskDescription,
        metadata: { currentStep: 1 },
        availableSkills: '',
        agentIdentity: 'test agent',
        isFirstStep: true,
        systemContext: 'test',
        bootstrapContext: {}
    };
}

describe('PromptRouter fallback heuristics', () => {
    it('routes polling helper for relaxed monitoring language', async () => {
        const router = new PromptRouter();
        const result = await router.route(makeContext('keep an eye on the deployment status and let me know when it is back'));

        expect(result.activeHelpers).toContain('polling');
    });

    it('routes checklist helper for walkthrough phrasing', async () => {
        const router = new PromptRouter();
        const result = await router.route(makeContext('walk me through this migration one step at a time'));

        expect(result.activeHelpers).toContain('task-checklist');
    });
});
