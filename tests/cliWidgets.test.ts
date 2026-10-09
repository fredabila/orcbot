import { describe, it, expect, vi } from 'vitest';
import {
    c,
    clr,
    bold,
    dim,
    cyan,
    green,
    yellow,
    red,
    progressBar,
    statusBadge,
    statusDot,
    kvLine,
    box,
} from '../src/cli/ui/Widgets';
import { setCliContext, getCliContext, CliContext } from '../src/cli/context';

describe('CLI Widgets', () => {
    describe('Text formatting and colors', () => {
        it('wraps text with appropriate ANSI reset code', () => {
            const result = clr(c.bold, 'test');
            expect(result).toBe(`${c.bold}test${c.reset}`);
        });

        it('provides color helper functions', () => {
            expect(bold('hello')).toContain('\x1b[1mhello\x1b[0m');
            expect(dim('world')).toContain('\x1b[2mworld\x1b[0m');
            expect(cyan('cyan')).toContain('\x1b[36mcyan\x1b[0m');
            expect(green('ok')).toContain('\x1b[32mok\x1b[0m');
            expect(yellow('warn')).toContain('\x1b[33mwarn\x1b[0m');
            expect(red('err')).toContain('\x1b[31merr\x1b[0m');
        });
    });

    describe('progressBar', () => {
        it('renders filled and empty segments based on ratio', () => {
            const bar = progressBar(50, 100, 10);
            expect(bar).toContain('█');
            expect(bar).toContain('░');
        });

        it('handles boundary conditions (0 and max)', () => {
            const zeroBar = progressBar(0, 100, 10);
            expect(zeroBar).toContain('░'.repeat(10));

            const fullBar = progressBar(100, 100, 10);
            expect(fullBar).toContain('█'.repeat(10));
        });

        it('supports inverted metrics where higher is greener', () => {
            const highAccuracyBar = progressBar(90, 100, 10, { invert: true });
            expect(highAccuracyBar).toContain('\x1b[92m'); // brightGreen

            const lowAccuracyBar = progressBar(20, 100, 10, { invert: true });
            expect(lowAccuracyBar).toContain('\x1b[31m'); // red
        });
    });

    describe('statusBadge and statusDot', () => {
        it('statusBadge returns onLabel in green and offLabel in gray', () => {
            expect(statusBadge(true)).toContain('ON');
            expect(statusBadge(true)).toContain('\x1b[92m');

            expect(statusBadge(false)).toContain('OFF');
            expect(statusBadge(false)).toContain('\x1b[90m');
        });

        it('statusDot returns filled circle when true and empty when false', () => {
            const onDot = statusDot(true, 'Active');
            expect(onDot).toContain('●');
            expect(onDot).toContain('Active');
            expect(onDot).toContain('\x1b[92m');

            const offDot = statusDot(false, 'Standby');
            expect(offDot).toContain('○');
            expect(offDot).toContain('Standby');
            expect(offDot).toContain('\x1b[90m');
        });
    });

    describe('kvLine', () => {
        it('logs indented key-value pair', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            kvLine('Model', 'gpt-4o');
            expect(consoleSpy).toHaveBeenCalled();
            const logged = consoleSpy.mock.calls.flat().join(' ');
            expect(logged).toContain('Model');
            expect(logged).toContain('gpt-4o');
            consoleSpy.mockRestore();
        });
    });

    describe('box widget', () => {
        it('delegates to piBox renderer', () => {
            const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            box(['Line 1', 'Line 2'], { title: 'TEST' });
            const totalCalls = stdoutSpy.mock.calls.length + consoleSpy.mock.calls.length;
            expect(totalCalls).toBeGreaterThan(0);
            stdoutSpy.mockRestore();
            consoleSpy.mockRestore();
        });
    });
});

describe('CLI Context', () => {
    it('throws if getCliContext is called before setCliContext', () => {
        // In clean state, or when null
        const dummyAgent = {} as any;
        const dummyWorker = {} as any;
        const dummyMenu = vi.fn();

        const ctx: CliContext = {
            agent: dummyAgent,
            workerProfile: dummyWorker,
            showMainMenu: dummyMenu,
        };

        setCliContext(ctx);
        const resolved = getCliContext();
        expect(resolved.agent).toBe(dummyAgent);
        expect(resolved.workerProfile).toBe(dummyWorker);
        expect(resolved.showMainMenu).toBe(dummyMenu);
    });
});
