import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    parseWorldSources,
    parseGlobeArgs,
    showPushTaskMenu,
    showWorldEventsMenu,
    showWorldGovernanceMenu,
    showOrchestrationMenu,
} from '../src/cli/screens/WorldGovernanceScreen';
import { CliContext } from '../src/cli/context';

describe('WorldGovernanceScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            worldPath: '/tmp/WORLD.md',
            worldEventsSources: ['gdelt'],
            worldEventsRefreshSeconds: 60,
            worldEventsLookbackMinutes: 60,
            worldEventsMaxRecords: 250,
            worldEventsBatchMinutes: 10,
            worldEventsStoreEnabled: true,
            worldEventsGdeltQuery: 'global',
            worldEventsGlobeRenderer: 'ascii',
            worldEventsGlobeCommand: 'globe',
            worldEventsGlobeArgs: [],
        };

        const mockOrchestrator = {
            getStatus: vi.fn(() => ({
                activeAgents: 1,
                runningWorkers: 0,
                pendingTasks: 0,
                completedTasks: 5,
                failedTasks: 0,
                idleAgents: 1,
                workingAgents: 0,
            })),
            getRunningWorkers: vi.fn(() => []),
            getDetailedWorkerStatus: vi.fn(() => []),
            getAggregateWorkerTokenUsage: vi.fn(() => []),
            listAgents: vi.fn(() => [{ id: 'primary', name: 'Primary Agent', status: 'idle', createdAt: Date.now(), capabilities: [], activeTasks: 0 }]),
            getAgents: vi.fn(() => []),
            getAgent: vi.fn(() => null),
            isWorkerRunning: vi.fn(() => false),
        };

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
            orchestrator: mockOrchestrator,
            pushTask: vi.fn().mockResolvedValue(undefined),
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('Parsing helpers', () => {
        it('parses world sources correctly', () => {
            expect(parseWorldSources('gdelt,usgs')).toEqual(['gdelt', 'usgs']);
            expect(parseWorldSources(['gdelt', 'invalid', 'opensky'])).toEqual(['gdelt', 'opensky']);
            expect(parseWorldSources('')).toEqual(['gdelt']);
        });

        it('parses globe arguments correctly', () => {
            expect(parseGlobeArgs('--color --grid')).toEqual(['--color', '--grid']);
            expect(parseGlobeArgs(['--color', '--grid'])).toEqual(['--color', '--grid']);
            expect(parseGlobeArgs('')).toEqual([]);
        });
    });

    describe('showPushTaskMenu', () => {
        it('returns to main menu when empty task is provided', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ task: '' });

            await showPushTaskMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
            expect(mockAgent.pushTask).not.toHaveBeenCalled();
        });

        it('pushes task when a description is given and returns to main menu', async () => {
            let call = 0;
            vi.spyOn(inquirer, 'prompt').mockImplementation(async () => {
                call++;
                if (call === 1) return { task: 'Investigate anomaly' };
                if (call === 2) return { priority: 7 };
                return { continue: '' };
            });

            await showPushTaskMenu(mockContext);

            expect(mockAgent.pushTask).toHaveBeenCalledWith('Investigate anomaly', 7);
            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showWorldEventsMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showWorldEventsMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showWorldGovernanceMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showWorldGovernanceMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showOrchestrationMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showOrchestrationMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });
});
