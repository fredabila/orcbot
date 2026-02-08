import { MemoryManager } from '../memory/MemoryManager';
import { MultiLLM, LLMToolResponse } from './MultiLLM';
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
import { PromptRouter, PromptHelperContext } from './prompts';

export class DecisionEngine {
    private agentIdentity: string = '';
    private pipeline: DecisionPipeline;
    private systemContext: string;
    private executionStateManager: ExecutionStateManager;
    private promptRouter: PromptRouter;
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
        this.promptRouter = new PromptRouter();
        this.promptRouter.setLLM(this.llm);
    }

    /**
     * Builds a dynamic transparency nudge based on how long the agent has been
     * working silently. This encourages the LLM to send progress updates so the
     * user isn't left wondering what's happening.
     */
    private buildTransparencyNudge(metadata: any): string {
        const stepsSinceMsg = metadata.stepsSinceLastMessage ?? 0;
        const currentStep = metadata.currentStep || 1;
        const messagesSent = metadata.messagesSent || 0;
        const isResearch = metadata.isResearchTask || false;

        // No nudge needed for first step or if just sent a message
        if (currentStep <= 1 || stepsSinceMsg <= 1) return '';

        // Thresholds: lower for research tasks (lots of work under the hood)
        const softNudge = isResearch ? 3 : 4;
        const hardNudge = isResearch ? 5 : 7;

        if (stepsSinceMsg >= hardNudge) {
            return `⚡ TRANSPARENCY ALERT: You have been working for ${stepsSinceMsg} steps without updating the user.
The user cannot see your internal work — they only see messages you send them.
You SHOULD send a brief progress update NOW. Examples:
- "I've found [X] so far. Still checking [Y]..."
- "Working on it — I've [done A and B], now [doing C]..."
- "Quick update: [brief status]. I'll send the full result shortly."
Keep it to 1-2 sentences. Do NOT claim completion unless you are truly done.`;
        }

        if (stepsSinceMsg >= softNudge) {
            return `💡 TRANSPARENCY NOTE: You have been working for ${stepsSinceMsg} steps since your last message to the user.
If you've made meaningful progress (found data, completed a sub-task, hit a blocker), consider sending a brief status update.
The user appreciates knowing what's happening, especially during complex tasks.`;
        }

        return '';
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
     * Builds an optimized system prompt using the modular PromptHelper system.
     * The PromptRouter analyzes the task and selects only the relevant helpers,
     * so simple tasks get lean prompts and complex tasks get focused guidance.
     */
    private async buildHelperPrompt(
        availableSkills: string,
        agentIdentity: string,
        taskDescription: string,
        metadata: Record<string, any>,
        isFirstStep: boolean = true,
        contactProfile?: string,
        profilingEnabled?: boolean,
        isHeartbeat?: boolean
    ): Promise<string> {
        // Load bootstrap context
        const bootstrapContext: Record<string, string> = {};
        if (this.bootstrap) {
            try {
                const ctx = this.bootstrap.loadBootstrapContext();
                if (ctx.IDENTITY) bootstrapContext.IDENTITY = ctx.IDENTITY;
                if (ctx.SOUL) bootstrapContext.SOUL = ctx.SOUL;
                if (ctx.AGENTS) bootstrapContext.AGENTS = ctx.AGENTS;
            } catch (e) {
                logger.debug(`DecisionEngine: Could not load bootstrap context: ${e}`);
            }
        }

        const helperContext: PromptHelperContext = {
            taskDescription,
            metadata,
            availableSkills,
            agentIdentity,
            isFirstStep,
            systemContext: this.getSystemContext(),
            bootstrapContext,
            contactProfile,
            profilingEnabled,
            isHeartbeat
        };

        const result = await this.promptRouter.route(helperContext);

        if (result.estimatedSavings > 500) {
            logger.info(`PromptRouter: Active helpers [${result.activeHelpers.join(', ')}] — saved ~${result.estimatedSavings} chars`);
        }

        // Append agent skills (loaded on-demand) — always included
        let agentSkillsSection = '';
        if (this.skills.getAgentSkills().length > 0) {
            agentSkillsSection = `\nAGENT SKILLS (SKILL.md packages — use activate_skill to load full instructions):\n${this.skills.getAgentSkillsPrompt()}`;
        }
        const activatedContext = this.skills.getActivatedSkillsContext();
        if (activatedContext) {
            agentSkillsSection += `\n\nACTIVATED SKILL INSTRUCTIONS (Loaded on demand):\n${activatedContext}`;
        }

        return result.composedPrompt + agentSkillsSection;
    }

    /**
     * LEGACY: Builds the core system instructions that should be present in ALL LLM calls.
     * Kept for backward compatibility with the termination review layer.
     * @deprecated Use buildHelperPrompt() for new code.
     */
    private async buildCoreInstructions(availableSkills: string, agentIdentity: string, isFirstStep: boolean = true): Promise<string> {
        return this.buildHelperPrompt(availableSkills, agentIdentity, '', {}, isFirstStep);
    }

    public setAgentIdentity(identity: string) {
        this.agentIdentity = identity;
    }

    /**
     * Get the PromptRouter for registering custom helpers (e.g., from plugins).
     */
    public getPromptRouter(): PromptRouter {
        return this.promptRouter;
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
     * Make an LLM call with native tool calling and retry logic.
     * Falls back to text-based callLLMWithRetry if tool calling fails.
     */
    private async callLLMWithToolsAndRetry(
        prompt: string,
        systemPrompt: string,
        actionId: string,
        attemptNumber: number = 1
    ): Promise<StandardResponse> {
        const state = this.executionStateManager.getState(actionId);
        const toolDefs = this.skills.getToolDefinitions();

        try {
            const response: LLMToolResponse = await this.llm.callWithTools(
                prompt, systemPrompt, toolDefs
            );

            state.recordAttempt({
                response: { success: true, content: response.content },
                contextSize: systemPrompt.length + prompt.length
            });

            // If the API returned native tool calls, use the native parser
            if (response.toolCalls.length > 0) {
                logger.info(`DecisionEngine: Native tool calling returned ${response.toolCalls.length} tool(s)`);
                return ParserLayer.normalizeNativeToolResponse(response.content, response.toolCalls);
            }

            // No native tool calls — the model responded with text only.
            // Parse the text for embedded JSON (reasoning, verification, content)
            return ParserLayer.normalize(response.content);
        } catch (error) {
            const classified = ErrorClassifier.classify(error);
            state.recordAttempt({
                error: classified,
                contextSize: systemPrompt.length + prompt.length
            });

            logger.warn(`DecisionEngine: Tool call failed (attempt ${attemptNumber}): ${classified.type} - ${classified.message}`);

            // Context overflow → compact and retry
            if (classified.type === ErrorType.CONTEXT_OVERFLOW && this.enableAutoCompaction) {
                if (state.shouldTryCompaction()) {
                    logger.info('DecisionEngine: Attempting context compaction for tool call...');
                    state.markCompactionAttempted();
                    const compacted = await this.contextCompactor.compact(systemPrompt, {
                        targetLength: Math.floor(systemPrompt.length * 0.6),
                        strategy: 'truncate'
                    });
                    return this.callLLMWithToolsAndRetry(prompt, compacted, actionId, attemptNumber + 1);
                }
            }

            // Retry on retryable errors
            if (ErrorClassifier.shouldRetry(classified, attemptNumber, this.maxRetries)) {
                const delay = classified.cooldownMs || ErrorClassifier.getBackoffDelay(attemptNumber - 1);
                logger.info(`DecisionEngine: Retrying tool call after ${delay}ms (attempt ${attemptNumber + 1}/${this.maxRetries})`);
                await this.sleep(delay);
                return this.callLLMWithToolsAndRetry(prompt, systemPrompt, actionId, attemptNumber + 1);
            }

            // Final fallback: try text-based call
            logger.warn('DecisionEngine: Native tool calling exhausted retries, falling back to text-based');
            const rawResponse = await this.callLLMWithRetry(prompt, systemPrompt, actionId);
            return ParserLayer.normalize(rawResponse);
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

        // Detect heartbeat/autonomy tasks — they carry their own rich context
        // in the task description, so we use a lightweight prompt assembly path
        // that skips redundant journal/learning/thread/semantic/episodic/channel context.
        const isHeartbeat = !!metadata.isHeartbeat;

        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();
        const availableSkills = this.skills.getSkillsPrompt();
        const allowedToolNames = this.skills.getAllSkills().map(s => s.name);

        // Auto-activate matching agent skills for this task (progressive disclosure)
        if ((metadata.currentStep || 1) === 1) {
            // Reset non-sticky skills so stale context doesn't leak across actions
            this.skills.deactivateNonStickySkills();

            const matchedSkills = this.skills.matchSkillsForTask(taskDescription);
            for (const matched of matchedSkills) {
                if (!matched.activated) {
                    this.skills.activateAgentSkill(matched.meta.name);
                    logger.info(`DecisionEngine: Auto-activated skill "${matched.meta.name}" for task`);
                }
            }
        }

        // Load Journal and Learning - keep meaningful context
        // Skip for heartbeats — the heartbeat prompt already includes journal/learning tails
        const isFirstStep = (metadata.currentStep || 1) === 1;
        const journalLimit = 1500;  // Recent reflections
        const learningLimit = 1500; // Knowledge base
        
        let journalContent = '';
        let learningContent = '';
        if (!isHeartbeat) {
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
        }

        // Filter context to only include memories for THIS action (step observations)
        const actionPrefix = `${actionId}-step-`;
        const actionMemories = recentContext.filter(c => c.id && c.id.startsWith(actionPrefix));
        // Other memories for background awareness — but EXCLUDE step-injection [SYSTEM:]
        // memories from other actions. These contain action-specific guidance (error feedback,
        // pivot suggestions, "DO NOT call X again") that is MISLEADING in a new action context.
        // Without this filter, old error warnings from prior actions override current step results.
        const otherMemories = recentContext
            .filter(c => !c.id || !c.id.startsWith(actionPrefix))
            .filter(c => {
                const content = (c.content || '').toString();
                const id = (c.id || '').toString();
                // Step-scoped SYSTEM injections (e.g. "abc123-step-3-send_file-error-feedback")
                // are guidance for THAT action only — don't leak them into new actions.
                if (content.startsWith('[SYSTEM:') && id.includes('-step-')) {
                    return false;
                }
                return true;
            })
            .slice(0, 5);

        // Thread context: last N user/assistant messages from the same source+thread.
        // This is the main mechanism for grounding follow-ups (e.g., pronouns like "he") across actions.
        // Skip for heartbeats — there's no conversation thread to track (source='autonomy').
        const source = (metadata.source || '').toString().toLowerCase();
        const sourceId = metadata.sourceId;
        const telegramChatId = metadata?.chatId ?? (source === 'telegram' ? sourceId : undefined);
        const telegramUserId = metadata?.userId;

        let threadContextString = '';
        if (!isHeartbeat) {
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

            // Keyword-scored relevance (fallback when vector memory unavailable)
            const getKeywordRelevant = () => [...candidates]
                .sort((a, b) => {
                    const sa = scoreRelevance((a as any).content || '');
                    const sb = scoreRelevance((b as any).content || '');
                    if (sb !== sa) return sb - sa;
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                })
                .slice(0, RELEVANT_N);

            // Prefer semantic similarity when vector memory is available.
            // Semantic search understands meaning (not just keyword overlap), so it
            // surfaces genuinely relevant thread messages even when wording differs.
            let relevant: any[];
            if (this.memory.vectorMemory?.isEnabled() && candidates.length > RECENT_N) {
                try {
                    const candidateIds = new Set(candidates.map((m: any) => m.id).filter(Boolean));
                    const semanticHits = await this.memory.semanticSearch(
                        taskDescription, RELEVANT_N * 3, { source }
                    );
                    const matched = semanticHits
                        .filter(h => candidateIds.has(h.id))
                        .slice(0, RELEVANT_N);
                    // Need at least 2 semantic hits to be useful; otherwise keyword fallback
                    relevant = matched.length >= 2
                        ? matched.map(h => candidates.find((c: any) => c.id === h.id)).filter(Boolean)
                        : getKeywordRelevant();
                } catch {
                    relevant = getKeywordRelevant();
                }
            } else {
                relevant = getKeywordRelevant();
            }

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
        } // end !isHeartbeat guard for thread context
        
        // Build step history specific to this action
        // Apply PROACTIVE COMPACTION when step history is large to prevent context overflow.
        // Strategy: always preserve first 2 steps (task orientation) and last 5 steps (recent context).
        // Middle steps get compressed: consecutive same-tool calls are merged, system injections summarized.
        let stepHistoryString: string;
        if (actionMemories.length === 0) {
            stepHistoryString = 'No previous steps taken yet.';
        } else if (actionMemories.length <= 10) {
            // Small enough — include everything
            stepHistoryString = actionMemories
                .map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${c.content}`)
                .join('\n');
        } else {
            // COMPACTION: preserve first 2 + last 5, summarize middle
            const first = actionMemories.slice(0, 2);
            const last = actionMemories.slice(-5);
            const middle = actionMemories.slice(2, -5);

            // Compress middle: group by tool, count successes/failures
            const middleSummary: string[] = [];
            let currentTool = '';
            let toolCount = 0;
            let toolSuccesses = 0;
            let toolFailures = 0;
            const flushGroup = () => {
                if (currentTool && toolCount > 0) {
                    middleSummary.push(`  ... ${currentTool} x${toolCount} (${toolSuccesses} ok, ${toolFailures} err)`);
                }
            };
            for (const m of middle) {
                const content = m.content || '';
                // Detect tool name from observation
                const toolMatch = content.match(/Tool (\S+) (?:succeeded|returned|FAILED)/);
                const tool = toolMatch ? toolMatch[1] : (content.startsWith('[SYSTEM:') ? '[SYSTEM]' : 'other');
                if (tool !== currentTool) {
                    flushGroup();
                    currentTool = tool;
                    toolCount = 0;
                    toolSuccesses = 0;
                    toolFailures = 0;
                }
                toolCount++;
                if (content.includes('succeeded') || content.includes('returned')) toolSuccesses++;
                if (content.includes('FAILED') || content.includes('ERROR')) toolFailures++;
            }
            flushGroup();

            const firstStr = first.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${c.content}`).join('\n');
            const lastStr = last.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${c.content}`).join('\n');
            stepHistoryString = `${firstStr}\n  --- [${middle.length} middle steps compacted] ---\n${middleSummary.join('\n')}\n  --- [recent steps below] ---\n${lastStr}`;
        }
        
        // Include limited other context for background awareness
        const otherContextString = otherMemories.length > 0
            ? otherMemories.map(c => `[${c.type}] ${c.content}`).join('\n')
            : '';

        // SEMANTIC LONG-TERM RECALL: Search the entire vector store for memories
        // relevant to this task — across ALL channels, ALL memory types.
        // This is how the agent "remembers" things from days/weeks ago.
        // Skip for heartbeats — the heartbeat prompt includes its own recent context.
        let semanticRecallString = '';
        if (!isHeartbeat) {
        try {
            if (this.memory.vectorMemory?.isEnabled()) {
                // Collect IDs already shown to avoid duplicates
                const shownIds = new Set<string>();
                for (const m of [...actionMemories, ...otherMemories]) {
                    if (m.id) shownIds.add(m.id);
                }
                // Also exclude thread context memories
                // (threadContextString is already built from merged memories above)

                const recalled = await this.memory.semanticRecall(taskDescription, 6, shownIds);
                if (recalled.length > 0) {
                    semanticRecallString = recalled
                        .map(r => {
                            const ts = r.timestamp || '';
                            const src = r.metadata?.source ? ` [${r.metadata.source}]` : '';
                            const content = r.content.length > 400 ? r.content.slice(0, 400) + '…' : r.content;
                            return `[${ts}]${src} (relevance: ${(r.score * 100).toFixed(0)}%) ${content}`;
                        })
                        .join('\n');
                }
            }
        } catch {
            // Best-effort only — agent still works without this
        }
        }

        // SEMANTIC EPISODIC RETRIEVAL: Instead of just the last N episodic summaries,
        // find the ones most relevant to the current task
        // Skip for heartbeats — the heartbeat prompt is self-contained.
        let semanticEpisodicString = '';
        if (!isHeartbeat) {
        try {
            const relevantEpisodic = await this.memory.getRelevantEpisodicMemories(taskDescription, 5);
            if (relevantEpisodic.length > 0) {
                semanticEpisodicString = relevantEpisodic
                    .map(m => {
                        const ts = m.timestamp || '';
                        const content = (m.content || '').length > 500 ? m.content.slice(0, 500) + '…' : m.content;
                        return `[${ts}] ${content}`;
                    })
                    .join('\n');
            }
        } catch {
            // Fall through — episodic context is still available via getRecentContext
        }
        }

        // Channel instructions and contact profiles — irrelevant for heartbeats (source='autonomy')
        let channelInstructions = '';
        let contactProfile: string | undefined;
        let profilingEnabled = false;
        if (!isHeartbeat) {
        if (metadata.source === 'telegram') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Telegram
- Chat ID: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_telegram" skill.
`;
        } else if (metadata.source === 'whatsapp') {
            profilingEnabled = !!this.memory.getUserContext().raw?.includes('whatsappContextProfilingEnabled: true');
            contactProfile = this.memory.getContactProfile(metadata.sourceId) || undefined;

            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: WhatsApp
- JID: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_whatsapp" skill.
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
        } // end !isHeartbeat guard for channel instructions


        // Build task-optimized prompt using the modular PromptHelper system.
        // The router analyzes the task and selects only the relevant helpers.
        const coreInstructions = await this.buildHelperPrompt(
            availableSkills,
            this.agentIdentity,
            taskDescription,
            metadata,
            isFirstStep,
            contactProfile,
            profilingEnabled,
            isHeartbeat
        );

        // User context - skip for heartbeats (already in heartbeat prompt)
        const userContextStr = userContext.raw || '';
        const trimmedUserContext = isHeartbeat ? '' : (userContextStr.length > 2000 
            ? userContextStr.slice(0, 2000) + '...[truncated]' 
            : userContextStr);

        // Full prompt for all steps - don't risk losing context
        const systemPrompt = `
${coreInstructions}

EXECUTION STATE:
- Action ID: ${actionId}
- messagesSent: ${metadata.messagesSent || 0}
- Sequence Step: ${metadata.currentStep || '1'}
- Steps Since Last Message: ${metadata.stepsSinceLastMessage ?? 0}
- Task Type: ${metadata.isResearchTask ? 'Research/Deep Work' : 'Standard'}

EXECUTION PLAN:
${metadata.executionPlan || 'Proceed with standard reasoning.'}

${channelInstructions}

${this.buildTransparencyNudge(metadata)}

User Context (Long-term profile):
${trimmedUserContext || 'No user information available.'}

${journalContent ? `Agent Journal (Recent Reflections):\n${journalContent}` : ''}

${learningContent ? `Agent Learning Base (Knowledge):\n${learningContent}` : ''}

${threadContextString ? `THREAD CONTEXT (Same Chat):\n${threadContextString}` : ''}

${semanticEpisodicString ? `EPISODIC MEMORY (Task-Relevant Summaries — past actions, outcomes, and learnings):\n${semanticEpisodicString}` : ''}

${semanticRecallString ? `LONG-TERM RECALL (Semantically relevant memories from all channels and time periods — your deep memory):\n${semanticRecallString}` : ''}

⚠️ STEP HISTORY FOR THIS ACTION (Action ${actionId}) — THIS IS YOUR GROUND TRUTH:
(If a tool SUCCEEDED here, that result is REAL and CONFIRMED. If a tool FAILED, DO NOT repeat the same call.)
(STEP HISTORY always takes priority over background context below.)
${stepHistoryString}

${otherContextString ? `RECENT BACKGROUND CONTEXT (reference only — may describe older/different actions):\n${otherContextString}` : ''}
`;

        logger.info(`DecisionEngine: Deliberating on task: "${taskDescription}"`);
        
        // Use native tool calling when the provider supports it, otherwise fall back to text-based
        const useNativeTools = this.llm.supportsNativeToolCalling();
        let parsed: StandardResponse;

        if (useNativeTools) {
            // Native tool calling: structured tool definitions passed to API
            // The system prompt uses a slimmer format (no JSON format instructions needed)
            const nativeSystemPrompt = systemPrompt.replace(
                ParserLayer.getSystemPromptSnippet(),
                ParserLayer.getNativeToolCallingPromptSnippet()
            );
            const rawParsed = await this.callLLMWithToolsAndRetry(taskDescription, nativeSystemPrompt || systemPrompt, actionId);
            parsed = this.applyChannelDefaultsToTools(rawParsed, metadata);
            logger.info(`DecisionEngine: Used native tool calling — ${parsed.tools?.length || 0} tool(s)`);
        } else {
            // Text-based: tools embedded in prompt, parse JSON from response
            const rawResponse = await this.callLLMWithRetry(taskDescription, systemPrompt, actionId);
            parsed = this.applyChannelDefaultsToTools(ParserLayer.normalize(rawResponse), metadata);
        }

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
            const filteredCount = originalCount - validTools.length;
            parsed.tools = validTools;
            if (filteredCount > 0) {
                parsed.toolsFiltered = filteredCount;
                logger.warn(`DecisionEngine: Filtered out ${filteredCount} invalid tool(s) from response`);
            }
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
- CRITICAL: If this task came from a messaging channel (Telegram/WhatsApp/Discord/Gateway) and messagesSent is 0, the user has received NOTHING. The agent's text reasoning is invisible to the user. You MUST return goals_met=false and include the appropriate send skill (send_telegram, send_whatsapp, send_discord, send_gateway_chat) with the response message.
- Do NOT default to asking questions. Only use request_supporting_data if genuinely missing critical info that cannot be inferred.
- Prefer ACTION over CLARIFICATION. If the agent can make progress with available context, it should.

TASK:
${taskDescription}

EXECUTION PLAN:
${metadata.executionPlan || 'No plan provided.'}

⚠️ STEP HISTORY FOR THIS ACTION (Action ${actionId}) — READ BEFORE ACTING:
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
