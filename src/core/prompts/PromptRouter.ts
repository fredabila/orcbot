/**
 * PromptRouter — Analyzes task context and selects which PromptHelpers to activate.
 * 
 * The router examines the task description, metadata, and execution state to
 * determine which helper modules are relevant. It then composes the selected
 * helpers' prompts into a single optimized system prompt.
 * 
 * This replaces the monolithic prompt approach with targeted, composable modules.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';
import { CoreHelper } from './CoreHelper';
import { ToolingHelper } from './ToolingHelper';
import { CommunicationHelper } from './CommunicationHelper';
import { BrowserHelper } from './BrowserHelper';
import { ResearchHelper } from './ResearchHelper';
import { SchedulingHelper } from './SchedulingHelper';
import { MediaHelper } from './MediaHelper';
import { ProfileHelper } from './ProfileHelper';
import { DevelopmentHelper } from './DevelopmentHelper';
import { TaskChecklistHelper } from './TaskChecklistHelper';
import { PollingHelper } from './PollingHelper';
import { PrivacyHelper } from './PrivacyHelper';
import { logger } from '../../utils/logger';

/** Minimal LLM interface — avoids importing the full MultiLLM dependency */
export interface RouterLLM {
    call(prompt: string, systemMessage?: string): Promise<string>;
}

export interface RouteResult {
    /** Names of activated helpers */
    activeHelpers: string[];
    /** The composed system prompt from all active helpers */
    composedPrompt: string;
    /** Estimated token savings vs monolithic prompt */
    estimatedSavings: number;
    /** How the domain helpers were selected */
    routingMethod: 'keywords' | 'fallback-heuristics' | 'llm-classifier';
}

export class PromptRouter {
    private helpers: PromptHelper[] = [];
    private llm: RouterLLM | null = null;
    /** Cache LLM classification results to avoid redundant calls for similar tasks */
    private classificationCache = new Map<string, { helpers: string[]; timestamp: number }>();
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    private static readonly CACHE_MAX_SIZE = 50;

    constructor() {
        // Register all built-in helpers
        this.register(new CoreHelper());
        this.register(new PrivacyHelper());
        this.register(new ToolingHelper());
        this.register(new CommunicationHelper());
        this.register(new BrowserHelper());
        this.register(new ResearchHelper());
        this.register(new SchedulingHelper());
        this.register(new MediaHelper());
        this.register(new ProfileHelper());
        this.register(new DevelopmentHelper());
        this.register(new TaskChecklistHelper());
        this.register(new PollingHelper());
    }

    /**
     * Set the LLM instance for intelligent classification fallback.
     * When set, the router uses a cheap LLM call as the final tier when
     * keyword + regex + heuristic matching all fail.
     */
    public setLLM(llm: RouterLLM): void {
        this.llm = llm;
    }

