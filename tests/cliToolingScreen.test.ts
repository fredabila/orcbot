import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showToolingMenu,
    showBrowserMenu,
    showGoogleIdentityMenu,
    showGoogleWorkspaceCliMenu,
    showGitHubCliMenu,
    showGatewayMenu,
} from '../src/cli/screens/ToolingScreen';
import { CliContext } from '../src/cli/context';

describe('ToolingScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            browserEngine: 'puppeteer',
            googleComputerUseEnabled: false,
            gatewayPort: 3100,
            gatewayHost: '0.0.0.0',
            mcpPort: 3190,
            mcpHost: '0.0.0.0',
            mcpPath: '/mcp',
            autonomyAllowedChannels: ['gateway-chat'],
        };

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
            googleIdentity: {
                getStatus: vi.fn(() => ({ connected: false })),
            },
            googleWorkspaceCli: {
                getStatus: vi.fn().mockResolvedValue({ installed: false }),
            },
            githubCli: {
                getStatus: vi.fn().mockResolvedValue({ installed: false }),
            },
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('showToolingMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ tool: 'back' });

            await showToolingMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showBrowserMenu', () => {
        it('returns to tooling menu when back is selected', async () => {
            // Two prompts, not one: this sub-menu's Back delegates into showToolingMenu, which
            // reads a different prompt key (`tool`). A single constant {action:'back'} leaves the
            // tooling menu with an unrecognised action, and its unconditional tail re-enters
            // itself forever - which is what blew the heap and killed the whole worker.
            const promptSpy = vi.spyOn(inquirer, 'prompt')
                .mockResolvedValueOnce({ action: 'back' })
                .mockResolvedValueOnce({ tool: 'back' });

            await showBrowserMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });

    describe('showGoogleIdentityMenu', () => {
        it('returns to tooling menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt')
                .mockResolvedValueOnce({ action: 'back' })
                .mockResolvedValueOnce({ tool: 'back' });

            await showGoogleIdentityMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });

    describe('showGoogleWorkspaceCliMenu', () => {
        it('returns to tooling menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt')
                .mockResolvedValueOnce({ action: 'back' })
                .mockResolvedValueOnce({ tool: 'back' });

            await showGoogleWorkspaceCliMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });

    describe('showGitHubCliMenu', () => {
        it('returns to tooling menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt')
                .mockResolvedValueOnce({ action: 'back' })
                .mockResolvedValueOnce({ tool: 'back' });

            await showGitHubCliMenu(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });
    });

    describe('showGatewayMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showGatewayMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });
});
