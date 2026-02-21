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
      supportsNativeToolCalling: () => false,
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
      ],
      matchSkillsForTask: () => [],
      getAgentSkillsPrompt: () => '',
      getActivatedSkillsContext: () => '',
      getAgentSkills: () => [],
      activateAgentSkill: () => {},
      deactivateNonStickySkills: () => {}
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
      supportsNativeToolCalling: () => false,
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
      getAllSkills: () => [{ name: 'test_skill' }],
      matchSkillsForTask: () => [],
      getAgentSkillsPrompt: () => '',
      getActivatedSkillsContext: () => '',
      getAgentSkills: () => [],
      activateAgentSkill: () => {},
      deactivateNonStickySkills: () => {}
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

describe('DecisionEngine - Thread Context Grounding', () => {
  it('should include same-chat user+assistant memories and filter tool noise', async () => {
    const llmCalls: Array<{ prompt: string; systemMessage?: string }> = [];

    const mockLLM = {
      supportsNativeToolCalling: () => false,
      call: vi.fn(async (prompt: string, systemMessage?: string) => {
        llmCalls.push({ prompt, systemMessage });
        return JSON.stringify({
          verification: { goals_met: true, analysis: 'Done' },
          tools: []
        });
      })
    } as any;

    const mockMemory = {
      getUserContext: () => ({ raw: 'Test user context' }),
      getRecentContext: () => [],
      getContactProfile: () => null,
      searchMemory: (type: 'short' | 'long' | 'episodic') => {
        if (type !== 'short') return [];
        return [
          {
            id: 'tg-1',
            type: 'short',
            content: 'User Alice (Telegram 999) said: I spoke with Frederick yesterday.',
            timestamp: '2026-02-05T10:00:00.000Z',
            metadata: { source: 'telegram', role: 'user', chatId: '12345', userId: '999' }
          },
          {
            id: 'tg-out-1',
            type: 'short',
            content: 'Assistant sent Telegram message to 12345: Frederick is the contact we were discussing.',
            timestamp: '2026-02-05T10:01:00.000Z',
            metadata: { source: 'telegram', role: 'assistant', chatId: '12345' }
          },
          {
            id: 'noise-1',
            type: 'short',
            content: 'Observation: Tool web_search returned: "..."',
            timestamp: '2026-02-05T10:02:00.000Z',
            metadata: { source: 'telegram', tool: 'web_search' }
          }
        ];
      }
    } as any;

    const mockSkills = {
      getSkillsPrompt: () => 'Available Skills:\n- send_telegram',
      getAllSkills: () => [{ name: 'send_telegram' }],
      matchSkillsForTask: () => [],
      getAgentSkillsPrompt: () => '',
      getActivatedSkillsContext: () => '',
      getAgentSkills: () => [],
      activateAgentSkill: () => {},
      deactivateNonStickySkills: () => {}
    } as any;

    const mockConfig = {
      get: () => undefined
    } as any;

    const engine = new DecisionEngine(
      mockMemory,
      mockLLM,
      mockSkills,
      '/tmp/journal.md',
      '/tmp/learning.md',
      mockConfig
    );

    await engine.decide({
      id: 'action-1',
      payload: {
        description: 'Ask him what time he is free',
        messagesSent: 0,
        currentStep: 1,
        executionPlan: 'Respond',
        source: 'telegram',
        sourceId: '12345',
        chatId: '12345',
        userId: '999',
        senderName: 'Alice'
      }
    });

    expect(llmCalls.length).toBe(2);
    const systemPrompt = llmCalls[0].systemMessage || '';
    expect(systemPrompt).toContain('THREAD CONTEXT (Same Chat)');
    expect(systemPrompt).toContain('Frederick');
    expect(systemPrompt).not.toContain('Observation: Tool web_search returned');
  });
});

