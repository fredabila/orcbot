import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../utils/logger';
import { StandardResponse, ToolCall } from './ParserLayer';
import { MemoryEntry } from '../memory/MemoryManager';

export interface PipelineContext {
    actionId: string;
    source?: string;
    sourceId?: string;
    messagesSent: number;
    currentStep: number;
    executionPlan?: string;
    lane?: 'user' | 'autonomy';
    recentMemories?: MemoryEntry[];
}

class LastMessageCache {
    private cache: Map<string, string[]> = new Map();
    constructor(private windowSize: number) { }

    private normalize(message: string) {
        return message.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    public isDuplicate(channelKey: string, message: string): boolean {
        if (!message) return false;
        const normalized = this.normalize(message);
        const history = this.cache.get(channelKey) || [];
        return history.includes(normalized);
    }

    public isImmediateDuplicate(channelKey: string, message: string): boolean {
        if (!message) return false;
        const normalized = this.normalize(message);
        const history = this.cache.get(channelKey) || [];
        if (history.length === 0) return false;
        return history[history.length - 1] === normalized;
    }

    public record(channelKey: string, message: string) {
        if (!message) return;
        const normalized = this.normalize(message);
        const history = this.cache.get(channelKey) || [];
        history.push(normalized);
        while (history.length > this.windowSize) history.shift();
        this.cache.set(channelKey, history);
    }
}

export class DecisionPipeline {
    private messageCache: LastMessageCache;
    private reassuranceAllowance: Map<string, number> = new Map();

    constructor(private config: ConfigManager) {
        const dedupWindow = this.config.get('messageDedupWindow') || 10;
        this.messageCache = new LastMessageCache(dedupWindow);
    }

    private isShortReassurance(message: string): boolean {
        const normalized = message.trim().toLowerCase();
        if (normalized.length === 0 || normalized.length > 160) return false;
        const phrases = [
            'got it',
            'on it',
            'working on it',
            'checking',
            'looking into',
            'one moment',
            'hang tight',
            'be right back',
            'still working',
            'sorry',
            'apologies',
            'not ignoring',
            'thanks for the ping',
            'just a sec',
            'give me a moment'
        ];
        return phrases.some(p => normalized.includes(p));
    }

    private canUseReassurance(actionId: string): boolean {
        const used = this.reassuranceAllowance.get(actionId) || 0;
        return used < 1;
    }

    private markReassuranceUsed(actionId: string) {
        const used = this.reassuranceAllowance.get(actionId) || 0;
        this.reassuranceAllowance.set(actionId, used + 1);
    }

