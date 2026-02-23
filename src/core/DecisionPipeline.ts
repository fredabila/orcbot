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
    allowedTools?: string[];
    taskDescription?: string;
    fileIntent?: 'requested' | 'not_requested' | 'unknown';
}

class LastMessageCache {
    private cache: Map<string, string[]> = new Map();
    constructor(private windowSize: number, private config: ConfigManager) { }

    private normalize(message: string) {
        return message.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    /**
     * Extract semantic fingerprint from a message for similarity matching.
     * Strips common phrases and focuses on key content words.
     */
    private getSemanticFingerprint(message: string): string {
        const normalized = this.normalize(message);
        // Remove common filler phrases that vary between similar messages
        const stripped = normalized
            .replace(/excellent,?\s*(frederick!?)?/gi, '')
            .replace(/hey\s*(frederick!?)?/gi, '')
            .replace(/alright,?\s*(frederick!?)?/gi, '')
            .replace(/i'm now/gi, '')
            .replace(/i've (now|just)/gi, '')
            .replace(/right away!?/gi, '')
            .replace(/they'll (start|be) working/gi, 'working')
            .replace(/they're getting to work/gi, 'working')
            .replace(/start working on/gi, 'working')
            .replace(/on (it|them|your)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        return stripped;
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

    /**
     * Check if message is semantically similar to a recent message.
     * Uses fingerprinting to detect messages that are essentially the same
     * but with minor word variations.
     */
    public isSemanticallyDuplicate(channelKey: string, message: string): boolean {
        if (!message) return false;
        const fingerprint = this.getSemanticFingerprint(message);
        if (fingerprint.length < 20) return false; // Too short to compare meaningfully
        
        const threshold = this.config.get('messageSimilarityThreshold') || 0.7;
        const history = this.cache.get(channelKey) || [];
        for (const prev of history.slice(-5)) { // Check last 5 messages
            const prevFingerprint = this.getSemanticFingerprint(prev);
            // Check for high similarity (common substring)
            if (this.stringSimilarity(fingerprint, prevFingerprint) > threshold) {
                return true;
            }
        }
        return false;
    }

    private stringSimilarity(a: string, b: string): number {
        if (a === b) return 1;
        if (a.length === 0 || b.length === 0) return 0;
        
        // Simple word overlap similarity
        const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
        const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
        
        if (wordsA.size === 0 || wordsB.size === 0) return 0;
        
        let overlap = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) overlap++;
        }
        
        return overlap / Math.max(wordsA.size, wordsB.size);
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
        this.messageCache = new LastMessageCache(dedupWindow, this.config);
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
        if (!ctx.recentMemories) return false;

        const memories = ctx.recentMemories || [];
        const actionPrefix = `${ctx.actionId}-step-`;
        const actionMemories = memories
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool)
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return ta - tb;
            });

    // If we have no recorded tool activity, do not assume there is new information.
    if (actionMemories.length === 0) return false;

        let lastSendIndex = -1;
        for (let i = actionMemories.length - 1; i >= 0; i--) {
            const tool = actionMemories[i].metadata?.tool;
            if (tool === 'send_telegram' || tool === 'send_whatsapp' || tool === 'send_discord' || tool === 'send_slack' || tool === 'send_gateway_chat') {
                lastSendIndex = i;
                break;
            }
        }

        if (lastSendIndex === -1) return true;

        for (let i = lastSendIndex + 1; i < actionMemories.length; i++) {
            const tool = actionMemories[i].metadata?.tool;
            if (tool && tool !== 'send_telegram' && tool !== 'send_whatsapp' && tool !== 'send_discord' && tool !== 'send_slack' && tool !== 'send_gateway_chat') {
                return true;
            }
        }

        return false;
    }

    private hasExplicitFileRequest(taskTextLower: string, recentMemories?: MemoryEntry[]): boolean {
        const fileRequestTerms = [
            'send file', 'send me the file', 'attach', 'attachment', 'upload', 'download',
            'screenshot', 'screen shot', 'photo', 'picture', 'image', 'png', 'jpg', 'jpeg',
            'pdf', 'doc', 'document', 'report', 'csv', 'excel', 'spreadsheet',
            'audio', 'voice note', 'voice memo', 'recording', 'mp3', 'wav',
            'share the file', 'deliver the file', 'send it as a file'
        ];

        if (fileRequestTerms.some(k => taskTextLower.includes(k))) return true;

        // Also inspect the most recent inbound user memories for explicit file request language.
        const recentText = (recentMemories || [])
            .slice(-20)
            .map(m => (m.content || '').toString().toLowerCase())
            .join('\n');

        return fileRequestTerms.some(k => recentText.includes(k));
    }

    public evaluate(proposed: StandardResponse, ctx: PipelineContext): StandardResponse {
        const result: StandardResponse = {
            ...proposed,
            tools: proposed.tools ? [...proposed.tools] : []
        };

        const notes: string[] = [];
        const dropped: string[] = [];

        // Step budget guardrail
        const configuredMaxSteps = Number(this.config.get('maxStepsPerAction') || 0);
        const applySafetyFloor = ctx.lane === 'user';
        const maxSteps = configuredMaxSteps > 0
            ? (applySafetyFloor ? Math.max(6, configuredMaxSteps) : configuredMaxSteps)
            : 0;
        if (maxSteps > 0 && ctx.currentStep > maxSteps) {
            result.tools = [];
            result.verification = {
                goals_met: true,
                analysis: `Max steps reached (${ctx.currentStep}/${maxSteps}). Pipeline terminated action to prevent loops.${applySafetyFloor && configuredMaxSteps > 0 && configuredMaxSteps < 6 ? ' (Applied minimum safety floor of 6 steps for user lane.)' : ''}`
            };
            notes.push('Terminated due to max step budget');
            this.attachNotes(result, notes, dropped);
            return result;
        }

        // Plan sanity
        if (!ctx.executionPlan || ctx.executionPlan.trim().length === 0) {
            notes.push('No execution plan provided; using cautious mode');
        }

        // Drop unknown tools (not in allowed list)
        const allowedTools = new Set((ctx.allowedTools || []).map(t => t.toLowerCase()));
        if (allowedTools.size > 0) {
            result.tools = (result.tools || []).filter(t => {
                const ok = allowedTools.has((t.name || '').toLowerCase());
                if (!ok) {
                    dropped.push(`unknown:${t.name}`);
                    notes.push(`Suppressed unknown tool: ${t.name}`);
                }
                return ok;
            });
        }

        // Skill routing rules (intent-based preferences)
        const routingRules = (this.config.get('skillRoutingRules') || []) as Array<{
            match: string;
            prefer?: string[];
            avoid?: string[];
            requirePreferred?: boolean;
        }>;
        const taskText = (ctx.taskDescription || '').toString();
        const taskTextLower = taskText.toLowerCase();
        const enforceExplicitFileRequestForSendFile = this.config.get('enforceExplicitFileRequestForSendFile') === true;
        const userExplicitlyAskedForFile =
            ctx.fileIntent === 'requested'
                ? true
                : ctx.fileIntent === 'not_requested'
                    ? false
                    : this.hasExplicitFileRequest(taskTextLower, ctx.recentMemories);
        if (taskText && routingRules.length > 0 && (result.tools || []).length > 0) {
            for (const rule of routingRules) {
                if (!rule?.match) continue;
                let regex: RegExp | null = null;
                try {
                    regex = new RegExp(rule.match, 'i');
                } catch {
                    notes.push(`Invalid routing rule regex: ${rule.match}`);
                }
                if (!regex || !regex.test(taskText)) continue;

                const prefer = (rule.prefer || []).map(s => s.toLowerCase());
                const avoid = (rule.avoid || []).map(s => s.toLowerCase());
                const toolsLower = (result.tools || []).map(t => (t.name || '').toLowerCase());

                const hasPreferred = prefer.length > 0 && toolsLower.some(t => prefer.includes(t));
                if (hasPreferred && rule.requirePreferred) {
                    result.tools = (result.tools || []).filter(t => prefer.includes((t.name || '').toLowerCase()));
                    notes.push(`Applied routing rule: requirePreferred (${rule.match})`);
                }

                if (avoid.length > 0) {
                    const beforeCount = (result.tools || []).length;
                    result.tools = (result.tools || []).filter(t => !avoid.includes((t.name || '').toLowerCase()));
                    const removed = beforeCount - (result.tools || []).length;
                    if (removed > 0) notes.push(`Applied routing rule: avoid (${rule.match})`);
                }
            }
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

        // Autopilot no-questions: suppress request_supporting_data when allowed
        const autopilotNoQuestions = !!this.config.get('autopilotNoQuestions');
        if (autopilotNoQuestions && uniqueTools.length > 1) {
            const allowPatterns = (this.config.get('autopilotNoQuestionsAllow') || []) as string[];
            const denyPatterns = (this.config.get('autopilotNoQuestionsDeny') || []) as string[];
            const allow = allowPatterns.length === 0 || allowPatterns.some(p => {
                try { return new RegExp(p, 'i').test(taskText); } catch { return false; }
            });
            const deny = denyPatterns.some(p => {
                try { return new RegExp(p, 'i').test(taskText); } catch { return false; }
            });

            if (allow && !deny) {
                const filtered = uniqueTools.filter(t => (t.name || '').toLowerCase() !== 'request_supporting_data');
                if (filtered.length !== uniqueTools.length) {
                    uniqueTools.length = 0;
                    uniqueTools.push(...filtered);
                    notes.push('Autopilot: suppressed request_supporting_data');
                }
            }
        }

        // Guardrail: prevent repeated identical web_search queries in the same action
        const actionPrefix = `${ctx.actionId}-step-`;
        const recentSearches = (ctx.recentMemories || [])
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool === 'web_search')
            .map(m => (m.metadata?.input?.query || m.metadata?.input?.q || m.metadata?.input?.text || '').toString().trim().toLowerCase())
            .filter(Boolean);
        const searchCounts = new Map<string, number>();
        for (const q of recentSearches) searchCounts.set(q, (searchCounts.get(q) || 0) + 1);

        // Guardrail: prevent repeated browser loops on the same action context
        const recentActionToolMemories = (ctx.recentMemories || [])
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool);

        const browserNavigateCounts = new Map<string, number>();
        const browserToolCounts = new Map<string, number>();
        let hasBrowserNavigate = false;
        let hasBrowserInspect = false;
        let hasBrowserExtract = false;
        let hasAnyTextDelivery = false;
        for (const m of recentActionToolMemories) {
            const toolName = (m.metadata?.tool || '').toString().toLowerCase();
            if (!toolName) continue;
            browserToolCounts.set(toolName, (browserToolCounts.get(toolName) || 0) + 1);

            if (toolName === 'browser_navigate') hasBrowserNavigate = true;
            if (toolName === 'browser_examine_page' || toolName === 'browser_screenshot' || toolName === 'browser_vision') hasBrowserInspect = true;
            if (toolName === 'browser_extract_content' || toolName === 'browser_extract_data' || toolName === 'web_search' || toolName === 'http_fetch') hasBrowserExtract = true;
            if (toolName === 'send_telegram' || toolName === 'send_whatsapp' || toolName === 'send_discord' || toolName === 'send_slack' || toolName === 'send_gateway_chat') {
                hasAnyTextDelivery = true;
            }

            if (toolName === 'browser_navigate') {
                const input = m.metadata?.input || {};
                const rawUrl = (input.url || input.link || input.site || '').toString().trim().toLowerCase();
                if (rawUrl) {
                    const normalizedUrl = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
                    browserNavigateCounts.set(normalizedUrl, (browserNavigateCounts.get(normalizedUrl) || 0) + 1);
                }
            }
        }

        // Guardrail: prevent duplicate generate_image calls in the same action
        // If an image was already generated in this action, block subsequent generate_image calls
        const imageAlreadyGenerated = (ctx.recentMemories || []).some(
            m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.imageGenerated === true
        );

        // Guardrail: prevent repeated distribute_tasks / orchestrator_status calls in same action
        const orchestrationToolCalls = (ctx.recentMemories || [])
            .filter(m => m.id && m.id.startsWith(actionPrefix) && m.metadata?.tool)
            .map(m => m.metadata?.tool);
        const orchestrationCallCounts = new Map<string, number>();
        for (const t of orchestrationToolCalls) {
            if (t) orchestrationCallCounts.set(t, (orchestrationCallCounts.get(t) || 0) + 1);
        }

        // Message budget and duplicate suppression
        const maxMessages = this.config.get('maxMessagesPerAction') || 0;
        let allowedMessages = 0;
        const filteredTools: ToolCall[] = [];

        // Answer-first guardrail: if classifier says file is NOT requested,
        // don't allow file-only delivery in place of an actual text answer.
        const hasAnyTextSend = uniqueTools.some(t => {
            const n = (t.name || '').toLowerCase().trim();
            return n === 'send_telegram' || n === 'send_whatsapp' || n === 'send_discord' || n === 'send_slack' || n === 'send_gateway_chat';
        });
        const hasAnyFileSend = uniqueTools.some(t => (t.name || '').toLowerCase().trim() === 'send_file');
        const suppressFileOnlyByIntent = ctx.fileIntent === 'not_requested' && hasAnyFileSend && !hasAnyTextSend;

        const maxToolLoops = this.config.get('maxToolLoops') || 3;

        for (const tool of uniqueTools) {
            const toolName = (tool.name || '').toLowerCase().trim();
            if (toolName === 'send_file' && suppressFileOnlyByIntent) {
                dropped.push(`answer-first:${tool.name}`);
                notes.push('Suppressed send_file: answer-first policy requires text reply when user did not request a file');
                continue;
            }

            if (enforceExplicitFileRequestForSendFile && toolName === 'send_file' && !userExplicitlyAskedForFile) {
                dropped.push(`unsolicited-file:${tool.name}`);
                notes.push('Suppressed send_file: user did not ask for an attachment/file delivery');
                continue;
            }

            if (toolName === 'web_search') {
                const q = (tool.metadata?.query || tool.metadata?.q || tool.metadata?.text || '').toString().trim().toLowerCase();
                if (q && (searchCounts.get(q) || 0) >= (maxToolLoops - 1)) {
                    dropped.push(`search-loop:${tool.name}`);
                    notes.push('Suppressed web_search: repeated query already attempted multiple times in this action');
                    continue;
                }
            }

            if (toolName === 'browser_navigate') {
                const rawUrl = (tool.metadata?.url || tool.metadata?.link || tool.metadata?.site || '').toString().trim().toLowerCase();
                const normalizedUrl = rawUrl ? rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
                if (normalizedUrl && (browserNavigateCounts.get(normalizedUrl) || 0) >= (maxToolLoops - 1)) {
                    dropped.push(`browser-nav-loop:${tool.name}`);
                    notes.push(`Suppressed browser_navigate: URL already visited multiple times in this action (${normalizedUrl})`);
                    continue;
                }

                // Phase guard: once we already navigated+inspected+extracted in this action,
                // block additional navigate loops and push toward final response.
                if (hasBrowserNavigate && hasBrowserInspect && hasBrowserExtract && !hasAnyTextDelivery) {
                    dropped.push(`browser-phase-loop:${tool.name}`);
                    notes.push('Suppressed browser_navigate: phase guard requires summarizing and replying instead of restarting navigation');
                    continue;
                }
            }

            if ((toolName === 'browser_examine_page' || toolName === 'browser_screenshot' || toolName === 'browser_vision')
                && (browserToolCounts.get(toolName) || 0) >= maxToolLoops) {
                dropped.push(`browser-inspect-loop:${tool.name}`);
                notes.push(`Suppressed ${tool.name}: repeated browser inspection without progress`);
                continue;
            }

            // Suppress orchestration tools that have been called too many times (loop prevention)
            const orchestrationLoopTools = ['distribute_tasks', 'orchestrator_status', 'list_agents', 'get_agent_messages'];
            if (orchestrationLoopTools.includes(toolName)) {
                const callCount = orchestrationCallCounts.get(toolName) || 0;
                if (callCount >= (maxToolLoops - 1)) {
                    dropped.push(`orch-loop:${tool.name}`);
                    notes.push(`Suppressed ${tool.name}: called ${callCount} times already - likely loop`);
                    continue;
                }
            }

            // Suppress duplicate generate_image/send_image calls when an image was already generated in this action
            if ((toolName === 'generate_image' || toolName === 'send_image') && imageAlreadyGenerated) {
                dropped.push(`image-dedup:${tool.name}`);
                notes.push(`Suppressed ${tool.name}: image already generated in this action — use send_file to deliver existing image`);
                continue;
            }

            const isSend = toolName === 'send_telegram' || toolName === 'send_whatsapp' || toolName === 'send_discord' || toolName === 'send_slack' || toolName === 'send_gateway_chat';
            if (!isSend) {
                filteredTools.push(tool);
                continue;
            }

            const message = String(tool.metadata?.message || tool.metadata?.text || '').trim();

            // Deduplicate per destination+channel tool, not per originating action source.
            // This ensures (1) Telegram and WhatsApp can send the same text without suppressing each other,
            // and (2) duplicates are evaluated in the correct channel/thread.
            let destination = '';
            if (toolName === 'send_telegram') {
                destination = String(tool.metadata?.chatId || tool.metadata?.chat_id || tool.metadata?.id || ctx.sourceId || '');
            } else if (toolName === 'send_whatsapp') {
                destination = String(tool.metadata?.jid || tool.metadata?.to || tool.metadata?.id || ctx.sourceId || '');
            } else if (toolName === 'send_discord') {
                destination = String(tool.metadata?.channel_id || tool.metadata?.channelId || tool.metadata?.to || tool.metadata?.id || ctx.sourceId || '');
            } else if (toolName === 'send_slack') {
                destination = String(tool.metadata?.channel_id || tool.metadata?.channelId || tool.metadata?.to || tool.metadata?.id || ctx.sourceId || '');
            } else if (toolName === 'send_gateway_chat') {
                destination = String(tool.metadata?.chatId || tool.metadata?.chat_id || tool.metadata?.id || ctx.sourceId || '');
            }

            const channelKey = `${tool.name}:${destination || 'anon'}`;

            if (maxMessages > 0 && (ctx.messagesSent + allowedMessages) >= maxMessages) {
                dropped.push(`limit:${tool.name}`);
                notes.push(`Suppressed send: message cap ${maxMessages} reached`);
                continue;
            }

            const isImmediateDuplicate = this.messageCache.isImmediateDuplicate(channelKey, message);
            const isSemanticallyDuplicate = this.messageCache.isSemanticallyDuplicate(channelKey, message);
            const isReassurance = this.isShortReassurance(message);
            const hasNewToolOutput = this.hasNonSendToolSinceLastSend(ctx);

            // CRITICAL: Never suppress the FIRST message of an action.
            // The user sent a message and deserves a reply. Cross-action semantic
            // similarity is expected (similar reassurances like "on it" / "working on it").
            const isFirstMessageInAction = ctx.messagesSent === 0 && allowedMessages === 0;

            // Block semantically duplicate messages (e.g., "I'm distributing tasks" repeated with slight variations)
            // BUT only within the same action — the first reply to a NEW user message must always go through.
            if (isSemanticallyDuplicate && !hasNewToolOutput && !isFirstMessageInAction) {
                dropped.push(`semantic-dupe:${tool.name}`);
                notes.push('Suppressed send: semantically similar to recent message');
                continue;
            }

            if (isImmediateDuplicate && !hasNewToolOutput && !isFirstMessageInAction) {
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

        // If we dropped all proposed tools, decide whether to force-terminate or just warn
        if ((proposed.tools?.length || 0) > 0 && (filteredTools.length === 0)) {
            const sendToolNames = ['send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat'];
            const allDroppedWereSends = proposed.tools!.every(t => sendToolNames.includes(t.name));

            if (allDroppedWereSends && ctx.messagesSent > 0) {
                // Agent already sent a message AND all subsequent sends were suppressed as dupes.
                // This is NOT a failure — the task is done. Force goals_met=true to prevent loops.
                notes.push('All subsequent sends suppressed — message already delivered. Marking task complete.');
                result.verification = result.verification || { goals_met: false, analysis: '' };
                result.verification.goals_met = true;
                result.verification.analysis = 'Message already delivered successfully. Subsequent duplicate sends suppressed by pipeline.';
            } else {
                notes.push('All proposed tools were suppressed by the pipeline');
                result.verification = result.verification || { goals_met: false, analysis: '' };
                result.verification.analysis = `${result.verification.analysis || ''} Pipeline suppressed unsafe/duplicate actions.`.trim();
            }
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
