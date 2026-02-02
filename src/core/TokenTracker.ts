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

export interface TokenUsageSummary {
    totals: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    byProvider: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number }>;
    byModel: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number }>;
    daily: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number }>;
    lastUpdated: string;
}

export class TokenTracker {
    private summaryPath: string;
    private logPath: string;

    constructor(summaryPath?: string, logPath?: string) {
        const dataHome = process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot');
        this.summaryPath = summaryPath || path.join(dataHome, 'token-usage-summary.json');
        this.logPath = logPath || path.join(dataHome, 'token-usage.log');
    }

    public record(entry: TokenUsageEntry) {
        try {
            this.appendLog(entry);
            const summary = this.loadSummary();
            this.applyToSummary(summary, entry);
            summary.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
        } catch (e) {
            logger.warn(`TokenTracker: Failed to record usage: ${e}`);
        }
    }

    public getSummary(): TokenUsageSummary {
        return this.loadSummary();
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
                return JSON.parse(raw) as TokenUsageSummary;
            }
        } catch (e) {
            logger.warn(`TokenTracker: Failed to read summary: ${e}`);
        }

        return {
            totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            byProvider: {},
            byModel: {},
            daily: {},
            lastUpdated: new Date().toISOString()
        };
    }

    private applyToSummary(summary: TokenUsageSummary, entry: TokenUsageEntry) {
        const { provider, model, promptTokens, completionTokens, totalTokens } = entry;
        summary.totals.promptTokens += promptTokens;
        summary.totals.completionTokens += completionTokens;
        summary.totals.totalTokens += totalTokens;

        if (!summary.byProvider[provider]) {
            summary.byProvider[provider] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        summary.byProvider[provider].promptTokens += promptTokens;
        summary.byProvider[provider].completionTokens += completionTokens;
        summary.byProvider[provider].totalTokens += totalTokens;

        if (!summary.byModel[model]) {
            summary.byModel[model] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        summary.byModel[model].promptTokens += promptTokens;
        summary.byModel[model].completionTokens += completionTokens;
        summary.byModel[model].totalTokens += totalTokens;

        const day = entry.ts.slice(0, 10);
        if (!summary.daily[day]) {
            summary.daily[day] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        summary.daily[day].promptTokens += promptTokens;
        summary.daily[day].completionTokens += completionTokens;
        summary.daily[day].totalTokens += totalTokens;
    }
}
