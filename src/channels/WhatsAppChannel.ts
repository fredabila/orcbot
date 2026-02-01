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

export class WhatsAppChannel implements IChannel {
    public name = 'whatsapp';
    private agent: Agent;
    private sock: any;
    private sessionPath: string;
    private store: any;

    constructor(agent: Agent) {
        this.agent = agent;
        this.sessionPath = agent.config.get('whatsappSessionPath') || './whatsapp-session';
        this.store = null; // Removed makeInMemoryStore due to library issues
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
                    const isToMe = senderId === ownerJid;

                    logger.info(`WhatsApp Msg: ${senderId} | fromMe=${isFromMe} | owner=${ownerJid} | type=${Object.keys(msg.message || {})}`);

                    // Only process messages that are NOT from me, 
                    // OR are from me but sent TO me (self-messaging commands)
                    if (msg.message && (!isFromMe || isToMe)) {
                        const messageId = msg.key.id;
                        const imageMsg = msg.message.imageMessage;
                        const audioMsg = msg.message.audioMessage;
                        const docMsg = msg.message.documentMessage;
                        const videoMsg = msg.message.videoMessage;

                        const text = msg.message.conversation ||
                            msg.message.extendedTextMessage?.text ||
                            imageMsg?.caption || docMsg?.caption || videoMsg?.caption || '';

                        const senderName = msg.pushName || 'WhatsApp User';
                        const isGroup = senderId?.endsWith('@g.us');
                        const isStatus = senderId === 'status@broadcast';
                        const isFromOwner = senderId === ownerJid;
                        const autoReplyEnabled = this.agent.config.get('whatsappAutoReplyEnabled');
                        const statusReplyEnabled = this.agent.config.get('whatsappStatusReplyEnabled');
                        const autoReactEnabled = this.agent.config.get('whatsappAutoReactEnabled');
                        const profilingEnabled = this.agent.config.get('whatsappContextProfilingEnabled');

                        // Download Media if present
                        let mediaPath = '';
                        if (imageMsg || audioMsg || docMsg || videoMsg) {
                            try {
                                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                                const downloadsDir = path.join(os.homedir(), '.orcbot', 'downloads');
                                if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                                const ext = imageMsg ? 'jpg' : audioMsg ? 'ogg' : videoMsg ? 'mp4' : (docMsg?.mimetype?.split('/')[1] || 'bin');
                                mediaPath = path.join(downloadsDir, `wa_${messageId}.${ext}`);
                                fs.writeFileSync(mediaPath, buffer);
                                logger.info(`WhatsApp Media saved: ${mediaPath}`);
                            } catch (e) {
                                logger.error(`Failed to download media: ${e}`);
                            }
                        }

                        // Skip group chats for now unless mentioned or requested (simpler for now)
                        if (isGroup) return;

                        // Special handling for Status Updates
                        if (isStatus && text) {
                            const participant = msg.key.participant || msg.participant;
                            logger.info(`WhatsApp Status: ${participant} posted: ${text}`);

                            // Record it in memory so the agent knows.
                            this.agent.memory.saveMemory({
                                id: `wa-status-${messageId}`,
                                type: 'short',
                                content: `WhatsApp STATUS from ${participant}: ${text}`,
                                timestamp: new Date().toISOString(),
                                metadata: { source: 'whatsapp', type: 'status', messageId, senderId: participant }
                            });

                            // Only trigger a task if Status Interactions are enabled
                            if (statusReplyEnabled) {
                                await this.agent.pushTask(
                                    `WhatsApp STATUS update from ${participant} (ID: ${messageId}): "${text}". \n\nGoal: Decide if you should reply to this status. If yes, use 'reply_whatsapp_status'.`,
                                    3,
                                    { source: 'whatsapp', sourceId: participant, senderName: participant, type: 'status', messageId }
                                );
                            }
                            return;
                        }

                        // Skip if no text AND no media (e.g. some system msg)
                        if (!text && !mediaPath) return;

                        logger.info(`WhatsApp Msg: ${senderName} (${senderId}): ${text || '[Media]'} [ID: ${messageId}] | autoReply=${autoReplyEnabled}`);

                        // Save to memory for context
                        this.agent.memory.saveMemory({
                            id: `wa-${messageId}`,
                            type: 'short',
                            content: `User ${senderName} (${senderId}) said on WhatsApp: ${text}`,
                            timestamp: new Date().toISOString(),
                            metadata: { source: 'whatsapp', messageId, senderId, senderName }
                        });

                        const reactInstruction = autoReactEnabled ? " or 'react_whatsapp'" : "";
                        const profileInstruction = profilingEnabled ? "\n- Also, evaluate if you've learned something new about this person and update their profile using 'update_contact_profile' if needed." : "";

                        // Treat as Command if from Owner
                        if (isFromOwner || isToMe) {
                            await this.agent.pushTask(
                                `WhatsApp command from yourself (ID: ${messageId}): "${text}"${profileInstruction}`,
                                10,
                                { source: 'whatsapp', sourceId: senderId, senderName: senderName, isOwner: true, messageId }
                            );
                        } else if (autoReplyEnabled) {
                            // Treat as External Interaction for AI to decide on
                            await this.agent.pushTask(
                                `EXTERNAL WHATSAPP MESSAGE from ${senderName} (ID: ${messageId}): "${text}". \n\nGoal: Decide if you should respond${reactInstruction} to this person on my behalf based on our history and my persona. If yes, use 'send_whatsapp'${reactInstruction}.${profileInstruction}`,
                                5,
                                { source: 'whatsapp', sourceId: senderId, senderName: senderName, isExternal: true, messageId }
                            );
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

            await this.sock.sendMessage(jid, { text: message });
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

            await this.sock.sendMessage(targetJid, {
                react: {
                    text: emoji,
                    key: {
                        remoteJid: targetJid,
                        id: messageId,
                        fromMe: false // Usually reacting to others
                    }
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
     * Post a status update (text only for now)
     */
    public async postStatus(text: string): Promise<void> {
        try {
            // For text status, we usually need specific metadata for it to appear correctly
            await this.sock.sendMessage('status@broadcast',
                { text },
                {
                    backgroundColor: '#075E54', // WhatsApp Green
                    font: 1
                }
            );
            logger.info('WhatsAppChannel: Posted status update');
        } catch (error) {
            logger.error(`WhatsAppChannel: Error posting status: ${error}`);
        }
    }

    /**
     * Get chat history (last N messages)
     */
    public async getHistory(jid: string, count: number = 20): Promise<any[]> {
        // Basic history stub since makeInMemoryStore is currently unavailable
        return [];
    }

    public async sendFile(to: string, filePath: string, caption?: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const ext = path.extname(filePath).toLowerCase().substring(1);
            const fileName = path.basename(filePath);
            const buffer = fs.readFileSync(filePath);

            let messageContent: any = {};

            if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                messageContent = { image: buffer, caption };
            } else if (['mp4', 'mov'].includes(ext)) {
                messageContent = { video: buffer, caption };
            } else if (['mp3', 'm4a', 'ogg'].includes(ext)) {
                messageContent = { audio: buffer, caption, mimetype: `audio/${ext === 'mp3' ? 'mpeg' : ext}` };
            } else {
                messageContent = {
                    document: buffer,
                    fileName: fileName,
                    caption: caption,
                    mimetype: 'application/octet-stream'
                };
            }

            await this.sock.sendMessage(to, messageContent);
            logger.info(`WhatsAppChannel: Sent file ${filePath} to ${to}`);
        } catch (error) {
            logger.error(`WhatsAppChannel: Error sending file: ${error}`);
            throw error;
        }
    }
}
