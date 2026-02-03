import { describe, it, expect } from 'vitest';
import { MultiLLM } from '../src/core/MultiLLM';

describe('NVIDIA Provider', () => {
    it('should recognize NVIDIA models', () => {
        const llm = new MultiLLM({ 
            modelName: 'nvidia:moonshotai/kimi-k2.5',
            nvidiaApiKey: 'test-key'
        });
        
        // Test that NVIDIA provider is correctly inferred
        // @ts-ignore - accessing private method for testing
        const provider = llm.inferProvider('nvidia:moonshotai/kimi-k2.5');
        expect(provider).toBe('nvidia');
    });

    it('should recognize nv: prefix', () => {
        const llm = new MultiLLM({ 
            modelName: 'nv:test-model',
            nvidiaApiKey: 'test-key'
        });
        
        // @ts-ignore - accessing private method for testing
        const provider = llm.inferProvider('nv:test-model');
        expect(provider).toBe('nvidia');
    });

    it('should normalize NVIDIA model names', () => {
        const llm = new MultiLLM({ 
            modelName: 'nvidia:moonshotai/kimi-k2.5',
            nvidiaApiKey: 'test-key'
        });
        
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeNvidiaModel('nvidia:moonshotai/kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeNvidiaModel('nv:test-model')).toBe('test-model');
        // @ts-ignore - accessing private method for testing
        expect(llm.normalizeNvidiaModel('moonshotai/kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
    });

    it('should return correct default model for NVIDIA', () => {
        const llm = new MultiLLM({ 
            modelName: 'gpt-4o',
            nvidiaApiKey: 'test-key'
        });
        
        // @ts-ignore - accessing private method for testing
        const defaultModel = llm.getDefaultModelForProvider('nvidia');
        expect(defaultModel).toBe('moonshotai/kimi-k2.5');
    });

    it('should throw error when NVIDIA key is not configured', async () => {
        const originalNvidiaKey = process.env.NVIDIA_API_KEY;
        delete process.env.NVIDIA_API_KEY;

        try {
            const llm = new MultiLLM({ 
                modelName: 'nvidia:test-model'
                // No nvidiaApiKey provided
            });
            
            await expect(
                // @ts-ignore - accessing private method for testing
                llm.callNvidia('test prompt')
            ).rejects.toThrow('NVIDIA API key not configured');
        } finally {
            if (originalNvidiaKey !== undefined) {
                process.env.NVIDIA_API_KEY = originalNvidiaKey;
            } else {
                delete process.env.NVIDIA_API_KEY;
            }
        }
    });
});
