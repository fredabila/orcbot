#!/usr/bin/env node
import { Command } from 'commander';
import * as p from '@clack/prompts';
import inquirer from 'inquirer';
import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { ConfigManager } from '../config/ConfigManager';
import { hasConfiguredProvider, getConfiguredProviders } from '../config/providerCredentials';
import { eventBus } from '../core/EventBus';
import qrcode from 'qrcode-terminal';

import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { WorkerProfileManager } from '../core/WorkerProfile';
import { DEFAULT_MODEL_IDS } from '../config/modelDefaults';
import {
    listConfiguredModels,
    findModelEntry,
    switchToModel,
    saveCurrentModel,
    removeSavedModel,
} from '../config/ModelRegistry';
import { DaemonManager } from '../utils/daemon';
import { getOrcBotDataHome, resolveDataHomePath } from '../utils/dataHome';
import { TokenTracker } from '../core/TokenTracker';
import { OllamaHelper } from '../utils/OllamaHelper';
import { aggregateWorldEvents, fetchWorldEvents, summarizeWorldEvents, WorldEvent, WorldEventSource, getRootCodeLabel } from '../tools/WorldEvents';
import { piBox, isPiTuiAvailable } from '../core/PiTuiRenderer';
import { collectDoctorReport, collectLLMCompatibilityReport } from './Doctor';
import {
    banner,
    renderScreenHeader,
    renderSplash,
    renderCompactHeader,
    isSplashShown,
    clearScreen,
    enterAlternateScreen,
    exitAlternateScreen,
} from './ui/Header';
import {
    promptSelect,
    promptText,
    promptConfirm,
    withSpinner,
} from './ui/Prompts';
import { agentStreamRenderer } from './ui/AgentStreamRenderer';
import { setCliContext } from './context';
import { showToolsManagerMenu } from './screens/ToolsScreen';
import {
    showConnectionsMenu,
    toggleAutonomyChannel,
    isAutonomyEnabledForChannel,
} from './screens/ChannelsScreen';
import {
    showModelsMenu,
    showSwitchModelMenu,
    showSelfTrainingMenu,
} from './screens/ModelsScreen';
import {
    showWorkerProfileMenu,
    showWorkerWebsitesMenu,
    showAgenticUserMenu,
} from './screens/WorkerProfileScreen';
import {
    showPushTaskMenu,
    showWorldEventsMenu,
    showWorldGovernanceMenu,
    showOrchestrationMenu,
    runWorldEventsMonitor,
    parseWorldSources,
    parseGlobeArgs,
} from './screens/WorldGovernanceScreen';
import {
    showSecurityMenu,
    showAdminUsersMenu,
} from './screens/SecurityScreen';
import {
    showSkillsMenu,
    showCommunitySkillsMenu,
} from './screens/SkillsScreen';
import {
    showLatencyMenu,
    runLatencyBenchmark,
} from './screens/LatencyScreen';
import {
    showBrowserMenu,
    showToolingMenu,
    showGoogleIdentityMenu,
    showGoogleWorkspaceCliMenu,
    showGitHubCliMenu,
    showGatewayMenu,
    showWebDashboardMenu,
    openDashboardInBrowser,
} from './screens/ToolingScreen';

dotenv.config(); // Local .env
dotenv.config({ path: resolveDataHomePath('.env') }); // Global .env

// ── ANSI color helpers (zero deps) ─────────────────────────────────────
// Palette roles come from DESIGN.md. Keep this restrained: one accent
// (cyan) plus neutrals, and green/yellow/red only where they mark real
// state. The remaining hues are legacy and are being retired screen by
// screen; do not introduce new decorative uses of them.
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    inverse: '\x1b[7m',
    strikethrough: '\x1b[9m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
    black: '\x1b[30m',
    gray: '\x1b[90m',
    brightCyan: '\x1b[96m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightRed: '\x1b[91m',
    brightMagenta: '\x1b[95m',
    brightBlue: '\x1b[94m',
    brightWhite: '\x1b[97m',
    bgCyan: '\x1b[46m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
    bgGray: '\x1b[100m',
    bgBlack: '\x1b[40m',
    bgWhite: '\x1b[47m',
};
const clr = (color: string, text: string) => `${color}${text}${c.reset}`;
const bold = (text: string) => clr(c.bold, text);
const dim = (text: string) => clr(c.dim, text);
const italic = (text: string) => clr(c.italic, text);
const cyan = (text: string) => clr(c.cyan, text);
const green = (text: string) => clr(c.green, text);
const yellow = (text: string) => clr(c.yellow, text);
const red = (text: string) => clr(c.red, text);
const magenta = (text: string) => clr(c.magenta, text);
const blue = (text: string) => clr(c.blue, text);
// white() used for high-contrast labels on badge backgrounds
const white = (text: string) => clr(c.white, text);
const gray = (text: string) => clr(c.gray, text);
const brightCyan = (text: string) => clr(c.brightCyan, text);
const brightGreen = (text: string) => clr(c.brightGreen, text);
const brightYellow = (text: string) => clr(c.brightYellow, text);
const brightRed = (text: string) => clr(c.brightRed, text);
const brightMagenta = (text: string) => clr(c.brightMagenta, text);
const brightBlue = (text: string) => clr(c.brightBlue, text);
const brightWhite = (text: string) => clr(c.brightWhite, text);

// ── Visual rendering helpers ───────────────────────────────────────────

/** Render a box with double-line borders and optional title.
 *  Delegates to @mariozechner/pi-tui Box component when available,
 *  falling back to the classic hand-rolled renderer. */
function box(lines: string[], opts: { title?: string; width?: number; color?: string; padding?: number } = {}) {
    piBox(lines, {
        title: opts.title,
        width: opts.width,
        paddingX: opts.padding,
        borderColor: opts.color ?? c.gray,
    });
}

// showToolsManagerMenu is imported from ./screens/ToolsScreen

/** Render a horizontal bar (progress/usage visualization) */
function progressBar(value: number, max: number, width = 20, opts: { filled?: string; empty?: string; colorFn?: (s: string) => string; invert?: boolean } = {}): string {
    const ratio = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
    const filledLen = Math.round(ratio * width);
    const emptyLen = width - filledLen;
    const filled = (opts.filled || '█').repeat(filledLen);
    const empty = (opts.empty || '░').repeat(emptyLen);
    // Default: green=low, yellow=mid, red=high (capacity usage semantics).
    // Pass invert:true for metrics where high is good (e.g. accuracy %).
    let colorFn: (s: string) => string;
    if (opts.colorFn) {
        colorFn = opts.colorFn;
    } else if (opts.invert) {
        colorFn = ratio > 0.7 ? brightGreen : ratio > 0.4 ? yellow : red;
    } else {
        colorFn = ratio > 0.8 ? red : ratio > 0.5 ? yellow : brightGreen;
    }
    return colorFn(filled) + dim(empty);
}

/** Render a simple table with aligned columns */
function table(rows: string[][], opts: { indent?: string; separator?: string; headerColor?: (s: string) => string } = {}) {
    const indent = opts.indent || '  ';
    const sep = opts.separator || '  ';
    if (rows.length === 0) return;

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const colWidths: number[] = [];
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            colWidths[i] = Math.max(colWidths[i] || 0, stripAnsi(row[i]).length);
        }
    }

    rows.forEach((row, ri) => {
        const cells = row.map((cell, ci) => {
            const padLen = colWidths[ci] - stripAnsi(cell).length;
            const padded = cell + ' '.repeat(Math.max(0, padLen));
            if (ri === 0 && opts.headerColor) return opts.headerColor(stripAnsi(padded));
            return padded;
        });
        console.log(indent + cells.join(sep));
    });
}

/** Render a mini sparkline from an array of numbers */
function sparkline(values: number[]): string {
    if (values.length === 0) return '';
    const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values.map(v => {
        const idx = Math.round(((v - min) / range) * (chars.length - 1));
        return cyan(chars[idx]);
    }).join('');
}


function sectionHeader(title: string) {
    // One accent on the title (the screen's focal element) and a dim rule under
    // it. The old triple-line double box framed every screen the same way and
    // carried a decorative emoji; neither is needed to mark a section.
    console.log('');
    console.log(`  ${c.brightCyan}${c.bold}${title}${c.reset}`);
    console.log(`  ${c.gray}${'─'.repeat(Math.max(8, title.length))}${c.reset}`);
}

function kvLine(key: string, value: string, indent = '  ') {
    // Use white for the key label so it's clearly visible (gray was too dark)
    console.log(`${indent}  ${c.white}${c.bold}${key}${c.reset}  ${value}`);
}

/** State label. Color is the signal (DESIGN.md): green when the thing is
 *  really on, gray when it is off. No filled background block. */
function statusBadge(ok: boolean, onLabel = 'ON', offLabel = 'OFF'): string {
    return ok ? `${c.brightGreen}${onLabel}${c.reset}` : `${c.gray}${offLabel}${c.reset}`;
}

