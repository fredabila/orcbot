import { MemoryManager } from '../memory/MemoryManager';
import { MultiLLM } from './MultiLLM';
import { ParserLayer, StandardResponse } from './ParserLayer';
import { SkillsManager } from './SkillsManager';
import { logger } from '../utils/logger';
import fs from 'fs';
import os from 'os';
import { ConfigManager } from '../config/ConfigManager';
import { DecisionPipeline } from './DecisionPipeline';
import { ErrorClassifier, ErrorType } from './ErrorClassifier';
import { ExecutionStateManager } from './ExecutionState';
import { ContextCompactor } from './ContextCompactor';
import { ResponseValidator } from './ResponseValidator';
import { BootstrapManager } from './BootstrapManager';

export class DecisionEngine {
    private agentIdentity: string = '';
    private pipeline: DecisionPipeline;
    private systemContext: string;
    private executionStateManager: ExecutionStateManager;
    private contextCompactor: ContextCompactor;
    private maxRetries: number;
    private enableAutoCompaction: boolean;
    private bootstrap?: BootstrapManager;

    constructor(
        private memory: MemoryManager,
        private llm: MultiLLM,
        private skills: SkillsManager,
        private journalPath: string = './JOURNAL.md',
        private learningPath: string = './LEARNING.md',
        private config?: ConfigManager,
        bootstrap?: BootstrapManager
    ) {
        this.bootstrap = bootstrap;
        this.pipeline = new DecisionPipeline(this.config || new ConfigManager());
        this.systemContext = this.buildSystemContext();
        this.executionStateManager = new ExecutionStateManager();
        this.contextCompactor = new ContextCompactor(this.llm);
        this.maxRetries = this.config?.get('decisionEngineMaxRetries') || 3;
        this.enableAutoCompaction = this.config?.get('decisionEngineAutoCompaction') !== false;
    }

    private buildSystemContext(): string {
        const isWindows = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        const platformName = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';
        
        if (isWindows) {
            return `- Platform: ${platformName} (${os.release()})
- Shell: PowerShell/CMD
- IMPORTANT: To run commands in a specific directory, you can either (a) use "cd /path && command" or "cd /path ; command" (the cd will be automatically extracted and used as the cwd while only the remaining command is executed), or (b) pass the cwd parameter directly to run_command
- IMPORTANT: Use 'write_file' skill for creating files (echo multiline doesn't work)
- IMPORTANT: Use 'create_directory' skill for making directories
- Path format: C:\\path\\to\\file or C:/path/to/file
- Command chaining: Both && and ; work, but && ensures previous command succeeds`;
        } else {
            return `- Platform: ${platformName} (${os.release()})
- Shell: Bash/Zsh
- Command chaining: Use && or ;
- Standard Unix commands available (ls, cat, mkdir, echo, etc.)
- Path format: /path/to/file`;
        }
    }

    private getSystemContext(): string {
        return this.systemContext;
    }

    private applyChannelDefaultsToTools(parsed: StandardResponse, metadata: any): StandardResponse {
        if (!parsed?.tools || parsed.tools.length === 0) return parsed;

        const source = (metadata?.source || '').toString().toLowerCase();
        const sourceId = metadata?.sourceId;

        parsed.tools = parsed.tools.map((tool) => {
            const name = (tool?.name || '').toLowerCase();
            const toolMetadata: Record<string, any> = { ...(tool.metadata || {}) };

            // Normalize message across send tools if missing
            if (toolMetadata.message == null) {
                toolMetadata.message = toolMetadata.text ?? toolMetadata.content ?? toolMetadata.body;
            }

            if (name === 'send_telegram') {
                // Prefer the action sourceId when we're in a Telegram-sourced action.
                // This prevents bad outputs like chatId="Frederick" causing "chat not found".
                const hasChatId = !!toolMetadata.chatId;
                const chatIdLooksInvalid = typeof toolMetadata.chatId === 'string' && /[a-zA-Z]/.test(toolMetadata.chatId);
                const preferredChatId = metadata?.chatId ?? sourceId;
                if ((source === 'telegram') && preferredChatId && (!hasChatId || chatIdLooksInvalid)) {
                    toolMetadata.chatId = preferredChatId;
                }
            }

            if (name === 'send_whatsapp') {
                if ((source === 'whatsapp') && sourceId && !toolMetadata.jid) {
                    toolMetadata.jid = sourceId;
                }
            }

            if (name === 'send_discord') {
                if ((source === 'discord') && sourceId && !toolMetadata.channel_id) {
                    toolMetadata.channel_id = sourceId;
                }
            }

            if (name === 'send_gateway_chat') {
                if ((source === 'gateway-chat') && sourceId && !toolMetadata.chatId) {
                    toolMetadata.chatId = sourceId;
                }
            }

            return { ...tool, metadata: toolMetadata };
        });

        return parsed;
    }

