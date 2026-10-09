import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showSkillsMenu,
    showCommunitySkillsMenu,
} from '../src/cli/screens/SkillsScreen';
import { CliContext } from '../src/cli/context';

describe('SkillsScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;

    beforeEach(() => {
        vi.restoreAllMocks();

        const mockSkills = {
            getAllSkills: vi.fn(() => [
                { name: 'web-browser', description: 'Web browsing capability', pluginPath: null },
            ]),
            getAgentSkills: vi.fn(() => [
                { meta: { name: 'research-agent', description: 'Deep research' }, activated: true, skillDir: '/tmp/research' },
            ]),
            getAgentSkill: vi.fn(),
            validateSkill: vi.fn(() => ({ valid: true, errors: [] })),
            loadPlugins: vi.fn(),
        };

        mockAgent = {
            skills: mockSkills,
            syncSkillsRegistryNow: vi.fn(() => ({ targets: [] })),
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('showSkillsMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ selection: 'back' });

            await showSkillsMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });

        it('lists core skills when list_core is chosen and prompts back', async () => {
            let call = 0;
            vi.spyOn(inquirer, 'prompt').mockImplementation(async () => {
                call++;
                if (call === 1) return { selection: 'list_core' };
                if (call === 2) return { continue: '' }; // waitKeyPress
                return { selection: 'back' };
            });

            await showSkillsMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showCommunitySkillsMenu', () => {
        it('handles failure to fetch gracefully without throwing', async () => {
            // Mock fetch error
            const originalFetch = global.fetch;
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ continue: '' });

            await expect(showCommunitySkillsMenu(mockContext)).resolves.not.toThrow();

            global.fetch = originalFetch;
        });
    });
});
