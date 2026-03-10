import { Agent } from './Agent';
import { logger } from '../utils/logger';
import { resolveInboundRoute } from './InboundRouting';

export interface InboundMessage {
    source: string; // e.g., 'discord', 'telegram', 'whatsapp', 'slack', 'email'
    sourceId: string; // e.g., channelId, chatId, or sender JID
    userId?: string; // The ID of the specific user
    senderName?: string; // The display name of the user
    content: string; // The text content
    messageId: string; // Unique message ID
    replyContext?: string; // Context if this is a reply
    mediaPaths?: string[]; // Paths to downloaded media
    mediaAnalysis?: string; // Pre-computed vision analysis
    channelName?: string; // e.g., 'DM', 'general'
    isCommand?: boolean; // For explicit commands (e.g. /cmd)
    isMention?: boolean; // For mentions in group chats
    isExternal?: boolean; // For WhatsApp "someone else" logic
    isOwner?: boolean; // For self-chat / owner messages
    metadata?: Record<string, any>; // Extra channel-specific metadata
}

/**
 * Unified MessageBus
 * Acts as the central gateway for all inbound channel messages.
 * Normalizes memory saving, session resolution, auto-reply rules, and privacy filters.
 */
export class MessageBus {
    constructor(private agent: Agent) {}

    private async classifyFollowUpIntent(params: {
        source: string;
        sourceId: string;
        sessionScopeId: string;
        baseContent: string;
        replyContext?: string;
        metadata?: Record<string, any>;
    }): Promise<{
        shouldContinue: boolean;
        subtype?: 'permission' | 'status_check';
        repliedText?: string;
    }> {
        const { source, sourceId, sessionScopeId, baseContent, replyContext, metadata } = params;
        const { repliedUser, repliedText } = this.parseReplyContext(replyContext);
        const recentAssistantContext = this.getRecentAssistantThreadMessage(source, sourceId, sessionScopeId, metadata?.userId);
        const assistantText = repliedText || recentAssistantContext.text;

        if (!assistantText) {
            return { shouldContinue: false };
        }

        const directReplyToAgent = this.isReplyToAgent(repliedUser, metadata);
        const assistantMessageIsRecent = (() => {
            if (!recentAssistantContext.timestamp) return false;
            const ageMs = Date.now() - (Date.parse(recentAssistantContext.timestamp) || 0);
            return ageMs >= 0 && ageMs <= 30 * 60 * 1000;
        })();

        if (!directReplyToAgent && !assistantMessageIsRecent) {
            return { shouldContinue: false, repliedText: assistantText };
        }

        try {
            const llm = this.agent.llm;
            if (llm?.callFast) {
                const systemPrompt = 'You classify whether a new user message should resume previously promised work. Return strict compact JSON only: {"intent":"continue_pending_work|normal_reply","subtype":"permission|status_check|none","confidence":0-1}. Choose continue_pending_work when the assistant message clearly describes ongoing or promised substantive work and the user message is granting permission to proceed or asking for status on that pending work.';
                const userPrompt = `Channel: ${source}\nRecent assistant message: """${assistantText.slice(0, 500)}"""\nNew user message: """${String(baseContent || '').slice(0, 250)}"""\nDirect reply to agent message: ${directReplyToAgent ? 'yes' : 'no'}\nAssistant message recent: ${assistantMessageIsRecent ? 'yes' : 'no'}\n\nClassify whether the new message should be treated as CONTINUATION of the pending work instead of a normal conversational reply.`;
                const response = await llm.callFast(userPrompt, systemPrompt);
                const jsonMatch = String(response || '').match(/\{[\s\S]*\}/);
                const parsed = JSON.parse((jsonMatch ? jsonMatch[0] : response).trim());
                const intent = String(parsed?.intent || '').toLowerCase();
                const subtype = String(parsed?.subtype || 'none').toLowerCase();
                const confidence = Number(parsed?.confidence ?? 0);

                if (intent === 'continue_pending_work' && confidence >= 0.55) {
                    return {
                        shouldContinue: true,
                        subtype: subtype === 'status_check' ? 'status_check' : 'permission',
                        repliedText: assistantText
                    };
                }

                if (intent === 'normal_reply' && confidence >= 0.7) {
                    return {
                        shouldContinue: false,
                        repliedText: assistantText
                    };
                }
            }
        } catch (e) {
            logger.debug(`MessageBus: LLM follow-up intent classification failed, falling back to heuristics: ${e}`);
        }

        const permissionFallback = this.shouldTreatAsContinuationReply(source, sourceId, sessionScopeId, baseContent, replyContext, metadata);
        if (permissionFallback.shouldContinue) {
            return {
                shouldContinue: true,
                subtype: 'permission',
                repliedText: permissionFallback.repliedText
            };
        }

        const inquiryFallback = this.shouldTreatAsContinuationStatusInquiry(source, sourceId, sessionScopeId, baseContent, replyContext, metadata);
        if (inquiryFallback.shouldContinue) {
            return {
                shouldContinue: true,
                subtype: 'status_check',
                repliedText: inquiryFallback.repliedText
            };
        }

        return {
            shouldContinue: false,
            repliedText: assistantText
        };
    }

