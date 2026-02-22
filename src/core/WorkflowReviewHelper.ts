export type WorkflowSignalLevel = 'info' | 'warn' | 'error';

export interface WorkflowSignalInput {
    hasExistingErrorGuidance?: boolean;
    actionId: string;
    step: number;
    toolName: string;
    level: WorkflowSignalLevel;
    toolDurationMs?: number;
    errorMessage?: string;
    consecutiveFailures?: number;
    queuedToolsSkipped?: number;
}

const SLOW_TOOL_THRESHOLD_MS = 12_000;

function summarizeError(errorMessage?: string): string {
    if (!errorMessage) return '';
    const compact = errorMessage.replace(/\s+/g, ' ').trim();
    return compact.length > 220 ? `${compact.slice(0, 219)}…` : compact;
}

export function shouldInjectWorkflowSignal(input: WorkflowSignalInput): boolean {
    if (input.level === 'warn') return true;
    if (input.level === 'error') {
        // Avoid polluting step memory when richer tool-specific error guidance already exists.
        if (input.hasExistingErrorGuidance) return false;
        return true;
    }
    return Number(input.toolDurationMs || 0) >= SLOW_TOOL_THRESHOLD_MS;
}

export function buildWorkflowSignalMemory(input: WorkflowSignalInput): string {
    const parts: string[] = [];

    if (typeof input.toolDurationMs === 'number') {
        parts.push(`duration=${Math.round(input.toolDurationMs)}ms`);
    }
    if (input.consecutiveFailures && input.consecutiveFailures > 0) {
        parts.push(`consecutive_failures=${input.consecutiveFailures}`);
    }
    if (input.queuedToolsSkipped && input.queuedToolsSkipped > 0) {
        parts.push(`queued_tools_skipped=${input.queuedToolsSkipped}`);
    }

    const hints: string[] = [];
    if (input.level === 'error') {
        hints.push('Do not repeat the exact same failing call without changing inputs or strategy.');
        hints.push('State what failed and choose a fallback path.');
    } else if ((input.consecutiveFailures || 0) >= 2) {
        hints.push('Failure pattern detected. Switch tools or adjust parameters before retrying.');
    }

    if (Number(input.toolDurationMs || 0) >= SLOW_TOOL_THRESHOLD_MS) {
        hints.push('This step was slow. Send a brief progress update if the user has not been updated recently.');
    }

    if ((input.queuedToolsSkipped || 0) > 0) {
        hints.push('A batch was paused after failure. Re-plan from the latest error context first.');
    }

    const detailSuffix = parts.length ? ` Details: ${parts.join(' | ')}.` : '';
    const error = summarizeError(input.errorMessage);
    const errorSuffix = error ? ` Error: ${error}.` : '';
    const hintSuffix = hints.length ? ` Guidance: ${hints.join(' ')}` : '';

    const raw = `[SYSTEM: WORKFLOW_SIGNAL level=${input.level.toUpperCase()} tool=${input.toolName} step=${input.step}.${detailSuffix}${errorSuffix}${hintSuffix}]`;
    return raw.length > 480 ? `${raw.slice(0, 479)}…` : raw;
}

export function buildWorkflowSignalLog(input: WorkflowSignalInput): string {
    const duration = typeof input.toolDurationMs === 'number' ? ` duration=${Math.round(input.toolDurationMs)}ms` : '';
    const failures = input.consecutiveFailures ? ` failures=${input.consecutiveFailures}` : '';
    const skipped = input.queuedToolsSkipped ? ` skipped=${input.queuedToolsSkipped}` : '';
    const error = summarizeError(input.errorMessage);
    const errorPart = error ? ` error="${error}"` : '';
    return `WorkflowSignal action=${input.actionId} step=${input.step} tool=${input.toolName} level=${input.level}${duration}${failures}${skipped}${errorPart}`;
}
