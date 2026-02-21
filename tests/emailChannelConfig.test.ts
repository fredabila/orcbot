import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../src/channels/EmailChannel';

describe('EmailChannel configuration checks', () => {
    it('reports missing required config keys', () => {
        const cfg: Record<string, any> = {
            emailEnabled: true,
            smtpHost: 'smtp.example.com'
        };
        const channel = new EmailChannel({ config: { get: (k: string) => cfg[k] } });
        const missing = (channel as any).getMissingConfiguration();
        expect(missing).toContain('smtpUsername');
        expect(missing).toContain('imapHost');
    });

    it('reports missing smtp-only settings independently', () => {
        const cfg: Record<string, any> = {
            emailEnabled: true,
            imapHost: 'imap.example.com',
            imapUsername: 'imap-user',
            imapPassword: 'imap-pass'
        };
        const channel = new EmailChannel({ config: { get: (k: string) => cfg[k] } });
        const missing = (channel as any).getMissingSmtpConfiguration();
        expect(missing).toContain('smtpHost');
        expect(missing).not.toContain('imapHost');
    });

    it('reports missing imap-only settings independently', () => {
        const cfg: Record<string, any> = {
            emailEnabled: true,
            smtpHost: 'smtp.example.com',
            smtpUsername: 'smtp-user',
            smtpPassword: 'smtp-pass'
        };
        const channel = new EmailChannel({ config: { get: (k: string) => cfg[k] } });
        const missing = (channel as any).getMissingImapConfiguration();
        expect(missing).toContain('imapHost');
        expect(missing).not.toContain('smtpHost');
    });


    it('formats ENOTFOUND socket errors with endpoint guidance', () => {
        const channel = new EmailChannel({ config: { get: () => undefined } });
        const message = (channel as any).describeSocketError('IMAP', 'imap.badhost.local', 993, { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });
        expect(message).toContain('DNS lookup failed');
        expect(message).toContain('imap.badhost.local:993');
    });


    it('rethrows poll failures during explicit IMAP tests', async () => {
        const channel = new EmailChannel({ config: { get: () => undefined } });
        (channel as any).fetchUnreadEmails = async () => { throw new Error('imap boom'); };
        await expect((channel as any).pollOnce(true)).rejects.toThrow('imap boom');
    });

    it('uses minimum timeout floor when timeout is too low', () => {
        const channel = new EmailChannel({ config: { get: (k: string) => (k === 'emailSocketTimeoutMs' ? 100 : undefined) } });
        expect((channel as any).getSocketTimeoutMs()).toBe(3000);
    });
});
