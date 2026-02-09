/**
 * LLMParser — Smart LLM-based parsing utility.
 *
 * Replaces brittle regex / hardcoded extraction with lightweight LLM calls.
 * Designed as a fallback tier: callers should still try fast regex first and
 * only call LLMParser when regex produces no usable result.
 *
 * The parser uses short, focused system prompts and expects the caller to
 * supply an LLM interface (the same RouterLLM shape used by PromptRouter).
 */

import { logger } from '../utils/logger';

/** Minimal LLM interface — same contract as PromptRouter.RouterLLM */
export interface ParserLLM {
    call(prompt: string, systemMessage?: string): Promise<string>;
}

export interface ExtractedFields {
    action?: string;
    tool?: string;
    tools?: Array<{ name: string; metadata?: Record<string, any> }>;
    reasoning?: string;
    verification?: { goals_met: boolean; analysis: string };
    metadata?: Record<string, any>;
    content?: string;
}

export interface ClassifiedIntent {
    /** Primary intent category */
    intent: 'action' | 'question' | 'scheduling' | 'research' | 'communication' | 'development' | 'unknown';
    /** Confidence 0-1 */
    confidence: number;
    /** Suggested prompt helpers to activate */
    suggestedHelpers: string[];
}

export class LLMParser {
    private llm: ParserLLM;
    /** Simple result cache keyed by truncated input */
    private cache = new Map<string, { result: any; timestamp: number }>();
    private static readonly CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
    private static readonly CACHE_MAX_SIZE = 30;

    constructor(llm: ParserLLM) {
        this.llm = llm;
    }

