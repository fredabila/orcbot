import { logger } from '../utils/logger';

/**
 * BrowserStateManager - Tracks browser state to prevent infinite loops
 * and improve decision-making during web navigation tasks.
 * 
 * This is a circuit breaker pattern implementation for browser operations.
 */

export interface NavigationEntry {
    url: string;
    timestamp: number;
    action: string;
    success: boolean;
    error?: string;
}

export interface ActionBreadcrumb {
    action: string;
    selector?: string;
    timestamp: number;
    url: string;
    success: boolean;
    error?: string;
}

export class BrowserStateManager {
    private navigationHistory: NavigationEntry[] = [];
    private actionBreadcrumbs: ActionBreadcrumb[] = [];
    private failureCount: Map<string, number> = new Map(); // Track failures by action key
    private maxHistorySize: number = 50;
    private maxBreadcrumbSize: number = 100;
    private circuitBreakerThreshold: number = 5; // Max failures before circuit opens
    private circuitBreakerResetTime: number = 30000; // 30 seconds — reset faster to allow retries with new strategies
    private openCircuits: Map<string, number> = new Map(); // Circuit breaker states (key -> timestamp)

    constructor() {
        logger.info('BrowserStateManager initialized');
    }

    /**
     * Record a navigation event
     */
    recordNavigation(url: string, action: string, success: boolean, error?: string): void {
        const entry: NavigationEntry = {
            url,
            timestamp: Date.now(),
            action,
            success,
            error
        };

        this.navigationHistory.push(entry);
        
        // Trim history to max size
        if (this.navigationHistory.length > this.maxHistorySize) {
            this.navigationHistory.shift();
        }

        // Track failures for circuit breaker
        if (!success) {
            const key = `nav:${url}`;
            const count = (this.failureCount.get(key) || 0) + 1;
            this.failureCount.set(key, count);

            if (count >= this.circuitBreakerThreshold) {
                this.openCircuit(key);
            }
        } else {
            // Reset on success
            this.failureCount.delete(`nav:${url}`);
        }

        logger.debug(`Navigation recorded: ${action} -> ${url} (${success ? 'success' : 'failed'})`);
    }

    /**
     * Record a browser action (click, type, etc.)
     */
    recordAction(action: string, url: string, selector: string | undefined, success: boolean, error?: string): void {
        const breadcrumb: ActionBreadcrumb = {
            action,
            selector,
            timestamp: Date.now(),
            url,
            success,
            error
        };

        this.actionBreadcrumbs.push(breadcrumb);
        
        // Trim breadcrumbs to max size
        if (this.actionBreadcrumbs.length > this.maxBreadcrumbSize) {
            this.actionBreadcrumbs.shift();
        }

        // Track failures for circuit breaker
        if (!success) {
            const key = `action:${action}:${selector || 'none'}:${url}`;
            const count = (this.failureCount.get(key) || 0) + 1;
            this.failureCount.set(key, count);

            if (count >= this.circuitBreakerThreshold) {
                this.openCircuit(key);
            }
        } else {
            // Reset on success
            this.failureCount.delete(`action:${action}:${selector || 'none'}:${url}`);
        }

        logger.debug(`Action recorded: ${action} on ${selector || 'N/A'} at ${url} (${success ? 'success' : 'failed'})`);
    }

    /**
     * Open a circuit breaker for a specific action
     */
    private openCircuit(key: string): void {
        this.openCircuits.set(key, Date.now());
        logger.warn(`Circuit breaker opened for: ${key}`);
    }

    /**
     * Check if a circuit is open for a specific action
     */
    isCircuitOpen(action: string, url: string, selector?: string): boolean {
        const navKey = `nav:${url}`;
        const actionKey = `action:${action}:${selector || 'none'}:${url}`;

        // Check navigation circuit
        const navCircuitTime = this.openCircuits.get(navKey);
        if (navCircuitTime && Date.now() - navCircuitTime < this.circuitBreakerResetTime) {
            return true;
        }

        // Check action circuit
        const actionCircuitTime = this.openCircuits.get(actionKey);
        if (actionCircuitTime && Date.now() - actionCircuitTime < this.circuitBreakerResetTime) {
            return true;
        }

        // Circuit has reset
        if (navCircuitTime && Date.now() - navCircuitTime >= this.circuitBreakerResetTime) {
            this.openCircuits.delete(navKey);
            this.failureCount.delete(navKey);
        }
        if (actionCircuitTime && Date.now() - actionCircuitTime >= this.circuitBreakerResetTime) {
            this.openCircuits.delete(actionKey);
            this.failureCount.delete(actionKey);
        }

        return false;
    }

