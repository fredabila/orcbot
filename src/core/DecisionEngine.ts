import { MemoryManager } from '../memory/MemoryManager';
import { MultiLLM, LLMToolResponse } from './MultiLLM';
import { ParserLayer, StandardResponse } from './ParserLayer';
import { SkillsManager } from './SkillsManager';
import { logger } from '../utils/logger';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { DecisionPipeline } from './DecisionPipeline';
import { ErrorClassifier, ErrorType } from './ErrorClassifier';
import { ExecutionStateManager } from './ExecutionState';
import { ContextCompactor } from './ContextCompactor';
import { ResponseValidator } from './ResponseValidator';
import { BootstrapManager } from './BootstrapManager';
import { PromptRouter, PromptHelperContext } from './prompts';
import { KnowledgeStore } from '../memory/KnowledgeStore';
import { ToolsManager } from './ToolsManager';
import { Environment } from './utils/Environment';

export class DecisionEngine {
    private agentIdentity: string = '';
    private pipeline: DecisionPipeline;
    private executionStateManager: ExecutionStateManager;
    private promptRouter: PromptRouter;
    private contextCompactor: ContextCompactor;
    private maxRetries: number;
    private enableAutoCompaction: boolean;
    private bootstrap?: BootstrapManager;
    private knowledgeStore?: KnowledgeStore;
    private tools?: ToolsManager;
    private repoContext: string;

    // ── Per-action prompt cache ──
    // The core instructions (bootstrap + identity + skills + helpers) are ~80% identical
    // across steps within the same action. Cache the expensive buildHelperPrompt() result
    // and only rebuild on first step or when the action ID changes.
    private _cachedCoreInstructions: string = '';
    private _cachedCoreActionId: string = '';
    private _fileIntentCache: Map<string, 'requested' | 'not_requested' | 'unknown'> = new Map();

    constructor(
        private memory: MemoryManager,
        private llm: MultiLLM,
        private skills: SkillsManager,
        private journalPath: string = './JOURNAL.md',
        private learningPath: string = './LEARNING.md',
        private worldPath: string = './WORLD.md',
        private config?: ConfigManager,
        bootstrap?: BootstrapManager,
        tools?: ToolsManager
    ) {
        this.bootstrap = bootstrap;
        this.tools = tools;
        this.pipeline = new DecisionPipeline(this.config || new ConfigManager());
        this.repoContext = this.buildRepoContext();
        this.executionStateManager = new ExecutionStateManager();
        this.contextCompactor = new ContextCompactor(this.llm);
        this.maxRetries = this.config?.get('decisionEngineMaxRetries') || 3;
        this.enableAutoCompaction = this.config?.get('decisionEngineAutoCompaction') !== false;
        this.promptRouter = new PromptRouter();
        this.promptRouter.setLLM(this.llm);
    }

    /**
     * Set the KnowledgeStore for RAG auto-retrieval during decision making.
     */
    setKnowledgeStore(store: KnowledgeStore): void {
        this.knowledgeStore = store;
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

        // Thresholds: lower for research/complex tasks (lots of invisible work under the hood)
        const softNudge = isResearch ? 2 : 3;
        const hardNudge = isResearch ? 4 : 5;

        if (stepsSinceMsg >= hardNudge) {
            return `⚡ TRANSPARENCY ALERT: You have been working for ${stepsSinceMsg} steps without updating the user.
The user cannot see your internal work — they only see messages you send them.
You MUST send a brief progress update NOW. Tell the user:
- What you've done so far (specific results, not vague)
- What you're working on right now
- What's left to do (if anything)
Examples:
- "I've found [X] so far. Still checking [Y]..."
- "Working on it — I've [done A and B], now [doing C]..."
- "Quick update: [brief status]. I'll send the full result shortly."
- "Hit a snag with [X], trying a different approach..."
Keep it to 1-2 sentences. Do NOT claim completion unless you are truly done.`;
        }

        if (stepsSinceMsg >= softNudge) {
            return `💡 TRANSPARENCY NOTE: You have been working for ${stepsSinceMsg} steps since your last message to the user.
If you've made meaningful progress (found data, completed a sub-task, hit a blocker), send a brief status update.
The user appreciates knowing what's happening, especially during complex tasks. Silence feels like failure.`;
        }

        return '';
    }

    private buildTimeSignalsNudge(metadata: any): string {
        const timeSignals = metadata?.timeSignals;
        if (!timeSignals || typeof timeSignals !== 'object') return '';

        const queueAgeSec = Number(timeSignals.queueAgeSec ?? 0);
        const actionRuntimeSec = Number(timeSignals.actionRuntimeSec ?? 0);
        const sinceLastDeliverySec = Number(timeSignals.sinceLastDeliverySec ?? 0);
        const avgSecPerStep = Number(timeSignals.avgSecPerStep ?? 0);
        const taskIntent = String(timeSignals.taskIntent || 'task_execution');
        const delayRisk = String(timeSignals.delayRisk || 'low').toLowerCase();

        const riskGuidance = delayRisk === 'high'
            ? `
⚠️ TIME RISK HIGH: You are delaying user-visible delivery. Prioritize immediate progress communication and concrete output.`
            : delayRisk === 'medium'
                ? `
⏱️ TIME RISK MEDIUM: Avoid silent drift. Prefer concise progress/result messaging if meaningful work was done.`
                : '';

        return `TIME SIGNALS (real runtime telemetry):
- Queue Age: ${queueAgeSec}s
- Action Runtime: ${actionRuntimeSec}s
- Time Since Last User-Visible Delivery: ${sinceLastDeliverySec}s
- Average Pace: ${avgSecPerStep}s/step
- Task Intent: ${taskIntent}
- Delay Risk: ${delayRisk.toUpperCase()}${riskGuidance}`;
    }