    /**
     * Extract structured fields from a malformed JSON string using an LLM.
     * This replaces the regex-heavy `extractFieldsManually` in ParserLayer
     * when regex fails to produce a usable result.
     */
    public async extractFields(malformedJson: string): Promise<ExtractedFields | null> {
        const cacheKey = `extract:${malformedJson.slice(0, 200)}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached as ExtractedFields;

        const systemPrompt = `You are a JSON repair tool. Given malformed or partial JSON from an AI agent response, extract the structured fields and return ONLY valid JSON.

Extract these fields if present:
- action: string (e.g. "EXECUTE", "THOUGHT")
- tool: string (single tool name)
- tools: array of {name, metadata} objects
- reasoning: string
- verification: {goals_met: boolean, analysis: string}
- metadata: object with tool parameters
- content: string message

Return ONLY a valid JSON object with the fields you found. If a field is not present, omit it. Do not invent data.`;

        try {
            const response = await this.llm.call(
                `Repair this malformed JSON and extract structured fields:\n\`\`\`\n${malformedJson.slice(0, 2000)}\n\`\`\``,
                systemPrompt
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                logger.debug('LLMParser: extractFields — no JSON in LLM response');
                return null;
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate: must have at least one useful field
            if (!parsed.tool && !parsed.tools?.length && !parsed.action && !parsed.content) {
                logger.debug('LLMParser: extractFields — LLM returned empty result');
                return null;
            }

            const result: ExtractedFields = {};
            if (parsed.action) result.action = String(parsed.action);
            if (parsed.tool) result.tool = String(parsed.tool);
            if (Array.isArray(parsed.tools)) {
                result.tools = parsed.tools
                    .filter((t: any) => t?.name)
                    .map((t: any) => ({
                        name: String(t.name),
                        metadata: t.metadata || {}
                    }));
            }
            if (parsed.reasoning) result.reasoning = String(parsed.reasoning).slice(0, 500);
            if (parsed.verification) {
                result.verification = {
                    goals_met: Boolean(parsed.verification.goals_met),
                    analysis: String(parsed.verification.analysis || 'Extracted by LLM')
                };
            }
            if (parsed.metadata && typeof parsed.metadata === 'object') {
                result.metadata = parsed.metadata;
            }
            if (parsed.content) result.content = String(parsed.content);

            logger.info(`LLMParser: extractFields succeeded — tool: ${result.tool || 'none'}, tools: ${result.tools?.length || 0}`);
            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            logger.warn(`LLMParser: extractFields failed: ${error}`);
            return null;
        }
    }

    /**
     * Classify user intent using an LLM call.
     * Replaces hardcoded regex patterns in PromptRouter.inferFallbackHelpers
     * for ambiguous tasks where keyword matching fails.
     */
    public async classifyIntent(taskDescription: string): Promise<ClassifiedIntent> {
        const cacheKey = `intent:${taskDescription.toLowerCase().trim().slice(0, 200)}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached as ClassifiedIntent;

        const systemPrompt = `You are a task classifier. Analyze the user's task and return a JSON object with:
- intent: one of "action", "question", "scheduling", "research", "communication", "development", "unknown"
- confidence: number 0-1
- suggestedHelpers: array of helper names from: ["communication", "browser", "research", "scheduling", "media", "profile", "development"]

Rules:
- "action" = user wants something done (build, create, send, configure)
- "question" = user asks for information or explanation
- "scheduling" = user wants something timed, recurring, or deferred
- "research" = user wants investigation, comparison, or deep analysis
- "communication" = user wants to send messages or interact with contacts
- "development" = user wants software/code/website built
- Select 1-3 most relevant helpers
- Return ONLY the JSON object, no explanation.`;

        try {
            const response = await this.llm.call(
                `Classify this task: "${taskDescription}"`,
                systemPrompt
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { intent: 'unknown', confidence: 0, suggestedHelpers: ['communication'] };
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const validIntents = ['action', 'question', 'scheduling', 'research', 'communication', 'development', 'unknown'];
            const validHelpers = ['communication', 'browser', 'research', 'scheduling', 'media', 'profile', 'development'];

            const result: ClassifiedIntent = {
                intent: validIntents.includes(parsed.intent) ? parsed.intent : 'unknown',
                confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
                suggestedHelpers: Array.isArray(parsed.suggestedHelpers)
                    ? parsed.suggestedHelpers.filter((h: string) => validHelpers.includes(h)).slice(0, 3)
                    : ['communication']
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            logger.warn(`LLMParser: classifyIntent failed: ${error}`);
            return { intent: 'unknown', confidence: 0, suggestedHelpers: ['communication'] };
        }
    }

    /**
     * Normalize messy tool metadata using an LLM.
     * Handles cases where the LLM uses non-standard field names that
     * don't match our hardcoded normalization map.
     */
    public async normalizeMetadata(
        toolName: string,
        rawMetadata: Record<string, any>,
        expectedFields: string[]
    ): Promise<Record<string, any>> {
        const cacheKey = `meta:${toolName}:${JSON.stringify(rawMetadata).slice(0, 150)}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached as Record<string, any>;

        const systemPrompt = `You are a field normalizer. Given a tool name, its raw metadata, and the expected field names, map the raw fields to the expected fields.

Return ONLY a JSON object with the normalized fields. Preserve values exactly — only rename keys. If a field cannot be mapped, keep it with its original name.`;

        try {
            const response = await this.llm.call(
                `Tool: "${toolName}"\nRaw metadata: ${JSON.stringify(rawMetadata)}\nExpected fields: ${JSON.stringify(expectedFields)}\n\nNormalize the field names.`,
                systemPrompt
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return rawMetadata;

            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof parsed !== 'object' || parsed === null) return rawMetadata;

            this.setCache(cacheKey, parsed);
            return parsed;
        } catch (error) {
            logger.debug(`LLMParser: normalizeMetadata failed, using original: ${error}`);
            return rawMetadata;
        }
    }

    // --- Cache helpers ---

    private getFromCache(key: string): any | null {
        const entry = this.cache.get(key);
        if (entry && (Date.now() - entry.timestamp) < LLMParser.CACHE_TTL_MS) {
            return entry.result;
        }
        if (entry) this.cache.delete(key);
        return null;
    }

    private setCache(key: string, result: any): void {
        // Evict stale entries if over limit
        if (this.cache.size >= LLMParser.CACHE_MAX_SIZE) {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.timestamp > LLMParser.CACHE_TTL_MS) {
                    this.cache.delete(k);
                }
            }
            // If still over limit, delete oldest
            if (this.cache.size >= LLMParser.CACHE_MAX_SIZE) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, { result, timestamp: Date.now() });
    }
}
