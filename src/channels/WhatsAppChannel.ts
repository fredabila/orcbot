import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WAMessageContent,
    WAMessageKey,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { IChannel } from './IChannel';
import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { renderMarkdown, hasMarkdown } from '../utils/MarkdownRenderer';
import { isImageFile, isVideoFile, isAudioFile, getMimeType } from '../utils/AudioHelper';

export class WhatsAppChannel implements IChannel {
    public name = 'whatsapp';
    private agent: Agent;
    private sock: any;
    private sessionPath: string;
    private store: any;
    private contactJids: Set<string> = new Set();
    private contactNames: Map<string, string> = new Map();
    // Cache of recent status metadata so replies can preserve WhatsApp quote preview context
    // Key: participant JID, Value: latest status metadata
    private statusRepliesByParticipant: Map<string, { key: any; message: any; timestamp?: number; contentType: string; hasMedia: boolean }> = new Map();
    // Cache of recent status metadata by status message ID for reactions and context propagation
    private statusRepliesById: Map<string, { key: any; message: any; timestamp?: number; contentType: string; hasMedia: boolean }> = new Map();
    // Prefix used to identify agent-sent messages (for self-chat distinction)
    private readonly AGENT_MESSAGE_PREFIX = '🤖 ';
    // Cache config values to avoid repeated lookups
    private autoReplyEnabled: boolean = false;
    private statusReplyEnabled: boolean = false;
    private autoReactEnabled: boolean = false;
    private profilingEnabled: boolean = false;

    constructor(agent: Agent) {
        this.agent = agent;
        this.sessionPath = agent.config.get('whatsappSessionPath') || './whatsapp-session';
        this.store = null; // Removed makeInMemoryStore due to library issues
        this.loadConfigSettings();
        this.setupConfigListener();
    }

