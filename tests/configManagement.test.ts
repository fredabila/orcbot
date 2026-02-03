import { describe, expect, it } from 'vitest';
import { ConfigPolicy, ConfigChangeLevel } from '../src/config/ConfigPolicy';
import { ConfigManagementService } from '../src/skills/configManagement';

// Lightweight config stub to avoid touching real disk-backed ConfigManager
class StubConfig {
    private values: Record<string, any>;
    constructor(values: Record<string, any>) {
        this.values = values;
    }
    get(key: string) {
        return this.values[key];
    }
    set(key: string, value: any) {
        this.values[key] = value;
    }
    getAll() {
        return { ...this.values };
    }
}

describe('ConfigPolicy', () => {
    it('identifies safe configuration keys correctly', () => {
        expect(ConfigPolicy.canAutoModify('modelName')).toBe(true);
        expect(ConfigPolicy.canAutoModify('llmProvider')).toBe(true);
        expect(ConfigPolicy.canAutoModify('memoryContextLimit')).toBe(true);
        expect(ConfigPolicy.canAutoModify('maxStepsPerAction')).toBe(true);
    });

    it('identifies locked configuration keys correctly', () => {
        expect(ConfigPolicy.isLocked('telegramToken')).toBe(true);
        expect(ConfigPolicy.isLocked('safeMode')).toBe(true);
        expect(ConfigPolicy.isLocked('sudoMode')).toBe(true);
        expect(ConfigPolicy.isLocked('commandDenyList')).toBe(true);
    });

    it('identifies approval-required configuration keys correctly', () => {
        expect(ConfigPolicy.requiresApproval('openaiApiKey')).toBe(true);
        expect(ConfigPolicy.requiresApproval('googleApiKey')).toBe(true);
        expect(ConfigPolicy.requiresApproval('autonomyEnabled')).toBe(true);
    });

    it('validates configuration values correctly', () => {
        // Valid model name
        const validModel = ConfigPolicy.validate('modelName', 'gpt-4');
        expect(validModel.valid).toBe(true);

        // Invalid model name (empty)
        const invalidModel = ConfigPolicy.validate('modelName', '');
        expect(invalidModel.valid).toBe(false);

        // Valid provider
        const validProvider = ConfigPolicy.validate('llmProvider', 'openai');
        expect(validProvider.valid).toBe(true);

        // Invalid provider
        const invalidProvider = ConfigPolicy.validate('llmProvider', 'invalid-provider');
        expect(invalidProvider.valid).toBe(false);

        // Valid memory limit
        const validMemory = ConfigPolicy.validate('memoryContextLimit', 25);
        expect(validMemory.valid).toBe(true);

        // Invalid memory limit (too high)
        const invalidMemory = ConfigPolicy.validate('memoryContextLimit', 150);
        expect(invalidMemory.valid).toBe(false);
    });

    it('returns correct policy descriptions', () => {
        const safeKeys = ConfigPolicy.getSafeKeys();
        expect(safeKeys).toContain('modelName');
        expect(safeKeys).toContain('llmProvider');
        expect(safeKeys).not.toContain('telegramToken');

        const lockedKeys = ConfigPolicy.getLockedKeys();
        expect(lockedKeys).toContain('telegramToken');
        expect(lockedKeys).toContain('safeMode');
        expect(lockedKeys).not.toContain('modelName');
    });
});

