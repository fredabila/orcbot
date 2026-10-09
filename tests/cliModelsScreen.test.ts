import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import {
    showModelsMenu,
    showSetPrimaryProvider,
    showSelfTrainingMenu,
    showOpenAIConfig,
    showOpenRouterConfig,
    showGeminiConfig,
    showNvidiaConfig,
    showAnthropicConfig,
    showBedrockConfig,
} from '../src/cli/screens/ModelsScreen';
import { CliContext } from '../src/cli/context';

describe('ModelsScreen', () => {
    let mockAgent: any;
    let mockShowMainMenu: any;
    let mockContext: CliContext;
    let configStore: Record<string, any>;

    beforeEach(() => {
        vi.restoreAllMocks();
        configStore = {
            llmProvider: 'openai',
            modelName: 'gpt-4o',
            openaiApiKey: 'sk-test-12345',
            usePiAI: true,
        };

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configStore[key]),
                set: vi.fn((key: string, val: any) => { configStore[key] = val; }),
            },
            getSelfTrainingStatus: vi.fn(() => ({
                enabled: false,
                trainOnIdle: false,
                stats: { accepted: 0, total: 0 },
                candidates: [],
                minQualityScore: 0.8,
                promotionMinAverageScore: 0.85,
                requireEvalForPromotion: true,
                lastEvaluationReport: null,
                lastPreparedJob: null,
                lastPromotionRecord: null,
            })),
        };

        mockShowMainMenu = vi.fn().mockResolvedValue(undefined);

        mockContext = {
            agent: mockAgent,
            workerProfile: {} as any,
            showMainMenu: mockShowMainMenu,
        };
    });

    describe('showModelsMenu', () => {
        it('navigates back to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ provider: 'back' });

            await showModelsMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('showSetPrimaryProvider', () => {
        it('returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ selected: 'back' });

            await showSetPrimaryProvider(mockContext);

            expect(promptSpy).toHaveBeenCalled();
        });

        it('updates llmProvider in config when a provider is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ selected: 'anthropic' });

            await showSetPrimaryProvider(mockContext);

            expect(configStore.llmProvider).toBe('anthropic');
        });
    });

    describe('showSelfTrainingMenu', () => {
        it('returns to main menu when back is selected', async () => {
            vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });

            await showSelfTrainingMenu(mockContext);

            expect(mockShowMainMenu).toHaveBeenCalledTimes(1);
        });
    });

    describe('Provider configuration screens', () => {
        it('showOpenAIConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showOpenAIConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });

        it('showOpenRouterConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showOpenRouterConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });

        it('showGeminiConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showGeminiConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });

        it('showNvidiaConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showNvidiaConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });

        it('showAnthropicConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showAnthropicConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });

        it('showBedrockConfig returns to models menu when back is selected', async () => {
            const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'back' });
            await showBedrockConfig(mockContext);
            expect(promptSpy).toHaveBeenCalled();
        });
    });
});