    /**
     * Detect if we're in a navigation loop (visiting same URL repeatedly)
     */
    detectNavigationLoop(url: string, windowMs: number = 20000): boolean {
        const now = Date.now();
        const recentNavs = this.navigationHistory.filter(
            n => n.url === url && now - n.timestamp < windowMs
        );

        // Only flag as loop if 5+ visits to the exact same URL in a short window.
        // Lower thresholds block legitimate retry patterns (headful retry, ephemeral retry, etc.)
        if (recentNavs.length >= 5) {
            logger.warn(`Navigation loop detected for ${url}: ${recentNavs.length} visits in ${windowMs}ms`);
            return true;
        }

        return false;
    }

    /**
     * Detect if we're repeating the same action on the same element
     */
    detectActionLoop(action: string, selector: string | undefined, windowMs: number = 15000): boolean {
        const now = Date.now();
        const recentActions = this.actionBreadcrumbs.filter(
            a => a.action === action && 
                 a.selector === selector && 
                 now - a.timestamp < windowMs
        );

        // Only flag as loop if 5+ identical actions in a short window.
        // Some interactions legitimately need retries (e.g., force-click after standard click fails).
        if (recentActions.length >= 5) {
            logger.warn(`Action loop detected: ${action} on ${selector || 'N/A'}: ${recentActions.length} times in ${windowMs}ms`);
            return true;
        }

        return false;
    }

    /**
     * Get recent navigation history summary
     */
    getNavigationSummary(limit: number = 10): string {
        const recent = this.navigationHistory.slice(-limit);
        if (recent.length === 0) {
            return 'No navigation history';
        }

        const summary = recent.map((n, idx) => {
            const status = n.success ? '✓' : '✗';
            const elapsed = idx > 0 ? `+${Math.round((n.timestamp - recent[idx - 1].timestamp) / 1000)}s` : '0s';
            return `${status} ${elapsed} ${n.action} -> ${n.url}${n.error ? ` (${n.error})` : ''}`;
        }).join('\n');

        return `Recent navigation (${recent.length}):\n${summary}`;
    }

    /**
     * Get recent action breadcrumbs summary
     */
    getActionSummary(limit: number = 15): string {
        const recent = this.actionBreadcrumbs.slice(-limit);
        if (recent.length === 0) {
            return 'No actions recorded';
        }

        const summary = recent.map((a, idx) => {
            const status = a.success ? '✓' : '✗';
            const elapsed = idx > 0 ? `+${Math.round((a.timestamp - recent[idx - 1].timestamp) / 1000)}s` : '0s';
            return `${status} ${elapsed} ${a.action}${a.selector ? ` [${a.selector}]` : ''}${a.error ? ` (${a.error})` : ''}`;
        }).join('\n');

        return `Recent actions (${recent.length}):\n${summary}`;
    }

    /**
     * Get comprehensive state summary for agent context
     */
    getStateSummary(): string {
        const openCircuits = Array.from(this.openCircuits.keys());
        const circuitInfo = openCircuits.length > 0 
            ? `\n⚠️  Circuit breakers open: ${openCircuits.join(', ')}` 
            : '';

        return `Browser State Summary:
${this.getNavigationSummary(5)}

${this.getActionSummary(10)}${circuitInfo}`;
    }

    /**
     * Reset all state (useful for starting fresh)
     */
    reset(): void {
        this.navigationHistory = [];
        this.actionBreadcrumbs = [];
        this.failureCount.clear();
        this.openCircuits.clear();
        logger.info('BrowserStateManager reset');
    }

    /**
     * Get diagnostic information about current state
     */
    getDiagnostics(): {
        navigationCount: number;
        actionCount: number;
        failureKeys: string[];
        openCircuits: string[];
    } {
        return {
            navigationCount: this.navigationHistory.length,
            actionCount: this.actionBreadcrumbs.length,
            failureKeys: Array.from(this.failureCount.keys()),
            openCircuits: Array.from(this.openCircuits.keys())
        };
    }
}