    /**
     * Builds the core system instructions that should be present in ALL LLM calls.
     * This ensures the agent always remembers its identity, capabilities, and protocols.
     */
    private buildCoreInstructions(availableSkills: string, agentIdentity: string, isFirstStep: boolean = true): string {
        const now = new Date();
        const dateContext = `
CURRENT DATE & TIME:
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
`;

        // Load bootstrap context if available (IDENTITY.md, SOUL.md, etc.)
        let bootstrapContext = '';
        if (this.bootstrap) {
            try {
                const context = this.bootstrap.loadBootstrapContext();
                if (context.IDENTITY) {
                    bootstrapContext += `\n## IDENTITY (from IDENTITY.md)\n${context.IDENTITY}\n`;
                }
                if (context.SOUL) {
                    bootstrapContext += `\n## PERSONA & BOUNDARIES (from SOUL.md)\n${context.SOUL}\n`;
                }
                if (context.AGENTS) {
                    bootstrapContext += `\n## OPERATING INSTRUCTIONS (from AGENTS.md)\n${context.AGENTS}\n`;
                }
            } catch (e) {
                logger.debug(`DecisionEngine: Could not load bootstrap context: ${e}`);
            }
        }

        return `
You are a highly intelligent, autonomous AI Agent. Your persona and identity are defined below.
        
YOUR IDENTITY:
${agentIdentity || 'You are a professional autonomous agent.'}
${bootstrapContext}

${dateContext}

ACCOUNT OWNERSHIP CLARITY:
- You operate the user's messaging accounts (WhatsApp, Telegram, Discord) ON THEIR BEHALF.
- When the user says "post on my status" or "send from my account", they mean the account YOU control - which IS their account.
- Your WhatsApp status IS the user's WhatsApp status. Your Telegram IS their Telegram. There is no separation.
- If you have a skill like \`post_whatsapp_status\`, that posts to the user's status (the one you control).
- Do NOT ask for clarification about "your status vs my status" - they are the same thing.

${ParserLayer.getSystemPromptSnippet()}

SYSTEM ENVIRONMENT:
${this.getSystemContext()}

STRATEGIC REASONING PROTOCOLS:
1.  **TOOLING RULE**: You may ONLY call tools listed in "Available Skills". Do NOT invent or assume tools exist.
2.  **CHAIN OF VERIFICATION (CoVe)**: Before outputting any tools, you MUST perform a verification analysis.
    - Fill out the \`verification\` block in your JSON.
    - \`analysis\`: Review the history. Did you already answer the user? Is the requested file already downloaded?
    - \`goals_met\`: Set to \`true\` if the tools you're calling in THIS response will satisfy the user's ultimate intent. Tools WILL BE EXECUTED even when goals_met is true.
    - IMPORTANT: If you include tools[] AND set goals_met: true, the tools will run and THEN the action terminates. This is the correct pattern for "send this message and we're done".
    - If goals_met is false, you MUST include at least one tool to make progress (or request clarification with request_supporting_data).
3.  **Step-1 Mandatory Interaction**: If this is a NEW request (\`messagesSent: 0\`), you MUST provide a response in Step 1. Do NOT stay silent.
    - **SOCIAL FINALITY**: If the user says "Hi", "Hello", or "How are you?", respond naturally and **terminate immediately** (\`goals_met: true\` with send_telegram/send_whatsapp/send_discord) in Step 1. Do not look for additional work or research their profile unless specifically asked.
4.  **Step-2+ Purpose (RESULTS ONLY)**: If \`messagesSent > 0\`, do NOT send another message unless you have gathered NEW, CRITICAL information or reached a 15-step milestone in a long process.
5.  **Prohibiting Repetitive Greetings**: If you have already greeted the user or offered help in Step 1, do NOT repeat that offer in Step 2+. If no new data was found, terminate immediately (\`goals_met: true\` with NO tools).
6.  **Single-Turn Finality**: For social fluff, simple updates, or when all required info is already available, complete ALL actions and send the final response in Step 1. Do NOT wait until Step 2 to respond if you have the answer now.
7.  **MANDATORY TERMINATION CHECK (ANTI-LOOP)**: Before outputting any tools, **READ THE 'Recent Conversation History'**. 
    - If you see a \`send_telegram\`, \`send_whatsapp\`, or \`send_discord\` observation that already contains the final answer/result, you MUST set \`goals_met: true\` with NO tools and STOP. 
    - Do NOT repeat the message "just to be sure" or because "the user might have missed it". 
    - If your Reasoning says "I will re-send just in case", YOU ARE ALREADY IN A LOOP. BREAK IT.
    - **SUCCESS CHECK**: If a previous step shows a tool SUCCEEDED (e.g., "Posted status update to 3 contacts"), the task is DONE. Do NOT then send a message saying you can't do it or asking for clarification. CHECK YOUR HISTORY before claiming inability.
8.  **Progress Over Reflection**: Do not loop just to "reflect" in your journal or update learning. 
    - You are limited to **3 total steps** of internal reflection (Journal/Learning) without a "Deep Action" (Search/Command/Web).
    - If you cannot make objective progress, inform the user and stop. Do NOT stay in a loop just updating metadata.
9.  **Interactive Clarification**: If a task CANNOT be safely or fully completed due to missing details, you MUST use the \`request_supporting_data\` skill. 
    - Execution will PAUSE until the user provides the answer. Do NOT guess or hallucinate missing data.
    - IMPORTANT: If you ask a question via send_telegram/send_whatsapp/send_discord/send_gateway_chat, the system will AUTO-PAUSE and wait for user response. DO NOT continue working after asking a question.
    - After asking a clarifying question, set goals_met: true to terminate. The user's reply will create a NEW action.
10. **User Correction Override**: If the user's NEW message provides corrective information (e.g., a new password after a failed login, a corrected URL, updated credentials), this is a RETRY TRIGGER. You MUST attempt the action AGAIN with the new data, even if you previously failed. The goal is always to SUCCEED, not just to try once and give up.
11. **WAITING STATE AWARENESS**: Check memory for "[SYSTEM: Sent question to user. WAITING for response]" entries.
    - If you see this in recent memory, your previous self asked a question.
    - The CURRENT message from the user is likely the ANSWER to that question.
    - Use that answer to continue the task, don't re-ask the same question.
12. **Semantic Web Navigation**: When using browser tools, you will receive a "Semantic Snapshot".
    - Elements are formatted as: \`role "Label" [ref=N]\`.
    - You MUST use the numeric \`ref=N\` value as the selector for \`browser_click\` and \`browser_type\`.
    - Example: \`browser_click("1")\` to click a button labeled \`button "Sign In" [ref=1]\`.
    - This is more reliable than CSS selectors.

TASK PERSISTENCE & COMPLETION:
- **Complete The Job**: If you started a multi-step task (account creation, file download, research), you MUST continue until genuine completion or a genuine blocker (not just "I've done a few steps").
- **No Premature Termination**: Do NOT stop mid-task because you've "made progress". The goal is COMPLETION, not partial work. If you can take another step, take it.
- **Blocker Definition**: A "blocker" is: (1) Missing credentials/info from user, (2) CAPTCHA you cannot solve, (3) Rate-limited/blocked by website, (4) Permission denied errors. Normal page loads, form fills, and navigation are NOT blockers.
- **Session Continuity**: You have memory of previous steps. Use it. Don't restart from scratch or forget what you've accomplished.
- **Failure Recovery**: If one approach fails (e.g., a button doesn't work), try an alternative: different selector, keyboard navigation, direct URL, etc. Exhaust options before giving up.

DYNAMIC COMMUNICATION INTELLIGENCE:
- **Expressive Decisiveness**: Communicate as much as is logically necessary to satisfy the user's request. There is NO hard message limit.
- **Informative Updates**: If a task is complex (e.g., long web search), providing a status update IS encouraged.
- **Logical Finality**: Once the goal is reached (e.g., results found and sent), provide a final comprehensive report IF NOT SENT ALREADY, and terminate immediately.
- **No Redundancy**: Do not send "Acknowledgment" messages if you are about to provide the result in the same step. Do NOT send "Consolidated" summaries of information you just sent in the previous step.
- **Status Presence**: If you are in the middle of a multi-step task (e.g., downloading a large file, scanning multiple pages), providing a progress update is encouraged once every ~15 steps to keep the user in the loop.
- **Sent Message Awareness**: BEFORE you send any message to the user (via any channel skill like \`send_telegram\`, \`send_whatsapp\`, \`send_discord\`, \`send_gateway_chat\`, etc.), READ the 'Recent Conversation History'. If you see ANY message observation confirming successful delivery of the requested info, DO NOT send another message.
- **Message Economy**: While you have ample room to work (typically 10+ steps per action), don't send messages frivolously. Reserve messages for: (1) Initial acknowledgment, (2) Critical blockers requiring user input, (3) Significant milestone updates on long tasks, (4) Final completion report. Silent work in between is preferred.

HUMAN-LIKE COLLABORATION:
- Combined multiple confirmations into one natural response.
- Use the user's name (Frederick) if available.
- **Proactive Context Building**: Whenever you learn something new about USER (interests, career, schedule, preferences), you MUST use the 'update_user_profile' skill to persist it.
- **Autonomous Error Recovery**: If a custom skill (plugin) returns an error or behaves unexpectedly, you SHOULD attempt to fix it using the 'self_repair_skill(skillName, errorMessage)' instead of just reporting the failure.
- **Web Search Strategy**: If 'web_search' fails to yield results after 2 attempts, STOP searching. Instead, change strategy: navigate directly to a suspected URL, use 'extract_article' on a known portal, or inform the user you are unable to find the specific info. Do NOT repeat the same query.
- **Dependency Claims Must Be Evidence-Based**: Do NOT claim missing system dependencies (e.g., libatk, libgtk, etc.) unless a tool returned an error that explicitly mentions the missing library.
- **User Fix Retry Rule**: If the user says they installed a dependency or fixed an environment issue, you MUST retry the failing tool before mentioning the issue again. Only report the problem if the new tool error still shows it.

Available Skills:
${availableSkills}
`;
    }

