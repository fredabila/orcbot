import { describe, expect, it, vi } from 'vitest';
import { GoogleWorkspaceCli } from '../src/core/GoogleWorkspaceCli';

class StubConfig {
    constructor(private values: Record<string, any> = {}) {}

    get(key: string) {
        return this.values[key];
    }
}

describe('GoogleWorkspaceCli', () => {
    it('returns unavailable status when binary is missing', async () => {
        const cli = new GoogleWorkspaceCli(new StubConfig() as any, {
            resolveBinary: () => null,
        });

        const status = await cli.getStatus();
        expect(status.installed).toBe(false);
    });

    it('runs structured commands and parses JSON output', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify({ files: [{ id: '1', name: 'Report' }] }), '');
        });

        const cli = new GoogleWorkspaceCli(new StubConfig({ googleWorkspaceCliAccount: 'agent@example.com' }) as any, {
            resolveBinary: () => 'gws',
            execFile,
        });

        const result = await cli.listDriveFiles({ query: "name contains 'Report'", pageSize: 5 });

        expect(result.success).toBe(true);
        expect(result.data.files[0].name).toBe('Report');
        expect(execFile).toHaveBeenCalledOnce();
        expect(execFile.mock.calls[0][0]).toBe('gws');
        expect(execFile.mock.calls[0][1]).toContain('--account');
        expect(execFile.mock.calls[0][1]).toContain('agent@example.com');
        expect(execFile.mock.calls[0][1]).toContain('--format');
        expect(execFile.mock.calls[0][1]).toContain('json');
    });

    it('surfaces command errors cleanly', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(new Error('boom'), '', 'permission denied');
        });

        const cli = new GoogleWorkspaceCli(new StubConfig() as any, {
            resolveBinary: () => 'gws',
            execFile,
        });

        const result = await cli.run(['auth', 'status'], { json: true });
        expect(result.success).toBe(false);
        expect(result.error).toContain('permission denied');
    });

    it('builds gmail helper commands with account and dry-run flags', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify({ ok: true }), '');
        });

        const cli = new GoogleWorkspaceCli(new StubConfig({ googleWorkspaceCliAccount: 'agent@example.com' }) as any, {
            resolveBinary: () => 'gws',
            execFile,
        });

        const result = await cli.sendGmail({
            to: ['alice@example.com', 'bob@example.com'],
            subject: 'Hello',
            body: 'Hi team',
            cc: 'carol@example.com',
            dryRun: true,
        });

        expect(result.success).toBe(true);
        expect(execFile).toHaveBeenCalledOnce();
        expect(execFile.mock.calls[0][1]).toEqual([
            '--account',
            'agent@example.com',
            '--format',
            'json',
            'gmail',
            '+send',
            '--to',
            'alice@example.com,bob@example.com',
            '--subject',
            'Hello',
            '--body',
            'Hi team',
            '--cc',
            'carol@example.com',
            '--dry-run',
        ]);
    });

    it('uses helper syntax for sheets append and calendar insert', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify({ ok: true }), '');
        });

        const cli = new GoogleWorkspaceCli(new StubConfig() as any, {
            resolveBinary: () => 'gws',
            execFile,
        });

        await cli.appendSheet({
            spreadsheetId: 'sheet123',
            jsonValues: [['Alice', 'Ready']],
        });

        await cli.createCalendarEvent({
            summary: 'Review',
            start: '2026-06-17T09:00:00Z',
            end: '2026-06-17T09:30:00Z',
            attendees: ['alice@example.com'],
        });

        expect(execFile).toHaveBeenCalledTimes(2);
        expect(execFile.mock.calls[0][1]).toEqual([
            '--format',
            'json',
            'sheets',
            '+append',
            '--spreadsheet',
            'sheet123',
            '--json-values',
            '[["Alice","Ready"]]',
        ]);
        expect(execFile.mock.calls[1][1]).toEqual([
            '--format',
            'json',
            'calendar',
            '+insert',
            '--summary',
            'Review',
            '--start',
            '2026-06-17T09:00:00Z',
            '--end',
            '2026-06-17T09:30:00Z',
            '--attendee',
            'alice@example.com',
        ]);
    });
});