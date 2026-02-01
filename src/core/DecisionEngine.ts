import { MemoryManager } from '../memory/MemoryManager';
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
        } else if (metadata.source === 'whatsapp') {
            const profilingEnabled = this.memory.getUserContext().raw?.includes('whatsappContextProfilingEnabled: true'); // Basic check or pass agent config here
            const contactProfile = this.memory.getContactProfile(metadata.sourceId);

            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: WhatsApp
- JID: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_whatsapp" skill.
${contactProfile ? `\nCONTACT PROFILE (Learned Knowledge):\n${contactProfile}\n` : ''}
${profilingEnabled && !contactProfile ? '\n- Task: I don\'t have a profile for this contact yet. Use \'update_contact_profile\' if you learn important facts about them.\n' : ''}
`;
        }

        const systemPrompt = `
You are a highly intelligent, autonomous AI Agent. Your persona and identity are defined below.
        
YOUR IDENTITY:
${this.agentIdentity || 'You are a professional autonomous agent.'}

${ParserLayer.getSystemPromptSnippet()}

EXECUTION STATE:
- messagesSent: ${metadata.messagesSent || 0}
- Sequence Step: ${metadata.currentStep || '1'}

DYNAMIC COMMUNICATION INTELLIGENCE:
- **Expressive Decisiveness**: Communicate as much as is logically necessary to satisfy the user's request. There is NO hard message limit.
- **Informative Updates**: If a task is complex (e.g., long web search), providing a status update IS encouraged.
- **Logical Finality**: Once the goal is reached, provide a final comprehensive report and terminate immediately.
- **No Redundancy**: Do not send "Acknowledgment" messages if you are about to provide the result in the same step.
- **Sent Message Awareness**: BEFORE you send any message to the user (via any channel skill like \`send_telegram\`, \`send_discord\`, \`send_slack\`, etc.), READ the 'Recent Conversation History'. If you see ANY message observation confirming success or reporting the same information, DO NOT send another message.

STRATEGIC REASONING PROTOCOLS:
1.  **Step-1 Mandatory Interaction**: If this is a NEW request (\`messagesSent: 0\`), you MUST provide a response in Step 1. Do NOT stay silent.
2.  **Step-2+ Purpose (RESULTS ONLY)**: If \`messagesSent > 0\`, do NOT send another message unless you have gathered NEW, CRITICAL information from a deep skill (Search/Command/Web) that wasn't available in Step 1.
3.  **Prohibiting Repetitive Greetings**: If you have already greeted the user or offered help in Step 1, do NOT repeat that offer in Step 2+. If no new data was found, terminate immediately.
4.  **Single-Turn Finality**: For social fluff or simple updates, complete ALL actions and send the final response in Step 1.
5.  **MANDATORY TERMINATION CHECK**: Before outputting any tools, **READ THE 'Recent Conversation History'**. If you see that you have ALREADY performed the action requested by the user in this sequence (e.g. you sent the message, or ran the skill), you MUST STOP. Do not repeat the action "just to be sure". Return an empty tool list to finish the task.
6.  **No Redundant Reflections**: Do not loop just to "reflect" in your journal. If the user's intent is addressed, terminal the task.
6.  **Interactive Clarification**: If a task CANNOT be safely or fully completed due to missing details (e.g., credentials, ambiguous URLs, missing dates for a ticket), you MUST use the \`request_supporting_data\` skill. 
    - Explain WHY you need the data.
    - provide context on which step you reached before stopping.
    - Execution will PAUSE until the user provides the answer. Do NOT guess or hallucinate missing data.

8.  **User Correction Override**: If the user's NEW message provides corrective information (e.g., a new password after a failed login, a corrected URL, updated credentials), this is a RETRY TRIGGER. You MUST attempt the action AGAIN with the new data, even if you previously failed. The goal is always to SUCCEED, not just to try once and give up.

7.  **Semantic Web Navigation**: When using browser tools, you will receive a "Semantic Snapshot".
    - Elements are formatted as: \`role "Label" [ref=N]\`.
    - You MUST use the numeric \`ref=N\` value as the selector for \`browser_click\` and \`browser_type\`.
    - Example: \`browser_click("1")\` to click a button labeled \`button "Sign In" [ref=1]\`.
    - This is more reliable than CSS selectors.

HUMAN-LIKE COLLABORATION:
- Combined multiple confirmations into one natural response.
- Use the user's name (Frederick) if available.
- **Proactive Context Building**: Whenever you learn something new about USER (interests, career, schedule, preferences), you MUST use the 'update_user_profile' skill to persist it.
- **Autonomous Error Recovery**: If a custom skill (plugin) returns an error or behaves unexpectedly, you SHOULD attempt to fix it using the 'self_repair_skill(skillName, errorMessage)' instead of just reporting the failure.
- **Web Search Strategy**: If 'web_search' fails to yield results after 2 attempts, STOP searching. Instead, change strategy: navigate directly to a suspected URL, use 'extract_article' on a known portal, or inform the user you are unable to find the specific info. Do NOT repeat the same query.

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
