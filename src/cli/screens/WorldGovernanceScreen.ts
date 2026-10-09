import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import inquirer from 'inquirer';
import yaml from 'yaml';
import {
    aggregateWorldEvents,
    fetchWorldEvents,
    summarizeWorldEvents,
    WorldEvent,
    WorldEventSource,
    getRootCodeLabel,
} from '../../tools/WorldEvents';
import { renderScreenHeader } from '../ui/Header';
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
    waitKeyPress,
    brightCyan,
    magenta,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseWorldSources(input: string[] | string | undefined): WorldEventSource[] {
    const raw = Array.isArray(input) ? input.join(',') : String(input || '');
    const list = raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    const allowed: WorldEventSource[] = ['gdelt', 'usgs', 'opensky'];
    const selected = list.filter(s => allowed.includes(s as WorldEventSource)) as WorldEventSource[];
    return selected.length ? selected : ['gdelt'];
}

export function parseGlobeArgs(input: string[] | string | undefined): string[] {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return String(input)
        .split(' ')
        .map(s => s.trim())
        .filter(Boolean);
}

function isCommandAvailable(command: string): boolean {
    try {
        const probe = spawnSync(command, ['--version'], { encoding: 'utf-8' });
        return !probe.error;
    } catch {
        return false;
    }
}

function ensureMapsciiInstalled(): boolean {
    if (isCommandAvailable('mapscii')) return true;

    console.log(yellow('mapscii not found. Installing globally with npm...'));
    try {
        const result = spawnSync('npm', ['i', '-g', 'mapscii'], { stdio: 'inherit' });
        if (result.error || result.status !== 0) {
            console.log(red('Failed to install mapscii. Falling back to built-in renderer.'));
            return false;
        }
        return isCommandAvailable('mapscii');
    } catch {
        console.log(red('Failed to install mapscii. Falling back to built-in renderer.'));
        return false;
    }
}

function launchMapscii(args: string[] = []): boolean {
    if (!ensureMapsciiInstalled()) return false;
    const result = spawnSync('mapscii', args, { stdio: 'inherit' });
    return !result.error;
}

function renderExternalGlobe(command: string, args: string[], maxLines = 20): string[] | null {
    try {
        const result = spawnSync(command, args, { encoding: 'utf-8' });
        if (result.error || !result.stdout) return null;
        const lines = result.stdout.trimEnd().split(/\r?\n/);
        return lines.slice(0, maxLines);
    } catch {
        return null;
    }
}

function projectToGlobe(lat: number, lon: number, rotationDeg: number): { x: number; y: number; z: number; visible: boolean } {
    const degToRad = (d: number) => (d * Math.PI) / 180;
    const latRad = degToRad(lat);
    const lonRad = degToRad(lon + rotationDeg);

    const x = Math.cos(latRad) * Math.cos(lonRad);
    const y = Math.sin(latRad);
    const z = Math.cos(latRad) * Math.sin(lonRad);

    return { x, y, z, visible: z >= 0 };
}

function renderGlobeFrame(events: WorldEvent[], rotationDeg: number, width = 42, height = 20): string[] {
    const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '));
    const shadeChars = ['.', ':', '-', '=', '+', '*', '#', '@'];
    const light = { x: -0.4, y: 0.2, z: 1.0 };
    const lightLen = Math.hypot(light.x, light.y, light.z) || 1;
    const lx = light.x / lightLen;
    const ly = light.y / lightLen;
    const lz = light.z / lightLen;

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const nx = (col / (width - 1)) * 2 - 1;
            const ny = ((height - 1 - row) / (height - 1)) * 2 - 1;
            const r2 = nx * nx + ny * ny;
            if (r2 <= 1) {
                const z = Math.sqrt(1 - r2);
                const brightness = Math.max(0, nx * lx + ny * ly + z * lz);
                const idx = Math.min(shadeChars.length - 1, Math.floor(brightness * shadeChars.length));
                const baseChar = shadeChars[idx];

                const isLimb = Math.abs(r2 - 1) < 0.02;
                if (isLimb) {
                    grid[row][col] = gray('·');
                } else if (brightness > 0.7) {
                    grid[row][col] = brightCyan(baseChar);
                } else if (brightness > 0.5) {
                    grid[row][col] = cyan(baseChar);
                } else if (brightness > 0.3) {
                    grid[row][col] = gray(baseChar);
                } else {
                    grid[row][col] = dim(baseChar);
                }
            }
        }
    }

    const sample = events.slice(0, 250);
    for (const e of sample) {
        const proj = projectToGlobe(e.lat, e.lon, rotationDeg);
        if (!proj.visible) continue;
        const col = Math.round(((proj.x + 1) / 2) * (width - 1));
        const row = Math.round(((1 - (proj.y + 1) / 2)) * (height - 1));
        if (row >= 0 && row < height && col >= 0 && col < width) {
            const point = proj.z > 0.6 ? brightCyan('•') : proj.z > 0.3 ? cyan('•') : dim('•');
            grid[row][col] = point;
        }
    }

    return grid.map(r => r.join(''));
}

function renderMapFrame(events: WorldEvent[], width = 68, height = 18): string[] {
    const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => dim('·')));

    const sample = events.slice(0, 500);
    for (const e of sample) {
        const col = Math.round(((e.lon + 180) / 360) * (width - 1));
        const row = Math.round(((90 - e.lat) / 180) * (height - 1));
        if (row >= 0 && row < height && col >= 0 && col < width) {
            const point = e.source === 'usgs'
                ? green('*')
                : e.source === 'opensky'
                    ? yellow('+')
                    : cyan('•');
            grid[row][col] = point;
        }
    }

    return grid.map(r => r.join(''));
}

