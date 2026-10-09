import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showWorkerProfileMenu,
    showWorkerWebsitesMenu,
    showAgenticUserMenu,
} from '../src/cli/screens/WorkerProfileScreen';
import { CliContext } from '../src/cli/context';

describe('WorkerProfileScreen', () => {
    let mockAgent: any;
    let mockWorkerProfile: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            agenticUserEnabled: false,
            agenticUserResponseDelay: 10,
            agenticUserConfidenceThreshold: 80,
            agenticUserProactiveGuidance: false,
            agenticUserProactiveStepThreshold: 5,
            agenticUserCheckInterval: 15,
            agenticUserMaxInterventions: 3,
            agenticUserNotifyUser: true,
        };

        const mockAgenticUser = {
            getSettings: vi.fn(() => ({
                enabled: configStore.agenticUserEnabled,
                responseDelay: configStore.agenticUserResponseDelay,
                confidenceThreshold: configStore.agenticUserConfidenceThreshold,
                proactiveGuidance: configStore.agenticUserProactiveGuidance,
                proactiveStepThreshold: configStore.agenticUserProactiveStepThreshold,
                checkIntervalSeconds: configStore.agenticUserCheckInterval,
                maxInterventionsPerAction: configStore.agenticUserMaxInterventions,
            })),
            getStats: vi.fn(() => ({
                totalInterventions: 0,
                appliedInterventions: 0,
                activeTimers: 0,
            })),
            isActive: vi.fn(() => false),
            reloadSettings: vi.fn(),
            getInterventionLog: vi.fn(() => []),
            clearHistory: vi.fn(),
        };

        mockAgent = {
            agenticUser: mockAgenticUser,
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
        };

        mockWorkerProfile = {
            exists: vi.fn(() => true),
            get: vi.fn(() => ({
                handle: 'alice',
                displayName: 'Alice Wonder',
                bio: 'AI Assistant',
                email: 'alice@example.com',
                password: true,
                avatarUrl: null,
                websites: [
                    { name: 'GitHub', url: 'https://github.com/alice', username: 'alice' }
                ],
            })),
            create: vi.fn(),
            update: vi.fn(),
            setEmail: vi.fn(),
            setPassword: vi.fn(),
            addWebsite: vi.fn(),
            removeWebsite: vi.fn(),
            delete: vi.fn(),
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: mockWorkerProfile,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('showWorkerProfileMenu', () => {
        it('navigates back to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showWorkerProfileMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });

        it('prompts to create profile if none exists, returns to main menu if declined', async () => {
            mockWorkerProfile.exists.mockReturnValue(false);
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ create: false });

            await showWorkerProfileMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showWorkerWebsitesMenu', () => {
        it('returns to worker profile menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showWorkerWebsitesMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });

    describe('showAgenticUserMenu', () => {
        it('navigates back to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showAgenticUserMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });

        it('toggles agentic user status in config', async () => {
            let callCount = 0;
            vi.spyOn(inquirer, 'prompt').mockImplementation(async () => {
                callCount++;
                if (callCount === 1) return { action: 'toggle' };
                if (callCount === 2) return { continue: '' }; // waitKeyPress
                return { action: 'back' };
            });

            await showAgenticUserMenu(mockContext);

            expect(configStore.agenticUserEnabled).toBe(true);
            expect(mockAgent.agenticUser.reloadSettings).toHaveBeenCalled();
        });
    });
});
