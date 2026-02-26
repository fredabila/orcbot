import { Agent } from './Agent';
import { logger } from '../utils/logger';

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

    public async dispatch(msg: InboundMessage): Promise<void> {
        // 1. Resolve Session Scope
        const sessionScopeId = this.agent.resolveSessionScopeId(msg.source, {
            sourceId: msg.sourceId,
            userId: msg.userId,
            chatId: msg.sourceId
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

        if (msg.isCommand || msg.isOwner) {
            priority = msg.isOwner ? 15 : 20;
            const label = msg.isOwner ? 'command from yourself' : 'command';
            taskDescription = `${msg.source} ${label}: "${msg.content}"`;
            
            if (msg.isOwner && msg.source === 'whatsapp') {
                taskDescription += `\n\nCRITICAL: You MUST use 'send_whatsapp' to reply. Do NOT send cross-channel notifications.`;
            }
        } else if (msg.source === 'email') {
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
The reply will appear as a proper status reply inside their status thread, not as a standalone DM.`;
        } else if (msg.isExternal) {
            priority = 5; // Lower priority for external observation
            taskDescription = `EXTERNAL ${msg.source.toUpperCase()} MESSAGE from ${sender} (ID: ${msg.messageId}): "${baseContent}"${msg.mediaAnalysis ? ` [Media analysis: ${msg.mediaAnalysis}]` : ''}${msg.replyContext ? ' ' + msg.replyContext : ''}. 

Goal: Decide if you should respond based on our history and my persona. If yes, use 'send_${msg.source}'.`;
        } else {
            taskDescription = `Respond to ${msg.source} message from ${sender}${channelStr}: "${baseContent}"${msg.mediaAnalysis ? ` [Media analysis: ${msg.mediaAnalysis}]` : ''}${msg.replyContext ? ' ' + msg.replyContext : ''}`;
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
                senderName: msg.senderName,
                userId: msg.userId,
                messageId: msg.messageId,
                isExternal: msg.isExternal,
                ...msg.metadata
            }
        );
    }
}
