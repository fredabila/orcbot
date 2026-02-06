#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { ConfigManager } from '../config/ConfigManager';
import { eventBus } from '../core/EventBus';
import qrcode from 'qrcode-terminal';

import path from 'path';
import os from 'os';
import fs from 'fs';
import { WorkerProfileManager } from '../core/WorkerProfile';
import { DaemonManager } from '../utils/daemon';
import { TokenTracker } from '../core/TokenTracker';

dotenv.config(); // Local .env
dotenv.config({ path: path.join(os.homedir(), '.orcbot', '.env') }); // Global .env

// ── ANSI color helpers (zero deps) ─────────────────────────────────────
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
const gray = (text: string) => clr(c.gray, text);
const brightCyan = (text: string) => clr(c.brightCyan, text);
const brightGreen = (text: string) => clr(c.brightGreen, text);
const brightMagenta = (text: string) => clr(c.brightMagenta, text);

// ── Visual rendering helpers ───────────────────────────────────────────

/** Render a box with double-line borders and optional title */
function box(lines: string[], opts: { title?: string; width?: number; color?: string; padding?: number } = {}) {
    const color = opts.color || c.cyan;
    const pad = opts.padding ?? 1;
    // Strip ANSI for measuring
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const contentWidth = opts.width || Math.max(
        opts.title ? stripAnsi(opts.title).length + 4 : 0,
        ...lines.map(l => stripAnsi(l).length + pad * 2)
    );
    const w = Math.max(contentWidth, 40);
    
    const top = opts.title
        ? `${color}╔═${ bold(` ${opts.title} `)}${color}${'═'.repeat(Math.max(0, w - stripAnsi(opts.title).length - 3))}╗${c.reset}`
        : `${color}╔${'═'.repeat(w)}╗${c.reset}`;
    const bot = `${color}╚${'═'.repeat(w)}╝${c.reset}`;
    
    console.log(top);
    for (const line of lines) {
        const visible = stripAnsi(line).length;
        const rightPad = Math.max(0, w - visible - pad);
        console.log(`${color}║${c.reset}${' '.repeat(pad)}${line}${' '.repeat(rightPad)}${color}║${c.reset}`);
    }
    console.log(bot);
}

/** Render a horizontal bar (progress/usage visualization) */
function progressBar(value: number, max: number, width = 20, opts: { filled?: string; empty?: string; colorFn?: (s: string) => string } = {}): string {
    const ratio = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
    const filledLen = Math.round(ratio * width);
    const emptyLen = width - filledLen;
    const filled = (opts.filled || '█').repeat(filledLen);
    const empty = (opts.empty || '░').repeat(emptyLen);
    const colorFn = opts.colorFn || (ratio > 0.7 ? green : ratio > 0.3 ? yellow : red);
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

/** Gradient text effect (cycles through colors) */
function gradient(text: string, colors: string[] = [c.cyan, c.brightCyan, c.blue, c.brightMagenta, c.magenta]): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const color = colors[i % colors.length];
        result += `${color}${text[i]}`;
    }
    return result + c.reset;
}

/** Big block-letter OrcBot logo */
function renderLogo() {
    const logoLines = [
        '  ██████╗ ██████╗  ██████╗██████╗  ██████╗ ████████╗',
        ' ██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝',
        ' ██║   ██║██████╔╝██║     ██████╔╝██║   ██║   ██║   ',
        ' ██║   ██║██╔══██╗██║     ██╔══██╗██║   ██║   ██║   ',
        ' ╚██████╔╝██║  ██║╚██████╗██████╔╝╚██████╔╝   ██║   ',
        '  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═════╝  ╚═════╝    ╚═╝   ',
    ];
    const gradientColors = [c.cyan, c.brightCyan, c.brightCyan, c.brightMagenta, c.magenta, c.blue];
    for (let i = 0; i < logoLines.length; i++) {
        console.log(`  ${gradientColors[i % gradientColors.length]}${logoLines[i]}${c.reset}`);
    }
}

function banner() {
    console.log('');
    renderLogo();
    console.log(gray('  ') + dim('  Autonomous AI Agent Framework') + gray('  │  ') + dim('v1.0.0'));
    console.log(gray('  ') + dim('  by ') + brightCyan('Frederick Abila') + dim('  │  ') + cyan('frederick.buzzchat.site'));
    console.log(gray('  ') + dim('  ') + gray('github.com/') + bold('fredabila/orcbot'));
    console.log(gray('  ' + '─'.repeat(54)));
    console.log('');
}

function sectionHeader(emoji: string, title: string) {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const titleText = `${emoji}  ${title}`;
    const w = Math.max(48, stripAnsi(titleText).length + 4);
    console.log('');
    console.log(`  ${c.cyan}┌${'─'.repeat(w)}┐${c.reset}`);
    console.log(`  ${c.cyan}│${c.reset} ${bold(titleText)}${' '.repeat(Math.max(0, w - stripAnsi(titleText).length - 1))}${c.cyan}│${c.reset}`);
    console.log(`  ${c.cyan}└${'─'.repeat(w)}┘${c.reset}`);
}

function kvLine(key: string, value: string, indent = '  ') {
    console.log(`${indent}  ${c.gray}${key}${c.reset} ${value}`);
}

function statusBadge(ok: boolean, onLabel = 'ON', offLabel = 'OFF'): string {
    return ok ? `${c.green}${c.bold}● ${onLabel}${c.reset}` : `${c.gray}○ ${offLabel}${c.reset}`;
}

/** Status dot with label */
function statusDot(ok: boolean, label?: string): string {
    if (ok) return `${c.green}●${c.reset}${label ? ` ${label}` : ''}`;
    return `${c.gray}○${c.reset}${label ? ` ${dim(label)}` : ''}`;
}

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Promise rejection (non-fatal): ${reason}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception (non-fatal): ${err?.stack || err}`);
});

const program = new Command();
const agent = new Agent();
const workerProfile = new WorkerProfileManager();

program
    .name('orcbot')
    .description('TypeScript Autonomous Agent CLI Tool')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new agent environment')
    .action(() => {
        console.log('Initializing agent environment...');
        console.log('Files created: .env, USER.md, SKILLS.md, .AI.md, memory.json, orcbot.config.yaml');
        logger.info('Agent environment initialized');
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
            console.log(`📦 Installing skill from ${source}...`);
            const result = await sm.installSkillFromUrl(source);
            console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
        } else {
            console.log(`📦 Installing skill from ${source}...`);
            const result = await sm.installSkillFromPath(source);
            console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
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
        console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
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
            const status = s.activated ? '🟢 Active' : '⚪ Inactive';
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
            console.log(`✅ Skill "${name}" is valid.`);
        } else {
            console.log(`❌ ${result.errors.length} issue(s):`);
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
    .command('run')
    .description('Start the agent autonomous loop (checks for daemon conflicts)')
    .option('-d, --daemon', 'Run in background as a daemon')
    .option('-b, --background', 'Run in background (nohup-style)')
    .option('--daemon-child', 'Internal: run as daemon child', false)
    .option('--background-child', 'Internal: run as background child', false)
    .action(async (options) => {
        const daemonManager = DaemonManager.createDefault();
        const status = daemonManager.isRunning();

        // Check for ANY existing OrcBot instance via lock file
        const lockPath = path.join(os.homedir(), '.orcbot', 'orcbot.lock');
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
                            console.log('🧹 Cleaned up stale lock file from previous crashed instance.');
                        }
                    }
                }
            } catch (e) {
                // Invalid lock file, ignore
            }
        }

        // Block if existing instance found
        if (existingInstance && !options.daemonChild && !options.backgroundChild) {
            console.error('\n❌ OrcBot is already running!');
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

            const dataDir = path.join(os.homedir(), '.orcbot');
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
            console.log('\n✅ OrcBot is running in the background.');
            console.log(`   Log file: ${logPath}`);
            console.log('   Stop with: pkill -f "orcbot run --background-child"');
            return;
        }

        if (options.daemon || options.daemonChild) {
            // Daemon mode - check already handled in daemonize() method
            daemonManager.daemonize();
            logger.info('Agent loop starting in daemon mode...');
            await agent.start();
        } else {
            // Foreground mode - check if daemon is already running
            if (status.running) {
                console.error('\n❌ Cannot start in foreground mode: OrcBot daemon is already running');
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
            await agent.start();
        }
    });

program
    .command('ui')
    .description('Start the interactive TUI mode')
    .action(async () => {
        await showMainMenu();
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
    .description('Reset agent memory, identity, and task history')
    .action(async () => {
        const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: 'Are you sure you want to reset ALL memory? This cannot be undone.', default: false }
        ]);
        if (confirm) {
            await agent.resetMemory();
            console.log('Agent has been reset to factory settings.');
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
        const lockPath = path.join(os.homedir(), '.orcbot', 'orcbot.lock');
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
                    console.log('🟢 OrcBot is RUNNING');
                    console.log(`   PID: ${lockData.pid}`);
                    console.log(`   Started: ${lockData.startedAt}`);
                    console.log(`   Host: ${lockData.host}`);
                    console.log(`   Working Dir: ${lockData.cwd}`);
                    console.log('\n   To stop: pkill -f "orcbot" OR systemctl stop orcbot');
                } else {
                    console.log('🔴 OrcBot is NOT running (stale lock file found)');
                    fs.unlinkSync(lockPath);
                    console.log('   🧹 Cleaned up stale lock file.');
                }
            } catch (e) {
                console.log('🔴 OrcBot is NOT running');
            }
        } else {
            console.log('🔴 OrcBot is NOT running');
            console.log('\n   To start: orcbot run  OR  systemctl start orcbot');
        }
        
        console.log('\n--- Memory & Queue ---');
        showStatus();
    });

program
    .command('tokens')
    .description('Show token usage summary')
    .action(() => {
        showTokenUsage();
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
                        console.log(`✅ Sent stop signal to daemon (PID: ${status.pid})`);
                    } catch (error) {
                        console.error(`❌ Failed to stop daemon: ${error}`);
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
                        console.log(`✅ Sent stop signal to daemon (PID: ${status.pid})`);
                        console.log('   Use "orcbot daemon status" to verify it stopped');
                    } catch (error) {
                        console.error(`❌ Failed to stop daemon: ${error}`);
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
    .option('-b, --background', 'Run gateway in background')
    .option('--background-child', 'Internal: run as background child', false)
    .action(async (options) => {
        // Handle background mode
        if (options.background && !options.backgroundChild) {
            const { spawn } = require('child_process');
            const nodePath = process.execPath;
            const scriptPath = process.argv[1];

            const dataDir = path.join(os.homedir(), '.orcbot');
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

            const child = spawn(nodePath, args, {
                detached: true,
                stdio: ['ignore', out, out],
                env: { ...process.env, ORCBOT_GATEWAY_BACKGROUND: '1' }
            });

            child.unref();
            console.log('\n✅ OrcBot Gateway is running in the background.');
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
        
        console.log('\n🌐 Starting OrcBot Web Gateway...');
        await gateway.start();
        
        console.log(`\n📡 Gateway is ready!`);
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
        console.log('   GET  /api/logs           - Recent logs');
        console.log('\n   Press Ctrl+C to stop\n');

        if (options.withAgent) {
            console.log('🤖 Also starting agent loop...\n');
            gateway.setAgentLoopStarted(true);
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        } else {
            console.log('💡 Tip: Add --with-agent to also run the agent loop\n');
        }

        // Keep process running
        process.on('SIGINT', () => {
            console.log('\nShutting down gateway...');
            gateway.stop();
            process.exit(0);
        });
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
        agent.config.set(key as any, value);
        console.log(`Configuration updated: ${key} = ${value}`);
    });

// Lightpanda browser management
const lightpandaCommand = program
    .command('lightpanda')
    .description('Manage Lightpanda lightweight browser (9x less RAM than Chrome)');

lightpandaCommand
    .command('install')
    .description('Download and install Lightpanda browser')
    .option('-d, --dir <path>', 'Installation directory', path.join(os.homedir(), '.orcbot', 'lightpanda'))
    .action(async (options) => {
        const installDir = options.dir;
        const platform = process.platform;
        const arch = process.arch;
        
        console.log('\n🐼 Installing Lightpanda browser...\n');
        
        // Determine download URL based on platform
        let downloadUrl: string;
        let binaryName = 'lightpanda';
        
        if (platform === 'linux' && arch === 'x64') {
            downloadUrl = 'https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux';
        } else if (platform === 'darwin' && arch === 'arm64') {
            downloadUrl = 'https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos';
        } else if (platform === 'win32') {
            console.error('❌ Lightpanda is not available natively on Windows.');
            console.log('\n   Use WSL2 instead:');
            console.log('   1. Open WSL terminal');
            console.log('   2. Run: curl -L -o lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux');
            console.log('   3. Run: chmod a+x ./lightpanda');
            console.log('\n   Or use Docker:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        } else if (platform === 'darwin' && arch === 'x64') {
            console.error('❌ Lightpanda is not yet available for macOS Intel (x64).');
            console.log('\n   Only macOS ARM64 (Apple Silicon) is supported.');
            console.log('\n   Alternative: Use Docker:');
            console.log('   docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly');
            process.exit(1);
        } else {
            console.error(`❌ Lightpanda is not available for ${platform}/${arch}`);
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
            
            console.log('✅ Lightpanda installed successfully!\n');
            console.log('   Next steps:');
            console.log(`   1. Start Lightpanda: orcbot lightpanda start`);
            console.log(`   2. Enable in config: orcbot config set browserEngine lightpanda`);
            console.log(`   3. Run OrcBot normally: orcbot run\n`);
            
            // Auto-configure
            agent.config.set('lightpandaPath', binaryPath);
            console.log(`   ✓ Config updated: lightpandaPath = ${binaryPath}`);
            
        } catch (error: any) {
            console.error(`\n❌ Installation failed: ${error.message}`);
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
        const lightpandaPath = agent.config.get('lightpandaPath') || path.join(os.homedir(), '.orcbot', 'lightpanda', 'lightpanda');
        
        if (!fs.existsSync(lightpandaPath)) {
            console.error('❌ Lightpanda not found. Run: orcbot lightpanda install');
            process.exit(1);
        }
        
        const { spawn } = require('child_process');
        const args = ['serve', '--host', options.host, '--port', options.port, '--timeout', options.timeout];
        
        console.log(`\n🐼 Starting Lightpanda browser...`);
        console.log(`   Binary: ${lightpandaPath}`);
        console.log(`   Endpoint: ws://${options.host}:${options.port}\n`);
        
        if (options.background) {
            const dataDir = path.join(os.homedir(), '.orcbot');
            const logPath = path.join(dataDir, 'lightpanda.log');
            const pidPath = path.join(dataDir, 'lightpanda.pid');
            const out = fs.openSync(logPath, 'a');
            
            const child = spawn(lightpandaPath, args, {
                detached: true,
                stdio: ['ignore', out, out]
            });
            
            fs.writeFileSync(pidPath, String(child.pid));
            child.unref();
            
            console.log('✅ Lightpanda running in background');
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
                console.error(`❌ Failed to start: ${err.message}`);
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
        const pidPath = path.join(os.homedir(), '.orcbot', 'lightpanda.pid');
        
        if (!fs.existsSync(pidPath)) {
            console.log('Lightpanda is not running (no PID file found)');
            return;
        }
        
        try {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log(`✅ Stopped Lightpanda (PID: ${pid})`);
        } catch (e: any) {
            if (e.code === 'ESRCH') {
                fs.unlinkSync(pidPath);
                console.log('Lightpanda was not running (stale PID file cleaned up)');
            } else {
                console.error(`❌ Failed to stop: ${e.message}`);
            }
        }
    });

