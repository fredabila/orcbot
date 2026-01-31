import { MemoryManager } from './MemoryManager';
import { MultiLLM } from './MultiLLM';
import { ParserLayer, StandardResponse } from './ParserLayer';
import { SkillsManager } from './SkillsManager';
import { logger } from '../utils/logger';
import fs from 'fs';

export class DecisionEngine {
    private agentIdentity: string = '';

    constructor(
        private memory: MemoryManager,
        private llm: MultiLLM,
        private skills: SkillsManager,
        private journalPath: string = './JOURNAL.md',
        private learningPath: string = './LEARNING.md'
    ) { }

    public setAgentIdentity(identity: string) {
        this.agentIdentity = identity;
    }

    public async decide(action: any): Promise<StandardResponse> {
        const taskDescription = action.payload.description;
        const metadata = action.payload;

        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();
        const availableSkills = this.skills.getSkillsPrompt();

        // Load Journal and Learning
        let journalContent = '(Journal is empty)';
        let learningContent = '(Learning base is empty)';
        try {
            if (fs.existsSync(this.journalPath)) journalContent = fs.readFileSync(this.journalPath, 'utf-8').slice(-2000);
            if (fs.existsSync(this.learningPath)) learningContent = fs.readFileSync(this.learningPath, 'utf-8').slice(-2000);
        } catch (e) { }

        const contextString = recentContext.map(c => `[${c.type}] ${c.content}`).join('\n');

        let channelInstructions = '';
        if (metadata.source === 'telegram') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Telegram
- Chat ID: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_telegram" skill.
`;
        }

        const systemPrompt = `
You are a highly intelligent, autonomous AI Agent named OrcBot.
Your current objective is to fulfill the specific instruction below using the provided tools.

YOUR IDENTITY:
${this.agentIdentity}

${ParserLayer.getSystemPromptSnippet()}

EXECUTION STATE:
- messagesSent: ${metadata.messagesSent || 0}
- Sequence Step: ${metadata.currentStep || '1'}

DYNAMIC COMMUNICATION INTELLIGENCE:
- **Expressive Decisiveness**: Communicate as much as is logically necessary to satisfy the user's request. There is NO hard message limit.
- **Informative Updates**: If a task is complex (e.g., long web search), providing a status update IS encouraged.
- **Logical Finality**: Once the goal is reached, provide a final comprehensive report and terminate immediately.
- **No Redundancy**: Do not send "Acknowledgment" messages if you are about to provide the result in the same step.

STRATEGIC REASONING PROTOCOLS:
1.  **Single-Turn Completion Heuristic**: Your goal is to finish the task in ONE TURN (Step 1) if possible.
    - Social greetings, simple profile updates, or direct questions REQUIRE an immediate final response in Step 1.
    - Do NOT split your logic into "acknowledge now, result later" for simple tasks. Combine them.
2.  **Logical Finality**: If your "Recent Conversation History" shows that you have already sent a message that satisfies the user's intent, you MUST stop immediately.
3.  **Communication Intentionality**: Only send a second message in Step 2+ if you have REAL NEW information to provide (e.g. search results, article content) that wasn't available in Step 1.
4.  **No Redundant Reflections**: Only call background tools (Journal/Learning) once per distinct logical event.
5.  **Failure Adaptation**: If a tool fails (CAPTCHA/Error), notify the user instantly and stop. Do not "reflect" on the failure in a loop.

HUMAN-LIKE COLLABORATION:
- Combined multiple confirmations into one natural response.
- Use the user's name (Frederick) if available.

${channelInstructions}

User Context (Long-term profile):
${userContext.raw || 'No user information available.'}

Agent Journal (Recent Reflections):
${journalContent}

Agent Learning Base (Knowledge):
${learningContent}

Recent Conversation History (LOG OF PREVIOUS STEPS IN THIS ACTION):
${contextString || 'No history for this action yet.'}

${availableSkills}
`;

        logger.info(`DecisionEngine: Deliberating on task: "${taskDescription}"`);
        const rawResponse = await this.llm.call(taskDescription, systemPrompt);
        return ParserLayer.normalize(rawResponse);
    }
}
