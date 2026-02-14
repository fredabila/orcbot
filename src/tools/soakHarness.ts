import fs from 'fs';
import os from 'os';
import path from 'path';

type SoakTask = {
    description: string;
    priority?: number;
    lane?: 'user' | 'autonomy';
    metadata?: Record<string, any>;
};

type SoakSuite = {
    name: string;
    description?: string;
    tasks: SoakTask[];
};

type QueueAction = {
    id: string;
    type: string;
    payload: any;
    priority: number;
    lane?: 'user' | 'autonomy';
    status: 'pending' | 'waiting' | 'in-progress' | 'completed' | 'failed';
    timestamp: string;
    updatedAt?: string;
    retry?: {
        maxAttempts: number;
        attempts: number;
        baseDelay: number;
        nextRetryAt?: string;
    };
    dependsOn?: string;
    expiresAt?: string;
};

type Scorecard = {
    window: {
        sinceHours: number;
        startIso: string;
        endIso: string;
    };
    totals: {
        actionsSeen: number;
        terminalActions: number;
        completed: number;
        failed: number;
        pendingOrActive: number;
    };
    rates: {
        completionRate: number;
        failureRate: number;
        maxStepExitRate: number;
    };
    behavior: {
        maxStepExits: number;
        browserLoopSuppressions: number;
        fileDeliverySuppressions: number;
        noToolCorrections: number;
    };
    execution: {
        avgStepsPerCompletedAction: number;
        p95StepsPerCompletedAction: number;
    };
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const parsed: Record<string, string | boolean> = {};
    for (const token of argv) {
        if (!token.startsWith('--')) continue;
        const eq = token.indexOf('=');
        if (eq === -1) {
            parsed[token.slice(2)] = true;
        } else {
            const key = token.slice(2, eq);
            const value = token.slice(eq + 1);
            parsed[key] = value;
        }
    }
    return parsed;
}

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath: string, data: any): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function toIsoDate(ts: number): string {
    return new Date(ts).toISOString();
}

function resolveDataHome(argDataHome?: string): string {
    const env = process.env.ORCBOT_DATA_DIR;
    if (argDataHome && argDataHome.trim()) return path.resolve(argDataHome);
    if (env && env.trim()) return path.resolve(env);
    return path.join(os.homedir(), '.orcbot');
}

function defaultQueuePath(dataHome: string): string {
    return path.join(dataHome, 'action_queue.json');
}

function defaultMemoryPath(dataHome: string): string {
    return path.join(dataHome, 'memory.json');
}

function defaultLogsPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, 'logs', 'combined.log');
}

function makeSampleSuite(): SoakSuite {
    return {
        name: 'baseline-24h',
        description: 'Broad task mix for reliability soak (research, summary, extraction, reasoning).',
        tasks: [
            { description: 'Research the latest three major updates in TypeScript and summarize practical impact for backend Node.js apps.' },
            { description: 'Compare two approaches for queue retry backoff strategies and provide a recommendation with trade-offs.' },
            { description: 'Read project architecture docs and list the top five likely failure points in production.' },
            { description: 'Draft a concise incident-response checklist for when external LLM provider calls start failing intermittently.' },
            { description: 'Analyze memory system risks for context overflow and propose mitigation actions ordered by impact.' },
            { description: 'Produce a short plan to improve browser-task completion rate without increasing tool spam.' },
            { description: 'Find and summarize best practices for preventing duplicate message delivery in chatbot agents.' },
            { description: 'Give a practical recommendation for balancing strict guardrails vs exploration in autonomous agents.' },
            { description: 'Create a runbook snippet for diagnosing repeated max-step exits in orchestration loops.' },
            { description: 'Summarize what metrics matter most for a two-week soak test and why.' }
        ]
    };
}