lightpandaCommand
    .command('status')
    .description('Check Lightpanda browser status')
    .action(() => {
        const pidPath = path.join(os.homedir(), '.orcbot', 'lightpanda.pid');
        const lightpandaPath = agent.config.get('lightpandaPath');
        const endpoint = agent.config.get('lightpandaEndpoint') || 'ws://127.0.0.1:9222';
        const engineSetting = agent.config.get('browserEngine') || 'playwright';
        
        console.log('\n🐼 Lightpanda Status\n');
        
        // Installation status
        if (lightpandaPath && fs.existsSync(lightpandaPath)) {
            console.log(`   ✅ Installed: ${lightpandaPath}`);
        } else {
            console.log('   ❌ Not installed (run: orcbot lightpanda install)');
        }
        
        // Running status
        if (fs.existsSync(pidPath)) {
            try {
                const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
                process.kill(pid, 0); // Check if running
                console.log(`   ✅ Running: PID ${pid}`);
            } catch {
                fs.unlinkSync(pidPath);
                console.log('   ⚪ Not running');
            }
        } else {
            console.log('   ⚪ Not running');
        }
        
        // Config status
        console.log(`   📡 Endpoint: ${endpoint}`);
        console.log(`   ⚙️  Browser engine: ${engineSetting}`);
        
        if (engineSetting !== 'lightpanda') {
            console.log('\n   💡 To enable: orcbot config set browserEngine lightpanda');
        }
        
        console.log('');
    });

lightpandaCommand
    .command('enable')
    .description('Enable Lightpanda as the default browser engine')
    .action(() => {
        agent.config.set('browserEngine', 'lightpanda');
        console.log('✅ Browser engine set to Lightpanda');
        console.log('   Make sure Lightpanda is running: orcbot lightpanda start -b');
    });

lightpandaCommand
    .command('disable')
    .description('Switch back to Playwright (Chrome)')
    .action(() => {
        agent.config.set('browserEngine', 'playwright');
        console.log('✅ Browser engine set to Playwright (Chrome)');
    });

async function showMainMenu() {
    console.clear();
    banner();

    // ── Dashboard Panel ──────────────────────────────────────────────
    const model = agent.config.get('modelName') || 'gpt-4o';
    const provider = agent.config.get('llmProvider') || 'auto';
    const queueItems = agent.actionQueue.getQueue();
    const queueLen = queueItems.length;
    const pendingCount = queueItems.filter((a: any) => a.status === 'queued' || a.status === 'in-progress').length;
    const shortMem = agent.memory.searchMemory('short').length;
    const hasTelegram = !!agent.config.get('telegramToken');
    const hasWhatsapp = !!agent.config.get('whatsappEnabled');
    const hasDiscord = !!agent.config.get('discordToken');
    const channelCount = [hasTelegram, hasWhatsapp, hasDiscord].filter(Boolean).length;
    const agentName = agent.config.get('agentName') || 'OrcBot';
    const sudoMode = agent.config.get('sudoMode');

    const channelDots = [
        hasTelegram ? `${c.brightCyan}TG${c.reset}` : `${c.gray}TG${c.reset}`,
        hasWhatsapp ? `${c.brightGreen}WA${c.reset}` : `${c.gray}WA${c.reset}`,
        hasDiscord ? `${c.brightMagenta}DC${c.reset}` : `${c.gray}DC${c.reset}`,
    ].join(dim(' │ '));

    box([
        `${dim('Agent')}    ${bold(agentName)}${sudoMode ? `  ${c.bgRed}${c.white}${c.bold} SUDO ${c.reset}` : ''}`,
        `${dim('Model')}    ${brightCyan(model)} ${dim('via')} ${cyan(provider)}`,
        `${dim('Channels')} ${channelDots}  ${dim(`(${channelCount}/3 active)`)}`,
        '',
        `${dim('Queue')}    ${pendingCount > 0 ? yellow(bold(String(pendingCount))) + dim(' active') : green('idle')}${queueLen > pendingCount ? dim(` │ ${queueLen - pendingCount} completed`) : ''}`,
        `${dim('Memory')}   ${cyan(String(shortMem))} ${dim('short-term entries')} ${progressBar(shortMem, 100, 12)}`,
    ], { title: 'DASHBOARD', width: 56 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: bold('What would you like to do?'),
            choices: [
                new inquirer.Separator(cyan(' ─── Run ') + gray('─'.repeat(30))),
                { name: `${c.green}▶${c.reset}  Start Agent Loop`, value: 'start' },
                { name: `${c.yellow}📋${c.reset} Push Task`, value: 'push' },
                { name: `${c.cyan}📊${c.reset} View Status`, value: 'status' },
                new inquirer.Separator(cyan(' ─── Configure ') + gray('─'.repeat(24))),
                { name: `${c.magenta}🧠${c.reset} Manage AI Models`, value: 'models' },
                { name: `${c.blue}🔌${c.reset} Manage Connections`, value: 'connections' },
                { name: `${c.brightCyan}⚡${c.reset} Manage Skills ${dim(`(${agent.skills.getAgentSkills().length} installed)`)}`, value: 'skills' },
                { name: `${c.yellow}🔧${c.reset} Tooling & APIs`, value: 'tooling' },
                new inquirer.Separator(cyan(' ─── Advanced ') + gray('─'.repeat(25))),
                { name: `${c.brightGreen}🌐${c.reset} Web Gateway`, value: 'gateway' },
                { name: `${c.brightMagenta}🪪${c.reset}  Worker Profile`, value: 'worker' },
                { name: `${c.brightCyan}🐙${c.reset} Multi-Agent Orchestration`, value: 'orchestration' },
                { name: `${c.red}🔒${c.reset} Security & Permissions`, value: 'security' },
                { name: `${c.green}📈${c.reset} Token Usage`, value: 'tokens' },
                new inquirer.Separator(cyan(' ─── System ') + gray('─'.repeat(27))),
                { name: `${c.gray}⚙️ ${c.reset} Configure Agent`, value: 'config' },
                { name: `${c.gray}⬆️ ${c.reset} Update OrcBot`, value: 'update' },
                { name: dim('   Exit'), value: 'exit' },
            ],
            pageSize: 24
        },
    ]);

    switch (action) {
        case 'start':
            console.log('Starting agent loop... (Ctrl+C to stop)');
            await agent.start();
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
        case 'connections':
            await showConnectionsMenu();
            break;
        case 'models':
            await showModelsMenu();
            break;
        case 'tooling':
            await showToolingMenu();
            break;
        case 'gateway':
            await showGatewayMenu();
            break;
        case 'worker':
            await showWorkerProfileMenu();
            break;
        case 'orchestration':
            await showOrchestrationMenu();
            break;
        case 'security':
            await showSecurityMenu();
            break;
        case 'tokens':
            showTokenUsage();
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
            process.exit(0);
    }
}

async function showBrowserMenu() {
    const currentEngine = agent.config.get('browserEngine') || 'playwright';
    const lightpandaPath = agent.config.get('lightpandaPath');
    const lightpandaEndpoint = agent.config.get('lightpandaEndpoint') || 'ws://127.0.0.1:9222';
    const pidPath = path.join(os.homedir(), '.orcbot', 'lightpanda.pid');
    
    // Check if Lightpanda is installed
    const isInstalled = lightpandaPath && fs.existsSync(lightpandaPath);
    
    // Check if Lightpanda is running
    let isRunning = false;
    let runningPid: number | null = null;
    if (fs.existsSync(pidPath)) {
        try {
            runningPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            process.kill(runningPid, 0);
            isRunning = true;
        } catch {
            fs.unlinkSync(pidPath);
        }
    }
    
    console.clear();
    banner();
    sectionHeader('🐼', 'Browser Engine');
    console.log('');
    const browserLines = [
        `${dim('Engine')}     ${currentEngine === 'lightpanda' ? brightCyan(bold('🐼 Lightpanda')) : cyan(bold('🌐 Playwright (Chrome)'))}`,
        `${dim('Installed')}  ${isInstalled ? green('● Yes') : gray('○ No')}`,
        ...(isInstalled ? [
            `${dim('Server')}     ${isRunning ? green(`● Running ${dim(`(PID: ${runningPid})`)}`) : gray('○ Stopped')}`,
            `${dim('Endpoint')}   ${dim(lightpandaEndpoint)}`,
        ] : []),
    ];
    box(browserLines, { title: '🌐 BROWSER STATUS', width: 50, color: c.cyan });
    console.log('');

    const choices = [
        { name: currentEngine === 'playwright' ? '🐼 Switch to Lightpanda (9x less RAM)' : '🌐 Switch to Playwright (Chrome)', value: 'toggle' },
    ];
    
    if (!isInstalled) {
        choices.push({ name: '📦 Install Lightpanda', value: 'install' });
    } else {
        if (isRunning) {
            choices.push({ name: '🛑 Stop Lightpanda Server', value: 'stop' });
        } else {
            choices.push({ name: '🚀 Start Lightpanda Server', value: 'start' });
        }
    }
    
    choices.push({ name: 'Back', value: 'back' });

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Browser Options:',
            choices
        }
    ]);

    if (action === 'back') return showToolingMenu();
    
    if (action === 'toggle') {
        if (currentEngine === 'playwright') {
            if (!isInstalled) {
                console.log('\n⚠️  Lightpanda is not installed.');
                const { install } = await inquirer.prompt([
                    { type: 'confirm', name: 'install', message: 'Would you like to install it now?', default: true }
                ]);
                if (install) {
                    console.log('\n📦 Installing Lightpanda...');
                    console.log('   Run: orcbot lightpanda install\n');
                }
            } else {
                agent.config.set('browserEngine', 'lightpanda');
                console.log('\n✅ Switched to Lightpanda');
                if (!isRunning) {
                    console.log('   ⚠️  Remember to start the server: orcbot lightpanda start -b');
                }
            }
        } else {
            agent.config.set('browserEngine', 'playwright');
            console.log('\n✅ Switched to Playwright (Chrome)');
        }
    } else if (action === 'install') {
        console.log('\n📦 To install Lightpanda, run:');
        console.log('   orcbot lightpanda install\n');
    } else if (action === 'start') {
        const { spawn } = require('child_process');
        const dataDir = path.join(os.homedir(), '.orcbot');
        const logPath = path.join(dataDir, 'lightpanda.log');
        const out = fs.openSync(logPath, 'a');
        
        // Use --timeout 300 (5 minutes) to prevent premature disconnection
        const child = spawn(lightpandaPath, ['serve', '--host', '127.0.0.1', '--port', '9222', '--timeout', '300'], {
            detached: true,
            stdio: ['ignore', out, out]
        });
        
        fs.writeFileSync(pidPath, String(child.pid));
        child.unref();
        
        console.log('\n✅ Lightpanda started');
        console.log(`   PID: ${child.pid}`);
        console.log(`   Endpoint: ws://127.0.0.1:9222`);
    } else if (action === 'stop') {
        try {
            process.kill(runningPid!, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log('\n✅ Lightpanda stopped');
        } catch (e: any) {
            console.error(`\n❌ Failed to stop: ${e.message}`);
        }
    }
    
    await waitKeyPress();
    return showBrowserMenu();
}

