import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showSecurityMenu,
    showAdminUsersMenu,
} from '../src/cli/screens/SecurityScreen';
import { CliContext } from '../src/cli/context';

describe('SecurityScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            safeMode: false,
            sudoMode: false,
            overrideMode: false,
            enableSelfModification: false,
            commandAllowList: ['git', 'npm'],
            commandDenyList: ['rm -rf'],
            adminUsers: {
                telegram: ['123456'],
            },
        };

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
            getKnownUsers: vi.fn(() => []),
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('showSecurityMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showSecurityMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });

        it('toggles safeMode in config', async () => {
            let call = 0;
            vi.spyOn(inquirer, 'prompt').mockImplementation(async () => {
                call++;
                if (call === 1) return { action: 'toggle_safe' };
                if (call === 2) return { continue: '' }; // waitKeyPress
                return { action: 'back' };
            });

            await showSecurityMenu(mockContext);

            expect(configStore.safeMode).toBe(true);
        });
    });

    describe('showAdminUsersMenu', () => {
        it('returns to security menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showAdminUsersMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });
});
