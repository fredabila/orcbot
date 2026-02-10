import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';

export interface TokenUsageEntry {
    ts: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    metadata?: Record<string, any>;
}

export interface TokenBucket {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface AccuracyBucket extends TokenBucket {
    /** Number of API calls that contributed to this bucket */
    callCount: number;
}

export interface TokenUsageSummary {
    totals: TokenBucket;
    /** Tokens from API-reported usage data (accurate) */
    realTotals: AccuracyBucket;
    /** Tokens from heuristic estimation (inaccurate — no API usage data was returned) */
    estimatedTotals: AccuracyBucket;
    byProvider: Record<string, TokenBucket & { real: AccuracyBucket; estimated: AccuracyBucket }>;
    byModel: Record<string, TokenBucket & { real: AccuracyBucket; estimated: AccuracyBucket }>;
    daily: Record<string, TokenBucket & { real: AccuracyBucket; estimated: AccuracyBucket }>;
    lastUpdated: string;
}

// Session-scoped counters (reset on process restart)
interface SessionUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    callCount: number;
    startedAt: string;
}

export class TokenTracker {
    private summaryPath: string;
    private logPath: string;
    private sessionUsage: SessionUsage;

    constructor(summaryPath?: string, logPath?: string) {
        const dataHome = process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        this.summaryPath = summaryPath || path.join(dataHome, 'token-usage-summary.json');
        this.logPath = logPath || path.join(dataHome, 'token-usage.log');
        this.sessionUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            callCount: 0,
            startedAt: new Date().toISOString()
        };
    }

    public record(entry: TokenUsageEntry) {
        try {
            this.appendLog(entry);
            const summary = this.loadSummary();
            this.applyToSummary(summary, entry);
            summary.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));

            // Update session counters
            this.sessionUsage.promptTokens += entry.promptTokens;
            this.sessionUsage.completionTokens += entry.completionTokens;
            this.sessionUsage.totalTokens += entry.totalTokens;
            this.sessionUsage.callCount++;
        } catch (e) {
            logger.warn(`TokenTracker: Failed to record usage: ${e}`);
        }
    }

    public getSummary(): TokenUsageSummary {
        return this.loadSummary();
    }

    /** Returns token usage for the current process session only */
    public getSessionUsage(): SessionUsage {
        return { ...this.sessionUsage };
    }

    /** Alias for getSummary() — returns all-time totals */
    public getTotalUsage(): TokenUsageSummary {
        return this.loadSummary();
    }

    /**
     * Rebuild the summary from the raw log file.
     * Use this to correct inflated numbers if the summary got out of sync.
     */
    public recountFromLog(): TokenUsageSummary {
        const summary = this.emptySummary();
        try {
            if (!fs.existsSync(this.logPath)) return summary;
            const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line) as TokenUsageEntry;
                    this.applyToSummary(summary, entry);
                } catch { /* skip malformed lines */ }
            }
            summary.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
            logger.info(`TokenTracker: Recounted ${lines.length} log entries`);
        } catch (e) {
            logger.warn(`TokenTracker: Failed to recount from log: ${e}`);
        }
        return summary;
    }

    /**
     * Returns what percentage of tracked tokens came from real API data vs estimates.
     */
    public getAccuracyReport(): { realPct: number; estimatedPct: number; realCalls: number; estimatedCalls: number; totalCalls: number } {
        const summary = this.loadSummary();
        const realTotal = summary.realTotals?.totalTokens || 0;
        const estTotal = summary.estimatedTotals?.totalTokens || 0;
        const combined = realTotal + estTotal;
        return {
            realPct: combined > 0 ? Math.round((realTotal / combined) * 100) : 0,
            estimatedPct: combined > 0 ? Math.round((estTotal / combined) * 100) : 0,
            realCalls: summary.realTotals?.callCount || 0,
            estimatedCalls: summary.estimatedTotals?.callCount || 0,
            totalCalls: (summary.realTotals?.callCount || 0) + (summary.estimatedTotals?.callCount || 0)
        };
    }

    private appendLog(entry: TokenUsageEntry) {
        try {
            const line = JSON.stringify(entry);
            fs.appendFileSync(this.logPath, line + '\n');
        } catch (e) {
            logger.warn(`TokenTracker: Failed to append log: ${e}`);
        }
    }

    private loadSummary(): TokenUsageSummary {
        try {
            if (fs.existsSync(this.summaryPath)) {
                const raw = fs.readFileSync(this.summaryPath, 'utf8');
                const parsed = JSON.parse(raw) as TokenUsageSummary;
                // Migrate old summaries that lack real/estimated buckets
                if (!parsed.realTotals) {
                    parsed.realTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
                }
                if (!parsed.estimatedTotals) {
                    parsed.estimatedTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
                }
                return parsed;
            }
        } catch (e) {
            logger.warn(`TokenTracker: Failed to read summary: ${e}`);
        }

        return this.emptySummary();
    }

    private emptySummary(): TokenUsageSummary {
        return {
            totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            realTotals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
            estimatedTotals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
            byProvider: {},
            byModel: {},
            daily: {},
            lastUpdated: new Date().toISOString()
        };
    }

    private ensureAccuracyBuckets(bucket: any) {
        if (!bucket.real) bucket.real = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
        if (!bucket.estimated) bucket.estimated = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
    }

    private applyToSummary(summary: TokenUsageSummary, entry: TokenUsageEntry) {
        const { provider, model, promptTokens, completionTokens, totalTokens } = entry;
        const isEstimated = entry.metadata?.estimated === true;

        // --- Grand totals ---
        summary.totals.promptTokens += promptTokens;
        summary.totals.completionTokens += completionTokens;
        summary.totals.totalTokens += totalTokens;

        // --- Real vs estimated totals ---
        const accuracyTarget = isEstimated ? summary.estimatedTotals : summary.realTotals;
        accuracyTarget.promptTokens += promptTokens;
        accuracyTarget.completionTokens += completionTokens;
        accuracyTarget.totalTokens += totalTokens;
        accuracyTarget.callCount++;

        // --- By provider ---
        if (!summary.byProvider[provider]) {
            summary.byProvider[provider] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
        }
        this.ensureAccuracyBuckets(summary.byProvider[provider]);
        summary.byProvider[provider].promptTokens += promptTokens;
        summary.byProvider[provider].completionTokens += completionTokens;
        summary.byProvider[provider].totalTokens += totalTokens;
        const provAccuracy = isEstimated ? summary.byProvider[provider].estimated : summary.byProvider[provider].real;
        provAccuracy.promptTokens += promptTokens;
        provAccuracy.completionTokens += completionTokens;
        provAccuracy.totalTokens += totalTokens;
        provAccuracy.callCount++;

        // --- By model ---
        if (!summary.byModel[model]) {
            summary.byModel[model] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
        }
        this.ensureAccuracyBuckets(summary.byModel[model]);
        summary.byModel[model].promptTokens += promptTokens;
        summary.byModel[model].completionTokens += completionTokens;
        summary.byModel[model].totalTokens += totalTokens;
        const modelAccuracy = isEstimated ? summary.byModel[model].estimated : summary.byModel[model].real;
        modelAccuracy.promptTokens += promptTokens;
        modelAccuracy.completionTokens += completionTokens;
        modelAccuracy.totalTokens += totalTokens;
        modelAccuracy.callCount++;

        // --- Daily ---
        const day = entry.ts.slice(0, 10);
        if (!summary.daily[day]) {
            summary.daily[day] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
        }
        this.ensureAccuracyBuckets(summary.daily[day]);
        summary.daily[day].promptTokens += promptTokens;
        summary.daily[day].completionTokens += completionTokens;
        summary.daily[day].totalTokens += totalTokens;
        const dayAccuracy = isEstimated ? summary.daily[day].estimated : summary.daily[day].real;
        dayAccuracy.promptTokens += promptTokens;
        dayAccuracy.completionTokens += completionTokens;
        dayAccuracy.totalTokens += totalTokens;
        dayAccuracy.callCount++;
    }
}
