/**
 * PromptRouter — Analyzes task context and selects which PromptHelpers to activate.
 * 
 * The router examines the task description, metadata, and execution state to
 * determine which helper modules are relevant. It then composes the selected
 * helpers' prompts into a single optimized system prompt.
 * 
 * This replaces the monolithic prompt approach with targeted, composable modules.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';
import { CoreHelper } from './CoreHelper';
import { ToolingHelper } from './ToolingHelper';
import { CommunicationHelper } from './CommunicationHelper';
import { BrowserHelper } from './BrowserHelper';
import { ResearchHelper } from './ResearchHelper';
import { SchedulingHelper } from './SchedulingHelper';
import { MediaHelper } from './MediaHelper';
import { ProfileHelper } from './ProfileHelper';
import { logger } from '../../utils/logger';

export interface RouteResult {
    /** Names of activated helpers */
    activeHelpers: string[];
    /** The composed system prompt from all active helpers */
    composedPrompt: string;
    /** Estimated token savings vs monolithic prompt */
    estimatedSavings: number;
}

export class PromptRouter {
    private helpers: PromptHelper[] = [];

    constructor() {
        // Register all built-in helpers
        this.register(new CoreHelper());
        this.register(new ToolingHelper());
        this.register(new CommunicationHelper());
        this.register(new BrowserHelper());
        this.register(new ResearchHelper());
        this.register(new SchedulingHelper());
        this.register(new MediaHelper());
        this.register(new ProfileHelper());
    }

    /**
     * Register a custom helper (e.g., from a plugin).
     */
    public register(helper: PromptHelper): void {
        // Replace if same name exists
        this.helpers = this.helpers.filter(h => h.name !== helper.name);
        this.helpers.push(helper);
        // Sort by priority
        this.helpers.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Remove a helper by name.
     */
    public unregister(name: string): void {
        this.helpers = this.helpers.filter(h => h.name !== name);
    }

    /**
     * Get all registered helper names.
     */
    public getHelperNames(): string[] {
        return this.helpers.map(h => h.name);
    }

    /**
     * Route a task through the helper system and compose the optimized prompt.
     */
    public route(context: PromptHelperContext): RouteResult {
        const activeHelpers: string[] = [];
        const promptSections: string[] = [];
        let totalMonolithicSize = 0;

        for (const helper of this.helpers) {
            // Get the full prompt regardless (to estimate savings)
            const prompt = helper.getPrompt(context);
            totalMonolithicSize += prompt.length;

            const isActive = helper.alwaysActive || helper.shouldActivate(context);

            if (isActive) {
                activeHelpers.push(helper.name);
                if (prompt.trim()) {
                    promptSections.push(prompt);
                }
            }
        }

        const composedPrompt = promptSections.join('\n\n');
        const estimatedSavings = Math.max(0, totalMonolithicSize - composedPrompt.length);

        if (estimatedSavings > 500) {
            logger.debug(`PromptRouter: Saved ~${estimatedSavings} chars by routing [${activeHelpers.join(', ')}]`);
        }
        logger.debug(`PromptRouter: Active helpers for task: [${activeHelpers.join(', ')}]`);

        return {
            activeHelpers,
            composedPrompt,
            estimatedSavings
        };
    }

    /**
     * Preview which helpers would activate for a task (useful for debugging).
     */
    public preview(context: PromptHelperContext): { name: string; active: boolean; reason: string }[] {
        return this.helpers.map(helper => {
            if (helper.alwaysActive) {
                return { name: helper.name, active: true, reason: 'always active' };
            }
            const active = helper.shouldActivate(context);
            return {
                name: helper.name,
                active,
                reason: active ? 'task match' : 'not relevant'
            };
        });
    }
}