function clipLine(text: string, max = 70): string {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    if (stripAnsi(text).length <= max) return text;
    const trimmed = stripAnsi(text).slice(0, max - 3) + '...';
    return trimmed;
}

function parseEventTimeMs(e: WorldEvent): number {
    if (!e.time) return 0;
    const t = Date.parse(e.time);
    if (!Number.isNaN(t)) return t;
    if (/^\d{14}$/.test(e.time)) {
        const year = Number(e.time.slice(0, 4));
        const month = Number(e.time.slice(4, 6)) - 1;
        const day = Number(e.time.slice(6, 8));
        const hour = Number(e.time.slice(8, 10));
        const min = Number(e.time.slice(10, 12));
        const sec = Number(e.time.slice(12, 14));
        return Date.UTC(year, month, day, hour, min, sec);
    }
    return 0;
}

function formatEventLine(e: WorldEvent): string {
    const src = (e.source || 'unknown').toUpperCase();
    const location = e.location || e.country || 'Unknown location';
    let detail = '';

    if (e.source === 'gdelt') {
        const label = getRootCodeLabel(e.eventRootCode);
        const tone = typeof e.tone === 'number' ? `, tone ${e.tone.toFixed(1)}` : '';
        detail = `${label}${tone}`;
    } else if (e.source === 'usgs') {
        detail = `Earthquake ${e.eventCode || ''}`.trim();
    } else if (e.source === 'opensky') {
        detail = `Flight ${e.location || e.id}`;
    } else {
        detail = 'Event';
    }

    return clipLine(`${dim(src)} ${location} ${dim('-')} ${detail}`);
}

function getTopEventLines(events: WorldEvent[], limit = 6): string[] {
    const sorted = [...events].sort((a, b) => parseEventTimeMs(b) - parseEventTimeMs(a));
    const lines = [] as string[];
    for (const e of sorted) {
        lines.push(formatEventLine(e));
        if (lines.length >= limit) break;
    }
    return lines.length ? lines : [dim('No recent events in this window.')];
}

function renderWorldView(
    events: WorldEvent[],
    history: number[],
    opts: {
        sources?: WorldEventSource[];
        minutes?: number;
        maxRecords?: number;
        globeMode?: 'ascii' | 'external' | 'map' | 'mapscii';
        globeCommand?: string;
        globeArgs?: string[];
        rotationDeg?: number;
        error?: string;
    } = {}
) {
    const rotationDeg = opts.rotationDeg ?? 0;
    const mode = opts.globeMode || 'ascii';
    const stats = aggregateWorldEvents(events);

    renderScreenHeader('World Events Monitor');
    console.log('');

    const lines: string[] = [];
    lines.push(`${dim('Sources')}   ${(opts.sources || ['gdelt']).join(', ')}`);
    lines.push(`${dim('Lookback')}  ${opts.minutes ?? 60}m  ${dim('|')}  ${dim('Max')} ${opts.maxRecords ?? 250}`);
    lines.push(`${dim('Events')}    ${bold(String(events.length))} ${dim(`(avg tone: ${stats.avgTone.toFixed(1)}, goldstein: ${stats.avgGoldstein.toFixed(1)})`)}`);
    if (opts.error) lines.push(red(`Error: ${opts.error}`));

    box(lines, { title: 'EVENT FEED', width: 68 });
    console.log('');

    if (mode === 'external' && opts.globeCommand) {
        const ext = renderExternalGlobe(opts.globeCommand, opts.globeArgs || []);
        if (ext) {
            box(ext, { title: 'EXTERNAL GLOBE', width: 68 });
        } else {
            box([yellow('Failed to run external globe command. Falling back to ASCII.')], { title: 'EXTERNAL GLOBE', width: 68 });
            box(renderGlobeFrame(events, rotationDeg, 42, 20), { title: 'ASCII GLOBE', width: 46 });
        }
    } else {
        const frame = mode === 'ascii'
            ? renderGlobeFrame(events, rotationDeg, 42, 20)
            : renderMapFrame(events, 68, 18);
        box(frame, { title: mode === 'ascii' ? 'ASCII GLOBE' : 'WORLD MAP', width: mode === 'ascii' ? 46 : 72 });
    }

    console.log('');
    const topEvents = getTopEventLines(events, 6);
    box(topEvents, { title: 'LATEST EVENTS', width: 68 });
    console.log('');
}