    public setAgentIdentity(identity: string) {
        this.agentIdentity = identity;
    }

    /**
     * Make an LLM call with retry logic and error handling
     */
    private async callLLMWithRetry(
        prompt: string,
        systemPrompt: string,
        actionId: string,
        attemptNumber: number = 1
    ): Promise<string> {
        const state = this.executionStateManager.getState(actionId);

        try {
            const response = await this.llm.call(prompt, systemPrompt);
            state.recordAttempt({
                response: { success: true, content: response },
                contextSize: systemPrompt.length + prompt.length
            });
            return response;
        } catch (error) {
            const classified = ErrorClassifier.classify(error);
            state.recordAttempt({
                error: classified,
                contextSize: systemPrompt.length + prompt.length
            });

            logger.warn(`DecisionEngine: LLM call failed (attempt ${attemptNumber}): ${classified.type} - ${classified.message}`);

            // Handle context overflow with compaction
            if (classified.type === ErrorType.CONTEXT_OVERFLOW && this.enableAutoCompaction) {
                if (state.shouldTryCompaction()) {
                    logger.info('DecisionEngine: Attempting context compaction...');
                    state.markCompactionAttempted();
                    
                    // Compact the system prompt (usually the largest part)
                    const compacted = await this.contextCompactor.compact(systemPrompt, {
                        targetLength: Math.floor(systemPrompt.length * 0.6),
                        strategy: 'truncate' // Fast truncation for retry
                    });

                    // Retry with compacted context
                    return this.callLLMWithRetry(prompt, compacted, actionId, attemptNumber + 1);
                }
            }

            // Retry on retryable errors
            if (ErrorClassifier.shouldRetry(classified, attemptNumber, this.maxRetries)) {
                const backoff = ErrorClassifier.getBackoffDelay(attemptNumber - 1);
                
                // Apply cooldown if specified
                const delay = classified.cooldownMs || backoff;
                logger.info(`DecisionEngine: Retrying after ${delay}ms (attempt ${attemptNumber + 1}/${this.maxRetries})`);
                
                await this.sleep(delay);
                return this.callLLMWithRetry(prompt, systemPrompt, actionId, attemptNumber + 1);
            }

            // Non-retryable or max retries reached
            throw error;
        }
    }

