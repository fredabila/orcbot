/**
 * AgenticUser — Autonomous HITL (Human-in-the-Loop) Proxy
 * 
 * Acts as a virtual user when the real human is unavailable.
 * Uses learned knowledge (USER.md, profiles, memory, journal, learning)
 * to answer agent questions, provide direction, and unblock stuck tasks.
 * 
 * Two modes:
 * 1. **Reactive**: When an action enters 'waiting' state (agent asked a question),
 *    the AgenticUser evaluates whether it can confidently answer and intervenes.
 * 2. **Proactive**: Monitors in-progress actions for signs of confusion or drift,
 *    and injects directional guidance when the agent is going off-track.
 */

import { MemoryManager, MemoryEntry } from '../memory/MemoryManager';
import { ActionQueue, Action } from '../memory/ActionQueue';
import { MultiLLM } from './MultiLLM';
import { ConfigManager } from '../config/ConfigManager';
import { eventBus } from './EventBus';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export interface AgenticUserIntervention {
    id: string;
    actionId: string;
    type: 'question-answer' | 'direction-guidance' | 'stuck-recovery';
    /** The original question or detected issue */
    trigger: string;
    /** The AgenticUser's generated response */
    response: string;
    /** Confidence score 0-100 */
    confidence: number;
    /** Whether the intervention was actually applied (above threshold) */
    applied: boolean;
    timestamp: string;
    /** Context snapshot used for the decision */
    contextSummary?: string;
}

export interface AgenticUserConfig {
    /** Master toggle for the AgenticUser feature */
    enabled: boolean;
    /** Seconds to wait after action enters 'waiting' before intervening (give real user a chance) */
    responseDelay: number;
    /** Minimum confidence (0-100) required to auto-intervene */
    confidenceThreshold: number;
    /** Enable proactive guidance for in-progress actions */
    proactiveGuidance: boolean;
    /** Minimum steps in-progress before proactive guidance kicks in */
    proactiveStepThreshold: number;
    /** How often (seconds) to check for waiting/stuck actions */
    checkIntervalSeconds: number;
    /** Maximum interventions per action (prevent infinite loops) */
    maxInterventionsPerAction: number;
    /** Categories of decisions the AgenticUser should NEVER make */
    restrictedCategories: string[];
}

const DEFAULT_CONFIG: AgenticUserConfig = {
    enabled: false,
    responseDelay: 120,               // 2 minutes — gives the user a chance
    confidenceThreshold: 70,           // Only intervene when fairly sure
    proactiveGuidance: true,
    proactiveStepThreshold: 8,         // After 8 steps without progress
    checkIntervalSeconds: 30,          // Check every 30 seconds
    maxInterventionsPerAction: 3,      // Don't over-intervene
    restrictedCategories: [
        'financial',                   // Money transfers, purchases
        'destructive',                 // File deletion, account changes
        'private',                     // Sharing personal information
        'irreversible',                // Actions that can't be undone
    ]
};

// ─── AgenticUser Class ───────────────────────────────────────────────

export class AgenticUser {
    private memory: MemoryManager;
    private actionQueue: ActionQueue;
    private llm: MultiLLM;
    private config: ConfigManager;
    private settings: AgenticUserConfig;
    
    private checkTimer: ReturnType<typeof setInterval> | null = null;
    private pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private interventionCounts: Map<string, number> = new Map();
    private interventionLog: AgenticUserIntervention[] = [];
    private interventionLogPath: string;
    private active: boolean = false;

    // ─── Race-condition & Token-optimization State ────────────────────
    /** Track last real user activity per channel key (source:sourceId) */
    private lastUserActivity: Map<string, number> = new Map();
    /** Track per-action evaluation state for backoff */
    private evaluationTracker: Map<string, { lastEvalTime: number; attempts: number; lastConfidence: number }> = new Map();
    /** Cached context per action to avoid repeated heavy I/O */
    private contextCache: Map<string, { context: any; timestamp: number }> = new Map();
    /** Cooldown after intervention — don't re-check this action for a while */
    private postInterventionCooldown: Map<string, number> = new Map();
    /** User activity cooldown in seconds (default 5 min) */
    private static readonly USER_ACTIVITY_COOLDOWN = 300;
    /** Context cache TTL in ms (5 minutes) */
    private static readonly CONTEXT_CACHE_TTL = 5 * 60 * 1000;
    /** Post-intervention cooldown in seconds (10 minutes) */
    private static readonly POST_INTERVENTION_COOLDOWN = 600;
    /** Base backoff multiplier for re-evaluations (seconds) */
    private static readonly EVAL_BACKOFF_BASE = 60;

    constructor(
        memory: MemoryManager,
        actionQueue: ActionQueue,
        llm: MultiLLM,
        config: ConfigManager
    ) {
        this.memory = memory;
        this.actionQueue = actionQueue;
        this.llm = llm;
        this.config = config;

        // Load settings from config, falling back to defaults
        this.settings = this.loadSettings();

        // Intervention log lives alongside other data files
        this.interventionLogPath = path.join(
            config.getDataHome(),
            'agentic_user_log.json'
        );
        this.loadInterventionLog();
    }

    // ─── Lifecycle ───────────────────────────────────────────────────

