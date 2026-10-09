import { performance } from 'perf_hooks';
import inquirer from 'inquirer';
import { DEFAULT_MODEL_IDS } from '../../config/modelDefaults';
import { renderScreenHeader, clearScreen } from '../ui/Header';
import {
    box,
    dim,
    bold,
    cyan,
    green,
    yellow,
    red,
    gray,
    c,
    kvLine,
    waitKeyPress,
    brightCyan,
    brightGreen,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

export interface BenchmarkResult {
    name: string;
    latencyMs: number;
    detail?: string;
    error?: string;
}

export function latencyColor(ms: number): (s: string) => string {
    if (ms < 0) return red;
    if (ms < 50) return brightGreen;
    if (ms < 200) return green;
    if (ms < 500) return yellow;
    return red;
}

export function formatMs(ms: number): string {
    if (ms < 0) return 'FAILED';
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Execute subsystem measurements.
 */
export async function executeBenchmarkMeasurements(
    agent: any,
    opts: { includeLLM?: boolean; onProgress?: (msg: string) => void } = {}
): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const onProgress = opts.onProgress || (() => {});

    // 1. Bootstrap file loading (cold)
    onProgress('Bootstrap load (cold)...');
    try {
        (agent.bootstrap as any)?._cache?.clear?.();
        const t0 = performance.now();
        agent.bootstrap?.loadBootstrapContext?.();
        const dt = performance.now() - t0;
        results.push({ name: 'Bootstrap load (cold)', latencyMs: dt });
    } catch (e: any) {
        results.push({ name: 'Bootstrap load (cold)', latencyMs: -1, error: e.message });
    }

    // 2. Bootstrap file loading (cached / warm)
    onProgress('Bootstrap load (warm)...');
    try {
        const t0 = performance.now();
        agent.bootstrap?.loadBootstrapContext?.();
        const dt = performance.now() - t0;
        results.push({ name: 'Bootstrap load (warm)', latencyMs: dt });
    } catch (e: any) {
        results.push({ name: 'Bootstrap load (warm)', latencyMs: -1, error: e.message });
    }

    // 3. Memory save (write-behind buffer)
    onProgress('Memory save (buffered)...');
    try {
        const testEntry = {
            id: `latency-bench-${Date.now()}`,
            type: 'short' as const,
            content: 'Latency benchmark test entry — safe to ignore',
            timestamp: new Date().toISOString(),
            metadata: { source: 'latency-bench' }
        };
        const t0 = performance.now();
        agent.memory?.saveMemory?.(testEntry);
        const dt = performance.now() - t0;
        results.push({ name: 'Memory save (buffered)', latencyMs: dt, detail: 'write-behind buffer' });

        const memories = agent.memory?.searchMemory?.('short') || [];
        const idx = memories.findIndex((m: any) => m.id === testEntry.id);
        if (idx >= 0) memories.splice(idx, 1);
    } catch (e: any) {
        results.push({ name: 'Memory save (buffered)', latencyMs: -1, error: e.message });
    }

    // 4. Memory flush to disk
    onProgress('Memory flush to disk...');
    try {
        const t0 = performance.now();
        agent.memory?.flushToDisk?.();
        const dt = performance.now() - t0;
        results.push({ name: 'Memory flush (disk write)', latencyMs: dt });
    } catch (e: any) {
        results.push({ name: 'Memory flush (disk write)', latencyMs: -1, error: e.message });
    }

    // 5. Memory search (short)
    onProgress('Memory search (short)...');
    try {
        const t0 = performance.now();
        const shorts = agent.memory?.searchMemory?.('short') || [];
        const dt = performance.now() - t0;
        results.push({ name: 'Memory search (short)', latencyMs: dt, detail: `${shorts.length} entries` });
    } catch (e: any) {
        results.push({ name: 'Memory search (short)', latencyMs: -1, error: e.message });
    }

    // 6. Memory search (episodic)
    onProgress('Memory search (episodic)...');
    try {
        const t0 = performance.now();
        const eps = agent.memory?.searchMemory?.('episodic') || [];
        const dt = performance.now() - t0;
        results.push({ name: 'Memory search (episodic)', latencyMs: dt, detail: `${eps.length} entries` });
    } catch (e: any) {
        results.push({ name: 'Memory search (episodic)', latencyMs: -1, error: e.message });
    }

    // 7. Recent context retrieval
    onProgress('Recent context retrieval...');
    try {
        const t0 = performance.now();
        const ctx = agent.memory?.getRecentContext?.(20) || [];
        const dt = performance.now() - t0;
        results.push({ name: 'Recent context (top 20)', latencyMs: dt, detail: `${ctx.length} items` });
    } catch (e: any) {
        results.push({ name: 'Recent context (top 20)', latencyMs: -1, error: e.message });
    }

    // 8. Config read
    onProgress('Config read...');
    try {
        const keys = ['model', 'maxSteps', 'sudoMode', 'fastModelName', 'telegramToken'];
        const t0 = performance.now();
        for (const k of keys) agent.config?.get?.(k);
        const dt = performance.now() - t0;
        results.push({ name: 'Config read (5 keys)', latencyMs: dt });
    } catch (e: any) {
        results.push({ name: 'Config read (5 keys)', latencyMs: -1, error: e.message });
    }

    // 9. Action queue operations
    onProgress('Action queue operations...');
    try {
        const t0 = performance.now();
        agent.actionQueue?.getNext?.();
        const dt = performance.now() - t0;
        const allActions = agent.actionQueue?.getQueue?.() || [];
        results.push({ name: 'Action queue peek', latencyMs: dt, detail: `${allActions.length} queued` });
    } catch (e: any) {
        results.push({ name: 'Action queue peek', latencyMs: -1, error: e.message });
    }

    // 10. Skills matching
    onProgress('Skills matching...');
    try {
        const t0 = performance.now();
        const matched = agent.skills?.matchSkillsForTask?.('search for latest news and send a summary') || [];
        const dt = performance.now() - t0;
        results.push({ name: 'Skills match (sample)', latencyMs: dt, detail: `${matched.length} matched` });
    } catch (e: any) {
        results.push({ name: 'Skills match (sample)', latencyMs: -1, error: e.message });
    }

    // 11. LLM round-trip (optional)
    if (opts.includeLLM) {
        onProgress('LLM ping (fast model)...');
        try {
            const t0 = performance.now();
            if (agent.llm?.callFast) {
                await agent.llm.callFast('Respond with the single word: pong');
            }
            const dt = performance.now() - t0;
            const fastModel = agent.config?.get?.('fastModelName') || DEFAULT_MODEL_IDS.openaiFast;
            results.push({ name: `LLM ping (${fastModel})`, latencyMs: dt });
        } catch (e: any) {
            results.push({ name: 'LLM ping (fast model)', latencyMs: -1, error: e.message });
        }

        onProgress('LLM ping (primary model)...');
        try {
            const t0 = performance.now();
            if (agent.llm?.call) {
                await agent.llm.call('Respond with the single word: pong');
            }
            const dt = performance.now() - t0;
            const model = agent.config?.get?.('model') || 'unknown';
            results.push({ name: `LLM ping (${model})`, latencyMs: dt });
        } catch (e: any) {
            results.push({ name: 'LLM ping (primary model)', latencyMs: -1, error: e.message });
        }
    }

    return results;
}

/**
 * Render summary lines and box for benchmark results.
 */
export function buildBenchmarkSummaryLines(results: BenchmarkResult[]): string[] {
    const summaryLines: string[] = [];
    const maxNameLen = Math.max(...results.map(r => r.name.length), 24);

    for (const r of results) {
        const nameStr = r.name.padEnd(maxNameLen + 2);
        if (r.latencyMs >= 0) {
            const msStr = formatMs(r.latencyMs);
            const colorFn = latencyColor(r.latencyMs);
            const barW = 12;
            const logMs = Math.log10(Math.max(r.latencyMs, 0.01) + 1);
            const blocks = Math.min(barW, Math.max(1, Math.round(logMs * 3)));
            const bar = colorFn('█'.repeat(blocks)) + dim('░'.repeat(barW - blocks));
            summaryLines.push(`${c.white}${nameStr}${c.reset}${bar} ${colorFn(msStr.padStart(8))}${r.detail ? '  ' + dim(r.detail) : ''}`);
        } else {
            summaryLines.push(`${c.white}${nameStr}${c.reset}${red('FAILED'.padStart(16))}  ${dim(r.error?.slice(0, 30) || '')}`);
        }
    }

    return summaryLines;
}

/**
 * Interactive sub-screen allowing the user to scroll through individual operations.
 */
async function inspectDetailedResults(results: BenchmarkResult[]): Promise<void> {
    clearScreen();
    renderScreenHeader(['System', 'Latency', 'Subsystem Explorer']);
    console.log(dim('\n  Use Up/Down arrow keys or mouse scroll to navigate through operations.\n  Press Enter on any operation to view detailed timing & diagnostics.\n'));

    const choices = results.map((r, i) => {
        const statusIcon = r.latencyMs >= 0 ? green('●') : red('✗');
        const msStr = r.latencyMs >= 0 ? latencyColor(r.latencyMs)(formatMs(r.latencyMs)) : red('FAILED');
        return {
            name: `  ${statusIcon} ${bold(r.name.padEnd(28))} ${msStr} ${r.detail ? dim(`(${r.detail})`) : ''}`,
            value: String(i),
        };
    });

    choices.push(new inquirer.Separator(dim('  ──────────────────────────────────────────')));
    choices.push({ name: dim('  ← Back to Benchmark Summary'), value: 'back' });

    const { selection } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selection',
            message: cyan('Select operation to inspect:'),
            choices,
            pageSize: 12,
        }
    ]);

    if (selection === 'back') return;

    const selectedItem = results[parseInt(selection, 10)];
    if (selectedItem) {
        clearScreen();
        renderScreenHeader(['System', 'Latency', selectedItem.name]);
        console.log('');

        const isSuccess = selectedItem.latencyMs >= 0;
        const detailLines = [
            `${dim('Operation')}   ${bold(selectedItem.name)}`,
            `${dim('Status')}      ${isSuccess ? green(bold('PASSED')) : red(bold('FAILED'))}`,
            `${dim('Latency')}     ${isSuccess ? latencyColor(selectedItem.latencyMs)(bold(formatMs(selectedItem.latencyMs))) : red('N/A')}`,
            ...(selectedItem.detail ? [`${dim('Details')}     ${selectedItem.detail}`] : []),
            ...(selectedItem.error ? [`${dim('Error')}       ${red(selectedItem.error)}`] : []),
        ];

        box(detailLines, { title: 'OPERATION DIAGNOSTICS', width: 62, color: isSuccess ? c.cyan : c.red });
        console.log('');
        await waitKeyPress();
    }

    return inspectDetailedResults(results);
}

