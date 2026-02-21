import { IChannel } from './IChannel';
import { logger } from '../utils/logger';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

interface ParsedEmail {
    from: string;
    subject: string;
    messageId?: string;
    inReplyTo?: string;
    text: string;
    uid: string;
    headers?: any;
}

export class EmailChannel implements IChannel {
    public readonly name = 'Email';
    private readonly agent: any;
    private started = false;
    private imapClient: ImapFlow | null = null;
    private imapReconnectTimer: NodeJS.Timeout | null = null;
    private processing = false;

    constructor(agent: any) {
        this.agent = agent;
    }

    public async start(): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Email channel not configured. Set SMTP + IMAP credentials first.');
        }
        this.started = true;
        await this.connectImapWithRetry();
        logger.info('Email channel started (Event-Driven IMAP IDLE)');
    }

    public async stop(): Promise<void> {
        this.started = false;
        if (this.imapReconnectTimer) {
            clearTimeout(this.imapReconnectTimer);
            this.imapReconnectTimer = null;
        }
        if (this.imapClient) {
            try {
                await this.imapClient.logout();
            } catch (e) {
                // Ignore logout errors during shutdown
            }
            this.imapClient = null;
        }
    }

    public async sendMessage(to: string, message: string): Promise<void> {
        const subject = this.agent.config.get('emailDefaultSubject') || 'OrcBot response';
        await this.sendEmail(to, subject, message);
    }

    public async sendFile(_to: string, _filePath: string, _caption?: string): Promise<void> {
        throw new Error('Email attachments are not supported yet');
    }

    public async sendTypingIndicator(_to: string): Promise<void> {
        return;
    }

    public async sendEmail(to: string, subject: string, message: string, inReplyTo?: string, references?: string): Promise<void> {
        const transporter = this.createSmtpTransporter();
        const fromAddress = this.agent.config.get('emailAddress') || this.agent.config.get('smtpUsername');
        const fromName = this.agent.config.get('emailFromName') || this.agent.config.get('agentName') || 'OrcBot';

        let finalSubject = subject;
        if ((inReplyTo || references) && !finalSubject.toLowerCase().startsWith('re:')) {
            finalSubject = `Re: ${finalSubject}`;
        }

        const mailOptions: any = {
            from: `"${fromName}" <${fromAddress}>`,
            to,
            subject: finalSubject,
            text: message
        };

        if (inReplyTo) {
            mailOptions.inReplyTo = inReplyTo.startsWith('<') ? inReplyTo : `<${inReplyTo}>`;
        }
        if (references) {
            mailOptions.references = references.startsWith('<') ? references : `<${references}>`;
        }

        try {
            await transporter.sendMail(mailOptions);
            logger.info(`EmailChannel: Sent message to ${to}`);
        } catch (error: any) {
            logger.error(`EmailChannel: Failed to send email to ${to}: ${error.message}`);
            throw error;
        }
    }

    public async testConnections(): Promise<void> {
        const missing = this.getMissingConfiguration();
        if (missing.length > 0) {
            throw new Error(`Email is missing required settings: ${missing.join(', ')}`);
        }

        await this.testSmtpConnection();
        await this.testImapConnection();
    }

    public async testSmtpConnection(): Promise<void> {
        logger.info('Email test: starting SMTP validation');
        const missing = this.getMissingSmtpConfiguration();
        if (missing.length > 0) {
            throw new Error(`SMTP is missing required settings: ${missing.join(', ')}`);
        }

        const transporter = this.createSmtpTransporter();
        try {
            await transporter.verify();
            logger.info('Email test: SMTP verification successful');

            const testTo = this.agent.config.get('emailAddress') || this.agent.config.get('smtpUsername');
            logger.info(`Email test: SMTP target mailbox ${testTo ? 'resolved' : 'not set (send skipped)'}`);
            if (testTo) {
                await this.sendEmail(testTo, 'OrcBot email connection test', '✅ SMTP test successful.');
                logger.info('Email test: SMTP send successful');
            }
        } catch (error: any) {
            throw new Error(`SMTP validation failed: ${error.message}`);
        }
    }

    public async testImapConnection(): Promise<void> {
        logger.info('Email test: starting IMAP validation');
        const missing = this.getMissingImapConfiguration();
        if (missing.length > 0) {
            throw new Error(`IMAP is missing required settings: ${missing.join(', ')}`);
        }

        const client = this.createImapClient();
        try {
            await client.connect();
            logger.info('Email test: IMAP connection successful');
            await client.logout();
        } catch (error: any) {
            throw new Error(`IMAP validation failed: ${error.message}`);
        }
    }

    private isConfigured(): boolean {
        return this.getMissingConfiguration().length === 0;
    }

    private getMissingConfiguration(): string[] {
        return [
            ...this.getMissingSmtpConfiguration(),
            ...this.getMissingImapConfiguration(),
        ];
    }

    private getMissingSmtpConfiguration(): string[] {
        const required: Array<[string, any]> = [
            ['emailEnabled=true', this.agent.config.get('emailEnabled') === true],
            ['smtpHost', this.agent.config.get('smtpHost')],
            ['smtpUsername', this.agent.config.get('smtpUsername')],
            ['smtpPassword', this.agent.config.get('smtpPassword')],
        ];

        return required
            .filter(([_, value]) => !value)
            .map(([key]) => key);
    }

    private getMissingImapConfiguration(): string[] {
        const required: Array<[string, any]> = [
            ['imapHost', this.agent.config.get('imapHost')],
            ['imapUsername', this.agent.config.get('imapUsername')],
            ['imapPassword', this.agent.config.get('imapPassword')],
        ];

        return required
            .filter(([_, value]) => !value)
            .map(([key]) => key);
    }

    private createSmtpTransporter(): nodemailer.Transporter {
        const host = this.agent.config.get('smtpHost');
        const port = Number(this.agent.config.get('smtpPort') || 587);
        const secure = this.agent.config.get('smtpSecure') === true;
        const requireTLS = this.agent.config.get('smtpStartTls') !== false && !secure;
        const user = String(this.agent.config.get('smtpUsername') || '');
        const pass = String(this.agent.config.get('smtpPassword') || '');
        const timeoutMs = Number(this.agent.config.get('emailSocketTimeoutMs') || 15000);

        return nodemailer.createTransport({
            host,
            port,
            secure,
            requireTLS,
            auth: { user, pass },
            connectionTimeout: timeoutMs,
            socketTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            logger: false, // Set to true to see low-level SMTP logs in terminal
            debug: false
        });
    }

    private createImapClient(): ImapFlow {
        const host = String(this.agent.config.get('imapHost') || '');
        const port = Number(this.agent.config.get('imapPort') || 993);
        const secure = this.agent.config.get('imapSecure') !== false;
        const tls = secure ? { rejectUnauthorized: false } : undefined;
        const user = String(this.agent.config.get('imapUsername') || '');
        const pass = String(this.agent.config.get('imapPassword') || '');

        return new ImapFlow({
            host,
            port,
            secure,
            tls,
            auth: { user, pass },
            logger: false // Suppress verbose imapflow logging that pollutes the terminal
        });
    }

    private async connectImapWithRetry(delayMs = 5000): Promise<void> {
        if (!this.started) return;

        try {
            if (this.imapClient) {
                try {
                    await this.imapClient.logout();
                } catch { }
            }

            this.imapClient = this.createImapClient();

            // Listen for mail events
            this.imapClient.on('exists', (data) => {
                logger.info(`EmailChannel: New message detected in mailbox (Total: ${data.count})`);
                this.fetchUnreadEmails().catch(err => logger.error(`EmailChannel: Error in exists handler: ${err.message}`));
            });

            this.imapClient.on('error', (err: any) => {
                logger.error(`EmailChannel: IMAP connection error: ${err.message}`);
                this.scheduleReconnect(delayMs);
            });

            this.imapClient.on('close', () => {
                logger.warn('EmailChannel: IMAP connection closed');
                this.scheduleReconnect(delayMs);
            });

            await this.imapClient.connect();
            logger.info('EmailChannel: Connected to IMAP and waiting for emails...');

            // Fetch any emails that are currently unread on connection
            await this.fetchUnreadEmails();
        } catch (error: any) {
            logger.error(`EmailChannel: IMAP connection failed: ${error.message}. Retrying in ${delayMs / 1000}s...`);
            this.scheduleReconnect(delayMs);
        }
    }

    private scheduleReconnect(delayMs: number): void {
        if (!this.started) return;
        if (this.imapReconnectTimer) {
            clearTimeout(this.imapReconnectTimer);
        }
        // Exponential backoff up to 1 minute
        const nextDelay = Math.min(delayMs * 2, 60000);
        this.imapReconnectTimer = setTimeout(() => {
            void this.connectImapWithRetry(nextDelay);
        }, delayMs);
    }

    private async fetchUnreadEmails(): Promise<void> {
        if (!this.imapClient || !this.started) return;
        if (this.processing) {
            logger.debug('EmailChannel: Already processing emails, skipping concurrent fetch.');
            return;
        }

        logger.debug('EmailChannel: Scanning for unread messages...');
        this.processing = true;

        let lock: any;
        try {
            logger.debug('EmailChannel: Acquiring mailbox lock for INBOX...');
            lock = await this.imapClient.getMailboxLock('INBOX');

            // Search for unread messages
            const searchObj = { seen: false };
            const uids = await this.imapClient.search(searchObj, { uid: true });

            if (uids && uids.length > 0) {
                logger.info(`EmailChannel: Found ${uids.length} unread messages.`);
                for (const uid of uids) {
                    try {
                        const message = await this.imapClient.fetchOne(uid, { source: true, uid: true });
                        if (message && message.source) {
                            const parsed = await simpleParser(message.source);

                            const from = parsed.from?.value[0]?.address || 'Unknown';
                            const subject = parsed.subject || '(no subject)';
                            const messageId = parsed.messageId;
                            const inReplyTo = parsed.inReplyTo;
                            const text = parsed.text || '(no text content)';
                            const headers = parsed.headers;

                            const emailInfo: ParsedEmail = { from, subject, messageId, inReplyTo, text, uid: String(message.uid), headers };

                            // Process the email
                            await this.handleInboundEmail(emailInfo);

                            // Mark as seen
                            await this.imapClient.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                        }
                    } catch (fetchErr: any) {
                        logger.error(`EmailChannel: Failed to process message UID ${uid}: ${fetchErr.message}`);
                    }
                }
            } else {
                logger.debug('EmailChannel: No unread messages found in INBOX.');
            }
        } catch (error: any) {
            logger.error(`EmailChannel: Error fetching emails: ${error.message}`);
        } finally {
            if (lock) lock.release();
            this.processing = false;
        }
    }

    private async handleInboundEmail(email: ParsedEmail): Promise<void> {
        const autoReplyEnabled = this.agent.config.get('emailAutoReplyEnabled') === true;
        const sessionScopeId = `scope:channel-peer:email:${email.from.toLowerCase()}`;

        this.agent.memory.saveMemory({
            id: `email-${email.uid}`,
            type: 'short',
            content: `Email from ${email.from}: "${(email.text || '').slice(0, 250)}"`,
            timestamp: new Date().toISOString(),
            metadata: {
                source: 'email',
                sourceId: email.from,
                senderName: email.from,
                sessionScopeId,
                subject: email.subject,
                messageId: email.messageId,
                inReplyTo: email.inReplyTo,
                uid: email.uid
            }
        });

        if (!autoReplyEnabled) {
            logger.info(`EmailChannel: Auto-reply is disabled. Email from ${email.from} ("${email.subject}") recorded in memory but no task pushed.`);
            return;
        }

        const skipReason = this.shouldSkipAutoReply(email);
        if (skipReason) {
            logger.info(`EmailChannel: Skipping auto-reply for "${email.subject}" - Reason: ${skipReason}`);
            return;
        }

        // Run fast AI classifier to check if the email actually needs a response (filters newsletters, pure info emails, etc.)
        const aiSkipReason = await this.classifyEmailNeed(email);
        if (aiSkipReason) {
            logger.info(`EmailChannel: AI Classifier skipped auto-reply for "${email.subject}" - Reason: ${aiSkipReason}`);
            return;
        }

        await this.agent.pushTask(
            `Respond to email from ${email.from} with subject "${email.subject}" (MsgID: ${email.messageId}): "${(email.text || '').slice(0, 1000)}"`,
            10,
            {
                source: 'email',
                sourceId: email.from,
                senderName: email.from,
                sessionScopeId,
                subject: email.subject,
                inReplyTo: email.messageId,
                references: email.messageId,
                requiresResponse: true
            }
        );
    }

    private shouldSkipAutoReply(email: ParsedEmail): string | false {
        // 1. Check for noreply/automated addresses
        const automatedAddressRegex = /no-?reply|bot@|daemon@|mailer-daemon@|donotreply|bounce|postmaster|sysadmin/i;
        if (automatedAddressRegex.test(email.from)) {
            return 'Automated sender address pattern';
        }

        if (email.headers && typeof email.headers.get === 'function') {
            // 2. Check RFC 3834 Auto-Submitted header
            const autoSubmitted = email.headers.get('auto-submitted');
            if (autoSubmitted && typeof autoSubmitted === 'string' && autoSubmitted.toLowerCase() !== 'no') {
                return 'Auto-Submitted header present';
            }

            // 3. Check for Mailing List headers
            const listId = email.headers.get('list-id');
            const listUnsubscribe = email.headers.get('list-unsubscribe');
            if (listId || listUnsubscribe) {
                return 'Mailing list headers (List-Id / List-Unsubscribe)';
            }

            // 4. Check Precedence header
            const precedence = (email.headers.get('precedence') || '').toString().toLowerCase();
            if (['bulk', 'list', 'junk'].includes(precedence)) {
                return `Precedence: ${precedence}`;
            }

            // 5. Check X-Autoreply header
            const xAutoreply = email.headers.get('x-autoreply');
            if (xAutoreply) {
                return 'X-Autoreply header present';
            }
        }

        return false;
    }

    private async classifyEmailNeed(email: ParsedEmail): Promise<string | false> {
        // Fast LLM call to classify if the email genuinely requires a response from the user/agent.
        const preview = (email.text || '').slice(0, 1000);

        const systemPrompt = `You are an intelligent email triage assistant.
Your job is to determine if an incoming email requires a reply.

You should IGNORE and DO NOT REPLY TO:
- Newsletters, marketing blasts, or promotional material
- System notifications, alerts, or receipts
- Purely informational updates where no question is asked
- Auto-generated reports or status updates

You SHOULD reply to:
- Direct inquiries or questions directed at the user
- Conversational emails from real humans expecting a response
- Requests for action or information

Analyze the email and return a JSON object with this exact schema:
{
  "requiresReply": boolean,
  "reason": "Brief string explaining why"
}
Output ONLY valid JSON.`;

        const userPrompt = `From: ${email.from}\nSubject: ${email.subject}\n\nBody Preview:\n${preview}`;

        try {
            const responseText = await this.agent.llm.callFast(userPrompt, systemPrompt);

            // Extract JSON block if the model included markdown formatting
            let jsonString = responseText.trim();
            if (jsonString.startsWith('\`\`\`json')) {
                jsonString = jsonString.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/, '').trim();
            } else if (jsonString.startsWith('\`\`\`')) {
                jsonString = jsonString.replace(/^\`\`\`/i, '').replace(/\`\`\`$/, '').trim();
            }

            const result = JSON.parse(jsonString);

            if (result.requiresReply === false) {
                return result.reason || 'AI classified as not requiring a reply';
            }
            return false;
        } catch (error: any) {
            logger.warn(`EmailChannel: AI Classification failed for "${email.subject}": ${error.message}. Defaulting to process email.`);
            // Fail open: if the classifier fails, we let the main agent handle it so we don't drop important emails
            return false;
        }
    }

    public async searchEmails(params: { sender?: string, subject?: string, daysAgo?: number, unreadOnly?: boolean, limit?: number }): Promise<ParsedEmail[]> {
        if (!this.imapClient || !this.started) {
            throw new Error('IMAP is not connected');
        }

        let lock = await this.imapClient.getMailboxLock('INBOX');
        try {
            const searchObj: any = {};
            if (params.unreadOnly) {
                searchObj.seen = false;
            }
            if (params.sender) {
                searchObj.from = params.sender;
            }
            if (params.subject) {
                searchObj.subject = params.subject;
            }
            if (params.daysAgo) {
                searchObj.since = new Date(Date.now() - params.daysAgo * 24 * 60 * 60 * 1000);
            }

            // If no search criteria passed, get all
            if (Object.keys(searchObj).length === 0) {
                searchObj.all = true;
            }

            const uids = await this.imapClient.search(searchObj, { uid: true });

            if (!uids || uids.length === 0) {
                return [];
            }

            // Sort uids descending to get newest first. Note: IMAP sequence numbers aren't strictly chronological
            // but UIDs generally monotonic increase for a given mailbox session
            uids.sort((a, b) => b - a);

            const limit = Math.min(params.limit || 5, 20);
            const targetUids = uids.slice(0, limit);

            const results: ParsedEmail[] = [];
            for (const uid of targetUids) {
                try {
                    const message = await this.imapClient.fetchOne(uid, { source: true, uid: true });
                    if (message && message.source) {
                        const parsed = await simpleParser(message.source);
                        const from = parsed.from?.value[0]?.address || 'Unknown';
                        const subject = parsed.subject || '(no subject)';
                        // Don't log full content length in case it's huge, limit the text length for the AI
                        const text = parsed.text ? parsed.text.trim().substring(0, 4000) : '(no text content)';
                        results.push({ from, subject, messageId: parsed.messageId, inReplyTo: parsed.inReplyTo, text, uid: String(message.uid) });
                    }
                } catch (fetchErr: any) {
                    logger.error(`EmailChannel: Failed to fetch message UID ${uid} in search: ${fetchErr.message}`);
                }
            }
            return results;

        } catch (error: any) {
            logger.error(`EmailChannel: Error searching emails: ${error.message}`);
            throw error;
        } finally {
            if (lock) lock.release();
        }
    }
}