    private buildRepoContext(): string {
        try {
            const cwd = process.cwd();
            const packagePath = path.join(cwd, 'package.json');
            const tsConfigPath = path.join(cwd, 'tsconfig.json');
            const srcPath = path.join(cwd, 'src');
            const testsPath = path.join(cwd, 'tests');

            let packageName = path.basename(cwd);
            let packageVersion = 'unknown';
            const scripts: string[] = [];

            if (fs.existsSync(packagePath)) {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
                packageName = pkg.name || packageName;
                packageVersion = pkg.version || packageVersion;
                const scriptKeys = Object.keys(pkg.scripts || {});
                scripts.push(...scriptKeys.filter(key => ['build', 'dev', 'start', 'test'].includes(key)));
            }

            const traits: string[] = [];
            if (fs.existsSync(tsConfigPath)) traits.push('typescript');
            if (fs.existsSync(srcPath)) traits.push('src-tree');
            if (fs.existsSync(testsPath)) traits.push('tests');

            return `- Repo: ${packageName}@${packageVersion}
- CWD: ${cwd}
- Traits: ${traits.join(', ') || 'unknown'}
- Common scripts: ${scripts.join(', ') || 'none detected'}
- Reminder: prefer edits aligned with existing architecture and keep changes scoped.`;
        } catch (error) {
            logger.debug(`DecisionEngine: Failed to build repo context: ${error}`);
            return '- Repo context unavailable';
        }
    }

    private getSystemContext(): string {
        return Environment.getSystemPromptSnippet();
    }

