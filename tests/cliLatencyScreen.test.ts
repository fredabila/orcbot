import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showLatencyMenu,
    runLatencyBenchmark,
    formatMs,
    latencyColor,
    buildBenchmarkSummaryLines,
} from '../src/cli/screens/LatencyScreen';
import { CliContext } from '../src/cli/context';

describe('LatencyScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;

    beforeEach(() => {
        vi.restoreAllMocks();

        mockAgent = {
            bootstrap: {
                loadBootstrapContext: vi.fn(),
                _cache: { clear: vi.fn() },
            },
            memory: {
                saveMemory: vi.fn(),
                searchMemory: vi.fn(() => []),
                flushToDisk: vi.fn(),
                getRecentContext: vi.fn(() => []),
            },
            config: {
                get: vi.fn((key: string) => (key === 'model' ? 'gpt-4o' : undefined)),
            },
            actionQueue: {
                getNext: vi.fn(),
                getQueue: vi.fn(() => []),
            },
            skills: {
                matchSkillsForTask: vi.fn(() => []),
            },
            llm: {
                callFast: vi.fn().mockResolvedValue('pong'),
                call: vi.fn().mockResolvedValue('pong'),
            },
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('formatting helpers', () => {
        it('formats milliseconds correctly', () => {
            expect(formatMs(0.5)).toContain('µs');
            expect(formatMs(12.34)).toBe('12.3ms');
            expect(formatMs(1500)).toBe('1.50s');
            expect(formatMs(-1)).toBe('FAILED');
        });

        it('assigns color functions based on thresholds', () => {
            expect(typeof latencyColor(10)).toBe('function');
            expect(typeof latencyColor(100)).toBe('function');
            expect(typeof latencyColor(300)).toBe('function');
            expect(typeof latencyColor(800)).toBe('function');
            expect(typeof latencyColor(-1)).toBe('function');
        });

        it('builds summary lines with bar visualizers', () => {
            const results = [
                { name: 'Operation A', latencyMs: 5 },
                { name: 'Operation B', latencyMs: -1, error: 'Network timeout' },
            ];
            const lines = buildBenchmarkSummaryLines(results);
            expect(lines.length).toBe(2);
            expect(lines[0]).toContain('Operation A');
            expect(lines[1]).toContain('FAILED');
        });
    });

    describe('showLatencyMenu', () => {
        it('navigates back to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showLatencyMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });

        it('supports inspecting detailed operations and returning back', async () => {
            let promptCall = 0;
            vi.spyOn(inquirer, 'prompt').mockImplementation(async () => {
                promptCall++;
                if (promptCall === 1) return { action: 'inspect' };
                if (promptCall === 2) return { selection: '0' }; // select first operation
                if (promptCall === 3) return { continue: '' }; // waitKeyPress in operation detail
                if (promptCall === 4) return { selection: 'back' }; // back to benchmark summary
                return { action: 'back' }; // back to main menu
            });

            await showLatencyMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('runLatencyBenchmark (CLI mode)', () => {
        it('executes in non-interactive CLI mode without throwing', async () => {
            await expect(runLatencyBenchmark({ includeLLM: false, interactive: false, context: mockContext })).resolves.not.toThrow();
            expect(mockAgent.bootstrap.loadBootstrapContext).toHaveBeenCalled();
        });
    });
});