async function showToolingMenu() {
    console.clear();
    banner();
    sectionHeader('🔧', 'Tooling & APIs');

    const hasSerper = !!agent.config.get('serperApiKey');
    const hasBrave = !!agent.config.get('braveSearchApiKey');
    const hasSearxng = !!agent.config.get('searxngUrl');
    const hasCaptcha = !!agent.config.get('captchaApiKey');
    const browserEngine = agent.config.get('browserEngine') || 'playwright';

    console.log('');
    const toolLines = [
        `${statusDot(true, '')} ${bold('Browser')}       ${browserEngine === 'lightpanda' ? cyan('🐼 Lightpanda') : cyan('🌐 Playwright')}`,
        `${statusDot(hasSerper, '')} ${bold('Serper')}        ${hasSerper ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasBrave, '')} ${bold('Brave Search')}  ${hasBrave ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasSearxng, '')} ${bold('SearxNG')}       ${hasSearxng ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasCaptcha, '')} ${bold('2Captcha')}      ${hasCaptcha ? green('Configured') : gray('Not set')}`,
    ];
    box(toolLines, { title: '🛠️  TOOL STATUS', width: 52, color: c.yellow });
    console.log('');

    const { tool } = await inquirer.prompt([
        {
            type: 'list',
            name: 'tool',
            message: cyan('Select tool to configure:'),
            choices: [
                { name: `  🐼 ${bold('Browser Engine')} ${dim('(Lightpanda / Chrome)')}`, value: 'browser' },
                new inquirer.Separator(gradient('  ─── Search Providers ─────────────', [c.yellow, c.gray])),
                { name: `  ${statusDot(hasSerper, '')} Serper ${dim('(Web Search API)')}`, value: 'serper' },
                { name: `  ${statusDot(hasBrave, '')} Brave Search`, value: 'brave' },
                { name: `  ${statusDot(hasSearxng, '')} SearxNG ${dim('(Self-hosted)')}`, value: 'searxng' },
                { name: `  🔀 ${bold('Search Provider Order')}`, value: 'searchOrder' },
                new inquirer.Separator(gradient('  ─── Other ────────────────────────', [c.yellow, c.gray])),
                { name: `  ${statusDot(hasCaptcha, '')} 2Captcha ${dim('(CAPTCHA Solver)')}`, value: 'captcha' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.yellow, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (tool === 'back') return showMainMenu();

    if (tool === 'browser') {
        await showBrowserMenu();
        return;
    } else if (tool === 'serper') {
        const apiKey = agent.config.get('serperApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter Serper API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('serperApiKey', key);
    } else if (tool === 'brave') {
        const apiKey = agent.config.get('braveSearchApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter Brave Search API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('braveSearchApiKey', key);
    } else if (tool === 'searxng') {
        const currentUrl = agent.config.get('searxngUrl') || 'Not Set';
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: `Enter SearxNG Base URL (current: ${currentUrl}):` }
        ]);
        if (url) agent.config.set('searxngUrl', url);
    } else if (tool === 'searchOrder') {
        const currentOrder = agent.config.get('searchProviderOrder') || ['serper', 'brave', 'searxng', 'google', 'bing', 'duckduckgo'];
        const { order } = await inquirer.prompt([
            {
                type: 'input',
                name: 'order',
                message: `Enter provider order (comma-separated) (current: ${currentOrder.join(', ')}):`
            }
        ]);
        if (order) {
            const parsed = order.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (parsed.length > 0) agent.config.set('searchProviderOrder', parsed);
        }
    } else if (tool === 'captcha') {
        const apiKey = agent.config.get('captchaApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter CAPTCHA Solver API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('captchaApiKey', key);
    }

    console.log('Tooling configuration updated!');
    await waitKeyPress();
    return showToolingMenu();
}

async function showGatewayMenu() {
    console.clear();
    banner();
    const currentPort = agent.config.get('gatewayPort') || 3100;
    const currentHost = agent.config.get('gatewayHost') || '0.0.0.0';
    const apiKey = agent.config.get('gatewayApiKey');

    sectionHeader('🌐', 'Web Gateway');
    console.log('');
    const gatewayLines = [
        `${dim('Host')}       ${bold(String(currentHost))}`,
        `${dim('Port')}       ${brightCyan(bold(String(currentPort)))}`,
        `${dim('Endpoint')}   ${cyan(`http://${currentHost}:${currentPort}/api`)}`,
        `${dim('WebSocket')}  ${cyan(`ws://${currentHost}:${currentPort}`)}`,
        `${dim('Auth')}       ${apiKey ? green('● API Key set') : yellow('○ No authentication')}`,
    ];
    box(gatewayLines, { title: '📡 GATEWAY CONFIG', width: 52, color: c.cyan });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Gateway Options:'),
            choices: [
                { name: `  🚀 ${bold('Start Gateway Server')}`, value: 'start' },
                { name: `  🚀 ${bold('Start Gateway + Agent')}`, value: 'start_with_agent' },
                new inquirer.Separator(gradient('  ─── Settings ─────────────────────', [c.cyan, c.gray])),
                { name: `  📌 Set Port ${dim(`(current: ${currentPort})`)}`, value: 'port' },
                { name: `  🏠 Set Host ${dim(`(current: ${currentHost})`)}`, value: 'host' },
                { name: `  🔑 ${apiKey ? 'Update' : 'Set'} API Key`, value: 'apikey' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.cyan, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    if (action === 'start' || action === 'start_with_agent') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GatewayServer } = require('../gateway/GatewayServer');
        
        const gatewayConfig = {
            port: currentPort,
            host: currentHost,
            apiKey: apiKey
        };

        const gateway = new GatewayServer(agent, agent.config, gatewayConfig);
        
        console.log('\n🌐 Starting OrcBot Web Gateway...');
        await gateway.start();
        
        console.log(`\n📡 Gateway is ready!`);
        console.log(`   REST API: http://${currentHost}:${currentPort}/api`);
        console.log(`   WebSocket: ws://${currentHost}:${currentPort}`);
        if (apiKey) {
            console.log(`   Auth: API key required (X-Api-Key header)`);
        }
        console.log('\n   Press Ctrl+C to stop\n');

        if (action === 'start_with_agent') {
            console.log('🤖 Also starting agent loop...\n');
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        }

        // Keep running - don't return to menu
        await new Promise(() => {}); // Wait forever until Ctrl+C
    } else if (action === 'port') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter gateway port:', default: currentPort }
        ]);
        if (val) agent.config.set('gatewayPort', val);
    } else if (action === 'host') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter gateway host (0.0.0.0 for all interfaces):', default: currentHost }
        ]);
        if (val) agent.config.set('gatewayHost', val);
    } else if (action === 'apikey') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter API key (leave empty to disable auth):' }
        ]);
        agent.config.set('gatewayApiKey', val || undefined);
        console.log(val ? 'API key set!' : 'Authentication disabled.');
    }

    await waitKeyPress();
    return showGatewayMenu();
}

async function showModelsMenu() {
    console.clear();
    banner();
    sectionHeader('🤖', 'AI Models & Providers');

    const currentProvider = agent.config.get('llmProvider') || 'auto';
    const currentModel = agent.config.get('modelName') || '(default)';
    const hasOpenAI = !!agent.config.get('openaiApiKey');
    const hasGoogle = !!agent.config.get('googleApiKey');
    const hasOpenRouter = !!agent.config.get('openrouterApiKey');
    const hasNvidia = !!agent.config.get('nvidiaApiKey');
    const hasAnthropic = !!agent.config.get('anthropicApiKey');
    const hasBedrock = !!agent.config.get('bedrockAccessKeyId');

    console.log('');
    const modelLines = [
        `${dim('Provider')}  ${brightCyan(bold(currentProvider.toUpperCase()))}`,
        `${dim('Model')}     ${bold(currentModel)}`,
    ];
    box(modelLines, { title: '⭐ ACTIVE MODEL', width: 52, color: c.brightCyan });

    console.log('');
    const providerLines = [
        `${statusDot(hasOpenAI, '')}  ${bold('OpenAI')}       ${hasOpenAI ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasOpenRouter, '')}  ${bold('OpenRouter')}   ${hasOpenRouter ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasGoogle, '')}  ${bold('Google')}       ${hasGoogle ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasNvidia, '')}  ${bold('NVIDIA')}       ${hasNvidia ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasAnthropic, '')}  ${bold('Anthropic')}    ${hasAnthropic ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasBedrock, '')}  ${bold('AWS Bedrock')}  ${hasBedrock ? green('Keys set') : gray('Not configured')}`,
    ];
    box(providerLines, { title: '🏢 PROVIDERS', width: 52, color: c.green });
    console.log('');

    const { provider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: cyan('Select provider to configure:'),
            choices: [
                { name: `  ⭐ ${bold('Set Primary Provider')} ${dim(`(current: ${currentProvider})`)}`, value: 'set_primary' },
                new inquirer.Separator(gradient('  ─── Provider Config ──────────────', [c.green, c.gray])),
                { name: `  ${statusDot(hasOpenAI, '')} OpenAI ${dim('(GPT-4, etc.)')}`, value: 'openai' },
                { name: `  ${statusDot(hasOpenRouter, '')} OpenRouter ${dim('(multi-model gateway)')}`, value: 'openrouter' },
                { name: `  ${statusDot(hasGoogle, '')} Google ${dim('(Gemini Pro/Flash)')}`, value: 'google' },
                { name: `  ${statusDot(hasNvidia, '')} NVIDIA ${dim('(AI models)')}`, value: 'nvidia' },
                { name: `  ${statusDot(hasAnthropic, '')} Anthropic ${dim('(Claude)')}`, value: 'anthropic' },
                { name: `  ${statusDot(hasBedrock, '')} AWS Bedrock ${dim('(foundation models)')}`, value: 'bedrock' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.green, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (provider === 'back') return showMainMenu();

    if (provider === 'set_primary') {
        await showSetPrimaryProvider();
    } else if (provider === 'openai') {
        await showOpenAIConfig();
    } else if (provider === 'openrouter') {
        await showOpenRouterConfig();
    } else if (provider === 'google') {
        await showGeminiConfig();
    } else if (provider === 'nvidia') {
        await showNvidiaConfig();
    } else if (provider === 'anthropic') {
        await showAnthropicConfig();
    } else if (provider === 'bedrock') {
        await showBedrockConfig();
    }
}

async function showSetPrimaryProvider() {
    const currentProvider = agent.config.get('llmProvider');
    const hasOpenAI = !!agent.config.get('openaiApiKey');
    const hasGoogle = !!agent.config.get('googleApiKey');
    const hasOpenRouter = !!agent.config.get('openrouterApiKey');
    const hasNvidia = !!agent.config.get('nvidiaApiKey');
    const hasAnthropic = !!agent.config.get('anthropicApiKey');
    const hasBedrock = !!agent.config.get('bedrockAccessKeyId');
    
    const choices = [
        { 
            name: `Auto (infer from model name)${!currentProvider ? ' ✓' : ''}`, 
            value: 'auto' 
        },
        { 
            name: `OpenAI${hasOpenAI ? '' : ' (no key configured)'}${currentProvider === 'openai' ? ' ✓' : ''}`, 
            value: 'openai',
            disabled: !hasOpenAI
        },
        { 
            name: `Google Gemini${hasGoogle ? '' : ' (no key configured)'}${currentProvider === 'google' ? ' ✓' : ''}`, 
            value: 'google',
            disabled: !hasGoogle
        },
        { 
            name: `OpenRouter${hasOpenRouter ? '' : ' (no key configured)'}${currentProvider === 'openrouter' ? ' ✓' : ''}`, 
            value: 'openrouter',
            disabled: !hasOpenRouter
        },
        { 
            name: `NVIDIA${hasNvidia ? '' : ' (no key configured)'}${currentProvider === 'nvidia' ? ' ✓' : ''}`, 
            value: 'nvidia',
            disabled: !hasNvidia
        },
        { 
            name: `Anthropic (Claude)${hasAnthropic ? '' : ' (no key configured)'}${currentProvider === 'anthropic' ? ' ✓' : ''}`, 
            value: 'anthropic',
            disabled: !hasAnthropic
        },
        { 
            name: `AWS Bedrock${hasBedrock ? '' : ' (no credentials configured)'}${currentProvider === 'bedrock' ? ' ✓' : ''}`, 
            value: 'bedrock',
            disabled: !hasBedrock
        },
        { name: 'Back', value: 'back' }
    ];
    
    const { selected } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selected',
            message: 'Select Primary LLM Provider:',
            choices
        }
    ]);
    
    if (selected === 'back') return showModelsMenu();
    
    if (selected === 'auto') {
        agent.config.set('llmProvider', undefined);
        console.log('Primary provider set to AUTO (will infer from model name)');
    } else {
        agent.config.set('llmProvider', selected);
        console.log(`Primary provider set to: ${selected.toUpperCase()}`);
    }
    
    await waitKeyPress();
    return showModelsMenu();
}