/** Status dot with label */
function statusDot(ok: boolean, label?: string): string {
    if (ok) return `${c.brightGreen}●${c.reset}${label ? ` ${c.white}${label}${c.reset}` : ''}`;
    // Off-state: gray dot + white label so the label text remains readable
    return `${c.gray}○${c.reset}${label ? ` ${c.white}${label}${c.reset}` : ''}`;
}

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Promise rejection (non-fatal): ${reason}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception (non-fatal): ${err?.stack || err}`);
});

/** Connect the global event bus to the CLI for real-time feedback. */
function setupEventSubscriptions() {
    let currentLlmStream = '';

    eventBus.on('llm:token', (data: any) => {
        if (!currentLlmStream) {
            process.stdout.write(`\n${c.brightCyan}Agent:${c.reset} `);
        }
        currentLlmStream += data.token;
        process.stdout.write(data.token);
    });

    eventBus.on('llm:thought', (data: any) => {
        process.stdout.write(`${c.gray}${data.thought}${c.reset}`);
    });

    eventBus.on('llm:end', () => {
        if (currentLlmStream) {
            process.stdout.write('\n');
            currentLlmStream = '';
        }
    });

    eventBus.on('task:step:start', (data: any) => {
        console.log(`\n${c.brightYellow}Step ${data.step}:${c.reset} ${c.bold}${data.description}${c.reset}`);
    });

    eventBus.on('tool:call', (data: any) => {
        console.log(`${c.magenta}Tool:${c.reset} ${c.bold}${data.name}${c.reset} ${c.dim}${JSON.stringify(data.arguments || {})}${c.reset}`);
    });
}

const program = new Command();
const agent = new Agent({ isCLI: true });
const workerProfile = new WorkerProfileManager();

setCliContext({
    agent,
    workerProfile,
    showMainMenu: async () => { await showMainMenu(); },
});

program
    .name('orcbot')
    .description('TypeScript Autonomous Agent CLI Tool')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new agent environment')
    .action(async () => {
        const dataHome = getOrcBotDataHome();
        const configPath = path.join(dataHome, 'orcbot.config.yaml');

        if (fs.existsSync(configPath)) {
            console.log('An existing OrcBot environment was found. Launching setup wizard to update it.\n');
        } else {
            console.log('No existing environment found. Starting interactive setup.\n');
        }

        const { runSetup, scaffoldFiles } = require('./setup');
        await runSetup();
    });

program
    .command('setup')
    .description('Launch the interactive configuration wizard')
    .action(async () => {
        const { runSetup } = require('./setup');
        await runSetup();
    });

program
    .command('builder')
    .description('Build a new skill from a remote SKILLS.md specification')
    .argument('<url>', 'URL to the specification')
    .action(async (url) => {
        const { SkillBuilder } = require('./builder');
        const builder = new SkillBuilder();
        console.log(`Fetching spec and building skill from ${url}...`);
        const result = await builder.buildFromUrl(url);
        console.log(result);
    });

// ─── Skill subcommands ───────────────────────────────────────────────
const skillCmd = program
    .command('skill')
    .description('Manage Agent Skills (SKILL.md format)');

skillCmd
    .command('install')
    .description('Install a skill from a GitHub URL, gist, .skill file, or local path')
    .argument('<source>', 'URL or local path to the skill')
    .action(async (source) => {
        const { ConfigManager } = require('../config/ConfigManager');
        const config = new ConfigManager();
        const { SkillsManager } = require('./SkillsManager') || require('../core/SkillsManager');
        const sm = new (require('../core/SkillsManager').SkillsManager)(
            config.get('skillsPath'),
            config.get('pluginsPath')
        );

        if (source.startsWith('http://') || source.startsWith('https://')) {
            console.log(`Installing skill from ${source}...`);
            const result = await sm.installSkillFromUrl(source);
            console.log(result.success ? `${result.message}` : `${result.message}`);
        } else {
            console.log(`Installing skill from ${source}...`);
            const result = await sm.installSkillFromPath(source);
            console.log(result.success ? `${result.message}` : `${result.message}`);
        }
    });

skillCmd
    .command('create')
    .description('Create a new skill scaffold')
    .argument('<name>', 'Skill name (lowercase-with-hyphens)')
    .option('-d, --description <desc>', 'Skill description')
    .action(async (name, options) => {
        const { ConfigManager } = require('../config/ConfigManager');
        const config = new ConfigManager();
        const sm = new (require('../core/SkillsManager').SkillsManager)(
            config.get('skillsPath'),
            config.get('pluginsPath')
        );

        const result = sm.initSkill(name, options.description);
        console.log(result.success ? `${result.message}` : `${result.message}`);
        if (result.success) {
            console.log(`\nNext steps:`);
            console.log(`  1. Edit ${path.join(result.path, 'SKILL.md')}`);
            console.log(`  2. Add scripts to ${path.join(result.path, 'scripts/')}`);
            console.log(`  3. Add references to ${path.join(result.path, 'references/')}`);
            console.log(`  4. Validate: orcbot skill validate ${name}`);
        }
    });

skillCmd
    .command('list')
    .description('List all installed agent skills')
    .action(async () => {
        const { ConfigManager } = require('../config/ConfigManager');
        const config = new ConfigManager();
        const sm = new (require('../core/SkillsManager').SkillsManager)(
            config.get('skillsPath'),
            config.get('pluginsPath')
        );

        const skills = sm.getAgentSkills();
        if (skills.length === 0) {
            console.log('No Agent Skills installed.');
            console.log('  Install: orcbot skill install <url>');
            console.log('  Create:  orcbot skill create <name>');
            return;
        }

        console.log(`\n${skills.length} Agent Skills installed:\n`);
        for (const s of skills) {
            const status = s.activated ? 'Active' : 'Inactive';
            console.log(`${status} ${s.meta.name}`);
            console.log(`  ${s.meta.description}`);
            if (s.scripts.length > 0) console.log(`  Scripts: ${s.scripts.join(', ')}`);
            if (s.references.length > 0) console.log(`  References: ${s.references.join(', ')}`);
            if (s.meta.metadata?.version) console.log(`  Version: ${s.meta.metadata.version}`);
            console.log('');
        }
    });

skillCmd
    .command('validate')
    .description('Validate a skill against the Agent Skills specification')
    .argument('<name>', 'Skill name or path to skill directory')
    .action(async (name) => {
        const { ConfigManager } = require('../config/ConfigManager');
        const config = new ConfigManager();
        const sm = new (require('../core/SkillsManager').SkillsManager)(
            config.get('skillsPath'),
            config.get('pluginsPath')
        );

        let skillDir = name;
        if (!path.isAbsolute(name)) {
            const agentSkill = sm.getAgentSkill(name);
            if (agentSkill) {
                skillDir = agentSkill.skillDir;
            } else {
                skillDir = path.join(config.get('pluginsPath'), 'skills', name);
            }
        }

        const result = sm.validateSkill(skillDir);
        if (result.valid) {
            console.log(`Skill "${name}" is valid.`);
        } else {
            console.log(`${result.errors.length} issue(s):`);
            result.errors.forEach((e: string) => console.log(`  - ${e}`));
            process.exitCode = 1;
        }
    });

skillCmd
    .command('uninstall')
    .description('Uninstall an agent skill')
    .argument('<name>', 'Skill name to uninstall')
    .action(async (name) => {
        const { ConfigManager } = require('../config/ConfigManager');
        const config = new ConfigManager();
        const sm = new (require('../core/SkillsManager').SkillsManager)(
            config.get('skillsPath'),
            config.get('pluginsPath')
        );

        const result = sm.uninstallAgentSkill(name);
        console.log(result);
    });

program
    .command('stop')
    .description('Stop all running OrcBot instances (daemon, background, gateway)')
    .option('-f, --force', 'Force kill (SIGKILL) if graceful shutdown fails')
    .action(async (options) => {
        const dataDir = getOrcBotDataHome();
        let killed = 0;
        let failed = 0;

        const tryKill = (pid: number, label: string): boolean => {
            try {
                process.kill(pid, 0); // check alive
            } catch {
                return false; // not running
            }
            try {
                process.kill(pid, 'SIGTERM');
                console.log(`    Sent SIGTERM to ${label} (PID: ${pid})`);

                // If --force, also send SIGKILL after a short wait
                if (options.force) {
                    setTimeout(() => {
                        try {
                            process.kill(pid, 0);
                            process.kill(pid, 'SIGKILL');
                            console.log(`    Force-killed ${label} (PID: ${pid})`);
                        } catch { }
                    }, 2000);
                }
                return true;
            } catch (e: any) {
                console.log(`    Failed to stop ${label} (PID: ${pid}): ${e.message}`);
                return false;
            }
        };

        console.log('\nStopping all OrcBot processes...\n');

        // 1. Lock file (main agent / background / gateway processes)
        const lockPath = path.join(dataDir, 'orcbot.lock');
        if (fs.existsSync(lockPath)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                const pid = Number(lockData.pid);
                if (pid && tryKill(pid, `agent (started ${lockData.startedAt || 'unknown'})`)) {
                    killed++;
                }
                fs.unlinkSync(lockPath);
            } catch {
                try { fs.unlinkSync(lockPath); } catch { }
            }
        }

        // 2. Daemon PID file
        const daemonPidPath = path.join(dataDir, 'orcbot.pid');
        if (fs.existsSync(daemonPidPath)) {
            try {
                const pid = parseInt(fs.readFileSync(daemonPidPath, 'utf8').trim(), 10);
                if (pid && tryKill(pid, 'daemon')) {
                    killed++;
                }
                fs.unlinkSync(daemonPidPath);
            } catch {
                try { fs.unlinkSync(daemonPidPath); } catch { }
            }
        }

        // 3. Lightpanda PID file
        const lightpandaPidPath = path.join(dataDir, 'lightpanda.pid');
        if (fs.existsSync(lightpandaPidPath)) {
            try {
                const pid = parseInt(fs.readFileSync(lightpandaPidPath, 'utf8').trim(), 10);
                if (pid && tryKill(pid, 'lightpanda browser')) {
                    killed++;
                }
                fs.unlinkSync(lightpandaPidPath);
            } catch {
                try { fs.unlinkSync(lightpandaPidPath); } catch { }
            }
        }

        if (killed === 0) {
            console.log('   No running OrcBot processes found.');
        } else {
            console.log(`\n   Stopped ${killed} process(es).`);
        }

        console.log('');
    });

program
    .command('run')
    .description('Start the agent autonomous loop (checks for daemon conflicts)')
    .option('-d, --daemon', 'Run in background as a daemon')
    .option('-b, --background', 'Run in background (nohup-style)')
    .option('--with-gateway', 'Also start the web gateway server (overrides gatewayAutoStart config)')
    .option('--no-gateway', 'Disable gateway auto-start even if gatewayAutoStart is set in config')
    .option('-s, --gateway-static <path>', 'Path to static files for the gateway dashboard (default: apps/dashboard)')
    .option('--daemon-child', 'Internal: run as daemon child', false)
    .option('--background-child', 'Internal: run as background child', false)
    .action(async (options) => {
        const daemonManager = DaemonManager.createDefault();
        const status = daemonManager.isRunning();

        // Check for ANY existing OrcBot instance via lock file
        const lockPath = resolveDataHomePath('orcbot.lock');
        let existingInstance: { pid: number; startedAt: string; host: string } | null = null;

        if (fs.existsSync(lockPath)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                const pid = Number(lockData.pid);
                if (pid && pid !== process.pid) {
                    // Check if process is actually running
                    try {
                        process.kill(pid, 0); // Signal 0 = just check if exists
                        existingInstance = lockData;
                    } catch (e: any) {
                        if (e?.code === 'ESRCH') {
                            // Process doesn't exist, stale lock - remove it
                            fs.unlinkSync(lockPath);
                            console.log('Cleaned up stale lock file from previous crashed instance.');
                        }
                    }
                }
            } catch (e) {
                // Invalid lock file, ignore
            }
        }

        // Block if existing instance found
        if (existingInstance && !options.daemonChild && !options.backgroundChild) {
            console.error('\nOrcBot is already running!');
            console.error(`   PID: ${existingInstance.pid}`);
            console.error(`   Started: ${existingInstance.startedAt}`);
            console.error(`   Host: ${existingInstance.host}`);
            console.error('\n   To check what\'s running:');
            console.error(`   $ ps aux | grep orcbot`);
            console.error('\n   To stop ALL OrcBot processes:');
            console.error(`   $ pkill -f "orcbot"  OR  systemctl stop orcbot`);
            console.error('\n   Then try again.');
            console.error('');
            process.exit(1);
        }

        if (options.background && !options.backgroundChild) {
            const { spawn } = require('child_process');
            const nodePath = process.execPath;
            const scriptPath = process.argv[1];

            const dataDir = getOrcBotDataHome();
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            const logPath = path.join(dataDir, 'foreground.log');
            const out = fs.openSync(logPath, 'a');

            const child = spawn(
                nodePath,
                [scriptPath, 'run', '--background-child'],
                {
                    detached: true,
                    stdio: ['ignore', out, out],
                    env: { ...process.env, ORCBOT_BACKGROUND_CHILD: '1' }
                }
            );

            child.unref();
            console.log('\nOrcBot is running in the background.');
            console.log(`   Log file: ${logPath}`);
            console.log('   Stop with: orcbot stop');
            return;
        }

        // Determine whether to also start the gateway server.
        // Priority: --with-gateway flag > --no-gateway flag > 'gatewayAutoStart' config key.
        const gatewayAutoStartConfig = agent.config.get('gatewayAutoStart');
        const shouldStartGateway = options.withGateway ||
            (!options.noGateway && (gatewayAutoStartConfig === true || gatewayAutoStartConfig === 'true'));

        const startGatewayIfNeeded = async () => {
            if (!shouldStartGateway) return;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { GatewayServer } = require('../gateway/GatewayServer');
            const port = parseInt(String(agent.config.get('gatewayPort') || '3100'));
            const host = String(agent.config.get('gatewayHost') || '0.0.0.0');
            const apiKey = agent.config.get('gatewayApiKey');
            const staticDir = options.gatewayStatic || agent.config.get('gatewayStaticDir') || undefined;
            const gateway = new GatewayServer(agent, agent.config, { port, host, apiKey, staticDir });
            await gateway.start();
            gateway.setAgentLoopStarted(true);
            logger.info(`Gateway server started on ${host}:${port} (auto-start via run command)`);
            console.log(`Gateway server listening on http://${host}:${port}`);
            process.on('SIGINT', () => { gateway.stop(); process.exit(0); });
        };

        if (options.daemon || options.daemonChild) {
            // Daemon mode - check already handled in daemonize() method
            daemonManager.daemonize();
            logger.info('Agent loop starting in daemon mode...');
            await startGatewayIfNeeded();
            await agent.start();
        } else {
            // Foreground mode - check if daemon is already running
            if (status.running) {
                console.error('\nCannot start in foreground mode: OrcBot daemon is already running');
                console.error(`   Daemon PID: ${status.pid}`);
                console.error(`   PID file: ${daemonManager.getPidFile()}`);
                console.error('\n   To stop the daemon first, run:');
                console.error(`   $ orcbot daemon stop`);
                console.error('\n   Or to view daemon status:');
                console.error(`   $ orcbot daemon status`);
                console.error('');
                process.exit(1);
            }

            console.log('Agent loop starting... (Press Ctrl+C to stop)');
            setupEventSubscriptions();
            await startGatewayIfNeeded();
            agentStreamRenderer.attach();
            try {
                await agent.start();
            } finally {
                agentStreamRenderer.detach();
            }
        }
    });

