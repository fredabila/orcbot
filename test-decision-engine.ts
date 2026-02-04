/**
 * Manual integration test for DecisionEngine improvements
 * Tests retry logic, validation, and error handling
 */

import { DecisionEngine } from './src/core/DecisionEngine';
import { MemoryManager } from './src/memory/MemoryManager';
import { MultiLLM } from './src/core/MultiLLM';
import { SkillsManager } from './src/core/SkillsManager';
import { ConfigManager } from './src/config/ConfigManager';
import { logger } from './src/utils/logger';

async function testRetryLogic() {
    console.log('\n=== Testing Retry Logic ===\n');
    
    // Create mock LLM that fails twice then succeeds
    let callCount = 0;
    const mockLLM = {
        call: async (prompt: string, systemMessage?: string) => {
            callCount++;
            console.log(`LLM call attempt ${callCount}`);
            
            if (callCount < 3) {
                throw new Error('Rate limit exceeded. Retry after 1 seconds');
            }
            
            return JSON.stringify({
                action: 'THOUGHT',
                reasoning: 'Succeeded on retry',
                verification: { goals_met: true, analysis: 'Done' },
                tools: []
            });
        }
    } as any;
    
    const mockMemory = {
        getUserContext: () => ({ raw: 'Test user' }),
        getRecentContext: () => [],
        getContactProfile: () => null
    } as any;
    
    const mockSkills = {
        getSkillsPrompt: () => 'Available Skills:\n- send_telegram',
        getAllSkills: () => [{ name: 'send_telegram' }]
    } as any;
    
    const config = new ConfigManager();
    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', config);
    
    try {
        const result = await engine.decide({
            id: 'test-retry-1',
            payload: {
                description: 'Test retry logic',
                messagesSent: 0,
                currentStep: 1,
                executionPlan: 'Test plan'
            }
        });
        
        console.log(`✓ Retry succeeded after ${callCount} attempts`);
        console.log(`Result: ${JSON.stringify(result, null, 2)}`);
        
        const stats = engine.getExecutionStats();
        console.log(`\nExecution stats: ${JSON.stringify(stats, null, 2)}`);
    } catch (error) {
        console.error(`✗ Retry failed: ${error}`);
    }
}

async function testValidation() {
    console.log('\n=== Testing Response Validation ===\n');
    
    // Mock LLM that returns invalid tool calls
    const mockLLM = {
        call: async () => {
            return JSON.stringify({
                action: 'EXECUTE',
                reasoning: 'Sending message',
                verification: { goals_met: true, analysis: 'Done' },
                tools: [
                    { name: 'send_telegram', metadata: { chatId: '123' } }, // Missing message
                    { name: 'unknown_tool', metadata: {} }, // Unknown tool
                    { name: 'web_search', metadata: {} } // Missing query
                ]
            });
        }
    } as any;
    
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
    
    const config = new ConfigManager();
    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', config);
    
    try {
        const result = await engine.decide({
            id: 'test-validation-1',
            payload: {
                description: 'Test validation',
                messagesSent: 0,
                currentStep: 1
            }
        });
        
        console.log(`Result tools: ${JSON.stringify(result.tools, null, 2)}`);
        console.log(`✓ Validation complete (${result.tools?.length || 0} valid tools, invalid tools filtered)`);
    } catch (error) {
        console.error(`✗ Validation test failed: ${error}`);
    }
}

async function testContextCompaction() {
    console.log('\n=== Testing Context Compaction ===\n');
    
    let attemptCount = 0;
    const mockLLM = {
        call: async (prompt: string, systemMessage?: string) => {
            attemptCount++;
            
            // First call: simulate context overflow
            if (attemptCount === 1) {
                throw new Error('Context length exceeded maximum');
            }
            
            // Second call (after compaction): succeed
            console.log(`✓ LLM call succeeded after compaction`);
            console.log(`  System prompt length: ${systemMessage?.length || 0} chars`);
            
            return JSON.stringify({
                action: 'THOUGHT',
                reasoning: 'Succeeded after compaction',
                verification: { goals_met: true, analysis: 'Done' },
                tools: []
            });
        }
    } as any;
    
    const mockMemory = {
        getUserContext: () => ({ raw: 'A'.repeat(50000) }), // Large context
        getRecentContext: () => [],
        getContactProfile: () => null
    } as any;
    
    const mockSkills = {
        getSkillsPrompt: () => 'Available Skills:\n- send_telegram',
        getAllSkills: () => [{ name: 'send_telegram' }]
    } as any;
    
    const config = new ConfigManager();
    const engine = new DecisionEngine(mockMemory, mockLLM, mockSkills, '', '', config);
    
    try {
        const result = await engine.decide({
            id: 'test-compaction-1',
            payload: {
                description: 'Test compaction',
                messagesSent: 0,
                currentStep: 1
            }
        });
        
        console.log(`✓ Compaction and retry succeeded`);
        console.log(`Total attempts: ${attemptCount}`);
    } catch (error) {
        console.error(`✗ Compaction test failed: ${error}`);
    }
}

// Run all tests
async function runTests() {
    try {
        await testRetryLogic();
        await testValidation();
        await testContextCompaction();
        
        console.log('\n=== All manual tests completed ===\n');
    } catch (error) {
        console.error('Test suite failed:', error);
        process.exit(1);
    }
}

runTests();