/**
 * Main interactive Latency Benchmark screen controller.
 */
export async function showLatencyMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    let hasLLM = false;
    let results: BenchmarkResult[] = [];

    // Run initial benchmark
    clearScreen();
    renderScreenHeader(['System', 'Latency Benchmark']);
    console.log(dim('\n  Benchmarking core agent subsystems (memory, cache, config, queue, skills)...\n'));

    results = await executeBenchmarkMeasurements(agent, { includeLLM: false });

    // Interactive loop
    while (true) {
        clearScreen();
        renderScreenHeader(['System', 'Latency Benchmark']);

        const successResults = results.filter(r => r.latencyMs >= 0);
        const failedResults = results.filter(r => r.latencyMs < 0);
        const totalLocal = successResults
            .filter(r => !r.name.startsWith('LLM'))
            .reduce((sum, r) => sum + r.latencyMs, 0);
        const totalLLM = successResults
            .filter(r => r.name.startsWith('LLM'))
            .reduce((sum, r) => sum + r.latencyMs, 0);

        const rating = totalLocal < 10 ? 'Excellent' : totalLocal < 50 ? 'Good' : totalLocal < 200 ? 'Acceptable' : 'Needs optimization';
        const ratingColor = totalLocal < 10 ? brightGreen : totalLocal < 50 ? green : totalLocal < 200 ? yellow : red;

        console.log('');
        const overviewLines = [
            `${dim('Local Operations Total')}  ${latencyColor(totalLocal)(bold(formatMs(totalLocal)))}  ${ratingColor(`[${rating}]`)}`,
            `${dim('LLM Round-Trips')}         ${hasLLM ? latencyColor(totalLLM)(bold(formatMs(totalLLM))) : gray('Not included in test')}`,
            `${dim('Estimated Per-Step')}      ${dim(`~${formatMs(totalLocal + (totalLLM || 0))} + prompt assembly`)}`,
            `${dim('Operations Measured')}     ${green(bold(String(successResults.length)))}${dim(`/${results.length} passed`)}${failedResults.length > 0 ? `  ${red(`(${failedResults.length} failed)`)}` : ''}`,
        ];
        box(overviewLines, { title: 'PERFORMANCE SUMMARY', width: 68 });

        console.log('');
        const summaryTable = buildBenchmarkSummaryLines(results);
        box(summaryTable, { title: 'SUBSYSTEM BREAKDOWN', width: 68 });
        console.log('');

        const menuChoices = [
            { name: `   ${bold('Inspect Subsystem Latencies')} ${dim('(scrollable explorer)')}`, value: 'inspect' },
            {
                name: hasLLM
                    ? `   ${bold('Re-run LLM Benchmark')} ${dim('(test API round-trip)')}`
                    : `   ${bold('Run LLM Round-Trip Benchmark')} ${dim('(test API round-trip)')}`,
                value: 'llm'
            },
            { name: `   ${bold('Re-run Local Benchmark')}`, value: 'rerun' },
            new inquirer.Separator(dim('  ──────────────────────────────────────────')),
            { name: `${cyan('←')}  ${bold('Back to Main Menu')}`, value: 'back' },
        ];

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: cyan('Benchmark Options:'),
                choices: menuChoices,
            }
        ]);

        if (action === 'back') {
            return showMainMenu();
        }

        if (action === 'inspect') {
            await inspectDetailedResults(results);
            continue;
        }

        if (action === 'llm') {
            clearScreen();
            renderScreenHeader(['System', 'Latency Benchmark', 'Running LLM Ping']);
            console.log(dim('\n  Sending round-trip pings to fast and primary LLM models...\n'));
            hasLLM = true;
            results = await executeBenchmarkMeasurements(agent, { includeLLM: true });
            continue;
        }

        if (action === 'rerun') {
            clearScreen();
            renderScreenHeader(['System', 'Latency Benchmark', 'Re-running']);
            console.log(dim('\n  Measuring local subsystem latencies...\n'));
            hasLLM = false;
            results = await executeBenchmarkMeasurements(agent, { includeLLM: false });
            continue;
        }
    }
}

