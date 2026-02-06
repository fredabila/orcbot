/**
 * PromptHelper — Base interface for modular prompt helpers.
 * 
 * Each helper is a focused prompt module that injects task-specific instructions
 * into the agent's system prompt. Helpers are composable and route-selected
 * based on task analysis, so simple tasks get lean prompts and complex tasks
 * get laser-focused guidance.
 * 
 * Inspired by OpenClaw's modular system prompt architecture.
 */

export interface PromptHelperContext {
    /** The current task description */
    taskDescription: string;
    /** Action metadata (source, sourceId, senderName, currentStep, messagesSent, etc.) */
    metadata: Record<string, any>;
    /** Available skills prompt string */
    availableSkills: string;
    /** Agent identity string */
    agentIdentity: string;
    /** Whether this is the first step of the action */
    isFirstStep: boolean;
    /** System context (OS/platform info) */
    systemContext: string;
    /** Bootstrap context sections (IDENTITY, SOUL, AGENTS, etc.) */
    bootstrapContext: Record<string, string>;
    /** Channel-specific instructions if applicable */
    channelInstructions?: string;
    /** Contact profile for current sender (WhatsApp) */
    contactProfile?: string;
    /** Whether profiling is enabled */
    profilingEnabled?: boolean;
}

export interface PromptHelper {
    /** Unique name for this helper */
    readonly name: string;
    /** Short description of what this helper provides */
    readonly description: string;
    /** Priority for ordering in the final prompt (lower = earlier). Core helpers: 0-10, domain: 20-90 */
    readonly priority: number;
    /** Whether this helper should always be included regardless of task content */
    readonly alwaysActive: boolean;

    /**
     * Determine if this helper should activate for the given task.
     * Only called when alwaysActive is false.
     */
    shouldActivate(context: PromptHelperContext): boolean;

    /**
     * Generate the prompt section for this helper.
     * Should return a focused, self-contained instruction block.
     */
    getPrompt(context: PromptHelperContext): string;
}
