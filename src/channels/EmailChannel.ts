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
        const smtpSecure = !!this.agent.config.get('smtpSecure');
        const smtpUsername = this.agent.config.get('smtpUsername');
        const smtpPassword = this.agent.config.get('smtpPassword');
        const fromAddress = this.agent.config.get('emailAddress') || smtpUsername;
        const fromName = this.agent.config.get('emailFromName') || this.agent.config.get('agentName') || 'OrcBot';

        const socket = await this.openSocket(smtpHost, smtpPort, smtpSecure);
        try {
            await this.readSmtp(socket, [220]);
            await this.sendSmtp(socket, `EHLO orcbot.local`);
            await this.readSmtp(socket, [250]);

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
        const testTo = this.agent.config.get('emailAddress') || this.agent.config.get('smtpUsername');
        if (testTo) {
            await this.sendEmail(testTo, 'OrcBot email connection test', '✅ SMTP test successful.');
        }
        await this.pollOnce(true);
    }

    private isConfigured(): boolean {
        return !!(this.agent.config.get('emailEnabled')
            && this.agent.config.get('smtpHost')
            && this.agent.config.get('smtpUsername')
            && this.agent.config.get('smtpPassword')
            && this.agent.config.get('imapHost')
            && this.agent.config.get('imapUsername')
            && this.agent.config.get('imapPassword'));
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
            logger.warn(`Email poll failed: ${e?.message || e}`);
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
        const imapUsername = this.agent.config.get('imapUsername');
        const imapPassword = this.agent.config.get('imapPassword');

        const socket = await this.openSocket(imapHost, imapPort, imapSecure);
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
                const bodyStart = fetchOut.toLowerCase().lastIndexOf('in-reply-to:');
                const text = fetchOut.slice(Math.max(bodyStart, 0)).split('\r\n').slice(6).join('\n').trim();

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

    private escapeImap(value: string): string {
        return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private openSocket(host: string, port: number, secure: boolean): Promise<tls.TLSSocket | net.Socket> {
        return new Promise((resolve, reject) => {
            const onError = (err: any) => reject(err);
            if (secure) {
                const socket = tls.connect({ host, port, servername: host }, () => resolve(socket));
                socket.once('error', onError);
            } else {
                const socket = net.connect({ host, port }, () => resolve(socket));
                socket.once('error', onError);
            }
        });
    }

    private async readImapGreeting(socket: tls.TLSSocket | net.Socket): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            const onData = (chunk: Buffer) => {
                data += chunk.toString('utf8');
                if (data.includes('\r\n')) {
                    cleanup();
                    resolve(data);
                }
            };
            const onError = (err: any) => { cleanup(); reject(err); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
            };
            socket.on('data', onData);
            socket.on('error', onError);
        });
    }

    private async readImapUntilTag(socket: tls.TLSSocket | net.Socket, tag: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            const regex = new RegExp(`\\r?\\n${tag} (OK|NO|BAD)`, 'i');
            const onData = (chunk: Buffer) => {
                data += chunk.toString('utf8');
                if (regex.test(data) || data.startsWith(`${tag} `)) {
                    cleanup();
                    resolve(data);
                }
            };
            const onError = (err: any) => { cleanup(); reject(err); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
            };
            socket.on('data', onData);
            socket.on('error', onError);
        });
    }

    private async sendSmtp(socket: tls.TLSSocket | net.Socket, command: string): Promise<void> {
        socket.write(`${command}\r\n`);
    }

    private async readSmtp(socket: tls.TLSSocket | net.Socket, expectedCodes: number[]): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
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
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
            };
            socket.on('data', onData);
            socket.on('error', onError);
        });
    }
}