async function showOpenRouterConfig() {
    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('openrouterApiKey') || 'Not Set';
    const baseUrl = agent.config.get('openrouterBaseUrl') || 'https://openrouter.ai/api/v1';
    const referer = agent.config.get('openrouterReferer') || 'Not Set';
    const appName = agent.config.get('openrouterAppName') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `OpenRouter Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: `Set Base URL (current: ${baseUrl})`, value: 'base' },
                { name: `Set Referer Header (current: ${referer})`, value: 'referer' },
                { name: `Set App Name Header (current: ${appName})`, value: 'app' },
                { name: 'Set Model Name (e.g., meta-llama/llama-3.3-70b-instruct:free)', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter API Key:' }]);
        agent.config.set('openrouterApiKey', val);
        // Don't auto-switch provider - user must explicitly set primary
    } else if (action === 'base') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Base URL:', default: baseUrl }]);
        agent.config.set('openrouterBaseUrl', val);
    } else if (action === 'referer') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Referer (optional):', default: referer === 'Not Set' ? '' : referer }]);
        agent.config.set('openrouterReferer', val);
    } else if (action === 'app') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter App Name (optional):', default: appName === 'Not Set' ? '' : appName }]);
        agent.config.set('openrouterAppName', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Model ID:', default: currentModel || 'meta-llama/llama-3.3-70b-instruct:free' }]);
        agent.config.set('modelName', val);
        // Provider will be inferred from model name if llmProvider not explicitly set
    }

    console.log('OpenRouter settings updated!');
    await waitKeyPress();
    return showOpenRouterConfig();
}

async function showOpenAIConfig() {
    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('openaiApiKey') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `OpenAI Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenAI API Key:' }]);
        agent.config.set('openaiApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Model (e.g., gpt-4o, gpt-3.5-turbo):', default: 'gpt-4o' }]);
        agent.config.set('modelName', val);
    }

    console.log('OpenAI settings updated!');
    await waitKeyPress();
    return showOpenAIConfig();
}

async function showGeminiConfig() {
    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('googleApiKey') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Google Gemini Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Google API Key:' }]);
        agent.config.set('googleApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Model (e.g., gemini-pro, gemini-1.5-flash):', default: 'gemini-pro' }]);
        agent.config.set('modelName', val);
    }

    console.log('Gemini settings updated!');
    await waitKeyPress();
    return showGeminiConfig();
}

async function showNvidiaConfig() {
    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('nvidiaApiKey') || 'Not Set';
    const displayKey = apiKey === 'Not Set' ? 'Not Set' : `${apiKey.substring(0, Math.min(8, apiKey.length))}...`;

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `NVIDIA Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${displayKey})`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter NVIDIA API Key:' }]);
        agent.config.set('nvidiaApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Model (e.g., nvidia:moonshotai/kimi-k2.5):', default: 'nvidia:moonshotai/kimi-k2.5' }]);
        agent.config.set('modelName', val);
    }

    console.log('NVIDIA settings updated!');
    await waitKeyPress();
    return showNvidiaConfig();
}

async function showAnthropicConfig() {
    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('anthropicApiKey') || 'Not Set';
    const displayKey = apiKey === 'Not Set' ? 'Not Set' : `${apiKey.substring(0, 12)}...`;

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Anthropic Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${displayKey})`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Anthropic API Key:' }]);
        agent.config.set('anthropicApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([
            {
                type: 'list',
                name: 'val',
                message: 'Select Claude Model:',
                choices: [
                    { name: 'Claude Opus 4.6   — Most intelligent (agents, complex coding)', value: 'claude-opus-4-6' },
                    { name: 'Claude Sonnet 4.5 — Best speed + intelligence balance', value: 'claude-sonnet-4-5' },
                    { name: 'Claude Haiku 4.5  — Fastest, near-frontier intelligence', value: 'claude-haiku-4-5' },
                    { name: 'Custom model ID...', value: 'custom' }
                ]
            }
        ]);
        if (val === 'custom') {
            const { custom } = await inquirer.prompt([{ type: 'input', name: 'custom', message: 'Enter Claude Model ID:', default: currentModel }]);
            agent.config.set('modelName', custom);
        } else {
            agent.config.set('modelName', val);
        }
    }

    console.log('Anthropic settings updated!');
    await waitKeyPress();
    return showAnthropicConfig();
}

async function showBedrockConfig() {
    const currentModel = agent.config.get('modelName');
    const region = agent.config.get('bedrockRegion') || 'Not Set';
    const accessKey = agent.config.get('bedrockAccessKeyId') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `AWS Bedrock Settings (Model: ${currentModel}):`,
            choices: [
                { name: `Set Region (current: ${region})`, value: 'region' },
                { name: accessKey === 'Not Set' ? 'Set Access Keys' : 'Update Access Keys', value: 'keys' },
                { name: 'Set Model Name (e.g., bedrock/anthropic.claude-3-sonnet-20240229-v1:0)', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();

    if (action === 'region') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter AWS Region for Bedrock (e.g., us-east-1):' }]);
        agent.config.set('bedrockRegion', val);
    } else if (action === 'keys') {
        const answers = await inquirer.prompt([
            { type: 'input', name: 'accessKeyId', message: 'Access Key ID:', mask: '*' },
            { type: 'input', name: 'secretAccessKey', message: 'Secret Access Key:', mask: '*' },
            { type: 'input', name: 'sessionToken', message: 'Session Token (optional):', mask: '*' }
        ]);
        if (answers.accessKeyId) agent.config.set('bedrockAccessKeyId', answers.accessKeyId);
        if (answers.secretAccessKey) agent.config.set('bedrockSecretAccessKey', answers.secretAccessKey);
        if (answers.sessionToken) agent.config.set('bedrockSessionToken', answers.sessionToken);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Bedrock Model ID:', default: currentModel || 'bedrock/anthropic.claude-3-sonnet-20240229-v1:0' }]);
        agent.config.set('modelName', val);
    }

    console.log('Bedrock settings updated!');
    await waitKeyPress();
    return showBedrockConfig();
}

async function showPushTaskMenu() {
    console.clear();
    banner();
    sectionHeader('📝', 'Push Task');
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

async function showConnectionsMenu() {
    console.clear();
    banner();
    sectionHeader('🔌', 'Connections');

    const hasTelegram = !!agent.config.get('telegramToken');
    const hasWhatsapp = !!agent.config.get('whatsappEnabled');
    const hasDiscord = !!agent.config.get('discordToken');
    const tgAuto = agent.config.get('telegramAutoReplyEnabled');
    const waAuto = agent.config.get('whatsappAutoReplyEnabled');
    const dcAuto = agent.config.get('discordAutoReplyEnabled');

    console.log('');
    const channelLines = [
        `${statusDot(hasTelegram, '')} ${bold('Telegram')}    ${hasTelegram ? green('Connected') : gray('Not configured')}  ${tgAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasWhatsapp, '')} ${bold('WhatsApp')}    ${hasWhatsapp ? green('Enabled') : gray('Disabled')}        ${waAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasDiscord, '')} ${bold('Discord')}     ${hasDiscord ? green('Connected') : gray('Not configured')}  ${dcAuto ? dim('auto-reply ✓') : ''}`,
    ];
    box(channelLines, { title: '📡 CHANNEL STATUS', width: 58, color: c.cyan });
    console.log('');

    const { channel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'channel',
            message: cyan('Select channel to configure:'),
            choices: [
                { name: `  ${hasTelegram ? '✈️ ' : '  '}${bold('Telegram Bot')}      ${hasTelegram ? green('●') : gray('○')}`, value: 'telegram' },
                { name: `  ${hasWhatsapp ? '💬' : '  '} ${bold('WhatsApp (Baileys)')} ${hasWhatsapp ? green('●') : gray('○')}`, value: 'whatsapp' },
                { name: `  ${hasDiscord ? '🎮' : '  '} ${bold('Discord Bot')}       ${hasDiscord ? green('●') : gray('○')}`, value: 'discord' },
                new inquirer.Separator(gradient('  ─────────────────────────────────', [c.cyan, c.gray])),
                { name: dim('  ← Back'), value: 'back' },
            ]
        }
    ]);

    if (channel === 'back') return showMainMenu();

    if (channel === 'telegram') {
        await showTelegramConfig();
    } else if (channel === 'whatsapp') {
        await showWhatsAppConfig();
    } else if (channel === 'discord') {
        await showDiscordConfig();
    }
}

async function showTelegramConfig() {
    const currentToken = agent.config.get('telegramToken') || 'Not Set';
    const autoReply = agent.config.get('telegramAutoReplyEnabled');
    console.clear();
    banner();
    sectionHeader('✈️', 'Telegram Settings');
    console.log('');
    const tgLines = [
        `${dim('Token')}       ${currentToken === 'Not Set' ? gray('Not Set') : green(currentToken.substring(0, 12) + '…')}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
    ];
    box(tgLines, { title: '✈️  TELEGRAM', width: 46, color: c.cyan });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Telegram Options:',
            choices: [
                { name: 'Set Token', value: 'set' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu();

    if (action === 'set') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Telegram Bot Token:' }
        ]);
        agent.config.set('telegramToken', token);
        console.log('Token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showTelegramConfig();
    } else if (action === 'toggle_auto') {
        agent.config.set('telegramAutoReplyEnabled', !autoReply);
        return showTelegramConfig();
    }
}