program
    .command('agent')
    .description('Manage peer agents')
    .argument('<action>', 'Action to perform (list, start, stop, restart, terminate)')
    .argument('[id]', 'Agent ID (required for start/stop/restart/terminate)')
    .action(async (action, id) => {
        const cmd = String(action).toLowerCase();

        if (cmd === 'list') {
            const agents = agent.orchestrator.getAgents();
            if (agents.length === 0) {
                console.log('No agents registered.');
                return;
            }
            console.log('\nRegistered Agents:');
            for (const a of agents) {
                const isRunning = agent.orchestrator.isWorkerRunning(a.id);
                const statusStr = isRunning ? c.green + 'Running' + c.reset : c.red + 'Stopped' + c.reset;
                console.log(`- ${c.bold}${a.name}${c.reset} (${a.id})`);
                console.log(`  Status: ${statusStr} | Role: ${a.role}`);
                if (a.currentTask) console.log(`  Task: ${a.currentTask}`);
            }
            console.log('');
            return;
        }

        if (!id) {
            console.error(`Error: Agent ID is required for action '${cmd}'`);
            return;
        }

        const agentInstance = agent.orchestrator.getAgent(id);
        if (!agentInstance) {
            console.error(`Error: Agent '${id}' not found.`);
            return;
        }

        switch (cmd) {
            case 'start':
                if (agent.orchestrator.isWorkerRunning(id)) {
                    console.log(`Agent ${id} is already running.`);
                } else {
                    console.log(`Starting agent ${id}... (Requires primary OrcBot to be running)`);
                    const success = agent.orchestrator.startWorkerProcess(agentInstance);
                    console.log(success ? `Agent ${id} started.` : `Failed to start agent ${id}.`);
                }
                break;
            case 'stop':
                if (!agent.orchestrator.isWorkerRunning(id)) {
                    console.log(`Agent ${id} is not running.`);
                } else {
                    const success = agent.orchestrator.stopWorkerProcess(id);
                    console.log(success ? `Agent ${id} stopped.` : `Failed to stop agent ${id}.`);
                }
                break;
            case 'restart':
                console.log(`Restarting agent ${id}...`);
                agent.orchestrator.stopWorkerProcess(id);
                setTimeout(() => {
                    const success = agent.orchestrator.startWorkerProcess(agentInstance);
                    console.log(success ? `Agent ${id} restarted.` : `Failed to restart agent ${id}.`);
                }, 3000);
                break;
            case 'terminate':
                const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to PERMANENTLY terminate agent ${id}? This deletes their memory and files.`,
                    default: false
                }]);
                if (confirm) {
                    const success = agent.orchestrator.terminateAgent(id);
                    console.log(success ? `Agent ${id} terminated.` : `Failed to terminate agent ${id}.`);
                }
                break;
            default:
                console.error(`Unknown action: ${cmd}`);
        }
    });

program
    .command('ui')
    .description('Start the interactive TUI mode')
    .action(async () => {
        enterAlternateScreen();
        try {
            await showMainMenu();
        } finally {
            exitAlternateScreen();
        }
    });

program
    .command('push')
    .description('Push a manual task to the agent')
    .argument('<task>', 'Task description')
    .option('-p, --priority <number>', 'Task priority (1-10)', '5')
    .action(async (task, options) => {
        const priority = parseInt(options.priority);
        console.log(`Pushing task: "${task}" with priority ${priority}`);
        await agent.pushTask(task, priority);
        logger.info(`Manual task pushed via CLI: ${task}`);
    });

program
    .command('reset')
    .description('Reset agent memory, identity, plugins, skills, and all persisted state')
    .option('--all', 'Reset everything (default when no flags provided)')
    .option('--memory', 'Clear memory.json and actions.json')
    .option('--identity', 'Reset USER.md, .AI.md, JOURNAL.md, LEARNING.md')
    .option('--plugins', 'Remove custom plugins (.ts/.js)')
    .option('--skills', 'Remove installed Agent Skills (SKILL.md packages)')
    .option('--profiles', 'Clear contact profiles')
    .option('--downloads', 'Clear downloaded media files')
    .option('--bootstrap', 'Reset bootstrap files (AGENTS.md, SOUL.md, etc.) to defaults')
    .option('--schedules', 'Clear heartbeat schedules and scheduled tasks')
    .action(async (opts) => {
        const hasSelectiveFlag = opts.memory || opts.identity || opts.plugins || opts.skills ||
            opts.profiles || opts.downloads || opts.bootstrap || opts.schedules;
        const isFullReset = opts.all || !hasSelectiveFlag;

        // Check for running daemon before resetting
        const daemon = DaemonManager.createDefault();
        const daemonStatus = daemon.isRunning();
        if (daemonStatus.running) {
            console.error(`\n  ${c.red}${c.bold}Cannot reset: OrcBot daemon is currently running (PID: ${daemonStatus.pid}).${c.reset}`);
            console.error(`     Please stop it first: ${c.white}orcbot stop${c.reset}\n`);
            return;
        }

        if (isFullReset) {
            console.log('');
            box([
                `${c.red}${c.bold}This will clear EVERYTHING:${c.reset}`,
                '',
                `  ${c.yellow}●${c.reset} Memory & action queue`,
                `  ${c.yellow}●${c.reset} Identity files (USER.md, .AI.md, JOURNAL, LEARNING)`,
                `  ${c.yellow}●${c.reset} Custom plugins & agent skills`,
                `  ${c.yellow}●${c.reset} Contact profiles`,
                `  ${c.yellow}●${c.reset} Downloaded media files`,
                `  ${c.yellow}●${c.reset} Bootstrap files (reset to defaults)`,
                `  ${c.yellow}●${c.reset} Schedules & heartbeat data`,
            ], {
                title: 'FULL RESET',
                color: c.red,
                width: 54
            });
            console.log('');
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Are you sure you want to reset EVERYTHING? This cannot be undone.', default: false }
            ]);
            if (confirm) {
                await agent.resetMemory();
                console.log(`\n  ${c.green}✓${c.reset} Agent has been ${c.bold}fully reset${c.reset} to factory settings.\n`);
            }
        } else {
            const selected = Object.entries({
                memory: opts.memory,
                identity: opts.identity,
                plugins: opts.plugins,
                agentSkills: opts.skills,
                profiles: opts.profiles,
                downloads: opts.downloads,
                bootstrap: opts.bootstrap,
                schedules: opts.schedules,
            }).filter(([, v]) => v).map(([k]) => k);

            console.log(`\n  Resetting: ${selected.map(s => c.yellow + s + c.reset).join(', ')}`);
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: `Reset ${selected.length} category(ies)? This cannot be undone.`, default: false }
            ]);
            if (confirm) {
                await agent.resetMemory({
                    memory: opts.memory,
                    identity: opts.identity,
                    plugins: opts.plugins,
                    agentSkills: opts.skills,
                    profiles: opts.profiles,
                    downloads: opts.downloads,
                    bootstrap: opts.bootstrap,
                    schedules: opts.schedules,
                });
                console.log(`\n  ${c.green}✓${c.reset} Reset complete for: ${selected.join(', ')}\n`);
            }
        }
    });

program
    .command('update')
    .description('Update OrcBot to the latest version')
    .action(async () => {
        await performUpdate();
    });

program
    .command('status')
    .description('View agent status, memory and action queue')
    .action(() => {
        // Check for running instance
        const lockPath = resolveDataHomePath('orcbot.lock');
        console.log('\n=== OrcBot Status ===\n');

        if (fs.existsSync(lockPath)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                const pid = Number(lockData.pid);
                let isRunning = false;

                if (pid) {
                    try {
                        process.kill(pid, 0);
                        isRunning = true;
                    } catch (e) {
                        // Process not running
                    }
                }

                if (isRunning) {
                    console.log('OrcBot is RUNNING');
                    console.log(`   PID: ${lockData.pid}`);
                    console.log(`   Started: ${lockData.startedAt}`);
                    console.log(`   Host: ${lockData.host}`);
                    console.log(`   Working Dir: ${lockData.cwd}`);
                    console.log('\n   To stop: orcbot stop');
                } else {
                    console.log('OrcBot is NOT running (stale lock file found)');
                    fs.unlinkSync(lockPath);
                    console.log('    Cleaned up stale lock file.');
                }
            } catch (e) {
                console.log('OrcBot is NOT running');
            }
        } else {
            console.log('OrcBot is NOT running');
            console.log('\n   To start: orcbot run  OR  systemctl start orcbot');
        }

        console.log('\n--- Memory & Queue ---');
        showStatus();
    });

program
    .command('doctor')
    .description('Run a local health and deployment audit for OrcBot')
    .option('--deep', 'Include additional filesystem/state checks')
    .option('--llm', 'Include LLM/provider compatibility checks')
    .option('--live', 'Run live provider probes for configured/linked providers (uses API/OAuth calls)')
    .option('--json', 'Print the report as JSON')
    .action(async (opts) => {
        const report = collectDoctorReport(agent.config, { deep: !!opts.deep });

        if (opts.llm || opts.live) {
            report.llmCompatibility = await collectLLMCompatibilityReport(agent.config, { live: !!opts.live });
        }

        if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        console.log('\n=== OrcBot Doctor ===\n');
        console.log(`Checked: ${report.checkedAt}`);
        console.log(`Data home: ${report.facts.dataHome}`);
        console.log(`Gateway: ${report.facts.gatewayHost}:${report.facts.gatewayPort} ${report.facts.gatewayAuthEnabled ? '(auth enabled)' : '(no auth)'}`);
        console.log(`MCP HTTP: ${report.facts.mcpHost}:${report.facts.mcpPort}${report.facts.mcpPath} ${report.facts.mcpAuthEnabled ? `(auth enabled via ${report.facts.mcpAuthSource})` : '(no auth)'}`);
        console.log(`Channels: ${report.facts.channelsConfigured.length > 0 ? report.facts.channelsConfigured.join(', ') : 'none'}`);
        console.log(`Providers: ${report.facts.providersConfigured.length > 0 ? report.facts.providersConfigured.join(', ') : 'none'}`);
        console.log('');

        if (report.llmCompatibility) {
            const llm = report.llmCompatibility;
            const rows = [
                ['Provider', 'Model', 'Auth', 'Schema', opts.live ? 'Live' : 'Ready'],
                ...llm.providers.map(provider => [
                    provider.provider,
                    provider.model,
                    provider.authMode,
                    provider.toolSchemaCompatible ? green('ok') : brightRed('broken'),
                    opts.live
                        ? (provider.liveProbe?.success ? green('ok') : provider.liveProbe?.attempted ? brightRed('fail') : gray('skipped'))
                        : (provider.ready ? green('ready') : brightRed('missing')),
                ])
            ];

            box([
                `${c.white}Active${c.reset}      ${brightCyan(llm.activeProvider)} ${dim(`(${llm.activeModel})`)}`,
                `${c.white}pi-ai${c.reset}       ${llm.usePiAI ? brightGreen('enabled') : gray('disabled')}`,
                `${c.white}Schema${c.reset}      ${llm.schemaContractOk ? brightGreen('valid') : brightRed('broken')}`,
            ], { title: 'LLM COMPATIBILITY', width: 72, color: llm.schemaContractOk ? c.green : c.red });
            console.log('');
            table(rows, { headerColor: brightWhite });
            console.log('');

            for (const provider of llm.providers) {
                if (provider.notes.length > 0) {
                    console.log(`${brightCyan(provider.provider)}: ${provider.notes.join('; ')}`);
                }
                if (provider.liveProbe?.error) {
                    console.log(`  ${dim('Probe:')} ${provider.liveProbe.error}`);
                }
            }
            console.log('');
        }

        const summaryLines = [
            `${c.white}Critical${c.reset}  ${report.summary.critical > 0 ? brightRed(bold(String(report.summary.critical))) : green('0')}`,
            `${c.white}Warnings${c.reset}  ${report.summary.warn > 0 ? brightYellow(bold(String(report.summary.warn))) : green('0')}`,
            `${c.white}Info${c.reset}      ${report.summary.info > 0 ? brightCyan(String(report.summary.info)) : gray('0')}`,
        ];
        box(summaryLines, { title: 'DOCTOR SUMMARY', width: 40, color: report.summary.critical > 0 ? c.red : (report.summary.warn > 0 ? c.yellow : c.green) });
        console.log('');

        if (report.findings.length === 0) {
            console.log(`${green('✓')} No findings. Your current OrcBot setup looks healthy.\n`);
            return;
        }

        for (const finding of report.findings) {
            const tone = finding.severity === 'critical' ? brightRed('CRITICAL') : finding.severity === 'warn' ? brightYellow('WARN') : brightCyan('INFO');
            console.log(`${tone} ${bold(finding.title)}`);
            console.log(`  ${finding.message}`);
            if (finding.recommendation) {
                console.log(`  ${dim('Fix:')} ${finding.recommendation}`);
            }
            console.log('');
        }
    });

const securityCommand = program
    .command('security')
    .description('Security-focused checks and configuration helpers');

securityCommand
    .command('audit')
    .description('Run a security-oriented audit of the current OrcBot configuration')
    .option('--deep', 'Include additional filesystem/state checks')
    .option('--json', 'Print the report as JSON')
    .action((opts) => {
        const report = collectDoctorReport(agent.config, { deep: !!opts.deep });
        const securityFindings = report.findings.filter(f => f.area === 'security' || f.area === 'gateway' || f.area === 'mcp' || f.area === 'channels');
        const filtered = {
            ...report,
            summary: {
                critical: securityFindings.filter(f => f.severity === 'critical').length,
                warn: securityFindings.filter(f => f.severity === 'warn').length,
                info: securityFindings.filter(f => f.severity === 'info').length,
                ok: Math.max(0, 6 - securityFindings.filter(f => f.severity !== 'info').length)
            },
            findings: securityFindings
        };

        if (opts.json) {
            console.log(JSON.stringify(filtered, null, 2));
            return;
        }

        console.log('\n=== OrcBot Security Audit ===\n');
        if (filtered.findings.length === 0) {
            console.log(`${green('✓')} No security findings in the current audit scope.\n`);
            return;
        }

        for (const finding of filtered.findings) {
            const tone = finding.severity === 'critical' ? brightRed('CRITICAL') : finding.severity === 'warn' ? brightYellow('WARN') : brightCyan('INFO');
            console.log(`${tone} ${bold(finding.title)}`);
            console.log(`  ${finding.message}`);
            if (finding.recommendation) console.log(`  ${dim('Fix:')} ${finding.recommendation}`);
            console.log('');
        }
    });

program
    .command('metrics')
    .description('Show internal guardrail metrics (non-user-facing telemetry)')
    .option('--limit <n>', 'How many recent metric events to show', '10')
    .action((opts) => {
        const limitRaw = Number(opts.limit ?? 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
        showGuardrailMetrics(limit);
    });

program
    .command('tokens')
    .description('Show token usage summary')
    .argument('[action]', 'Action: recount (rebuild summary from raw log)')
    .action((action) => {
        if (action === 'recount') {
            const tracker = new TokenTracker(
                agent.config.get('tokenUsagePath'),
                agent.config.get('tokenLogPath')
            );
            console.log(yellow('  Rebuilding token summary from raw log file...'));
            const summary = tracker.recountFromLog();
            const accuracy = tracker.getAccuracyReport();
            console.log(green('  ✓ Summary rebuilt successfully.'));
            console.log(dim(`    Total: ${summary.totals.totalTokens.toLocaleString()} tokens (${accuracy.realPct}% API-reported, ${accuracy.estimatedPct}% estimated)`));
            console.log(dim(`    Calls: ${accuracy.totalCalls} (${accuracy.realCalls} real, ${accuracy.estimatedCalls} estimated)`));
            console.log('');
        } else {
            showTokenUsage();
        }
    });

program
    .command('latency')
    .description('Run latency benchmark on agent subsystems')
    .option('--llm', 'Include LLM round-trip benchmark (requires API key)')
    .action(async (opts) => {
        banner();
        await runLatencyBenchmark({ includeLLM: !!opts.llm });
    });

program
    .command('world')
    .description('Live world events dashboard with globe')
    .option('--sources <list>', 'Comma-separated sources (gdelt,usgs,opensky)')
    .option('--refresh <seconds>', 'Refresh interval in seconds')
    .option('--minutes <minutes>', 'Lookback window in minutes')
    .option('--max <records>', 'Max records per fetch (50-500)')
    .option('--batch-minutes <minutes>', 'Batch window for memory summary')
    .option('--gdelt-query <query>', 'GDELT query filter (default: global)')
    .option('--globe <mode>', 'Renderer: map | ascii | external | mapscii')
    .option('--globe-cmd <command>', 'External globe CLI command (default: globe)')
    .option('--globe-args <args>', 'External globe CLI args (space-separated)')
    .option('--once', 'Fetch and render once, then exit')
    .option('--no-store', 'Disable vector memory storage')
    .action(async (opts) => {
        const sources = parseWorldSources(opts.sources || agent.config.get('worldEventsSources'));
        const refreshSeconds = Number(opts.refresh ?? agent.config.get('worldEventsRefreshSeconds') ?? 60);
        const minutes = Number(opts.minutes ?? agent.config.get('worldEventsLookbackMinutes') ?? 60);
        const maxRecords = Number(opts.max ?? agent.config.get('worldEventsMaxRecords') ?? 250);
        const batchMinutes = Number(opts.batchMinutes ?? agent.config.get('worldEventsBatchMinutes') ?? 10);
        const gdeltQuery = String(opts.gdeltQuery ?? agent.config.get('worldEventsGdeltQuery') ?? 'global');
        const globeMode = (opts.globe ?? agent.config.get('worldEventsGlobeRenderer') ?? 'mapscii') as 'ascii' | 'external' | 'map' | 'mapscii';
        const globeCommand = String(opts.globeCmd ?? agent.config.get('worldEventsGlobeCommand') ?? 'globe');
        const globeArgs = parseGlobeArgs(opts.globeArgs ?? agent.config.get('worldEventsGlobeArgs'));
        const once = Boolean(opts.once);
        const store = opts.store !== false && agent.config.get('worldEventsStoreEnabled') !== false;

        await runWorldEventsMonitor({
            sources,
            refreshSeconds,
            minutes,
            maxRecords,
            batchMinutes,
            gdeltQuery,
            globeMode,
            globeCommand,
            globeArgs,
            once,
            store
        });
    });

program
    .command('daemon')
    .description('Manage daemon process')
    .argument('[action]', 'Action: status, stop', 'status')
    .action(async (action) => {
        const daemonManager = DaemonManager.createDefault();

        switch (action) {
            case 'status':
                console.log(daemonManager.getStatus());
                break;
            case 'start':
                daemonManager.daemonize();
                logger.info('Agent loop starting in daemon mode...');
                await agent.start();
                break;
            case 'restart': {
                const status = daemonManager.isRunning();
                if (status.running && status.pid) {
                    try {
                        process.kill(status.pid, 'SIGTERM');
                        console.log(`Sent stop signal to daemon (PID: ${status.pid})`);
                    } catch (error) {
                        console.error(`Failed to stop daemon: ${error}`);
                        process.exit(1);
                    }
                }
                daemonManager.daemonize();
                logger.info('Agent loop starting in daemon mode...');
                await agent.start();
                break;
            }
            case 'stop':
                const status = daemonManager.isRunning();
                if (status.running && status.pid) {
                    try {
                        process.kill(status.pid, 'SIGTERM');
                        console.log(`Sent stop signal to daemon (PID: ${status.pid})`);
                        console.log('   Use "orcbot daemon status" to verify it stopped');
                        console.log('   Or use "orcbot stop" to stop all OrcBot processes');
                    } catch (error) {
                        console.error(`Failed to stop daemon: ${error}`);
                        process.exit(1);
                    }
                } else {
                    console.log('OrcBot daemon is not running');
                }
                break;
            default:
                console.error(`Unknown action: ${action}`);
                console.log('Available actions: status, start, stop, restart');
                process.exit(1);
        }
    });

program
    .command('gateway')
    .description('Start the web gateway server for remote management')
    .option('-p, --port <number>', 'Port to listen on', '3100')
    .option('-h, --host <string>', 'Host to bind to', '0.0.0.0')
    .option('-k, --api-key <string>', 'API key for authentication')
    .option('-s, --static <path>', 'Path to static files for dashboard')
    .option('--with-agent', 'Also start the agent loop')
    .option('--with-mcp', 'Also start the MCP HTTP server on the configured MCP port')
    .option('-b, --background', 'Run gateway in background')
    .option('--background-child', 'Internal: run as background child', false)
    .action(async (options) => {
        // Handle background mode
        if (options.background && !options.backgroundChild) {
            const { spawn } = require('child_process');
            const nodePath = process.execPath;
            const scriptPath = process.argv[1];

            const dataDir = getOrcBotDataHome();
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            const logPath = path.join(dataDir, 'gateway.log');
            const out = fs.openSync(logPath, 'a');

            // Build args preserving options
            const args = [scriptPath, 'gateway', '--background-child'];
            if (options.port) args.push('-p', options.port);
            if (options.host) args.push('-h', options.host);
            if (options.apiKey) args.push('-k', options.apiKey);
            if (options.static) args.push('-s', options.static);
            if (options.withAgent) args.push('--with-agent');
            if (options.withMcp) args.push('--with-mcp');

            const child = spawn(nodePath, args, {
                detached: true,
                stdio: ['ignore', out, out],
                env: { ...process.env, ORCBOT_GATEWAY_BACKGROUND: '1' }
            });

            child.unref();
            console.log('\nOrcBot Gateway is running in the background.');
            console.log(`   Port: ${options.port || 3100}`);
            console.log(`   Log file: ${logPath}`);
            console.log('   Stop with: pkill -f "orcbot gateway --background-child"');
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GatewayServer } = require('../gateway/GatewayServer');

        const gatewayConfig = {
            port: parseInt(options.port),
            host: options.host,
            apiKey: options.apiKey || agent.config.get('gatewayApiKey'),
            staticDir: options.static
        };

        const gateway = new GatewayServer(agent, agent.config, gatewayConfig);

        console.log('\nStarting OrcBot Web Gateway...');
        await gateway.start();

        console.log(`\nGateway is ready!`);
        console.log(`   REST API: http://${gatewayConfig.host}:${gatewayConfig.port}/api`);
        console.log(`   WebSocket: ws://${gatewayConfig.host}:${gatewayConfig.port}`);
        if (gatewayConfig.apiKey) {
            console.log(`   Auth: API key required (X-Api-Key header)`);
        }
        console.log('\n   API Endpoints:');
        console.log('   GET  /api/status         - Agent status');
        console.log('   GET  /api/skills         - List skills');
        console.log('   POST /api/tasks          - Push task');
        console.log('   GET  /api/config         - View config');
        console.log('   GET  /api/memory         - View memories');
        console.log('   GET  /api/connections    - Channel status');
        console.log('   GET  /api/channels       - Channels and their settings');
        console.log('   GET  /api/logs           - Recent logs');
        console.log('\n   Press Ctrl+C to stop\n');

        if (options.withAgent) {
            console.log('Also starting agent loop...\n');
            gateway.setAgentLoopStarted(true);
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        } else {
            console.log('Tip: Add --with-agent to also run the agent loop\n');
        }

        if (options.withMcp) {
            const { OrcBotMcpServer, resolveMcpHttpOptions } = require('../mcp/OrcBotMcpServer');
            const resolved = resolveMcpHttpOptions(agent.config);
            const mcp = new OrcBotMcpServer(agent, {
                serverName: 'orcbot',
                serverVersion: '1.0.7',
                chatTimeoutMs: 90000,
                chatIdleMs: 4000,
                startAgentLoop: false // agent loop managed by gateway
            });
            await mcp.startHttp(resolved);
            console.log(`MCP HTTP server running at http://${resolved.host}:${resolved.port}${resolved.path}`);
            console.log(`   Health check: http://${resolved.host === '0.0.0.0' ? 'localhost' : resolved.host}:${resolved.port}/health`);
            process.on('SIGINT', async () => { await mcp.close(); });
        }

        // Keep process running
        process.on('SIGINT', () => {
            console.log('\nShutting down gateway...');
            gateway.stop();
            process.exit(0);
        });
    });

program
    .command('web')
    .description('Start the OrcBot web dashboard in your browser')
    .option('-p, --port <number>', 'Port to listen on')
    .option('-h, --host <string>', 'Host to bind to')
    .option('-k, --api-key <string>', 'API key for authentication')
    .option('-s, --static <path>', 'Path to dashboard static files')
    .option('--with-agent', 'Also start the agent loop')
    .option('--no-open', 'Do not open the dashboard in a browser')
    .option('-b, --background', 'Run the web dashboard in the background')
    .option('--background-child', 'Internal: run as background child', false)
    .action(async (options) => {
        const port = parseInt(String(options.port || agent.config.get('gatewayPort') || '3100'));
        const host = String(options.host || agent.config.get('gatewayHost') || '0.0.0.0');
        const connectHost = host === '0.0.0.0' ? 'localhost' : host;
        const dashboardUrl = `http://${connectHost}:${port}/`;

        if (options.background && !options.backgroundChild) {
            const { spawn } = require('child_process');
            const nodePath = process.execPath;
            const scriptPath = process.argv[1];

            const dataDir = getOrcBotDataHome();
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            const logPath = path.join(dataDir, 'web.log');
            const out = fs.openSync(logPath, 'a');

            const args = [scriptPath, 'web', '--background-child'];
            if (options.port) args.push('-p', options.port);
            if (options.host) args.push('-h', options.host);
            if (options.apiKey) args.push('-k', options.apiKey);
            if (options.static) args.push('-s', options.static);
            if (options.withAgent) args.push('--with-agent');

            const child = spawn(nodePath, args, {
                detached: true,
                stdio: ['ignore', out, out],
                env: { ...process.env, ORCBOT_GATEWAY_BACKGROUND: '1' }
            });

            child.unref();
            console.log('\nOrcBot Web Dashboard is running in the background.');
            console.log(`   Dashboard: ${dashboardUrl}`);
            console.log(`   Log file:  ${logPath}`);
            console.log('   Stop with: pkill -f "orcbot web --background-child"');
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GatewayServer } = require('../gateway/GatewayServer');

        const staticDir = options.static || agent.config.get('gatewayStaticDir');
        const apiKey = options.apiKey || agent.config.get('gatewayApiKey');
        const gateway = new GatewayServer(agent, agent.config, { port, host, apiKey, staticDir });

        console.log('\nStarting OrcBot Web Dashboard...');
        await gateway.start();

        console.log('\nWeb dashboard is ready!');
        console.log(`   Dashboard: ${dashboardUrl}`);
        console.log(`   REST API:  http://${connectHost}:${port}/api`);
        console.log(`   WebSocket: ws://${connectHost}:${port}`);
        if (apiKey) console.log('   Auth: API key required (X-Api-Key header or ?apiKey=)');
        console.log('\n   Press Ctrl+C to stop\n');

        if (options.open !== false) {
            openDashboardInBrowser(dashboardUrl);
        }

        if (options.withAgent) {
            console.log('Also starting agent loop...\n');
            gateway.setAgentLoopStarted(true);
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        }

        process.on('SIGINT', () => {
            console.log('\nShutting down web dashboard...');
            gateway.stop();
            process.exit(0);
        });
    });



program
    .command('mcp')
    .description('Start OrcBot as an MCP server over stdio')
    .option('--http', 'Serve OrcBot over stateless Streamable HTTP instead of stdio')
    .option('--no-agent-loop', 'Do not start the OrcBot agent loop automatically')
    .option('--chat-timeout-ms <number>', 'Maximum time to wait for an OrcBot reply', '90000')
    .option('--chat-idle-ms <number>', 'Idle window used to collect the final OrcBot reply', '4000')
    .option('-p, --port <number>', 'Port to listen on for MCP HTTP mode')
    .option('-H, --host <string>', 'Host to bind for MCP HTTP mode')
    .option('--path <string>', 'Path to serve MCP HTTP mode on')
    .option('-k, --api-key <string>', 'API key required for MCP HTTP mode')
    .option('--server-name <string>', 'Advertised MCP server name', 'orcbot')
    .action(async (options) => {
        if (!options.http) {
            for (const transport of logger.transports) {
                if ((transport as any).name === 'console') {
                    (transport as any).silent = true;
                }
            }
        }

        const { OrcBotMcpServer, resolveMcpHttpOptions } = require('../mcp/OrcBotMcpServer');
        const mcp = new OrcBotMcpServer(agent, {
            serverName: options.serverName,
            serverVersion: '1.0.7',
            chatTimeoutMs: Number.parseInt(options.chatTimeoutMs, 10) || 90000,
            chatIdleMs: Number.parseInt(options.chatIdleMs, 10) || 4000,
            startAgentLoop: options.agentLoop !== false
        });

        if (options.http) {
            const resolved = resolveMcpHttpOptions(agent.config, {
                host: options.host,
                port: options.port ? Number.parseInt(options.port, 10) : undefined,
                path: options.path,
                apiKey: options.apiKey
            });

            process.stderr.write(`Starting OrcBot MCP HTTP server at http://${resolved.host}:${resolved.port}${resolved.path}\n`);
            process.stderr.write(`Agent loop: ${options.agentLoop !== false ? 'enabled' : 'disabled'}\n`);
            process.stderr.write(`Auth: ${resolved.apiKey ? 'API key required' : 'open'}\n`);
            await mcp.startHttp(resolved);
        } else {
            process.stderr.write('Starting OrcBot MCP server on stdio\n');
            process.stderr.write(`Agent loop: ${options.agentLoop !== false ? 'enabled' : 'disabled'}\n`);
            await mcp.startStdio();
        }

        process.on('SIGINT', async () => {
            await mcp.close();
            if (options.agentLoop !== false && agent.isRunning) {
                await agent.stop();
            }
            process.exit(0);
        });
    });

// Switch between already-configured models without entering the TUI.
program
    .command('model [query]')
    .description('List or switch between configured models (query = index, model id, or label)')
    .option('-l, --list', 'List configured models and exit')
    .option('-s, --save [label]', 'Save the active model to the shortlist')
    .option('-r, --remove <query>', 'Remove a saved model by id or label')
    .action((query, options) => {
        const renderList = () => {
            const entries = listConfiguredModels(agent.config, {
                isLinked: (id: string) => {
                    try { return !!agent.llm?.isPiAiLinked?.(id); } catch { return false; }
                },
            });
            console.log('');
            entries.forEach((entry, index) => {
                const marker = entry.isActive ? '*' : ' ';
                const source = entry.sources.includes('saved') ? 'saved'
                    : entry.sources.includes('provider-memory') ? 'recent' : 'fallback';
                const creds = entry.hasCredentials ? '' : '  [no key]';
                const label = entry.label ? ` "${entry.label}"` : '';
                console.log(` ${marker} ${String(index + 1).padStart(2)}. ${entry.model}${label}`);
                console.log(`      via ${entry.effectiveProvider}${entry.provider ? '' : ' (inferred)'}  ${source}${creds}`);
            });
            console.log('');
            console.log('Switch with: orcbot model <number|model-id|label>');
            return entries;
        };

        if (options.remove) {
            const removed = removeSavedModel(agent.config, options.remove);
            console.log(removed
                ? `Removed ${removed.model} from the shortlist.`
                : `No saved model matched "${options.remove}".`);
            return;
        }

        if (options.save) {
            const label = typeof options.save === 'string' ? options.save : undefined;
            const saved = saveCurrentModel(agent.config, label);
            console.log(`Saved ${saved.model}${saved.label ? ` as "${saved.label}"` : ''} to the shortlist.`);
            return;
        }

        if (options.list || !query) {
            renderList();
            return;
        }

        const entries = listConfiguredModels(agent.config);
        const match = findModelEntry(entries, query);

        if (match.ambiguous) {
            console.log(`"${query}" matches ${match.ambiguous.length} configured models:`);
            match.ambiguous.forEach(e => console.log(`  - ${e.model} (via ${e.effectiveProvider})`));
            console.log('\nUse a full model id, a label, or the list number.');
            process.exitCode = 1;
            return;
        }

        if (!match.entry) {
            console.log(`No configured model matched "${query}".`);
            renderList();
            process.exitCode = 1;
            return;
        }

        const applied = switchToModel(agent.config, {
            model: match.entry.model,
            provider: match.entry.provider,
        });
        console.log(`Active model is now ${applied.model} via ${applied.provider || `${match.entry.effectiveProvider} (inferred)`}.`);
        if (!match.entry.hasCredentials) {
            console.log(`Warning: no credentials configured for ${match.entry.effectiveProvider}; calls will fail until you add a key.`);
        }
    });

const configCommand = program
    .command('config')
    .description('Manage agent configuration');

configCommand
    .command('get <key>')
    .description('Get a configuration value')
    .action((key) => {
        const val = agent.config.get(key as any);
        console.log(`${key}: ${val}`);
    });

configCommand
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key, value) => {
        let parsed: any = value;
        const lowered = String(value).trim().toLowerCase();
        if (lowered === 'true') parsed = true;
        else if (lowered === 'false') parsed = false;
        else if (/^-?\d+(\.\d+)?$/.test(String(value).trim())) parsed = Number(value);
        else if ((String(value).startsWith('{') && String(value).endsWith('}')) || (String(value).startsWith('[') && String(value).endsWith(']'))) {
            try { parsed = JSON.parse(String(value)); } catch { parsed = value; }
        }

        agent.config.set(key as any, parsed);
        console.log(`Configuration updated: ${key} = ${JSON.stringify(parsed)}`);
    });

