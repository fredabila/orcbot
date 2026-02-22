
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
2. Which durable context should shape execution (USER.md preferences, IDENTITY/SOUL constraints, recent LEARNING.md lessons, and channel-specific memory)?
3. What is the most direct tool to use from AVAILABLE TOOLS?
4. What if that tool fails? (Fallback layers)
5. What is the success criteria?
6. DELIVERY: If the task produces a file or downloadable content for the user, the plan MUST include a step to SEND the file to the user via their channel using \`send_file\`, NOT just save it locally. A file saved to disk without being sent is a dead end — the user cannot access the agent's filesystem.
7. ERROR RECOVERY: For each step, briefly note what to do if it fails (alternative tool, different parameters, fallback approach). The agent MUST adapt, not repeat the same failing call.
8. ENVIRONMENT AWARENESS: If the task involves running commands or CLI tools, the plan should account for the server OS/shell environment. Include a verification step (e.g., check OS, check if tool is installed) before running environment-dependent commands.
9. BATCHING: Group tools into dependency-aware batches when possible (e.g., [search -> open] then [extract -> deliver]). This minimizes repeated LLM round-trips. If any tool in a batch fails, pause the remaining batch and re-plan from the failure.
10. PROGRESS CHECKPOINTS: For tasks with 3+ steps, include explicit checkpoints where the agent should update the user on progress. The user cannot see internal work — silence feels like failure.

OUTPUT FORMAT:
Provide a concise "Execution Plan" as a numbered checklist with contingency notes.
Example:
"1. [VERIFY] Check environment: run get_system_info to know OS/shell.
2. [EXECUTE] Search for 'song name' on YouTube using web_search.
   ↳ FALLBACK: If search fails or Captcha blocks, try browser_navigate to YouTube directly.
3. [CHECKPOINT] Update user: 'Found the link, downloading now...'
4. [EXECUTE] Download using download_file.
   ↳ FALLBACK: If download fails, try http_fetch or browser-based download.
5. [DELIVER] Send file to user via send_file.
6. [CHECKPOINT] Confirm delivery to user.
   ↳ FALLBACK: If send_file fails, provide the local path and explain."

Be tactical, not verbose. Every step should have a clear action and a fallback.
IMPORTANT: Only reference tools that exist in AVAILABLE TOOLS. Do NOT invent tools.
IMPORTANT: If context includes prior failures or learnings, explicitly avoid repeating failed approaches and prefer the learned approach first.
`;

        try {
            logger.info(`SimulationEngine: Generating plan for "${task}"...`);
            const plan = await this.llm.call(task, systemPrompt);
            logger.info(`SimulationEngine: Plan generated: ${plan.replace(/\n/g, ' ')}`);
            return plan;
        } catch (e) {
            logger.error(`SimulationEngine failed: ${e}`);
            return "Proceed with logical steps: 1. Analyze task and environment. 2. Execute primary approach. 3. If error, adapt and try alternative. 4. Update user on progress. 5. Verify and deliver result.";
        }
    }
}