    /**
     * Register a custom helper (e.g., from a plugin).
     */
    public register(helper: PromptHelper): void {
        // Replace if same name exists
        this.helpers = this.helpers.filter(h => h.name !== helper.name);
        this.helpers.push(helper);
        // Sort by priority
        this.helpers.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Remove a helper by name.
     */
    public unregister(name: string): void {
        this.helpers = this.helpers.filter(h => h.name !== name);
    }

    /**
     * Get all registered helper names.
     */
    public getHelperNames(): string[] {
        return this.helpers.map(h => h.name);
    }

    /**
     * Route a task through the helper system and compose the optimized prompt.
     * Three-tier activation strategy:
     *   Tier 1: Keyword + regex matching (fast, free, ~85% accuracy)
     *   Tier 2: Heuristic fallback for broad intent classes (fast, free)
     *   Tier 3: LLM classifier — cheap, short prompt, high accuracy (~99%)
     *           Only fires when tier 1+2 produced zero domain helpers AND an LLM is available.
     */
    public async route(context: PromptHelperContext): Promise<RouteResult> {
        const activeHelpers: string[] = [];
        const promptSections: string[] = [];
        let totalMonolithicSize = 0;
        let routingMethod: RouteResult['routingMethod'] = 'keywords';

        // Track domain vs always-active separately
        const activatedDomainHelpers: string[] = [];
        const helperPrompts = new Map<string, string>();

        for (const helper of this.helpers) {
            const prompt = helper.getPrompt(context);
            totalMonolithicSize += prompt.length;
            helperPrompts.set(helper.name, prompt);

            // Heartbeat tasks only need always-active helpers (core + tooling).
            // Domain helpers (browser, media, scheduling, communication, etc.) are
            // redundant because the heartbeat prompt is self-contained with its own
            // context, skills, and decision framework.
            if (context.isHeartbeat && !helper.alwaysActive) {
                continue;
            }

            const isActive = helper.alwaysActive || helper.shouldActivate(context);

            if (isActive) {
                activeHelpers.push(helper.name);
                if (!helper.alwaysActive) {
                    activatedDomainHelpers.push(helper.name);
                }
                if (prompt.trim()) {
                    promptSections.push(prompt);
                }
            }
        }

        // TIER 2: Heuristic fallback when zero domain helpers matched.
        if (activatedDomainHelpers.length === 0) {
            const fallbacks = this.inferFallbackHelpers(context);

            // TIER 3: LLM classifier — if heuristics are uncertain (only produced
            // the universal "communication" fallback) and we have an LLM, ask it.
            const heuristicsUncertain = fallbacks.length <= 1 && fallbacks[0] === 'communication';
            if (heuristicsUncertain && this.llm) {
                try {
                    const llmHelpers = await this.classifyWithLLM(context);
                    if (llmHelpers.length > 0) {
                        routingMethod = 'llm-classifier';
                        for (const name of llmHelpers) {
                            if (!activeHelpers.includes(name)) {
                                activeHelpers.push(name);
                                activatedDomainHelpers.push(name);
                                const prompt = helperPrompts.get(name);
                                if (prompt?.trim()) {
                                    promptSections.push(prompt);
                                }
                            }
                        }
                        logger.debug(`PromptRouter: LLM classifier activated → [${llmHelpers.join(', ')}]`);
                    }
                } catch (err) {
                    logger.warn(`PromptRouter: LLM classification failed, using heuristic fallback: ${err}`);
                    // Fall through to heuristic fallback below
                }
            }

            // If LLM didn't fire or failed, use heuristic fallbacks
            if (activatedDomainHelpers.length === 0) {
                routingMethod = 'fallback-heuristics';
                for (const name of fallbacks) {
                    if (!activeHelpers.includes(name)) {
                        activeHelpers.push(name);
                        activatedDomainHelpers.push(name);
                        const prompt = helperPrompts.get(name);
                        if (prompt?.trim()) {
                            promptSections.push(prompt);
                        }
                    }
                }
                if (fallbacks.length > 0) {
                    logger.debug(`PromptRouter: Heuristic fallback activated → [${fallbacks.join(', ')}]`);
                }
            }
        }

        const composedPrompt = promptSections.join('\n\n');
        const estimatedSavings = Math.max(0, totalMonolithicSize - composedPrompt.length);

        if (estimatedSavings > 500) {
            logger.debug(`PromptRouter: Saved ~${estimatedSavings} chars by routing [${activeHelpers.join(', ')}]`);
        }
        logger.debug(`PromptRouter: Active helpers [${activeHelpers.join(', ')}] via ${routingMethod}`);

        return {
            activeHelpers,
            composedPrompt,
            estimatedSavings,
            routingMethod
        };
    }

    /**
     * Classify task intent using an LLM. This is a cheap call:
     * - Short system prompt (~300 tokens)
     * - Short user prompt (just the task description)
     * - Response is a JSON array of helper names
     * - Results are cached for 5 minutes to avoid redundant calls
     */
    private async classifyWithLLM(context: PromptHelperContext): Promise<string[]> {
        if (!this.llm) return [];

        // Cache key: normalized task description (first 200 chars)
        const cacheKey = context.taskDescription.toLowerCase().trim().slice(0, 200);
        const cached = this.classificationCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < PromptRouter.CACHE_TTL_MS) {
            logger.debug(`PromptRouter: LLM classification cache hit for "${cacheKey.slice(0, 50)}..."`);
            return cached.helpers;
        }

        // Evict stale entries
        if (this.classificationCache.size > PromptRouter.CACHE_MAX_SIZE) {
            const now = Date.now();
            for (const [key, val] of this.classificationCache) {
                if (now - val.timestamp > PromptRouter.CACHE_TTL_MS) {
                    this.classificationCache.delete(key);
                }
            }
        }

        const domainHelpers = this.helpers
            .filter(h => !h.alwaysActive)
            .map(h => `- ${h.name}: ${h.description}`);

        const systemPrompt = `You are a task classifier. Given a user's task description, determine which helper modules are relevant.

Available helper modules:
${domainHelpers.join('\n')}

Rules:
- Return ONLY a JSON array of helper names. Example: ["development","browser"]
- Select 1-3 most relevant helpers. Don't over-select.
- If the task involves creating/building something tangible, include "development".
- If the task involves messaging someone, include "communication".
- If the task involves finding/gathering information, include "research".
- If unsure, prefer including over excluding — false positive costs less than false negative.
- Return ONLY the JSON array, no explanation.`;

        const userPrompt = `Task: "${context.taskDescription}"`;

        const response = await this.llm.call(userPrompt, systemPrompt);

        // Parse the response — extract JSON array
        const match = response.match(/\[[\s\S]*?\]/);
        if (!match) {
            logger.warn(`PromptRouter: LLM classifier returned non-JSON: "${response.slice(0, 100)}"`);
            return [];
        }

        try {
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) return [];

            // Validate: only keep names that match registered helpers
            const validNames = new Set(this.helpers.filter(h => !h.alwaysActive).map(h => h.name));
            const result = parsed
                .filter((n: any) => typeof n === 'string' && validNames.has(n))
                .slice(0, 4); // Cap at 4 helpers max

            // Cache the result
            this.classificationCache.set(cacheKey, { helpers: result, timestamp: Date.now() });

            return result;
        } catch (e) {
            logger.warn(`PromptRouter: LLM classifier JSON parse failed: ${e}`);
            return [];
        }
    }

    /**
     * Infer which helpers to activate as a fallback when keyword matching produced
     * zero domain helpers. Uses broader heuristics as fast path, then optionally
     * enhances with LLM-based intent classification when regex is uncertain.
     * - Action-oriented language → DevelopmentHelper + ResearchHelper
     * - Question language → CommunicationHelper + ResearchHelper
     * - Long/complex description → ResearchHelper
     * - Any messaging channel → CommunicationHelper
     */
    private inferFallbackHelpers(context: PromptHelperContext): string[] {
        const task = context.taskDescription.toLowerCase();
        const fallbacks: string[] = [];

        // Has a messaging channel active
        const hasChannel = ['telegram', 'whatsapp', 'discord', 'gateway-chat'].includes(context.metadata.source);
        // Long description suggests complexity
        const isComplex = task.length > 100;

        if (hasChannel) {
            fallbacks.push('communication');
        }

        // Broad action-verb detection (covers creative phrasings the keyword lists missed)
        const hasActionIntent = /\b(make|do|get|give|help|put|show|figure|work|handle|take\s+care|sort\s+out|come\s+up\s+with|hook\s+.+up|throw|set|run|start|launch|open|try)\b/.test(task);
        // Question/information-seeking intent
        const hasQuestionIntent = /\b(what|how|why|where|when|who|which|can\s+you|could\s+you|is\s+there|tell\s+me|explain|describe)\b/.test(task);
        // Polling/monitoring intent — route to polling helper
        const hasPollingIntent = /\b(wait\s+for|monitor|watch\s+for|poll|check\s+if|notify\s+me\s+when|alert\s+me|keep\s+checking|retry|is\s+it\s+ready|is\s+it\s+done)\b/.test(task);
        // Multi-step/checklist intent — route to task-checklist helper
        const hasChecklistIntent = /\b(step\s+by\s+step|break\s+down|checklist|multiple\s+steps|first.*then|plan\s+out|track\s+progress)\b/.test(task);

        if (hasActionIntent) {
            // Action tasks most often need dev or research guidance
            fallbacks.push('development');
            fallbacks.push('research');
        }

        if (hasQuestionIntent && !hasActionIntent) {
            // Pure questions benefit from research + communication
            fallbacks.push('research');
            if (!hasChannel) fallbacks.push('communication');
        }

        if (hasPollingIntent && !fallbacks.includes('polling')) {
            fallbacks.push('polling');
        }

        if ((hasChecklistIntent || isComplex) && !fallbacks.includes('task-checklist')) {
            fallbacks.push('task-checklist');
        }

        if (isComplex && !fallbacks.includes('research')) {
            fallbacks.push('research');
        }

        // If STILL nothing matched, include communication as the universal fallback
        // (every task involves some form of response to the user)
        if (fallbacks.length === 0) {
            fallbacks.push('communication');
        }

        return fallbacks;
    }

    /**
     * Preview which helpers would activate for a task (useful for debugging).
     */
    public preview(context: PromptHelperContext): { name: string; active: boolean; reason: string }[] {
        return this.helpers.map(helper => {
            if (helper.alwaysActive) {
                return { name: helper.name, active: true, reason: 'always active' };
            }
            const active = helper.shouldActivate(context);
            return {
                name: helper.name,
                active,
                reason: active ? 'task match' : 'not relevant'
            };
        });
    }
}
