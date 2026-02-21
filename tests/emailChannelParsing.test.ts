import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../src/channels/EmailChannel';

describe('EmailChannel body parsing', () => {
    it('extracts short reply content without relying on a fixed header offset', () => {
        const channel = new EmailChannel({ config: { get: () => undefined } });
        const fetchOut = [
            '* 1 FETCH (UID 77 BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID IN-REPLY-TO)] {120}',
            'From: Alice <alice@example.com>',
            'Subject: Re: Ping',
            'Message-ID: <m1@example.com>',
            'In-Reply-To: <m0@example.com>',
            '',
            ' BODY[TEXT] {5}',
            'ok',
            ')',
            'A0002 OK FETCH completed',
            ''
        ].join('\r\n');

        const text = (channel as any).extractFetchBodyText(fetchOut);
        expect(text).toBe('ok');
    });

    it('returns empty string when BODY[TEXT] section is absent', () => {
        const channel = new EmailChannel({ config: { get: () => undefined } });
        const fetchOut = '* 1 FETCH (UID 77 BODY[HEADER.FIELDS (FROM SUBJECT)] {25}\r\nSubject: Hello\r\n)\r\nA0002 OK FETCH completed\r\n';

        const text = (channel as any).extractFetchBodyText(fetchOut);
        expect(text).toBe('');
    });
});