describe('ConfigManagementService', () => {
    it('allows agents to modify safe configuration keys', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ modelName: 'gpt-3.5-turbo' });
        const context = { config: stubConfig, logger: console } as any;

        const result = service.setConfig('modelName', 'gpt-4', 'Testing model change', context);
        
        expect(result.success).toBe(true);
        expect(stubConfig.get('modelName')).toBe('gpt-4');
        expect(result.message).toContain('updated successfully');
    });

    it('blocks agents from modifying locked configuration keys', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ safeMode: false });
        const context = { config: stubConfig, logger: console } as any;

        const result = service.setConfig('safeMode', true, 'Trying to enable safe mode', context);
        
        expect(result.success).toBe(false);
        expect(result.message).toContain('locked');
        expect(stubConfig.get('safeMode')).toBe(false); // Should not change
    });

    it('queues approval-required configuration changes', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ openaiApiKey: 'sk-old-key' });
        const context = { config: stubConfig, logger: console } as any;

        const result = service.setConfig('openaiApiKey', 'sk-new-key', 'Updating API key', context);
        
        expect(result.success).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.message).toContain('requires approval');
        expect(stubConfig.get('openaiApiKey')).toBe('sk-old-key'); // Should not change yet

        const pending = service.getPendingApprovals();
        expect(pending.length).toBe(1);
        expect(pending[0].key).toBe('openaiApiKey');
        expect(pending[0].newValue).toBe('sk-new-key');
    });

    it('applies approved configuration changes', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ openaiApiKey: 'sk-old-key' });
        const context = { config: stubConfig, logger: console } as any;

        // Request change
        service.setConfig('openaiApiKey', 'sk-new-key', 'Updating API key', context);
        
        // Approve change
        const approveResult = service.approvePending('openaiApiKey', context);
        
        expect(approveResult.success).toBe(true);
        expect(stubConfig.get('openaiApiKey')).toBe('sk-new-key'); // Should change now
        expect(service.getPendingApprovals().length).toBe(0); // Queue should be empty
    });

    it('rejects configuration changes', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ openaiApiKey: 'sk-old-key' });
        const context = { config: stubConfig, logger: console } as any;

        // Request change
        service.setConfig('openaiApiKey', 'sk-new-key', 'Updating API key', context);
        
        // Reject change
        const rejectResult = service.rejectPending('openaiApiKey');
        
        expect(rejectResult.success).toBe(true);
        expect(stubConfig.get('openaiApiKey')).toBe('sk-old-key'); // Should not change
        expect(service.getPendingApprovals().length).toBe(0); // Queue should be empty
    });

    it('validates configuration values before modification', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ llmProvider: 'openai' });
        const context = { config: stubConfig, logger: console } as any;

        // Try to set invalid provider
        const result = service.setConfig('llmProvider', 'invalid-provider', 'Testing validation', context);
        
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid value');
        expect(stubConfig.get('llmProvider')).toBe('openai'); // Should not change
    });

    it('tracks configuration change history', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ modelName: 'gpt-3.5-turbo', maxStepsPerAction: 30 });
        const context = { config: stubConfig, logger: console } as any;

        // Make multiple changes
        service.setConfig('modelName', 'gpt-4', 'First change', context);
        service.setConfig('maxStepsPerAction', 50, 'Second change', context);

        const history = service.getHistory();
        
        expect(history.length).toBe(2);
        expect(history[0].key).toBe('modelName');
        expect(history[0].newValue).toBe('gpt-4');
        expect(history[1].key).toBe('maxStepsPerAction');
        expect(history[1].newValue).toBe(50);
    });

    it('suggests configuration optimizations based on task context', () => {
        const service = new ConfigManagementService();
        const stubConfig = new StubConfig({ 
            modelName: 'gpt-3.5-turbo',
            memoryContextLimit: 15,
            maxStepsPerAction: 20
        });
        const context = { config: stubConfig, logger: console } as any;

        // Test code-related task
        const codeSuggestions = service.suggestOptimizations('Write a complex programming algorithm in Python', context);
        expect(codeSuggestions.suggestions.some(s => s.key === 'modelName')).toBe(true);

        // Test complex task
        const complexSuggestions = service.suggestOptimizations(
            'This is a very long and complex task description that requires multiple steps and careful planning ' +
            'to execute properly with extensive context management',
            context
        );
        expect(complexSuggestions.suggestions.some(s => s.key === 'memoryContextLimit')).toBe(true);

        // Test multi-step task
        const workflowSuggestions = service.suggestOptimizations('Execute a multi-step workflow', context);
        expect(workflowSuggestions.suggestions.some(s => s.key === 'maxStepsPerAction')).toBe(true);
    });
});
