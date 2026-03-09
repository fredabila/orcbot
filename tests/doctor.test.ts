import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { collectDoctorReport } from '../src/cli/Doctor';

function makeConfig(overrides: Record<string, any> = {}) {
    const values: Record<string, any> = {
        gatewayHost: '0.0.0.0',
        gatewayPort: 3100,
        gatewayApiKey: undefined,
        gatewayCorsOrigins: ['*'],
        safeMode: false,
        sudoMode: false,
        autoExecuteCommands: false,
        sessionScope: 'per-channel-peer',
        pluginAllowList: [],
        pluginDenyList: [],
        pluginsPath: 'D:/orcbot-test/plugins',
        modelName: 'gpt-4o',
        llmProvider: 'openai',
        openaiApiKey: 'sk-test-1234567890123456',
        telegramToken: undefined,
        whatsappEnabled: false,
        discordToken: undefined,
        slackBotToken: undefined,
        emailEnabled: false,
        ...overrides
    };

    return {
        get: vi.fn((key: string) => values[key]),
        getDataHome: vi.fn(() => 'D:/orcbot-test')
    } as any;
}

describe('collectDoctorReport', () => {
    it('flags non-loopback gateway without auth as critical', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => String(target).includes('D:/orcbot-test'));
        vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const report = collectDoctorReport(makeConfig());
        expect(report.findings.some(f => f.id === 'gateway.bind_no_auth' && f.severity === 'critical')).toBe(true);
    });

    it('flags sudo mode and auto execute as critical', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => String(target).includes('D:/orcbot-test'));
        vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const report = collectDoctorReport(makeConfig({ sudoMode: true, autoExecuteCommands: true }));
        expect(report.findings.some(f => f.id === 'security.sudo_mode_enabled')).toBe(true);
        expect(report.findings.some(f => f.id === 'security.auto_execute_commands')).toBe(true);
    });

    it('warns when session scope is main and plugins are unrestricted', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => {
            const value = String(target);
            return value.includes('D:/orcbot-test') || value.endsWith('plugins');
        });
        vi.spyOn(fs, 'readdirSync').mockReturnValue(['sample-plugin.js'] as any);

        const report = collectDoctorReport(makeConfig({
            gatewayHost: '127.0.0.1',
            gatewayApiKey: '1234567890123456',
            sessionScope: 'main',
            telegramToken: 'token',
            llmProvider: 'openai'
        }));

        expect(report.findings.some(f => f.id === 'security.session_scope_main')).toBe(true);
        expect(report.findings.some(f => f.id === 'security.plugins_unrestricted')).toBe(true);
    });

    it('flags selected provider mismatch', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => String(target).includes('D:/orcbot-test'));
        vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const report = collectDoctorReport(makeConfig({
            llmProvider: 'anthropic',
            openaiApiKey: undefined,
            anthropicApiKey: undefined
        }));

        expect(report.findings.some(f => f.id === 'providers.selected_provider_unconfigured')).toBe(true);
    });

    it('flags stale runtime lock and daemon pid files', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => {
            const value = String(target);
            return value.includes('D:/orcbot-test') || value.endsWith('orcbot.lock') || value.endsWith('orcbot.pid');
        });
        vi.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        vi.spyOn(fs, 'readFileSync').mockImplementation((target: fs.PathLike) => {
            const value = String(target);
            if (value.endsWith('orcbot.lock')) {
                return JSON.stringify({ pid: 999991, startedAt: '2026-03-08T00:00:00.000Z', host: 'test-host', cwd: 'D:/orcbot' }) as any;
            }
            if (value.endsWith('orcbot.pid')) {
                return '999992' as any;
            }
            throw new Error(`Unexpected read: ${value}`);
        });

        const report = collectDoctorReport(makeConfig({ gatewayHost: '127.0.0.1', gatewayApiKey: '1234567890123456' }));

        expect(report.findings.some(f => f.id === 'runtime.stale_lock_file')).toBe(true);
        expect(report.findings.some(f => f.id === 'runtime.stale_daemon_pid_file')).toBe(true);
        expect(report.facts.runtime.lockFilePresent).toBe(true);
        expect(report.facts.runtime.daemonPidFilePresent).toBe(true);
    });
});