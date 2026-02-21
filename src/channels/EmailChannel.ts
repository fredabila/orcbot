import tls from 'tls';
import net from 'net';
import { IChannel } from './IChannel';
import { logger } from '../utils/logger';

interface ParsedEmail {
    from: string;
    subject: string;
    messageId?: string;
    inReplyTo?: string;
    text: string;
    uid: string;
}

export class EmailChannel implements IChannel {
    public readonly name = 'Email';
    private readonly agent: any;
    private started = false;
    private pollingTimer: NodeJS.Timeout | null = null;
    private processing = false;

    constructor(agent: any) {
        this.agent = agent;
    }

    public async start(): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Email channel not configured. Set SMTP + IMAP credentials first.');
        }
        this.started = true;
        await this.pollOnce();
        const seconds = Number(this.agent.config.get('emailPollIntervalSeconds') || 30);
        this.pollingTimer = setInterval(() => {
            void this.pollOnce();
        }, Math.max(10, seconds) * 1000);
        logger.info(`Email channel started (poll=${Math.max(10, seconds)}s)`);
    }

    public async stop(): Promise<void> {
        this.started = false;
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
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
        const smtpHost = this.agent.config.get('smtpHost');
        const smtpPort = Number(this.agent.config.get('smtpPort') || 587);
        const smtpSecure = this.agent.config.get('smtpSecure') === true;
        const smtpStartTls = this.agent.config.get('smtpStartTls') !== false;
        const smtpUsername = this.agent.config.get('smtpUsername');
        const smtpPassword = this.agent.config.get('smtpPassword');
        const fromAddress = this.agent.config.get('emailAddress') || smtpUsername;
        const fromName = this.agent.config.get('emailFromName') || this.agent.config.get('agentName') || 'OrcBot';

        let socket: tls.TLSSocket | net.Socket;
        try {
            socket = await this.openSocket(smtpHost, smtpPort, smtpSecure);
        } catch (error: any) {
            throw new Error(this.describeSocketError('SMTP', smtpHost, smtpPort, error));
        }
        try {
            await this.readSmtp(socket, [220]);
            await this.sendSmtp(socket, `EHLO orcbot.local`);
            await this.readSmtp(socket, [250]);

            if (!smtpSecure && smtpStartTls) {
                await this.sendSmtp(socket, 'STARTTLS');
                await this.readSmtp(socket, [220]);
                socket = await this.upgradeToTls(socket, smtpHost);
                await this.sendSmtp(socket, `EHLO orcbot.local`);
                await this.readSmtp(socket, [250]);
            }

            if (smtpUsername && smtpPassword) {
                await this.sendSmtp(socket, 'AUTH LOGIN');
                await this.readSmtp(socket, [334]);
                await this.sendSmtp(socket, Buffer.from(String(smtpUsername)).toString('base64'));
                await this.readSmtp(socket, [334]);
                await this.sendSmtp(socket, Buffer.from(String(smtpPassword)).toString('base64'));
                await this.readSmtp(socket, [235]);
            }

            await this.sendSmtp(socket, `MAIL FROM:<${fromAddress}>`);
            await this.readSmtp(socket, [250]);
            await this.sendSmtp(socket, `RCPT TO:<${to}>`);
            await this.readSmtp(socket, [250, 251]);
            await this.sendSmtp(socket, 'DATA');
            await this.readSmtp(socket, [354]);

            const headers = [
                `From: ${fromName} <${fromAddress}>`,
                `To: <${to}>`,
                `Subject: ${subject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
                ...(references ? [`References: ${references}`] : []),
                ''
            ].join('\r\n');

            const escaped = String(message || '').replace(/\r?\n\./g, '\n..');
            socket.write(`${headers}\r\n${escaped}\r\n.\r\n`);
            await this.readSmtp(socket, [250]);
            await this.sendSmtp(socket, 'QUIT');
        } finally {
            socket.end();
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

        const testTo = this.agent.config.get('emailAddress') || this.agent.config.get('smtpUsername');
        logger.info(`Email test: SMTP target mailbox ${testTo ? 'resolved' : 'not set (send skipped)'}`);
        if (testTo) {
            await this.sendEmail(testTo, 'OrcBot email connection test', '✅ SMTP test successful.');
            logger.info('Email test: SMTP send successful');
        }
    }

    public async testImapConnection(): Promise<void> {
        logger.info('Email test: starting IMAP validation');
        const missing = this.getMissingImapConfiguration();
        if (missing.length > 0) {
            throw new Error(`IMAP is missing required settings: ${missing.join(', ')}`);
        }

        await this.pollOnce(true);
        logger.info('Email test: IMAP poll successful');
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

    private async pollOnce(testOnly = false): Promise<void> {
        if (!this.started && !testOnly) return;
        if (this.processing) return;
        this.processing = true;
        try {
            const unseen = await this.fetchUnreadEmails();
            if (!testOnly) {
                for (const email of unseen) {
                    await this.handleInboundEmail(email);
                }
            }
        } catch (e: any) {
            logger.warn(`Email poll failed: ${e?.message || e}. Tip: run \"Test IMAP Connection\" in Email Settings to validate inbound config.`);
            if (testOnly) {
                throw e;
            }
        } finally {
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

        if (!autoReplyEnabled) return;

        await this.agent.pushTask(
            `Respond to email from ${email.from} with subject "${email.subject}": "${(email.text || '').slice(0, 1000)}"`,
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

    private async fetchUnreadEmails(): Promise<ParsedEmail[]> {
        const imapHost = this.agent.config.get('imapHost');
        const imapPort = Number(this.agent.config.get('imapPort') || 993);
        const imapSecure = this.agent.config.get('imapSecure') !== false;
        const imapStartTls = this.agent.config.get('imapStartTls') !== false;
        const imapUsername = this.agent.config.get('imapUsername');
        const imapPassword = this.agent.config.get('imapPassword');

        let socket: tls.TLSSocket | net.Socket;
        try {
            socket = await this.openSocket(imapHost, imapPort, imapSecure);
        } catch (error: any) {
            throw new Error(this.describeSocketError('IMAP', imapHost, imapPort, error));
        }
        const unread: ParsedEmail[] = [];
        let tagId = 1;

        const run = async (command: string, expectOk = true) => {
            const tag = `A${String(tagId++).padStart(4, '0')}`;
            socket.write(`${tag} ${command}\r\n`);
            const output = await this.readImapUntilTag(socket, tag);
            if (expectOk && !new RegExp(`^${tag} OK`, 'm').test(output)) {
                throw new Error(`IMAP command failed (${command}): ${output.slice(-200)}`);
            }
            return output;
        };

        try {
            await this.readImapGreeting(socket);
            if (!imapSecure && imapStartTls) {
                await run('STARTTLS');
                socket = await this.upgradeToTls(socket, imapHost);
            }
            await run(`LOGIN "${this.escapeImap(imapUsername)}" "${this.escapeImap(imapPassword)}"`);
            await run('SELECT INBOX');
            const searchOut = await run('SEARCH UNSEEN');
            const ids = (searchOut.match(/\* SEARCH\s*(.*)/)?.[1] || '')
                .trim()
                .split(/\s+/)
                .filter(Boolean);

            for (const id of ids.slice(0, 10)) {
                const fetchOut = await run(`FETCH ${id} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID IN-REPLY-TO)] BODY.PEEK[TEXT]<0.4000>)`);
                const uid = fetchOut.match(/UID\s+(\d+)/i)?.[1] || id;
                const fromRaw = fetchOut.match(/\nFrom:\s*(.+)/i)?.[1]?.trim() || '';
                const from = this.extractEmailAddress(fromRaw);
                const subject = fetchOut.match(/\nSubject:\s*(.+)/i)?.[1]?.trim() || '(no subject)';
                const messageId = fetchOut.match(/\nMessage-ID:\s*(.+)/i)?.[1]?.trim();
                const inReplyTo = fetchOut.match(/\nIn-Reply-To:\s*(.+)/i)?.[1]?.trim();
                const text = this.extractFetchBodyText(fetchOut);

                unread.push({ from, subject, messageId, inReplyTo, text, uid });
                await run(`STORE ${id} +FLAGS (\\Seen)`);
            }

            await run('LOGOUT', false);
        } finally {
            socket.end();
        }

        return unread.filter(e => e.from && e.text);
    }

    private extractEmailAddress(input: string): string {
        const match = input.match(/<([^>]+)>/);
        return (match?.[1] || input || '').trim().toLowerCase();
    }

    private extractFetchBodyText(fetchOut: string): string {
        const marker = 'BODY[TEXT]';
        const markerIndex = fetchOut.toUpperCase().indexOf(marker);
        if (markerIndex < 0) return '';

        const afterMarker = fetchOut.slice(markerIndex + marker.length);
        const firstNewline = afterMarker.search(/\r?\n/);
        const bodySection = firstNewline >= 0 ? afterMarker.slice(firstNewline + 1) : afterMarker;

        const taggedResultMatch = bodySection.match(/\r?\nA\d+\s+(OK|NO|BAD)\b/i);
        const withoutTaggedResult = taggedResultMatch
            ? bodySection.slice(0, taggedResultMatch.index)
            : bodySection;

        return withoutTaggedResult
            .replace(/^\s*\)\s*/m, '')
            .replace(/\r\n/g, '\n')
            .trim();
    }

    private escapeImap(value: string): string {
        return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private describeSocketError(protocol: 'SMTP' | 'IMAP', host: string, port: number, error: any): string {
        const endpoint = `${String(host || '(missing-host)')}:${Number(port) || 0}`;
        const code = String(error?.code || '').trim();
        const msg = String(error?.message || error || 'Unknown socket error');

        if (code === 'ENOTFOUND') {
            return `${protocol} connection failed: DNS lookup failed for ${endpoint}. Check ${protocol.toLowerCase()} host value.`;
        }
        if (code === 'ECONNREFUSED') {
            return `${protocol} connection failed: ${endpoint} refused the connection. Check port/security mode and firewall rules.`;
        }
        if (code === 'ETIMEDOUT') {
            return `${protocol} connection failed: timeout reaching ${endpoint}. Check network access and server reachability.`;
        }

        return `${protocol} connection failed for ${endpoint}: ${msg}`;
    }

    private openSocket(host: string, port: number, secure: boolean): Promise<tls.TLSSocket | net.Socket> {
        return new Promise((resolve, reject) => {
            const timeoutMs = this.getSocketTimeoutMs();
            const socket = secure
                ? tls.connect({ host, port, servername: host })
                : net.connect({ host, port });

            let settled = false;
            const cleanup = () => {
                socket.off('connect', onConnect);
                socket.off('secureConnect', onConnect);
                socket.off('error', onError);
                socket.off('timeout', onTimeout);
                socket.setTimeout(0);
            };
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn();
            };
            const onConnect = () => finish(() => resolve(socket));
            const onError = (err: any) => finish(() => reject(err));
            const onTimeout = () => finish(() => reject(new Error(`Socket connection timeout after ${timeoutMs}ms`)));

            socket.setTimeout(timeoutMs);
            socket.once('connect', onConnect);
            socket.once('secureConnect', onConnect);
            socket.once('error', onError);
            socket.once('timeout', onTimeout);
        });
    }

    private async readImapGreeting(socket: tls.TLSSocket | net.Socket): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            const timeoutMs = this.getSocketTimeoutMs();
            const onData = (chunk: Buffer) => {
                data += chunk.toString('utf8');
                if (data.includes('\r\n')) {
                    cleanup();
                    resolve(data);
                }
            };
            const onError = (err: any) => { cleanup(); reject(err); };
            const onTimeout = () => { cleanup(); reject(new Error(`IMAP greeting timeout after ${timeoutMs}ms`)); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('timeout', onTimeout);
                socket.setTimeout(0);
            };
            socket.setTimeout(timeoutMs);
            socket.on('data', onData);
            socket.on('error', onError);
            socket.on('timeout', onTimeout);
        });
    }

    private async readImapUntilTag(socket: tls.TLSSocket | net.Socket, tag: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            const timeoutMs = this.getSocketTimeoutMs();
            const regex = new RegExp(`\\r?\\n${tag} (OK|NO|BAD)`, 'i');
            const onData = (chunk: Buffer) => {
                data += chunk.toString('utf8');
                if (regex.test(data) || data.startsWith(`${tag} `)) {
                    cleanup();
                    resolve(data);
                }
            };
            const onError = (err: any) => { cleanup(); reject(err); };
            const onTimeout = () => { cleanup(); reject(new Error(`IMAP command timeout after ${timeoutMs}ms (${tag})`)); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('timeout', onTimeout);
                socket.setTimeout(0);
            };
            socket.setTimeout(timeoutMs);
            socket.on('data', onData);
            socket.on('error', onError);
            socket.on('timeout', onTimeout);
        });
    }

    private async sendSmtp(socket: tls.TLSSocket | net.Socket, command: string): Promise<void> {
        socket.write(`${command}\r\n`);
    }

    private async readSmtp(socket: tls.TLSSocket | net.Socket, expectedCodes: number[]): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            const timeoutMs = this.getSocketTimeoutMs();
            const onData = (chunk: Buffer) => {
                data += chunk.toString('utf8');
                const lines = data.split(/\r?\n/).filter(Boolean);
                const last = lines[lines.length - 1] || '';
                if (!/^\d{3}[ -]/.test(last)) return;
                if (/^\d{3} /.test(last)) {
                    cleanup();
                    const code = Number(last.slice(0, 3));
                    if (!expectedCodes.includes(code)) {
                        reject(new Error(`SMTP unexpected response ${code}: ${last}`));
                        return;
                    }
                    resolve(data);
                }
            };
            const onError = (err: any) => { cleanup(); reject(err); };
            const onTimeout = () => { cleanup(); reject(new Error(`SMTP response timeout after ${timeoutMs}ms`)); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('timeout', onTimeout);
                socket.setTimeout(0);
            };
            socket.setTimeout(timeoutMs);
            socket.on('data', onData);
            socket.on('error', onError);
            socket.on('timeout', onTimeout);
        });
    }

    private getSocketTimeoutMs(): number {
        const configured = Number(this.agent.config.get('emailSocketTimeoutMs'));
        if (!Number.isFinite(configured) || configured <= 0) return 15000;
        return Math.max(3000, configured);
    }

    private async upgradeToTls(socket: tls.TLSSocket | net.Socket, host: string): Promise<tls.TLSSocket> {
        return new Promise((resolve, reject) => {
            const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
            secureSocket.once('error', reject);
        });
    }
}