export async function runWorldEventsMonitor(opts: {
    sources: WorldEventSource[];
    refreshSeconds: number;
    minutes: number;
    maxRecords: number;
    batchMinutes: number;
    gdeltQuery?: string;
    globeMode?: 'ascii' | 'external' | 'map' | 'mapscii';
    globeCommand?: string;
    globeArgs?: string[];
    once?: boolean;
    store?: boolean;
    context?: CliContext;
}): Promise<void> {
    const ctx = opts.context ?? getCliContext();
    const { agent } = ctx;

    if (opts.globeMode === 'mapscii') {
        const ok = launchMapscii(opts.globeArgs || []);
        if (!ok) {
            console.log(yellow('mapscii failed to launch. Falling back to embedded map.'));
            opts.globeMode = 'map';
        } else {
            return;
        }
    }
    const refreshMs = Math.max(5, opts.refreshSeconds) * 1000;
    const batchMs = Math.max(5, opts.batchMinutes) * 60 * 1000;
    const history: number[] = [];

    let batchStart = new Date();
    let batchEvents: WorldEvent[] = [];
    let rotation = 0;

    while (true) {
        let events: WorldEvent[] = [];
        let error: string | undefined;

        try {
            events = await fetchWorldEvents(opts.sources, {
                minutes: opts.minutes,
                maxRecords: opts.maxRecords,
                gdeltQuery: opts.gdeltQuery
            });
            history.push(events.length);
            if (history.length > 20) history.shift();
            batchEvents = batchEvents.concat(events);
        } catch (e: any) {
            error = e?.message || String(e);
        }

        renderWorldView(
            events,
            history,
            {
                sources: opts.sources,
                minutes: opts.minutes,
                maxRecords: opts.maxRecords,
                globeMode: opts.globeMode,
                globeCommand: opts.globeCommand,
                globeArgs: opts.globeArgs,
                rotationDeg: rotation,
                error
            }
        );

        rotation = (rotation + 15) % 360;

        if (opts.store && (Date.now() - batchStart.getTime() >= batchMs)) {
            const summary = summarizeWorldEvents(batchEvents, batchStart, new Date());
            await agent.pushTask(`Summarize world events batch: ${summary}`, 3);
            batchEvents = [];
            batchStart = new Date();
        }

        if (opts.once) break;
        await sleep(refreshMs);
    }
}

/**
 * Push Task screen controller.
 */
export async function showPushTaskMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Push Task');
    console.log('');

    const { task } = await inquirer.prompt([
        { type: 'input', name: 'task', message: cyan('Enter task description (or leave empty to go back):') }
    ]);

    if (!task.trim()) {
        return showMainMenu();
    }

    const { priority } = await inquirer.prompt([
        { type: 'number', name: 'priority', message: 'Enter priority (1-10):', default: 5 },
    ]);

    await agent.pushTask(task, priority);
    console.log('Task pushed!');
    await waitKeyPress();
    await showMainMenu();
}

/**
 * World Events screen controller.
 */
export async function showWorldEventsMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    const sources = parseWorldSources(agent.config.get('worldEventsSources'));
    const refreshSeconds = agent.config.get('worldEventsRefreshSeconds') ?? 60;
    const lookbackMinutes = agent.config.get('worldEventsLookbackMinutes') ?? 60;
    const maxRecords = agent.config.get('worldEventsMaxRecords') ?? 250;
    const batchMinutes = agent.config.get('worldEventsBatchMinutes') ?? 10;
    const storeEnabled = agent.config.get('worldEventsStoreEnabled') !== false;
    const gdeltQuery = agent.config.get('worldEventsGdeltQuery') || 'global';
    const globeMode = (agent.config.get('worldEventsGlobeRenderer') || 'mapscii') as 'ascii' | 'external' | 'map' | 'mapscii';
    const globeCommand = agent.config.get('worldEventsGlobeCommand') || 'globe';
    const globeArgs = parseGlobeArgs(agent.config.get('worldEventsGlobeArgs'));

    renderScreenHeader('World Events');
    console.log('');

    const lines = [
        `${dim('Sources')}      ${sources.join(', ')}`,
        `${dim('Refresh')}      ${refreshSeconds}s`,
        `${dim('Lookback')}     ${lookbackMinutes}m`,
        `${dim('Max Records')}  ${maxRecords}`,
        `${dim('Batch Window')} ${batchMinutes}m`,
        `${dim('GDELT Query')}  ${gdeltQuery}`,
        `${dim('Globe Mode')}   ${globeMode}`,
        `${dim('Globe Cmd')}    ${globeCommand} ${globeArgs.join(' ')}`,
        `${dim('Store to Memory')} ${storeEnabled ? green('● ON') : gray('○ OFF')}`
    ];
    box(lines, { title: 'WORLD EVENTS', width: 56 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'World Events Options:',
            choices: [
                { name: 'Run Live View', value: 'run' },
                { name: 'Run Once (snapshot)', value: 'run_once' },
                { name: 'Select Sources', value: 'sources' },
                { name: `Set Refresh Interval (${refreshSeconds}s)`, value: 'refresh' },
                { name: `Set Lookback Window (${lookbackMinutes}m)`, value: 'lookback' },
                { name: `Set Max Records (${maxRecords})`, value: 'max' },
                { name: `Set Batch Window (${batchMinutes}m)`, value: 'batch' },
                { name: `Set GDELT Query (${gdeltQuery})`, value: 'query' },
                { name: `Set Render Mode (${globeMode})`, value: 'globe_mode' },
                { name: `Set Globe Command`, value: 'globe_cmd' },
                { name: `Set Globe Args`, value: 'globe_args' },
                { name: storeEnabled ? 'Disable Memory Storage' : 'Enable Memory Storage', value: 'toggle_store' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    if (action === 'sources') {
        const { selected } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selected',
                message: 'Select world event sources:',
                choices: [
                    { name: 'GDELT (global news events)', value: 'gdelt', checked: sources.includes('gdelt') },
                    { name: 'USGS Earthquakes (real-time)', value: 'usgs', checked: sources.includes('usgs') },
                    { name: 'OpenSky Flights (telemetry)', value: 'opensky', checked: sources.includes('opensky') }
                ]
            }
        ]);
        if (!selected || selected.length === 0) {
            console.log(yellow('At least one source must be selected.'));
        } else {
            agent.config.set('worldEventsSources', selected);
        }
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'refresh') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter refresh interval (seconds):', default: refreshSeconds }
        ]);
        if (Number.isFinite(val) && val >= 5) {
            agent.config.set('worldEventsRefreshSeconds', val);
        } else {
            console.log(yellow('Minimum refresh interval is 5 seconds.'));
        }
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'lookback') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter lookback window (minutes):', default: lookbackMinutes }
        ]);
        if (Number.isFinite(val) && val >= 5) {
            agent.config.set('worldEventsLookbackMinutes', val);
        } else {
            console.log(yellow('Minimum lookback window is 5 minutes.'));
        }
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'max') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter maximum records to fetch:', default: maxRecords }
        ]);
        if (Number.isFinite(val) && val >= 10) {
            agent.config.set('worldEventsMaxRecords', val);
        } else {
            console.log(yellow('Minimum max records is 10.'));
        }
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'batch') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter batch window (minutes):', default: batchMinutes }
        ]);
        if (Number.isFinite(val) && val >= 5) {
            agent.config.set('worldEventsBatchMinutes', val);
        } else {
            console.log(yellow('Minimum batch window is 5 minutes.'));
        }
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'query') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter GDELT query term:', default: gdeltQuery }
        ]);
        agent.config.set('worldEventsGdeltQuery', val?.trim() || 'global');
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'globe_mode') {
        const { mode } = await inquirer.prompt([
            {
                type: 'list',
                name: 'mode',
                message: 'Select globe render mode:',
                choices: [
                    { name: 'Mapscii (vector terminal map)', value: 'mapscii' },
                    { name: 'ASCII Rotating Globe (built-in)', value: 'ascii' },
                    { name: 'Flat World Map (built-in)', value: 'map' },
                    { name: 'External CLI (globe-cli, etc.)', value: 'external' }
                ],
                default: globeMode
            }
        ]);
        agent.config.set('worldEventsGlobeRenderer', mode);
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'globe_cmd') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter external globe command:', default: globeCommand }
        ]);
        agent.config.set('worldEventsGlobeCommand', val?.trim() || 'globe');
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'globe_args') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter globe arguments (space-separated):', default: globeArgs.join(' ') }
        ]);
        agent.config.set('worldEventsGlobeArgs', parseGlobeArgs(val));
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }

    if (action === 'toggle_store') {
        agent.config.set('worldEventsStoreEnabled', !storeEnabled);
        return showWorldEventsMenu(ctx);
    }

    if (action === 'run' || action === 'run_once') {
        await runWorldEventsMonitor({
            sources,
            refreshSeconds,
            minutes: lookbackMinutes,
            maxRecords,
            batchMinutes,
            gdeltQuery,
            globeMode,
            globeCommand,
            globeArgs,
            once: action === 'run_once',
            store: storeEnabled,
            context: ctx,
        });
        await waitKeyPress();
        return showWorldEventsMenu(ctx);
    }
}