    public start(): void {
        if (!this.settings.enabled) {
            logger.info('AgenticUser: Disabled by config. Skipping start.');
            return;
        }

        if (this.active) return;
        this.active = true;

        // Listen for real user activity to suppress interventions while user is present
        eventBus.on('user:activity', this.onUserActivity);

        // Periodic check for waiting/stuck actions
        this.checkTimer = setInterval(
            () => this.checkActions(),
            this.settings.checkIntervalSeconds * 1000
        );

        logger.info(`AgenticUser: Started. Response delay: ${this.settings.responseDelay}s, confidence threshold: ${this.settings.confidenceThreshold}%, proactive: ${this.settings.proactiveGuidance}`);
    }

    public stop(): void {
        this.active = false;

        // Remove event listener
        eventBus.removeListener('user:activity', this.onUserActivity);

        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }

        // Cancel all pending response timers
        for (const [id, timer] of this.pendingTimers) {
            clearTimeout(timer);
        }
        this.pendingTimers.clear();

        // Clear caches
        this.contextCache.clear();
        this.evaluationTracker.clear();

        // Persist intervention log
        this.saveInterventionLog();

        logger.info('AgenticUser: Stopped.');
    }

    /** Handle real user activity — record timestamp per channel to suppress interventions */
    private onUserActivity = (data: { source?: string; sourceId?: string }) => {
        if (!data.source || !data.sourceId) return;
        const channelKey = `${data.source}:${data.sourceId}`;
        this.lastUserActivity.set(channelKey, Date.now());

        // Cancel any pending evaluations for actions on this channel
        // (the real user is responding, so we should back off)
        for (const [actionId, timer] of this.pendingTimers) {
            clearTimeout(timer);
            this.pendingTimers.delete(actionId);
        }

        // Invalidate context caches (user message changes context)
        this.contextCache.clear();

        logger.debug(`AgenticUser: User activity detected on ${channelKey}. Suppressing interventions.`);
    };

    /** Reload settings from config (supports hot-reload) */
    public reloadSettings(): void {
        const wasEnabled = this.settings.enabled;
        this.settings = this.loadSettings();

        if (wasEnabled && !this.settings.enabled) {
            this.stop();
        } else if (!wasEnabled && this.settings.enabled) {
            this.start();
        }

        logger.info('AgenticUser: Settings reloaded.');
    }

    // ─── Core Logic ──────────────────────────────────────────────────

    /**
     * Periodic check: find waiting actions past the response delay,
     * and optionally detect in-progress actions that need guidance.
     * 
     * Guards:
     * 1. Skips if user is recently active on the action's channel
     * 2. Applies exponential backoff for re-evaluations of the same action
     * 3. Respects post-intervention cooldowns
     * 4. Uses cached context to avoid redundant I/O
     */
    private async checkActions(): Promise<void> {
        if (!this.active) return;

        try {
            const queue = this.actionQueue.getQueue();
            const now = Date.now();

            // 1. Handle WAITING actions (agent asked a question, user hasn't replied)
            const waitingActions = queue.filter(a => a.status === 'waiting');
            for (const action of waitingActions) {
                const waitingSince = Date.parse(action.updatedAt || action.timestamp) || 0;
                const waitingFor = (now - waitingSince) / 1000;

                // Only intervene after the delay (give real user a chance)
                if (waitingFor < this.settings.responseDelay) continue;

                // Don't re-trigger if we already have a pending timer
                if (this.pendingTimers.has(action.id)) continue;

                // GUARD: Skip if real user was recently active on this channel
                const channelKey = this.getChannelKey(action);
                if (channelKey && this.isUserRecentlyActive(channelKey)) {
                    logger.debug(`AgenticUser: User recently active on ${channelKey}. Skipping action ${action.id}.`);
                    continue;
                }

                // GUARD: Post-intervention cooldown
                const lastIntervention = this.postInterventionCooldown.get(action.id);
                if (lastIntervention && (now - lastIntervention) / 1000 < AgenticUser.POST_INTERVENTION_COOLDOWN) {
                    logger.debug(`AgenticUser: Post-intervention cooldown active for action ${action.id}. Skipping.`);
                    continue;
                }

                // GUARD: Exponential backoff for re-evaluations
                const evalState = this.evaluationTracker.get(action.id);
                if (evalState) {
                    const backoffSeconds = AgenticUser.EVAL_BACKOFF_BASE * Math.pow(2, Math.min(evalState.attempts - 1, 5));
                    const timeSinceLastEval = (now - evalState.lastEvalTime) / 1000;
                    if (timeSinceLastEval < backoffSeconds) {
                        logger.debug(`AgenticUser: Backoff active for action ${action.id} (${Math.round(timeSinceLastEval)}s / ${Math.round(backoffSeconds)}s). Skipping.`);
                        continue;
                    }
                }

                await this.handleWaitingAction(action);
            }

            // 2. Handle IN-PROGRESS actions that seem stuck (proactive guidance)
            if (this.settings.proactiveGuidance) {
                const inProgressActions = queue.filter(a => a.status === 'in-progress');
                for (const action of inProgressActions) {
                    // Same user-activity guard for proactive guidance
                    const channelKey = this.getChannelKey(action);
                    if (channelKey && this.isUserRecentlyActive(channelKey)) continue;

                    // Same post-intervention cooldown
                    const lastIntervention = this.postInterventionCooldown.get(action.id);
                    if (lastIntervention && (now - lastIntervention) / 1000 < AgenticUser.POST_INTERVENTION_COOLDOWN) continue;

                    await this.handleStuckAction(action);
                }
            }

            // Periodic cleanup of stale tracker entries (actions no longer in queue)
            this.cleanupTrackers(queue);
        } catch (e) {
            logger.error(`AgenticUser: Error in checkActions: ${e}`);
        }
    }

    /** Get channel key for user-activity tracking from an action's metadata */
    private getChannelKey(action: Action): string | null {
        const source = action.payload?.source;
        const sourceId = action.payload?.sourceId || action.payload?.chatId;
        if (source && sourceId) return `${source}:${sourceId}`;
        return null;
    }

    /** Check if the real user was active on a channel within the cooldown window */
    private isUserRecentlyActive(channelKey: string): boolean {
        const lastActivity = this.lastUserActivity.get(channelKey);
        if (!lastActivity) return false;
        return (Date.now() - lastActivity) / 1000 < AgenticUser.USER_ACTIVITY_COOLDOWN;
    }

    /** Clean up stale entries from trackers (for actions that have been completed/removed) */
    private cleanupTrackers(currentQueue: Action[]): void {
        const activeIds = new Set(currentQueue.map(a => a.id));
        for (const id of this.evaluationTracker.keys()) {
            if (!activeIds.has(id)) this.evaluationTracker.delete(id);
        }
        for (const id of this.contextCache.keys()) {
            if (!activeIds.has(id)) this.contextCache.delete(id);
        }
        for (const id of this.postInterventionCooldown.keys()) {
            if (!activeIds.has(id)) this.postInterventionCooldown.delete(id);
        }
        for (const id of this.interventionCounts.keys()) {
            if (!activeIds.has(id)) this.interventionCounts.delete(id);
        }
    }

    /**
     * Reactive mode: The agent asked a question and the user hasn't responded.
     * Build context, evaluate confidence, and potentially answer on the user's behalf.
     * 
     * Optimizations:
     * - Uses cached context if still fresh (avoids repeated file I/O)
     * - Tracks evaluation attempts with exponential backoff
     * - Re-verifies action status before applying (race-condition guard)
     */
    private async handleWaitingAction(action: Action): Promise<void> {
        const interventionCount = this.interventionCounts.get(action.id) || 0;
        if (interventionCount >= this.settings.maxInterventionsPerAction) {
            logger.info(`AgenticUser: Max interventions (${this.settings.maxInterventionsPerAction}) reached for action ${action.id}. Skipping.`);
            return;
        }

        // Extract the question from the action's metadata or step memories
        const question = this.extractQuestion(action);
        if (!question) {
            logger.debug(`AgenticUser: Could not extract question from waiting action ${action.id}`);
            return;
        }

        logger.info(`AgenticUser: Evaluating waiting action ${action.id}. Question: "${question.slice(0, 100)}..."`);

        // Build rich context from all knowledge sources (with caching)
        const context = await this.buildContextCached(action);

        // RACE CHECK: Re-verify the action is still waiting before making the LLM call
        const freshAction = this.actionQueue.getAction(action.id);
        if (!freshAction || freshAction.status !== 'waiting') {
            logger.info(`AgenticUser: Action ${action.id} is no longer waiting (status: ${freshAction?.status || 'removed'}). User likely responded. Skipping.`);
            this.evaluationTracker.delete(action.id);
            return;
        }

        // Make the LLM call to evaluate and potentially answer
        const evaluation = await this.evaluate(action, question, context);

        // Track this evaluation for backoff purposes
        const prevEval = this.evaluationTracker.get(action.id);
        this.evaluationTracker.set(action.id, {
            lastEvalTime: Date.now(),
            attempts: (prevEval?.attempts || 0) + 1,
            lastConfidence: evaluation.confidence
        });

        // Record the intervention attempt
        const intervention: AgenticUserIntervention = {
            id: `au-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            actionId: action.id,
            type: 'question-answer',
            trigger: question,
            response: evaluation.response,
            confidence: evaluation.confidence,
            applied: false,
            timestamp: new Date().toISOString(),
            contextSummary: context.summary
        };

        if (evaluation.confidence >= this.settings.confidenceThreshold && !evaluation.restricted) {
            // RACE CHECK: One more verification right before applying
            const stillWaiting = this.actionQueue.getAction(action.id);
            if (!stillWaiting || stillWaiting.status !== 'waiting') {
                logger.info(`AgenticUser: Action ${action.id} was resolved while evaluating. User responded during LLM call. Discarding intervention.`);
                intervention.applied = false;
                this.interventionLog.push(intervention);
                this.saveInterventionLog();
                return;
            }

            // Apply the intervention — resume the action with the synthetic response
            await this.applyIntervention(action, evaluation.response, intervention);
            intervention.applied = true;
            this.interventionCounts.set(action.id, interventionCount + 1);
            this.postInterventionCooldown.set(action.id, Date.now());
            logger.info(`AgenticUser: Intervention applied for action ${action.id} (confidence: ${evaluation.confidence}%). Response: "${evaluation.response.slice(0, 100)}..."`);
        } else {
            // Below threshold or restricted — log but don't intervene
            const reason = evaluation.restricted
                ? `restricted category (${evaluation.restrictedReason})`
                : `low confidence (${evaluation.confidence}%)`;
            logger.info(`AgenticUser: Skipped intervention for action ${action.id}: ${reason}`);
            
            // If significantly below threshold, provide a safe default instead
            if (evaluation.confidence < this.settings.confidenceThreshold && evaluation.safeDefault) {
                // Re-verify status before applying safe default too
                const stillWaiting = this.actionQueue.getAction(action.id);
                if (!stillWaiting || stillWaiting.status !== 'waiting') {
                    logger.info(`AgenticUser: Action ${action.id} resolved before safe-default could apply. Discarding.`);
                    this.interventionLog.push(intervention);
                    this.saveInterventionLog();
                    return;
                }

                const defaultIntervention: AgenticUserIntervention = {
                    ...intervention,
                    type: 'direction-guidance',
                    response: evaluation.safeDefault,
                    confidence: evaluation.confidence,
                };
                await this.applyIntervention(action, evaluation.safeDefault, defaultIntervention);
                defaultIntervention.applied = true;
                this.interventionCounts.set(action.id, interventionCount + 1);
                this.postInterventionCooldown.set(action.id, Date.now());
                logger.info(`AgenticUser: Applied safe-default guidance for action ${action.id}: "${evaluation.safeDefault.slice(0, 100)}..."`);
                this.interventionLog.push(defaultIntervention);
                this.saveInterventionLog();
                return;
            }
        }

        this.interventionLog.push(intervention);
        this.saveInterventionLog();
    }

    /**
     * Proactive mode: Detect in-progress actions that appear stuck —
     * the agent is going in circles, repeating failures, or drifting from the goal.
     */
    private async handleStuckAction(action: Action): Promise<void> {
        const interventionCount = this.interventionCounts.get(action.id) || 0;
        if (interventionCount >= this.settings.maxInterventionsPerAction) return;

        // Check step count from memory
        const stepCount = this.memory.getActionStepCount(action.id);
        if (stepCount < this.settings.proactiveStepThreshold) return;

        // Only proactively guide once every N steps (don't spam)
        const lastGuidanceStep = action.payload?._lastAgenticUserGuidanceStep || 0;
        if (stepCount - lastGuidanceStep < this.settings.proactiveStepThreshold) return;

        // Backoff: don't re-check proactive guidance too frequently
        const evalState = this.evaluationTracker.get(`stuck-${action.id}`);
        if (evalState) {
            const backoffSeconds = AgenticUser.EVAL_BACKOFF_BASE * Math.pow(2, Math.min(evalState.attempts - 1, 4));
            const timeSinceLastEval = (Date.now() - evalState.lastEvalTime) / 1000;
            if (timeSinceLastEval < backoffSeconds) return;
        }

        logger.info(`AgenticUser: Proactive guidance check for action ${action.id} at step ${stepCount}`);

        // Get step history for this action
        const actionMemories = this.memory.getActionMemories(action.id);
        if (actionMemories.length === 0) return;

        // Detect stuck signals
        const stuckSignals = this.detectStuckSignals(actionMemories);
        if (stuckSignals.length === 0) return;

        logger.info(`AgenticUser: Stuck signals detected for action ${action.id}: ${stuckSignals.join(', ')}`);

        const context = await this.buildContextCached(action);

        // RACE CHECK: Re-verify action is still in-progress before the LLM call
        const freshAction = this.actionQueue.getAction(action.id);
        if (!freshAction || freshAction.status !== 'in-progress') {
            logger.debug(`AgenticUser: Action ${action.id} is no longer in-progress. Skipping stuck guidance.`);
            return;
        }

        const guidance = await this.generateGuidance(action, stuckSignals, actionMemories, context);

        // Track evaluation for backoff
        const prevEval = this.evaluationTracker.get(`stuck-${action.id}`);
        this.evaluationTracker.set(`stuck-${action.id}`, {
            lastEvalTime: Date.now(),
            attempts: (prevEval?.attempts || 0) + 1,
            lastConfidence: 60
        });

        if (guidance) {
            const intervention: AgenticUserIntervention = {
                id: `au-guidance-${Date.now()}`,
                actionId: action.id,
                type: 'stuck-recovery',
                trigger: `Stuck signals: ${stuckSignals.join(', ')}`,
                response: guidance,
                confidence: 60, // Proactive guidance is inherently less certain
                applied: true,
                timestamp: new Date().toISOString(),
                contextSummary: context.summary
            };

            // Inject guidance as a system memory entry (not as a user message)
            this.memory.saveMemory({
                id: `${action.id}-agentic-user-guidance-${Date.now()}`,
                type: 'short',
                content: `[AGENTIC-USER GUIDANCE]: ${guidance}`,
                metadata: {
                    actionId: action.id,
                    agenticUser: true,
                    stuckSignals,
                    step: stepCount
                }
            });

            // Update the action so we don't repeat guidance too soon
            this.actionQueue.updatePayload(action.id, {
                _lastAgenticUserGuidanceStep: stepCount
            });

            this.interventionCounts.set(action.id, interventionCount + 1);
            this.postInterventionCooldown.set(action.id, Date.now());
            this.interventionLog.push(intervention);
            this.saveInterventionLog();

            // Emit event so Agent can notify the real user
            eventBus.emit('agentic-user:intervention', {
                actionId: action.id,
                type: intervention.type,
                confidence: intervention.confidence,
                response: guidance,
                source: action.payload?.source || 'unknown',
                sourceId: action.payload?.sourceId || action.payload?.chatId || 'unknown',
                trigger: intervention.trigger
            });

            logger.info(`AgenticUser: Proactive guidance injected for action ${action.id}: "${guidance.slice(0, 100)}..."`);
        }
    }

    // ─── Context Building ────────────────────────────────────────────

    /**
     * Cached wrapper around buildContext() to avoid repeated heavy I/O.
     * Returns cached context if it's still fresh (within TTL), otherwise rebuilds.
     */
    private async buildContextCached(action: Action): Promise<{
        userProfile: string;
        contactProfile: string;
        recentEpisodic: string;
        journal: string;
        learning: string;
        taskDescription: string;
        stepHistory: string;
        summary: string;
    }> {
        const cached = this.contextCache.get(action.id);
        if (cached && (Date.now() - cached.timestamp) < AgenticUser.CONTEXT_CACHE_TTL) {
            logger.debug(`AgenticUser: Using cached context for action ${action.id} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
            return cached.context;
        }

        const context = await this.buildContext(action);
        this.contextCache.set(action.id, { context, timestamp: Date.now() });
        return context;
    }

    /**
     * Assemble everything the AgenticUser knows about this user and task.
     */
    private async buildContext(action: Action): Promise<{
        userProfile: string;
        contactProfile: string;
        recentEpisodic: string;
        journal: string;
        learning: string;
        taskDescription: string;
        stepHistory: string;
        summary: string;
    }> {
        // 1. User profile (USER.md)
        const userProfile = this.memory.getUserContext()?.raw || '';

        // 2. Contact profile for the requesting user
        let contactProfile = '';
        if (action.payload?.sourceId) {
            contactProfile = this.memory.getContactProfile(action.payload.sourceId) || '';
        }

        // 3. Recent episodic memories (task summaries, patterns)
        const episodicMemories = this.memory.searchMemory('episodic').slice(-10);
        const recentEpisodic = episodicMemories
            .map(m => `[${m.timestamp}] ${m.content}`)
            .join('\n');

        // 4. Journal tail (agent's reflections and self-awareness)
        let journal = '';
        try {
            const jp = this.config.get('journalPath');
            if (jp && fs.existsSync(jp)) {
                const full = fs.readFileSync(jp, 'utf-8');
                journal = full.length > 1500 ? full.slice(-1500) : full;
            }
        } catch { /* ignore */ }

        // 5. Learning base (knowledge the agent has acquired)
        let learning = '';
        try {
            const lp = this.config.get('learningPath');
            if (lp && fs.existsSync(lp)) {
                const full = fs.readFileSync(lp, 'utf-8');
                learning = full.length > 1500 ? full.slice(-1500) : full;
            }
        } catch { /* ignore */ }

        // 6. Bootstrap files for deeper identity/soul context
        let bootstrapContext = '';
        try {
            const dataHome = this.config.getDataHome();
            for (const file of ['IDENTITY.md', 'SOUL.md', 'USER.md']) {
                const fp = path.join(dataHome, 'bootstrap', file);
                if (fs.existsSync(fp)) {
                    const content = fs.readFileSync(fp, 'utf-8');
                    if (content.trim()) {
                        bootstrapContext += `\n--- ${file} ---\n${content.slice(0, 800)}\n`;
                    }
                }
            }
        } catch { /* ignore */ }

        // 7. Task description and step history
        const taskDescription = action.payload?.description || 'Unknown task';
        const actionMemories = this.memory.getActionMemories(action.id);
        const stepHistory = actionMemories
            .map(m => `[Step] ${m.content?.slice(0, 200)}`)
            .join('\n');

        // 8. Semantic search for task-relevant memories
        let semanticRecall = '';
        if (this.memory.vectorMemory?.isEnabled()) {
            try {
                const results = await this.memory.vectorMemory.search(taskDescription, 5);
                if (results.length > 0) {
                    semanticRecall = results
                        .map(r => `[Recall] ${r.content.slice(0, 200)}`)
                        .join('\n');
                }
            } catch { /* ignore */ }
        }

        const summary = [
            userProfile ? 'user-profile' : '',
            contactProfile ? 'contact-profile' : '',
            recentEpisodic ? 'episodic-memory' : '',
            journal ? 'journal' : '',
            learning ? 'learning' : '',
            bootstrapContext ? 'bootstrap' : '',
            semanticRecall ? 'semantic-recall' : '',
        ].filter(Boolean).join(', ');

        return {
            userProfile: userProfile + (bootstrapContext ? `\n\n${bootstrapContext}` : ''),
            contactProfile,
            recentEpisodic: recentEpisodic + (semanticRecall ? `\n\n${semanticRecall}` : ''),
            journal,
            learning,
            taskDescription,
            stepHistory,
            summary: `Context sources: ${summary}`
        };
    }

    // ─── LLM Evaluation ─────────────────────────────────────────────

    /**
     * Core evaluation: Given a question and context, determine if the AgenticUser
     * can confidently answer on behalf of the human.
     */
    private async evaluate(
        action: Action,
        question: string,
        context: Awaited<ReturnType<typeof this.buildContext>>
    ): Promise<{
        confidence: number;
        response: string;
        restricted: boolean;
        restrictedReason?: string;
        safeDefault?: string;
    }> {
        const prompt = `You are an **Agentic User** — an autonomous proxy for a human user who is currently unavailable.
An AI agent is working on a task and has asked the user a question. The user hasn't responded.
Your job is to answer the question on the user's behalf, using ONLY the knowledge below.

═══════════════════════════════════════════════════════════════
USER PROFILE (What we know about this person):
${context.userProfile || 'No user profile available.'}

CONTACT PROFILE (Specific relationship data):
${context.contactProfile || 'No contact profile available.'}

AGENT JOURNAL (Agent reflections and self-knowledge):
${context.journal || 'No journal available.'}

AGENT KNOWLEDGE BASE (Learned facts):
${context.learning || 'No learning base available.'}

PAST EXPERIENCES (Episodic memories):
${context.recentEpisodic || 'No episodic memories available.'}
═══════════════════════════════════════════════════════════════

CURRENT TASK: ${context.taskDescription}

WORK DONE SO FAR:
${context.stepHistory || 'No steps executed yet.'}

THE AGENT'S QUESTION: "${question}"

═══════════════════════════════════════════════════════════════

INSTRUCTIONS:
1. Analyze the question and all available context
2. Determine if you can answer confidently based on known preferences, patterns, or facts
3. Check if this falls into a RESTRICTED category (financial decisions, irreversible actions, sharing private info, destructive operations)
4. Assign a confidence score (0-100):
   - 90-100: Clear answer from documented preferences or explicit past behavior
   - 70-89:  Strong inference from patterns and context
   - 50-69:  Reasonable guess but user might disagree
   - 0-49:   Too uncertain — better to let the agent proceed with a safe default

RESPOND IN EXACTLY THIS JSON FORMAT:
{
    "confidence": <number 0-100>,
    "reasoning": "<brief explanation of why you're confident or not>",
    "response": "<the answer you'd give on behalf of the user — written as if you ARE the user>",
    "restricted": <true/false — true if this involves financial, destructive, private, or irreversible decisions>,
    "restrictedReason": "<if restricted, explain why>",
    "safeDefault": "<if confidence is low, suggest a safe proceed-anyway message like 'Go ahead with the most reasonable option' or 'Try the simpler approach first'>"
}

CRITICAL RULES:
- Write the "response" as the USER would say it — first person, casual, direct
- NEVER fabricate user preferences that aren't in the context
- When genuinely unsure, give a LOWER confidence and a good safeDefault
- Prefer "go ahead with [specific reasonable choice]" over vague answers
- For preference questions (e.g., "do you want X or Y?"), look for patterns in the profile/history
- For clarification questions (e.g., "did you mean X?"), use task context to infer the likely intent`;

        try {
            const raw = await this.llm.call(prompt, 'You are an autonomous user proxy. Respond only with valid JSON.');
            
            // Parse the JSON response
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                logger.warn('AgenticUser: Failed to parse LLM response as JSON');
                return { confidence: 0, response: '', restricted: false, safeDefault: 'Go ahead with whatever seems most reasonable.' };
            }

            const parsed = JSON.parse(jsonMatch[0]);
            return {
                confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
                response: String(parsed.response || ''),
                restricted: Boolean(parsed.restricted),
                restrictedReason: parsed.restrictedReason ? String(parsed.restrictedReason) : undefined,
                safeDefault: parsed.safeDefault ? String(parsed.safeDefault) : undefined
            };
        } catch (e) {
            logger.error(`AgenticUser: Evaluation LLM call failed: ${e}`);
            return { confidence: 0, response: '', restricted: false, safeDefault: 'Go ahead with whichever option seems best.' };
        }
    }

    /**
     * Generate proactive guidance for a stuck action.
     */
    private async generateGuidance(
        action: Action,
        stuckSignals: string[],
        actionMemories: MemoryEntry[],
        context: Awaited<ReturnType<typeof this.buildContext>>
    ): Promise<string | null> {
        const recentSteps = actionMemories.slice(-5).map(m => m.content?.slice(0, 200)).join('\n');
        
        const prompt = `You are an **Agentic User** providing proactive guidance to an AI agent that appears stuck.

USER PROFILE:
${context.userProfile || 'No user profile available.'}

AGENT KNOWLEDGE:
${context.learning || 'No learning base.'}

CURRENT TASK: ${context.taskDescription}

RECENT STEPS (last 5):
${recentSteps}

STUCK SIGNALS DETECTED:
${stuckSignals.map(s => `- ${s}`).join('\n')}

Based on what you know about the user and the task, provide a brief, actionable guidance message.
This will be injected as a [SYSTEM] hint — NOT a user message.

Guidelines:
- Be specific: "Try searching for X instead" not "Try a different approach"
- Reference user preferences if relevant: "The user prefers Y, so focus on that"
- Keep it to 1-3 sentences
- If the agent is looping, suggest a concrete alternative
- If the agent is going in the wrong direction, correct course based on known preferences

Respond with ONLY the guidance text. No JSON, no formatting, just the message.`;

        try {
            const response = await this.llm.call(prompt, 'You are an autonomous user proxy providing direction.');
            const trimmed = response.trim();
            
            // Sanity check: don't inject empty or absurdly long guidance
            if (trimmed.length < 10 || trimmed.length > 500) {
                return null;
            }
            return trimmed;
        } catch (e) {
            logger.error(`AgenticUser: Guidance generation failed: ${e}`);
            return null;
        }
    }

    // ─── Intervention Application ────────────────────────────────────

    /**
     * Apply an intervention: inject the AgenticUser's response into the action
     * and resume it, mimicking the flow of a real user replying.
     * 
     * IMPORTANT: Callers should pre-verify the action is still in 'waiting' state.
     * This method does a final safety check to prevent race conditions where the
     * real user responded between the LLM call and application.
     */
    private async applyIntervention(
        action: Action,
        response: string,
        intervention: AgenticUserIntervention
    ): Promise<boolean> {
        // FINAL RACE CHECK: Re-fetch the action and ensure it's still waiting
        const currentAction = this.actionQueue.getAction(action.id);
        if (!currentAction || currentAction.status !== 'waiting') {
            logger.info(`AgenticUser: RACE GUARD — Action ${action.id} is no longer waiting (status: ${currentAction?.status || 'gone'}). Real user likely responded. Discarding intervention.`);
            return false;
        }

        // Tag the response clearly so the agent knows it's synthetic
        const taggedResponse = `[AGENTIC-USER | confidence: ${intervention.confidence}%]: ${response}`;

        // Update the action description with the synthetic response
        // (mirrors what pushTask does when resuming a waiting action)
        const originalDesc = action.payload?.description || '';
        const updatedDesc = `${originalDesc}\n\n[AGENTIC-USER RESPONSE]: ${response}`;

        this.actionQueue.updatePayload(action.id, {
            description: updatedDesc,
            lastUserMessageText: taggedResponse,
            resumedByAgenticUser: true,
            agenticUserConfidence: intervention.confidence,
            resumedFromWaitingAt: new Date().toISOString()
        });

        // Save to memory so the agent sees it in context
        this.memory.saveMemory({
            id: `${action.id}-agentic-user-${Date.now()}`,
            type: 'short',
            content: `[AGENTIC-USER RESPONSE | confidence: ${intervention.confidence}%]: ${response}\n(This response was generated automatically because the user was unavailable. The user can review and correct this later.)`,
            timestamp: new Date().toISOString(),
            metadata: {
                actionId: action.id,
                agenticUser: true,
                interventionId: intervention.id,
                confidence: intervention.confidence,
                source: action.payload?.source || 'unknown',
                sourceId: action.payload?.sourceId || 'unknown'
            }
        });

        // Resume the action — same as when a real user replies
        this.actionQueue.updateStatus(action.id, 'pending');

        // Emit event so Agent can notify the real user on the originating channel
        eventBus.emit('agentic-user:intervention', {
            actionId: action.id,
            type: intervention.type,
            confidence: intervention.confidence,
            response,
            source: action.payload?.source || 'unknown',
            sourceId: action.payload?.sourceId || action.payload?.chatId || 'unknown',
            trigger: intervention.trigger
        });

        return true;
    }

    // ─── Helper Methods ──────────────────────────────────────────────

    /**
     * Extract the question the agent asked from the action's metadata and memory.
     */
    private extractQuestion(action: Action): string | null {
        // Check action metadata first (set by the clarification flow)
        if (action.payload?.lastUserMessageText && action.payload.lastUserMessageText.includes('Clarification')) {
            return action.payload.lastUserMessageText;
        }

        // Search step memories for clarification/question entries
        const actionMemories = this.memory.getActionMemories(action.id);
        for (let i = actionMemories.length - 1; i >= 0; i--) {
            const m = actionMemories[i];
            const content = m.content || '';
            
            // Look for clarification markers
            if (content.includes('Clarification Needed') || content.includes('clarification')) {
                const questionMatch = content.match(/(?:Question|clarification)[:\s]*"?([^"]+)"?/i);
                if (questionMatch) return questionMatch[1].trim();
                return content.replace(/\[SYSTEM:.*?\]/g, '').trim();
            }

            // Look for question markers in waiting memories
            if (m.metadata?.waitingForClarification || m.metadata?.waitingForResponse) {
                const qMatch = content.match(/Question:\s*"([^"]+)"/i);
                if (qMatch) return qMatch[1];
                return content.replace(/\[SYSTEM:.*?\]/g, '').trim();
            }
        }

        // Last resort: check recent send_* tool calls for questions
        for (let i = actionMemories.length - 1; i >= 0; i--) {
            const m = actionMemories[i];
            if (m.metadata?.tool?.startsWith('send_') && m.metadata?.input?.message) {
                const msg = m.metadata.input.message;
                if (msg.includes('?') || /\b(would you|do you|should I|which|can you|please confirm)\b/i.test(msg)) {
                    return msg;
                }
            }
        }

        return null;
    }

    /**
     * Detect signals that an in-progress action is stuck.
     */
    private detectStuckSignals(memories: MemoryEntry[]): string[] {
        const signals: string[] = [];
        if (memories.length < 3) return signals;

        const recent = memories.slice(-6);

        // 1. Repeated tool failures
        const failures = recent.filter(m =>
            m.content?.includes('error') || m.content?.includes('failed') || m.content?.includes('FAILED')
        );
        if (failures.length >= 3) {
            signals.push(`${failures.length} failures in last ${recent.length} steps`);
        }

        // 2. Same tool called repeatedly
        const toolNames = recent
            .map(m => m.metadata?.tool)
            .filter(Boolean);
        const toolCounts: Record<string, number> = {};
        for (const t of toolNames) {
            toolCounts[t] = (toolCounts[t] || 0) + 1;
        }
        for (const [tool, count] of Object.entries(toolCounts)) {
            if (count >= 3) {
                signals.push(`tool '${tool}' called ${count} times in last ${recent.length} steps`);
            }
        }

        // 3. No messaging tools used (agent working silently)
        const hasMessaged = recent.some(m =>
            m.metadata?.tool?.startsWith('send_')
        );
        if (!hasMessaged && recent.length >= 5) {
            signals.push('no user communication in last 5+ steps');
        }

        // 4. Planning-only turns (journal/learning updates without real work)
        const planningTools = ['update_journal', 'update_learning', 'update_user_profile'];
        const planningOnly = recent.filter(m =>
            planningTools.includes(m.metadata?.tool)
        );
        if (planningOnly.length >= 3) {
            signals.push(`${planningOnly.length} planning-only turns without action`);
        }

        return signals;
    }

    // ─── Settings & Persistence ──────────────────────────────────────

    private loadSettings(): AgenticUserConfig {
        return {
            enabled: this.config.get('agenticUserEnabled') ?? DEFAULT_CONFIG.enabled,
            responseDelay: this.config.get('agenticUserResponseDelay') ?? DEFAULT_CONFIG.responseDelay,
            confidenceThreshold: this.config.get('agenticUserConfidenceThreshold') ?? DEFAULT_CONFIG.confidenceThreshold,
            proactiveGuidance: this.config.get('agenticUserProactiveGuidance') ?? DEFAULT_CONFIG.proactiveGuidance,
            proactiveStepThreshold: this.config.get('agenticUserProactiveStepThreshold') ?? DEFAULT_CONFIG.proactiveStepThreshold,
            checkIntervalSeconds: this.config.get('agenticUserCheckInterval') ?? DEFAULT_CONFIG.checkIntervalSeconds,
            maxInterventionsPerAction: this.config.get('agenticUserMaxInterventions') ?? DEFAULT_CONFIG.maxInterventionsPerAction,
            restrictedCategories: DEFAULT_CONFIG.restrictedCategories,
        };
    }

    private loadInterventionLog(): void {
        try {
            if (fs.existsSync(this.interventionLogPath)) {
                const data = fs.readFileSync(this.interventionLogPath, 'utf-8');
                this.interventionLog = JSON.parse(data);
                // Only keep last 200 entries to prevent unbounded growth
                if (this.interventionLog.length > 200) {
                    this.interventionLog = this.interventionLog.slice(-200);
                }
            }
        } catch (e) {
            logger.warn(`AgenticUser: Failed to load intervention log: ${e}`);
            this.interventionLog = [];
        }
    }

    private saveInterventionLog(): void {
        try {
            const dir = path.dirname(this.interventionLogPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.interventionLogPath, JSON.stringify(this.interventionLog, null, 2));
        } catch (e) {
            logger.error(`AgenticUser: Failed to save intervention log: ${e}`);
        }
    }

    // ─── Public API ──────────────────────────────────────────────────

    /** Get recent interventions for user review */
    public getInterventionLog(limit: number = 20): AgenticUserIntervention[] {
        return this.interventionLog.slice(-limit);
    }

    /** Get only applied (actually used) interventions */
    public getAppliedInterventions(limit: number = 20): AgenticUserIntervention[] {
        return this.interventionLog
            .filter(i => i.applied)
            .slice(-limit);
    }

    /** Check if the AgenticUser is active */
    public isActive(): boolean {
        return this.active;
    }

    /** Get current settings (readonly) */
    public getSettings(): Readonly<AgenticUserConfig> {
        return { ...this.settings };
    }

    /** Get stats for monitoring */
    public getStats(): { totalInterventions: number; appliedInterventions: number; activeTimers: number; isActive: boolean; trackedChannels: number; cachedContexts: number; evaluationsTracked: number } {
        return {
            totalInterventions: this.interventionLog.length,
            appliedInterventions: this.interventionLog.filter(i => i.applied).length,
            activeTimers: this.pendingTimers.size,
            isActive: this.active,
            trackedChannels: this.lastUserActivity.size,
            cachedContexts: this.contextCache.size,
            evaluationsTracked: this.evaluationTracker.size
        };
    }

    /** Clear intervention history (for user-initiated reset) */
    public clearHistory(): void {
        this.interventionLog = [];
        this.interventionCounts.clear();
        this.evaluationTracker.clear();
        this.contextCache.clear();
        this.postInterventionCooldown.clear();
        this.lastUserActivity.clear();
        this.saveInterventionLog();
        logger.info('AgenticUser: Intervention history cleared.');
    }
}