// Lightpanda browser management
const lightpandaCommand = program
    .command('lightpanda')
    .description('Manage Lightpanda lightweight browser (9x less RAM than Chrome)');

lightpandaCommand
    .command('install')
    .description('Download and install Lightpanda browser')
    .option('-d, --dir <path>', 'Installation directory', resolveDataHomePath('lightpanda'))
    .action(async (options) => {
        const installDir = options.dir;
        const platform = process.platform;
        const arch = process.arch;

        console.log('\nInstalling Lightpanda browser...\n');

        // Determine download URL based on platform
        let downloadUrl: string;
        let binaryName = 'lightpanda';

        if (platform === 'linux' && arch === 'x64') {
            downloadUrl = 'https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux';
        } else if (platform === 'darwin' && arch === 'arm64') {
            downloadUrl = 'https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos';
        } else if (platform === 'win32') {
            console.error('Lightpanda is not available natively on Windows.');
            console.log('\n   Use WSL2 instead:');
            console.log('   1. Open WSL terminal');
            console.log('   2. Run: curl -L -o lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux');
            console.log('   3. Run: chmod a+x ./lightpanda');
            console.log('\n   Or use Docker:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        } else if (platform === 'darwin' && arch === 'x64') {
            console.error('Lightpanda is not yet available for macOS Intel (x64).');
            console.log('\n   Only macOS ARM64 (Apple Silicon) is supported.');
            console.log('\n   Alternative: Use Docker:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        } else {
            console.error(`Lightpanda is not available for ${platform}/${arch}`);
            console.log('\n   Supported platforms:');
            console.log('   - Linux x64');
            console.log('   - macOS ARM64 (Apple Silicon)');
            console.log('   - Windows: Use WSL2 or Docker');
            console.log('\n   Docker alternative:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        }

        // Create install directory
        if (!fs.existsSync(installDir)) {
            fs.mkdirSync(installDir, { recursive: true });
        }

        const binaryPath = path.join(installDir, binaryName);

        console.log(`   Platform: ${platform}/${arch}`);
        console.log(`   Installing to: ${installDir}`);
        console.log(`   Downloading from: ${downloadUrl}\n`);

        try {
            const https = require('https');
            const http = require('http');

            // Follow redirects to get actual download URL
            const download = (url: string, dest: string): Promise<void> => {
                return new Promise((resolve, reject) => {
                    const protocol = url.startsWith('https') ? https : http;
                    const file = fs.createWriteStream(dest);

                    const request = (redirectUrl: string) => {
                        protocol.get(redirectUrl, { headers: { 'User-Agent': 'OrcBot' } }, (response: any) => {
                            if (response.statusCode === 302 || response.statusCode === 301) {
                                request(response.headers.location);
                                return;
                            }

                            if (response.statusCode !== 200) {
                                reject(new Error(`Failed to download: ${response.statusCode}`));
                                return;
                            }

                            const total = parseInt(response.headers['content-length'] || '0', 10);
                            let downloaded = 0;

                            response.on('data', (chunk: Buffer) => {
                                downloaded += chunk.length;
                                if (total > 0) {
                                    const pct = Math.round((downloaded / total) * 100);
                                    process.stdout.write(`\r   Downloading... ${pct}%`);
                                }
                            });

                            response.pipe(file);
                            file.on('finish', () => {
                                file.close();
                                console.log('\n');
                                resolve();
                            });
                        }).on('error', reject);
                    };

                    request(url);
                });
            };

            await download(downloadUrl, binaryPath);

            // Make executable
            fs.chmodSync(binaryPath, 0o755);

            console.log('Lightpanda installed successfully!\n');
            console.log('   Next steps:');
            console.log(`   1. Start Lightpanda: orcbot lightpanda start`);
            console.log(`   2. Enable in config: orcbot config set browserEngine lightpanda`);
            console.log(`   3. Run OrcBot normally: orcbot run\n`);

            // Auto-configure
            agent.config.set('lightpandaPath', binaryPath);
            console.log(`   ✓ Config updated: lightpandaPath = ${binaryPath}`);

        } catch (error: any) {
            console.error(`\nInstallation failed: ${error.message}`);
            console.log('\n   Manual installation (Linux):');
            console.log('   curl -L -o lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux');
            console.log('   chmod a+x ./lightpanda');
            console.log(`   mv ./lightpanda ${binaryPath}`);
            console.log('\n   Or use Docker:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        }
    });

lightpandaCommand
    .command('start')
    .description('Start Lightpanda browser server')
    .option('-p, --port <number>', 'Port to listen on', '9222')
    .option('-H, --host <string>', 'Host to bind to', '127.0.0.1')
    .option('-t, --timeout <number>', 'Inactivity timeout in seconds (0 = no timeout)', '300')
    .option('-b, --background', 'Run in background')
    .action(async (options) => {
        const lightpandaPath = agent.config.get('lightpandaPath') || resolveDataHomePath('lightpanda', 'lightpanda');

        if (!fs.existsSync(lightpandaPath)) {
            console.error('Lightpanda not found. Run: orcbot lightpanda install');
            process.exit(1);
        }

        const { spawn } = require('child_process');
        const args = ['serve', '--host', options.host, '--port', options.port, '--timeout', options.timeout];

        console.log(`\nStarting Lightpanda browser...`);
        console.log(`   Binary: ${lightpandaPath}`);
        console.log(`   Endpoint: ws://${options.host}:${options.port}\n`);

        if (options.background) {
            const dataDir = getOrcBotDataHome();
            const logPath = path.join(dataDir, 'lightpanda.log');
            const pidPath = path.join(dataDir, 'lightpanda.pid');
            const out = fs.openSync(logPath, 'a');

            const child = spawn(lightpandaPath, args, {
                detached: true,
                stdio: ['ignore', out, out]
            });

            fs.writeFileSync(pidPath, String(child.pid));
            child.unref();

            console.log('Lightpanda running in background');
            console.log(`   PID: ${child.pid}`);
            console.log(`   Log: ${logPath}`);
            console.log(`   Stop with: orcbot lightpanda stop\n`);

            // Auto-configure endpoint
            const endpoint = `ws://${options.host}:${options.port}`;
            agent.config.set('lightpandaEndpoint', endpoint);
            console.log(`   ✓ Config updated: lightpandaEndpoint = ${endpoint}`);
        } else {
            console.log('   Press Ctrl+C to stop\n');

            const child = spawn(lightpandaPath, args, {
                stdio: 'inherit'
            });

            child.on('error', (err: Error) => {
                console.error(`Failed to start: ${err.message}`);
            });

            child.on('exit', (code: number) => {
                console.log(`\nLightpanda exited with code ${code}`);
            });
        }
    });

lightpandaCommand
    .command('stop')
    .description('Stop Lightpanda browser server')
    .action(() => {
        const pidPath = resolveDataHomePath('lightpanda.pid');

        if (!fs.existsSync(pidPath)) {
            console.log('Lightpanda is not running (no PID file found)');
            return;
        }

        try {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log(`Stopped Lightpanda (PID: ${pid})`);
        } catch (e: any) {
            if (e.code === 'ESRCH') {
                fs.unlinkSync(pidPath);
                console.log('Lightpanda was not running (stale PID file cleaned up)');
            } else {
                console.error(`Failed to stop: ${e.message}`);
            }
        }
    });

lightpandaCommand
    .command('status')
    .description('Check Lightpanda browser status')
    .action(() => {
        const pidPath = resolveDataHomePath('lightpanda.pid');
        const lightpandaPath = agent.config.get('lightpandaPath');
        const endpoint = agent.config.get('lightpandaEndpoint') || 'ws://127.0.0.1:9222';
        const engineSetting = agent.config.get('browserEngine') || 'puppeteer';

        console.log('\nLightpanda Status\n');

        // Installation status
        if (lightpandaPath && fs.existsSync(lightpandaPath)) {
            console.log(`    Installed: ${lightpandaPath}`);
        } else {
            console.log('    Not installed (run: orcbot lightpanda install)');
        }

        // Running status
        if (fs.existsSync(pidPath)) {
            try {
                const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
                process.kill(pid, 0); // Check if running
                console.log(`    Running: PID ${pid}`);
            } catch {
                fs.unlinkSync(pidPath);
                console.log('    Not running');
            }
        } else {
            console.log('    Not running');
        }

        // Config status
        console.log(`    Endpoint: ${endpoint}`);
        console.log(`     Browser engine: ${engineSetting}`);

        if (engineSetting !== 'lightpanda') {
            console.log('\n    To enable: orcbot config set browserEngine lightpanda');
        }

        console.log('');
    });

lightpandaCommand
    .command('enable')
    .description('Enable Lightpanda as the default browser engine')
    .action(() => {
        agent.config.set('browserEngine', 'lightpanda');
        console.log('Browser engine set to Lightpanda');
        console.log('   Make sure Lightpanda is running: orcbot lightpanda start -b');
    });

lightpandaCommand
    .command('disable')
    .description('Switch back to Puppeteer (Chrome)')
    .action(() => {
        agent.config.set('browserEngine', 'puppeteer');
        console.log('Browser engine set to Puppeteer (Chrome)');
    });


// ── World Events (GDELT) Live View ─────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


    type AITunerPreset = {
        profileName: string;
        primaryUseCase: string;
        roleTitle: string;
        audience: string;
        tone: string[];
        autonomyLevel: 'low' | 'balanced' | 'high';
        riskTolerance: 'conservative' | 'moderate' | 'aggressive';
        responseStyle: 'concise' | 'balanced' | 'detailed';
        preferredChannels: string[];
        topTasks: string[];
        hardConstraints: string;
        domainKeywords: string[];
        createSkillScaffolds: boolean;
        skillScaffolds: string[];
        llmAssisted?: boolean;
        createdAt: string;
    };

    type TunerArtifacts = {
        identity: string;
        soul: string;
        agents: string;
        skills?: Record<string, string>;
    };

    function tunerProfilesDir(): string {
        return path.join(agent.config.getDataHome(), 'tuner-profiles');
    }

    function tunerSlug(input: string): string {
        return String(input || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64) || 'profile';
    }

    function parseCommaList(input: string): string[] {
        return String(input || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    function buildIdentityFromPreset(p: AITunerPreset): string {
        const styleLine = p.responseStyle === 'concise'
            ? 'Prefer short, high-signal responses and minimal chatter.'
            : p.responseStyle === 'detailed'
                ? 'Prefer thorough, structured responses with rationale and tradeoffs.'
                : 'Balance concision and detail based on user request complexity.';

        return `# Agent Identity

    **Name:** ${agent.config.get('agentName') || 'OrcBot'}
    **Version:** 2.0
    **Type:** ${p.roleTitle}
    **Mission:** ${p.primaryUseCase}

    ## Operating Context

    - **Primary Audience:** ${p.audience}
    - **Preferred Channels:** ${p.preferredChannels.join(', ') || 'none specified'}
    - **Top Task Domains:** ${p.topTasks.join(', ') || 'none specified'}

    ## Response Style

    - ${styleLine}
    - Keep outputs actionable and aligned to the use case.
    - Ask clarifying questions only when required to avoid wrong execution.
    `;
    }

    function buildSoulFromPreset(p: AITunerPreset): string {
        const autonomyLine = p.autonomyLevel === 'low'
            ? 'Low autonomy: ask before major actions, avoid implicit assumptions.'
            : p.autonomyLevel === 'high'
                ? 'High autonomy: execute end-to-end where safe, with clear progress updates.'
                : 'Balanced autonomy: execute routine work directly, ask for high-impact decisions.';

        const riskLine = p.riskTolerance === 'conservative'
            ? 'Conservative risk: prefer safety checks, reversible steps, and explicit confirmations.'
            : p.riskTolerance === 'aggressive'
                ? 'Aggressive risk: prioritize speed and outcomes while respecting hard safety boundaries.'
                : 'Moderate risk: balance speed and caution based on context and potential impact.';

        const toneLine = p.tone.length > 0 ? p.tone.join(', ') : 'professional, direct';

        return `# Agent Persona & Boundaries

    ## Personality

    - **Tone:** ${toneLine}
    - **Use Case Focus:** ${p.primaryUseCase}
    - **Audience Fit:** Optimize communication for ${p.audience}

    ## Execution Principles

    - ${autonomyLine}
    - ${riskLine}
    - Stay grounded in actual tool results and known system constraints.
    - Do not claim completion when key outcomes are still pending.

    ## Hard Constraints

    ${p.hardConstraints || '- No additional constraints specified.'}

    ## Domain Signals

    - Prioritize requests related to: ${p.domainKeywords.join(', ') || 'general operations'}
    - Prefer workflows and language optimized for this domain context.
    `;
    }

    function buildAgentsFromPreset(p: AITunerPreset): string {
        const taskBullets = p.topTasks.length > 0
            ? p.topTasks.map(t => `- ${t}`).join('\n')
            : '- No top-task priorities specified';

        const keywordBullets = p.domainKeywords.length > 0
            ? p.domainKeywords.map(k => `- ${k}`).join('\n')
            : '- No domain keywords specified';

        return `# Operating Instructions

    ## Active Tuning Profile

    - **Profile:** ${p.profileName}
    - **Primary Mission:** ${p.primaryUseCase}
    - **Role:** ${p.roleTitle}
    - **Audience:** ${p.audience}
    - **Autonomy:** ${p.autonomyLevel}
    - **Risk Posture:** ${p.riskTolerance}

    ## Task Priorities

    ${taskBullets}

    ## Domain Keywords

    ${keywordBullets}

    ## Behavioral Rules

    1. Keep every response aligned to the primary mission.
    2. Use tools when they improve reliability or speed; avoid unnecessary tool churn.
    3. Report blockers clearly and offer the next best fallback.
    4. Preserve user trust: no fabricated results, no false success messages.
    5. Prefer reusable outputs (templates, scripts, checklists) for recurring workflows.
    `;
    }

    function buildSkillScaffold(skillName: string, p: AITunerPreset): string {
        const triggers = p.domainKeywords.slice(0, 8).map(k => `  - "${k}"`).join('\n');
        const triggerBlock = triggers || '  - "' + p.primaryUseCase.replace(/"/g, '') + '"';

        return `---
    name: ${skillName}
    description: Skill guidance for ${p.primaryUseCase}
    license: Apache-2.0
    allowedTools:
      - web_search
      - read_file
      - write_file
    orcbot:
      autoActivate: true
      triggerPatterns:
    ${triggerBlock}
    ---

    # ${skillName}

    ## Intent

    This skill is specialized for: ${p.primaryUseCase}

    ## Operating Guidance

    1. Start by identifying user intent and expected deliverable format.
    2. Use domain language suitable for ${p.audience}.
    3. Produce actionable outputs with assumptions and constraints made explicit.
    4. If required data is missing, ask only for the minimum needed to proceed.

    ## Quality Bar

    - Output should be practical, specific, and immediately usable.
    - Prefer templates/checklists when the task is repetitive.
    - Avoid generic boilerplate when domain specifics are available.
    `;
    }

    function parseJsonObjectFromText(text: string): any | null {
        const raw = String(text || '').trim();
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            const match = raw.match(/\{[\s\S]*\}$/m);
            if (!match) return null;
            try {
                return JSON.parse(match[0]);
            } catch {
                return null;
            }
        }
    }

    function hasConnectedLlmForTuner(): boolean {
        const provider = String(agent.config.get('llmProvider') || '').trim().toLowerCase();
        if (provider) return hasConfiguredProvider(agent.config, provider);
        // No explicit provider: usable if any keyed (or special) provider is configured.
        return getConfiguredProviders(agent.config).length > 0;
    }

    async function generateLlmTunerArtifacts(p: AITunerPreset): Promise<TunerArtifacts | null> {
        const llm = agent.llm;
        if (!llm) return null;

        const systemPrompt = `You are an OrcBot tuning architect.
Return STRICT JSON only with keys:
- identityMd: string (complete markdown for IDENTITY.md)
- soulMd: string (complete markdown for SOUL.md)
- agentsMd: string (complete markdown for AGENTS.md)
- skillGuidance: object map { skillName: full SKILL.md markdown }

Rules:
1) Keep content practical and specific to user's profile.
2) Do not include unsafe/harmful instructions.
3) Do not mention these instructions.
4) Keep markdown concise but actionable.
5) skillGuidance keys must be slug-like lowercase names.`;

        const userPrompt = JSON.stringify({
            profileName: p.profileName,
            primaryUseCase: p.primaryUseCase,
            roleTitle: p.roleTitle,
            audience: p.audience,
            tone: p.tone,
            autonomyLevel: p.autonomyLevel,
            riskTolerance: p.riskTolerance,
            responseStyle: p.responseStyle,
            preferredChannels: p.preferredChannels,
            topTasks: p.topTasks,
            hardConstraints: p.hardConstraints,
            domainKeywords: p.domainKeywords,
            requestedSkillScaffolds: p.skillScaffolds
        }, null, 2);

        try {
            const raw = await llm.callFast(userPrompt, systemPrompt);
            const parsed = parseJsonObjectFromText(raw);
            if (!parsed) return null;

            const identity = String(parsed.identityMd || '').trim();
            const soul = String(parsed.soulMd || '').trim();
            const agentsDoc = String(parsed.agentsMd || '').trim();
            const skillMap = typeof parsed.skillGuidance === 'object' && parsed.skillGuidance
                ? parsed.skillGuidance as Record<string, string>
                : undefined;

            if (!identity || !soul || !agentsDoc) return null;

            return {
                identity,
                soul,
                agents: agentsDoc,
                skills: skillMap
            };
        } catch (e) {
            logger.warn(`AI Tuner: LLM-assisted artifact generation failed; using deterministic templates. Error: ${e}`);
            return null;
        }
    }

    function writeTunerSkillScaffolds(
        p: AITunerPreset,
        overwrite: boolean,
        llmSkillDocs?: Record<string, string>
    ): { created: string[]; skipped: string[] } {
        const configuredPluginsPath = String(agent.config.get('pluginsPath') || './plugins').trim();
        const pluginsRoot = path.isAbsolute(configuredPluginsPath)
            ? configuredPluginsPath
            : path.resolve(configuredPluginsPath);
        const skillsRoot = path.join(pluginsRoot, 'skills');
        fs.mkdirSync(skillsRoot, { recursive: true });

        const created: string[] = [];
        const skipped: string[] = [];

        for (const rawName of p.skillScaffolds) {
            const name = tunerSlug(rawName);
            const dir = path.join(skillsRoot, name);
            const file = path.join(dir, 'SKILL.md');
            if (fs.existsSync(file) && !overwrite) {
                skipped.push(name);
                continue;
            }
            fs.mkdirSync(dir, { recursive: true });
            const llmDoc = llmSkillDocs && typeof llmSkillDocs[name] === 'string'
                ? String(llmSkillDocs[name]).trim()
                : '';
            fs.writeFileSync(file, llmDoc || buildSkillScaffold(name, p));
            created.push(name);
        }

        if (created.length > 0) {
            agent.skills.discoverAgentSkills();
        }

        return { created, skipped };
    }

    function applyTunerPreset(
        p: AITunerPreset,
        opts?: { writeSkills?: boolean; overwriteSkills?: boolean; artifacts?: TunerArtifacts }
    ): { fileResults: Array<{ file: string; ok: boolean }>; skillResults?: { created: string[]; skipped: string[] } } {
        const fileResults: Array<{ file: string; ok: boolean }> = [];

        const identityDoc = opts?.artifacts?.identity || buildIdentityFromPreset(p);
        const soulDoc = opts?.artifacts?.soul || buildSoulFromPreset(p);
        const agentsDoc = opts?.artifacts?.agents || buildAgentsFromPreset(p);

        fileResults.push({ file: 'IDENTITY.md', ok: agent.bootstrap.updateFile('IDENTITY.md', identityDoc) });
        fileResults.push({ file: 'SOUL.md', ok: agent.bootstrap.updateFile('SOUL.md', soulDoc) });
        fileResults.push({ file: 'AGENTS.md', ok: agent.bootstrap.updateFile('AGENTS.md', agentsDoc) });

        let skillResults: { created: string[]; skipped: string[] } | undefined;
        if (opts?.writeSkills && p.createSkillScaffolds && p.skillScaffolds.length > 0) {
            skillResults = writeTunerSkillScaffolds(p, !!opts.overwriteSkills, opts?.artifacts?.skills);
        }

        return { fileResults, skillResults };
    }

    function applyPresetToPeerInstances(p: AITunerPreset, artifacts?: TunerArtifacts): { updated: string[]; failed: string[] } {
        const updated: string[] = [];
        const failed: string[] = [];

        const identityDoc = artifacts?.identity || buildIdentityFromPreset(p);
        const soulDoc = artifacts?.soul || buildSoulFromPreset(p);
        const agentsDoc = artifacts?.agents || buildAgentsFromPreset(p);

        const peers = agent.orchestrator.listAgents().filter(a => a.id !== 'primary');
        for (const peer of peers) {
            try {
                const peerData = agent.orchestrator.getAgent(peer.id);
                if (!peerData?.memoryPath) {
                    failed.push(peer.name || peer.id);
                    continue;
                }

                const peerDir = path.dirname(peerData.memoryPath);
                fs.mkdirSync(peerDir, { recursive: true });
                fs.writeFileSync(path.join(peerDir, 'IDENTITY.md'), identityDoc);
                fs.writeFileSync(path.join(peerDir, 'SOUL.md'), soulDoc);
                fs.writeFileSync(path.join(peerDir, 'AGENTS.md'), agentsDoc);
                updated.push(peer.name || peer.id);
            } catch {
                failed.push(peer.name || peer.id);
            }
        }

        return { updated, failed };
    }

    async function showAiTunerMenu() {
        renderScreenHeader('AI Tuner');

        const profilesDir = tunerProfilesDir();
        if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
        const profiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));

        console.log('');
        box([
            `${dim('Goal')} Retune OrcBot for a specific person/use-case without manual SOUL.md edits.`,
            `${dim('Profiles')} ${brightCyan(bold(String(profiles.length)))} saved preset(s)`,
            `${dim('Writes')} IDENTITY.md, SOUL.md, AGENTS.md ${dim('+ optional SKILL.md scaffolds')}`,
            `${dim('Smart Mode')} ${hasConnectedLlmForTuner() ? green('LLM available') : yellow('fallback mode only')}`
        ], { title: 'AI TUNER STATUS', width: 72 });
        console.log('');

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: cyan('AI Tuner Options:'),
                choices: [
                    { name: `   ${bold('Run Guided Questionnaire')}`, value: 'guided' },
                    { name: `    ${bold('Apply Saved Profile')}`, value: 'apply_saved' },
                    { name: `   ${bold('List Saved Profiles')}`, value: 'list' },
                    { name: dim('  ← Back'), value: 'back' }
                ]
            }
        ]);

        if (action === 'back') return showMainMenu();

        if (action === 'list') {
            console.log('');
            if (profiles.length === 0) {
                console.log(dim('No saved tuner profiles yet.'));
            } else {
                for (const file of profiles) {
                    try {
                        const full = path.join(profilesDir, file);
                        const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as AITunerPreset;
                        console.log(`- ${bold(parsed.profileName)} ${dim(`(${file})`)}`);
                        console.log(`  ${dim('Use case:')} ${parsed.primaryUseCase}`);
                        console.log(`  ${dim('Role:')} ${parsed.roleTitle} ${dim('| Autonomy:')} ${parsed.autonomyLevel} ${dim('| Risk:')} ${parsed.riskTolerance}`);
                    } catch {
                        console.log(`- ${file} ${dim('(unreadable)')}`);
                    }
                }
            }
            await waitKeyPress();
            return showAiTunerMenu();
        }

        if (action === 'apply_saved') {
            if (profiles.length === 0) {
                console.log('\nNo saved profiles found. Run Guided Questionnaire first.');
                await waitKeyPress();
                return showAiTunerMenu();
            }

            const { file } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'file',
                    message: 'Select saved profile:',
                    choices: profiles.map(f => ({ name: f, value: f }))
                }
            ]);

            const preset = JSON.parse(fs.readFileSync(path.join(profilesDir, file), 'utf-8')) as AITunerPreset;
            const { smartMode, writeSkills, overwriteSkills, applyToPeers } = await inquirer.prompt([
                { type: 'confirm', name: 'smartMode', message: 'Use connected LLM for smart tuning?', default: true, when: () => hasConnectedLlmForTuner() },
                { type: 'confirm', name: 'writeSkills', message: 'Apply associated skill scaffolds too?', default: true },
                { type: 'confirm', name: 'overwriteSkills', message: 'Overwrite existing scaffolded skill files?', default: false, when: (a) => !!a.writeSkills },
                { type: 'confirm', name: 'applyToPeers', message: 'Also sync this tuning to all spawned peer-agent instances?', default: true }
            ]);

            const artifacts = smartMode ? await generateLlmTunerArtifacts(preset) : null;
            const result = applyTunerPreset(preset, { writeSkills, overwriteSkills, artifacts: artifacts || undefined });
            const peerSync = applyToPeers ? applyPresetToPeerInstances(preset, artifacts || undefined) : { updated: [], failed: [] };
            const okCount = result.fileResults.filter(r => r.ok).length;
            console.log(`\nApplied profile ${bold(preset.profileName)} (${okCount}/${result.fileResults.length} bootstrap files updated).`);
            if (smartMode) {
                console.log(`   Smart mode: ${artifacts ? green('LLM-guided artifacts used') : yellow('fallback templates used')}`);
            }
            if (result.skillResults) {
                console.log(`   Skills created: ${result.skillResults.created.length}, skipped: ${result.skillResults.skipped.length}`);
            }
            if (peerSync.updated.length > 0 || peerSync.failed.length > 0) {
                console.log(`   Peer sync: ${peerSync.updated.length} updated, ${peerSync.failed.length} failed`);
            }

            await waitKeyPress();
            return showAiTunerMenu();
        }

        const answers = await inquirer.prompt([
            { type: 'input', name: 'profileName', message: 'Profile name:', default: `profile-${new Date().toISOString().slice(0, 10)}` },
            { type: 'input', name: 'primaryUseCase', message: 'Primary use case (what should OrcBot optimize for?):', validate: (v: string) => v.trim().length > 0 || 'Required' },
            { type: 'input', name: 'roleTitle', message: 'Role title for the tuned bot:', default: 'Specialized AI Operations Assistant' },
            { type: 'input', name: 'audience', message: 'Primary audience/user type:', default: 'technical operators' },
            {
                type: 'checkbox',
                name: 'tone',
                message: 'Preferred tone:',
                choices: [
                    { name: 'direct', value: 'direct' },
                    { name: 'friendly', value: 'friendly' },
                    { name: 'formal', value: 'formal' },
                    { name: 'technical', value: 'technical' },
                    { name: 'coaching', value: 'coaching' },
                    { name: 'concise', value: 'concise' }
                ],
                validate: (vals: string[]) => vals.length > 0 || 'Pick at least one tone'
            },
            {
                type: 'list',
                name: 'autonomyLevel',
                message: 'Autonomy level:',
                choices: [
                    { name: 'Low (ask before major actions)', value: 'low' },
                    { name: 'Balanced', value: 'balanced' },
                    { name: 'High (execute end-to-end where safe)', value: 'high' }
                ]
            },
            {
                type: 'list',
                name: 'riskTolerance',
                message: 'Risk tolerance:',
                choices: [
                    { name: 'Conservative', value: 'conservative' },
                    { name: 'Moderate', value: 'moderate' },
                    { name: 'Aggressive', value: 'aggressive' }
                ]
            },
            {
                type: 'list',
                name: 'responseStyle',
                message: 'Response detail level:',
                choices: [
                    { name: 'Concise', value: 'concise' },
                    { name: 'Balanced', value: 'balanced' },
                    { name: 'Detailed', value: 'detailed' }
                ]
            },
            {
                type: 'checkbox',
                name: 'preferredChannels',
                message: 'Preferred channels:',
                choices: [
                    { name: 'Telegram', value: 'telegram' },
                    { name: 'WhatsApp', value: 'whatsapp' },
                    { name: 'Discord', value: 'discord' },
                    { name: 'Slack', value: 'slack' },
                    { name: 'Gateway Web', value: 'gateway-chat' },
                    { name: 'Email', value: 'email' }
                ]
            },
            { type: 'input', name: 'topTasksRaw', message: 'Top recurring tasks (comma-separated):' },
            { type: 'input', name: 'domainKeywordsRaw', message: 'Domain keywords/triggers (comma-separated):' },
            { type: 'input', name: 'hardConstraints', message: 'Hard constraints (single line, optional):' },
            { type: 'confirm', name: 'createSkillScaffolds', message: 'Generate starter SKILL.md scaffolds for this profile?', default: true },
            {
                type: 'checkbox',
                name: 'skillScaffolds',
                message: 'Select skill scaffold packs:',
                when: (a) => !!a.createSkillScaffolds,
                choices: [
                    { name: 'intake-triage', value: 'intake-triage' },
                    { name: 'domain-research', value: 'domain-research' },
                    { name: 'workflow-automation', value: 'workflow-automation' },
                    { name: 'quality-review', value: 'quality-review' },
                    { name: 'stakeholder-updates', value: 'stakeholder-updates' }
                ]
            },
            { type: 'confirm', name: 'saveProfile', message: 'Save this tuning profile for reuse across instances?', default: true },
            { type: 'confirm', name: 'overwriteSkills', message: 'Overwrite existing scaffolded skill files if present?', default: false, when: (a) => !!a.createSkillScaffolds },
            { type: 'confirm', name: 'llmAssisted', message: 'Use connected LLM to smart-generate tuned files?', default: true, when: () => hasConnectedLlmForTuner() },
            { type: 'confirm', name: 'applyToPeers', message: 'Also sync this tuning to all spawned peer-agent instances?', default: true }
        ]);

        const preset: AITunerPreset = {
            profileName: String(answers.profileName || '').trim() || `profile-${new Date().toISOString().slice(0, 10)}`,
            primaryUseCase: String(answers.primaryUseCase || '').trim(),
            roleTitle: String(answers.roleTitle || '').trim() || 'Specialized AI Operations Assistant',
            audience: String(answers.audience || '').trim() || 'technical operators',
            tone: Array.isArray(answers.tone) ? answers.tone : [],
            autonomyLevel: answers.autonomyLevel,
            riskTolerance: answers.riskTolerance,
            responseStyle: answers.responseStyle,
            preferredChannels: Array.isArray(answers.preferredChannels) ? answers.preferredChannels : [],
            topTasks: parseCommaList(answers.topTasksRaw),
            hardConstraints: String(answers.hardConstraints || '').trim(),
            domainKeywords: parseCommaList(answers.domainKeywordsRaw),
            createSkillScaffolds: !!answers.createSkillScaffolds,
            skillScaffolds: Array.isArray(answers.skillScaffolds) ? answers.skillScaffolds : [],
            llmAssisted: !!answers.llmAssisted,
            createdAt: new Date().toISOString()
        };

        if (answers.saveProfile) {
            const file = `${tunerSlug(preset.profileName)}.json`;
            fs.writeFileSync(path.join(profilesDir, file), JSON.stringify(preset, null, 2));
        }

        const artifacts = preset.llmAssisted ? await generateLlmTunerArtifacts(preset) : null;

        const result = applyTunerPreset(preset, {
            writeSkills: !!answers.createSkillScaffolds,
            overwriteSkills: !!answers.overwriteSkills,
            artifacts: artifacts || undefined
        });
        const peerSync = answers.applyToPeers ? applyPresetToPeerInstances(preset, artifacts || undefined) : { updated: [], failed: [] };

        const okCount = result.fileResults.filter(r => r.ok).length;
        console.log(`\nAI tuning applied for ${bold(preset.profileName)}.`);
        console.log(`   Bootstrap updates: ${okCount}/${result.fileResults.length}`);
        if (preset.llmAssisted) {
            console.log(`   Smart mode: ${artifacts ? green('LLM-guided artifacts used') : yellow('fallback templates used')}`);
        }
        if (result.skillResults) {
            console.log(`   Skill scaffolds created: ${result.skillResults.created.length}, skipped: ${result.skillResults.skipped.length}`);
        }
        if (peerSync.updated.length > 0 || peerSync.failed.length > 0) {
            console.log(`   Peer sync: ${peerSync.updated.length} updated, ${peerSync.failed.length} failed`);
        }

        await waitKeyPress();
        return showAiTunerMenu();
    }

