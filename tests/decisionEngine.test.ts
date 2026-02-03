import { describe, expect, it, vi } from 'vitest';
import { DecisionEngine } from '../src/core/DecisionEngine';
import { MemoryManager } from '../src/memory/MemoryManager';
import { MultiLLM } from '../src/core/MultiLLM';
import { SkillsManager } from '../src/core/SkillsManager';
import { ConfigManager } from '../src/config/ConfigManager';

describe('DecisionEngine - System Prompt Persistence', () => {
  it('should include core instructions (tool awareness) in both main and review LLM calls', async () => {
    // Track all LLM calls
    const llmCalls: Array<{ prompt: string; systemMessage?: string }> = [];
    
    // Create a mock LLM that records calls
    const mockLLM = {
      call: vi.fn(async (prompt: string, systemMessage?: string) => {
        llmCalls.push({ prompt, systemMessage });
        
        // First call (main decision) - agent wants to terminate
        if (llmCalls.length === 1) {
          return JSON.stringify({
            action: 'THOUGHT',
            reasoning: 'Task seems complete',
            verification: {
              goals_met: true,
              analysis: 'User greeted, responding now'
            },
            tools: []
          });
        }
        
        // Second call (review layer) - reviewer agrees
        return JSON.stringify({
          verification: {
            goals_met: true,
            analysis: 'Task is genuinely complete'
          },
          tools: []
        });
      })
    } as any;

    // Create minimal stubs
    const mockMemory = {
      getUserContext: () => ({ raw: 'Test user' }),
      getRecentContext: () => [],
      getContactProfile: () => null
    } as any;

    const mockSkills = {
      getSkillsPrompt: () => 'Available Skills:\n- send_telegram\n- web_search',
      getAllSkills: () => [
        { name: 'send_telegram' },
        { name: 'web_search' }
      ]
    } as any;

    const mockConfig = {
      get: (key: string) => {
        if (key === 'maxMessagesPerAction') return 3;
        if (key === 'maxStepsPerAction') return 10;
        return undefined;
      }
    } as any;

    // Create DecisionEngine instance
    const engine = new DecisionEngine(
      mockMemory,
      mockLLM,
      mockSkills,
      '/tmp/journal.md',
      '/tmp/learning.md',
      mockConfig
    );

    engine.setAgentIdentity('Test Agent');

    // Execute decision
    await engine.decide({
      payload: {
        description: 'Say hello',
        messagesSent: 0,
        currentStep: 1,
        executionPlan: 'Greet the user',
        source: 'telegram',
        sourceId: 'test-user'
      }
    });

    // Verify two LLM calls were made
    expect(llmCalls.length).toBe(2);

    // Extract system messages
    const mainSystemPrompt = llmCalls[0].systemMessage || '';
    const reviewSystemPrompt = llmCalls[1].systemMessage || '';

    // Verify main call has core instructions
    expect(mainSystemPrompt).toContain('TOOLING RULE');
    expect(mainSystemPrompt).toContain('You may ONLY call tools listed in "Available Skills"');
    expect(mainSystemPrompt).toContain('YOUR IDENTITY');
    expect(mainSystemPrompt).toContain('STRATEGIC REASONING PROTOCOLS');
    expect(mainSystemPrompt).toContain('Available Skills');
    expect(mainSystemPrompt).toContain('send_telegram');

    // CRITICAL: Verify review call ALSO has core instructions
    expect(reviewSystemPrompt).toContain('TOOLING RULE');
    expect(reviewSystemPrompt).toContain('You may ONLY call tools listed in "Available Skills"');
    expect(reviewSystemPrompt).toContain('YOUR IDENTITY');
    expect(reviewSystemPrompt).toContain('STRATEGIC REASONING PROTOCOLS');
    expect(reviewSystemPrompt).toContain('Available Skills');
    expect(reviewSystemPrompt).toContain('send_telegram');
    
    // Review layer should also have its specific context
    expect(reviewSystemPrompt).toContain('TERMINATION REVIEW LAYER');
  });

  it('should maintain agent identity across main and review calls', async () => {
    const llmCalls: Array<{ systemMessage?: string }> = [];
    
    const mockLLM = {
      call: vi.fn(async (prompt: string, systemMessage?: string) => {
        llmCalls.push({ systemMessage });
        
        if (llmCalls.length === 1) {
          return JSON.stringify({
            verification: { goals_met: true, analysis: 'Done' },
            tools: []
          });
        }
        
        return JSON.stringify({
          verification: { goals_met: true, analysis: 'Confirmed' }
        });
      })
    } as any;

    const mockMemory = {
      getUserContext: () => ({ raw: '' }),
      getRecentContext: () => [],
      getContactProfile: () => null
    } as any;

    const mockSkills = {
      getSkillsPrompt: () => 'Available Skills:\n- test_skill',
      getAllSkills: () => [{ name: 'test_skill' }]
    } as any;

    const mockConfig = {
      get: () => undefined
    } as any;

    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', mockConfig);
    
    // Set a specific identity
    const testIdentity = 'I am OrcBot, a helpful automation assistant';
    engine.setAgentIdentity(testIdentity);

    await engine.decide({
      payload: {
        description: 'Test task',
        messagesSent: 0,
        currentStep: 1
      }
    });

    // Both calls should contain the agent identity
    expect(llmCalls[0].systemMessage).toContain(testIdentity);
    expect(llmCalls[1].systemMessage).toContain(testIdentity);
  });
});
