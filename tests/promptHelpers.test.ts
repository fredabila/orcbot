import { describe, it, expect } from 'vitest';
import { TaskChecklistHelper } from '../src/core/prompts/TaskChecklistHelper';
import { ToolingHelper } from '../src/core/prompts/ToolingHelper';
import { BrowserHelper } from '../src/core/prompts/BrowserHelper';
import { PollingHelper } from '../src/core/prompts/PollingHelper';
import { PromptHelperContext } from '../src/core/prompts/PromptHelper';

function makeContext(overrides: Partial<PromptHelperContext> = {}): PromptHelperContext {
    return {
        taskDescription: overrides.taskDescription ?? 'simple task',
        metadata: overrides.metadata ?? { currentStep: 1 },
        availableSkills: '',
        agentIdentity: 'test agent',
        isFirstStep: overrides.isFirstStep ?? true,
        systemContext: 'test',
        bootstrapContext: {},
        ...overrides
    };
}

describe('TaskChecklistHelper', () => {
    const helper = new TaskChecklistHelper();

    it('should have correct name and metadata', () => {
        expect(helper.name).toBe('task-checklist');
        expect(helper.priority).toBe(22);
        expect(helper.alwaysActive).toBe(false);
    });

    it('should activate for multi-step keyword signals', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'break down this project into steps' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'create a step by step plan' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'make a checklist for the migration' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'track progress of the build' }))).toBe(true);
    });

    it('should activate when past step 2', () => {
        expect(helper.shouldActivate(makeContext({ metadata: { currentStep: 3 } }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ metadata: { currentStep: 5 } }))).toBe(true);
    });

    it('should activate for long task descriptions', () => {
        const longTask = 'This is a very complex task that involves setting up the entire infrastructure including databases, caching layers, API gateways, and monitoring dashboards for our production environment';
        expect(helper.shouldActivate(makeContext({ taskDescription: longTask }))).toBe(true);
    });

    it('should activate for conjunction-heavy tasks', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'install the deps and then configure the env' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'do X and also handle Y' }))).toBe(true);
    });

    it('should NOT activate for simple tasks', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'hello' }))).toBe(false);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'what time is it' }))).toBe(false);
    });

    it('should generate prompt with checklist generation section for early steps', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 1 } }));
        expect(prompt).toContain('CHECKLIST GENERATION');
        expect(prompt).toContain('PROGRESS TRACKING');
        expect(prompt).toContain('COMPLETION VERIFICATION');
    });

    it('should omit checklist generation section for later steps', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 5 } }));
        expect(prompt).not.toContain('CHECKLIST GENERATION (first steps)');
        expect(prompt).toContain('PROGRESS TRACKING');
    });
});

describe('PollingHelper', () => {
    const helper = new PollingHelper();

    it('should have correct name and metadata', () => {
        expect(helper.name).toBe('polling');
        expect(helper.priority).toBe(35);
        expect(helper.alwaysActive).toBe(false);
    });

    it('should activate for polling keyword signals', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'wait for the build to finish' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'monitor the deployment status' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'notify me when the file is ready' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'keep checking until it completes' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'is it done yet?' }))).toBe(true);
    });

    it('should activate for retry-related tasks', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'retry the upload' }))).toBe(true);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'try again in a few minutes' }))).toBe(true);
    });

    it('should activate when monitoring skills have been used', () => {
        expect(helper.shouldActivate(makeContext({
            taskDescription: 'check the results',
            skillsUsedInAction: ['run_command', 'browser_navigate', 'send_telegram']
        }))).toBe(true);
    });

    it('should NOT activate for simple tasks', () => {
        expect(helper.shouldActivate(makeContext({ taskDescription: 'hello there' }))).toBe(false);
        expect(helper.shouldActivate(makeContext({ taskDescription: 'send a message' }))).toBe(false);
    });

    it('should generate prompt with polling skills documentation', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('register_polling_job');
        expect(prompt).toContain('cancel_polling_job');
        expect(prompt).toContain('list_polling_jobs');
        expect(prompt).toContain('Anti-Patterns');
    });

    it('should include best practices in prompt', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('maxAttempts');
        expect(prompt).toContain('intervals');
    });
});