function cmdInit(args: Record<string, string | boolean>, workspaceRoot: string): void {
    const dataHome = resolveDataHome(typeof args.dataHome === 'string' ? args.dataHome : undefined);
    const suitePath = typeof args.out === 'string'
        ? path.resolve(args.out)
        : path.join(dataHome, 'soak', 'suites', 'baseline-24h.json');

    const suite = makeSampleSuite();
    writeJsonFile(suitePath, suite);

    const summary = {
        created: suitePath,
        taskCount: suite.tasks.length,
        dataHome,
        queuePath: defaultQueuePath(dataHome),
        memoryPath: defaultMemoryPath(dataHome),
        logsPath: defaultLogsPath(workspaceRoot)
    };

    console.log(JSON.stringify(summary, null, 2));
}

function cmdEnqueue(args: Record<string, string | boolean>): void {
    const dataHome = resolveDataHome(typeof args.dataHome === 'string' ? args.dataHome : undefined);
    const suitePath = typeof args.suite === 'string'
        ? path.resolve(args.suite)
        : path.join(dataHome, 'soak', 'suites', 'baseline-24h.json');

    if (!fs.existsSync(suitePath)) {
        throw new Error(`Suite file not found: ${suitePath}. Run 'npm run soak:init' first or provide --suite=...`);
    }

    const suite = readJsonFile<SoakSuite>(suitePath, { name: 'empty', tasks: [] });
    if (!suite.tasks || suite.tasks.length === 0) {
        throw new Error(`Suite has no tasks: ${suitePath}`);
    }

    const queuePath = typeof args.queue === 'string'
        ? path.resolve(args.queue)
        : defaultQueuePath(dataHome);

    const existing = readJsonFile<QueueAction[]>(queuePath, []);
    const runId = `${Date.now()}`;
    const now = new Date().toISOString();
    const limit = typeof args.count === 'string'
        ? Math.max(1, parseInt(args.count, 10) || suite.tasks.length)
        : suite.tasks.length;
    const defaultPriority = typeof args.priority === 'string' ? parseInt(args.priority, 10) || 8 : 8;
    const defaultLane: 'user' | 'autonomy' = args.lane === 'autonomy' ? 'autonomy' : 'user';
    const dryRun = !!args.dryRun;

    const selected = suite.tasks.slice(0, limit);
    const additions: QueueAction[] = selected.map((task, index) => {
        const id = `soak-${runId}-${index + 1}`;
        return {
            id,
            type: 'task',
            payload: {
                description: task.description,
                source: 'soak',
                sourceId: 'soak-harness',
                trigger: 'soak-harness',
                suite: suite.name,
                soakRunId: runId,
                ...(task.metadata || {})
            },
            priority: task.priority ?? defaultPriority,
            lane: task.lane ?? defaultLane,
            status: 'pending',
            timestamp: now,
            retry: {
                maxAttempts: 1,
                attempts: 0,
                baseDelay: 60
            }
        };
    });

    const merged = [...existing, ...additions].sort((a, b) => b.priority - a.priority);
    if (!dryRun) {
        writeJsonFile(queuePath, merged);
    }

    console.log(JSON.stringify({
        dryRun,
        suitePath,
        suiteName: suite.name,
        queuePath,
        enqueued: additions.length,
        runId,
        firstActionId: additions[0]?.id,
        lastActionId: additions[additions.length - 1]?.id
    }, null, 2));
}

function parseLogTimestamp(line: string): number | null {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
    if (!m) return null;
    const isoLike = `${m[1]}T${m[2]}Z`;
    const ts = Date.parse(isoLike);
    return Number.isFinite(ts) ? ts : null;
}

function quantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[pos];
}