async function showMainMenu() {
    enterAlternateScreen();
    if (!isSplashShown()) {
        clearScreen();
        renderSplash();
    } else {
        renderScreenHeader(['Home', 'Dashboard']);
    }

    // ── Dashboard Panel ──────────────────────────────────────────────
    const model = agent.config.get('modelName') || DEFAULT_MODEL_IDS.openaiMain;
    const provider = agent.config.get('llmProvider') || 'auto';
    const queueItems = agent.actionQueue.getQueue();
    const queueLen = queueItems.length;
    const pendingCount = queueItems.filter((a: any) => a.status === 'queued' || a.status === 'in-progress').length;
    const shortMem = agent.memory.searchMemory('short').length;
    const hasTelegram = !!agent.config.get('telegramToken');
    const hasWhatsapp = !!agent.config.get('whatsappEnabled');
    const hasDiscord = !!agent.config.get('discordToken');
    const hasSlack = !!agent.config.get('slackBotToken');
    const hasEmail = !!agent.config.get('emailEnabled');
    const channelCount = [hasTelegram, hasWhatsapp, hasDiscord, hasSlack, hasEmail].filter(Boolean).length;
    const agentName = agent.config.get('agentName') || 'OrcBot';
    const sudoMode = agent.config.get('sudoMode');

    // Connected-or-not is the signal, not which channel it is: one state color,
    // not four accents. Email is listed here too so the tokens match the count.
    const channelTags: Array<[string, boolean]> = [
        ['TG', hasTelegram], ['WA', hasWhatsapp], ['DC', hasDiscord], ['SL', hasSlack], ['EM', hasEmail],
    ];
    const channelDots = channelTags
        .map(([tag, on]) => `${on ? c.brightGreen : c.gray}${tag}${c.reset}`)
        .join(dim(' │ '));

    const auActive = agent.agenticUser?.isActive();
    const auEnabled = !!agent.config.get('agenticUserEnabled');

    // Use white for key labels so they're legible; reserve dim only for secondary info
    box([
        `${c.white}Agent${c.reset}    ${c.bold}${c.brightWhite}${agentName}${c.reset}${sudoMode ? `  ${c.brightRed}${c.bold}SUDO${c.reset}` : ''}${agent.config.get('overrideMode') ? `  ${c.brightRed}${c.bold}OVERRIDE${c.reset}` : ''}`,
        `${c.white}Model${c.reset}    ${brightCyan(bold(model))} ${dim('via')} ${c.white}${provider}${c.reset}`,
        `${c.white}Channels${c.reset} ${channelDots} ${dim(`(${channelCount}/5 active)`)}`,
        `${c.white}HITL${c.reset}     ${auActive ? `${c.brightGreen}${c.bold}● Active${c.reset}` : auEnabled ? `${c.yellow}● Standby${c.reset}` : `${c.gray}○ Off${c.reset}`}`,
        `${c.gray}${'─'.repeat(52)}${c.reset}`,
        `${c.white}Queue${c.reset}    ${pendingCount > 0 ? `${c.yellow}${c.bold}${String(pendingCount)}${c.reset} ${c.white}active${c.reset}` : `${c.brightGreen}● idle${c.reset}`}${queueLen > pendingCount ? `  ${dim(`${queueLen - pendingCount} completed`)}` : ''}`,
        `${c.white}Memory${c.reset}   ${c.brightCyan}${String(shortMem)}${c.reset} ${c.white}short-term${c.reset} ${progressBar(shortMem, 100, 12)}`,
    ], { title: 'DASHBOARD', width: 56 });
    console.log('');

    const action = await p.select({
        message: `${c.bold}${c.brightWhite}What would you like to do?${c.reset}`,
        maxItems: 24,
        options: [
            { label: dim('── RUN'), value: 'separator_run', disabled: true },
            { label: `  ${c.brightCyan}▶${c.reset}  ${c.brightCyan}${c.bold}Start Agent Loop${c.reset}`, value: 'start' },
            { label: `     Push Task`, value: 'push' },
            { label: `     View Status`, value: 'status' },
            { label: dim('── CONFIGURE'), value: 'separator_config', disabled: true },
            { label: `     Switch Model  ${c.gray}(${String(model).length > 28 ? `${String(model).slice(0, 27)}…` : model})${c.reset}`, value: 'switch_model' },
            { label: `     Manage AI Models`, value: 'models' },
            { label: `     Self-Training`, value: 'self_training' },
            { label: `     Manage Connections`, value: 'connections' },
            { label: `     AI Tuner  ${c.gray}(persona + skills questionnaire)${c.reset}`, value: 'ai_tuner' },
            { label: `     Manage Skills  ${c.gray}(${agent.skills.getAgentSkills().length} installed)${c.reset}`, value: 'skills' },
            { label: `     World Governance`, value: 'world' },
            { label: `     Manage Tools  ${c.gray}(${agent.tools.listTools().length} installed)${c.reset}`, value: 'tools' },
            { label: `     Tooling & APIs`, value: 'tooling' },
            { label: dim('── ADVANCED'), value: 'separator_adv', disabled: true },
            { label: `     Web Gateway`, value: 'gateway' },
            { label: `     Web Dashboard  ${c.gray}(browser UI)${c.reset}`, value: 'web' },
            { label: `     Worker Profile`, value: 'worker' },
            { label: `     Multi-Agent Orchestration`, value: 'orchestration' },
            { label: `     Agentic User  ${c.gray}(HITL Proxy)${c.reset}`, value: 'agentic_user' },
            { label: `     Security & Permissions`, value: 'security' },
            { label: `     Token Usage`, value: 'tokens' },
            { label: `     Guardrail Metrics`, value: 'metrics' },
            { label: `     World Events Live`, value: 'world_events' },
            { label: `     Latency Benchmark`, value: 'latency' },
            { label: dim('── SYSTEM'), value: 'separator_sys', disabled: true },
            { label: `     Open Build Workspace`, value: 'open_build_workspace' },
            { label: `     Configure Agent`, value: 'config' },
            { label: `     Update OrcBot`, value: 'update' },
            { label: `     Exit`, value: 'exit' },
        ]
    });

    if (p.isCancel(action)) {
        exitAlternateScreen();
        process.exit(0);
    }

    switch (action) {
        case 'start':
            console.log('Starting agent loop... (Ctrl+C to stop)');
            agentStreamRenderer.attach();
            try {
                await agent.start();
            } finally {
                agentStreamRenderer.detach();
            }
            break;
        case 'push':
            await showPushTaskMenu();
            break;
        case 'status':
            showStatus();
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'skills':
            await showSkillsMenu();
            break;
        case 'world':
            await showWorldGovernanceMenu();
            break;
        case 'tools':
            await showToolsManagerMenu();
            break;
        case 'connections':
            await showConnectionsMenu();
            break;
        case 'ai_tuner':
            await showAiTunerMenu();
            break;
        case 'models':
            await showModelsMenu();
            break;
        case 'switch_model':
            await showSwitchModelMenu();
            break;
        case 'self_training':
            await showSelfTrainingMenu();
            break;
        case 'tooling':
            await showToolingMenu();
            break;
        case 'gateway':
            await showGatewayMenu();
            break;
        case 'web':
            await showWebDashboardMenu();
            break;
        case 'worker':
            await showWorkerProfileMenu();
            break;
        case 'orchestration':
            await showOrchestrationMenu();
            break;
        case 'agentic_user':
            await showAgenticUserMenu();
            break;
        case 'security':
            await showSecurityMenu();
            break;
        case 'tokens':
            showTokenUsage();
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'metrics':
            showGuardrailMetrics();
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'world_events':
            await showWorldEventsMenu();
            break;
        case 'latency':
            await showLatencyMenu();
            break;
        case 'open_build_workspace':
            await openBuildWorkspaceFolder();
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'config':
            await showConfigMenu();
            break;
        case 'update':
            await performUpdate();
            await showMainMenu();
            break;
        case 'exit':
            exitAlternateScreen();
            process.exit(0);
    }
}

