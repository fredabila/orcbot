import { Agent } from '../core/Agent';
import { WorkerProfileManager } from '../core/WorkerProfile';

export interface CliContext {
    agent: Agent;
    workerProfile: WorkerProfileManager;
    showMainMenu: () => Promise<void>;
}

let activeContext: CliContext | null = null;

/**
 * Register the active CLI context for screen navigation.
 */
export function setCliContext(ctx: CliContext): void {
    activeContext = ctx;
}

/**
 * Access the active CLI context. Throws if accessed before CLI bootstrapping.
 */
export function getCliContext(): CliContext {
    if (!activeContext) {
        throw new Error('CLI Context has not been initialized. Ensure setCliContext() is called during CLI startup.');
    }
    return activeContext;
}
