import { describe, it, expect, vi } from 'vitest';
import * as p from '@clack/prompts';
import {
    promptSelect,
    promptText,
    promptConfirm,
    promptMultiSelect,
    withSpinner,
} from '../src/cli/ui/Prompts';

vi.mock('@clack/prompts', () => {
    const symbol = Symbol('cancel');
    return {
        select: vi.fn(),
        text: vi.fn(),
        confirm: vi.fn(),
        multiselect: vi.fn(),
        spinner: vi.fn(() => ({
            start: vi.fn(),
            stop: vi.fn(),
            message: vi.fn(),
        })),
        isCancel: vi.fn((val: any) => val === symbol),
        note: vi.fn(),
        outro: vi.fn(),
        __cancelSymbol: symbol,
    };
});

describe('Prompts UI Component', () => {
    const cancelSymbol = (p as any).__cancelSymbol;

    describe('promptSelect', () => {
        it('returns selected value when valid', async () => {
            vi.mocked(p.select).mockResolvedValueOnce('install');
            const res = await promptSelect('Pick an option:', [
                { label: 'Install', value: 'install' },
                { label: 'Cancel', value: 'cancel' },
            ]);
            expect(res).toBe('install');
        });

        it('returns null on cancel', async () => {
            vi.mocked(p.select).mockResolvedValueOnce(cancelSymbol);
            const res = await promptSelect('Pick an option:', [
                { label: 'Install', value: 'install' },
            ]);
            expect(res).toBeNull();
        });
    });

    describe('promptText', () => {
        it('returns entered string', async () => {
            vi.mocked(p.text).mockResolvedValueOnce('my-tool');
            const res = await promptText('Enter tool name:');
            expect(res).toBe('my-tool');
        });

        it('returns null on cancel', async () => {
            vi.mocked(p.text).mockResolvedValueOnce(cancelSymbol);
            const res = await promptText('Enter tool name:');
            expect(res).toBeNull();
        });
    });

    describe('promptConfirm', () => {
        it('returns boolean choice', async () => {
            vi.mocked(p.confirm).mockResolvedValueOnce(true);
            const res = await promptConfirm('Are you sure?');
            expect(res).toBe(true);
        });

        it('returns null on cancel', async () => {
            vi.mocked(p.confirm).mockResolvedValueOnce(cancelSymbol);
            const res = await promptConfirm('Are you sure?');
            expect(res).toBeNull();
        });
    });

    describe('promptMultiSelect', () => {
        it('returns array of selected values', async () => {
            vi.mocked(p.multiselect).mockResolvedValueOnce(['a', 'b']);
            const res = await promptMultiSelect('Choose items:', [
                { label: 'A', value: 'a' },
                { label: 'B', value: 'b' },
            ]);
            expect(res).toEqual(['a', 'b']);
        });

        it('returns null on cancel', async () => {
            vi.mocked(p.multiselect).mockResolvedValueOnce(cancelSymbol);
            const res = await promptMultiSelect('Choose items:', [
                { label: 'A', value: 'a' },
            ]);
            expect(res).toBeNull();
        });
    });

    describe('withSpinner', () => {
        it('starts spinner, runs task, and stops on success', async () => {
            const task = vi.fn(async (update: (msg: string) => void) => {
                update('working...');
                return 'done';
            });
            const result = await withSpinner('Loading...', task, 'Finished!');
            expect(result).toBe('done');
            expect(task).toHaveBeenCalled();
        });

        it('stops spinner on failure and throws error', async () => {
            const task = vi.fn(async () => {
                throw new Error('boom');
            });
            await expect(withSpinner('Failing...', task)).rejects.toThrow('boom');
        });
    });
});