async function openBuildWorkspaceFolder() {
    const configured = String(agent.config.get('buildWorkspacePath') || '').trim();
    const fallback = path.join(agent.config.getDataHome(), 'workspace');
    const workspacePath = path.resolve(configured || fallback);

    try {
        if (!fs.existsSync(workspacePath)) {
            fs.mkdirSync(workspacePath, { recursive: true });
            console.log(`\nCreated build workspace: ${workspacePath}`);
        } else {
            console.log(`\nBuild workspace: ${workspacePath}`);
        }

        let opened = false;
        if (process.platform === 'win32') {
            const result = spawnSync('explorer', [workspacePath], { stdio: 'ignore' });
            opened = !result.error;
        } else if (process.platform === 'darwin') {
            const result = spawnSync('open', [workspacePath], { stdio: 'ignore' });
            opened = !result.error;
        } else {
            const result = spawnSync('xdg-open', [workspacePath], { stdio: 'ignore' });
            opened = !result.error;
        }

        if (opened) {
            console.log('Opened build workspace in file explorer.');
        } else {
            console.log('Could not open file explorer automatically.');
            console.log(`   Open manually: ${workspacePath}`);
        }
    } catch (error: any) {
        console.log(`\nFailed to open build workspace: ${error?.message || error}`);
    }
}