/**
 * CLI runner for `orcbot latency` command.
 */
export async function runLatencyBenchmark(
    opts: { includeLLM?: boolean; interactive?: boolean; context?: CliContext } = {}
): Promise<void> {
    const ctx = opts.context ?? getCliContext();
    const { agent } = ctx;

    if (opts.interactive) {
        return showLatencyMenu(ctx);
    }

    renderScreenHeader('Latency Benchmark');
    console.log(dim('  Measuring key subsystem latencies...\n'));

    const results = await executeBenchmarkMeasurements(agent, {
        includeLLM: opts.includeLLM,
        onProgress: (msg) => {
            console.log(`  ${cyan('▸')} ${msg}`);
        }
    });

    console.log('');
    const summaryLines = buildBenchmarkSummaryLines(results);
    box(summaryLines, { title: 'BENCHMARK RESULTS', width: 78 });

    const successResults = results.filter(r => r.latencyMs >= 0);
    const totalLocal = successResults
        .filter(r => !r.name.startsWith('LLM'))
        .reduce((sum, r) => sum + r.latencyMs, 0);
    const totalLLM = successResults
        .filter(r => r.name.startsWith('LLM'))
        .reduce((sum, r) => sum + r.latencyMs, 0);

    console.log('');
    kvLine('Local ops total:', latencyColor(totalLocal)(formatMs(totalLocal)));
    if (totalLLM > 0) {
        kvLine('LLM round-trips:', latencyColor(totalLLM)(formatMs(totalLLM)));
    }
    kvLine('Estimated per-step:', dim(`~${formatMs(totalLocal + (totalLLM || 0))} + prompt assembly`));

    const rating = totalLocal < 10 ? 'Excellent' : totalLocal < 50 ? 'Good' : totalLocal < 200 ? 'Acceptable' : 'Needs optimization';
    const ratingColor = totalLocal < 10 ? brightGreen : totalLocal < 50 ? green : totalLocal < 200 ? yellow : red;
    kvLine('Rating (local):', ratingColor(`${rating}`));

    if (!opts.includeLLM) {
        console.log('');
        console.log(dim('  Tip: Use ') + cyan('orcbot latency --llm') + dim(' to include LLM round-trip benchmarks\n'));
    }
}
