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

IMPORTANT:
- If a task involves communicating with a user (e.g. from Telegram), you MUST use the 'send_telegram' skill.
- The task description will contain the user's ID (e.g. "Telegram user Name (12345)"). You MUST extract this numeric ID and use it as the 'chat_id' argument.
- Arguments must be valid JSON. Example: send_telegram({"chat_id": "12345", "message": "Hello!"})


User Context:
${userContext.raw || 'No user information available.'}

Recent History:
${contextString || 'No recent history.'}

${availableSkills}
`;

        logger.info('DecisionEngine: Reasoning about task...');
        const rawResponse = await this.llm.call(task, systemPrompt);
        return ParserLayer.normalize(rawResponse);
    }
}