describe('TaskChecklistHelper - Enhanced', () => {
    const helper = new TaskChecklistHelper();

    it('should include error recovery guidance in prompt', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 1 } }));
        expect(prompt).toContain('ERROR RECOVERY');
        expect(prompt).toContain('Self-diagnosis pattern');
    });

    it('should include CLI interactivity guidance', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 1 } }));
        expect(prompt).toContain('CLI TOOL INTERACTIVITY');
        expect(prompt).toContain('run_command');
    });

    it('should include premature completion gate', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 3 } }));
        expect(prompt).toContain('PREMATURE COMPLETION GATE');
        expect(prompt).toContain('goals_met=true');
    });

    it('should include context preservation guidance', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 3 } }));
        expect(prompt).toContain('CONTEXT PRESERVATION');
    });

    it('should include mandatory progress cadence', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 1 } }));
        expect(prompt).toContain('MANDATORY PROGRESS CADENCE');
        expect(prompt).toContain('every 3 deep tool calls');
    });

    it('should include environment check guidance in early phase', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 1 } }));
        expect(prompt).toContain('ENVIRONMENT CHECK');
        expect(prompt).toContain('get_system_info');
    });

    it('should inject urgent progress nudge when steps since message is high', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 5, stepsSinceLastMessage: 4 } }));
        expect(prompt).toContain('Send a progress update NOW');
    });

    it('should NOT inject progress nudge when steps since message is low', () => {
        const prompt = helper.getPrompt(makeContext({ metadata: { currentStep: 5, stepsSinceLastMessage: 1 } }));
        expect(prompt).not.toContain('Send a progress update NOW');
    });
});

describe('ToolingHelper - Enhanced', () => {
    const helper = new ToolingHelper();

    it('should include error self-diagnosis section', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('ERROR SELF-DIAGNOSIS');
        expect(prompt).toContain('Self-fix pattern');
    });

    it('should include common error category guidance', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('command not found');
        expect(prompt).toContain('permission denied');
        expect(prompt).toContain('file not found');
        expect(prompt).toContain('connection refused');
        expect(prompt).toContain('syntax error');
    });

    it('should include environment adaptation section', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('ENVIRONMENT ADAPTATION');
        expect(prompt).toContain('Shell awareness');
    });

    it('should include CLI interactivity guidance', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('CLI tool interactivity');
        expect(prompt).toContain('non-interactive');
    });

    it('should include dependency management guidance', () => {
        const prompt = helper.getPrompt(makeContext());
        expect(prompt).toContain('Dependency management');
        expect(prompt).toContain('package manager');
    });
});

describe('BrowserHelper - Enhanced', () => {
    const helper = new BrowserHelper();

    it('should include browser error recovery section', () => {
        const prompt = helper.getPrompt(makeContext({ taskDescription: 'browse the web' }));
        expect(prompt).toContain('Browser Error Recovery');
    });

    it('should include context preservation during browsing section', () => {
        const prompt = helper.getPrompt(makeContext({ taskDescription: 'browse the web' }));
        expect(prompt).toContain('Context Preservation During Browsing');
        expect(prompt).toContain('mental map');
    });

    it('should use tighter silence limit of 2 steps', () => {
        const prompt = helper.getPrompt(makeContext({ taskDescription: 'browse the web' }));
        expect(prompt).toContain('NEVER go more than 2 browser steps');
    });

    it('should include long browsing session guidance', () => {
        const prompt = helper.getPrompt(makeContext({ taskDescription: 'browse the web' }));
        expect(prompt).toContain('Long browsing sessions');
    });
});
