
import { MultiLLM } from './MultiLLM';
import { logger } from '../utils/logger';

export class SimulationEngine {
    constructor(private llm: MultiLLM) { }

    public async simulate(task: string, context: string = '', skillsPrompt: string = ''): Promise<string> {
        const systemPrompt = `
You are a Strategic Planning Engine for an AI Agent.
Your goal is to SIMULATE the execution of a user's request and outline a robust, multi-layer PLAN.

INPUT:
- Task (Latest Trigger): "${task}"
- Context (History): 
"""
${context || 'No history available.'}
"""

AVAILABLE TOOLS (Authoritative):
${skillsPrompt || 'No skills list provided. Do NOT assume tools exist.'}

OBJECTIVE:
Create a step-by-step SIMULATION of how this task should be handled.
CRITICAL: Analyze the CONTEXT to understand the *real* intent. 
- If the Task is "I'm waiting" or "continue", look at the history to see what was in progress.
- Do NOT just repeat the user's message.

Think about:
1. What is the actual goal based on history?
2. What is the most direct tool to use from AVAILABLE TOOLS?
3. What if that tool fails? (Fallback layers)
4. What is the success criteria?
5. DELIVERY: If the task produces a file or downloadable content for the user, the plan MUST include a step to SEND the file to the user via their channel using \`send_file\`, NOT just save it locally. A file saved to disk without being sent is a dead end — the user cannot access the agent's filesystem.

OUTPUT FORMAT:
Provide a concise "Execution Plan" with contingency steps.
Example:
"1. Try searching specifically for 'song name' on YouTube using web_search.
2. If search fails or Captcha blocks it, try searching generally for the artist's discography.
3. Once a link is found, use 'download_file'.
4. If web tools fail completely, ask user for a direct link."

Do not be verbose. Be tactical.
IMPORTANT: Only reference tools that exist in AVAILABLE TOOLS. Do NOT invent tools.
`;

        try {
            logger.info(`SimulationEngine: Generating plan for "${task}"...`);
            const plan = await this.llm.call(task, systemPrompt);
            logger.info(`SimulationEngine: Plan generated: ${plan.replace(/\n/g, ' ')}`);
            return plan;
        } catch (e) {
            logger.error(`SimulationEngine failed: ${e}`);
            return "Proceed with logical stpes: Analyze -> Execute -> Verify.";
        }
    }
}