async function showWhatsAppConfig() {
    const enabled = agent.config.get('whatsappEnabled');
    const autoReply = agent.config.get('whatsappAutoReplyEnabled');
    const statusReply = agent.config.get('whatsappStatusReplyEnabled');
    const autoReact = agent.config.get('whatsappAutoReactEnabled');
    const contextProfiling = agent.config.get('whatsappContextProfilingEnabled');
    const ownerJid = agent.config.get('whatsappOwnerJID') || 'Not Linked';

    console.clear();
    banner();
    sectionHeader('💬', 'WhatsApp Settings');
    console.log('');
    const onOff = (v: any) => v ? green(bold('● ON')) : gray('○ OFF');
    const waLines = [
        `${dim('Status')}            ${enabled ? green(bold('ENABLED')) : red(bold('DISABLED'))}`,
        `${dim('Linked Account')}    ${ownerJid === 'Not Linked' ? gray(ownerJid) : cyan(ownerJid)}`,
        ``,
        `${dim('Auto-Reply (1‑on‑1)')}  ${onOff(autoReply)}`,
        `${dim('Status Interactions')}  ${onOff(statusReply)}`,
        `${dim('Auto-React (Emojis)')}  ${onOff(autoReact)}`,
        `${dim('Context Profiling')}    ${onOff(contextProfiling)}`,
    ];
    box(waLines, { title: '💬 WHATSAPP', width: 48, color: c.green });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'WhatsApp Options:',
            choices: [
                { name: enabled ? 'Disable WhatsApp' : 'Enable WhatsApp', value: 'toggle_enabled' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: statusReply ? 'Disable Status Interactions' : 'Enable Status Interactions', value: 'toggle_status' },
                { name: autoReact ? 'Disable Auto-React' : 'Enable Auto-React', value: 'toggle_react' },
                { name: contextProfiling ? 'Disable Context Profiling' : 'Enable Context Profiling', value: 'toggle_profile' },
                { name: 'Link Account / Show QR', value: 'link' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu();

    switch (action) {
        case 'toggle_enabled':
            agent.config.set('whatsappEnabled', !enabled);
            break;
        case 'toggle_auto':
            agent.config.set('whatsappAutoReplyEnabled', !autoReply);
            break;
        case 'toggle_status':
            agent.config.set('whatsappStatusReplyEnabled', !statusReply);
            break;
        case 'toggle_react':
            agent.config.set('whatsappAutoReactEnabled', !autoReact);
            break;
        case 'toggle_profile':
            agent.config.set('whatsappContextProfilingEnabled', !contextProfiling);
            break;
        case 'link':
            if (!agent.whatsapp) {
                console.log('\nEnabling WhatsApp channel...');
                agent.config.set('whatsappEnabled', true);
                agent.setupChannels();
            }

            console.log('\nStarting WhatsApp pairing process...');

            // Listener for QR events
            const qrListener = (qr: string) => {
                console.clear();
                console.log('🤖 OrcBot WhatsApp Pairing');
                console.log('-------------------------------------------');
                console.log('Scan this QR code with your WhatsApp app:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Tap Menu or Settings and select Linked Devices');
                console.log('3. Tap on "Link a Device"');
                console.log('-------------------------------------------');
                qrcode.generate(qr, { small: true });
                console.log('-------------------------------------------');
                console.log('Waiting for scan...');
            };

            eventBus.on('whatsapp:qr', qrListener);

            // Start/Restart pairing
            await agent.whatsapp.start();

            // Wait for connected status
            await new Promise<void>((resolve) => {
                const statusListener = (status: string) => {
                    if (status === 'connected') {
                        eventBus.off('whatsapp:qr', qrListener);
                        eventBus.off('whatsapp:status', statusListener);
                        resolve();
                    }
                };
                eventBus.on('whatsapp:status', statusListener);
            });

            console.log('\n✅ WhatsApp Linked Successfully!');
            await waitKeyPress();
            break;
    }

    console.log('WhatsApp settings updated!');
    await waitKeyPress();
    return showWhatsAppConfig();
}

async function showDiscordConfig() {
    const currentToken = agent.config.get('discordToken') || 'Not Set';
    const autoReply = agent.config.get('discordAutoReplyEnabled');
    console.clear();
    banner();
    sectionHeader('🎮', 'Discord Settings');
    console.log('');
    const dcLines = [
        `${dim('Token')}       ${currentToken === 'Not Set' ? gray('Not Set') : green('***' + currentToken.slice(-8))}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
    ];
    box(dcLines, { title: '🎮 DISCORD', width: 46, color: c.magenta });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Discord Options:',
            choices: [
                { name: 'Set Bot Token', value: 'set' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: 'Test Connection', value: 'test' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu();

    if (action === 'set') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Discord Bot Token:' }
        ]);
        agent.config.set('discordToken', token);
        console.log('Token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showDiscordConfig();
    } else if (action === 'toggle_auto') {
        agent.config.set('discordAutoReplyEnabled', !autoReply);
        return showDiscordConfig();
    } else if (action === 'test') {
        if (!agent.discord) {
            console.log('Discord channel not initialized. Please set a token and restart.');
        } else {
            console.log('Testing Discord connection...');
            try {
                const guilds = await agent.discord.getGuilds();
                console.log(`Connected! Bot is in ${guilds.length} server(s):`);
                guilds.forEach(g => console.log(`  - ${g.name} (${g.id})`));
            } catch (error: any) {
                console.log(`Connection test failed: ${error.message}`);
            }
        }
        await waitKeyPress();
        return showDiscordConfig();
    }
}

async function showWorkerProfileMenu() {
    console.clear();
    banner();
    sectionHeader('🪪', 'Worker Profile');

    if (!workerProfile.exists()) {
        console.log('');
        box([
            `${dim('No worker profile exists yet.')}`,
            `${dim('A profile gives your agent a digital identity.')}`,
        ], { title: '🪪 IDENTITY', width: 48, color: c.gray });
        console.log('');

        const { create } = await inquirer.prompt([
            { type: 'confirm', name: 'create', message: 'Would you like to create a worker profile?', default: true }
        ]);

        if (!create) return showMainMenu();

        const { handle, displayName } = await inquirer.prompt([
            { type: 'input', name: 'handle', message: 'Enter a unique handle (username):', validate: (v: string) => v.trim().length > 0 || 'Handle is required' },
            { type: 'input', name: 'displayName', message: 'Enter display name:', validate: (v: string) => v.trim().length > 0 || 'Display name is required' }
        ]);

        workerProfile.create(handle.trim(), displayName.trim());
        console.log('\n✅ Worker profile created!');
        await waitKeyPress();
        return showWorkerProfileMenu();
    }

    // Show current profile in a box
    const profile = workerProfile.get()!;
    console.log('');
    const profileLines = [
        `${dim('Handle')}    ${brightCyan(bold('@' + profile.handle))}`,
        `${dim('Name')}      ${bold(profile.displayName)}`,
        `${dim('Bio')}       ${profile.bio || gray('(not set)')}`,
        `${dim('Email')}     ${profile.email || gray('(not set)')}`,
        `${dim('Password')}  ${profile.password ? green('● Set') : gray('○ Not set')}`,
        `${dim('Avatar')}    ${profile.avatarUrl || gray('(not set)')}`,
        `${dim('Websites')}  ${profile.websites.length > 0 ? cyan(String(profile.websites.length) + ' linked') : gray('(none)')}`,
    ];
    box(profileLines, { title: '🪪 DIGITAL IDENTITY', width: 52, color: c.brightCyan });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Profile Options:'),
            choices: [
                { name: `  ✏️  ${bold('Edit Basic Info')} ${dim('(Handle, Name, Bio)')}`, value: 'edit_basic' },
                { name: `  📧 ${profile.email ? 'Update' : 'Set'} ${bold('Email Address')}`, value: 'email' },
                { name: `  🔑 ${profile.password ? 'Update' : 'Set'} ${bold('Password')}`, value: 'password' },
                { name: `  🌐 ${bold('Manage Linked Websites')} ${dim(`(${profile.websites.length})`)}`, value: 'websites' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.red, c.gray])),
                { name: `  🗑️  ${red('Delete Worker Profile')}`, value: 'delete' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'edit_basic': {
            const answers = await inquirer.prompt([
                { type: 'input', name: 'handle', message: `Handle (current: ${profile.handle}):`, default: profile.handle },
                { type: 'input', name: 'displayName', message: `Display Name (current: ${profile.displayName}):`, default: profile.displayName },
                { type: 'input', name: 'bio', message: `Bio (current: ${profile.bio || '(empty)'}):`, default: profile.bio || '' },
                { type: 'input', name: 'avatarUrl', message: `Avatar URL (current: ${profile.avatarUrl || '(empty)'}):`, default: profile.avatarUrl || '' }
            ]);
            workerProfile.update({
                handle: answers.handle.trim() || profile.handle,
                displayName: answers.displayName.trim() || profile.displayName,
                bio: answers.bio.trim() || undefined,
                avatarUrl: answers.avatarUrl.trim() || undefined
            });
            console.log('✅ Profile updated!');
            break;
        }
        case 'email': {
            const { email } = await inquirer.prompt([
                { type: 'input', name: 'email', message: 'Enter email address:', validate: (v: string) => v.includes('@') || 'Enter a valid email' }
            ]);
            workerProfile.setEmail(email.trim());
            console.log('✅ Email updated!');
            break;
        }
        case 'password': {
            const { password, confirm } = await inquirer.prompt([
                { type: 'password', name: 'password', message: 'Enter password:', mask: '*' },
                { type: 'password', name: 'confirm', message: 'Confirm password:', mask: '*' }
            ]);
            if (password !== confirm) {
                console.log('❌ Passwords do not match.');
            } else if (password.length < 1) {
                console.log('❌ Password cannot be empty.');
            } else {
                workerProfile.setPassword(password);
                console.log('✅ Password set (encrypted locally).');
            }
            break;
        }
        case 'websites':
            await showWorkerWebsitesMenu();
            return; // showWorkerWebsitesMenu handles returning
        case 'delete': {
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: '⚠️ Are you sure you want to DELETE your worker profile? This cannot be undone.', default: false }
            ]);
            if (confirm) {
                workerProfile.delete();
                console.log('Worker profile deleted.');
            }
            break;
        }
    }

    await waitKeyPress();
    return showWorkerProfileMenu();
}

async function showWorkerWebsitesMenu() {
    const profile = workerProfile.get();
    if (!profile) return showWorkerProfileMenu();

    console.clear();
    banner();
    sectionHeader('🌐', 'Linked Websites');

    console.log('');
    if (profile.websites.length === 0) {
        box([dim('No websites linked yet.')], { title: '🌐 WEBSITES', width: 46, color: c.gray });
    } else {
        const siteLines = profile.websites.map((w, i) =>
            `${cyan(bold(String(i + 1)))}. ${bold(w.name)} ${dim('→')} ${w.url}${w.username ? dim(` (${w.username})`) : ''}`
        );
        box(siteLines, { title: `🌐 WEBSITES (${profile.websites.length})`, width: 56, color: c.cyan });
    }
    console.log('');

    const choices: { name: string; value: string }[] = [
        { name: '➕ Add Website', value: 'add' }
    ];

    if (profile.websites.length > 0) {
        choices.push({ name: '➖ Remove Website', value: 'remove' });
    }

    choices.push({ name: 'Back', value: 'back' });

    const { action } = await inquirer.prompt([
        { type: 'list', name: 'action', message: 'Website Options:', choices }
    ]);

    if (action === 'back') return showWorkerProfileMenu();

    if (action === 'add') {
        const { name, url, username } = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Website name (e.g., GitHub, LinkedIn):', validate: (v: string) => v.trim().length > 0 || 'Name required' },
            { type: 'input', name: 'url', message: 'Profile URL:', validate: (v: string) => v.startsWith('http') || 'Enter a valid URL' },
            { type: 'input', name: 'username', message: 'Username on this site (optional):' }
        ]);
        workerProfile.addWebsite(name.trim(), url.trim(), username.trim() || undefined);
        console.log('✅ Website added!');
    } else if (action === 'remove') {
        const { name } = await inquirer.prompt([
            {
                type: 'list',
                name: 'name',
                message: 'Select website to remove:',
                choices: profile.websites.map(w => ({ name: `${w.name} (${w.url})`, value: w.name }))
            }
        ]);
        workerProfile.removeWebsite(name);
        console.log('✅ Website removed!');
    }

    await waitKeyPress();
    return showWorkerWebsitesMenu();
}

async function showOrchestrationMenu() {
    console.clear();
    banner();
    sectionHeader('🐙', 'Multi-Agent Orchestration');

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
    box(orchLines, { title: '📊 ORCHESTRATION STATUS', width: 46, color: c.magenta });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Orchestration Options:'),
            choices: [
                new inquirer.Separator(gradient('  ─── Monitor ──────────────────────', [c.magenta, c.gray])),
                { name: `  📊 ${bold('View Detailed Status')}`, value: 'status' },
                { name: `  🤖 ${bold('List Active Agents')}`, value: 'list' },
                { name: `  ⚡ ${bold('View Running Processes')}`, value: 'processes' },
                { name: `  🔍 ${bold('View Worker Task Details')}`, value: 'worker_details' },
                new inquirer.Separator(gradient('  ─── Manage ───────────────────────', [c.cyan, c.gray])),
                { name: `  ➕ ${bold('Spawn New Agent')}`, value: 'spawn' },
                { name: `  ▶️  ${bold('Start Worker Process')}`, value: 'start_worker' },
                { name: `  ⏹️  ${bold('Stop Worker Process')}`, value: 'stop_worker' },
                new inquirer.Separator(gradient('  ─── Tasks ────────────────────────', [c.yellow, c.gray])),
                { name: `  📋 ${bold('Delegate Task to Agent')}`, value: 'delegate' },
                { name: `  🔀 ${bold('Distribute Tasks to All')}`, value: 'distribute' },
                { name: `  💬 ${bold('Broadcast Message')}`, value: 'broadcast' },
                new inquirer.Separator(gradient('  ─── Cleanup ──────────────────────', [c.red, c.gray])),
                { name: `  🗑️  ${bold('Terminate Agent')}`, value: 'terminate' },
                { name: `  🧹 ${bold('Terminate All Agents')}`, value: 'terminate_all' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ],
            pageSize: 20
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'status': {
            console.clear();
            console.log('📊 Orchestration Status');
            console.log('=======================');
            console.log(JSON.stringify(status, null, 2));
            console.log('\n🔄 Running Worker Processes:');
            if (runningWorkers.length === 0) {
                console.log('  No worker processes running.');
            } else {
                runningWorkers.forEach(w => {
                    console.log(`  - ${w.name} (${w.agentId}) - PID: ${w.pid}`);
                });
            }
            break;
        }
        case 'worker_details': {
            console.clear();
            console.log('🔍 Worker Task Details');
            console.log('======================');
            if (detailedWorkers.length === 0) {
                console.log('No workers available.');
            } else {
                detailedWorkers.forEach(w => {
                    console.log(`\n[${w.agentId.slice(0, 12)}...] ${w.name}`);
                    console.log(`  Status: ${w.status} | Running: ${w.isRunning ? '✅ Yes' : '❌ No'}${w.pid ? ` (PID: ${w.pid})` : ''}`);
                    console.log(`  Role: ${w.role}`);
                    console.log(`  Last Active: ${new Date(w.lastActiveAt).toLocaleString()}`);
                    if (w.currentTaskId) {
                        console.log(`  Current Task ID: ${w.currentTaskId}`);
                        console.log(`  Task Description: ${w.currentTaskDescription || '(no description)'}`);
                    } else {
                        console.log(`  Current Task: (none)`);
                    }
                });
            }
            break;
        }
        case 'list': {
            console.clear();
            console.log('🤖 Active Agents');
            console.log('================');
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('No agents currently spawned.');
            } else {
                agents.forEach(a => {
                    const isRunning = orchestrator.isWorkerRunning(a.id);
                    const agentData = orchestrator.getAgent(a.id);
                    console.log(`\n[${a.id}] ${a.name}`);
                    console.log(`  Status: ${a.status}`);
                    console.log(`  Worker: ${isRunning ? `✅ Running (PID: ${agentData?.pid})` : '⏸️ Not running'}`);
                    console.log(`  Created: ${new Date(a.createdAt).toLocaleString()}`);
                    console.log(`  Capabilities: ${a.capabilities?.join(', ') || 'none'}`);
                    console.log(`  Active Tasks: ${a.activeTasks}`);
                });
            }
            break;
        }
        case 'processes': {
            console.clear();
            console.log('⚡ Running Worker Processes');
            console.log('===========================');
            if (runningWorkers.length === 0) {
                console.log('No worker processes currently running.');
            } else {
                runningWorkers.forEach(w => {
                    console.log(`\n[PID ${w.pid}] ${w.name}`);
                    console.log(`  Agent ID: ${w.agentId}`);
                });
            }
            break;
        }
        case 'start_worker': {
            const agents = orchestrator.listAgents().filter(a => !orchestrator.isWorkerRunning(a.id));
            if (agents.length === 0) {
                console.log('\n❌ No stopped agents available. All agents are either running or spawn a new one.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent to start:',
                    choices: agents.map(a => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                }
            ]);

            const agentData = orchestrator.getAgent(agentId);
            if (agentData) {
                const success = orchestrator.startWorkerProcess(agentData);
                console.log(success ? '\n✅ Worker process started.' : '\n❌ Failed to start worker process.');
            }
            break;
        }
        case 'stop_worker': {
            if (runningWorkers.length === 0) {
                console.log('\n❌ No worker processes running.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select worker to stop:',
                    choices: runningWorkers.map(w => ({ name: `${w.name} (PID: ${w.pid})`, value: w.agentId }))
                }
            ]);

            const success = orchestrator.stopWorkerProcess(agentId);
            console.log(success ? '\n✅ Stop signal sent to worker.' : '\n❌ Failed to stop worker.');
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
            console.log(`\n✅ Agent spawned: ${newAgent.id} (${newAgent.name})`);
            break;
        }
        case 'delegate': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\n❌ No agents available. Spawn an agent first.');
                break;
            }

            const { agentId, taskDescription, priority } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent:',
                    choices: agents.map(a => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                },
                { type: 'input', name: 'taskDescription', message: 'Task description:', validate: (v: string) => v.trim().length > 0 || 'Task required' },
                { type: 'number', name: 'priority', message: 'Priority (1-10, higher = more urgent):', default: 5 }
            ]);

            try {
                const task = orchestrator.delegateTask(agentId, taskDescription.trim(), Math.max(1, Math.min(10, priority)));
                console.log(`\n✅ Task delegated: ${task.id}`);
            } catch (err: any) {
                console.log(`\n❌ Error: ${err.message}`);
            }
            break;
        }
        case 'distribute': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\n❌ No agents available. Spawn agents first.');
                break;
            }

            const { tasks } = await inquirer.prompt([
                { type: 'input', name: 'tasks', message: 'Enter tasks (semicolon-separated):' }
            ]);

            const taskList = tasks.split(';').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
            if (taskList.length === 0) {
                console.log('\n❌ No valid tasks provided.');
                break;
            }

            const results = orchestrator.distributeTaskList(taskList);
            console.log(`\n✅ Distributed ${results.length} tasks:`);
            results.forEach((t: any) => {
                const agentName = agents.find(a => a.id === t.assignedAgentId)?.name || t.assignedAgentId || 'unassigned';
                console.log(`  - "${t.description.slice(0, 40)}..." → ${agentName}`);
            });
            break;
        }
        case 'broadcast': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\n❌ No agents to broadcast to.');
                break;
            }

            const { message } = await inquirer.prompt([
                { type: 'input', name: 'message', message: 'Message to broadcast:', validate: (v: string) => v.trim().length > 0 || 'Message required' }
            ]);

            orchestrator.broadcast('main-agent', message.trim());
            console.log(`\n✅ Message broadcast to ${agents.length} agents.`);
            break;
        }
        case 'terminate': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\n❌ No agents to terminate.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent to terminate:',
                    choices: agents.map(a => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
                }
            ]);

            const success = orchestrator.terminateAgent(agentId);
            console.log(success ? '\n✅ Agent terminated.' : '\n❌ Failed to terminate agent.');
            break;
        }
        case 'terminate_all': {
            const agents = orchestrator.listAgents();
            if (agents.length === 0) {
                console.log('\n❌ No agents to terminate.');
                break;
            }

            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: `⚠️ Terminate all ${agents.length} agents?`, default: false }
            ]);

            if (confirm) {
                let terminated = 0;
                agents.forEach(a => {
                    if (orchestrator.terminateAgent(a.id)) terminated++;
                });
                console.log(`\n✅ Terminated ${terminated} agents.`);
            }
            break;
        }
    }

    await waitKeyPress();
    return showOrchestrationMenu();
}

async function showSecurityMenu() {
    console.clear();
    banner();
    sectionHeader('🔐', 'Security & Permissions');

    const safeMode = agent.config.get('safeMode');
    const sudoMode = agent.config.get('sudoMode');
    const allowList = (agent.config.get('commandAllowList') || []) as string[];
    const denyList = (agent.config.get('commandDenyList') || []) as string[];

    console.log('');
    const safeBadge = safeMode ? red(bold('🔒 LOCKED')) : green(bold('🔓 OPEN'));
    const sudoBadge = sudoMode ? yellow(bold('⚠️  ENABLED')) : green(bold('✅ OFF'));
    const secLines = [
        `${dim('Safe Mode')}    ${safeBadge}     ${dim(safeMode ? 'commands disabled' : 'commands allowed')}`,
        `${dim('Sudo Mode')}    ${sudoBadge}  ${dim(sudoMode ? 'all commands allowed' : 'allowList enforced')}`,
        ``,
        `${dim('Allow List')}   ${cyan(bold(String(allowList.length)))} commands  ${dim(allowList.length > 0 ? allowList.slice(0, 5).join(', ') + (allowList.length > 5 ? '…' : '') : '(empty)')}`,
        `${dim('Block List')}   ${cyan(bold(String(denyList.length)))} commands  ${dim(denyList.length > 0 ? denyList.slice(0, 5).join(', ') + (denyList.length > 5 ? '…' : '') : '(empty)')}`,
    ];
    box(secLines, { title: '🛡️  SECURITY STATUS', width: 58, color: safeMode ? c.red : (sudoMode ? c.yellow : c.green) });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Security Options:'),
            choices: [
                new inquirer.Separator(gradient('  ─── Mode Toggles ─────────────────', [c.red, c.gray])),
                { name: safeMode ? `  🔓 ${bold('Disable Safe Mode')} ${dim('(allow commands)')}` : `  🔒 ${bold('Enable Safe Mode')} ${dim('(block all commands)')}`, value: 'toggle_safe' },
                { name: sudoMode ? `  ✅ ${bold('Disable Sudo Mode')} ${dim('(enforce allowList)')}` : `  ⚠️  ${bold('Enable Sudo Mode')} ${dim('(allow ALL commands)')}`, value: 'toggle_sudo' },
                new inquirer.Separator(gradient('  ─── Allow List ───────────────────', [c.green, c.gray])),
                { name: `  ➕ Add Command to Allow List`, value: 'add_allow' },
                { name: `  ➖ Remove Command from Allow List`, value: 'remove_allow' },
                { name: `  📋 View Full Allow List ${dim(`(${allowList.length})`)}`, value: 'view_allow' },
                new inquirer.Separator(gradient('  ─── Block List ───────────────────', [c.red, c.gray])),
                { name: `  ➕ Add Command to Block List`, value: 'add_deny' },
                { name: `  ➖ Remove Command from Block List`, value: 'remove_deny' },
                { name: `  📋 View Full Block List ${dim(`(${denyList.length})`)}`, value: 'view_deny' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'toggle_safe':
            agent.config.set('safeMode', !safeMode);
            console.log(safeMode ? '\n🔓 Safe Mode disabled. Agent can now run commands.' : '\n🔒 Safe Mode enabled. All commands are blocked.');
            break;
        case 'toggle_sudo':
            if (!sudoMode) {
                const { confirm } = await inquirer.prompt([
                    { type: 'confirm', name: 'confirm', message: '⚠️ Sudo Mode allows the agent to run ANY command (including rm, format, etc). Are you sure?', default: false }
                ]);
                if (confirm) {
                    agent.config.set('sudoMode', true);
                    console.log('\n⚠️ Sudo Mode enabled. Agent can run any command.');
                }
            } else {
                agent.config.set('sudoMode', false);
                console.log('\n✅ Sudo Mode disabled. AllowList is now enforced.');
            }
            break;
        case 'add_allow': {
            const { cmd } = await inquirer.prompt([
                { type: 'input', name: 'cmd', message: 'Enter command to allow (e.g., apt, docker):' }
            ]);
            if (cmd.trim()) {
                const newList = [...allowList, cmd.trim().toLowerCase()];
                agent.config.set('commandAllowList', [...new Set(newList)]);
                console.log(`\n✅ '${cmd.trim()}' added to allow list.`);
            }
            break;
        }
        case 'remove_allow': {
            if (allowList.length === 0) {
                console.log('\nAllow list is empty.');
                break;
            }
            const { cmd } = await inquirer.prompt([
                { type: 'list', name: 'cmd', message: 'Select command to remove:', choices: allowList }
            ]);
            agent.config.set('commandAllowList', allowList.filter(c => c !== cmd));
            console.log(`\n✅ '${cmd}' removed from allow list.`);
            break;
        }
        case 'add_deny': {
            const { cmd } = await inquirer.prompt([
                { type: 'input', name: 'cmd', message: 'Enter command to block (e.g., rm, reboot):' }
            ]);
            if (cmd.trim()) {
                const newList = [...denyList, cmd.trim().toLowerCase()];
                agent.config.set('commandDenyList', [...new Set(newList)]);
                console.log(`\n✅ '${cmd.trim()}' added to block list.`);
            }
            break;
        }
        case 'remove_deny': {
            if (denyList.length === 0) {
                console.log('\nBlock list is empty.');
                break;
            }
            const { cmd } = await inquirer.prompt([
                { type: 'list', name: 'cmd', message: 'Select command to unblock:', choices: denyList }
            ]);
            agent.config.set('commandDenyList', denyList.filter(c => c !== cmd));
            console.log(`\n✅ '${cmd}' removed from block list.`);
            break;
        }
        case 'view_allow':
            console.log('\n📋 Full Allow List:');
            console.log(allowList.length > 0 ? allowList.join(', ') : '(empty)');
            break;
        case 'view_deny':
            console.log('\n📋 Full Block List:');
            console.log(denyList.length > 0 ? denyList.join(', ') : '(empty)');
            break;
    }

    await waitKeyPress();
    return showSecurityMenu();
}

async function showConfigMenu() {
    console.clear();
    banner();
    sectionHeader('⚙️', 'Agent Configuration');
    console.log('');

    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = ['agentName', 'llmProvider', 'modelName', 'openaiApiKey', 'anthropicApiKey', 'openrouterApiKey', 'openrouterBaseUrl', 'openrouterReferer', 'openrouterAppName', 'googleApiKey', 'nvidiaApiKey', 'serperApiKey', 'braveSearchApiKey', 'searxngUrl', 'searchProviderOrder', 'captchaApiKey', 'autonomyInterval', 'telegramToken', 'whatsappEnabled', 'whatsappAutoReplyEnabled', 'progressFeedbackEnabled', 'memoryContextLimit', 'memoryEpisodicLimit', 'memoryConsolidationThreshold', 'memoryConsolidationBatch', 'maxStepsPerAction', 'maxMessagesPerAction', 'memoryPath', 'commandAllowList', 'commandDenyList', 'safeMode', 'sudoMode', 'pluginAllowList', 'pluginDenyList', 'browserProfileDir', 'browserProfileName'] as const;

    const choices: { name: string, value: string }[] = keys.map(key => ({
        name: `${key}: ${config[key as keyof typeof config] || '(empty)'}`,
        value: key
    }));
    choices.push({ name: '🔥 Reset Agent (Fresh Start)', value: 'reset' });
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

    if (key === 'searchProviderOrder' || key === 'commandAllowList' || key === 'commandDenyList' || key === 'pluginAllowList' || key === 'pluginDenyList') {
        const parsed = (value || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        agent.config.set(key as any, parsed);
    } else if (key === 'safeMode' || key === 'sudoMode' || key === 'progressFeedbackEnabled') {
        const normalized = String(value).trim().toLowerCase();
        agent.config.set(key as any, normalized === 'true' || normalized === '1' || normalized === 'yes');
    } else if (key === 'memoryContextLimit' || key === 'memoryEpisodicLimit' || key === 'memoryConsolidationThreshold' || key === 'memoryConsolidationBatch' || key === 'maxStepsPerAction' || key === 'maxMessagesPerAction' || key === 'autonomyInterval') {
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

async function showSkillsMenu() {
    console.clear();
    banner();
    sectionHeader('🧩', 'Skills Manager');

    const skills = agent.skills.getAllSkills();
    const agentSkills = agent.skills.getAgentSkills();
    const pluginSkills = skills.filter(s => s.pluginPath);
    const coreSkills = skills.filter(s => !s.pluginPath);

    // Summary box
    const activeCount = agentSkills.filter(s => s.activated).length;
    console.log('');
    const summaryLines = [
        `${dim('Agent Skills')}   ${brightCyan(bold(String(agentSkills.length)))} installed  ${green(bold(String(activeCount)))} active`,
        `${dim('Plugins')}        ${cyan(bold(String(pluginSkills.length)))} loaded`,
        `${dim('Core Built-in')}  ${gray(bold(String(coreSkills.length)))} available`,
    ];
    box(summaryLines, { title: '📦 SKILL INVENTORY', width: 52, color: c.magenta });
    console.log('');

    const choices: any[] = [];

    // Section: Agent Skills (SKILL.md format)
    if (agentSkills.length > 0) {
        choices.push(new inquirer.Separator(gradient('  ─── Agent Skills (SKILL.md) ──────', [c.brightCyan, c.gray])));
        for (const s of agentSkills) {
            const badge = s.activated ? green('● ') : gray('○ ');
            choices.push({
                name: `  ${badge}${bold(s.meta.name)} ${dim('— ' + s.meta.description.slice(0, 50) + (s.meta.description.length > 50 ? '…' : ''))}`,
                value: `agent:${s.meta.name}`
            });
        }
    }

    // Section: Plugin Skills
    if (pluginSkills.length > 0) {
        choices.push(new inquirer.Separator(gradient('  ─── Plugins (.ts/.js) ────────────', [c.yellow, c.gray])));
        for (const s of pluginSkills) {
            choices.push({
                name: `  🔌 ${bold(s.name)} ${dim('— ' + s.description.slice(0, 50) + (s.description.length > 50 ? '…' : ''))}`,
                value: `plugin:${s.name}`
            });
        }
    }

    // Section: Core Skills
    choices.push(new inquirer.Separator(gradient(`  ─── Core Skills (${coreSkills.length}) ─────────────`, [c.gray, c.gray])));
    choices.push({ name: `  📋 ${bold('Show all ' + coreSkills.length + ' core skills')}`, value: 'list_core' });

    // Actions
    choices.push(new inquirer.Separator(gradient('  ─── Actions ──────────────────────', [c.green, c.gray])));
    choices.push({ name: `  📦 ${bold('Install Skill from URL')}`, value: 'install_url' });
    choices.push({ name: `  📁 ${bold('Install Skill from Local Path')}`, value: 'install_path' });
    choices.push({ name: `  ✨ ${bold('Create New Skill')}`, value: 'create' });
    choices.push({ name: `  🔨 ${bold('Build Skill from Spec URL')} ${dim('(Legacy)')}`, value: 'build' });
    choices.push({ name: `  ✅ ${bold('Validate Skill')}`, value: 'validate' });
    choices.push(new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])));
    choices.push({ name: dim('  ← Back'), value: 'back' });

    const { selection } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selection',
            message: 'Manage Agent Skills:',
            choices,
            pageSize: 20
        }
    ]);

    if (selection === 'back') return showMainMenu();

    // ── Agent Skill management ──
    if (selection.startsWith('agent:')) {
        const skillName = selection.replace('agent:', '');
        const skill = agent.skills.getAgentSkill(skillName);
        if (!skill) return showSkillsMenu();

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Agent Skill: ${skillName}`,
                choices: [
                    { name: skill.activated ? '⏸️  Deactivate' : '▶️  Activate', value: 'toggle' },
                    { name: '📖 View SKILL.md', value: 'view' },
                    { name: '✅ Validate', value: 'validate' },
                    { name: '📂 Show Resources', value: 'resources' },
                    { name: '🗑️  Uninstall', value: 'uninstall' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (action === 'toggle') {
            if (skill.activated) {
                agent.skills.deactivateAgentSkill(skillName);
                console.log(`⏸️  Deactivated "${skillName}"`);
            } else {
                agent.skills.activateAgentSkill(skillName);
                console.log(`▶️  Activated "${skillName}"`);
            }
            await waitKeyPress();
        } else if (action === 'view') {
            console.log('\n' + '─'.repeat(60));
            console.log(fs.readFileSync(path.join(skill.skillDir, 'SKILL.md'), 'utf8'));
            console.log('─'.repeat(60));
            await waitKeyPress();
        } else if (action === 'validate') {
            const result = agent.skills.validateSkill(skill.skillDir);
            if (result.valid) {
                console.log(`✅ Skill "${skillName}" is valid.`);
            } else {
                console.log(`❌ ${result.errors.length} issue(s):`);
                result.errors.forEach(e => console.log(`  - ${e}`));
            }
            await waitKeyPress();
        } else if (action === 'resources') {
            console.log(`\n📂 Resources for "${skillName}":`);
            if (skill.scripts.length > 0) console.log(`  Scripts: ${skill.scripts.join(', ')}`);
            if (skill.references.length > 0) console.log(`  References: ${skill.references.join(', ')}`);
            if (skill.assets.length > 0) console.log(`  Assets: ${skill.assets.join(', ')}`);
            if (skill.scripts.length + skill.references.length + skill.assets.length === 0) {
                console.log('  (No bundled resources)');
            }
            await waitKeyPress();
        } else if (action === 'uninstall') {
            const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Really uninstall "${skillName}"?`, default: false }]);
            if (confirm) {
                console.log(agent.skills.uninstallAgentSkill(skillName));
                await waitKeyPress();
            }
        }
        return showSkillsMenu();
    }

    // ── Plugin skill management ──
    if (selection.startsWith('plugin:')) {
        const skillName = selection.replace('plugin:', '');
        const selectedSkill = skills.find(s => s.name === skillName);
        if (selectedSkill?.pluginPath) {
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: `Plugin Skill: ${skillName}`,
                    choices: [
                        { name: '🗑️  Uninstall (Delete Plugin)', value: 'uninstall' },
                        { name: 'Back', value: 'back' }
                    ]
                }
            ]);

            if (action === 'uninstall') {
                const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Really delete ${skillName}?`, default: false }]);
                if (confirm) {
                    console.log(agent.skills.uninstallSkill(skillName));
                    await waitKeyPress();
                }
            }
        }
        return showSkillsMenu();
    }

    // ── List core skills ──
    if (selection === 'list_core') {
        console.log('\nCore Skills:');
        for (const s of coreSkills) {
            console.log(`  ${s.name}: ${s.description}`);
            console.log(`    Usage: ${s.usage}\n`);
        }
        await waitKeyPress();
        return showSkillsMenu();
    }

    // ── Install from URL ──
    if (selection === 'install_url') {
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter URL (GitHub repo, gist, .skill file, or raw SKILL.md):' }
        ]);
        if (url) {
            console.log('Installing skill...');
            const result = await agent.skills.installSkillFromUrl(url);
            console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
            await waitKeyPress();
        }
        return showSkillsMenu();
    }

    // ── Install from local path ──
    if (selection === 'install_path') {
        const { localPath } = await inquirer.prompt([
            { type: 'input', name: 'localPath', message: 'Enter local path to skill directory or .skill file:' }
        ]);
        if (localPath) {
            console.log('Installing skill...');
            const result = await agent.skills.installSkillFromPath(localPath);
            console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
            await waitKeyPress();
        }
        return showSkillsMenu();
    }

    // ── Create new skill ──
    if (selection === 'create') {
        const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Skill name (lowercase-with-hyphens):' },
            { type: 'input', name: 'description', message: 'Description (what it does and when to use it):' }
        ]);
        if (answers.name) {
            const result = agent.skills.initSkill(answers.name, answers.description);
            console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
            if (result.success) console.log(`  Edit SKILL.md at: ${path.join(result.path, 'SKILL.md')}`);
            await waitKeyPress();
        }
        return showSkillsMenu();
    }

    // ── Validate skill ──
    if (selection === 'validate') {
        const agentSkillsList = agent.skills.getAgentSkills();
        if (agentSkillsList.length === 0) {
            console.log('No agent skills installed to validate.');
            await waitKeyPress();
            return showSkillsMenu();
        }
        const { skillName } = await inquirer.prompt([
            {
                type: 'list',
                name: 'skillName',
                message: 'Select skill to validate:',
                choices: agentSkillsList.map(s => ({ name: s.meta.name, value: s.meta.name }))
            }
        ]);
        const skill = agent.skills.getAgentSkill(skillName);
        if (skill) {
            const result = agent.skills.validateSkill(skill.skillDir);
            if (result.valid) {
                console.log(`✅ Skill "${skillName}" is valid.`);
            } else {
                console.log(`❌ ${result.errors.length} issue(s):`);
                result.errors.forEach(e => console.log(`  - ${e}`));
            }
        }
        await waitKeyPress();
        return showSkillsMenu();
    }

    // ── Build from spec URL (legacy) ──
    if (selection === 'build') {
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter URL for skill specification:' }
        ]);
        if (url) {
            const { SkillBuilder } = require('./builder');
            const builder = new SkillBuilder();
            console.log('Building skill...');
            const result = await builder.buildFromUrl(url);
            console.log(result);
            agent.skills.loadPlugins();
            await waitKeyPress();
        }
        return showSkillsMenu();
    }

    return showSkillsMenu();
}