async function showConfigMenu() {
    renderScreenHeader('Agent Configuration');
    console.log('');

    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = [
        'agentName', 'llmProvider', 'modelName', 'projectRoot', 'openaiApiKey', 'anthropicApiKey',
        'openrouterApiKey', 'openrouterBaseUrl', 'openrouterReferer', 'openrouterAppName',
        'googleApiKey', 'googleOAuthClientId', 'googleOAuthClientSecret', 'googleOAuthRedirectUri', 'googleWorkspaceCliPath', 'googleWorkspaceCliAccount', 'nvidiaApiKey', 'serperApiKey', 'braveSearchApiKey', 'searxngUrl',
        'searchProviderOrder', 'captchaApiKey', 'autonomyInterval', 'telegramToken',
        'whatsappEnabled', 'slackBotToken', 'slackAutoReplyEnabled', 'whatsappAutoReplyEnabled', 'whatsappStatusMediaMode',
        'whatsappContactAccessMode', 'whatsappAllowedContacts', 'whatsappBlockedContacts',
        'whatsappGroupsEnabled', 'whatsappGroupPolicy', 'whatsappAllowedGroups', 'whatsappBlockedGroups',
        'telegramChannelsEnabled', 'telegramGroupsEnabled', 'telegramGroupPolicy', 'telegramAllowedGroups', 'telegramBlockedGroups',
        'progressFeedbackEnabled', 'progressFeedbackStepInterval', 'progressFeedbackForceInitial',
        'progressFeedbackTypingOnly', 'enforceExplicitFileRequestForSendFile', 'onboardingQuestionnaireEnabled',
        'reconnectBriefingEnabled', 'reconnectBriefingThresholdDays', 'reconnectBriefingMaxCompletions',
        'reconnectBriefingMaxPending', 'recoveryDedupWindowHours', 'memoryContentMaxLength',
        'memoryFlushSoftThreshold', 'memoryFlushCooldownMinutes', 'memoryExtendedContextLimit',
        'threadContextRecentN', 'threadContextRelevantN', 'threadContextMaxLineLen',
        'threadContextOtherMemoriesN', 'journalContextLimit', 'learningContextLimit',
        'userContextLimit', 'stepCompactionThreshold', 'stepCompactionPreserveFirst',
        'stepCompactionPreserveLast', 'timeSignalHighRiskNoMessageSeconds',
        'timeSignalMediumRiskSilentSteps', 'timeSignalMediumRiskSinceDeliverySeconds',
        'memoryContextLimit', 'memoryEpisodicLimit', 'memoryConsolidationThreshold',
        'memoryConsolidationBatch', 'maxStepsPerAction', 'maxMessagesPerAction',
        'memoryPath', 'buildWorkspacePath', 'commandWorkingDir', 'commandAllowList',
        'commandDenyList', 'safeMode', 'sudoMode', 'pluginAllowList', 'pluginDenyList',
        'browserProfileDir', 'browserProfileName', 'sessionScope', 'guidanceMode',
        'guidanceRepeatQuestionThreshold', 'guidanceShortReplyMaxWords', 'guidanceShortReplyMaxChars',
        'guidanceAckPatterns', 'guidanceLowValuePatterns', 'guidanceClarificationKeywords',
        'guidanceQuestionStopWords', 'robustReasoningMode', 'reasoningExposeChecklist',
        'reasoningChecklistMaxItems', 'orcbotControlEnabled', 'orcbotControlCliAllowList',
        'orcbotControlCliDenyList', 'orcbotControlTimeoutMs'
    ];

    const choices: { name: string, value: string }[] = keys.map(key => ({
        name: `${key}: ${config[key as keyof typeof config] || '(empty)'}`,
        value: key
    }));
    choices.push({ name: 'Reset Agent (Fresh Start)', value: 'reset' });
    choices.push({ name: 'Back', value: 'back' });

    const { key } = await inquirer.prompt([
        {
            type: 'list',
            name: 'key',
            message: 'Select setting to edit:',
            choices,
        },
    ]);

    if (key === 'back') {
        return showMainMenu();
    }

    if (key === 'reset') {
        const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: 'Are you sure you want to RE-INITIALIZE the agent? This wipes all memory, USER.md, and .AI.md.', default: false }
        ]);
        if (confirm) {
            await agent.resetMemory();
            console.log('Agent factory reset complete.');
        }
        await waitKeyPress();
        return showConfigMenu();
    }

    const { value } = await inquirer.prompt([
        { type: 'input', name: 'value', message: `Enter new value for ${key}:` },
    ]);

    if (key === 'searchProviderOrder' || key === 'commandAllowList' || key === 'commandDenyList' || key === 'pluginAllowList' || key === 'pluginDenyList' || key === 'guidanceAckPatterns' || key === 'guidanceLowValuePatterns' || key === 'guidanceClarificationKeywords' || key === 'guidanceQuestionStopWords' || key === 'orcbotControlCliAllowList' || key === 'orcbotControlCliDenyList' || key === 'whatsappAllowedContacts' || key === 'whatsappBlockedContacts' || key === 'whatsappAllowedGroups' || key === 'whatsappBlockedGroups' || key === 'telegramAllowedGroups' || key === 'telegramBlockedGroups') {
        const parsed = (value || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        agent.config.set(key as any, parsed);
    } else if (key === 'safeMode' || key === 'sudoMode' || key === 'progressFeedbackEnabled' || key === 'progressFeedbackForceInitial' || key === 'progressFeedbackTypingOnly' || key === 'enforceExplicitFileRequestForSendFile' || key === 'onboardingQuestionnaireEnabled' || key === 'reconnectBriefingEnabled' || key === 'whatsappEnabled' || key === 'slackAutoReplyEnabled' || key === 'whatsappAutoReplyEnabled' || key === 'telegramChannelsEnabled' || key === 'robustReasoningMode' || key === 'reasoningExposeChecklist' || key === 'orcbotControlEnabled') {
        const normalized = String(value).trim().toLowerCase();
        agent.config.set(key as any, normalized === 'true' || normalized === '1' || normalized === 'yes');
    } else if (key === 'guidanceRepeatQuestionThreshold') {
        const num = parseFloat(value);
        if (!isNaN(num) && num > 0 && num <= 1) {
            agent.config.set(key as any, num);
        } else {
            console.log('Invalid threshold. Please enter a number between 0 and 1.');
            await waitKeyPress();
            return showConfigMenu();
        }
    } else if (key === 'memoryContextLimit' || key === 'memoryEpisodicLimit' || key === 'memoryConsolidationThreshold' || key === 'memoryConsolidationBatch' || key === 'maxStepsPerAction' || key === 'maxMessagesPerAction' || key === 'autonomyInterval' || key === 'guidanceShortReplyMaxWords' || key === 'guidanceShortReplyMaxChars' || key === 'reasoningChecklistMaxItems' || key === 'orcbotControlTimeoutMs' || key === 'progressFeedbackStepInterval' || key === 'reconnectBriefingThresholdDays' || key === 'reconnectBriefingMaxCompletions' || key === 'reconnectBriefingMaxPending' || key === 'recoveryDedupWindowHours' || key === 'memoryContentMaxLength' || key === 'memoryFlushSoftThreshold' || key === 'memoryFlushCooldownMinutes' || key === 'memoryExtendedContextLimit' || key === 'threadContextRecentN' || key === 'threadContextRelevantN' || key === 'threadContextMaxLineLen' || key === 'threadContextOtherMemoriesN' || key === 'journalContextLimit' || key === 'learningContextLimit' || key === 'userContextLimit' || key === 'stepCompactionThreshold' || key === 'stepCompactionPreserveFirst' || key === 'stepCompactionPreserveLast' || key === 'timeSignalHighRiskNoMessageSeconds' || key === 'timeSignalMediumRiskSilentSteps' || key === 'timeSignalMediumRiskSinceDeliverySeconds') {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
            agent.config.set(key as any, num);
        } else {
            console.log('Invalid number. Please enter a positive integer.');
            await waitKeyPress();
            return showConfigMenu();
        }
    } else {
        agent.config.set(key as any, value);
    }
    console.log('Configuration updated!');
    await waitKeyPress();
    await showConfigMenu();
}

async function performUpdate() {
    const { execSync, spawn } = require('child_process');
    const fs = require('fs');

    // Determine install location
    const orcbotDir = path.resolve(__dirname, '..', '..');
    const isGlobalInstall = orcbotDir.includes('node_modules');

    console.log('\nChecking for OrcBot updates...\n');

    try {
        // Check if we're in a git repo
        const gitDir = path.join(orcbotDir, '.git');
        const isGitRepo = fs.existsSync(gitDir);

        if (isGitRepo) {
            console.log(`OrcBot directory: ${orcbotDir}`);

            // Fetch latest changes
            console.log('Fetching latest changes from remote...');
            execSync('git fetch origin', { cwd: orcbotDir });

            // Check if updates are available
            const localHash = execSync('git rev-parse HEAD', { cwd: orcbotDir, encoding: 'utf8' }).trim();
            const remoteHash = execSync('git rev-parse origin/main', { cwd: orcbotDir, encoding: 'utf8' }).trim();

            if (localHash === remoteHash) {
                console.log('\nOrcBot is already up to date!');
                console.log(`   Current version: ${localHash.substring(0, 7)}`);
                return;
            }

            console.log(`\nUpdate available!`);
            console.log(`   Current: ${localHash.substring(0, 7)}`);
            console.log(`   Latest:  ${remoteHash.substring(0, 7)}`);

            // Show what's changing
            console.log('\nChanges to be applied:');
            const logs = execSync('git log --oneline HEAD..origin/main', { cwd: orcbotDir, encoding: 'utf8' });
            console.log(logs);

            // Force update: discard local changes and sync to origin/main
            console.log('\nApplying latest changes (force update)...');
            execSync('git reset --hard origin/main', { cwd: orcbotDir });
            execSync('git clean -fd', { cwd: orcbotDir });

            // Install dependencies
            console.log('\nInstalling dependencies...');
            execSync('npm install', { cwd: orcbotDir });

            // Rebuild
            console.log('\nRebuilding OrcBot...');
            execSync('npm run build', { cwd: orcbotDir });

            // Re-link globally
            const packageJson = JSON.parse(fs.readFileSync(path.join(orcbotDir, 'package.json'), 'utf8'));
            if (packageJson.bin) {
                console.log('\nRe-installing global command...');
                try {
                    execSync('npm install -g .', { cwd: orcbotDir });
                } catch (e) {
                    // Ignore global link errors in restricted environments
                }
            }

            console.log('\nOrcBot updated successfully!');
            console.log('   Please restart OrcBot to apply changes.');
            console.log('\n   Run: orcbot run');

        } else {
            // Not a git repo - might be npm installed
            console.log('OrcBot was not installed from git.');
            console.log('   To update, run these commands manually:');
            console.log('\n   cd ' + orcbotDir);
            console.log('   git pull origin main');
            console.log('   npm install');
            console.log('   npm run build');
            console.log('   npm install -g .');
        }
    } catch (error: any) {
        console.error('\nUpdate failed:', error.message);
        console.log('\n   Try updating manually:');
        console.log('   cd ' + orcbotDir);
        console.log('   git pull origin main');
        console.log('   npm install');
        console.log('   npm run build');
        console.log('   npm install -g .');
    }
}

