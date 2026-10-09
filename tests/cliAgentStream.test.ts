import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { AgentStreamRenderer } from '../src/cli/ui/AgentStreamRenderer';

describe('AgentStreamRenderer', () => {
    let bus: EventBus;
    let renderer: AgentStreamRenderer;
    let logSpy: any;

    beforeEach(() => {
        bus = (EventBus as any).getInstance();
        renderer = new AgentStreamRenderer(bus);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        renderer.detach();
        vi.restoreAllMocks();
    });

    it('subscribes to EventBus on attach and unsubscribes on detach', () => {
        renderer.attach();
        bus.emit('task:step:start' as any, { step: 1, reasoning: 'Testing step' });
        expect(logSpy).toHaveBeenCalled();

        logSpy.mockClear();
        renderer.detach();
        bus.emit('task:step:start' as any, { step: 2 });
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('renders successful tool result with checkmark and duration', () => {
        renderer.attach();
        bus.emit('tool:result' as any, {
            toolName: 'read_codebase_file',
            success: true,
            durationMs: 42,
            result: 'File contents returned',
        });

        const output = logSpy.mock.calls.flat().join(' ');
        expect(output).toContain('read_codebase_file');
        expect(output).toContain('✔');
        expect(output).toContain('42ms');
    });

    it('renders failed tool result with cross mark and error message', () => {
        renderer.attach();
        bus.emit('tool:result' as any, {
            toolName: 'run_command',
            success: false,
            durationMs: 120,
            error: 'Command exited with code 1',
        });

        const output = logSpy.mock.calls.flat().join(' ');
        expect(output).toContain('run_command');
        expect(output).toContain('✖');
        expect(output).toContain('failed');
        expect(output).toContain('Command exited with code 1');
    });

    it('renders task completion card with summary and stats', () => {
        renderer.attach();
        bus.emit('task:complete' as any, {
            actionId: 'act-123',
            summary: 'Refactored TUI components successfully',
            steps: 4,
            durationMs: 2500,
            tokens: 1800,
        });

        const output = logSpy.mock.calls.flat().join(' ');
        expect(output).toContain('Task Complete');
        expect(output).toContain('Refactored TUI components successfully');
        expect(output).toContain('4 steps');
        expect(output).toContain('2.5s');
        expect(output).toContain('1800 tokens');
    });
});