    private getRecentAssistantThreadMessage(
        source: string,
        sourceId: string,
        sessionScopeId: string,
        userId?: string
    ): { text?: string; timestamp?: string } {
        const searchMemory = this.agent.memory?.searchMemory;
        const shortAll = typeof searchMemory === 'function' ? searchMemory.call(this.agent.memory, 'short') : [];
        const normalizedSource = String(source || '').toLowerCase();
        const telegramChatId = normalizedSource === 'telegram' ? sourceId : undefined;
        const telegramUserId = normalizedSource === 'telegram' ? userId : undefined;

        const candidates = shortAll
            .filter(memory => {
                const md: any = memory.metadata || {};
                if (String(md.role || '').toLowerCase() !== 'assistant') return false;
                if (String(md.source || '').toLowerCase() !== normalizedSource) return false;

                if (md.sessionScopeId?.toString() === sessionScopeId.toString()) return true;

                if (normalizedSource === 'telegram') {
                    return telegramChatId != null && md.chatId?.toString() === telegramChatId.toString();
                }

                if (normalizedSource === 'whatsapp') {
                    return sourceId != null && (
                        md.senderId?.toString() === sourceId.toString() ||
                        md.sourceId?.toString() === sourceId.toString() ||
                        md.chatId?.toString() === sourceId.toString()
                    );
                }

                if (normalizedSource === 'discord' || normalizedSource === 'slack') {
                    return sourceId != null && (
                        md.channelId?.toString() === sourceId.toString() ||
                        md.sourceId?.toString() === sourceId.toString()
                    );
                }

                if (normalizedSource === 'gateway-chat') {
                    return sourceId != null && (
                        md.chatId?.toString() === sourceId.toString() ||
                        md.sourceId?.toString() === sourceId.toString()
                    );
                }

                if (telegramUserId != null && md.userId?.toString() === telegramUserId.toString()) {
                    return true;
                }

                return false;
            })
            .sort((a, b) => {
                const ta = a.timestamp ? Date.parse(a.timestamp) || 0 : 0;
                const tb = b.timestamp ? Date.parse(b.timestamp) || 0 : 0;
                return tb - ta;
            });

        const latest = candidates[0];
        if (!latest) return {};

        const rawContent = String(latest.content || '');
        const extractedText = rawContent.replace(/^Assistant sent [^:]+:\s*/i, '').trim();
        return {
            text: extractedText || rawContent,
            timestamp: latest.timestamp
        };
    }