    private hasNonSendToolSinceLastSend(ctx: PipelineContext): boolean {
        const memories = ctx.recentMemories || [];
        const actionPrefix = `${ctx.actionId}-step-`;
        const actionMemories = memories
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool)
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return ta - tb;
            });

        if (actionMemories.length === 0) return true;

        let lastSendIndex = -1;
        for (let i = actionMemories.length - 1; i >= 0; i--) {
            const tool = actionMemories[i].metadata?.tool;
            if (tool === 'send_telegram' || tool === 'send_whatsapp') {
                lastSendIndex = i;
                break;
            }
        }

        if (lastSendIndex === -1) return true;

        for (let i = lastSendIndex + 1; i < actionMemories.length; i++) {
            const tool = actionMemories[i].metadata?.tool;
            if (tool && tool !== 'send_telegram' && tool !== 'send_whatsapp') {
                return true;
            }
        }

        return false;
    }

    public evaluate(proposed: StandardResponse, ctx: PipelineContext): StandardResponse {
        const result: StandardResponse = {
            ...proposed,
            tools: proposed.tools ? [...proposed.tools] : []
        };

        const notes: string[] = [];
        const dropped: string[] = [];

        // Step budget guardrail
        const maxSteps = this.config.get('maxStepsPerAction') || 0;
        if (maxSteps > 0 && ctx.currentStep > maxSteps) {
            result.tools = [];
            result.verification = {
                goals_met: true,
                analysis: `Max steps reached (${ctx.currentStep}/${maxSteps}). Pipeline terminated action to prevent loops.`
            };
            notes.push('Terminated due to max step budget');
            this.attachNotes(result, notes, dropped);
            return result;
        }

        // Plan sanity
        if (!ctx.executionPlan || ctx.executionPlan.trim().length === 0) {
            notes.push('No execution plan provided; using cautious mode');
        }

        // Deduplicate tool calls by signature
        const uniqueTools: ToolCall[] = [];
        const seenSignatures = new Set<string>();
        for (const t of result.tools || []) {
            const sig = `${t.name}:${JSON.stringify(t.metadata || {})}`;
            if (seenSignatures.has(sig)) {
                dropped.push(`dedup:${t.name}`);
                continue;
            }
            seenSignatures.add(sig);
            uniqueTools.push(t);
        }

        // Guardrail: prevent repeated identical web_search queries in the same action
        const actionPrefix = `${ctx.actionId}-step-`;
        const recentSearches = (ctx.recentMemories || [])
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool === 'web_search')
            .map(m => (m.metadata?.input?.query || m.metadata?.input?.q || m.metadata?.input?.text || '').toString().trim().toLowerCase())
            .filter(Boolean);
        const searchCounts = new Map<string, number>();
        for (const q of recentSearches) searchCounts.set(q, (searchCounts.get(q) || 0) + 1);

        // Message budget and duplicate suppression
        const maxMessages = this.config.get('maxMessagesPerAction') || 0;
        let allowedMessages = 0;
        const filteredTools: ToolCall[] = [];
        for (const tool of uniqueTools) {
            if (tool.name === 'web_search') {
                const q = (tool.metadata?.query || tool.metadata?.q || tool.metadata?.text || '').toString().trim().toLowerCase();
                if (q && (searchCounts.get(q) || 0) >= 2) {
                    dropped.push(`search-loop:${tool.name}`);
                    notes.push('Suppressed web_search: repeated query already attempted multiple times in this action');
                    continue;
                }
            }
            const isSend = tool.name === 'send_telegram' || tool.name === 'send_whatsapp';
            if (!isSend) {
                filteredTools.push(tool);
                continue;
            }

            const message = (tool.metadata?.message || tool.metadata?.text || '').trim();
            const channelKey = `${ctx.source || 'unknown'}:${ctx.sourceId || 'anon'}`;

            if (maxMessages > 0 && (ctx.messagesSent + allowedMessages) >= maxMessages) {
                dropped.push(`limit:${tool.name}`);
                notes.push(`Suppressed send: message cap ${maxMessages} reached`);
                continue;
            }

            const isImmediateDuplicate = this.messageCache.isImmediateDuplicate(channelKey, message);
            const isReassurance = this.isShortReassurance(message);
            const hasNewToolOutput = this.hasNonSendToolSinceLastSend(ctx);

            if (isImmediateDuplicate && !hasNewToolOutput) {
                if (isReassurance && this.canUseReassurance(ctx.actionId)) {
                    this.markReassuranceUsed(ctx.actionId);
                } else {
                    dropped.push(`dupe:${tool.name}`);
                    notes.push('Suppressed send: duplicate content without new tool output');
                    continue;
                }
            }

            filteredTools.push(tool);
            allowedMessages++;
            this.messageCache.record(channelKey, message);
        }

        result.tools = filteredTools;

        // If we dropped all messaging tools, hint termination to avoid loops
        if ((proposed.tools?.length || 0) > 0 && (filteredTools.length === 0)) {
            notes.push('All proposed tools were suppressed by the pipeline');
            result.verification = result.verification || { goals_met: false, analysis: '' };
            result.verification.analysis = `${result.verification.analysis || ''} Pipeline suppressed unsafe/duplicate actions.`.trim();
        }

        this.attachNotes(result, notes, dropped);
        return result;
    }

    private attachNotes(result: StandardResponse, notes: string[], dropped: string[]) {
        if (!result.metadata) result.metadata = {};
        result.metadata.pipelineNotes = {
            warnings: notes,
            dropped
        };
        if (notes.length > 0 || dropped.length > 0) {
            logger.info(`DecisionPipeline: ${notes.join('; ')} | dropped=${dropped.join(',')}`);
        }
    }
}