function computeScorecard(params: {
    queue: QueueAction[];
    memories: any[];
    logLines: string[];
    sinceHours: number;
}): Scorecard {
    const endTs = Date.now();
    const startTs = endTs - params.sinceHours * 3600 * 1000;

    const actionsInWindow = params.queue.filter(action => {
        const changedAt = action.updatedAt || action.timestamp;
        const ts = Date.parse(changedAt || action.timestamp);
        return Number.isFinite(ts) && ts >= startTs;
    });

    const completedActions = actionsInWindow.filter(a => a.status === 'completed');
    const failedActions = actionsInWindow.filter(a => a.status === 'failed');
    const terminal = completedActions.length + failedActions.length;
    const pendingOrActive = actionsInWindow.length - terminal;

    const completionRate = terminal > 0 ? completedActions.length / terminal : 0;
    const failureRate = terminal > 0 ? failedActions.length / terminal : 0;

    const actionStepMax = new Map<string, number>();
    for (const memory of params.memories) {
        const md = memory?.metadata || {};
        const actionId = md.actionId;
        const step = Number(md.step);
        if (!actionId || !Number.isFinite(step)) continue;
        const prev = actionStepMax.get(actionId) || 0;
        if (step > prev) actionStepMax.set(actionId, step);
    }

    const completedStepCounts = completedActions
        .map(action => actionStepMax.get(action.id) || 0)
        .filter(v => v > 0);

    const logsInWindow = params.logLines.filter(line => {
        const ts = parseLogTimestamp(line);
        return ts !== null && ts >= startTs;
    });

    const maxStepExits = logsInWindow.filter(line => /Reached max steps/i.test(line)).length;
    const browserLoopSuppressions = logsInWindow.filter(line => /browser-(nav-loop|inspect-loop|phase-loop)|Suppressed browser_navigate|repeated browser inspection/i.test(line)).length;
    const fileDeliverySuppressions = logsInWindow.filter(line => /Suppressed send_file|unsolicited-file/i.test(line)).length;
    const noToolCorrections = logsInWindow.filter(line => /goals_met=false but no tools|provided NO TOOLS/i.test(line)).length;

    const maxStepExitRate = terminal > 0 ? maxStepExits / terminal : 0;

    return {
        window: {
            sinceHours: params.sinceHours,
            startIso: toIsoDate(startTs),
            endIso: toIsoDate(endTs)
        },
        totals: {
            actionsSeen: actionsInWindow.length,
            terminalActions: terminal,
            completed: completedActions.length,
            failed: failedActions.length,
            pendingOrActive
        },
        rates: {
            completionRate,
            failureRate,
            maxStepExitRate
        },
        behavior: {
            maxStepExits,
            browserLoopSuppressions,
            fileDeliverySuppressions,
            noToolCorrections
        },
        execution: {
            avgStepsPerCompletedAction: completedStepCounts.length > 0
                ? completedStepCounts.reduce((a, b) => a + b, 0) / completedStepCounts.length
                : 0,
            p95StepsPerCompletedAction: quantile(completedStepCounts, 0.95)
        }
    };
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function scorecardToMarkdown(score: Scorecard): string {
    return [
        '# OrcBot Soak Scorecard',
        '',
        `- Window: ${score.window.startIso} → ${score.window.endIso} (${score.window.sinceHours}h)`,
        `- Actions seen: ${score.totals.actionsSeen}`,
        `- Terminal actions: ${score.totals.terminalActions}`,
        '',
        '## Core Rates',
        '',
        `- Completion rate: ${formatPercent(score.rates.completionRate)}`,
        `- Failure rate: ${formatPercent(score.rates.failureRate)}`,
        `- Max-step exit rate: ${formatPercent(score.rates.maxStepExitRate)}`,
        '',
        '## Behavior Signals',
        '',
        `- Max-step exits: ${score.behavior.maxStepExits}`,
        `- Browser loop suppressions: ${score.behavior.browserLoopSuppressions}`,
        `- File-delivery suppressions: ${score.behavior.fileDeliverySuppressions}`,
        `- No-tool corrections: ${score.behavior.noToolCorrections}`,
        '',
        '## Execution Depth',
        '',
        `- Avg steps per completed action: ${score.execution.avgStepsPerCompletedAction.toFixed(2)}`,
        `- P95 steps per completed action: ${score.execution.p95StepsPerCompletedAction.toFixed(0)}`,
        ''
    ].join('\n');
}

function cmdScoreOrReport(args: Record<string, string | boolean>, workspaceRoot: string, reportMode: boolean): void {
    const dataHome = resolveDataHome(typeof args.dataHome === 'string' ? args.dataHome : undefined);
    const sinceHours = typeof args.sinceHours === 'string' ? Math.max(1, parseInt(args.sinceHours, 10) || 24) : 24;

    const queuePath = typeof args.queue === 'string' ? path.resolve(args.queue) : defaultQueuePath(dataHome);
    const memoryPath = typeof args.memory === 'string' ? path.resolve(args.memory) : defaultMemoryPath(dataHome);
    const logsPath = typeof args.logs === 'string' ? path.resolve(args.logs) : defaultLogsPath(workspaceRoot);

    const queue = readJsonFile<QueueAction[]>(queuePath, []);
    const memoryRoot = readJsonFile<{ memories?: any[] }>(memoryPath, {});
    const memories = Array.isArray(memoryRoot.memories) ? memoryRoot.memories : [];
    const logLines = fs.existsSync(logsPath)
        ? fs.readFileSync(logsPath, 'utf8').split(/\r?\n/)
        : [];

    const score = computeScorecard({ queue, memories, logLines, sinceHours });

    if (reportMode) {
        const reportPath = typeof args.out === 'string'
            ? path.resolve(args.out)
            : path.join(dataHome, 'soak', 'reports', `scorecard-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
        const markdown = scorecardToMarkdown(score);
        ensureDir(path.dirname(reportPath));
        fs.writeFileSync(reportPath, markdown, 'utf8');
        console.log(JSON.stringify({
            reportPath,
            queuePath,
            memoryPath,
            logsPath,
            score
        }, null, 2));
        return;
    }

    console.log(JSON.stringify({
        queuePath,
        memoryPath,
        logsPath,
        score
    }, null, 2));
}

function usage(): string {
    return [
        'Usage: ts-node src/tools/soakHarness.ts <command> [--key=value]',
        '',
        'Commands:',
        '  init      Create a baseline soak suite JSON',
        '  enqueue   Push soak tasks into action_queue.json',
        '  score     Calculate soak metrics from queue + memory + logs',
        '  report    Same as score, plus writes a markdown report',
        '',
        'Common options:',
        '  --dataHome=<path>       Override ORCBOT_DATA_DIR (default: ~/.orcbot)',
        '  --queue=<path>          Override action queue path',
        '  --memory=<path>         Override memory.json path',
        '  --logs=<path>           Override combined.log path',
        '  --sinceHours=<n>        Metrics lookback window (score/report)',
        '',
        'Enqueue options:',
        '  --suite=<path>          Soak suite json to enqueue',
        '  --count=<n>             Number of tasks to enqueue from suite',
        '  --priority=<n>          Default priority for tasks (default: 8)',
        '  --lane=user|autonomy    Default lane for tasks (default: user)',
        '  --dryRun                Show what would be enqueued without writing'
    ].join('\n');
}

function main(): void {
    const workspaceRoot = process.cwd();
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);

    if (!command || args.help || args.h) {
        console.log(usage());
        return;
    }

    switch (command) {
        case 'init':
            cmdInit(args, workspaceRoot);
            return;
        case 'enqueue':
            cmdEnqueue(args);
            return;
        case 'score':
            cmdScoreOrReport(args, workspaceRoot, false);
            return;
        case 'report':
            cmdScoreOrReport(args, workspaceRoot, true);
            return;
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

try {
    main();
} catch (err: any) {
    console.error(`Soak harness failed: ${err?.message || err}`);
    process.exit(1);
}
