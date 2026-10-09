import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToolsManagerMenu } from '../src/cli/screens/ToolsScreen';
import * as Prompts from '../src/cli/ui/Prompts';
import { CliContext } from '../src/cli/context';

describe('ToolsScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;

    beforeEach(() => {
        vi.restoreAllMocks();

        mockAgent = {
            tools: {
                listTools: vi.fn().mockReturnValue([
                    { name: 'bash', active: true, approved: true, description: 'execute commands' },
                    { name: 'browser', active: false, approved: false, description: 'web automation' },
                ]),
                getTool: vi.fn(),
                installTool: vi.fn(),
                approveTool: vi.fn(),
                activateTool: vi.fn(),
                runToolCommand: vi.fn(),
                readToolReadme: vi.fn(),
                uninstallTool: vi.fn(),
            },
            config: {
                get: vi.fn().mockReturnValue(false),
            },
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    it('returns to main menu when back is selected', async () => {
        vi.spyOn(Prompts, 'promptSelect').mockResolvedValue('back');

        await showToolsManagerMenu(mockContext);

        expect(mockAgent.tools.listTools).toHaveBeenCalled();
        expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
    });

    it('returns to main menu when user cancels prompt', async () => {
        vi.spyOn(Prompts, 'promptSelect').mockResolvedValue(null as any);

        await showToolsManagerMenu(mockContext);

        expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
    });
});
