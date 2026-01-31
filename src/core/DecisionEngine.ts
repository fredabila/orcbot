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

    public async decide(action: any): Promise<StandardResponse> {
        const taskDescription = action.payload.description;
        const metadata = action.payload;

        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();
        const availableSkills = this.skills.getSkillsPrompt();

        const contextString = recentContext.map(c => `[${c.type}] ${c.content}`).join('\n');

        let channelInstructions = '';
        if (metadata.source === 'telegram') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
You are communicating via Telegram.
- **Chat ID**: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- To reply, use skill "send_telegram" and put arguments in 'metadata':
  \`{ "tool": "send_telegram", "metadata": { "chat_id": "${metadata.sourceId}", "message": "..." } }\`
`;
        }

        const systemPrompt = `
You are an autonomous agent. Your goal is to assist the user based on their preferences and history.
${ParserLayer.getSystemPromptSnippet()}

LEARNING MODE:
- If you learn something new about the user (name, preference, goal), use \`update_user_profile(info_text)\` to save it.
- If you develop a new personality trait or rule for yourself, use \`update_agent_identity(trait)\`.
- Do not just say "I'll remember that"—actually save it.

ANTI-SPAM & CONTINUITY:
- You can and SHOULD perform multiple steps if needed (e.g. search, then message, then save to file).
- However, do NOT repeat the same message to the user.
- Once you send a reply, consider that "conversational turn" finished. Focus on completing any remaining background tasks or orchestration.

${channelInstructions}

User Context:
${userContext.raw || 'No user information available.'}

Recent History:
${contextString || 'No recent history.'}

${availableSkills}
`;

        logger.info(`DecisionEngine: Reasoning about task: "${taskDescription}"`);
        const rawResponse = await this.llm.call(taskDescription, systemPrompt);
        return ParserLayer.normalize(rawResponse);
    }
}
