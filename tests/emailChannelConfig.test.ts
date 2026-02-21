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

    it('uses minimum timeout floor when timeout is too low', () => {
        const channel = new EmailChannel({ config: { get: (k: string) => (k === 'emailSocketTimeoutMs' ? 100 : undefined) } });
        expect((channel as any).getSocketTimeoutMs()).toBe(3000);
    });
});
