import { MemoryManager } from './MemoryManager';
import { MultiLLM } from './MultiLLM';
import { ParserLayer, StandardResponse } from './ParserLayer';
import { SkillsManager } from './SkillsManager';
import { logger } from '../utils/logger';

export class DecisionEngine {
    constructor(
        private memory: MemoryManager,
        private llm: MultiLLM,
        private skills: SkillsManager
    ) { }

    public async decide(task: string): Promise<StandardResponse> {
        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();
        const availableSkills = this.skills.getSkillsPrompt();

        const contextString = recentContext.map(c => `[${c.type}] ${c.content}`).join('\n');

        const systemPrompt = `
You are an autonomous agent. Your goal is to assist the user based on their preferences and history.
${ParserLayer.getSystemPromptSnippet()}

User Context:
${userContext.raw || 'No user information available.'}

Recent History:
${contextString || 'No recent history.'}

${availableSkills}
`;

        logger.info('DecisionEngine: Reasoning about task...');
        const rawResponse = await this.llm.call('openai', task, systemPrompt);
        return ParserLayer.normalize(rawResponse);
    }
}