    private async inferFileIntentForAction(
        actionId: string,
        taskDescription: string,
        recentMemories: any[]
    ): Promise<'requested' | 'not_requested' | 'unknown'> {
        const cached = this._fileIntentCache.get(actionId);
        if (cached) return cached;

        // Keep this classifier lightweight and bounded.
        const recentUserContext = (recentMemories || [])
            .slice(-8)
            .map(m => (m?.content || '').toString())
            .filter(Boolean)
            .join('\n')
            .slice(0, 1200);

        const systemMessage = `You are an intent classifier for response delivery mode.
Return ONLY valid JSON in this shape: {"file_requested": true|false, "confidence": 0-1}

Set file_requested=true only when the user explicitly asks for a file/attachment/screenshot/image/document/audio file delivery.
If the user asks for an opinion, explanation, summary, or normal chat response, set file_requested=false.`;

        try {
            const raw = await this.llm.callFast(
                `Task: ${taskDescription}\n\nRecent user/context messages:\n${recentUserContext || '(none)'}`,
                systemMessage
            );

            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                this._fileIntentCache.set(actionId, 'unknown');
                return 'unknown';
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const confidence = Number(parsed?.confidence ?? 0);
            const requested = parsed?.file_requested === true;

            const verdict: 'requested' | 'not_requested' | 'unknown' =
                confidence >= 0.65 ? (requested ? 'requested' : 'not_requested') : 'unknown';

            this._fileIntentCache.set(actionId, verdict);
            logger.info(`DecisionEngine: File intent classifier => ${verdict} (confidence=${isNaN(confidence) ? 0 : confidence.toFixed(2)})`);
            return verdict;
        } catch (e) {
            logger.debug(`DecisionEngine: File intent classifier failed, falling back to heuristic: ${e}`);
            this._fileIntentCache.set(actionId, 'unknown');
            return 'unknown';
        }
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

            if (name === 'send_slack') {
                if ((source === 'slack') && sourceId && !toolMetadata.channel_id) {
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
        isHeartbeat?: boolean,
        skillsUsedInAction?: string[]
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
            systemContext: `${this.getSystemContext()}
REPOSITORY CONTEXT:
${this.repoContext}`,
            bootstrapContext,
            contactProfile,
            profilingEnabled,
            isHeartbeat,
            skillsUsedInAction,
            overrideMode: !!this.config?.get('overrideMode'),
            // Inject agent role if available (from worker profile or config)
            agentRole: this.config?.get('agentRole'), // We will need to set this in AgentWorker
            tforce: metadata.tforce
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
        let toolsSection = '';
        if (this.tools) {
            const toolsPrompt = this.tools.getToolsPrompt();
            if (toolsPrompt) {
                toolsSection += `\n\nTHIRD-PARTY TOOLS:\n${toolsPrompt}`;
            }
            const activatedTools = this.tools.getActivatedToolsContext();
            if (activatedTools) {
                toolsSection += `\n\nACTIVATED TOOL CONTEXT:\n${activatedTools}`;
            }
        }

        return result.composedPrompt + agentSkillsSection + toolsSection;
    }

    /**
     * Clear the per-action core instruction cache.
     * Useful when configuration (like identity or skills) changes mid-session.
     */
    public clearCache(): void {
        this._cachedCoreActionId = null;
        this._cachedCoreInstructions = null;
        logger.info('DecisionEngine: Prompt cache cleared');
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
        attemptNumber: number = 1,
        excludeSkills?: Set<string>
    ): Promise<StandardResponse> {
        const state = this.executionStateManager.getState(actionId);
        const toolDefs = this.skills.getToolDefinitions(excludeSkills);

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
                    return this.callLLMWithToolsAndRetry(prompt, compacted, actionId, attemptNumber + 1, excludeSkills);
                }
            }

            // Retry on retryable errors
            if (ErrorClassifier.shouldRetry(classified, attemptNumber, this.maxRetries)) {
                const delay = classified.cooldownMs || ErrorClassifier.getBackoffDelay(attemptNumber - 1);
                logger.info(`DecisionEngine: Retrying tool call after ${delay}ms (attempt ${attemptNumber + 1}/${this.maxRetries})`);
                await this.sleep(delay);
                return this.callLLMWithToolsAndRetry(prompt, systemPrompt, actionId, attemptNumber + 1, excludeSkills);
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

        logger.info(`Agent: Starting deliberation for task "${taskDescription.slice(0, 50)}..." (Action ID: ${actionId})`);

        // Detect heartbeat/autonomy tasks — they carry their own rich context
        // in the task description, so we use a lightweight prompt assembly path
        // that skips redundant journal/learning/thread/semantic/episodic/channel context.
        const isHeartbeat = !!metadata.isHeartbeat;

        const userContext = this.memory.getUserContext();
        const recentContext = this.memory.getRecentContext();

        // Filter out elevated skills for non-admin users
        const isAdmin = metadata.isAdmin !== false; // undefined = admin (backwards compatible)
        const excludeSkills = !isAdmin ? this.skills.getElevatedSkills() : undefined;


        // Declare isFirstStep before usage
        const isFirstStep = (metadata.currentStep || 1) === 1;

        // TOKEN OPTIMIZATION: Progressive Skill Disclosure
        // 1. On first step, try to find only RELEVANT skills based on keywords.
        // 2. On subsequent steps, use COMPACT skills (names + usage only).
        // 3. Fallback to full list only if needed.
        let availableSkills: string;
        const useCompactSkills = this.config?.get('compactSkillsPrompt') === true || (metadata.currentStep || 1) > 1;
        const skipSim = this.config?.get('skipSimulationForSimpleTasks') !== false;

        if (useCompactSkills) {
            availableSkills = this.skills.getCompactSkillsPrompt();
        } else if (isFirstStep) {
            const stopwords = ['to','the','a','and','of','for','in','on','at','with','about','from'];
            const keywords = taskDescription.toLowerCase().split(/\W+/).filter(k => k.length > 2 && !stopwords.includes(k));
            availableSkills = this.skills.getRelevantSkillsPrompt(keywords);
        } else {
            availableSkills = this.skills.getSkillsPrompt(excludeSkills);
        }

        const allowedToolNames = this.skills.getAllSkills()
            .filter(s => !excludeSkills || !excludeSkills.has(s.name))
            .map(s => s.name);

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

        // Load Journal and Learning - configurable context window sizes
        // Skip for heartbeats — the heartbeat prompt already includes journal/learning tails
        // (isFirstStep already declared above)
        const journalLimit  = Number(this.config?.get('journalContextLimit')  ?? 1500);
        const learningLimit = Number(this.config?.get('learningContextLimit') ?? 1500);
        
        // TOKEN OPTIMIZATION: Omit journal/learning tail if we are deep into an action.
        // It was likely already included in Step 1 and is now in the model's KV cache
        // or short-term memory. Including it every step wastes tokens.
        const omitRedundantContext = (metadata.currentStep || 1) > 2;
        
        let journalContent = '';
        let learningContent = '';
        let worldContent = '';
        if (!isHeartbeat && !omitRedundantContext) {
            try {
                if (fs.existsSync(this.journalPath)) {
                    const full = fs.readFileSync(this.journalPath, 'utf-8');
                    journalContent = full.length > journalLimit ? full.slice(-journalLimit) : full;
                }
                if (fs.existsSync(this.learningPath)) {
                    const full = fs.readFileSync(this.learningPath, 'utf-8');
                    learningContent = full.length > learningLimit ? full.slice(-learningLimit) : full;
                }
                if (fs.existsSync(this.worldPath)) {
                    const full = fs.readFileSync(this.worldPath, 'utf-8');
                    // Use learningLimit for worldContent as well, or a custom config
                    worldContent = full.length > learningLimit ? full.slice(-learningLimit) : full;
                }
            } catch (e) { }
        }

        // Filter context to only include memories for THIS action (step observations)
        const actionPrefix = `${actionId}-step-`;
        const actionMemories = recentContext.filter(c => c.id && c.id.startsWith(actionPrefix));
        // Include limited other context for background awareness (configurable)
        const otherContextN = Number(this.config?.get('threadContextOtherMemoriesN') ?? 5);
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
            .slice(0, otherContextN);

        // Thread context: last N user/assistant messages from the same source+thread.
        // This is the main mechanism for grounding follow-ups (e.g., pronouns like "he") across actions.
        // Skip for heartbeats — there's no conversation thread to track (source='autonomy').
        const source = (metadata.source || '').toString().toLowerCase();
        const sourceId = metadata.sourceId;
        const telegramChatId = metadata?.chatId ?? (source === 'telegram' ? sourceId : undefined);
        const telegramUserId = metadata?.userId;

        let threadContextString = '';
        let objectiveContextString = '';
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
            const sessionScopeId = metadata?.sessionScopeId;

            const candidates = shortAll
                .filter(m => {
                    const md: any = (m as any)?.metadata || {};
                    if (sessionScopeId) {
                        // Primary: direct sessionScopeId match (inbound messages + recent outbound)
                        if (md.sessionScopeId?.toString() === sessionScopeId.toString()) return true;
                        // Fallback for outbound assistant messages: they are saved without
                        // sessionScopeId (the skill handler doesn't have access to it), but
                        // they DO carry source + chatId.  Include them so the LLM can see its
                        // own prior replies when reconstructing the conversation thread.
                        if (md.role === 'assistant' && (md.source || '').toLowerCase() === source) {
                            if (source === 'telegram') {
                                return telegramChatId != null && md.chatId?.toString() === telegramChatId.toString();
                            }
                            if (source === 'whatsapp') {
                                return sourceId != null && (
                                    md.senderId?.toString() === sourceId.toString() ||
                                    md.sourceId?.toString() === sourceId.toString() ||
                                    md.chatId?.toString()   === sourceId.toString()
                                );
                            }
                            if (source === 'discord') {
                                return sourceId != null && (
                                    md.channelId?.toString() === sourceId.toString() ||
                                    md.sourceId?.toString()  === sourceId.toString()
                                );
                            }
                            if (source === 'gateway-chat') {
                                return sourceId != null && (
                                    md.chatId?.toString()   === sourceId.toString() ||
                                    md.sourceId?.toString() === sourceId.toString()
                                );
                            }
                        }
                        return false;
                    }
                    return md.source && (md.source || '').toString().toLowerCase() === source;
                })
                .filter(m => {
                    if (sessionScopeId) return true;
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

            const RECENT_N = Number(this.config?.get('threadContextRecentN')   ?? 8);
            const RELEVANT_N = Number(this.config?.get('threadContextRelevantN') ?? 8);
            const MAX_LINE_LEN = Number(this.config?.get('threadContextMaxLineLen') ?? 420);

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

            try {
                const objectiveCandidates = candidates
                    .filter(m => {
                        const md: any = (m as any).metadata || {};
                        return md.objectiveStatus === 'active' || md.objectiveStatus === 'completed' || md.objectiveStatus === 'failed';
                    })
                    .sort((a, b) => {
                        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                        return tb - ta;
                    })
                    .slice(0, 8);

                const latestByObjective = new Map<string, any>();
                for (const m of objectiveCandidates) {
                    const md: any = (m as any).metadata || {};
                    const objectiveId = String(md.objectiveId || md.actionId || m.id || '');
                    if (!objectiveId || latestByObjective.has(objectiveId)) continue;
                    latestByObjective.set(objectiveId, m);
                }

                const activeObjectives = Array.from(latestByObjective.values())
                    .filter(m => String(((m as any).metadata || {}).objectiveStatus || '').toLowerCase() === 'active')
                    .slice(0, 3);

                if (activeObjectives.length > 0) {
                    objectiveContextString = activeObjectives
                        .map(m => {
                            const md: any = (m as any).metadata || {};
                            const ts = (m as any).timestamp || '';
                            const text = String((m as any).content || '').slice(0, 260);
                            return `[${ts}] (objective:${md.objectiveId || md.actionId || 'n/a'}) ${text}`;
                        })
                        .join('\n');
                }
            } catch {
                // Non-blocking objective context enrichment
            }
        } catch {
            // Best-effort only
        }
        } // end !isHeartbeat guard for thread context
        
        // Apply PROACTIVE COMPACTION when step history is large to prevent context overflow.
        // All thresholds are config-driven.
        const compactionThreshold = Number(this.config?.get('stepCompactionThreshold')   ?? 10);
        const preserveFirst      = Number(this.config?.get('stepCompactionPreserveFirst') ?? 2);
        const preserveLast       = Number(this.config?.get('stepCompactionPreserveLast')  ?? 5);
        let stepHistoryString: string;
        
        // TOKEN OPTIMIZATION: Aggressive pruning of large tool outputs in history
        const pruneMemoryContent = (content: string): string => {
            if (content.length < 800) return content;
            // If it looks like a large tool result, keep the head and tail
            if (content.includes('Tool') && (content.includes('succeeded') || content.includes('returned') || content.includes('FAILED'))) {
                const total = content.length;
                if (total > 10000) {
                    // Extremely large — take even less
                    return `${content.slice(0, 200)}\n... [CRITICAL: ${total - 400} chars of raw output omitted for token safety] ...\n${content.slice(-200)}`;
                }
                return `${content.slice(0, 400)}\n... [large output truncated, ${total - 800} chars omitted] ...\n${content.slice(-400)}`;
            }
            return content.length > 1200 ? content.slice(0, 1200) + '... [truncated]' : content;
        };

        if (actionMemories.length === 0) {
            stepHistoryString = 'No previous steps taken yet.';
        } else if (actionMemories.length <= compactionThreshold) {
            // Small enough — include everything but prune large individual outputs
            stepHistoryString = actionMemories
                .map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${pruneMemoryContent(c.content)}`)
                .join('\n');
        } else {
            // COMPACTION: preserve first N + last M, summarize middle
            const first = actionMemories.slice(0, preserveFirst);
            const last = actionMemories.slice(-preserveLast);
            const middle = actionMemories.slice(preserveFirst, -preserveLast);
            const expandOnDemand = this.config?.get('stepCompactionExpandOnDemand') !== false;

            // Expand middle context for continuity-heavy prompts ("continue", "where were we", "recap", etc.)
            const normalizedTask = taskDescription.toLowerCase();
            const continuityHintRegex = /(continue|pick up|picked up|resume|where (were|did) (we|i) (left off|leave off)|recap|summary|summarize|context|remember|what have (we|you) done|status|so far|previous|prior|last time|thread|history|refresh)/i;
            const shouldExpandMiddle = expandOnDemand && continuityHintRegex.test(normalizedTask);

            if (shouldExpandMiddle && middle.length > 0) {
                const maxMiddleSteps = Math.max(1, Number(this.config?.get('stepCompactionExpansionMaxMiddleSteps') ?? 12));
                const maxChars = Math.max(400, Number(this.config?.get('stepCompactionExpansionMaxChars') ?? 2400));
                const expandedMiddle = middle.slice(-maxMiddleSteps);
                const expandedLines: string[] = [];
                let usedChars = 0;

                for (const entry of expandedMiddle) {
                    const stepId = entry.id?.replace(actionPrefix, '').split('-')[0] || '?';
                    const content = pruneMemoryContent((entry.content || '').toString());
                    const remaining = maxChars - usedChars;
                    if (remaining <= 0) break;

                    const clipped = content.length > remaining ? `${content.slice(0, Math.max(0, remaining - 1))}…` : content;
                    const line = `[Step ${stepId}] ${clipped}`;
                    expandedLines.push(line);
                    usedChars += line.length + 1;
                }

                const firstStr = first.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${pruneMemoryContent(c.content)}`).join('\n');
                const lastStr = last.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${pruneMemoryContent(c.content)}`).join('\n');
                const omittedCount = Math.max(0, middle.length - expandedLines.length);

                stepHistoryString = `${firstStr}\n  --- [expanded continuity context: ${expandedLines.length}/${middle.length} middle steps shown] ---\n${expandedLines.join('\n')}${omittedCount > 0 ? `\n  ... [${omittedCount} older middle steps omitted to stay within context budget]` : ''}\n  --- [recent steps below] ---\n${lastStr}`;
            } else {
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

                const firstStr = first.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${pruneMemoryContent(c.content)}`).join('\n');
                const lastStr = last.map(c => `[Step ${c.id?.replace(actionPrefix, '').split('-')[0] || '?'}] ${pruneMemoryContent(c.content)}`).join('\n');
                stepHistoryString = `${firstStr}\n  --- [${middle.length} middle steps compacted] ---\n${middleSummary.join('\n')}\n  --- [recent steps below] ---\n${lastStr}`;
            }
        }
        
        // Include limited other context for background awareness
        const otherContextString = otherMemories.length > 0
            ? otherMemories.map(c => `[${c.type}] ${c.content}`).join('\n')
            : '';

        // ── PARALLEL ASYNC RETRIEVAL ──
        // Semantic recall, episodic retrieval, and RAG are independent async operations.
        // Running them in parallel instead of sequentially saves 200-1000ms per step.
        let semanticRecallString = '';
        let semanticEpisodicString = '';
        let ragContext = '';

        if (!isHeartbeat) {
            // Collect shown IDs for dedup (used by semantic recall)
            const shownIds = new Set<string>();
            for (const m of [...actionMemories, ...otherMemories]) {
                if (m.id) shownIds.add(m.id);
            }

            const [recallResult, episodicResult, ragResult] = await Promise.allSettled([
                // 1. Semantic long-term recall
                (async () => {
                    if (!this.memory.vectorMemory?.isEnabled()) return '';
                    const recalled = await this.memory.semanticRecall(taskDescription, 6, shownIds);
                    if (recalled.length === 0) return '';
                    return recalled
                        .map(r => {
                            const ts = r.timestamp || '';
                            const src = r.metadata?.source || 'history';
                            // Normalize source names for better agent citation
                            let citationLabel = src;
                            if (src === 'memory_write_skill' && r.metadata?.category) citationLabel = r.metadata.category;
                            if (src === 'memory_write_skill' && !r.metadata?.category) citationLabel = r.type === 'long' ? 'MEMORY.md' : 'daily log';
                            
                            const content = r.content.length > 400 ? r.content.slice(0, 400) + '…' : r.content;
                            return `[${ts}] [Source: ${citationLabel}] (relevance: ${(r.score * 100).toFixed(0)}%) ${content}`;
                        })
                        .join('\n');
                })(),
                // 2. Semantic episodic retrieval
                (async () => {
                    const relevantEpisodic = await this.memory.getRelevantEpisodicMemories(taskDescription, 5);
                    if (relevantEpisodic.length === 0) return '';
                    return relevantEpisodic
                        .map(m => {
                            const ts = m.timestamp || '';
                            const date = ts.split('T')[0];
                            const content = (m.content || '').length > 500 ? m.content.slice(0, 500) + '…' : m.content;
                            return `[${ts}] [Source: Episodic Summary ${date}] ${content}`;
                        })
                        .join('\n');
                })(),
                // 3. RAG knowledge store retrieval
                (async () => {
                    if (!this.knowledgeStore) return '';
                    const result = await this.knowledgeStore.retrieveForTask(taskDescription, 5);
                    if (result) {
                        logger.info(`DecisionEngine: RAG retrieved ${result.split('\n---').length} knowledge chunks for task`);
                    }
                    return result || '';
                })()
            ]);

            semanticRecallString = recallResult.status === 'fulfilled' ? recallResult.value : '';
            semanticEpisodicString = episodicResult.status === 'fulfilled' ? episodicResult.value : '';
            ragContext = ragResult.status === 'fulfilled' ? ragResult.value : '';
        }

        // Channel instructions and contact profiles — irrelevant for heartbeats (source='autonomy')
        let channelInstructions = '';
        let contactProfile: string | undefined;
        let profilingEnabled = false;
        let platformContextString = '';
        let userExchangeString = '';
        let unresolvedThreadString = '';
        let warmMemoryString = '';
        const activePlatform = (metadata.source || '').toString().toLowerCase();
        const activeContact = (metadata.sourceId || metadata.senderId || metadata.userId || '').toString();
        const conversationContext = {
            platform: activePlatform,
            contactId: activeContact,
            username: metadata.senderName,
            sessionScopeId: metadata.sessionScopeId,
            messageType: metadata.messageType,
            statusContext: metadata.statusContext || metadata.replyContext,
            threadId: metadata.chatId || metadata.channelId
        };

        if (!isHeartbeat) {
        try {
            const recentExchanges = this.memory.getUserRecentExchanges(conversationContext as any, 10);
            if (recentExchanges.length > 0) {
                userExchangeString = recentExchanges.map((m) => {
                    const md = m.metadata || {};
                    const role = (md.role || 'event').toString();
                    const mt = (md.messageType || md.type || 'text').toString();
                    return `[${m.timestamp || ''}] (${role}/${mt}) ${(m.content || '').toString().slice(0, 260)}`;
                }).join('\n');
            }

            const unresolvedThreads = this.memory.getUnresolvedThreads(conversationContext as any, 6);
            if (unresolvedThreads.length > 0) {
                unresolvedThreadString = unresolvedThreads
                    .map((m) => `- ${m.timestamp || ''}: ${(m.content || '').toString().slice(0, 220)}`)
                    .join('\n');
            }

            const warmMemories = await this.memory.warmConversationCache(conversationContext as any, taskDescription, 6);
            if (warmMemories.length > 0) {
                warmMemoryString = warmMemories
                    .map(m => `[${m.timestamp || ''}] ${(m.metadata?.source || 'memory')} ${(m.score * 100).toFixed(0)}% ${(m.content || '').toString().slice(0, 220)}`)
                    .join('\n');
            }
        } catch (e) {
            logger.debug(`DecisionEngine: scoped memory enrichment failed: ${e}`);
        }

        if (metadata.source === 'telegram') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Telegram
- Chat ID: "${metadata.sourceId}" (Sender: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_telegram" skill.
`;
        } else if (metadata.source === 'whatsapp') {
            profilingEnabled = !!this.memory.getUserContext().raw?.includes('whatsappContextProfilingEnabled: true');
            contactProfile = this.memory.getContactProfile(`whatsapp:${metadata.sourceId}`)
                || this.memory.getContactProfile(metadata.sourceId)
                || undefined;

            platformContextString = `
WHATSAPP TRIGGER METADATA:
- Trigger type: ${(metadata.messageType || metadata.type || 'message').toString()}
- Is status interaction: ${Boolean(metadata.type === 'status' || metadata.statusReplyTo || metadata.statusContext)}
- Quoted/status context: ${(metadata.statusContext || metadata.replyContext || metadata.statusReplyTo || 'none').toString().slice(0, 240)}
- Message ID: ${(metadata.messageId || 'n/a').toString()}`;

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
        } else if (metadata.source === 'slack') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Slack
- Channel ID: "${metadata.sourceId}" (User: ${metadata.senderName})
- Rule: To message this user, you MUST use the "send_slack" skill with channel_id="${metadata.sourceId}".
`;
        } else if (metadata.source === 'gateway-chat') {
            channelInstructions = `
ACTIVE CHANNEL CONTEXT:
- Channel: Gateway Chat (Web Interface)
- Rule: To respond with text, use the "send_gateway_chat" skill.
- Rule: To send an image or file, use send_image("gateway-web", prompt, "gateway-chat") or send_file("gateway-web", filePath, caption, "gateway-chat"). The dashboard will render images inline.
`;
        }
        } // end !isHeartbeat guard for channel instructions

        // Permission notice for non-admin users — tells the LLM what's off-limits
        if (!isAdmin && channelInstructions) {
            channelInstructions += `
PERMISSION NOTICE: This user is NOT an admin. You can ONLY use messaging, search, and basic interaction skills.
System-level tools (run_command, file operations, browser automation, scheduling, image generation, etc.) are RESTRICTED and will be blocked.
Respond conversationally. If the user asks you to do something that requires elevated permissions, politely inform them they don't have access.
`;
        }


        // Build task-optimized prompt using the modular PromptHelper system.
        // The router analyzes the task and selects only the relevant helpers.
        // Extract skills used in this action from step memory IDs (e.g. "abc-step-3-browser_click")
        // so the PromptRouter can activate relevant helpers even when the task description
        // doesn't mention browsing (e.g. "lets try again" after a browsing conversation).
        const skillsUsedInAction = [...new Set(
            actionMemories
                .map(m => {
                    const match = (m.id || '').match(/-step-\\d+-(.+?)(?:-error)?(?:-feedback)?$/);
                    return match?.[1] || '';
                })
                .filter(Boolean)
        )];

        // For non-admin users, suppress private context sections entirely.
        // The PrivacyHelper (injected via PromptRouter) instructs the LLM to enforce
        // information boundaries, but defense-in-depth means we also avoid sending
        // the sensitive data at all.
        const safeJournal = isAdmin ? journalContent : '';
        const safeLearning = isAdmin ? learningContent : '';
        const safeWorld = isAdmin ? worldContent : '';
        const safeSemanticRecall = isAdmin ? semanticRecallString : '';
        const safeEpisodic = isAdmin ? semanticEpisodicString : '';
        const safeOtherContext = isAdmin ? otherContextString : '';
        const safeContactProfile = isAdmin ? contactProfile : undefined;

        // ── Per-action prompt cache ──
        // The core instructions (bootstrap + identity + skills + prompt helpers) change
        // rarely within an action — typically only on step 1 when skills are auto-activated.
        // Reuse the cached version for subsequent steps to skip the expensive
        // PromptRouter + helper assembly + bootstrap loading.
        let coreInstructions: string;
        if (this._cachedCoreActionId === actionId && !isFirstStep && this._cachedCoreInstructions) {
            coreInstructions = this._cachedCoreInstructions;
        } else {
            coreInstructions = await this.buildHelperPrompt(
                availableSkills,
                this.agentIdentity,
                taskDescription,
                metadata,
                isFirstStep,
                safeContactProfile,
                isAdmin ? profilingEnabled : false,
                isHeartbeat,
                skillsUsedInAction
            );
            this._cachedCoreInstructions = coreInstructions;
            this._cachedCoreActionId = actionId;
        }

        // User context - skip for heartbeats (already in heartbeat prompt)
        // Strip sensitive owner context for non-admin users — they should not see
        // the owner's profile, journal, learning notes, or cross-channel memories.
        const userContextStr = userContext.raw || '';
        const userContextLimit = Number(this.config?.get('userContextLimit') ?? 2000);
        const trimmedUserContext = isHeartbeat ? '' : (!isAdmin ? '' : (userContextStr.length > userContextLimit
            ? userContextStr.slice(0, userContextLimit) + '...[truncated]'
            : userContextStr));

        // Compact one-line runtime orientation — gives the LLM immediate context without burying it
        const runtimeLine = `RUNTIME: channel=${source || 'internal'} | step=${metadata.currentStep || 1}/${this.config?.get('maxSteps') || 30} | mem=${recentContext.length} | model=${this.config?.get('modelName') || 'auto'} | isGroup=${!!(metadata as any).isGroupChat}`;

        // Quick user profile — first 4 significant lines of USER.md as a single-line orientator
        const quickUserProfile = (isAdmin && !isHeartbeat && trimmedUserContext)
            ? trimmedUserContext.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 4).join(' | ').slice(0, 200)
            : '';

        // Full prompt for all steps - don't risk losing context
        const systemPrompt = `
${runtimeLine}
${quickUserProfile ? `USER: ${quickUserProfile}` : ''}

${coreInstructions}

EXECUTION STATE:
- Action ID: ${actionId}
- messagesSent: ${metadata.messagesSent || 0}
- Sequence Step: ${metadata.currentStep || '1'}
- Steps Since Last Message: ${metadata.stepsSinceLastMessage ?? 0}
- Task Type: ${metadata.isResearchTask ? 'Research/Deep Work' : 'Standard'}

${this.buildTimeSignalsNudge(metadata)}

EXECUTION PLAN:
${metadata.executionPlan || 'Proceed with standard reasoning.'}

${metadata.sessionContinuityHint ? `SESSION CONTINUITY (carry this forward):
${metadata.sessionContinuityHint}` : ''}

${metadata.robustReasoningMode ? `ROBUST REASONING MODE (ENABLED):
- Treat the execution plan as a checklist: complete it step-by-step and track what remains.
- Do NOT set goals_met=true unless user-visible outcomes are delivered (message/file/result).
- If any unresolved errors, missing results, or pending checklist items remain, keep goals_met=false and continue with tools.` : ''}

${channelInstructions}

${this.buildTransparencyNudge(metadata)}

User Context (Long-term profile):
${trimmedUserContext || 'No user information available.'}

${safeJournal ? `Agent Journal (Recent Reflections):\n${safeJournal}` : ''}

${safeLearning ? `Agent Learning Base (Knowledge):\n${safeLearning}` : ''}

${safeWorld ? `Agent World (Internal Governance/Environment):\n${safeWorld}` : ''}

${threadContextString ? `THREAD CONTEXT (Same Chat):\n${threadContextString}` : ''}

${userExchangeString ? `LAST USER EXCHANGES (scoped to active contact):\n${userExchangeString}` : ''}

${unresolvedThreadString ? `UNRESOLVED THREADS (carry-over items):\n${unresolvedThreadString}` : ''}

${warmMemoryString ? `PREFETCHED MEMORY CANDIDATES (hybrid semantic+recency):\n${warmMemoryString}` : ''}

${platformContextString ? `${platformContextString}` : ''}

${objectiveContextString ? `ACTIVE OBJECTIVES (Same Session):\n${objectiveContextString}` : ''}

${safeEpisodic ? `EPISODIC MEMORY (Task-Relevant Summaries — past actions, outcomes, and learnings):\n${safeEpisodic}` : ''}

${safeSemanticRecall ? `LONG-TERM RECALL (Semantically relevant memories from all channels and time periods — your deep memory):\n${safeSemanticRecall}` : ''}

${ragContext ? `RETRIEVED KNOWLEDGE (RAG — ingested documents, datasets, and external sources relevant to this task):\n${ragContext}` : ''}

⚠️ STEP HISTORY FOR THIS ACTION (Action ${actionId}) — THIS IS YOUR GROUND TRUTH:
(If a tool SUCCEEDED here, that result is REAL and CONFIRMED. If a tool FAILED, DO NOT repeat the same call.)
(STEP HISTORY always takes priority over background context below.)
${stepHistoryString}

${safeOtherContext ? `RECENT BACKGROUND CONTEXT (reference only — may describe older/different actions):\n${safeOtherContext}` : ''}
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

            try {
                const rawParsed = await this.callLLMWithToolsAndRetry(taskDescription, nativeSystemPrompt || systemPrompt, actionId, 1, excludeSkills);
                parsed = this.applyChannelDefaultsToTools(rawParsed, metadata);
                logger.info(`DecisionEngine: Used native tool calling — ${parsed.tools?.length || 0} tool(s)`);
            } catch (e: any) {
                // If the model explicitly doesn't support tools, fallback to text-based parsing
                if (e?.message?.includes('MODEL_DOES_NOT_SUPPORT_TOOLS')) {
                    logger.warn(`DecisionEngine: Native tool calling not supported by model, falling back to text-based parsing.`);
                    const rawResponse = await this.callLLMWithRetry(taskDescription, systemPrompt, actionId);
                    parsed = this.applyChannelDefaultsToTools(ParserLayer.normalize(rawResponse), metadata);
                } else {
                    // Rethrow other errors (e.g. connection errors) so they can be handled by the retry logic
                    throw e;
                }
            }
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

        const pipelineActionId = metadata.id || metadata.actionId || 'unknown';
        const parsedHasSendFile = (parsed.tools || []).some(t => (t.name || '').toLowerCase().trim() === 'send_file');
        const inferredFileIntent = parsedHasSendFile
            ? await this.inferFileIntentForAction(pipelineActionId, taskDescription, recentContext)
            : 'unknown';

        // Run parsed response through structured pipeline guardrails
        let piped = this.pipeline.evaluate(parsed, {
            actionId: pipelineActionId,
            source: metadata.source,
            sourceId: metadata.sourceId,
            messagesSent: metadata.messagesSent || 0,
            currentStep: metadata.currentStep || 1,
            executionPlan: metadata.executionPlan,
            lane: metadata.lane,
            recentMemories: recentContext,
            allowedTools: allowedToolNames,
            taskDescription,
            fileIntent: inferredFileIntent
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
- CRITICAL: If this task came from a messaging channel (Telegram/WhatsApp/Discord/Slack/Gateway) and messagesSent is 0, the user has received NOTHING. The agent's text reasoning is invisible to the user. You MUST return goals_met=false and include the appropriate send skill (send_telegram, send_whatsapp, send_discord, send_slack, send_gateway_chat) with the response message.
- Do NOT default to asking questions. Only use request_supporting_data if genuinely missing critical info that cannot be inferred.
- Prefer ACTION over CLARIFICATION. If the agent can make progress with available context, it should.
${metadata.robustReasoningMode ? `- ROBUST MODE: if checklist items remain unresolved, if outputs were not delivered to the user, or if the response is only a status update, you MUST return goals_met=false and continue with concrete tools.` : ''}

TASK:
${taskDescription}

EXECUTION PLAN:
${metadata.executionPlan || 'No plan provided.'}

${metadata.sessionContinuityHint ? `SESSION CONTINUITY:
${metadata.sessionContinuityHint}` : ''}

⚠️ STEP HISTORY FOR THIS ACTION (Action ${actionId}) — READ BEFORE ACTING:
${stepHistoryString}

PROPOSED RESPONSE (agent wanted to terminate with this):
${JSON.stringify(piped, null, 2)}

QUESTION: Was the original task completed? If not, what tools should be called next to make progress?
`;

            const reviewRaw = await this.callLLMWithRetry(taskDescription, reviewPrompt, actionId);
            const reviewParsed = ParserLayer.normalize(reviewRaw);
            const reviewHasSendFile = (reviewParsed.tools || []).some(t => (t.name || '').toLowerCase().trim() === 'send_file');
            const reviewFileIntent = reviewHasSendFile
                ? await this.inferFileIntentForAction(pipelineActionId, taskDescription, recentContext)
                : 'unknown';

            const reviewed = this.pipeline.evaluate(reviewParsed, {
                actionId: pipelineActionId,
                source: metadata.source,
                sourceId: metadata.sourceId,
                messagesSent: metadata.messagesSent || 0,
                currentStep: metadata.currentStep || 1,
                executionPlan: metadata.executionPlan,
                lane: metadata.lane,
                recentMemories: recentContext,
                allowedTools: allowedToolNames,
                taskDescription,
                fileIntent: reviewFileIntent
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