/**
 * World Governance screen controller.
 */
export async function showWorldGovernanceMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('World Governance');

    const worldPath = agent.config.get('worldPath');
    let worldContent = '';
    try {
        if (fs.existsSync(worldPath)) {
            worldContent = fs.readFileSync(worldPath, 'utf-8');
        } else {
            worldContent = '(WORLD.md not found)';
        }
    } catch (e) {
        worldContent = `(Error reading WORLD.md: ${e})`;
    }

    const preview = worldContent.length > 800 ? worldContent.slice(0, 800) + '...' : worldContent;

    box([preview || '(Empty)'], { title: 'WORLD.MD PREVIEW', width: 64 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Governance Options:'),
            choices: [
                { name: `   ${bold('Edit WORLD.md (Manual)')}`, value: 'edit' },
                { name: `   ${bold('Ask Agent to Update World')}`, value: 'agent_update' },
                { name: `   ${bold('View Peer Agent Worlds')}`, value: 'peers' },
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'edit': {
            console.log(yellow('\nOpening WORLD.md in your default editor...'));
            const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            spawn(cmd, [worldPath], { shell: true });
            await waitKeyPress();
            return showWorldGovernanceMenu(ctx);
        }
        case 'agent_update': {
            const { topic, content } = await inquirer.prompt([
                { type: 'input', name: 'topic', message: 'Governance Topic (e.g. "Security Protocol"):', validate: (v: string) => v.trim().length > 0 || 'Topic required' },
                { type: 'input', name: 'content', message: 'Rules/Content:', validate: (v: string) => v.trim().length > 0 || 'Content required' }
            ]);

            try {
                const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n**User Entry via TUI**\n\n${content}\n\n---`;
                fs.appendFileSync(worldPath, entry);
                console.log(green('\nWORLD.md updated successfully.'));
            } catch (e: any) {
                console.log(red(`\nFailed to update world: ${e.message}`));
            }
            await waitKeyPress();
            return showWorldGovernanceMenu(ctx);
        }
        case 'peers': {
            const orchestrator = agent.orchestrator;
            const status = orchestrator.getStatus();
            if (status.activeAgents <= 1) {
                console.log(yellow('\nNo peer agents found.'));
                await waitKeyPress();
                return showWorldGovernanceMenu(ctx);
            }

            const peers = orchestrator.getAgents().filter((a: any) => a.id !== 'primary' && a.status !== 'terminated');
            const { peerId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'peerId',
                    message: 'Select peer to view their world state:',
                    choices: peers.map((p: any) => ({ name: `${p.name} (${p.role})`, value: p.id }))
                }
            ]);

            const peer = orchestrator.getAgent(peerId);
            if (peer) {
                const peerWorldPath = path.join(path.dirname(peer.memoryPath), 'WORLD.md');
                if (fs.existsSync(peerWorldPath)) {
                    const peerWorld = fs.readFileSync(peerWorldPath, 'utf-8');
                    renderScreenHeader(`${peer.name}'s World`);
                    box(peerWorld.split('\n'), { title: 'PEER WORLD.MD', width: 64 });
                } else {
                    console.log(red('\nPeer WORLD.md not found.'));
                }
            }
            await waitKeyPress();
            return showWorldGovernanceMenu(ctx);
        }
    }
}

