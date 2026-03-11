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
    private statusRepliesByParticipant: Map<string, { key: any; message: any; timestamp?: number; cachedAtMs: number; contentType: string; hasMedia: boolean }> = new Map();
    // Cache of recent status metadata by status message ID for reactions and context propagation
    private statusRepliesById: Map<string, { key: any; message: any; timestamp?: number; cachedAtMs: number; contentType: string; hasMedia: boolean }> = new Map();
    // Prefix used to identify agent-sent messages (for self-chat distinction)
    private readonly AGENT_MESSAGE_PREFIX = '🤖 ';
    // Cache config values to avoid repeated lookups
    private autoReplyEnabled: boolean = false;
    private statusReplyEnabled: boolean = false;
    private statusMediaMode: 'off' | 'download_only' | 'download_and_analyze' = 'off';
    private autoReactEnabled: boolean = false;
    private profilingEnabled: boolean = false;
    // Track last user message timestamps for suppressing agent replies when user is active
    private lastUserMessageTimestamps: Map<string, number> = new Map();
    // Track last status task timestamps to avoid piling up status replies
    private lastStatusTaskTimestamps: Map<string, number> = new Map();
    // Timestamp of when this channel starts, to filter old messages on initial sync
    private channelStartedAt: number = 0;
    // Track if we're still in the initial sync phase (first 30 seconds)
    private isInitialSyncPhase: boolean = true;

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
        this.statusMediaMode = String(this.agent.config.get('whatsappStatusMediaMode') || 'off') as any;
        this.autoReactEnabled = this.readBooleanConfig('whatsappAutoReactEnabled', false);
        this.profilingEnabled = this.readBooleanConfig('whatsappContextProfilingEnabled', false);
        logger.info(`WhatsAppChannel: Settings loaded - autoReply=${this.autoReplyEnabled}, statusReply=${this.statusReplyEnabled}, statusMediaMode=${this.statusMediaMode}, autoReact=${this.autoReactEnabled}, profiling=${this.profilingEnabled}`);
    }

    private setupConfigListener() {
        eventBus.on('whatsapp:config-changed', (newConfig: any) => {
            logger.info('WhatsAppChannel: Config changed, reloading settings...');
            this.autoReplyEnabled = this.readBooleanConfig('whatsappAutoReplyEnabled', false);
            this.statusReplyEnabled = this.readBooleanConfig('whatsappStatusReplyEnabled', false);
            this.statusMediaMode = String(this.agent.config.get('whatsappStatusMediaMode') || 'off') as any;
            this.autoReactEnabled = this.readBooleanConfig('whatsappAutoReactEnabled', false);
            this.profilingEnabled = this.readBooleanConfig('whatsappContextProfilingEnabled', false);
            logger.info(`WhatsAppChannel: Settings reloaded - autoReply=${this.autoReplyEnabled}, statusReply=${this.statusReplyEnabled}, statusMediaMode=${this.statusMediaMode}, autoReact=${this.autoReactEnabled}, profiling=${this.profilingEnabled}`);
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

    /**
     * Normalize JIDs used for outbound operations.
     * Some inbound threads can surface Linked-ID recipients (@lid), which may
     * not have an established encryption session for direct sends.
     * In those cases we fallback to the phone JID form when we can infer it.
     */
    private normalizeOutboundJid(raw: string): string {
        let jid = String(raw || '').trim();
        if (!jid) return jid;

        if (!jid.includes('@')) {
            return `${jid}@s.whatsapp.net`;
        }

        if (jid.endsWith('@lid')) {
            const local = jid.split('@')[0] || '';
            const digits = local.replace(/\D/g, '');
            if (digits.length > 0) {
                return `${digits}@s.whatsapp.net`;
            }
        }

        return jid;
    }

    private hasStatusMedia(message: any): boolean {
        return Boolean(message?.imageMessage || message?.videoMessage || message?.audioMessage || message?.documentMessage);
    }

    private isStatusMetadataFresh(metadata?: { timestamp?: number; cachedAtMs?: number }): boolean {
        if (!metadata) return false;

        // WhatsApp statuses expire after ~24h. We use a slightly tighter window to avoid borderline stale context.
        const maxAgeMs = 23 * 60 * 60 * 1000;
        const nowMs = Date.now();

        if (typeof metadata.cachedAtMs === 'number' && metadata.cachedAtMs > 0) {
            if (nowMs - metadata.cachedAtMs <= maxAgeMs) return true;
            return false;
        }

        if (typeof metadata.timestamp === 'number' && metadata.timestamp > 0) {
            const tsMs = metadata.timestamp > 1_000_000_000_000 ? metadata.timestamp : metadata.timestamp * 1000;
            return nowMs - tsMs <= maxAgeMs;
        }

        // If timing info is absent, assume stale to avoid replying against wrong status context.
        return false;
    }

    private pruneStaleStatusCache(): void {
        for (const [participant, meta] of this.statusRepliesByParticipant.entries()) {
            if (!this.isStatusMetadataFresh(meta)) {
                this.statusRepliesByParticipant.delete(participant);
            }
        }

        for (const [id, meta] of this.statusRepliesById.entries()) {
            if (!this.isStatusMetadataFresh(meta)) {
                this.statusRepliesById.delete(id);
            }
        }
    }

    private normalizePolicyJid(raw?: string): string {
        let jid = String(raw || '').trim();
        if (!jid) return '';
        // Remove device suffixes like 12345:10@s.whatsapp.net -> 12345@s.whatsapp.net
        jid = jid.replace(/:\d+@/, '@');
        if (!jid.includes('@')) jid = `${jid}@s.whatsapp.net`;
        return jid;
    }

    private canProcessContact(jid?: string): { allowed: boolean; reason?: string } {
        const normalized = this.normalizePolicyJid(jid);
        if (!normalized) return { allowed: false, reason: 'missing_jid' };

        const mode = String(this.agent.config.get('whatsappContactAccessMode') || 'all').toLowerCase();
        const allowlist = ((this.agent.config.get('whatsappAllowedContacts') || []) as string[])
            .map((entry) => this.normalizePolicyJid(entry))
            .filter(Boolean);
        const blocklist = ((this.agent.config.get('whatsappBlockedContacts') || []) as string[])
            .map((entry) => this.normalizePolicyJid(entry))
            .filter(Boolean);

        if (blocklist.includes(normalized)) {
            return { allowed: false, reason: 'blocked_contact' };
        }

        if (mode === 'allowlist' && !allowlist.includes(normalized)) {
            return { allowed: false, reason: 'not_in_allowlist' };
        }

        return { allowed: true };
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
        // Reset sync phase timer whenever we start
        this.channelStartedAt = Date.now();
        this.isInitialSyncPhase = true;

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
                qrcode.generate(qr, { small: true });
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
                if (this.agent.config.get('whatsappOwnerJID') !== ownerJid) {
                    this.agent.config.set('whatsappOwnerJID', ownerJid);
                }
                logger.info(`WhatsApp: Connection opened successfully. Owner: ${ownerJid}`);
                eventBus.emit('whatsapp:status', 'connected');
                // Exit initial sync phase after 30 seconds
                setTimeout(() => {
                    this.isInitialSyncPhase = false;
                    logger.info('WhatsApp: Exiting initial sync phase; now processing real-time messages.');
                }, 30000);
            }
        });

        this.sock.ev.on('messages.upsert', async (m: any) => {
            logger.info(`WhatsApp Upsert: type=${m.type}, messages=${m.messages.length}, inInitialSync=${this.isInitialSyncPhase}`);

            // Allow 'append' type as well for sync messages, but be selective during initial sync
            if (m.type === 'notify' || m.type === 'append') {
                // On initial sync (append), only process recent messages (last 5 minutes)
                // This prevents responding to a backlog of old messages from re-connection
                const messageAgeThresholdMs = this.isInitialSyncPhase ? 5 * 60 * 1000 : 0;
                const now = Date.now();
                for (const msg of m.messages) {
                    const senderId = msg.key.remoteJid;
                    const ownerJid = this.agent.config.get('whatsappOwnerJID');
                    const isFromMe = msg.key.fromMe;
                    const isSelfChat = senderId === ownerJid;
                    const messageTimestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : Date.now();
                    const messageAge = now - messageTimestamp;

                    logger.info(`WhatsApp Msg: ${senderId} | fromMe=${isFromMe} | owner=${ownerJid} | type=${Object.keys(msg.message || {})} | age=${Math.round(messageAge / 1000)}s`);

                    // Skip messages older than threshold during initial sync
                    if (messageAgeThresholdMs > 0 && messageAge > messageAgeThresholdMs && m.type === 'append') {
                        logger.debug(`WhatsApp: Skipping old message (${Math.round(messageAge / 60000)}min old) during initial sync from ${senderId}`);
                        continue;
                    }

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
                        const receivedAt = Date.now();
                        const previousUserTs = (!isStatus && senderId && !isFromMe)
                            ? (this.lastUserMessageTimestamps.get(senderId) || 0)
                            : 0;

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

                        // Download media if present. Status media behavior is controlled separately.
                        let mediaPath = '';
                        const shouldDownloadStatusMedia = this.statusReplyEnabled && this.statusMediaMode !== 'off';
                        const shouldDownloadMedia = !isStatus || shouldDownloadStatusMedia;
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
                            logger.info(`WhatsApp: Skipping status media download (statusReplyEnabled=${this.statusReplyEnabled}, statusMediaMode=${this.statusMediaMode})`);
                        }

                        // Group chat handling — configurable policy
                        if (isGroup) {
                            const groupsEnabled = this.readBooleanConfig('whatsappGroupsEnabled', false);
                            if (!groupsEnabled) continue;

                            const groupPolicy = String(this.agent.config.get('whatsappGroupPolicy') || 'mention_only');
                            const allowedGroups = ((this.agent.config.get('whatsappAllowedGroups') || []) as string[])
                                .map(g => this.normalizePolicyJid(g)).filter(Boolean);
                            const blockedGroups = ((this.agent.config.get('whatsappBlockedGroups') || []) as string[])
                                .map(g => this.normalizePolicyJid(g)).filter(Boolean);
                            const normalizedGroupJid = this.normalizePolicyJid(senderId);

                            // Blocked groups always skip
                            if (normalizedGroupJid && blockedGroups.includes(normalizedGroupJid)) {
                                logger.info(`WhatsApp: Skipping message from blocked group ${normalizedGroupJid}`);
                                continue;
                            }

                            // Allowlist mode: only process listed groups
                            if (groupPolicy === 'allowlist' && (!normalizedGroupJid || !allowedGroups.includes(normalizedGroupJid))) {
                                logger.debug(`WhatsApp: Skipping group ${normalizedGroupJid} not in allowlist (policy=allowlist)`);
                                continue;
                            }

                            // mention_only: only process if bot name or JID is mentioned
                            if (groupPolicy === 'mention_only') {
                                const botName = String(this.agent.config.get('agentName') || '').toLowerCase();
                                const botJid = this.sock?.user?.id
                                    ? (this.sock.user.id.split(':')[0] + '@s.whatsapp.net')
                                    : '';
                                const mentionedJids: string[] = contextInfo?.mentionedJid || [];
                                const textLower = text.toLowerCase();
                                const isMentioned =
                                    (botName && textLower.includes(botName)) ||
                                    (botJid && mentionedJids.includes(botJid));
                                if (!isMentioned) {
                                    logger.debug(`WhatsApp: Skipping group message (policy=mention_only, not mentioned)`);
                                    continue;
                                }
                            }

                            // owner_only: only process messages from the configured owner JID
                            if (groupPolicy === 'owner_only') {
                                const ownerJid = this.normalizePolicyJid(String(this.agent.config.get('whatsappOwnerJID') || ''));
                                const participantJid = this.normalizePolicyJid(msg.key.participant);
                                if (!ownerJid || participantJid !== ownerJid) {
                                    logger.debug(`WhatsApp: Skipping group message from non-owner ${participantJid} (policy=owner_only)`);
                                    continue;
                                }
                            }
                        } else {
                            this.recordContactJid(senderId);
                        }

                        // Contact access policy: allowlist/blocklist enforcement
                        if (isStatus) {
                            const participant = this.normalizePolicyJid(msg.key.participant || msg.participant);
                            const policy = this.canProcessContact(participant);
                            if (!policy.allowed) {
                                logger.info(`WhatsApp: Skipping status from ${participant || 'unknown'} due to contact policy (${policy.reason})`);
                                continue;
                            }
                        } else {
                            const policy = this.canProcessContact(senderId);
                            if (!policy.allowed) {
                                logger.info(`WhatsApp: Skipping message from ${senderId} due to contact policy (${policy.reason})`);
                                continue;
                            }
                        }

                        // Skip if no text AND no media (e.g. some system msg)
                        // Auto-transcribe voice/audio messages so the agent can "hear" them
                        let transcription = '';
                        const shouldAnalyzeStatusMedia = !isStatus || this.statusMediaMode === 'download_and_analyze';
                        if (mediaPath && audioMsg && shouldAnalyzeStatusMedia) {
                            try {
                                logger.info(`WhatsApp: Auto-transcribing audio from ${senderName}...`);
                                const result = await this.agent.llm.analyzeMedia(mediaPath, 'Transcribe this audio message exactly. Return only the transcription text.');
                                transcription = result.replace(/^Transcription result:\n/i, '').trim();
                                if (transcription.startsWith('Media analysis skipped:')) {
                                    transcription = '';
                                }
                                if (transcription) {
                                    logger.info(`WhatsApp: Transcribed voice from ${senderName}: "${transcription.substring(0, 100)}..."`);
                                }
                            } catch (e) {
                                logger.warn(`WhatsApp: Auto-transcription failed: ${e}`);
                            }
                        }

                        // Auto-analyze images/video/documents so agent sees media context immediately
                        let mediaAnalysis = '';
                        if (mediaPath && !transcription && (imageMsg || docMsg || videoMsg) && shouldAnalyzeStatusMedia) {
                            try {
                                const mediaType = imageMsg ? 'image' : videoMsg ? 'video' : 'document';
                                logger.info(`WhatsApp: Auto-analyzing ${mediaType} from ${senderName}...`);
                                const prompt = text
                                    ? `The user sent this ${mediaType} with the message: "${text}". Describe what you see in detail.`
                                    : `Describe the content of this ${mediaType} in detail.`;
                                mediaAnalysis = await this.agent.llm.analyzeMedia(mediaPath, prompt);
                                if (mediaAnalysis.startsWith('Media analysis skipped:')) {
                                    mediaAnalysis = '';
                                }
                                if (mediaAnalysis) {
                                    logger.info(`WhatsApp: Analyzed ${mediaType} from ${senderName}: "${mediaAnalysis.substring(0, 100)}..."`);
                                }
                            } catch (e) {
                                logger.warn(`WhatsApp: Auto media analysis failed: ${e}`);
                            }
                        }

                        // Special handling for Status Updates
                        if (isStatus) {
                            const participant = this.normalizePolicyJid(msg.key.participant || msg.participant);
                            if (!participant) {
                                logger.warn(`WhatsApp: Received status ${messageId} without participant JID; skipping.`);
                                continue;
                            }

                            if (!this.statusReplyEnabled) {
                                logger.debug(`WhatsApp: Status interactions disabled; ignoring status ${messageId} from ${participant}.`);
                                continue;
                            }

                            const statusMetadata = {
                                key: msg.key,
                                message: msg.message,
                                timestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : undefined,
                                cachedAtMs: receivedAt,
                                contentType: this.detectStatusContentType(msg.message),
                                hasMedia: this.hasStatusMedia(msg.message)
                            };
                            this.statusRepliesByParticipant.set(participant, statusMetadata);
                            this.statusRepliesById.set(messageId, statusMetadata);

                            // Aggressive cooldown during initial sync (1 hour), then allow normal interval
                            const baseMinIntervalHrs = Number(this.agent.config.get('whatsappStatusTaskMinIntervalHours') || 12);
                            const minIntervalHrs = this.isInitialSyncPhase ? 1 : baseMinIntervalHrs;
                            const lastTaskAt = this.lastStatusTaskTimestamps.get(participant) || 0;
                            if (receivedAt - lastTaskAt < minIntervalHrs * 60 * 60 * 1000) {
                                logger.debug(`WhatsApp: Skipping status task for ${participant} (cooldown active for another ${Math.round((minIntervalHrs * 60 * 60 * 1000 - (receivedAt - lastTaskAt)) / 60000)}min)`);
                                continue;
                            }

                            this.lastStatusTaskTimestamps.set(participant, receivedAt);
                            const statusContent = text || transcription || mediaAnalysis || `[${statusMetadata.contentType} status update]`;

                            await this.agent.messageBus.dispatch({
                                source: 'whatsapp',
                                sourceId: participant,
                                senderName: participant,
                                content: statusContent,
                                messageId,
                                mediaPaths: mediaPath ? [mediaPath] : [],
                                mediaAnalysis,
                                metadata: {
                                    type: 'status',
                                    statusContentType: statusMetadata.contentType,
                                    statusHasMedia: statusMetadata.hasMedia,
                                    statusTimestamp: statusMetadata.timestamp
                                }
                            });
                            continue;
                        }

                        // Skip if no text AND no media (e.g. some system msg)
                        if (!text && !mediaPath) continue;

                        // Suppress agent reply if user is active in chat (already checked senderId)
                        if (!isSelfChat) {
                            const userActiveWindowMs = 60 * 1000; // 1 minute window
                            if (receivedAt - previousUserTs < userActiveWindowMs) {
                                logger.info(`WhatsAppChannel: User is active in chat (${senderId}), suppressing agent task.`);
                                // We still record the message in memory via MessageBus, but we disable auto-reply for this dispatch
                                await this.agent.messageBus.dispatch({
                                    source: 'whatsapp',
                                    sourceId: senderId,
                                    senderName,
                                    content: text || transcription || '[Media]',
                                    messageId,
                                    replyContext,
                                    mediaPaths: mediaPath ? [mediaPath] : [],
                                    mediaAnalysis,
                                    metadata: { 
                                        quotedMessageId,
                                        suppressReply: true 
                                    }
                                });
                                if (senderId && !isFromMe) this.lastUserMessageTimestamps.set(senderId, receivedAt);
                                continue;
                            }
                        }

                        // During initial sync, only process messages if auto-reply is explicitly enabled
                        // This prevents the agent from going crazy with responses to old messages
                        if (this.isInitialSyncPhase && m.type === 'append' && !this.autoReplyEnabled) {
                            logger.info(`WhatsApp: Skipping auto-reply during initial sync (autoReplyEnabled=${this.autoReplyEnabled}); recording message in memory only`);
                            // Still save to memory so the agent knows about the message, just don't task it
                            await this.agent.messageBus.dispatch({
                                source: 'whatsapp',
                                sourceId: senderId,
                                senderName,
                                content: text || transcription || (mediaPath ? `[Media: ${path.basename(mediaPath)}]` : ''),
                                messageId,
                                replyContext,
                                mediaPaths: mediaPath ? [mediaPath] : [],
                                mediaAnalysis,
                                isOwner: isSelfChat,
                                isExternal: !isSelfChat && !isGroup,
                                metadata: {
                                    quotedMessageId,
                                    isSelfChat,
                                    isGroup,
                                    groupParticipant: isGroup ? this.normalizePolicyJid(msg.key.participant) : undefined,
                                    suppressReply: true, // Suppress auto-reply during initial sync
                                    autoReact: this.autoReactEnabled,
                                    profiling: this.profilingEnabled
                                }
                            });
                        } else {
                            // Dispatch via unified MessageBus
                            await this.agent.messageBus.dispatch({
                                source: 'whatsapp',
                                sourceId: senderId,
                                senderName,
                                content: text || transcription || (mediaPath ? `[Media: ${path.basename(mediaPath)}]` : ''),
                                messageId,
                                replyContext,
                                mediaPaths: mediaPath ? [mediaPath] : [],
                                mediaAnalysis,
                                isOwner: isSelfChat,
                                isExternal: !isSelfChat && !isGroup,
                                metadata: {
                                    quotedMessageId,
                                    isSelfChat,
                                    isGroup,
                                    groupParticipant: isGroup ? this.normalizePolicyJid(msg.key.participant) : undefined,
                                    autoReact: this.autoReactEnabled,
                                    profiling: this.profilingEnabled
                                }
                            });
                        }
                        if (senderId && !isFromMe) this.lastUserMessageTimestamps.set(senderId, receivedAt);
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
            let jid = this.normalizeOutboundJid(to);
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
            let targetJid = this.normalizeOutboundJid(jid);

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
            const targetJid = this.normalizeOutboundJid(to);
            await this.sock.sendPresenceUpdate('composing', targetJid);
            // WhatsApp typing indicators are usually transient, we might want to delay stopping it
            setTimeout(async () => {
                await this.sock.sendPresenceUpdate('paused', targetJid);
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
            await this.sock.sendPresenceUpdate('composing', this.normalizeOutboundJid(to));
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
            await this.sock.sendPresenceUpdate('paused', this.normalizeOutboundJid(to));
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
            let targetJid = this.normalizeOutboundJid(jid);

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
     * Reply to a WhatsApp status update with explicit delivery mode reporting.
     *
     * Primary path: send a native status-thread reply using quoted status context
     * and statusJidList so WhatsApp can render it like an in-status response.
     *
     * Fallback path: send a regular DM if native status-thread delivery fails.
     *
     * @param participantJid - JID of the person whose status is being replied to
     * @param message - Reply text
     * @param statusMessageId - Optional explicit status message ID for precise targeting
     */
    public async sendStatusReply(
        participantJid: string,
        message: string,
        statusMessageId?: string
    ): Promise<{ success: boolean; mode: 'status_thread' | 'dm_fallback' | 'not_sent'; reason?: string }> {
        if (!this.sock) {
            return { success: false, mode: 'not_sent', reason: 'socket_not_connected' };
        }

        const jid = this.normalizePolicyJid(participantJid);
        if (!jid) {
            return { success: false, mode: 'not_sent', reason: 'invalid_participant_jid' };
        }

        this.pruneStaleStatusCache();

        // Prefer explicit status ID when available, otherwise fall back to latest status by participant.
        let statusMetadata = statusMessageId ? this.statusRepliesById.get(statusMessageId) : undefined;
        if (!statusMetadata) {
            statusMetadata = this.statusRepliesByParticipant.get(jid);
        }

        if (statusMetadata && !this.isStatusMetadataFresh(statusMetadata)) {
            statusMetadata = undefined;
        }

        if (!statusMetadata) {
            logger.warn(`WhatsAppChannel: No cached status key for ${jid}. Cannot send native status reply.`);
            return { success: false, mode: 'not_sent', reason: 'status_context_not_found' };
        }

        try {
            const formatted = hasMarkdown(message) ? renderMarkdown(message, 'whatsapp') : message;
            const prefixedMessage = `${this.AGENT_MESSAGE_PREFIX}${formatted}`;

            // Important: include statusJidList so WhatsApp treats this as a status-thread response
            // instead of an ordinary DM in cases where quoted context alone is insufficient.
            await this.sock.sendMessage(
                jid,
                {
                    text: prefixedMessage,
                    quoted: {
                        key: statusMetadata.key,
                        message: statusMetadata.message
                    }
                },
                {
                    statusJidList: [jid]
                }
            );

            logger.info(`WhatsAppChannel: Sent native status-thread reply to ${jid}`);
            return { success: true, mode: 'status_thread' };
        } catch (error) {
            logger.warn(`WhatsAppChannel: Native status reply send failed for ${jid}, attempting DM fallback: ${error}`);
            try {
                const formatted = hasMarkdown(message) ? renderMarkdown(message, 'whatsapp') : message;
                const prefixedMessage = `${this.AGENT_MESSAGE_PREFIX}[Re: your status] ${formatted}`;
                await this.sock.sendMessage(jid, { text: prefixedMessage });
                logger.info(`WhatsAppChannel: Sent DM fallback for status reply to ${jid}`);
                return { success: true, mode: 'dm_fallback', reason: 'native_send_failed' };
            } catch (fallbackError) {
                logger.error(`WhatsAppChannel: Error sending status reply to ${jid}: ${fallbackError}`);
                return { success: false, mode: 'not_sent', reason: 'native_and_fallback_failed' };
            }
        }
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Ensure JID is properly formatted
            let jid = to;
            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`;
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

            await this.sock.sendMessage(jid, messageContent);
            logger.info(`WhatsAppChannel: Sent file ${filePath} to ${jid}`);
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
            logger.info(`WhatsAppChannel: Sent voice note ${filePath} to ${jid}`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending voice note: ${error}`);
            throw error;
        }
    }
}
