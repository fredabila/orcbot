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
        const autoReplyEnabled = this.agent.config.get(`${msg.source}AutoReplyEnabled`) ?? true;
        if ((!autoReplyEnabled || msg.metadata?.suppressReply) && !msg.isCommand) {
            const reason = msg.metadata?.suppressReply ? 'suppressReply flag' : 'auto-reply disabled';
            logger.debug(`MessageBus: Suppressed reply to ${msg.source} message (${reason})`);
            return;
        }

        // 5. Construct Task
        let priority = 10;
        let taskDescription = '';
        const continuationReply = this.shouldTreatAsContinuationReply(msg.source, msg.sourceId, sessionScopeId, baseContent, msg.replyContext, msg.metadata);
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
            taskDescription = `CONTINUATION: The user replied on ${msg.source} with "${baseContent}" to my earlier message${continuationReply.repliedText ? ` "${continuationReply.repliedText}"` : ''}. Treat this as permission to continue the previously promised substantive work. Resume the same objective, make the default choice if needed, do the actual work, and deliver real results to the user. Do not stop after a mere acknowledgment.${whatsappReactionHint}`;
        } else {
            taskDescription = `Respond to ${msg.source} message from ${sender}${channelStr}: "${baseContent}"${msg.mediaAnalysis ? ` [Media analysis: ${msg.mediaAnalysis}]` : ''}${msg.replyContext ? ' ' + msg.replyContext : ''}${whatsappReactionHint}`;
        }

        if (msg.mediaPaths && msg.mediaPaths.length > 0) {
            taskDescription += ` (Files stored at: ${msg.mediaPaths.join(', ')})`;
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
                continuationIntent: continuationReply.shouldContinue ? 'resume_prior_commitment' : undefined,
                replyToAgentMessage: continuationReply.shouldContinue || undefined,
                replyToAgentText: continuationReply.repliedText,
                isExternal: msg.isExternal,
                ...msg.metadata
            }
        );
    }
}