describe('DecisionEngine - Scoped Memory Injection', () => {
  it('injects active user exchanges, unresolved thread markers, and platform metadata', async () => {
    const llmCalls: Array<{ systemMessage?: string }> = [];
    const mockLLM = {
      supportsNativeToolCalling: () => false,
      call: vi.fn(async (_prompt: string, systemMessage?: string) => {
        llmCalls.push({ systemMessage });
        return JSON.stringify({ verification: { goals_met: true, analysis: 'ok' }, tools: [] });
      })
    } as any;

    const mockMemory = {
      getUserContext: () => ({ raw: 'whatsappContextProfilingEnabled: true' }),
      getRecentContext: () => [],
      getContactProfile: () => '{"displayName":"Alice"}',
      getUserRecentExchanges: () => [
        {
          id: 'm1', type: 'short', timestamp: '2026-01-01T00:00:00Z',
          content: 'User asked for a follow up tomorrow',
          metadata: { role: 'user', messageType: 'text', source: 'whatsapp', sourceId: '123' }
        }
      ],
      getUnresolvedThreads: () => [
        { id: 'u1', type: 'short', timestamp: '2026-01-01T00:01:00Z', content: 'pending: send the invoice', metadata: {} }
      ],
      warmConversationCache: async () => [
        { id: 'v1', score: 0.91, content: 'Previous invoice discussion', type: 'short', vector: [], timestamp: '2026-01-01T00:01:00Z', metadata: { source: 'whatsapp' } }
      ],
      searchMemory: () => []
    } as any;

    const mockSkills = {
      getSkillsPrompt: () => 'Available Skills:\n- send_whatsapp',
      getAllSkills: () => [{ name: 'send_whatsapp' }],
      matchSkillsForTask: () => [],
      getAgentSkillsPrompt: () => '',
      getActivatedSkillsContext: () => '',
      getAgentSkills: () => [],
      activateAgentSkill: () => {},
      deactivateNonStickySkills: () => {}
    } as any;

    const mockConfig = { get: () => undefined } as any;
    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', mockConfig);

    await engine.decide({
      id: 'a1',
      payload: {
        description: 'continue our whatsapp discussion',
        source: 'whatsapp',
        sourceId: '123',
        senderName: 'Alice',
        messageType: 'status_reply',
        statusContext: 'Replied to my travel status',
        currentStep: 1,
        messagesSent: 0
      }
    });

    const prompt = llmCalls[0].systemMessage || '';
    expect(prompt).toContain('LAST USER EXCHANGES (scoped to active contact)');
    expect(prompt).toContain('UNRESOLVED THREADS (carry-over items)');
    expect(prompt).toContain('PREFETCHED MEMORY CANDIDATES (hybrid semantic+recency)');
    expect(prompt).toContain('WHATSAPP TRIGGER METADATA');
  });
});


describe('DecisionEngine - Step compaction expansion', () => {
  it('expands middle step history when continuity intent is detected', async () => {
    const llmCalls: Array<{ systemMessage?: string }> = [];

    const mockLLM = {
      supportsNativeToolCalling: () => false,
      call: vi.fn(async (_prompt: string, systemMessage?: string) => {
        llmCalls.push({ systemMessage });
        return JSON.stringify({ verification: { goals_met: true, analysis: 'Done' }, tools: [] });
      })
    } as any;

    const actionId = 'action-expand';
    const memories = Array.from({ length: 14 }).map((_, i) => ({
      id: `${actionId}-step-${i + 1}`,
      type: 'short',
      content: `Tool web_search returned detail from step ${i + 1}`,
      timestamp: `2026-02-05T10:${String(i).padStart(2, '0')}:00.000Z`,
      metadata: {}
    }));

    const mockMemory = {
      getUserContext: () => ({ raw: '' }),
      getRecentContext: () => memories,
      getContactProfile: () => null,
      getRelevantEpisodicMemories: async () => [],
      semanticRecall: async () => [],
      vectorMemory: { isEnabled: () => false }
    } as any;

    const mockSkills = {
      getSkillsPrompt: () => 'Available Skills\n- send_telegram',
      getAllSkills: () => [{ name: 'send_telegram' }],
      matchSkillsForTask: () => [],
      getAgentSkillsPrompt: () => '',
      getActivatedSkillsContext: () => '',
      getAgentSkills: () => [],
      activateAgentSkill: () => {},
      deactivateNonStickySkills: () => {}
    } as any;

    const mockConfig = {
      get: (key: string) => {
        if (key === 'stepCompactionThreshold') return 6;
        if (key === 'stepCompactionPreserveFirst') return 2;
        if (key === 'stepCompactionPreserveLast') return 2;
        if (key === 'stepCompactionExpandOnDemand') return true;
        if (key === 'stepCompactionExpansionMaxMiddleSteps') return 4;
        if (key === 'stepCompactionExpansionMaxChars') return 4000;
        return undefined;
      }
    } as any;

    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', mockConfig);

    await engine.decide({
      id: actionId,
      payload: {
        description: 'Can you recap where we left off and continue?',
        messagesSent: 0,
        currentStep: 1,
        source: 'telegram',
        sourceId: '12345'
      }
    });

    const systemPrompt = llmCalls[0].systemMessage || '';
    expect(systemPrompt).toContain('expanded continuity context');
    expect(systemPrompt).toContain('[Step 9] Tool web_search returned detail from step 9');
    expect(systemPrompt).not.toContain('middle steps compacted');
  });
});
