import { PromptHelper, PromptHelperContext } from './PromptHelper';
import { Environment } from '../utils/Environment';

/**
 * EnvironmentHelper — Provides contextual knowledge about the host/environment.
 * Always active to ensure the agent knows its constraints and capabilities.
 */
export class EnvironmentHelper implements PromptHelper {
    readonly name = 'environment';
    readonly description = 'Detailed host environment, resource limits, and system constraints';
    readonly priority = 5; // After core but before domain helpers
    readonly alwaysActive = true;

    shouldActivate(): boolean {
        return true;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return Environment.getSystemPromptSnippet();
    }
}