    private parseReplyContext(replyContext?: string): { repliedUser?: string; repliedText?: string } {
        if (!replyContext) return {};

        const match = replyContext.match(/^\[Replying to (.+?)'s message: ["“](.*)["”]\]$/);
        if (!match) return {};

        return {
            repliedUser: match[1]?.trim(),
            repliedText: match[2]?.trim()
        };
    }

    private isReplyToAgent(repliedUser?: string, metadata?: Record<string, any>): boolean {
        if (metadata?.replyToIsBot === true) return true;

        const normalizedUser = String(repliedUser || '').trim().toLowerCase();
        const normalizedAgentName = String(this.agent.config.get('agentName') || 'orcbot').trim().toLowerCase();

        if (!normalizedUser) return false;
        if (normalizedUser === normalizedAgentName) return true;
        if (normalizedUser.includes(normalizedAgentName) || normalizedAgentName.includes(normalizedUser)) return true;
        return /\b(orcbot|assistant|bot)\b/i.test(normalizedUser);
    }

    private shouldTreatAsContinuationReply(
        source: string,
        sourceId: string,
        sessionScopeId: string,
        baseContent: string,
        replyContext?: string,
        metadata?: Record<string, any>
    ): { shouldContinue: boolean; repliedText?: string } {
        const { repliedUser, repliedText } = this.parseReplyContext(replyContext);
        const normalizedBase = String(baseContent || '').trim().toLowerCase();
        const directReplyToAgent = this.isReplyToAgent(repliedUser, metadata);
        const recentAssistantContext = this.getRecentAssistantThreadMessage(source, sourceId, sessionScopeId, metadata?.userId);
        const normalizedReplyText = String(repliedText || recentAssistantContext.text || '').trim().toLowerCase();

        const shortContinuationReply = /^(i don't care|i dont care|idc|whatever|either|your call|up to you|you choose|choose|decide|do whatever|any is fine|fine|ok|okay|k|sure|go ahead|proceed|continue|default is fine|pick one)$/i.test(normalizedBase);
        const priorMessageSignalsPendingWork = /(i('| wi)ll|let me|going to|default to|proceed|continue|resume|work on|build|finish|deliver|send|handle|check|look up|do that|take care of|next)/i.test(normalizedReplyText);
        const assistantMessageIsRecent = (() => {
            if (!recentAssistantContext.timestamp) return false;
            const ageMs = Date.now() - (Date.parse(recentAssistantContext.timestamp) || 0);
            return ageMs >= 0 && ageMs <= 15 * 60 * 1000;
        })();

        const inferredReplyToAgent = directReplyToAgent || (assistantMessageIsRecent && priorMessageSignalsPendingWork);

        return {
            shouldContinue: shortContinuationReply && inferredReplyToAgent && priorMessageSignalsPendingWork,
            repliedText: repliedText || recentAssistantContext.text
        };
    }

    private shouldTreatAsContinuationStatusInquiry(
        source: string,
        sourceId: string,
        sessionScopeId: string,
        baseContent: string,
        replyContext?: string,
        metadata?: Record<string, any>
    ): { shouldContinue: boolean; repliedText?: string } {
        const { repliedUser, repliedText } = this.parseReplyContext(replyContext);
        const normalizedBase = String(baseContent || '').trim().toLowerCase();
        const directReplyToAgent = this.isReplyToAgent(repliedUser, metadata);
        const recentAssistantContext = this.getRecentAssistantThreadMessage(source, sourceId, sessionScopeId, metadata?.userId);
        const normalizedAssistantText = String(repliedText || recentAssistantContext.text || '').trim().toLowerCase();

        const isStatusInquiry = /\b(have you started|did you start|started yet|have you begun|did you begin|are you working on it|are you still working|any update|what('?s| is) the update|what('?s| is) the status|status\??|progress\??|how far along|how is it going|how('?s| is) it going|are you done|is it ready|finished yet|done yet|ready yet)\b/i.test(normalizedBase);
        const priorMessageSignalsPendingWork = /(i('| wi)ll|let me|going to|default to|proceed|continue|resume|working on|setting up|build|finish|deliver|send|handle|check|look up|draft link|once .* up|after that|next)/i.test(normalizedAssistantText);
        const assistantMessageIsRecent = (() => {
            if (!recentAssistantContext.timestamp) return false;
            const ageMs = Date.now() - (Date.parse(recentAssistantContext.timestamp) || 0);
            return ageMs >= 0 && ageMs <= 30 * 60 * 1000;
        })();

        const inferredReplyToAgent = directReplyToAgent || (assistantMessageIsRecent && priorMessageSignalsPendingWork);

        return {
            shouldContinue: isStatusInquiry && inferredReplyToAgent && priorMessageSignalsPendingWork,
            repliedText: repliedText || recentAssistantContext.text
        };
    }

    private isLikelySubstantiveInboundTask(
        msg: InboundMessage,
        continuationReply: { shouldContinue: boolean },
        continuationInquiry?: { shouldContinue: boolean }
    ): boolean {
        if (continuationReply.shouldContinue || continuationInquiry?.shouldContinue) return true;
        if ((msg.mediaPaths || []).length > 0) return true;
        if (msg.mediaAnalysis && msg.mediaAnalysis.trim().length > 0) return true;

        const normalized = String(msg.content || '').trim().toLowerCase();
        if (!normalized) return false;

        if (/^(hi|hey|hello|yo|sup|lol|ok|okay|k|kk|thanks|thank you|ty|cool|nice|great|bye|gn|gm|👍|🙏|❤️)$/i.test(normalized)) {
            return false;
        }

        if (normalized.length >= 40) return true;
        if (/[?]/.test(normalized)) return true;
        if (/https?:\/\//i.test(normalized)) return true;
        if (/```|\{[^\n]{3,}\}|\[[^\n]{3,}\]|\b[A-Z_]{3,}\b/.test(String(msg.content || ''))) return true;
        if (/\b(can you|could you|please|check|look up|build|fix|search|find|update|continue|proceed|resume|send|write|make|create|run|install|debug|investigate|review|analyze|help me)\b/i.test(normalized)) return true;

        return false;
    }

    public async dispatch(msg: InboundMessage): Promise<void> {
        // 1. Resolve Session Scope
        const sessionScopeId = this.agent.resolveSessionScopeId(msg.source, {
            sourceId: msg.sourceId,
            userId: msg.userId,
            chatId: msg.sourceId
        });
        const routingDecision = resolveInboundRoute(this.agent.actionQueue.getQueue(), {
            source: msg.source,
            sourceId: msg.sourceId,
            sessionScopeId,
            messageId: msg.messageId
        });

        // 2. Normalize Content & Log
        const sender = msg.senderName || msg.userId || 'Unknown';
        const channelStr = msg.channelName && msg.channelName !== 'DM' ? ` in ${msg.channelName}` : '';
        const baseContent = msg.content || '[Media]';
        
        let memoryContent = `${msg.source} message from ${sender}${channelStr}: "${baseContent}"`;
        if (msg.replyContext) memoryContent += ` ${msg.replyContext}`;
        if (msg.mediaPaths && msg.mediaPaths.length > 0) {
            memoryContent += ` (Files: ${msg.mediaPaths.join(', ')})`;
        }
        if (msg.mediaAnalysis) memoryContent += ` [Media analysis: ${msg.mediaAnalysis}]`;

        logger.info(`MessageBus [${msg.source.toUpperCase()}]: ${sender} -> ${baseContent.substring(0, 100)}${baseContent.length > 100 ? '...' : ''}`);

        // 3. Save Memory
        this.agent.memory.saveMemory({
            id: `${msg.source}-${msg.messageId}`,
            type: 'short',
            content: memoryContent,
            timestamp: new Date().toISOString(),
            metadata: {
                source: msg.source,
                role: 'user',
                sessionScopeId,
                channelId: msg.sourceId,
                userId: msg.userId,
                senderName: msg.senderName,
                messageId: msg.messageId,
                inboundRoute: routingDecision.route,
                inboundRouteTargetActionId: routingDecision.waitingActionId || routingDecision.activeActionId,
                ...msg.metadata
            }
        });

        // 4. Auto-Reply & Privacy Check
        // Explicit commands usually bypass auto-reply disable
        const followUpIntent = await this.classifyFollowUpIntent({
            source: msg.source,
            sourceId: msg.sourceId,
            sessionScopeId,
            baseContent,
            replyContext: msg.replyContext,
            metadata: msg.metadata
        });
        const continuationReply = { shouldContinue: followUpIntent.shouldContinue && followUpIntent.subtype !== 'status_check' };
        const continuationInquiry = { shouldContinue: followUpIntent.shouldContinue && followUpIntent.subtype === 'status_check' };
        const substantiveInboundTask = this.isLikelySubstantiveInboundTask(msg, continuationReply, continuationInquiry);
        const autoReplyEnabled = this.agent.config.get(`${msg.source}AutoReplyEnabled`) ?? true;
        const replyTemporarilySuppressed = msg.metadata?.suppressReply === true;

        if ((!autoReplyEnabled || (replyTemporarilySuppressed && !substantiveInboundTask)) && !msg.isCommand) {
            const reason = !autoReplyEnabled ? 'auto-reply disabled' : 'suppressReply flag';
            logger.debug(`MessageBus: Suppressed reply to ${msg.source} message (${reason})`);
            return;
        }

        if (replyTemporarilySuppressed && substantiveInboundTask && !msg.isCommand) {
            logger.info(`MessageBus: Queueing substantive ${msg.source} task in quiet mode despite suppressReply flag.`);
        }

        // 5. Construct Task
        let priority = 10;
        let taskDescription = '';
        const whatsappReactionHint = msg.source === 'whatsapp' && msg.metadata?.autoReact && msg.messageId
            ? `\nIf a lightweight emoji reaction is more appropriate than a full reply, you may use 'react_whatsapp' with jid '${msg.sourceId}' and message_id '${msg.messageId}'.`
            : '';

        if (msg.isCommand || msg.isOwner) {
            priority = msg.isOwner ? 15 : 20;
            const label = msg.isOwner ? 'command from yourself' : 'command';
            taskDescription = `${msg.source} ${label}: "${msg.content}"`;
            
            if (msg.isOwner && msg.source === 'whatsapp') {
                taskDescription += `\n\nCRITICAL: You MUST use 'send_whatsapp' to reply. Do NOT send cross-channel notifications.`;
            }
        } else if (msg.source === 'email') {
            priority = 5; // Lower priority than direct IMs
            const subject = msg.metadata?.subject || '(no subject)';
            taskDescription = `Respond to email from ${sender} with subject "${subject}": "${msg.content}"${msg.replyContext ? ' ' + msg.replyContext : ''}

Goal: Provide a professional and helpful response. 
Technical Instructions:
- Use 'send_email' to respond.
- **SUBJECT**: Use the same subject "${subject}" (optionally prepended with "Re: ").
- **THREADING**: Pass the original message ID "${msg.messageId}" as 'inReplyTo' and 'references' to ensure the reply threads correctly.`;
        } else if (msg.metadata?.type === 'status' && msg.source === 'whatsapp') {
            priority = 3;
            taskDescription = `WhatsApp STATUS update from ${sender} (ID: ${msg.messageId}): "${msg.content}". 

Goal: Decide if you should reply to this status based on our history and my persona. 
If yes, you MUST use 'reply_whatsapp_status' with the JID '${msg.sourceId}' and a short, conversational reply message. 
The reply will appear as a proper status reply inside their status thread, not as a standalone DM.${whatsappReactionHint}`;
        } else if (msg.isExternal) {
            priority = 5; // Lower priority for external observation
            taskDescription = `EXTERNAL ${msg.source.toUpperCase()} MESSAGE from ${sender} (ID: ${msg.messageId}): "${baseContent}"${msg.mediaAnalysis ? ` [Media analysis: ${msg.mediaAnalysis}]` : ''}${msg.replyContext ? ' ' + msg.replyContext : ''}. 

Goal: Decide if you should respond based on our history and my persona. If yes, use 'send_${msg.source}'.${whatsappReactionHint}`;
        } else if (continuationReply.shouldContinue) {
            priority = 12;
            taskDescription = `CONTINUATION: The user replied on ${msg.source} with "${baseContent}" to my earlier message${followUpIntent.repliedText ? ` "${followUpIntent.repliedText}"` : ''}. Treat this as permission to continue the previously promised substantive work. Resume the same objective, make the default choice if needed, do the actual work, and deliver real results to the user. Do not stop after a mere acknowledgment.${whatsappReactionHint}`;
        } else if (continuationInquiry.shouldContinue) {
            priority = 12;
            taskDescription = `CONTINUATION: The user asked on ${msg.source} "${baseContent}" about my earlier in-progress commitment${followUpIntent.repliedText ? ` "${followUpIntent.repliedText}"` : ''}. Treat this as a follow-up on previously promised substantive work. Verify the real state from actual work already done. If the work has not truly started or has not materially advanced, resume it now instead of just claiming progress. Then send a grounded status update or concrete result. Do not send a status-only reassurance without real progress.${whatsappReactionHint}`;
        } else {
            taskDescription = `Respond to ${msg.source} message from ${sender}${channelStr}: "${baseContent}"${msg.mediaAnalysis ? ` [Media analysis: ${msg.mediaAnalysis}]` : ''}${msg.replyContext ? ' ' + msg.replyContext : ''}${whatsappReactionHint}`;
        }

        if (msg.mediaPaths && msg.mediaPaths.length > 0) {
            taskDescription += ` (Files stored at: ${msg.mediaPaths.join(', ')})`;
        }

        if (replyTemporarilySuppressed && substantiveInboundTask && !msg.isCommand) {
            taskDescription += `\n\nQUIET MODE: The user is active in the chat or the channel requested reply suppression. Do NOT send a low-value acknowledgment or progress ping. Continue the work silently. Only send a user-facing message if you have substantive results or a real blocker.`;
        }

        // 6. Push Task to Agent
        await this.agent.pushTask(
            taskDescription,
            priority,
            {
                source: msg.source,
                sourceId: msg.sourceId,
                sessionScopeId,
                inboundRoute: routingDecision.route,
                inboundRouteTargetActionId: routingDecision.waitingActionId || routingDecision.activeActionId,
                inboundSupersededActionIds: routingDecision.supersededActionIds,
                senderName: msg.senderName,
                userId: msg.userId,
                messageId: msg.messageId,
                continuationIntent: continuationReply.shouldContinue || continuationInquiry.shouldContinue ? 'resume_prior_commitment' : undefined,
                followUpIntent: continuationInquiry.shouldContinue ? 'status_check_on_pending_work' : undefined,
                replyToAgentMessage: continuationReply.shouldContinue || continuationInquiry.shouldContinue || undefined,
                replyToAgentText: followUpIntent.repliedText,
                suppressProgressFeedback: replyTemporarilySuppressed && substantiveInboundTask ? true : undefined,
                quietMode: replyTemporarilySuppressed && substantiveInboundTask ? true : undefined,
                isExternal: msg.isExternal,
                ...msg.metadata
            }
        );
    }
}
