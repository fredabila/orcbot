import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TokenTracker, TokenUsageEntry } from '../src/core/TokenTracker';

const tmpDir = path.join(os.tmpdir(), `orcbot-token-test-${Date.now()}`);
const summaryPath = path.join(tmpDir, 'summary.json');
const logPath = path.join(tmpDir, 'usage.log');

function makeEntry(overrides: Partial<TokenUsageEntry> = {}): TokenUsageEntry {
    return {
        ts: new Date().toISOString(),
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        metadata: { estimated: false },
        ...overrides
    };
}

describe('TokenTracker', () => {
    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    });

    describe('basic recording', () => {
        it('records an entry and updates summary', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry());
            const summary = tracker.getSummary();
            expect(summary.totals.totalTokens).toBe(150);
            expect(summary.totals.promptTokens).toBe(100);
            expect(summary.totals.completionTokens).toBe(50);
        });

        it('accumulates multiple entries', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ promptTokens: 200, completionTokens: 100, totalTokens: 300 }));
            tracker.record(makeEntry({ promptTokens: 50, completionTokens: 25, totalTokens: 75 }));
            const summary = tracker.getSummary();
            expect(summary.totals.totalTokens).toBe(375);
        });

        it('tracks by provider', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ provider: 'openai' }));
            tracker.record(makeEntry({ provider: 'google' }));
            const summary = tracker.getSummary();
            expect(summary.byProvider['openai'].totalTokens).toBe(150);
            expect(summary.byProvider['google'].totalTokens).toBe(150);
        });

        it('tracks by model', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ model: 'gpt-4o' }));
            tracker.record(makeEntry({ model: 'gemini-pro' }));
            const summary = tracker.getSummary();
            expect(summary.byModel['gpt-4o'].totalTokens).toBe(150);
            expect(summary.byModel['gemini-pro'].totalTokens).toBe(150);
        });

        it('tracks daily', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ ts: '2026-01-15T12:00:00Z' }));
            tracker.record(makeEntry({ ts: '2026-01-16T12:00:00Z' }));
            const summary = tracker.getSummary();
            expect(summary.daily['2026-01-15'].totalTokens).toBe(150);
            expect(summary.daily['2026-01-16'].totalTokens).toBe(150);
        });

        it('appends to log file', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry());
            tracker.record(makeEntry());
            const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
            expect(logLines.length).toBe(2);
            const parsed = JSON.parse(logLines[0]);
            expect(parsed.promptTokens).toBe(100);
        });
    });

    describe('real vs estimated tracking', () => {
        it('separates real API-reported tokens from estimated', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ metadata: { estimated: false } }));
            tracker.record(makeEntry({ promptTokens: 500, completionTokens: 200, totalTokens: 700, metadata: { estimated: true } }));
            const summary = tracker.getSummary();

            expect(summary.realTotals.totalTokens).toBe(150);
            expect(summary.realTotals.callCount).toBe(1);
            expect(summary.estimatedTotals.totalTokens).toBe(700);
            expect(summary.estimatedTotals.callCount).toBe(1);
            expect(summary.totals.totalTokens).toBe(850);
        });

        it('tracks real vs estimated per provider', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ provider: 'openai', metadata: { estimated: false } }));
            tracker.record(makeEntry({ provider: 'openai', promptTokens: 500, completionTokens: 200, totalTokens: 700, metadata: { estimated: true } }));
            const summary = tracker.getSummary();

            const prov = summary.byProvider['openai'];
            expect(prov.real.totalTokens).toBe(150);
            expect(prov.real.callCount).toBe(1);
            expect(prov.estimated.totalTokens).toBe(700);
            expect(prov.estimated.callCount).toBe(1);
        });

        it('tracks real vs estimated per model', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ model: 'gpt-4o', metadata: { estimated: false } }));
            tracker.record(makeEntry({ model: 'gpt-4o', metadata: { estimated: true } }));
            const summary = tracker.getSummary();

            expect(summary.byModel['gpt-4o'].real.callCount).toBe(1);
            expect(summary.byModel['gpt-4o'].estimated.callCount).toBe(1);
        });

        it('tracks real vs estimated per day', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ ts: '2026-02-10T10:00:00Z', metadata: { estimated: false } }));
            tracker.record(makeEntry({ ts: '2026-02-10T14:00:00Z', metadata: { estimated: true } }));
            const summary = tracker.getSummary();

            const day = summary.daily['2026-02-10'];
            expect(day.real.callCount).toBe(1);
            expect(day.estimated.callCount).toBe(1);
        });
    });

    describe('accuracy report', () => {
        it('returns 0% when no data', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            const report = tracker.getAccuracyReport();
            expect(report.realPct).toBe(0);
            expect(report.estimatedPct).toBe(0);
            expect(report.totalCalls).toBe(0);
        });

        it('shows 100% real when all calls have API usage data', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ metadata: { estimated: false } }));
            tracker.record(makeEntry({ metadata: { estimated: false } }));
            const report = tracker.getAccuracyReport();
            expect(report.realPct).toBe(100);
            expect(report.estimatedPct).toBe(0);
            expect(report.realCalls).toBe(2);
        });

        it('shows mixed real/estimated percentages', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            // 300 real tokens
            tracker.record(makeEntry({ promptTokens: 200, completionTokens: 100, totalTokens: 300, metadata: { estimated: false } }));
            // 100 estimated tokens
            tracker.record(makeEntry({ promptTokens: 60, completionTokens: 40, totalTokens: 100, metadata: { estimated: true } }));
            const report = tracker.getAccuracyReport();
            expect(report.realPct).toBe(75); // 300 / 400
            expect(report.estimatedPct).toBe(25);
            expect(report.totalCalls).toBe(2);
        });
    });

    describe('session usage', () => {
        it('tracks session-scoped usage', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            expect(tracker.getSessionUsage().callCount).toBe(0);
            tracker.record(makeEntry());
            tracker.record(makeEntry());
            const session = tracker.getSessionUsage();
            expect(session.callCount).toBe(2);
            expect(session.totalTokens).toBe(300);
            expect(session.startedAt).toBeTruthy();
        });
    });

    describe('recount from log', () => {
        it('rebuilds summary from the raw log', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry({ metadata: { estimated: false } }));
            tracker.record(makeEntry({ metadata: { estimated: true } }));

            // Corrupt the summary manually
            const corrupted = tracker.getSummary();
            corrupted.totals.totalTokens = 999999;
            fs.writeFileSync(summaryPath, JSON.stringify(corrupted));

            // Recount should fix it
            const rebuilt = tracker.recountFromLog();
            expect(rebuilt.totals.totalTokens).toBe(300);
            expect(rebuilt.realTotals.callCount).toBe(1);
            expect(rebuilt.estimatedTotals.callCount).toBe(1);
        });

        it('handles empty log gracefully', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            const result = tracker.recountFromLog();
            expect(result.totals.totalTokens).toBe(0);
        });

        it('skips malformed log lines', () => {
            fs.writeFileSync(logPath, '{"bad json\n' + JSON.stringify(makeEntry()) + '\n');
            const tracker = new TokenTracker(summaryPath, logPath);
            const result = tracker.recountFromLog();
            expect(result.totals.totalTokens).toBe(150); // only the valid line
        });
    });

    describe('backward compatibility', () => {
        it('migrates old summary format lacking real/estimated buckets', () => {
            // Write an old-format summary
            const oldSummary = {
                totals: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
                byProvider: { openai: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } },
                byModel: { 'gpt-4o': { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } },
                daily: {},
                lastUpdated: '2026-01-01T00:00:00Z'
            };
            fs.writeFileSync(summaryPath, JSON.stringify(oldSummary));

            const tracker = new TokenTracker(summaryPath, logPath);
            const summary = tracker.getSummary();

            // Should have zero-initialized real/estimated totals (migrated)
            expect(summary.realTotals).toBeDefined();
            expect(summary.estimatedTotals).toBeDefined();
            expect(summary.realTotals.callCount).toBe(0);
            expect(summary.totals.totalTokens).toBe(1500); // original data preserved
        });

        it('getTotalUsage returns same as getSummary', () => {
            const tracker = new TokenTracker(summaryPath, logPath);
            tracker.record(makeEntry());
            const a = tracker.getSummary();
            const b = tracker.getTotalUsage();
            expect(a.totals.totalTokens).toBe(b.totals.totalTokens);
        });
    });
});