async function performUpdate() {
    const { execSync, spawn } = require('child_process');
    const fs = require('fs');
    
    // Determine install location
    const orcbotDir = path.resolve(__dirname, '..', '..');
    const isGlobalInstall = orcbotDir.includes('node_modules');
    
    console.log('\n🔄 Checking for OrcBot updates...\n');
    
    try {
        // Check if we're in a git repo
        const gitDir = path.join(orcbotDir, '.git');
        const isGitRepo = fs.existsSync(gitDir);
        
        if (isGitRepo) {
            console.log(`📁 OrcBot directory: ${orcbotDir}`);
            
            // Fetch latest changes
            console.log('📡 Fetching latest changes from remote...');
            execSync('git fetch origin', { cwd: orcbotDir, stdio: 'inherit' });
            
            // Check if updates are available
            const localHash = execSync('git rev-parse HEAD', { cwd: orcbotDir, encoding: 'utf8' }).trim();
            const remoteHash = execSync('git rev-parse origin/main', { cwd: orcbotDir, encoding: 'utf8' }).trim();
            
            if (localHash === remoteHash) {
                console.log('\n✅ OrcBot is already up to date!');
                console.log(`   Current version: ${localHash.substring(0, 7)}`);
                return;
            }
            
            console.log(`\n📦 Update available!`);
            console.log(`   Current: ${localHash.substring(0, 7)}`);
            console.log(`   Latest:  ${remoteHash.substring(0, 7)}`);
            
            // Show what's changing
            console.log('\n📋 Changes to be applied:');
            execSync('git log --oneline HEAD..origin/main', { cwd: orcbotDir, stdio: 'inherit' });
            
            // Force update: discard local changes and sync to origin/main
            console.log('\n⬇️  Applying latest changes (force update)...');
            try {
                const status = execSync('git status --porcelain', { cwd: orcbotDir, encoding: 'utf8' }).trim();
                if (status) {
                    console.log('⚠️  Local changes detected. Discarding to apply updates...');
                }
            } catch (e) {
                // Ignore status errors and proceed with reset/clean
            }
            execSync('git reset --hard origin/main', { cwd: orcbotDir, stdio: 'inherit' });
            execSync('git clean -fd', { cwd: orcbotDir, stdio: 'inherit' });
            
            // Install dependencies
            console.log('\n📦 Installing dependencies...');
            execSync('npm install', { cwd: orcbotDir, stdio: 'inherit' });
            
            // Install dependencies for subdirectories (apps/www, apps/dashboard)
            const appsDir = path.join(orcbotDir, 'apps');
            if (fs.existsSync(appsDir)) {
                const subdirs = ['www', 'dashboard'];
                for (const subdir of subdirs) {
                    const subdirPath = path.join(appsDir, subdir);
                    const packageJsonPath = path.join(subdirPath, 'package.json');
                    if (fs.existsSync(packageJsonPath)) {
                        console.log(`\n📦 Installing dependencies for apps/${subdir}...`);
                        try {
                            execSync('npm install', { cwd: subdirPath, stdio: 'inherit' });
                        } catch (e) {
                            console.log(`⚠️  Failed to install dependencies for apps/${subdir}, continuing...`);
                        }
                    }
                }
            }
            
            // Rebuild (use fast build if available, fallback to tsc)
            console.log('\n🔨 Rebuilding OrcBot...');
            try {
                execSync('npm run build:fast', { cwd: orcbotDir, stdio: 'inherit' });
            } catch (e) {
                console.log('⚠️  Fast build unavailable, using standard build...');
                execSync('npm run build', { cwd: orcbotDir, stdio: 'inherit' });
            }
            
            // Re-link globally if needed
            const packageJson = JSON.parse(fs.readFileSync(path.join(orcbotDir, 'package.json'), 'utf8'));
            if (packageJson.bin) {
                console.log('\n🔗 Re-installing global command...');
                try {
                    execSync('npm install -g .', { cwd: orcbotDir, stdio: 'inherit' });
                } catch (e) {
                    // Try with sudo on Unix
                    if (process.platform !== 'win32') {
                        console.log('   Trying with sudo...');
                        execSync('sudo npm install -g .', { cwd: orcbotDir, stdio: 'inherit' });
                    }
                }
            }
            
            console.log('\n✅ OrcBot updated successfully!');
            console.log('   Please restart OrcBot to apply changes.');
            console.log('\n   Run: orcbot run');
            
        } else {
            // Not a git repo - might be npm installed
            console.log('⚠️  OrcBot was not installed from git.');
            console.log('   To update, run these commands manually:');
            console.log('\n   cd ' + orcbotDir);
            console.log('   git pull origin main');
            console.log('   npm install');
            console.log('   npm run build');
            console.log('   npm install -g .');
        }
    } catch (error: any) {
        console.error('\n❌ Update failed:', error.message);
        console.log('\n   Try updating manually:');
        console.log('   cd ' + orcbotDir);
        console.log('   git pull origin main');
        console.log('   npm install');
        console.log('   npm run build');
        console.log('   npm install -g .');
    }
}

