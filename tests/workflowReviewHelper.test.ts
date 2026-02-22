import { describe, expect, it } from 'vitest';
import { buildWorkflowSignalLog, buildWorkflowSignalMemory, shouldInjectWorkflowSignal } from '../src/core/WorkflowReviewHelper';

describe('WorkflowReviewHelper', () => {
    it('injects signals for errors and slow tool executions', () => {
        expect(shouldInjectWorkflowSignal({
            actionId: 'a1',
            step: 3,
            toolName: 'browser_click',
            level: 'error',
        })).toBe(true);

        expect(shouldInjectWorkflowSignal({
            actionId: 'a1',
            step: 3,
            toolName: 'browser_click',
            level: 'error',
            hasExistingErrorGuidance: true,
        })).toBe(false);

        expect(shouldInjectWorkflowSignal({
            actionId: 'a1',
            step: 4,
            toolName: 'browser_wait',
            level: 'info',
            toolDurationMs: 13_000,
        })).toBe(true);

        expect(shouldInjectWorkflowSignal({
            actionId: 'a1',
            step: 5,
            toolName: 'browser_wait',
            level: 'info',
            toolDurationMs: 2_000,
        })).toBe(false);
    });

    it('builds memory guidance with fallback hints', () => {
        const memory = buildWorkflowSignalMemory({
            actionId: 'a2',
            step: 6,
            toolName: 'run_command',
            level: 'error',
            toolDurationMs: 14_200,
            errorMessage: 'Command timed out after several retries',
            consecutiveFailures: 2,
            queuedToolsSkipped: 1,
        });

        expect(memory).toContain('WORKFLOW_SIGNAL');
        expect(memory).toContain('queued_tools_skipped=1');
        expect(memory).toContain('fallback path');
        expect(memory).toContain('batch was paused');
        expect(memory.length).toBeLessThanOrEqual(480);
    });

    it('formats concise workflow logs', () => {
        const line = buildWorkflowSignalLog({
            actionId: 'a3',
            step: 2,
            toolName: 'send_file',
            level: 'warn',
            toolDurationMs: 12_300,
            consecutiveFailures: 1,
        });

        expect(line).toContain('WorkflowSignal');
        expect(line).toContain('tool=send_file');
        expect(line).toContain('duration=12300ms');
    });
});
