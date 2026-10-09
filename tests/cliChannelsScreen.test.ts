import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showConnectionsMenu,
    toggleAutonomyChannel,
    isAutonomyEnabledForChannel,
} from '../src/cli/screens/ChannelsScreen';
import { CliContext } from '../src/cli/context';

describe('ChannelsScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            autonomyAllowedChannels: ['telegram'],
            telegramToken: '123456:ABC-DEF',
            whatsappEnabled: true,
        };

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('Autonomy helpers', () => {
        it('checks if autonomy is enabled for a given channel', () => {
            expect(isAutonomyEnabledForChannel('telegram', mockContext)).toBe(true);
            expect(isAutonomyEnabledForChannel('discord', mockContext)).toBe(false);
        });

        it('toggles channel autonomy on and off correctly', () => {
            toggleAutonomyChannel('discord', mockContext);
            expect(configStore.autonomyAllowedChannels).toContain('discord');

            toggleAutonomyChannel('telegram', mockContext);
            expect(configStore.autonomyAllowedChannels).not.toContain('telegram');
        });
    });

    describe('showConnectionsMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ channel: 'back' });

            await showConnectionsMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });
});