function showStatus() {
    console.clear();
    banner();
    sectionHeader('📊', 'Agent Status');

    const shortMem = agent.memory.searchMemory('short').length;
    const episodicMem = agent.memory.searchMemory('episodic').length;
    const queueItems = agent.actionQueue.getQueue();
    const queueLen = queueItems.length;
    const hasTelegram = !!agent.telegram;
    const hasWhatsapp = !!agent.whatsapp;
    const hasDiscord = !!agent.discord;
    const model = agent.config.get('modelName') || 'gpt-4o';
    const provider = agent.config.get('llmProvider') || 'auto';
    const agentName = agent.config.get('agentName') || 'OrcBot';
    const safeMode = agent.config.get('safeMode');
    const sudoMode = agent.config.get('sudoMode');

    // AI Model Panel
    console.log('');
    box([
        `${dim('Model')}      ${brightCyan(bold(model))}`,
        `${dim('Provider')}   ${cyan(provider)}`,
        `${dim('Agent')}      ${bold(agentName)}`,
        `${dim('Mode')}       ${sudoMode ? `${c.bgRed}${c.white}${c.bold} SUDO ${c.reset} ${dim('(unrestricted)')}` : safeMode ? `${c.bgYellow}${c.white}${c.bold} SAFE ${c.reset} ${dim('(commands blocked)')}` : `${c.bgGreen}${c.white}${c.bold} NORMAL ${c.reset}`}`,
    ], { title: '🤖 AI ENGINE', width: 52, color: c.brightCyan });

    // Memory Panel
    const memTotal = shortMem + episodicMem;
    console.log('');
    box([
        `${dim('Short-term')} ${yellow(bold(String(shortMem).padStart(4)))} entries  ${progressBar(shortMem, 200, 16)}`,
        `${dim('Episodic')}   ${cyan(bold(String(episodicMem).padStart(4)))} entries  ${progressBar(episodicMem, 50, 16, { colorFn: cyan })}`,
        `${dim('Total')}      ${bold(String(memTotal).padStart(4))} entries`,
    ], { title: '🧠 MEMORY', width: 52, color: c.magenta });

    // Channels Panel
    console.log('');
    box([
        `${statusDot(hasTelegram, hasTelegram ? brightCyan('Telegram') : 'Telegram')}${' '.repeat(12)}${hasTelegram ? green('Connected') : dim('Not configured')}`,
        `${statusDot(hasWhatsapp, hasWhatsapp ? brightGreen('WhatsApp') : 'WhatsApp')}${' '.repeat(12)}${hasWhatsapp ? green('Connected') : dim('Not configured')}`,
        `${statusDot(hasDiscord, hasDiscord ? brightMagenta('Discord') : 'Discord')}${' '.repeat(13)}${hasDiscord ? green('Connected') : dim('Not configured')}`,
    ], { title: '🔌 CHANNELS', width: 52, color: c.blue });

    // Action Queue Panel
    const completed = queueItems.filter((a: any) => a.status === 'completed').length;
    const failed = queueItems.filter((a: any) => a.status === 'failed').length;
    const pending = queueItems.filter((a: any) => a.status === 'queued').length;
    const inProgress = queueItems.filter((a: any) => a.status === 'in-progress').length;
    const waiting = queueItems.filter((a: any) => a.status === 'waiting').length;
    console.log('');
    const queueLines: string[] = [
        `${green('●')} Completed ${green(bold(String(completed).padStart(3)))}  ${yellow('●')} Pending ${yellow(bold(String(pending).padStart(3)))}  ${cyan('●')} Active ${cyan(bold(String(inProgress).padStart(3)))}`,
        `${red('●')} Failed    ${red(bold(String(failed).padStart(3)))}  ${magenta('●')} Waiting ${magenta(bold(String(waiting).padStart(3)))}  ${dim('Total')}  ${bold(String(queueLen).padStart(3))}`,
    ];
    if (queueLen > 0) {
        queueLines.push('');
        queueLines.push(dim('Recent:'));
        const recentActions = queueItems.slice(-3).reverse();
        for (const a of recentActions) {
            const statusIcon = a.status === 'completed' ? green('✓') : a.status === 'failed' ? red('✗') : a.status === 'in-progress' ? cyan('▶') : a.status === 'waiting' ? magenta('⏸') : yellow('…');
            const desc = ((a as any).payload?.description || 'Unknown').slice(0, 38);
            queueLines.push(`  ${statusIcon} ${dim(a.id.slice(0, 6))} ${desc}`);
        }
    }
    box(queueLines, { title: '📋 ACTION QUEUE', width: 52, color: c.yellow });

    console.log('');
}