/**
 * Multi-Agent Orchestration screen controller.
 */
export async function showOrchestrationMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Multi-Agent Orchestration');

    const orchestrator = agent.orchestrator;
    const status = orchestrator.getStatus();
    const runningWorkers = orchestrator.getRunningWorkers();
    const detailedWorkers = orchestrator.getDetailedWorkerStatus();

    console.log('');
    const orchLines = [
        `${dim('Active Agents')}    ${brightCyan(bold(String(status.activeAgents)))}`,
        `${dim('Running Workers')}  ${status.activeAgents > 0 ? green(bold(String(runningWorkers.length)) + ' process(es)') : gray('0')}`,
        `${dim('Pending Tasks')}    ${status.pendingTasks > 0 ? yellow(bold(String(status.pendingTasks))) : green('0')}`,
        `${dim('Completed')}        ${green(bold(String(status.completedTasks)))}`,
        `${dim('Failed')}           ${status.failedTasks > 0 ? red(bold(String(status.failedTasks))) : gray('0')}`,
    ];

    if (detailedWorkers.length > 0) {
        orchLines.push('');
        const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
        const tokenMap = new Map(workerTokens.map((wt: any) => [wt.agentId, wt]));

        for (const w of detailedWorkers) {
            const statusIcon = w.isRunning ? (w.currentTaskId ? '●' : '○') : '·';
            const statusColor = w.isRunning ? (w.currentTaskId ? yellow : green) : gray;
            const statusLabel = w.isRunning ? (w.currentTaskId ? 'working' : 'idle') : 'stopped';
            const tokens: any = tokenMap.get(w.agentId);
            const tokenStr = tokens ? dim(` ${(tokens.totalTokens / 1000).toFixed(1)}k tok`) : '';
            const taskStr = w.currentTaskDescription
                ? dim(` → ${w.currentTaskDescription.slice(0, 30)}${w.currentTaskDescription.length > 30 ? '…' : ''}`)
                : '';
            orchLines.push(`${statusIcon} ${bold(w.name.slice(0, 14).padEnd(14))} ${statusColor(statusLabel.padEnd(7))}${tokenStr}${taskStr}`);
        }
    }

    box(orchLines, { title: 'ORCHESTRATION STATUS', width: 64 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Orchestration Options:'),
            choices: [
                new inquirer.Separator(dim('  ─── Monitor ──────────────────────')),
                { name: `   ${bold('View Detailed Status')}`, value: 'status' },
                { name: `   ${bold('List Active Agents')}`, value: 'list' },
                { name: `   ${bold('View Running Processes')}`, value: 'processes' },
                { name: `   ${bold('View Worker Task Details')}`, value: 'worker_details' },
                new inquirer.Separator(dim('  ─── Manage ───────────────────────')),
                { name: `   ${bold('Create Peer Agent (Clone)')}`, value: 'create_peer' },
                { name: `    ${bold('Configure Peer Agent')}`, value: 'configure_peer' },
                { name: `   ${bold('Spawn New Worker')}`, value: 'spawn' },
                { name: `  ▶  ${bold('Start Worker Process')}`, value: 'start_worker' },
                { name: `    ${bold('Stop Worker Process')}`, value: 'stop_worker' },
                new inquirer.Separator(dim('  ─── Tasks ────────────────────────')),
                { name: `   ${bold('Delegate Task to Agent')}`, value: 'delegate' },
                { name: `   ${bold('Distribute Tasks to All')}`, value: 'distribute' },
                { name: `   ${bold('Broadcast Message')}`, value: 'broadcast' },
                new inquirer.Separator(dim('  ─── Cleanup ──────────────────────')),
                { name: `    ${bold('Terminate Agent')}`, value: 'terminate' },
                { name: `   ${bold('Terminate All Agents')}`, value: 'terminate_all' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ],
            pageSize: 20
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'status': {
            renderScreenHeader('Orchestration Dashboard');

            const summaryLines = [
                `${dim('Agents')}     ${brightCyan(bold(String(status.activeAgents)))} active  ${dim('(')}${green(String(status.idleAgents))} idle${dim(',')} ${yellow(String(status.workingAgents))} working${dim(')')}`,
                `${dim('Workers')}    ${runningWorkers.length > 0 ? green(bold(String(runningWorkers.length))) : gray('0')} running`,
                `${dim('Tasks')}      ${status.pendingTasks > 0 ? yellow(bold(String(status.pendingTasks))) + ' pending' : green('0 pending')}  ${green(String(status.completedTasks))} done  ${status.failedTasks > 0 ? red(String(status.failedTasks)) + ' failed' : dim('0 failed')}`,
            ];
            console.log('');
            box(summaryLines, { title: 'OVERVIEW', width: 64 });

            const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
            if (workerTokens.length > 0) {
                const totalAllTokens = workerTokens.reduce((sum: number, wt: any) => sum + wt.totalTokens, 0);
                const totalRealTokens = workerTokens.reduce((sum: number, wt: any) => sum + wt.realTokens, 0);
                const tokenLines = [
                    `${dim('Total')}    ${bold((totalAllTokens / 1000).toFixed(1) + 'k')} tokens  ${dim('(')}${green((totalRealTokens / 1000).toFixed(1) + 'k real')}${dim(')')}`,
                    '',
                ];
                for (const wt of workerTokens) {
                    const bar = '█'.repeat(Math.min(20, Math.round((wt.totalTokens / Math.max(1, totalAllTokens)) * 20)));
                    const pad = '░'.repeat(20 - bar.length);
                    tokenLines.push(
                        `  ${bold(wt.name.slice(0, 12).padEnd(12))} ${cyan(bar)}${dim(pad)} ${dim((wt.totalTokens / 1000).toFixed(1).padStart(7) + 'k')} ${dim('(' + (wt.realTokens / 1000).toFixed(1) + 'k real)')}`
                    );
                }
                console.log('');
                box(tokenLines, { title: 'WORKER TOKEN USAGE', width: 64 });
            }

            if (detailedWorkers.length > 0) {
                console.log('');
                console.log(dim('  ─── Worker Details ──────────────────────────────────'));
                for (const w of detailedWorkers) {
                    const statusIcon = w.isRunning ? (w.currentTaskId ? '●' : '○') : '·';
                    const statusLabel = w.isRunning ? (w.currentTaskId ? yellow('working') : green('idle')) : gray('stopped');
                    const pidStr = w.pid ? dim(` PID:${w.pid}`) : '';
                    const agentIdShort = w.agentId.slice(0, 10);

                    console.log(`\n  ${statusIcon} ${bold(w.name)} ${dim('(' + agentIdShort + '…)')} ${statusLabel}${pidStr}`);
                    console.log(`     ${dim('Role')} ${w.role}  ${dim('Last')} ${new Date(w.lastActiveAt).toLocaleTimeString()}`);

                    if (w.currentTaskId) {
                        const desc = w.currentTaskDescription || '(no description)';
                        console.log(`     ${dim('Task')} ${cyan(desc.slice(0, 60))}${desc.length > 60 ? dim('…') : ''}`);
                    }

                    const agentData = orchestrator.getAgent(w.agentId);
                    if (agentData?.memoryPath) {
                        try {
                            const workerDir = path.dirname(agentData.memoryPath);
                            if (fs.existsSync(agentData.memoryPath)) {
                                const memData = JSON.parse(fs.readFileSync(agentData.memoryPath, 'utf-8'));
                                const shortCount = memData.short?.length || 0;
                                const episodicCount = memData.episodic?.length || 0;
                                console.log(`     ${dim('Memory')} ${shortCount} short, ${episodicCount} episodic`);
                            }
                            const ksPath = path.join(workerDir, 'knowledge_store.json');
                            if (fs.existsSync(ksPath)) {
                                const ksData = JSON.parse(fs.readFileSync(ksPath, 'utf-8'));
                                const docs = ksData.documents?.length || 0;
                                const chunks = ksData.chunks?.length || 0;
                                if (docs > 0) console.log(`     ${dim('Knowledge')} ${docs} docs, ${chunks} chunks`);
                            }
                        } catch { /* skip */ }
                    }
                }
            } else {
                console.log(`\n  ${dim('No workers spawned. Use ')}${cyan('Spawn New Agent')}${dim(' to create one.')}`);
            }

            if (runningWorkers.length > 0) {
                console.log('');
                console.log(dim('  ─── Processes ───────────────────────────────────────'));
                for (const w of runningWorkers) {
                    console.log(`   ${bold(w.name)} ${dim('PID:' + w.pid)} ${dim('(' + w.agentId.slice(0, 10) + '…)')}`);
                }
            }
            console.log('');
            break;
        }
        case 'worker_details': {
            renderScreenHeader('Worker Task Details');
            if (detailedWorkers.length === 0) {
                console.log(`\n  ${dim('No workers available.')}`);
            } else {
                const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
                const tokenMap = new Map(workerTokens.map((wt: any) => [wt.agentId, wt]));

                for (const w of detailedWorkers) {
                    const statusIcon = w.isRunning ? (w.currentTaskId ? '●' : '○') : '·';
                    const statusLabel = w.isRunning ? (w.currentTaskId ? 'WORKING' : 'IDLE') : 'STOPPED';
                    const statusColor = w.isRunning ? (w.currentTaskId ? yellow : green) : gray;

                    const wLines: string[] = [];
                    wLines.push(`${dim('Status')}     ${statusIcon} ${statusColor(bold(statusLabel))}${w.pid ? dim(` (PID: ${w.pid})`) : ''}`);
                    wLines.push(`${dim('Role')}       ${w.role}`);
                    wLines.push(`${dim('Last Active')} ${new Date(w.lastActiveAt).toLocaleString()}`);

                    if (w.currentTaskId) {
                        wLines.push(`${dim('Task ID')}    ${cyan(w.currentTaskId)}`);
                        const desc = w.currentTaskDescription || '(no description)';
                        if (desc.length <= 50) {
                            wLines.push(`${dim('Task')}       ${desc}`);
                        } else {
                            wLines.push(`${dim('Task')}       ${desc.slice(0, 50)}`);
                            for (let i = 50; i < desc.length; i += 50) {
                                wLines.push(`             ${desc.slice(i, i + 50)}`);
                            }
                        }
                    } else {
                        wLines.push(`${dim('Task')}       ${gray('(none)')}`);
                    }

                    const tokens: any = tokenMap.get(w.agentId);
                    if (tokens) {
                        wLines.push(`${dim('Tokens')}     ${bold((tokens.totalTokens / 1000).toFixed(1) + 'k')} total ${dim('(')}${green((tokens.realTokens / 1000).toFixed(1) + 'k')} real, ${yellow((tokens.estimatedTokens / 1000).toFixed(1) + 'k')} est${dim(')')}`);
                    }

                    const agentData = orchestrator.getAgent(w.agentId);
                    if (agentData?.memoryPath) {
                        try {
                            const workerDir = path.dirname(agentData.memoryPath);
                            if (fs.existsSync(agentData.memoryPath)) {
                                const memData = JSON.parse(fs.readFileSync(agentData.memoryPath, 'utf-8'));
                                wLines.push(`${dim('Memory')}     ${memData.short?.length || 0} short, ${memData.episodic?.length || 0} episodic`);
                            }
                            const ksPath = path.join(workerDir, 'knowledge_store.json');
                            if (fs.existsSync(ksPath)) {
                                const ksData = JSON.parse(fs.readFileSync(ksPath, 'utf-8'));
                                if (ksData.documents?.length > 0) {
                                    wLines.push(`${dim('Knowledge')}  ${ksData.documents.length} docs, ${ksData.chunks?.length || 0} chunks`);
                                }
                            }
                        } catch { /* skip */ }
                    }

                    console.log('');
                    box(wLines, { title: `${w.name.toUpperCase()}`, width: 64, color: w.isRunning ? c.cyan : c.gray });
                }
            }
            console.log('');
            break;
        }
        case 'list': {
            renderScreenHeader(['Multi-Agent', 'Active Agents']);
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('No agents currently spawned.');
            } else {
                agents.forEach((a: any) => {
                    const isRunning = orchestrator.isWorkerRunning(a.id);
                    const agentData = orchestrator.getAgent(a.id);
                    console.log(`\n[${a.id}] ${a.name}`);
                    console.log(`  Status: ${a.status}`);
                    console.log(`  Worker: ${isRunning ? `Running (PID: ${agentData?.pid})` : 'Not running'}`);
                    console.log(`  Created: ${new Date(a.createdAt).toLocaleString()}`);
                    console.log(`  Capabilities: ${a.capabilities?.join(', ') || 'none'}`);
                    console.log(`  Active Tasks: ${a.activeTasks}`);
                });
            }
            break;
        }
        case 'processes': {
            renderScreenHeader(['Multi-Agent', 'Worker Processes']);
            if (runningWorkers.length === 0) {
                console.log('No worker processes currently running.');
            } else {
                runningWorkers.forEach((w: any) => {
                    console.log(`\n[PID ${w.pid}] ${w.name}`);
                    console.log(`  Agent ID: ${w.agentId}`);
                });
            }
            break;
        }
        case 'start_worker': {
            const agents = orchestrator.listAgents().filter((a: any) => !orchestrator.isWorkerRunning(a.id));
            if (agents.length === 0) {
                console.log('\nNo stopped agents available. All agents are either running or spawn a new one.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent to start:',
                    choices: agents.map((a: any) => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                }
            ]);

            const agentData = orchestrator.getAgent(agentId);
            if (agentData) {
                const success = orchestrator.startWorkerProcess(agentData);
                console.log(success ? '\nWorker process started.' : '\nFailed to start worker process.');
            }
            break;
        }
        case 'stop_worker': {
            if (runningWorkers.length === 0) {
                console.log('\nNo worker processes running.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select worker to stop:',
                    choices: runningWorkers.map((w: any) => ({ name: `${w.name} (PID: ${w.pid})`, value: w.agentId }))
                }
            ]);

            const success = orchestrator.stopWorkerProcess(agentId);
            console.log(success ? '\nStop signal sent to worker.' : '\nFailed to stop worker.');
            break;
        }
        case 'create_peer': {
            const { name, role, governance } = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Peer name:', validate: (v: string) => v.trim().length > 0 || 'Name required' },
                { type: 'input', name: 'role', message: 'Specialized role (e.g. "Security Auditor"):', default: 'peer' },
                { type: 'input', name: 'governance', message: 'Additional governance rules (optional):' }
            ]);

            try {
                const agentInstance = orchestrator.spawnAgent({
                    name: name.trim(),
                    role: role.trim(),
                    autoStart: false
                });

                const agentDir = path.dirname(agentInstance.memoryPath);
                if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

                const primaryIdPath = agent.config.get('agentIdentityPath');
                if (primaryIdPath && fs.existsSync(primaryIdPath)) {
                    const content = fs.readFileSync(primaryIdPath, 'utf-8');
                    const newId = content.replace(/Name: .*/, `Name: ${name}`);
                    fs.writeFileSync(path.join(agentDir, 'AGENT.md'), newId);
                }

                const primaryWorldPath = agent.config.get('worldPath');
                let worldContent = '';
                if (primaryWorldPath && fs.existsSync(primaryWorldPath)) {
                    worldContent = fs.readFileSync(primaryWorldPath, 'utf-8');
                } else {
                    worldContent = '# Agent World\nThis file contains the internal environment cluster and governance structure.\n';
                }

                if (governance) {
                    worldContent += `\n\n## Specialized Peer Governance: ${name}\n${governance}\n`;
                }
                fs.writeFileSync(path.join(agentDir, 'WORLD.md'), worldContent);

                orchestrator.startWorkerProcess(agentInstance);
                console.log(`\nPeer agent created and started: ${agentInstance.id} (${agentInstance.name})`);
            } catch (err: any) {
                console.log(`\nError creating peer: ${err.message}`);
            }
            break;
        }
        case 'spawn': {
            const { name, capabilities } = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Agent name:', validate: (v: string) => v.trim().length > 0 || 'Name required' },
                { type: 'input', name: 'capabilities', message: 'Capabilities (comma-separated, e.g., "browser,search,code"):' }
            ]);

            const caps = capabilities.split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0);
            const newAgent = orchestrator.spawnAgent({
                name: name.trim(),
                role: 'worker',
                capabilities: caps.length > 0 ? caps : undefined
            });
            console.log(`\nAgent spawned: ${newAgent.id} (${newAgent.name})`);
            break;
        }
        case 'configure_peer': {
            const agents = orchestrator.listAgents().filter((a: any) => a.id !== 'primary');
            if (agents.length === 0) {
                console.log('\nNo peer agents available to configure.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select peer agent to configure:',
                    choices: agents.map((a: any) => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                }
            ]);

            const { key, value } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'key',
                    message: 'Select setting to configure:',
                    choices: [
                        { name: 'Telegram Token', value: 'telegramToken' },
                        { name: 'Discord Token', value: 'discordToken' },
                        { name: 'Model Name', value: 'modelName' },
                        { name: 'LLM Provider', value: 'llmProvider' },
                        { name: 'Custom Setting...', value: 'custom' }
                    ]
                },
                {
                    type: 'input',
                    name: 'customKey',
                    message: 'Enter config key:',
                    when: (a: any) => a.key === 'custom'
                },
                {
                    type: 'input',
                    name: 'value',
                    message: 'Enter new value:',
                }
            ]);

            const finalKey = key === 'custom' ? key.customKey : key;
            const updates: Record<string, any> = { [finalKey]: value };

            try {
                const agentInstance = orchestrator.getAgent(agentId);
                if (!agentInstance) throw new Error('Agent not found');

                const workerDir = path.dirname(agentInstance.memoryPath);
                const workerConfigPath = path.join(workerDir, 'orcbot.config.yaml');

                const currentCfg = fs.existsSync(workerConfigPath)
                    ? yaml.parse(fs.readFileSync(workerConfigPath, 'utf-8'))
                    : {};

                const newCfg = { ...currentCfg, ...updates };
                if (updates.telegramToken || updates.discordToken) newCfg.allowWorkerChannels = true;

                fs.writeFileSync(workerConfigPath, yaml.stringify(newCfg));

                if (orchestrator.isWorkerRunning(agentId)) {
                    console.log(yellow(`\nRestarting peer ${agentId} to apply changes...`));
                    orchestrator.stopWorkerProcess(agentId);
                    setTimeout(() => orchestrator.startWorkerProcess(agentInstance), 6000);
                }
                console.log(green(`\nPeer configuration updated.`));
            } catch (err: any) {
                console.log(red(`\nError configuring peer: ${err.message}`));
            }
            break;
        }
        case 'delegate': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\nNo agents available. Spawn an agent first.');
                break;
            }

            const { agentId, taskDescription, priority } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent:',
                    choices: agents.map((a: any) => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                },
                { type: 'input', name: 'taskDescription', message: 'Task description:', validate: (v: string) => v.trim().length > 0 || 'Task required' },
                { type: 'number', name: 'priority', message: 'Priority (1-10, higher = more urgent):', default: 5 }
            ]);

            try {
                const task = orchestrator.delegateTask(agentId, taskDescription.trim(), Math.max(1, Math.min(10, priority)));
                console.log(`\nTask delegated: ${task.id}`);
            } catch (err: any) {
                console.log(`\nError: ${err.message}`);
            }
            break;
        }
        case 'distribute': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\nNo agents available. Spawn agents first.');
                break;
            }

            const { tasks } = await inquirer.prompt([
                { type: 'input', name: 'tasks', message: 'Enter tasks (semicolon-separated):' }
            ]);

            const taskList = tasks.split(';').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
            if (taskList.length === 0) {
                console.log('\nNo valid tasks provided.');
                break;
            }

            const results = orchestrator.distributeTaskList(taskList);
            console.log(`\nDistributed ${results.length} tasks:`);
            results.forEach((t: any) => {
                const agentName = agents.find((a: any) => a.id === t.assignedAgentId)?.name || t.assignedAgentId || 'unassigned';
                console.log(`  - "${t.description.slice(0, 40)}..." → ${agentName}`);
            });
            break;
        }
        case 'broadcast': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\nNo agents to broadcast to.');
                break;
            }

            const { message } = await inquirer.prompt([
                { type: 'input', name: 'message', message: 'Message to broadcast:', validate: (v: string) => v.trim().length > 0 || 'Message required' }
            ]);

            orchestrator.broadcast('main-agent', message.trim());
            console.log(`\nMessage broadcast to ${agents.length} agents.`);
            break;
        }
        case 'terminate': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\nNo agents to terminate.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent to terminate:',
                    choices: agents.map((a: any) => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                }
            ]);

            const success = orchestrator.terminateAgent(agentId);
            console.log(success ? '\nAgent terminated.' : '\nFailed to terminate agent.');
            break;
        }
        case 'terminate_all': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\nNo agents to terminate.');
                break;
            }

            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: `Terminate all ${agents.length} agents?`, default: false }
            ]);

            if (confirm) {
                let terminated = 0;
                agents.forEach((a: any) => {
                    if (orchestrator.terminateAgent(a.id)) terminated++;
                });
                console.log(`\nTerminated ${terminated} agents.`);
            }
            break;
        }
    }

    await waitKeyPress();
    return showOrchestrationMenu(ctx);
}