    private readBooleanConfig(key: string, fallback: boolean = false): boolean {
        const value = this.agent.config.get(key);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
            if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
        }
        if (typeof value === 'number') return value === 1;
        return fallback;
    }

    private loadConfigSettings() {
        this.autoReplyEnabled = this.readBooleanConfig('whatsappAutoReplyEnabled', false);
        this.statusReplyEnabled = this.readBooleanConfig('whatsappStatusReplyEnabled', false);
        this.autoReactEnabled = this.readBooleanConfig('whatsappAutoReactEnabled', false);
        this.profilingEnabled = this.readBooleanConfig('whatsappContextProfilingEnabled', false);
        logger.info(`WhatsAppChannel: Settings loaded - autoReply=${this.autoReplyEnabled}, statusReply=${this.statusReplyEnabled}, autoReact=${this.autoReactEnabled}, profiling=${this.profilingEnabled}`);
    }

    private setupConfigListener() {
        eventBus.on('whatsapp:config-changed', (newConfig: any) => {
            logger.info('WhatsAppChannel: Config changed, reloading settings...');
            this.autoReplyEnabled = this.readBooleanConfig('whatsappAutoReplyEnabled', false);
            this.statusReplyEnabled = this.readBooleanConfig('whatsappStatusReplyEnabled', false);
            this.autoReactEnabled = this.readBooleanConfig('whatsappAutoReactEnabled', false);
            this.profilingEnabled = this.readBooleanConfig('whatsappContextProfilingEnabled', false);
            logger.info(`WhatsAppChannel: Settings reloaded - autoReply=${this.autoReplyEnabled}, statusReply=${this.statusReplyEnabled}, autoReact=${this.autoReactEnabled}, profiling=${this.profilingEnabled}`);
        });
    }

    private recordContactJid(jid?: string) {
        if (!jid) return;
        if (jid === 'status@broadcast') return;
        if (!jid.endsWith('@s.whatsapp.net')) return;
        this.contactJids.add(jid);
    }

    private detectStatusContentType(message: any): string {
        if (!message) return 'unknown';
        if (message.conversation || message.extendedTextMessage?.text) return 'text';
        if (message.imageMessage) return 'image';
        if (message.videoMessage) return 'video';
        if (message.audioMessage) return 'audio';
        if (message.documentMessage) return 'document';
        return 'unknown';
    }

    private hasStatusMedia(message: any): boolean {
        return Boolean(message?.imageMessage || message?.videoMessage || message?.audioMessage || message?.documentMessage);
    }

    private recordContacts(contacts: Array<any>) {
        if (!contacts || contacts.length === 0) return;
        for (const contact of contacts) {
            if (contact.id) {
                this.recordContactJid(contact.id);
                // Also store human readable name if available
                const name = contact.name || contact.notify || contact.verifiedName;
                if (name) {
                    this.contactNames.set(contact.id, name);
                }
            }
        }
    }

    /**
     * Get recent contacts that have been synced or interacted with.
     */
    public getRecentContacts(): Array<{ jid: string, name: string }> {
        const results: Array<{ jid: string, name: string }> = [];
        for (const [jid, name] of this.contactNames.entries()) {
            results.push({ jid, name });
        }
        // If we have JIDs without names, include them too
        for (const jid of this.contactJids) {
            if (!this.contactNames.has(jid)) {
                results.push({ jid, name: jid.split('@')[0] });
            }
        }
        return results;
    }

    /**
     * Search the synced contacts by name.
     */
    public searchContacts(query: string): Array<{ jid: string, name: string }> {
        const results: Array<{ jid: string, name: string }> = [];
        const normalizedQuery = query.toLowerCase().trim();
        if (!normalizedQuery) return results;

        for (const [jid, name] of this.contactNames.entries()) {
            if (name.toLowerCase().includes(normalizedQuery) || jid.includes(normalizedQuery)) {
                results.push({ jid, name });
                if (results.length >= 50) break; // Cap at 50 to avoid overflowing LLM
            }
        }
        return results;
    }

    public async start(): Promise<void> {
        logger.info('WhatsAppChannel: Starting...');
        if (this.sock) {
            try {
                logger.info('WhatsAppChannel: Closing existing socket...');
                await this.sock.end();
            } catch (e) {
                // Ignore
            }
        }
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
        }

        logger.info(`WhatsAppChannel: Loading auth state from ${this.sessionPath}...`);
        const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

        logger.info('WhatsAppChannel: Fetching latest version...');
        const { version, isLatest } = await fetchLatestBaileysVersion();

        logger.info(`WhatsAppChannel: Version ${version.join('.')} (latest: ${isLatest}). Creating socket...`);

        this.sock = makeWASocket({
            version,
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: 'silent' }) as any
        });

        this.sock.ev.on('creds.update', saveCreds);
        this.store?.bind(this.sock.ev);

        this.sock.ev.on('contacts.upsert', (contacts: any[]) => {
            this.recordContacts(contacts || []);
            logger.info(`WhatsApp: Contacts upserted (${contacts?.length || 0})`);
        });

        this.sock.ev.on('contacts.set', (payload: any) => {
            const contacts = payload?.contacts || [];
            this.recordContacts(contacts);
            logger.info(`WhatsApp: Contacts set (${contacts.length})`);
        });

        this.sock.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info('WhatsApp: New QR Code generated. Scan to link.');
                eventBus.emit('whatsapp:qr', qr);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                logger.warn(`WhatsApp: Connection closed. Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    this.start();
                }
            } else if (connection === 'open') {
                const ownerJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                this.agent.config.set('whatsappOwnerJID', ownerJid);
                logger.info(`WhatsApp: Connection opened successfully. Owner: ${ownerJid}`);
                eventBus.emit('whatsapp:status', 'connected');
            }
        });

        this.sock.ev.on('messages.upsert', async (m: any) => {
            logger.info(`WhatsApp Upsert: type=${m.type}, messages=${m.messages.length}`);

            // Allow 'append' type as well for sync messages
            if (m.type === 'notify' || m.type === 'append') {
                for (const msg of m.messages) {
                    const senderId = msg.key.remoteJid;
                    const ownerJid = this.agent.config.get('whatsappOwnerJID');
                    const isFromMe = msg.key.fromMe;
                    const isSelfChat = senderId === ownerJid;

                    logger.info(`WhatsApp Msg: ${senderId} | fromMe=${isFromMe} | owner=${ownerJid} | type=${Object.keys(msg.message || {})}`);

                    // For self-chat: We need to distinguish between:
                    // 1. Messages the AGENT sent (should skip) - identified by agent prefix
                    // 2. Messages the USER sent as commands (should process)
                    // For non-self-chat: Skip all fromMe messages (they're agent replies)
                    if (isFromMe) {
                        if (isSelfChat) {
                            // In self-chat, check if this is an agent message by looking for the prefix
                            const msgText = msg.message?.conversation ||
                                msg.message?.extendedTextMessage?.text || '';
                            if (msgText.startsWith(this.AGENT_MESSAGE_PREFIX)) {
                                logger.debug(`WhatsApp: Skipping agent's own message in self-chat (has prefix)`);
                                continue;
                            }
                            // Otherwise, this is a user command in self-chat - let it through!
                            logger.info(`WhatsApp: Processing self-chat command (no agent prefix)`);
                        } else {
                            // Not self-chat, skip all fromMe messages
                            logger.debug(`WhatsApp: Skipping own outgoing message (fromMe=true)`);
                            continue;
                        }
                    }

                    // Only process incoming messages (fromMe=false)
                    if (msg.message) {
                        const messageId = msg.key.id;
                        const imageMsg = msg.message.imageMessage;
                        const audioMsg = msg.message.audioMessage;
                        const docMsg = msg.message.documentMessage;
                        const videoMsg = msg.message.videoMessage;
                        const extendedText = msg.message.extendedTextMessage;

                        const text = msg.message.conversation ||
                            extendedText?.text ||
                            imageMsg?.caption || docMsg?.caption || videoMsg?.caption || '';

                        const senderName = msg.pushName || 'WhatsApp User';
                        const isGroup = senderId?.endsWith('@g.us');
                        const isStatus = senderId === 'status@broadcast';

                        // Extract reply/quote context if this message is a reply
                        let replyContext = '';
                        let quotedMessageId: string | undefined;
                        const contextInfo = extendedText?.contextInfo || imageMsg?.contextInfo || videoMsg?.contextInfo || docMsg?.contextInfo;
                        if (contextInfo?.quotedMessage) {
                            quotedMessageId = contextInfo.stanzaId;
                            const quotedText = contextInfo.quotedMessage.conversation ||
                                contextInfo.quotedMessage.extendedTextMessage?.text ||
                                contextInfo.quotedMessage.imageMessage?.caption ||
                                '[Media/Sticker]';
                            const quotedParticipant = contextInfo.participant || 'Unknown';
                            // Extract just the phone number for cleaner display
                            const quotedName = quotedParticipant.split('@')[0];
                            replyContext = `[Replying to ${quotedName}'s message: \"${quotedText.substring(0, 200)}${quotedText.length > 200 ? '...' : ''}\"]`;
                        }

                        // Download Media if present - BUT skip status media unless explicitly enabled
                        let mediaPath = '';
                        const shouldDownloadMedia = !isStatus || this.statusReplyEnabled;
                        if (shouldDownloadMedia && (imageMsg || audioMsg || docMsg || videoMsg)) {
                            try {
                                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                                const downloadsDir = path.join(this.agent.config.getDataHome(), 'downloads');
                                if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                                const ext = imageMsg ? 'jpg' : audioMsg ? 'ogg' : videoMsg ? 'mp4' : (docMsg?.mimetype?.split('/')[1] || 'bin');
                                mediaPath = path.join(downloadsDir, `wa_${messageId}.${ext}`);
                                fs.writeFileSync(mediaPath, buffer);
                                logger.info(`WhatsApp Media saved: ${mediaPath}`);
                            } catch (e) {
                                logger.error(`Failed to download media: ${e}`);
                            }
                        } else if (isStatus && (imageMsg || audioMsg || docMsg || videoMsg)) {
                            logger.info(`WhatsApp: Skipping status media download (statusReplyEnabled=${this.statusReplyEnabled})`);
                        }

                        // Skip group chats for now unless mentioned or requested (simpler for now)
                        if (!isGroup) this.recordContactJid(senderId);
                        if (isGroup) return;

                        // Special handling for Status Updates
                        if (isStatus && text) {
                            // Cache the full message key so we can send a proper status reply later
                            const participant = msg.key.participant || msg.participant;
                            const statusMetadata = {
                                key: msg.key,
                                message: msg.message,
                                timestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : undefined,
                                contentType: this.detectStatusContentType(msg.message),
                                hasMedia: this.hasStatusMedia(msg.message)
                            };
                            this.statusRepliesByParticipant.set(participant, statusMetadata);
                            this.statusRepliesById.set(messageId, statusMetadata);

                            // Record it in memory so the agent knows.
                            this.agent.memory.saveMemory({
                                id: `wa-status-${messageId}`,
                                type: 'short',
                                content: `WhatsApp STATUS from ${participant}: ${text}`,
                                timestamp: new Date().toISOString(),
                                metadata: {
                                    source: 'whatsapp',
                                    type: 'status',
                                    messageId,
                                    senderId: participant,
                                    statusContentType: statusMetadata.contentType,
                                    statusHasMedia: statusMetadata.hasMedia,
                                    statusTimestamp: statusMetadata.timestamp
                                }
                            });

                            // Only trigger a task if Status Interactions are enabled
                            if (this.statusReplyEnabled) {
                                await this.agent.pushTask(
                                    `WhatsApp STATUS update from ${participant} (ID: ${messageId}): "${text}". \n\nGoal: Decide if you should reply to this status. If yes, use 'reply_whatsapp_status' with the JID '${participant}' and a short, conversational reply message. The reply will appear as a proper status reply to the person, not as a regular DM.`,
                                    3,
                                    {
                                        source: 'whatsapp',
                                        sourceId: participant,
                                        senderName: participant,
                                        type: 'status',
                                        messageId,
                                        statusContentType: statusMetadata.contentType,
                                        statusHasMedia: statusMetadata.hasMedia,
                                        statusTimestamp: statusMetadata.timestamp
                                    }
                                );
                            } else {
                                logger.info(`WhatsApp: Status reply skipped - statusReplyEnabled is false`);
                            }
                            return;
                        }

                        // Skip if no text AND no media (e.g. some system msg)
                        if (!text && !mediaPath) return;

                        // Auto-transcribe voice/audio messages so the agent can "hear" them
                        let transcription = '';
                        if (mediaPath && audioMsg) {
                            try {
                                logger.info(`WhatsApp: Auto-transcribing audio from ${senderName}...`);
                                const result = await this.agent.llm.analyzeMedia(mediaPath, 'Transcribe this audio message exactly. Return only the transcription text.');
                                transcription = result.replace(/^Transcription result:\n/i, '').trim();
                                if (transcription) {
                                    logger.info(`WhatsApp: Transcribed voice from ${senderName}: "${transcription.substring(0, 100)}..."`);
                                }
                            } catch (e) {
                                logger.warn(`WhatsApp: Auto-transcription failed: ${e}`);
                            }
                        }

                        // Auto-analyze images/video/documents so agent sees media context immediately
                        let mediaAnalysis = '';
                        if (mediaPath && !transcription && (imageMsg || docMsg || videoMsg)) {
                            try {
                                const mediaType = imageMsg ? 'image' : videoMsg ? 'video' : 'document';
                                logger.info(`WhatsApp: Auto-analyzing ${mediaType} from ${senderName}...`);
                                const prompt = text
                                    ? `The user sent this ${mediaType} with the message: "${text}". Describe what you see in detail.`
                                    : `Describe the content of this ${mediaType} in detail.`;
                                mediaAnalysis = await this.agent.llm.analyzeMedia(mediaPath, prompt);
                                if (mediaAnalysis) {
                                    logger.info(`WhatsApp: Analyzed ${mediaType} from ${senderName}: "${mediaAnalysis.substring(0, 100)}..."`);
                                }
                            } catch (e) {
                                logger.warn(`WhatsApp: Auto media analysis failed: ${e}`);
                            }
                        }

                        logger.info(`WhatsApp Msg: ${senderName} (${senderId}): ${text || transcription || '[Media]'} [ID: ${messageId}] | autoReply=${this.autoReplyEnabled}`);
                        const sessionScopeId = this.agent.resolveSessionScopeId('whatsapp', {
                            sourceId: senderId
                        });

                        // Build content string that includes media info + transcription/analysis
                        const voiceLabel = transcription ? ` [Voice message transcription: "${transcription}"]` : '';
                        const mediaLabel = mediaAnalysis ? ` [Media analysis: ${mediaAnalysis}]` : '';
                        const contentStr = text
                            ? `User ${senderName} (${senderId}) said on WhatsApp: ${text}${voiceLabel}${mediaLabel}${replyContext ? ' ' + replyContext : ''}`
                            : transcription
                                ? `User ${senderName} (${senderId}) sent a voice message on WhatsApp: "${transcription}"${replyContext ? ' ' + replyContext : ''}`
                                : mediaAnalysis
                                    ? `User ${senderName} (${senderId}) sent media on WhatsApp: ${path.basename(mediaPath)} [Media analysis: ${mediaAnalysis}]${replyContext ? ' ' + replyContext : ''}`
                                    : `User ${senderName} (${senderId}) sent a file on WhatsApp: ${path.basename(mediaPath)}${replyContext ? ' ' + replyContext : ''}`;

                        // Save to memory for context
                        this.agent.memory.saveMemory({
                            id: `wa-${messageId}`,
                            type: 'short',
                            content: contentStr,
                            timestamp: new Date().toISOString(),
                            metadata: {
                                source: 'whatsapp',
                                role: 'user',
                                sessionScopeId,
                                messageId,
                                senderId,
                                senderName,
                                mediaPath: mediaPath || undefined,
                                quotedMessageId,
                                replyContext: replyContext || undefined
                            }
                        });

                        const reactInstruction = this.autoReactEnabled ? " or 'react_whatsapp'" : "";
                        const profileInstruction = this.profilingEnabled ? "\n- Also, evaluate if you've learned something new about this person and update their profile using 'update_contact_profile' if needed." : "";
                        const replyNote = replyContext ? ` ${replyContext}` : '';

                        // Treat as Command if from Owner (self-chat - message from yourself on another device)
                        // Note: isSelfChat means the remoteJid equals owner's JID (messaging yourself)
                        const mediaNote = mediaPath ? ` (File stored at: ${mediaPath})` : '';
                        const mediaContext = mediaAnalysis ? ` [Media analysis: ${mediaAnalysis}]` : '';
                        const displayText = text || (transcription ? `[Voice: "${transcription}"]` : '[Media]');

                        if (isSelfChat && this.autoReplyEnabled) {
                            await this.agent.pushTask(
                                `WhatsApp command from yourself (ID: ${messageId}): \"${displayText}\"${mediaContext}${replyNote}${mediaNote}${profileInstruction}
                                
CRITICAL: You MUST use 'send_whatsapp' to reply. Do NOT send cross-channel Telegram notifications.`,
                                10,
                                { source: 'whatsapp', sourceId: senderId, sessionScopeId, senderName: senderName, isOwner: true, messageId, quotedMessageId, replyContext: replyContext || undefined, mediaPath: mediaPath || undefined }
                            );
                        } else if (this.autoReplyEnabled) {
                            // Treat as External Interaction for AI to decide on
                            await this.agent.pushTask(
                                `EXTERNAL WHATSAPP MESSAGE from ${senderName} (ID: ${messageId}): \"${displayText}\"${mediaContext}${replyNote}${mediaNote}. \n\nGoal: Decide if you should respond${reactInstruction} to this person on my behalf based on our history and my persona. If yes, use 'send_whatsapp'${reactInstruction}.${profileInstruction}`,
                                5,
                                { source: 'whatsapp', sourceId: senderId, sessionScopeId, senderName: senderName, isExternal: true, messageId, quotedMessageId, replyContext: replyContext || undefined, mediaPath: mediaPath || undefined }
                            );
                        } else {
                            logger.info(`WhatsApp: Message from ${senderName} not queued - autoReplyEnabled is false`);
                        }
                    }
                }
            }
        });
    }

    public async stop(): Promise<void> {
        if (this.sock) {
            await this.sock.end();
            logger.info('WhatsAppChannel: Stopped');
        }
    }

    public async sendMessage(to: string, message: string): Promise<void> {
        try {
            // Ensure JID is properly formatted
            let jid = to;
            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`;
            }
            // If it's a group, ensure it ends with @g.us
            // (Basic check, user should usually provide correct ID for groups)

            // Convert markdown to WhatsApp-native formatting (*bold*, _italic_, ~strike~, ```code```)
            const formatted = hasMarkdown(message) ? renderMarkdown(message, 'whatsapp') : message;

            // Add agent prefix to distinguish agent messages from user self-chat commands
            const prefixedMessage = `${this.AGENT_MESSAGE_PREFIX}${formatted}`;
            await this.sock.sendMessage(jid, { text: prefixedMessage });
            logger.info(`WhatsAppChannel: Sent message to ${to} (as ${jid})`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending message to ${to}: ${error}`);
        }
    }

    public async react(jid: string, messageId: string, emoji: string): Promise<void> {
        try {
            // Ensure JID is properly formatted
            let targetJid = jid;
            if (!targetJid.includes('@')) {
                targetJid = `${targetJid}@s.whatsapp.net`;
            }

            // If this is a reaction to a status message, we need to handle it specially
            const statusMetadata = this.statusRepliesById.get(messageId);
            const key = statusMetadata?.key || {
                remoteJid: targetJid,
                id: messageId,
                fromMe: false // Usually reacting to others
            };

            await this.sock.sendMessage(targetJid, {
                react: {
                    text: emoji,
                    key
                }
            });
            logger.info(`WhatsAppChannel: Reacted with ${emoji} to ${messageId}`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error reacting to ${messageId}: ${error}`);
        }
    }

    public async sendTypingIndicator(to: string): Promise<void> {
        try {
            await this.sock.sendPresenceUpdate('composing', to);
            // WhatsApp typing indicators are usually transient, we might want to delay stopping it
            setTimeout(async () => {
                await this.sock.sendPresenceUpdate('paused', to);
            }, 5000);
        } catch (error) {
            // Ignore
        }
    }

    /**
     * Send composing presence WITHOUT the auto-paused side effect.
     * Used by the persistent typing indicator interval so rapid re-fires don't
     * race with each other's scheduled 'paused' timeouts.
     */
    public async sendPresenceComposing(to: string): Promise<void> {
        try {
            await this.sock.sendPresenceUpdate('composing', to);
        } catch {
            // non-critical
        }
    }

    /**
     * Explicitly stop the typing indicator (send 'paused' presence).
     * Called when the persistent interval is stopped after action completion.
     */
    public async stopTypingIndicator(to: string): Promise<void> {
        try {
            await this.sock.sendPresenceUpdate('paused', to);
        } catch {
            // non-critical
        }
    }

    /**
     * Post a status update (text only for now)
     */
    public async postStatus(text: string): Promise<void> {
        try {
            const recipients = Array.from(this.contactJids);
            if (recipients.length === 0) {
                throw new Error('No synced contacts available for status broadcast yet. Wait for contacts to sync, then try again.');
            }
            // For text status, we usually need specific metadata for it to appear correctly
            await this.sock.sendMessage('status@broadcast',
                {
                    text,
                    backgroundColor: '#075E54', // WhatsApp Green
                    font: 1,
                    statusJidList: recipients,
                    broadcast: true
                },
                {
                    statusJidList: recipients
                }
            );
            logger.info(`WhatsAppChannel: Posted status update to ${recipients.length} contacts`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error posting status: ${error}`);
            throw error;
        }
    }

    /**
     * Get chat history (last N messages) from WhatsApp servers.
     */
    public async getHistory(jid: string, count: number = 20): Promise<any[]> {
        if (!this.sock) throw new Error('WhatsApp socket not connected');

        try {
            // Ensure JID formatting
            let targetJid = jid;
            if (!targetJid.includes('@')) {
                targetJid = `${targetJid}@s.whatsapp.net`;
            }

            logger.info(`WhatsApp: Fetching ${count} messages of history for ${targetJid}...`);

            // fetchMessagesFromChat is the standard Baileys method for history retrieval
            const result = await this.sock.fetchMessagesFromChat(targetJid, count);

            // Normalize messages for the agent
            return (result || []).map((msg: any) => {
                const isFromMe = msg.key.fromMe;
                const text = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    '[Media]';

                return {
                    id: msg.key.id,
                    fromMe: isFromMe,
                    text: text,
                    timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
                };
            });
        } catch (error) {
            logger.error(`WhatsAppChannel: Error fetching history for ${jid}: ${error}`);
            return [];
        }
    }

    /**
     * Reply to a WhatsApp status update properly.
     * 
     * A proper status reply must be sent to 'status@broadcast' with the original
     * status message quoted. This makes the reply appear in the contact's status
     * thread, NOT as a standalone DM in their regular chat.
     *
     * @param participantJid - The JID of the person whose status you're replying to
     * @param message - The reply text
     */
    public async sendStatusReply(participantJid: string, message: string): Promise<void> {
        if (!this.sock) {
            throw new Error('WhatsApp socket not connected');
        }

        // Look up the cached message key for this participant's latest status
        const statusMetadata = this.statusRepliesByParticipant.get(participantJid);
        if (!statusMetadata) {
            logger.warn(`WhatsAppChannel: No cached status key for ${participantJid}. Falling back to regular DM.`);
            // Graceful degradation: send as a DM with context prefix so user knows it's related to their status
            await this.sendMessage(participantJid, `[Re: your status] ${message}`);
            return;
        }

        const ownerJid = this.sock.user?.id;

        try {
            // The correct Baileys method to reply to a status so it appears as a DM reply:
            // - Send to the participantJid (the DM thread)
            // - Provide `quoted` pointing to the original status message
            await this.sock.sendMessage(
                participantJid,
                {
                    text: message,
                    // `quoted` creates the contextual reply bubble referencing the original status
                    quoted: {
                        key: statusMetadata.key,
                        message: statusMetadata.message
                    }
                }
            );
            logger.info(`WhatsAppChannel: Sent status reply to ${participantJid}'s status`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending status reply to ${participantJid}: ${error}`);
            throw error;
        }
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const fileName = path.basename(filePath);
            const buffer = fs.readFileSync(filePath);
            const mime = getMimeType(filePath);

            let messageContent: any = {};

            if (isImageFile(filePath)) {
                messageContent = { image: buffer, caption, mimetype: mime };
            } else if (isVideoFile(filePath)) {
                messageContent = { video: buffer, caption, mimetype: mime };
            } else if (isAudioFile(filePath)) {
                messageContent = { audio: buffer, caption, mimetype: mime };
            } else {
                messageContent = {
                    document: buffer,
                    fileName,
                    caption,
                    mimetype: mime
                };
            }

            await this.sock.sendMessage(to, messageContent);
            logger.info(`WhatsAppChannel: Sent file ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending file: ${error}`);
            throw error;
        }
    }

    /**
     * Send a voice note (push-to-talk) to a WhatsApp contact.
     * Sends the audio with ptt:true so it appears as a voice message bubble.
     */
    public async sendVoiceNote(to: string, filePath: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            let jid = to;
            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`;
            }

            const buffer = fs.readFileSync(filePath);
            const mimetype = getMimeType(filePath);

            await this.sock.sendMessage(jid, {
                audio: buffer,
                mimetype,
                ptt: true  // Push-to-talk = voice note bubble
            });
            logger.info(`WhatsAppChannel: Sent voice note ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending voice note: ${error}`);
            throw error;
        }
    }
}