function showTokenUsage() {
    console.clear();
    banner();
    sectionHeader('📈', 'Token Usage');

    const tracker = new TokenTracker(
        agent.config.get('tokenUsagePath'),
        agent.config.get('tokenLogPath')
    );
    const summary = tracker.getSummary();

    // Totals Panel
    console.log('');
    const totalTokens = summary.totals.totalTokens;
    box([
        `${dim('Prompt')}      ${bold(summary.totals.promptTokens.toLocaleString().padStart(12))} tokens`,
        `${dim('Completion')}  ${bold(summary.totals.completionTokens.toLocaleString().padStart(12))} tokens`,
        `${dim('─'.repeat(34))}`,
        `${dim('Total')}       ${brightCyan(bold(totalTokens.toLocaleString().padStart(12)))} tokens`,
    ], { title: '🔢 TOKEN TOTALS', width: 42, color: c.brightCyan });

    // Provider breakdown
    const providers = Object.entries(summary.byProvider);
    if (providers.length > 0) {
        console.log('');
        const providerLines: string[] = [];
        const maxProviderTokens = Math.max(...providers.map(([, t]) => t.totalTokens), 1);
        for (const [prov, totals] of providers) {
            const ratio = totals.totalTokens / Math.max(totalTokens, 1);
            const pct = Math.round(ratio * 100);
            const bar = progressBar(totals.totalTokens, maxProviderTokens, 18, { colorFn: cyan });
            providerLines.push(`${bold(prov.padEnd(14))} ${bar} ${dim(totals.totalTokens.toLocaleString().padStart(10))} ${dim(`(${pct}%)`)}`);
        }
        box(providerLines, { title: '🏢 BY PROVIDER', width: 56, color: c.green });
    }

    // Model breakdown
    const models = Object.entries(summary.byModel).slice(0, 8);
    if (models.length > 0) {
        console.log('');
        const modelLines: string[] = [];
        const maxModelTokens = Math.max(...models.map(([, t]) => t.totalTokens), 1);
        for (const [mdl, totals] of models) {
            const bar = progressBar(totals.totalTokens, maxModelTokens, 14, { colorFn: magenta });
            const displayName = mdl.length > 26 ? mdl.slice(0, 24) + '…' : mdl;
            modelLines.push(`${displayName.padEnd(26)} ${bar} ${dim(totals.totalTokens.toLocaleString().padStart(10))}`);
        }
        box(modelLines, { title: '🤖 TOP MODELS', width: 56, color: c.magenta });
    }

    console.log('');
    console.log(gray(`  Last updated: ${summary.lastUpdated}`));
    console.log('');
}

async function waitKeyPress() {
    await inquirer.prompt([{ type: 'input', name: 'continue', message: gray('Press Enter to continue...') }]);
}

program.parse(process.argv);