    /**
     * Sleep utility for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public async decide(action: any): Promise<StandardResponse> {
        const taskDescription = action.payload.description;
        const metadata = action.payload;
        const actionId = action.id;

        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();
        const availableSkills = this.skills.getSkillsPrompt();
        const allowedToolNames = this.skills.getAllSkills().map(s => s.name);

        // Load Journal and Learning - keep meaningful context
        const isFirstStep = (metadata.currentStep || 1) === 1;
        const journalLimit = 1500;  // Recent reflections
        const learningLimit = 1500; // Knowledge base
        
        let journalContent = '';
        let learningContent = '';
        try {
            if (fs.existsSync(this.journalPath)) {
                const full = fs.readFileSync(this.journalPath, 'utf-8');
                journalContent = full.length > journalLimit ? full.slice(-journalLimit) : full;
            }
            if (fs.existsSync(this.learningPath)) {
                const full = fs.readFileSync(this.learningPath, 'utf-8');
                learningContent = full.length > learningLimit ? full.slice(-learningLimit) : full;
            }
        } catch (e) { }

        // Filter context to only include memories for THIS action (step observations)
        const actionPrefix = `${actionId}-step-`;
        const actionMemories = recentContext.filter(c => c.id && c.id.startsWith(actionPrefix));
        const otherMemories = recentContext.filter(c => !c.id || !c.id.startsWith(actionPrefix)).slice(0, 5);

        // Thread context: last N user/assistant messages from the same source+thread.
        // This is the main mechanism for grounding follow-ups (e.g., pronouns like "he") across actions.
        const source = (metadata.source || '').toString().toLowerCase();
        const sourceId = metadata.sourceId;
        const telegramChatId = metadata?.chatId ?? (source === 'telegram' ? sourceId : undefined);
        const telegramUserId = metadata?.userId;

        let threadContextString = '';
        try {
            const stopwords = new Set([
                'the','a','an','and','or','but','if','then','else','when','where','what','who','whom','which','why','how',
                'i','me','my','mine','you','your','yours','we','us','our','ours','they','them','their','theirs','he','him','his','she','her','hers','it','its',
                'to','of','in','on','at','for','from','with','as','by','about','into','over','after','before','between','through','during','without','within',
                'is','are','was','were','be','been','being','do','does','did','have','has','had','will','would','can','could','should','may','might','must'
            ]);

            const tokenize = (s: string): string[] => {
                const tokens = Array.from((s || '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
                return tokens.filter(t => t.length >= 3 && !stopwords.has(t));
            };

            const taskTokens = new Set(tokenize(taskDescription));
            const scoreRelevance = (content: string): number => {
                if (!content) return 0;
                const toks = tokenize(content);
                let overlap = 0;
                for (const t of toks) {
                    if (taskTokens.has(t)) overlap++;
                }
                return overlap;
            };

            const isLowSignal = (m: any): boolean => {
                const content = (m?.content || '').toString();
                const md = m?.metadata || {};
                if (md?.tool) return true;
                if (content.startsWith('Observation: Tool ')) return true;
                if (content.startsWith('[SYSTEM:')) return true;
                if (content.startsWith('Pipeline notes:')) return true;
                return false;
            };

            const shortAll = this.memory.searchMemory('short');

            const candidates = shortAll
                .filter(m => (m as any)?.metadata?.source && ((m as any).metadata.source || '').toString().toLowerCase() === source)
                .filter(m => {
                    if (!sourceId && !telegramChatId && !telegramUserId) return false;
                    const md: any = (m as any).metadata || {};

                    if (source === 'telegram') {
                        const matchChat = telegramChatId != null && md.chatId?.toString() === telegramChatId.toString();
                        const matchUser = telegramUserId != null && md.userId?.toString() === telegramUserId.toString();
                        // Back-compat: older actions used userId as sourceId.
                        const matchLegacy = sourceId != null && (md.userId?.toString() === sourceId.toString() || md.chatId?.toString() === sourceId.toString());
                        return matchChat || matchUser || matchLegacy;
                    }
                    if (source === 'whatsapp') {
                        return sourceId != null && (md.senderId?.toString() === sourceId.toString() || md.sourceId?.toString() === sourceId.toString());
                    }
                    if (source === 'discord') {
                        return sourceId != null && (md.channelId?.toString() === sourceId.toString() || md.sourceId?.toString() === sourceId.toString());
                    }
                    if (source === 'gateway-chat') {
                        return sourceId != null && (md.chatId?.toString() === sourceId.toString() || md.sourceId?.toString() === sourceId.toString());
                    }
                    return false;
                })
                .filter(m => !isLowSignal(m))
                .sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                });

            const RECENT_N = 8;
            const RELEVANT_N = 8;
            const MAX_LINE_LEN = 420;

            const recent = candidates.slice(0, RECENT_N);
            const relevant = [...candidates]
                .sort((a, b) => {
                    const sa = scoreRelevance((a as any).content || '');
                    const sb = scoreRelevance((b as any).content || '');
                    if (sb !== sa) return sb - sa;
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                })
                .slice(0, RELEVANT_N);

            const merged: any[] = [];
            const seen = new Set<string>();
            for (const m of [...recent, ...relevant]) {
                const id = (m as any)?.id || '';
                const key = id || `${m.timestamp || ''}:${(m.content || '').slice(0, 40)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(m);
            }

            if (merged.length > 0) {
                threadContextString = merged
                    .slice(0, RECENT_N + RELEVANT_N)
                    .map(m => {
                        const md: any = (m as any).metadata || {};
                        const role = md.role ? md.role.toString() : '';
                        const ts = (m as any).timestamp || '';
                        const raw = ((m as any).content || '').toString();
                        const clipped = raw.length > MAX_LINE_LEN ? raw.slice(0, MAX_LINE_LEN) + '…' : raw;
                        return `[${ts}]${role ? ` (${role})` : ''} ${clipped}`;
                    })
                    .join('\n');
            }
        } catch {
            // Best-effort only
        }
        
        // Build step history specific to this action
        const stepHistoryString = actionMemories.length > 0 
            ? actionMemories.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${c.content}`).join('\n')
            : 'No previous steps taken yet.';
        
        // Include limited other context for background awareness
        const otherContextString = otherMemories.length > 0
            ? otherMemories.map(c => `[${c.type}] ${c.content}`).join('\n')
            : '';

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
        } else if (metadata.source === 'discord') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Discord
- Channel ID: "${metadata.sourceId}" (User: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_discord" skill with channel_id="${metadata.sourceId}".
`;
        } else if (metadata.source === 'gateway-chat') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Gateway Chat (Web Interface)
- Rule: To respond to this user, you MUST use the "send_gateway_chat" skill.
`;
        }


        // Build core instructions that ALL LLM calls should have
        // isFirstStep already declared above
        const coreInstructions = this.buildCoreInstructions(availableSkills, this.agentIdentity, isFirstStep);

        // User context - limit only if very large (>2000 chars)
        const userContextStr = userContext.raw || '';
        const trimmedUserContext = userContextStr.length > 2000 
            ? userContextStr.slice(0, 2000) + '...[truncated]' 
            : userContextStr;

        // Full prompt for all steps - don't risk losing context
        const systemPrompt = `
${coreInstructions}

EXECUTION STATE:
- Action ID: ${actionId}
- messagesSent: ${metadata.messagesSent || 0}
- Sequence Step: ${metadata.currentStep || '1'}

EXECUTION PLAN:
${metadata.executionPlan || 'Proceed with standard reasoning.'}

${channelInstructions}

User Context (Long-term profile):
${trimmedUserContext || 'No user information available.'}

${journalContent ? `Agent Journal (Recent Reflections):\n${journalContent}` : ''}

${learningContent ? `Agent Learning Base (Knowledge):\n${learningContent}` : ''}

${threadContextString ? `THREAD CONTEXT (Same Chat):\n${threadContextString}` : ''}

STEP HISTORY FOR THIS ACTION (Action ${actionId}):
${stepHistoryString}

${otherContextString ? `RECENT BACKGROUND CONTEXT:\n${otherContextString}` : ''}
`;

        logger.info(`DecisionEngine: Deliberating on task: "${taskDescription}"`);
        
        // Use retry wrapper for main LLM call
        const rawResponse = await this.callLLMWithRetry(taskDescription, systemPrompt, actionId);
        const parsed = this.applyChannelDefaultsToTools(ParserLayer.normalize(rawResponse), metadata);

        // Validate response before processing
        const validation = ResponseValidator.validateResponse(parsed, allowedToolNames);
        ResponseValidator.logValidation(validation, `action ${actionId}`);
        
        // Filter out invalid tools if validation found errors
        if (!validation.valid && parsed.tools) {
            const originalCount = parsed.tools.length;
            const validTools = parsed.tools.filter(tool => {
                const toolValidation = ResponseValidator.validateResponse(
                    { ...parsed, tools: [tool] },
                    allowedToolNames
                );
                return toolValidation.valid;
            });
            parsed.tools = validTools;
            logger.warn(`DecisionEngine: Filtered out ${originalCount - parsed.tools.length} invalid tool(s) from response`);
        }

        // Run parsed response through structured pipeline guardrails
        let piped = this.pipeline.evaluate(parsed, {
            actionId: metadata.id || metadata.actionId || 'unknown',
            source: metadata.source,
            sourceId: metadata.sourceId,
            messagesSent: metadata.messagesSent || 0,
            currentStep: metadata.currentStep || 1,
            executionPlan: metadata.executionPlan,
            lane: metadata.lane,
            recentMemories: this.memory.getRecentContext(),
            allowedTools: allowedToolNames,
            taskDescription
        });

        // Termination review layer (always enabled)
        const isTerminating = piped?.verification?.goals_met === true && (!piped.tools || piped.tools.length === 0);
        if (isTerminating) {
            // Reuse the same core instructions so the review layer remembers its capabilities
            const reviewPrompt = `
${coreInstructions}

TERMINATION REVIEW LAYER:
Your job is to decide if the agent should truly terminate or continue working.

ADDITIONAL REVIEW RULES:
- If the task is TRULY complete (user got their answer, file downloaded, message sent, etc.), return goals_met=true with no tools.
- If the task is NOT complete and the agent stopped prematurely, return goals_met=false and include the WORK tools needed to continue (e.g., browser_navigate, web_search, run_command, send_telegram, etc.).
- Do NOT default to asking questions. Only use request_supporting_data if genuinely missing critical info that cannot be inferred.
- Prefer ACTION over CLARIFICATION. If the agent can make progress with available context, it should.

TASK:
${taskDescription}

EXECUTION PLAN:
${metadata.executionPlan || 'No plan provided.'}

STEP HISTORY FOR THIS ACTION (Action ${actionId}):
${stepHistoryString}

PROPOSED RESPONSE (agent wanted to terminate with this):
${JSON.stringify(piped, null, 2)}

QUESTION: Was the original task completed? If not, what tools should be called next to make progress?
`;

            const reviewRaw = await this.callLLMWithRetry(taskDescription, reviewPrompt, actionId);
            const reviewParsed = ParserLayer.normalize(reviewRaw);
            const reviewed = this.pipeline.evaluate(reviewParsed, {
                actionId: metadata.id || metadata.actionId || 'unknown',
                source: metadata.source,
                sourceId: metadata.sourceId,
                messagesSent: metadata.messagesSent || 0,
                currentStep: metadata.currentStep || 1,
                executionPlan: metadata.executionPlan,
                lane: metadata.lane,
                recentMemories: this.memory.getRecentContext(),
                allowedTools: allowedToolNames,
                taskDescription
            });

            if (reviewed?.verification?.goals_met === false || (reviewed.tools && reviewed.tools.length > 0)) {
                piped = reviewed;
            }
        }

        // Log execution summary
        const state = this.executionStateManager.getState(actionId);
        if (state.attempts.length > 1) {
            logger.info(`DecisionEngine: ${state.getSummary()}`);
        }

        // Clean up state if action is terminating
        if (piped?.verification?.goals_met === true && (!piped.tools || piped.tools.length === 0)) {
            this.executionStateManager.removeState(actionId);
        }

        return piped;
    }

    /**
     * Get execution statistics for monitoring
     */
    public getExecutionStats() {
        return this.executionStateManager.getStats();
    }
}