function showStatus() {
    renderScreenHeader('Agent Status');

    const shortMem = agent.memory.searchMemory('short').length;
    const episodicMem = agent.memory.searchMemory('episodic').length;
    const queueItems = agent.actionQueue.getQueue();
    const queueLen = queueItems.length;
    const hasTelegram = !!agent.telegram;
    const hasWhatsapp = !!agent.whatsapp;
    const hasDiscord = !!agent.discord;
    const hasSlack = !!agent.slack;
    const model = agent.config.get('modelName') || DEFAULT_MODEL_IDS.openaiMain;
    const provider = agent.config.get('llmProvider') || 'auto';
    const agentName = agent.config.get('agentName') || 'OrcBot';
    const safeMode = agent.config.get('safeMode');
    const sudoMode = agent.config.get('sudoMode');

    // AI Model Panel
    console.log('');
    box([
        `${c.white}Model${c.reset}      ${brightCyan(bold(model))}`,
        `${c.white}Provider${c.reset}   ${c.brightWhite}${provider}${c.reset}`,
        `${c.white}Agent${c.reset}      ${c.bold}${c.brightWhite}${agentName}${c.reset}`,
        `${c.white}Mode${c.reset}       ${sudoMode ? `${c.bgRed}${c.bold}${c.white} SUDO ${c.reset} ${c.gray}(unrestricted)${c.reset}` : safeMode ? `${c.bgYellow}${c.bold}${c.white} SAFE ${c.reset} ${c.gray}(commands blocked)${c.reset}` : `${c.bgGreen}${c.bold}${c.white} NORMAL ${c.reset}`}`,
    ], { title: 'AI ENGINE', width: 52 });

    // Memory Panel
    const memTotal = shortMem + episodicMem;
    console.log('');
    box([
        `${c.white}Short-term${c.reset}  ${c.yellow}${c.bold}${String(shortMem).padStart(4)}${c.reset} entries  ${progressBar(shortMem, 200, 16)}`,
        `${c.white}Episodic${c.reset}    ${c.cyan}${c.bold}${String(episodicMem).padStart(4)}${c.reset} entries  ${progressBar(episodicMem, 50, 16, { colorFn: cyan })}`,
        `${c.white}Total${c.reset}       ${c.bold}${c.brightWhite}${String(memTotal).padStart(4)}${c.reset} entries`,
    ], { title: 'MEMORY', width: 52 });

    // Channels Panel — fixed-width label column for clean alignment
    console.log('');
    const chLine = (ok: boolean, color: string, label: string) =>
        `${ok ? `${c.brightGreen}●${c.reset}` : `${c.gray}○${c.reset}`} ${color}${label}${c.reset}${' '.repeat(Math.max(0, 12 - label.length))}${ok ? `${c.brightGreen}Connected${c.reset}` : `${c.gray}Not configured${c.reset}`}`;
    box([
        chLine(hasTelegram, c.brightCyan, 'Telegram'),
        chLine(hasWhatsapp, c.brightGreen, 'WhatsApp'),
        chLine(hasDiscord, c.brightMagenta, 'Discord'),
        chLine(hasSlack, c.brightYellow, 'Slack'),
    ], { title: 'CHANNELS', width: 52 });

    // Action Queue Panel
    const completed = queueItems.filter((a: any) => a.status === 'completed').length;
    const failed = queueItems.filter((a: any) => a.status === 'failed').length;
    const pending = queueItems.filter((a: any) => a.status === 'pending').length;
    const inProgress = queueItems.filter((a: any) => a.status === 'in-progress').length;
    const waiting = queueItems.filter((a: any) => a.status === 'waiting').length;
    console.log('');
    const queueLines: string[] = [
        `${c.brightGreen}● Completed${c.reset} ${c.bold}${c.brightWhite}${String(completed).padStart(3)}${c.reset}   ${c.yellow}● Pending${c.reset} ${c.bold}${c.brightWhite}${String(pending).padStart(3)}${c.reset}   ${c.cyan}● Active${c.reset} ${c.bold}${c.brightWhite}${String(inProgress).padStart(3)}${c.reset}`,
        `${c.red}● Failed${c.reset}    ${c.bold}${c.brightWhite}${String(failed).padStart(3)}${c.reset}   ${c.magenta}● Waiting${c.reset} ${c.bold}${c.brightWhite}${String(waiting).padStart(3)}${c.reset}   ${c.white}Total${c.reset}    ${c.bold}${c.brightWhite}${String(queueLen).padStart(3)}${c.reset}`,
    ];
    if (queueLen > 0) {
        queueLines.push('');
        queueLines.push(`${c.white}${c.bold}Recent:${c.reset}`);
        const recentActions = queueItems.slice(-3).reverse();
        for (const a of recentActions) {
            const statusIcon = a.status === 'completed' ? `${c.brightGreen}✓${c.reset}` : a.status === 'failed' ? `${c.red}✗${c.reset}` : a.status === 'in-progress' ? `${c.cyan}▶${c.reset}` : a.status === 'waiting' ? `` : `${c.yellow}…${c.reset}`;
            const desc = ((a as any).payload?.description || 'Unknown').slice(0, 38);
            queueLines.push(`  ${statusIcon} ${c.gray}${a.id.slice(0, 6)}${c.reset} ${c.white}${desc}${c.reset}`);
        }
    }
    box(queueLines, { title: 'ACTION QUEUE', width: 52 });

    console.log('');
}

function showGuardrailMetrics(limit: number = 10) {
    renderScreenHeader('Guardrail Metrics');

    const episodic = agent.memory.searchMemory('episodic') as any[];
    const supportedMetrics = new Set(['max_step_fallback', 'delay_risk_high']);
    const metricEntries = episodic
        .filter((m: any) => {
            const metricKey = String(m?.metadata?.metric || '').toLowerCase();
            const content = String(m?.content || '').toLowerCase();
            return supportedMetrics.has(metricKey) ||
                content.includes('[metric] max_step_fallback') ||
                content.includes('[metric] delay_risk_high');
        })
        .sort((a: any, b: any) => {
            const at = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bt = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bt - at;
        });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const total = metricEntries.length;
    const last24h = metricEntries.filter((m: any) => {
        const t = m?.timestamp ? new Date(m.timestamp).getTime() : 0;
        return t > 0 && now - t <= dayMs;
    }).length;
    const last7d = metricEntries.filter((m: any) => {
        const t = m?.timestamp ? new Date(m.timestamp).getTime() : 0;
        return t > 0 && now - t <= dayMs * 7;
    }).length;

    const sourceCounts = new Map<string, number>();
    const metricTypeCounts = new Map<string, number>();
    for (const entry of metricEntries) {
        const metricType = String(entry?.metadata?.metric || '').toLowerCase() || 'unknown';
        metricTypeCounts.set(metricType, (metricTypeCounts.get(metricType) || 0) + 1);
        const content = String(entry?.content || '');
        const sourceFromContent = content.match(/source=([^\s]+)/i)?.[1];
        const source = String(entry?.metadata?.channelSource || sourceFromContent || 'unknown').toLowerCase();
        sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    const typeSummary = Array.from(metricTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([metric, count]) => `${metric}:${count}`)
        .join('  ') || 'none';
    const topSources = Array.from(sourceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([source, count]) => `${source}:${count}`)
        .join('  ') || 'none';

    console.log('');
    box([
        `${c.white}Metrics${c.reset}        ${c.brightWhite}max_step_fallback, delay_risk_high${c.reset}`,
        `${c.white}Total${c.reset}          ${total > 0 ? `${c.yellow}${c.bold}${String(total)}${c.reset}` : `${c.gray}0${c.reset}`}`,
        `${c.white}Last 24 hours${c.reset}  ${last24h > 0 ? `${c.yellow}${c.bold}${String(last24h)}${c.reset}` : `${c.gray}0${c.reset}`}`,
        `${c.white}Last 7 days${c.reset}    ${last7d > 0 ? `${c.cyan}${c.bold}${String(last7d)}${c.reset}` : `${c.gray}0${c.reset}`}`,
        `${c.white}By type${c.reset}        ${c.brightWhite}${typeSummary}${c.reset}`,
        `${c.white}Top sources${c.reset}    ${c.brightWhite}${topSources}${c.reset}`,
    ], { title: 'FALLBACK SUMMARY', width: 64 });

    const recent = metricEntries.slice(0, Math.max(1, limit));
    if (recent.length === 0) {
        console.log('');
        box([dim('No guardrail metric events recorded yet.')], { title: 'RECENT EVENTS', width: 64 });
        console.log('');
        return;
    }

    const rows: string[][] = [[bold('Time'), bold('Metric'), bold('Action'), bold('Source'), bold('Msgs'), bold('Substantive')]];
    for (const event of recent) {
        const ts = event?.timestamp ? new Date(event.timestamp) : null;
        const timeStr = ts && !isNaN(ts.getTime())
            ? ts.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            : 'n/a';
        const metric = String(event?.metadata?.metric || 'unknown').toLowerCase();
        const actionId = String(event?.metadata?.actionId || 'unknown').slice(0, 8);
        const content = String(event?.content || '');
        const sourceFromContent = content.match(/source=([^\s]+)/i)?.[1] || 'unknown';
        const msgs = event?.metadata?.messagesSent ?? (content.match(/messagesSent=(\d+)/i)?.[1] ?? '-');
        const subs = event?.metadata?.substantiveDeliveriesSent ?? (content.match(/substantiveDeliveries=(\d+)/i)?.[1] ?? '-');
        rows.push([timeStr, metric, actionId, String(sourceFromContent), String(msgs), String(subs)]);
    }

    console.log('');
    box([`${dim('Recent')} ${recent.length} ${dim('event(s)')}`], { title: 'RECENT EVENTS', width: 64 });
    table(rows, { indent: '  ', separator: '   ', headerColor: brightCyan });
    console.log('');
}

function showTokenUsage() {
    renderScreenHeader('Token Usage');

    const tracker = new TokenTracker(
        agent.config.get('tokenUsagePath'),
        agent.config.get('tokenLogPath')
    );
    const summary = tracker.getSummary();
    const accuracy = tracker.getAccuracyReport();

    // Accuracy banner — the key info users need to understand their numbers
    console.log('');
    const realPct = accuracy.realPct;
    const estPct = accuracy.estimatedPct;
    const accuracyColor = realPct >= 80 ? c.brightGreen : realPct >= 50 ? c.yellow : c.brightRed;
    const accuracyLabel = realPct >= 80 ? '✓ High' : realPct >= 50 ? '~ Medium' : 'Low';
    box([
        `${c.white}Data accuracy:${c.reset}         ${accuracyColor}${c.bold}${accuracyLabel} (${realPct}% API-reported)${c.reset}`,
        `${c.white}API-reported calls:${c.reset}    ${c.bold}${c.brightWhite}${accuracy.realCalls.toLocaleString().padStart(8)}${c.reset}  ${c.gray}│${c.reset}  ${c.brightGreen}${(summary.realTotals?.totalTokens?.toLocaleString() || '0').padStart(12)}${c.reset} tokens`,
        `${c.white}Estimated calls:${c.reset}       ${c.bold}${c.brightWhite}${accuracy.estimatedCalls.toLocaleString().padStart(8)}${c.reset}  ${c.gray}│${c.reset}  ${c.yellow}${(summary.estimatedTotals?.totalTokens?.toLocaleString() || '0').padStart(12)}${c.reset} tokens`,
        `${c.gray}${'─'.repeat(52)}${c.reset}`,
        `${c.white}If numbers seem high, estimated calls had no usage${c.reset}`,
        `${c.white}block from the provider. Run${c.reset} ${c.bold}${c.brightCyan}orcbot tokens recount${c.reset} ${c.white}to rebuild.${c.reset}`,
    ], { title: 'DATA ACCURACY', width: 58, color: accuracyColor });

    // Totals Panel — now with real vs estimated breakdown
    console.log('');
    const totalTokens = summary.totals.totalTokens;
    const realTotal = summary.realTotals?.totalTokens || 0;
    const estTotal = summary.estimatedTotals?.totalTokens || 0;
    box([
        `${c.white}Prompt${c.reset}       ${c.bold}${c.brightWhite}${summary.totals.promptTokens.toLocaleString().padStart(12)}${c.reset} tokens`,
        `${c.white}Completion${c.reset}   ${c.bold}${c.brightWhite}${summary.totals.completionTokens.toLocaleString().padStart(12)}${c.reset} tokens`,
        `${c.gray}${'─'.repeat(34)}${c.reset}`,
        `${c.white}Total${c.reset}        ${c.brightCyan}${c.bold}${totalTokens.toLocaleString().padStart(12)}${c.reset} tokens`,
        `  ${c.gray}├ API-reported:${c.reset} ${c.brightGreen}${realTotal.toLocaleString().padStart(10)}${c.reset}`,
        `  ${c.gray}└ Estimated:${c.reset}    ${c.yellow}${estTotal.toLocaleString().padStart(10)}${c.reset}  ${estTotal > 0 ? `${c.gray}(tokenizer estimate)${c.reset}` : ''}`,
    ], { title: 'TOKEN TOTALS', width: 48 });

    // Prompt cache panel — OpenAI and Gemini cache implicitly and silently, so without this
    // there is no way to tell whether the cache is being hit at all.
    const cache = tracker.getCacheReport();
    if (cache.promptTokens > 0) {
        console.log('');
        const cacheLines: string[] = [
            `${c.white}Cached prompt${c.reset}  ${c.brightCyan}${c.bold}${cache.cachedTokens.toLocaleString().padStart(12)}${c.reset} tokens  ${c.gray}(${cache.hitRatePct}% of API-reported prompt tokens)${c.reset}`,
        ];
        const cacheProviders = Object.entries(cache.byProvider);
        if (cacheProviders.length > 0) {
            cacheLines.push(`${c.gray}${'─'.repeat(40)}${c.reset}`);
            for (const [prov, cached] of cacheProviders) {
                cacheLines.push(`${c.white}${prov.padEnd(12)}${c.reset} ${dim(cached.toLocaleString().padStart(12))}`);
            }
        }
        box(cacheLines, { title: 'PROMPT CACHE', width: 58 });
    }

    // Provider breakdown
    const providers = Object.entries(summary.byProvider);
    if (providers.length > 0) {
        console.log('');
        const providerLines: string[] = [];
        const maxProviderTokens = Math.max(...providers.map(([, t]) => t.totalTokens), 1);
        for (const [prov, totals] of providers) {
            const ratio = totals.totalTokens / Math.max(totalTokens, 1);
            const pct = Math.round(ratio * 100);
            const bar = progressBar(totals.totalTokens, maxProviderTokens, 14, { colorFn: cyan });
            const realT = (totals as any).real?.totalTokens || 0;
            const estT = (totals as any).estimated?.totalTokens || 0;
            providerLines.push(`${bold(prov.padEnd(12))} ${bar} ${dim(totals.totalTokens.toLocaleString().padStart(10))} ${dim(`(${pct}%)`)}`);
            if (estT > 0) {
                providerLines.push(`${dim(' '.repeat(12))} ${dim('real:')} ${green(realT.toLocaleString().padStart(8))} ${dim('est:')} ${c.yellow}${estT.toLocaleString().padStart(8)}${c.reset}`);
            }
        }
        box(providerLines, { title: 'BY PROVIDER', width: 58 });
    }

    // Model breakdown
    const models = Object.entries(summary.byModel).slice(0, 8);
    if (models.length > 0) {
        console.log('');
        const modelLines: string[] = [];
        const maxModelTokens = Math.max(...models.map(([, t]) => t.totalTokens), 1);
        for (const [mdl, totals] of models) {
            const bar = progressBar(totals.totalTokens, maxModelTokens, 12, { colorFn: magenta });
            const displayName = mdl.length > 22 ? mdl.slice(0, 20) + '…' : mdl;
            const estT = (totals as any).estimated?.totalTokens || 0;
            const suffix = estT > 0 ? ` ${c.yellow}~est${c.reset}` : '';
            modelLines.push(`${displayName.padEnd(22)} ${bar} ${dim(totals.totalTokens.toLocaleString().padStart(10))}${suffix}`);
        }
        box(modelLines, { title: 'TOP MODELS', width: 58 });
    }

    console.log('');
    console.log(gray(`  Last updated: ${summary.lastUpdated}`));
    console.log('');
}

async function waitKeyPress() {
    // White text so the prompt is clearly visible (gray was nearly invisible on dark terminals)
    await inquirer.prompt([{ type: 'input', name: 'continue', message: `${c.brightCyan}›${c.reset} ${c.white}Press Enter to continue...${c.reset}` }]);
}

program.parse(process.argv);
