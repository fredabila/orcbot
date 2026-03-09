#!/usr/bin/env node
import { Command } from 'commander';
import * as p from '@clack/prompts';
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
import { spawnSync } from 'child_process';
import { WorkerProfileManager } from '../core/WorkerProfile';
import { DaemonManager } from '../utils/daemon';
import { TokenTracker } from '../core/TokenTracker';
import { OllamaHelper } from '../utils/OllamaHelper';
import { aggregateWorldEvents, fetchWorldEvents, summarizeWorldEvents, WorldEvent, WorldEventSource, getRootCodeLabel } from '../tools/WorldEvents';
import { piBox, isPiTuiAvailable } from '../core/PiTuiRenderer';
import { collectDoctorReport } from './Doctor';

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
        borderColor: opts.color,
    });
}

async function showToolsManagerMenu() {
    console.clear();
    banner();
    sectionHeader('🧰', 'Tools Manager');

    const tools = agent.tools.listTools();
    const activeCount = tools.filter(t => t.active).length;
    const approvedCount = tools.filter(t => t.approved).length;

    console.log('');
    const summaryLines = [
        `${c.white}Installed${c.reset}   ${brightCyan(bold(String(tools.length)))}`,
        `${c.white}Active${c.reset}      ${activeCount > 0 ? `${c.brightGreen}${c.bold}${String(activeCount)}${c.reset}` : `${c.gray}0${c.reset}`}`,
        `${c.white}Approved${c.reset}    ${approvedCount > 0 ? `${c.brightGreen}${c.bold}${String(approvedCount)}${c.reset}` : `${c.gray}0${c.reset}`}`,
    ];
    box(summaryLines, { title: '🧰 TOOL INVENTORY', width: 40, color: c.magenta });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Tools Options:'),
            choices: [
                { name: `  ➕ ${bold('Install Tool')}`, value: 'install' },
                { name: `  ✅ ${bold('Approve Tool')}`, value: 'approve' },
                { name: `  ⚡ ${bold('Activate / Deactivate Tool')}`, value: 'activate' },
                { name: `  ▶️  ${bold('Run Tool Command')}`, value: 'run' },
                { name: `  📖 ${bold('Read Tool README')}`, value: 'readme' },
                { name: `  🗑️  ${bold('Uninstall Tool')}`, value: 'uninstall' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.magenta, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    const pickToolName = async (label: string): Promise<string> => {
        if (tools.length > 0) {
            const choices = tools.map(t => ({
                name: `${t.active ? green('●') : gray('○')} ${t.name} ${t.approved ? green('✔') : red('✖')}${t.description ? dim(` — ${t.description.slice(0, 40)}`) : ''}`,
                value: t.name
            }));
            choices.push({ name: dim('  ✏️  Enter name manually'), value: '__manual__' });
            const { selected } = await inquirer.prompt([
                { type: 'list', name: 'selected', message: label, choices }
            ]);
            if (selected !== '__manual__') return selected;
        }
        const { name } = await inquirer.prompt([
            { type: 'input', name: 'name', message: `${label} (tool name):` }
        ]);
        return (name || '').trim();
    };

    switch (action) {
        case 'install': {
            if (agent.config.get('safeMode')) {
                console.log('\n🔒 Safe mode is enabled. Tool installation is disabled.');
                break;
            }
            const { source } = await inquirer.prompt([
                { type: 'input', name: 'source', message: 'Git URL or local path:' }
            ]);
            const { name } = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Optional tool name (leave blank to infer):' }
            ]);
            const { subdir } = await inquirer.prompt([
                { type: 'input', name: 'subdir', message: 'Optional subdir (leave blank if repo root):' }
            ]);
            const { allowed } = await inquirer.prompt([
                { type: 'input', name: 'allowed', message: 'Allowed commands (comma-separated, or * for all):' }
            ]);
            const { description } = await inquirer.prompt([
                { type: 'input', name: 'description', message: 'Optional description:' }
            ]);
            const allowedCommands = allowed ? allowed.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
            const result = await agent.tools.installTool({ source, name: name || undefined, subdir: subdir || undefined, allowedCommands, description: description || undefined });
            if (result.success && result.name) {
                agent.tools.activateTool(result.name, true);
            }
            console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
            break;
        }
        case 'approve': {
            const name = await pickToolName('Select tool to approve');
            if (!name) break;
            const { allowed } = await inquirer.prompt([
                { type: 'input', name: 'allowed', message: 'Allowed commands (comma-separated, or * for all):' }
            ]);
            const allowedCommands = allowed ? allowed.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
            const result = agent.tools.approveTool(name, allowedCommands);
            console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
            break;
        }
        case 'activate': {
            const name = await pickToolName('Select tool to activate/deactivate');
            if (!name) break;
            const tool = agent.tools.getTool(name);
            if (!tool) {
                console.log('\n❌ Tool not found.');
                break;
            }
            const { active } = await inquirer.prompt([
                { type: 'confirm', name: 'active', message: `Set "${name}" active?`, default: !tool.active }
            ]);
            const result = agent.tools.activateTool(name, active);
            console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
            break;
        }
        case 'run': {
            if (agent.config.get('safeMode')) {
                console.log('\n🔒 Safe mode is enabled. Tool execution is disabled.');
                break;
            }
            const name = await pickToolName('Select tool to run');
            if (!name) break;
            const { command } = await inquirer.prompt([
                { type: 'input', name: 'command', message: 'Command to run (e.g., node, python, ./bin/tool):' }
            ]);
            const { args } = await inquirer.prompt([
                { type: 'input', name: 'args', message: 'Args (optional):' }
            ]);
            const { cwd } = await inquirer.prompt([
                { type: 'input', name: 'cwd', message: 'Working dir relative to tool (optional):' }
            ]);
            const result = await agent.tools.runToolCommand(name, command, args || undefined, cwd || undefined);
            console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
            break;
        }
        case 'readme': {
            const name = await pickToolName('Select tool to read README');
            if (!name) break;
            const result = agent.tools.readToolReadme(name);
            console.log(`\n${result.success ? '' : '❌ '}${result.message}`);
            break;
        }
        case 'uninstall': {
            if (agent.config.get('safeMode')) {
                console.log('\n🔒 Safe mode is enabled. Tool uninstall is disabled.');
                break;
            }
            const name = await pickToolName('Select tool to uninstall');
            if (!name) break;
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: `Uninstall "${name}"?`, default: false }
            ]);
            if (!confirm) break;
            const result = agent.tools.uninstallTool(name);
            console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
            break;
        }
    }

    await waitKeyPress();
    return showToolsManagerMenu();
}

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

/** Gradient text effect (cycles through colors) */
function gradient(text: string, colors: string[] = [c.brightCyan, c.cyan, c.brightMagenta, c.magenta, c.brightBlue]): string {
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
    // Bright top-half, slightly dimmer bottom-half — readable on dark and light terminals
    const gradientColors = [c.brightCyan, c.brightCyan, c.cyan, c.cyan, c.brightMagenta, c.magenta];
    for (let i = 0; i < logoLines.length; i++) {
        console.log(`  ${gradientColors[i]}${logoLines[i]}${c.reset}`);
    }
}

function banner() {
    console.log('');
    renderLogo();
    // Use white for the tagline so it's clearly legible (not dim)
    const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')); } catch { return { version: '2.1.0' }; } })();
    const ver = pkg.version || '2.1.0';
    console.log(`  ${c.white}Autonomous AI Agent Framework${c.reset}  ${c.gray}│${c.reset}  ${c.brightCyan}v${ver}${c.reset}`);
    console.log(`  ${c.white}by${c.reset} ${c.brightCyan}${c.bold}Frederick Abila${c.reset}  ${c.gray}│${c.reset}  ${c.cyan}github.com/fredabila/orcbot${c.reset}`);
    console.log(`  ${c.gray}${'─'.repeat(54)}${c.reset}`);
    console.log('');
}

function sectionHeader(emoji: string, title: string) {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const titleText = `${emoji}  ${title}`;
    const w = Math.max(48, stripAnsi(titleText).length + 4);
    console.log('');
    // Filled background strip: accent color border + bold white text for maximum legibility
    console.log(`  ${c.brightCyan}╔${'═'.repeat(w)}╗${c.reset}`);
    console.log(`  ${c.brightCyan}║${c.reset} ${c.bold}${c.brightWhite}${titleText}${c.reset}${' '.repeat(Math.max(0, w - stripAnsi(titleText).length - 1))}${c.brightCyan}║${c.reset}`);
    console.log(`  ${c.brightCyan}╚${'═'.repeat(w)}╝${c.reset}`);
}

function kvLine(key: string, value: string, indent = '  ') {
    // Use white for the key label so it's clearly visible (gray was too dark)
    console.log(`${indent}  ${c.white}${c.bold}${key}${c.reset}  ${value}`);
}

function statusBadge(ok: boolean, onLabel = 'ON', offLabel = 'OFF'): string {
    return ok
        ? `${c.bgGreen}${c.bold}${c.white} ${onLabel} ${c.reset}`
        : `${c.bgGray}${c.bold}${c.white} ${offLabel} ${c.reset}`;
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
            process.stdout.write(`\n${c.brightCyan}🤖 Agent:${c.reset} `);
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
        console.log(`\n${c.brightYellow}🧭 Step ${data.step}:${c.reset} ${c.bold}${data.description}${c.reset}`);
    });

    eventBus.on('tool:call', (data: any) => {
        console.log(`${c.magenta}⚡ Tool:${c.reset} ${c.bold}${data.name}${c.reset} ${c.dim}${JSON.stringify(data.arguments || {})}${c.reset}`);
    });
}

const program = new Command();
const agent = new Agent({ isCLI: true });
const workerProfile = new WorkerProfileManager();

program
    .name('orcbot')
    .description('TypeScript Autonomous Agent CLI Tool')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new agent environment')
    .action(async () => {
        const os = require('os');
        const dataHome = path.join(os.homedir(), '.orcbot');
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
    .command('stop')
    .description('Stop all running OrcBot instances (daemon, background, gateway)')
    .option('-f, --force', 'Force kill (SIGKILL) if graceful shutdown fails')
    .action(async (options) => {
        const dataDir = path.join(os.homedir(), '.orcbot');
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
                console.log(`   ✅ Sent SIGTERM to ${label} (PID: ${pid})`);

                // If --force, also send SIGKILL after a short wait
                if (options.force) {
                    setTimeout(() => {
                        try {
                            process.kill(pid, 0);
                            process.kill(pid, 'SIGKILL');
                            console.log(`   🔪 Force-killed ${label} (PID: ${pid})`);
                        } catch { }
                    }, 2000);
                }
                return true;
            } catch (e: any) {
                console.log(`   ❌ Failed to stop ${label} (PID: ${pid}): ${e.message}`);
                return false;
            }
        };

        console.log('\n🛑 Stopping all OrcBot processes...\n');

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
            console.log(`🌐 Gateway server listening on http://${host}:${port}`);
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
            setupEventSubscriptions();
            await startGatewayIfNeeded();
            await agent.start();
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
            console.error(`❌ Error: Agent ID is required for action '${cmd}'`);
            return;
        }

        const agentInstance = agent.orchestrator.getAgent(id);
        if (!agentInstance) {
            console.error(`❌ Error: Agent '${id}' not found.`);
            return;
        }

        switch (cmd) {
            case 'start':
                if (agent.orchestrator.isWorkerRunning(id)) {
                    console.log(`Agent ${id} is already running.`);
                } else {
                    console.log(`Starting agent ${id}... (Requires primary OrcBot to be running)`);
                    const success = agent.orchestrator.startWorkerProcess(agentInstance);
                    console.log(success ? `✅ Agent ${id} started.` : `❌ Failed to start agent ${id}.`);
                }
                break;
            case 'stop':
                if (!agent.orchestrator.isWorkerRunning(id)) {
                    console.log(`Agent ${id} is not running.`);
                } else {
                    const success = agent.orchestrator.stopWorkerProcess(id);
                    console.log(success ? `✅ Agent ${id} stopped.` : `❌ Failed to stop agent ${id}.`);
                }
                break;
            case 'restart':
                console.log(`Restarting agent ${id}...`);
                agent.orchestrator.stopWorkerProcess(id);
                setTimeout(() => {
                    const success = agent.orchestrator.startWorkerProcess(agentInstance);
                    console.log(success ? `✅ Agent ${id} restarted.` : `❌ Failed to restart agent ${id}.`);
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
                    console.log(success ? `✅ Agent ${id} terminated.` : `❌ Failed to terminate agent ${id}.`);
                }
                break;
            default:
                console.error(`❌ Unknown action: ${cmd}`);
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
            console.error(`\n  ${c.red}${c.bold}❌ Cannot reset: OrcBot daemon is currently running (PID: ${daemonStatus.pid}).${c.reset}`);
            console.error(`     Please stop it first: ${c.white}orcbot stop${c.reset}\n`);
            return;
        }

        if (isFullReset) {
            console.log('');
            box([
                `${c.red}${c.bold}⚠  This will clear EVERYTHING:${c.reset}`,
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
                console.log(`\n  ${c.green}✔${c.reset} Agent has been ${c.bold}fully reset${c.reset} to factory settings.\n`);
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
                console.log(`\n  ${c.green}✔${c.reset} Reset complete for: ${selected.join(', ')}\n`);
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
                    console.log('\n   To stop: orcbot stop');
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
    .command('doctor')
    .description('Run a local health and deployment audit for OrcBot')
    .option('--deep', 'Include additional filesystem/state checks')
    .option('--json', 'Print the report as JSON')
    .action((opts) => {
        const report = collectDoctorReport(agent.config, { deep: !!opts.deep });

        if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        console.log('\n=== OrcBot Doctor ===\n');
        console.log(`Checked: ${report.checkedAt}`);
        console.log(`Data home: ${report.facts.dataHome}`);
        console.log(`Gateway: ${report.facts.gatewayHost}:${report.facts.gatewayPort} ${report.facts.gatewayAuthEnabled ? '(auth enabled)' : '(no auth)'}`);
        console.log(`Channels: ${report.facts.channelsConfigured.length > 0 ? report.facts.channelsConfigured.join(', ') : 'none'}`);
        console.log(`Providers: ${report.facts.providersConfigured.length > 0 ? report.facts.providersConfigured.join(', ') : 'none'}`);
        console.log('');

        const summaryLines = [
            `${c.white}Critical${c.reset}  ${report.summary.critical > 0 ? brightRed(bold(String(report.summary.critical))) : green('0')}`,
            `${c.white}Warnings${c.reset}  ${report.summary.warn > 0 ? brightYellow(bold(String(report.summary.warn))) : green('0')}`,
            `${c.white}Info${c.reset}      ${report.summary.info > 0 ? brightCyan(String(report.summary.info)) : gray('0')}`,
        ];
        box(summaryLines, { title: '🩺 DOCTOR SUMMARY', width: 40, color: report.summary.critical > 0 ? c.red : (report.summary.warn > 0 ? c.yellow : c.green) });
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
        const securityFindings = report.findings.filter(f => f.area === 'security' || f.area === 'gateway' || f.area === 'channels');
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
                        console.log('   Or use "orcbot stop" to stop all OrcBot processes');
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
        const engineSetting = agent.config.get('browserEngine') || 'puppeteer';

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
    .description('Switch back to Puppeteer (Chrome)')
    .action(() => {
        agent.config.set('browserEngine', 'puppeteer');
        console.log('✅ Browser engine set to Puppeteer (Chrome)');
    });

// ── Latency Benchmark ──────────────────────────────────────────────────

interface BenchmarkResult {
    name: string;
    latencyMs: number;
    detail?: string;
    error?: string;
}

function latencyColor(ms: number): (s: string) => string {
    if (ms < 50) return brightGreen;
    if (ms < 200) return green;
    if (ms < 500) return yellow;
    return red;
}

function formatMs(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

async function runLatencyBenchmark(opts: { includeLLM?: boolean; interactive?: boolean } = {}) {
    const { performance } = await import('perf_hooks');
    const results: BenchmarkResult[] = [];

    sectionHeader('⏱️', 'Latency Benchmark');
    console.log(dim('  Measuring key subsystem latencies...\n'));

    // ── 1. Bootstrap file loading (cold) ────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Bootstrap load (cold)...`);
    try {
        // Force cache clear for cold measurement
        (agent.bootstrap as any)._cache?.clear?.();
        const t0 = performance.now();
        agent.bootstrap.loadBootstrapContext();
        const dt = performance.now() - t0;
        results.push({ name: 'Bootstrap load (cold)', latencyMs: dt });
        console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
    } catch (e: any) {
        results.push({ name: 'Bootstrap load (cold)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 2. Bootstrap file loading (cached / warm) ───────────────────────
    process.stdout.write(`  ${cyan('▸')} Bootstrap load (warm)...`);
    try {
        const t0 = performance.now();
        agent.bootstrap.loadBootstrapContext();
        const dt = performance.now() - t0;
        results.push({ name: 'Bootstrap load (warm)', latencyMs: dt });
        console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
    } catch (e: any) {
        results.push({ name: 'Bootstrap load (warm)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 3. Memory save (write-behind buffer) ────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Memory save (buffered)...`);
    try {
        const testEntry = {
            id: `latency-bench-${Date.now()}`,
            type: 'short' as const,
            content: 'Latency benchmark test entry — safe to ignore',
            timestamp: new Date().toISOString(),
            metadata: { source: 'latency-bench' }
        };
        const t0 = performance.now();
        agent.memory.saveMemory(testEntry);
        const dt = performance.now() - t0;
        results.push({ name: 'Memory save (buffered)', latencyMs: dt, detail: 'write-behind, no disk I/O' });
        console.log(`  ${latencyColor(dt)(formatMs(dt))}`);

        // Clean up test entry
        const memories = agent.memory.searchMemory('short');
        const idx = memories.findIndex(m => m.id === testEntry.id);
        if (idx >= 0) memories.splice(idx, 1);
    } catch (e: any) {
        results.push({ name: 'Memory save (buffered)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 4. Memory flush to disk ─────────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Memory flush to disk...`);
    try {
        const t0 = performance.now();
        agent.memory.flushToDisk();
        const dt = performance.now() - t0;
        results.push({ name: 'Memory flush (disk write)', latencyMs: dt });
        console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
    } catch (e: any) {
        results.push({ name: 'Memory flush (disk write)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 5. Memory search (short) ────────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Memory search (short)...`);
    try {
        const t0 = performance.now();
        const shorts = agent.memory.searchMemory('short');
        const dt = performance.now() - t0;
        results.push({ name: 'Memory search (short)', latencyMs: dt, detail: `${shorts.length} entries` });
        console.log(`  ${latencyColor(dt)(formatMs(dt))} ${dim(`(${shorts.length} entries)`)}`);
    } catch (e: any) {
        results.push({ name: 'Memory search (short)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 6. Memory search (episodic) ─────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Memory search (episodic)...`);
    try {
        const t0 = performance.now();
        const eps = agent.memory.searchMemory('episodic');
        const dt = performance.now() - t0;
        results.push({ name: 'Memory search (episodic)', latencyMs: dt, detail: `${eps.length} entries` });
        console.log(`  ${latencyColor(dt)(formatMs(dt))} ${dim(`(${eps.length} entries)`)}`);
    } catch (e: any) {
        results.push({ name: 'Memory search (episodic)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 7. Recent context retrieval ─────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Recent context (top 20)...`);
    try {
        const t0 = performance.now();
        const ctx = agent.memory.getRecentContext(20);
        const dt = performance.now() - t0;
        results.push({ name: 'Recent context (top 20)', latencyMs: dt, detail: `${ctx.length} items` });
        console.log(`  ${latencyColor(dt)(formatMs(dt))} ${dim(`(${ctx.length} items)`)}`);
    } catch (e: any) {
        results.push({ name: 'Recent context (top 20)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 8. Config read ──────────────────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Config read (hot)...`);
    try {
        const keys = ['model', 'maxSteps', 'sudoMode', 'fastModelName', 'telegramToken'];
        const t0 = performance.now();
        for (const k of keys) agent.config.get(k);
        const dt = performance.now() - t0;
        results.push({ name: 'Config read (5 keys)', latencyMs: dt });
        console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
    } catch (e: any) {
        results.push({ name: 'Config read (5 keys)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 9. Action queue operations ──────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Action queue peek...`);
    try {
        const t0 = performance.now();
        agent.actionQueue.getNext();
        const dt = performance.now() - t0;
        const allActions = agent.actionQueue.getQueue();
        results.push({ name: 'Action queue peek', latencyMs: dt, detail: `${allActions.length} queued` });
        console.log(`  ${latencyColor(dt)(formatMs(dt))} ${dim(`(${allActions.length} queued)`)}`);
    } catch (e: any) {
        results.push({ name: 'Action queue peek', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 10. Skills matching ─────────────────────────────────────────────
    process.stdout.write(`  ${cyan('▸')} Skills match (sample task)...`);
    try {
        const t0 = performance.now();
        const matched = agent.skills.matchSkillsForTask('search for latest news and send a summary');
        const dt = performance.now() - t0;
        results.push({ name: 'Skills match (sample)', latencyMs: dt, detail: `${matched.length} matched` });
        console.log(`  ${latencyColor(dt)(formatMs(dt))} ${dim(`(${matched.length} skills)`)}`);
    } catch (e: any) {
        results.push({ name: 'Skills match (sample)', latencyMs: -1, error: e.message });
        console.log(`  ${red('ERROR')}`);
    }

    // ── 11. LLM round-trip (optional) ───────────────────────────────────
    if (opts.includeLLM) {
        // Fast model ping
        process.stdout.write(`  ${cyan('▸')} LLM ping (fast model)...`);
        try {
            const t0 = performance.now();
            await agent.llm.callFast('Respond with the single word: pong');
            const dt = performance.now() - t0;
            const fastModel = agent.config.get('fastModelName') || 'gpt-4o-mini';
            results.push({ name: `LLM ping (${fastModel})`, latencyMs: dt });
            console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
        } catch (e: any) {
            results.push({ name: 'LLM ping (fast model)', latencyMs: -1, error: e.message });
            console.log(`  ${red('ERROR')} ${dim(e.message?.slice(0, 60))}`);
        }

        // Primary model ping
        process.stdout.write(`  ${cyan('▸')} LLM ping (primary model)...`);
        try {
            const t0 = performance.now();
            await agent.llm.call('Respond with the single word: pong');
            const dt = performance.now() - t0;
            const model = agent.config.get('model') || 'unknown';
            results.push({ name: `LLM ping (${model})`, latencyMs: dt });
            console.log(`  ${latencyColor(dt)(formatMs(dt))}`);
        } catch (e: any) {
            results.push({ name: 'LLM ping (primary model)', latencyMs: -1, error: e.message });
            console.log(`  ${red('ERROR')} ${dim(e.message?.slice(0, 60))}`);
        }
    }

    // ── Summary table ───────────────────────────────────────────────────
    console.log('');
    const successResults = results.filter(r => r.latencyMs >= 0);
    const failedResults = results.filter(r => r.latencyMs < 0);

    const summaryLines: string[] = [];
    const maxNameLen = Math.max(...results.map(r => r.name.length));

    for (const r of successResults) {
        const nameStr = r.name.padEnd(maxNameLen + 2);
        const msStr = formatMs(r.latencyMs);
        const colorFn = latencyColor(r.latencyMs);
        const barW = 15;
        // Scale: <1ms = 1 block, 50ms = 4, 200ms = 8, 1s = 12, 5s+ = 15
        const logMs = Math.log10(Math.max(r.latencyMs, 0.01) + 1);
        const blocks = Math.min(barW, Math.max(1, Math.round(logMs * 4)));
        const bar = colorFn('█'.repeat(blocks)) + dim('░'.repeat(barW - blocks));
        summaryLines.push(`${dim(nameStr)}${bar} ${colorFn(msStr.padStart(8))}${r.detail ? '  ' + dim(r.detail) : ''}`);
    }

    for (const r of failedResults) {
        const nameStr = r.name.padEnd(maxNameLen + 2);
        summaryLines.push(`${dim(nameStr)}${red('FAILED'.padStart(24))}  ${dim(r.error?.slice(0, 40) || '')}`);
    }

    box(summaryLines, { title: 'BENCHMARK RESULTS', width: 78, color: c.brightCyan });

    // ── Totals and ratings ──────────────────────────────────────────────
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

    // Rating
    const rating = totalLocal < 10 ? 'Excellent' : totalLocal < 50 ? 'Good' : totalLocal < 200 ? 'Acceptable' : 'Needs optimization';
    const ratingColor = totalLocal < 10 ? brightGreen : totalLocal < 50 ? green : totalLocal < 200 ? yellow : red;
    kvLine('Rating (local):', ratingColor(`${rating}`));

    if (!opts.includeLLM) {
        console.log('');
        console.log(dim('  Tip: Use ') + cyan('orcbot latency --llm') + dim(' to include LLM round-trip benchmarks'));
    }
    console.log('');

    // In TUI interactive mode, offer to run with LLM
    if (opts.interactive && !opts.includeLLM) {
        const { runLLM } = await inquirer.prompt([{
            type: 'confirm',
            name: 'runLLM',
            message: 'Also benchmark LLM round-trip latency?',
            default: false
        }]);
        if (runLLM) {
            await runLatencyBenchmark({ includeLLM: true, interactive: false });
        } else {
            await waitKeyPress();
        }
    }
}

// ── World Events (GDELT) Live View ─────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseWorldSources(input: string[] | string | undefined): WorldEventSource[] {
    const raw = Array.isArray(input) ? input.join(',') : String(input || '');
    const list = raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    const allowed: WorldEventSource[] = ['gdelt', 'usgs', 'opensky'];
    const selected = list.filter(s => allowed.includes(s as WorldEventSource)) as WorldEventSource[];
    return selected.length ? selected : ['gdelt'];
}

function parseGlobeArgs(input: string[] | string | undefined): string[] {
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

                // Add a subtle limb outline for 3D shape
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
    // GDELT DATEADDED like YYYYMMDDHHMMSS
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
    rotationDeg: number,
    minutes: number,
    error?: string,
    sources?: WorldEventSource[],
    globeMode?: 'ascii' | 'external' | 'map' | 'mapscii',
    globeCommand?: string,
    globeArgs?: string[]
): void {
    console.clear();
    banner();
    sectionHeader('🌍', 'World Events');

    if (error) {
        box([
            red('Data fetch failed'),
            dim(error)
        ], { title: '⚠️  DATA ERROR', width: 74, color: c.red });
        console.log('');
    }

    const stats = aggregateWorldEvents(events);
    const trend = history.length ? sparkline(history) : dim('(no history)');
    const activeSources = sources && sources.length ? sources.join(', ') : 'gdelt';
    const topSources = stats.topSources.map(s => `${s.key}:${s.count}`).join('  ') || 'none';
    const topCountries = stats.topCountries.map(c => `${c.key}:${c.count}`).join('  ') || 'none';
    const topRoots = stats.topRootCodes.map(r => `${r.key}:${r.count}`).join('  ') || 'none';

    const signalLines = [
        `${dim('Sources')} ${activeSources}   ${dim('Window')} ${minutes}m   ${dim('Events')} ${stats.total.toLocaleString()}`,
        `${dim('Trend')} ${trend}`,
        `${dim('Top sources')} ${topSources}`,
        `${dim('Avg tone')} ${stats.avgTone.toFixed(2)}   ${dim('Avg goldstein')} ${stats.avgGoldstein.toFixed(2)}`,
        `${dim('Top countries')} ${topCountries}`,
        `${dim('Top roots')} ${topRoots}`
    ];

    box(signalLines, { title: '📈 SIGNALS', width: 74, color: c.green });
    console.log('');

    const legendLines = [
        `${cyan('gdelt')} News events (01-04: coop/conflict)`,
        `${green('usgs')} Earthquakes (M#)`,
        `${yellow('opensky')} Flight snapshots`,
        globeMode === 'external'
            ? `${dim('Renderer')} External CLI globe (no point overlay)`
            : globeMode === 'ascii'
                ? `${dim('Renderer')} ASCII globe with overlay points`
                : globeMode === 'mapscii'
                    ? `${dim('Renderer')} mapscii (full-screen, no overlay)`
                    : `${dim('Renderer')} Flat map with overlay points`
    ];
    const topLines = getTopEventLines(events, 6);
    box([...legendLines, '', dim('Top events:'), ...topLines], { title: '🧭 LEGEND & TOP EVENTS', width: 74, color: c.brightCyan });
    console.log('');

    let viewLines: string[] | null = null;
    if (globeMode === 'external' && globeCommand) {
        viewLines = renderExternalGlobe(globeCommand, globeArgs || [], 20);
    }
    if (!viewLines) {
        viewLines = globeMode === 'ascii'
            ? renderGlobeFrame(events, rotationDeg, 42, 20)
            : renderMapFrame(events, 68, 18);
    }
    const title = globeMode === 'ascii'
        ? '🌐 LIVE GLOBE'
        : globeMode === 'external'
            ? '🌐 EXTERNAL GLOBE'
            : globeMode === 'mapscii'
                ? '🗺️ MAPSCII'
                : '🗺️ LIVE MAP';
    box(viewLines, { title, width: 74, color: c.cyan });
    console.log('');
    console.log(dim(`  Updated: ${new Date().toLocaleTimeString()}  |  Showing ${Math.min(events.length, 250)} points`));
}

async function runWorldEventsMonitor(opts: {
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
}): Promise<void> {
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

        const frameCount = 12;
        const frameDelay = 100;
        for (let i = 0; i < frameCount; i++) {
            renderWorldView(
                events,
                history,
                rotation + i * 15,
                opts.minutes,
                error,
                opts.sources,
                opts.globeMode,
                opts.globeCommand,
                opts.globeArgs
            );
            await sleep(frameDelay);
        }
        rotation = (rotation + frameCount * 15) % 360;

        const now = new Date();
        if (opts.store !== false && batchEvents.length > 0 && now.getTime() - batchStart.getTime() >= batchMs) {
            const summary = summarizeWorldEvents(batchEvents, batchStart, now);
            agent.memory.saveMemory({
                id: `world-events-${now.toISOString()}`,
                type: 'episodic',
                content: summary,
                metadata: {
                    source: 'gdelt',
                    category: 'world_events',
                    windowStart: batchStart.toISOString(),
                    windowEnd: now.toISOString(),
                    count: batchEvents.length,
                    sources: opts.sources
                }
            });
            batchEvents = [];
            batchStart = now;
        }

        if (opts.once) break;
        await sleep(refreshMs);
    }
}

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
    const hasSlack = !!agent.config.get('slackBotToken');
    const hasEmail = !!agent.config.get('emailEnabled');
    const channelCount = [hasTelegram, hasWhatsapp, hasDiscord, hasSlack, hasEmail].filter(Boolean).length;
    const agentName = agent.config.get('agentName') || 'OrcBot';
    const sudoMode = agent.config.get('sudoMode');

    const channelDots = [
        hasTelegram ? `${c.brightCyan}TG${c.reset}` : `${c.gray}TG${c.reset}`,
        hasWhatsapp ? `${c.brightGreen}WA${c.reset}` : `${c.gray}WA${c.reset}`,
        hasDiscord ? `${c.brightMagenta}DC${c.reset}` : `${c.gray}DC${c.reset}`,
        hasSlack ? `${c.brightYellow}SL${c.reset}` : `${c.gray}SL${c.reset}`,
    ].join(dim(' │ '));

    const auActive = agent.agenticUser?.isActive();
    const auEnabled = !!agent.config.get('agenticUserEnabled');

    // Use white for key labels so they're legible; reserve dim only for secondary info
    box([
        `${c.white}Agent${c.reset}    ${c.bold}${c.brightWhite}${agentName}${c.reset}${sudoMode ? `  ${c.bgRed}${c.bold}${c.white} SUDO ${c.reset}` : ''}${agent.config.get('overrideMode') ? `  ${c.bgRed}${c.bold}${c.white} OVERRIDE ${c.reset}` : ''}`,
        `${c.white}Model${c.reset}    ${brightCyan(bold(model))} ${dim('via')} ${c.white}${provider}${c.reset}`,
        `${c.white}Channels${c.reset} ${channelDots} ${hasEmail ? '📧 ' : ''} ${dim(`(${channelCount}/5 active)`)}`,
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
            { label: `── RUN ───────────────────────────────────`, value: 'separator_run', disabled: true },
            { label: `  ${c.brightGreen}▶${c.reset}  ${c.bold}Start Agent Loop${c.reset}`, value: 'start' },
            { label: `  ${c.yellow}📋${c.reset}  Push Task`, value: 'push' },
            { label: `  ${c.cyan}📊${c.reset}  View Status`, value: 'status' },
            { label: `── CONFIGURE ─────────────────────────────`, value: 'separator_config', disabled: true },
            { label: `  ${c.magenta}🧠${c.reset}  Manage AI Models`, value: 'models' },
            { label: `  ${c.brightBlue}🔌${c.reset}  Manage Connections`, value: 'connections' },
            { label: `  ${c.brightCyan}⚡${c.reset}  Manage Skills  ${c.gray}(${agent.skills.getAgentSkills().length} installed)${c.reset}`, value: 'skills' },
            { label: `  ${c.brightBlue}🌍${c.reset}  World Governance`, value: 'world' },
            { label: `  ${c.brightMagenta}🧰${c.reset}  Manage Tools   ${c.gray}(${agent.tools.listTools().length} installed)${c.reset}`, value: 'tools' },
            { label: `  ${c.yellow}🔧${c.reset}  Tooling & APIs`, value: 'tooling' },
            { label: `── ADVANCED ──────────────────────────────`, value: 'separator_adv', disabled: true },
            { label: `  ${c.brightGreen}🌐${c.reset}  Web Gateway`, value: 'gateway' },
            { label: `  ${c.brightMagenta}🪪${c.reset}   Worker Profile`, value: 'worker' },
            { label: `  ${c.brightCyan}🐙${c.reset}  Multi-Agent Orchestration`, value: 'orchestration' },
            { label: `  ${c.brightYellow}🤖${c.reset}  Agentic User ${c.gray}(HITL Proxy)${c.reset}`, value: 'agentic_user' },
            { label: `  ${c.brightRed}🔒${c.reset}  Security & Permissions`, value: 'security' },
            { label: `  ${c.brightGreen}📈${c.reset}  Token Usage`, value: 'tokens' },
            { label: `  ${c.cyan}🧪${c.reset}  Guardrail Metrics`, value: 'metrics' },
            { label: `  ${c.brightBlue}🌍${c.reset}  World Events Live`, value: 'world_events' },
            { label: `  ${c.brightCyan}⏱️${c.reset}   Latency Benchmark`, value: 'latency' },
            { label: `── SYSTEM ────────────────────────────────`, value: 'separator_sys', disabled: true },
            { label: `  ${c.white}📂${c.reset}  Open Build Workspace`, value: 'open_build_workspace' },
            { label: `  ${c.white}⚙️${c.reset}   Configure Agent`, value: 'config' },
            { label: `  ${c.white}⬆️${c.reset}   Update OrcBot`, value: 'update' },
            { label: `  ${c.gray}← Exit${c.reset}`, value: 'exit' },
        ]
    });

    if (p.isCancel(action)) {
        process.exit(0);
    }

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
        case 'world':
            await showWorldGovernanceMenu();
            break;
        case 'tools':
            await showToolsManagerMenu();
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
            await runLatencyBenchmark({ includeLLM: false, interactive: true });
            await showMainMenu();
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
            console.log(`\n✅ Created build workspace: ${workspacePath}`);
        } else {
            console.log(`\n📁 Build workspace: ${workspacePath}`);
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
            console.log('✅ Opened build workspace in file explorer.');
        } else {
            console.log('⚠️ Could not open file explorer automatically.');
            console.log(`   Open manually: ${workspacePath}`);
        }
    } catch (error: any) {
        console.log(`\n❌ Failed to open build workspace: ${error?.message || error}`);
    }
}

async function showBrowserMenu() {
    const currentEngine = agent.config.get('browserEngine') || 'puppeteer';
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
    const computerUseEnabled = !!agent.config.get('googleComputerUseEnabled');
    const computerUseModel = agent.config.get('googleComputerUseModel') || 'gemini-2.5-computer-use-preview-10-2025';
    const hasGoogleKey = !!agent.config.get('googleApiKey');
    const browserLines = [
        `${dim('Engine')}     ${currentEngine === 'lightpanda' ? brightCyan(bold('🐼 Lightpanda')) : currentEngine === 'puppeteer' ? cyan(bold('🌐 Puppeteer (Chrome)')) : cyan(bold('🌐 Puppeteer (Chrome)'))}`,
        `${dim('Installed')}  ${isInstalled ? green('● Yes') : gray('○ No')}`,
        ...(isInstalled ? [
            `${dim('Server')}     ${isRunning ? green(`● Running ${dim(`(PID: ${runningPid})`)}`) : gray('○ Stopped')}`,
            `${dim('Endpoint')}   ${dim(lightpandaEndpoint)}`,
        ] : []),
        `${dim('Gemini CU')}  ${computerUseEnabled ? green('● Enabled') : gray('○ Disabled')}${computerUseEnabled ? ` ${dim(computerUseModel)}` : ''}`,
    ];
    box(browserLines, { title: '🌐 BROWSER STATUS', width: 50, color: c.cyan });
    console.log('');

    const choices = [
        { name: currentEngine === 'puppeteer' ? '🐼 Switch to Lightpanda (9x less RAM)' : '🌐 Switch to Puppeteer (Chrome)', value: 'toggle' },

        { name: computerUseEnabled ? `🤖 ${bold('Disable')} Gemini Computer Use` : `🤖 ${bold('Enable')} Gemini Computer Use ${dim('(vision-based browser control)')}`, value: 'computeruse' },
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
        if (currentEngine === 'puppeteer') {
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
            agent.config.set('browserEngine', 'puppeteer');
            console.log('\n✅ Switched to Playwright (Chrome)');
        }
    } else if (action === 'computeruse') {
        if (computerUseEnabled) {
            agent.config.set('googleComputerUseEnabled', false);
            console.log('\n✅ Gemini Computer Use disabled');
            console.log('   Browser actions will use DOM-based selectors only.');
        } else {
            if (!hasGoogleKey) {
                console.log('\n⚠️  Google API key is not set. Computer Use requires a Google API key.');
                const { key } = await inquirer.prompt([
                    { type: 'input', name: 'key', message: 'Enter Google API Key (or press Enter to skip):' }
                ]);
                if (key) {
                    agent.config.set('googleApiKey', key);
                    console.log('   ✅ Google API key saved.');
                } else {
                    console.log('   ⚠️  Skipped. Computer Use may not work without a Google API key.');
                }
            }
            agent.config.set('googleComputerUseEnabled', true);
            console.log(`\n✅ Gemini Computer Use enabled`);
            console.log(`   Model: ${computerUseModel}`);
            console.log('   All browser_* actions will prefer vision-based control with DOM fallback.');
            const { changeModel } = await inquirer.prompt([
                { type: 'confirm', name: 'changeModel', message: `Keep default model (${computerUseModel})?`, default: true }
            ]);
            if (!changeModel) {
                const { model } = await inquirer.prompt([
                    { type: 'input', name: 'model', message: 'Enter Gemini Computer Use model name:', default: computerUseModel }
                ]);
                if (model) {
                    agent.config.set('googleComputerUseModel', model);
                    console.log(`   ✅ Model set to: ${model}`);
                }
            }
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
    const browserEngine = agent.config.get('browserEngine') || 'puppeteer';
    const computerUseOn = !!agent.config.get('googleComputerUseEnabled');
    const imageGenProvider = agent.config.get('imageGenProvider');
    const imageGenModel = agent.config.get('imageGenModel');
    const hasImageGen = !!(imageGenProvider || imageGenModel || agent.config.get('openaiApiKey') || agent.config.get('googleApiKey'));
    const imageGenLabel = imageGenModel ? `${imageGenModel}` : imageGenProvider ? `${imageGenProvider} (auto)` : hasImageGen ? 'Auto-detect' : 'Not configured';

    console.log('');
    const toolLines = [
        `${statusDot(true, '')} ${bold('Browser')}       ${browserEngine === 'lightpanda' ? cyan('🐼 Lightpanda') : cyan('🌐 Playwright')}${computerUseOn ? ` + ${green('Gemini CU')}` : ''}`,
        `${statusDot(hasSerper, '')} ${bold('Serper')}        ${hasSerper ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasBrave, '')} ${bold('Brave Search')}  ${hasBrave ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasSearxng, '')} ${bold('SearxNG')}       ${hasSearxng ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasCaptcha, '')} ${bold('2Captcha')}      ${hasCaptcha ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasImageGen, '')} ${bold('Image Gen')}    ${hasImageGen ? green(imageGenLabel) : gray('Not set')}`,
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
                { name: `  ${statusDot(hasImageGen, '')} 🎨 ${bold('Image Generation')} ${dim(`(${imageGenLabel})`)}`, value: 'imagegen' },
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
    } else if (tool === 'imagegen') {
        console.log('');
        const imgLines = [
            `${dim('Provider')}  ${bold(String(agent.config.get('imageGenProvider') || 'auto'))}`,
            `${dim('Model')}     ${bold(String(agent.config.get('imageGenModel') || 'auto'))}`,
            `${dim('Size')}      ${bold(String(agent.config.get('imageGenSize') || '1024x1024'))}`,
            `${dim('Quality')}   ${bold(String(agent.config.get('imageGenQuality') || 'medium'))}`,
            '',
            `${dim('Available providers:')}`,
            `  ${agent.config.get('openaiApiKey') ? green('●') : red('○')} OpenAI  ${dim('(DALL·E 3, GPT Image)')}`,
            `  ${agent.config.get('googleApiKey') ? green('●') : red('○')} Google  ${dim('(Gemini Flash Image, Imagen)')}`,
            '',
            `${dim('Reuses your existing LLM API keys!')}`,
        ];
        box(imgLines, { title: '🎨 IMAGE GENERATION', width: 52, color: c.magenta });
        console.log('');

        const { imgAction } = await inquirer.prompt([
            {
                type: 'list',
                name: 'imgAction',
                message: cyan('Image Generation Options:'),
                choices: [
                    { name: `  🔌 ${bold('Set Provider')} ${dim('(openai / google / auto)')}`, value: 'provider' },
                    { name: `  🤖 ${bold('Set Model')} ${dim('(dall-e-3 / gemini-2.5-flash-image / ...)')}`, value: 'model' },
                    { name: `  📐 ${bold('Set Default Size')} ${dim(`(current: ${agent.config.get('imageGenSize') || '1024x1024'})`)}`, value: 'size' },
                    { name: `  ✨ ${bold('Set Default Quality')} ${dim(`(current: ${agent.config.get('imageGenQuality') || 'medium'})`)}`, value: 'quality' },
                    new inquirer.Separator(gradient('  ──────────────────────────────────', [c.magenta, c.gray])),
                    { name: dim('  ← Back'), value: 'back' }
                ]
            }
        ]);

        if (imgAction === 'back') {
            return showToolingMenu();
        } else if (imgAction === 'provider') {
            const { prov } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'prov',
                    message: 'Select image generation provider:',
                    choices: [
                        { name: `  Auto-detect ${dim('(uses first available key)')}`, value: '' },
                        { name: `  OpenAI ${dim('(DALL·E 3, GPT Image 1)')}`, value: 'openai' },
                        { name: `  Google ${dim('(Gemini 2.5 Flash Image, Gemini 3 Pro Image)')}`, value: 'google' },
                    ]
                }
            ]);
            agent.config.set('imageGenProvider', prov || undefined);
        } else if (imgAction === 'model') {
            const { mdl } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mdl',
                    message: 'Select image generation model:',
                    choices: [
                        { name: `  Auto ${dim('(provider default)')}`, value: '' },
                        new inquirer.Separator(dim('  ─── OpenAI ───')),
                        { name: `  dall-e-3 ${dim('(1024x1024, good quality)')}`, value: 'dall-e-3' },
                        { name: `  gpt-image-1 ${dim('(best quality, text rendering)')}`, value: 'gpt-image-1' },
                        new inquirer.Separator(dim('  ─── Google ───')),
                        { name: `  gemini-2.5-flash-image ${dim('(fast, efficient)')}`, value: 'gemini-2.5-flash-image' },
                        { name: `  gemini-3-pro-image-preview ${dim('(4K, professional)')}`, value: 'gemini-3-pro-image-preview' },
                    ]
                }
            ]);
            agent.config.set('imageGenModel', mdl || undefined);
        } else if (imgAction === 'size') {
            const { sz } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'sz',
                    message: 'Select default image size:',
                    choices: [
                        { name: '  1024x1024 (square)', value: '1024x1024' },
                        { name: '  1024x1536 (portrait)', value: '1024x1536' },
                        { name: '  1536x1024 (landscape)', value: '1536x1024' },
                    ]
                }
            ]);
            agent.config.set('imageGenSize', sz);
        } else if (imgAction === 'quality') {
            const { q } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'q',
                    message: 'Select default image quality:',
                    choices: [
                        { name: `  low ${dim('(fastest, cheapest)')}`, value: 'low' },
                        { name: `  medium ${dim('(balanced)')}`, value: 'medium' },
                        { name: `  high ${dim('(best quality, slower)')}`, value: 'high' },
                    ]
                }
            ]);
            agent.config.set('imageGenQuality', q);
        }
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
    const autonomyAllowed = isAutonomyEnabledForChannel('gateway-chat');

    sectionHeader('🌐', 'Web Gateway');
    console.log('');
    const gatewayLines = [
        `${dim('Host')}       ${bold(String(currentHost))}`,
        `${dim('Port')}       ${brightCyan(bold(String(currentPort)))}`,
        `${dim('Endpoint')}   ${cyan(`http://${currentHost}:${currentPort}/api`)}`,
        `${dim('WebSocket')}  ${cyan(`ws://${currentHost}:${currentPort}`)}`,
        `${dim('Auth')}       ${apiKey ? green('● API Key set') : yellow('○ No authentication')}`,
        `${dim('Autonomy')}   ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
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
                { name: `  🤖 ${autonomyAllowed ? 'Disable' : 'Enable'} Autonomous Messaging`, value: 'toggle_autonomy' },
                { name: `  🔐 ${bold('Tailscale Setup & Status Guide')}`, value: 'tailscale' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.cyan, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('gateway-chat');
        return showGatewayMenu();
    }

    if (action === 'start' || action === 'start_with_agent') {
        // Ask for optional static dashboard directory before starting the gateway
        const defaultStatic = agent.config.get('gatewayStaticDir') || path.join(process.cwd(), 'apps', 'dashboard');
        const { staticDirInput } = await inquirer.prompt([
            { type: 'input', name: 'staticDirInput', message: 'Optional path to dashboard static files (leave blank to skip):', default: defaultStatic }
        ]);

        let staticDir = (staticDirInput || '').trim();
        if (staticDir) {
            if (!path.isAbsolute(staticDir)) staticDir = path.join(process.cwd(), staticDir);
            if (!fs.existsSync(staticDir)) {
                const { createDir } = await inquirer.prompt([
                    { type: 'confirm', name: 'createDir', message: `Directory "${staticDir}" does not exist. Create it?`, default: false }
                ]);
                if (createDir) {
                    try { fs.mkdirSync(staticDir, { recursive: true }); } catch (e) { console.log(yellow(`Failed to create directory: ${e?.message || e}`)); }
                } else {
                    console.log('Aborting start. No static directory set.');
                    await waitKeyPress();
                    return showGatewayMenu();
                }
            }
            // Save as preference
            agent.config.set('gatewayStaticDir', staticDir);
        } else {
            staticDir = undefined;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GatewayServer } = require('../gateway/GatewayServer');

        const gatewayConfig = {
            port: currentPort,
            host: currentHost,
            apiKey: apiKey,
            staticDir: staticDir
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
        if (staticDir) console.log(`   Static files served from: ${staticDir}`);
        console.log('\n   Press Ctrl+C to stop\n');

        if (action === 'start_with_agent') {
            console.log('🤖 Also starting agent loop...\n');
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        }

        // Keep running - don't return to menu
        await new Promise(() => { }); // Wait forever until Ctrl+C
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
    } else if (action === 'tailscale') {
        console.log('');
        const { execSync } = require('child_process');
        let tailscaleInstalled = false;
        let statusLine = yellow('not installed');
        let tailscaleIp = dim('n/a');

        // Robust detection: try which/where, then version, then status/ip
        try {
            const platform = process.platform;
            try {
                if (platform === 'win32') execSync('where tailscale', { stdio: ['ignore', 'pipe', 'pipe'] });
                else execSync('which tailscale', { stdio: ['ignore', 'pipe', 'pipe'] });
            } catch {
                // which/where may fail even if tailscale CLI available (path issues);
                // continue to try version/status commands.
            }

            // Try version first (non-interactive)
            try {
                const ver = String(execSync('tailscale version', { stdio: ['ignore', 'pipe', 'pipe'] })).split('\n')[0].trim();
                tailscaleInstalled = true;
                statusLine = green(`installed (${ver})`);
            } catch {
                // Try a status probe
                try {
                    const st = String(execSync('tailscale status --json', { stdio: ['ignore', 'pipe', 'pipe'] }));
                    if (st && st.trim()) {
                        tailscaleInstalled = true;
                        statusLine = green('installed (status)');
                    }
                } catch {
                    tailscaleInstalled = false;
                }
            }

            // Try to get IPv4 address
            if (tailscaleInstalled) {
                try {
                    const ipOut = String(execSync('tailscale ip -4', { stdio: ['ignore', 'pipe', 'pipe'] })).split('\n').find((l: string) => l.trim()) || '';
                    if (ipOut.trim()) tailscaleIp = brightCyan(ipOut.trim());
                } catch {
                    // as fallback, try parsing status --json for self IP
                    try {
                        const statusJson = String(execSync('tailscale status --json', { stdio: ['ignore', 'pipe', 'pipe'] }));
                        const parsed = JSON.parse(statusJson || '{}');
                        if (parsed && parsed.Self && parsed.Self.TailSegments) {
                            // Not all versions include TailSegments; try Addresses
                        }
                        if (parsed && parsed.Self && parsed.Self.Addresses && Array.isArray(parsed.Self.Addresses)) {
                            const v4 = parsed.Self.Addresses.find((a: string) => a.includes('.') );
                            if (v4) tailscaleIp = brightCyan(String(v4).split('/')[0]);
                        }
                    } catch {}
                }
            }
        } catch (e) {
            // fallthrough, keep as not installed
            tailscaleInstalled = tailscaleInstalled || false;
        }

        const tailscaleLines = [
            `${dim('Tailscale')}   ${statusLine}`,
            `${dim('Tailnet IP')}  ${tailscaleIp}`,
            `${dim('Gateway')}     ${bold(String(currentHost))}:${brightCyan(bold(String(currentPort)))}`,
            `${dim('Auth Key')}    ${apiKey ? green('set') : yellow('not set (recommended)')}`,
        ];
        box(tailscaleLines, { title: '🔐 PRIVATE REMOTE ACCESS', width: 60, color: c.brightCyan });

        console.log('');
        console.log(bold('Recommended setup (official pattern):'));
        console.log(`  1) ${dim('Install + login')} Tailscale on this OrcBot host and your operator device.`);
        console.log(`  2) ${dim('Keep gateway auth on')} by setting ${cyan('gatewayApiKey')} in this menu.`);
        console.log(`  3) ${dim('Prefer private networking')} expose gateway only to Tailnet users/devices.`);
        console.log(`  4) ${dim('Use ACLs')} allow only your ops group to reach port ${currentPort}.`);
        console.log('');
        console.log(dim('Quick commands:'));
        console.log(`  ${cyan('tailscale status')}`);
        console.log(`  ${cyan('tailscale ip -4')}`);
        console.log(`  ${cyan('orcbot gateway --with-agent -p ' + currentPort)}`);
        console.log(`  ${dim('Then browse:')} ${cyan('http://<tailnet-ip>:' + currentPort)}`);
        console.log('');

        const choices: any[] = [];
        if (!tailscaleInstalled) choices.push({ name: `  ⬇️  ${bold('Install Tailscale')}`, value: 'install' });
        else choices.push({ name: `  🔐 ${bold('Run login (tailscale up)')}`, value: 'login' });
        choices.push({ name: `  🧾 ${bold('Show quick commands')}`, value: 'quick' });
        choices.push(new inquirer.Separator(gradient('  ──────────────────────────────────', [c.cyan, c.gray])));
        choices.push({ name: dim('  ← Back'), value: 'back' });

        const { tsAction } = await inquirer.prompt([
            { type: 'list', name: 'tsAction', message: cyan('Tailscale actions:'), choices }
        ]);

        if (tsAction === 'install') {
            const { confirmInstall } = await inquirer.prompt([{ type: 'confirm', name: 'confirmInstall', message: 'Install Tailscale on this host now?', default: true }]);
            if (confirmInstall) {
                console.log('');
                console.log('Installing Tailscale (platform-aware)...');
                try {
                    const platform = process.platform;
                    let installCmd = '';
                    if (platform === 'linux') {
                        installCmd = 'curl -fsSL https://tailscale.com/install.sh | sh';
                    } else if (platform === 'darwin') {
                        installCmd = 'brew install --cask tailscale || brew install tailscale';
                    } else if (platform === 'win32') {
                        // Prefer winget, fallback to choco
                        installCmd = 'winget install --silent --accept-package-agreements --accept-source-agreements Tailscale.Tailscale || choco install tailscale -y';
                    } else {
                        installCmd = '';
                    }

                    if (!installCmd) throw new Error(`Unsupported platform: ${process.platform}`);

                    // Run the installer in a shell so complex commands (pipes) work
                    const out = spawnSync(installCmd, { stdio: 'inherit', shell: true });
                    if (out.error) throw out.error;
                    if (out.status !== 0) throw new Error(`Installer exited with code ${out.status}`);

                    console.log(green('Tailscale installation completed.'));
                    console.log('You may need to run:');
                    console.log(`  ${cyan('tailscale up')}`);
                } catch (e: any) {
                    console.error(red(`Installation failed: ${String(e?.message || e)}`));
                    console.log('If automatic install failed, follow the official instructions: https://tailscale.com/download');
                }
            }
        } else if (tsAction === 'login') {
            try {
                console.log('Launching tailscale login flow (this may open a browser)...');
                // Run `tailscale up` which starts interactive login
                const r = spawnSync('tailscale up', { stdio: 'inherit', shell: true });
                if (r.error) throw r.error;
            } catch (e: any) {
                console.error(red(`Failed to run tailscale up: ${String(e?.message || e)}`));
            }
        } else if (tsAction === 'quick') {
            // Quick commands already displayed above — repeat with emphasis
            console.log('');
            console.log(cyan('Quick commands:'));
            console.log(`  ${cyan('tailscale status')}`);
            console.log(`  ${cyan('tailscale ip -4')}`);
            console.log(`  ${cyan('orcbot gateway --with-agent -p ' + currentPort)}`);
            console.log(`  ${dim('Then browse:')} ${cyan('http://<tailnet-ip>:' + currentPort)}`);
        }

        if (!tailscaleInstalled && tsAction !== 'install') {
            console.log(yellow('Tip: Install tailscale first, then rerun this check to confirm status/IP.'));
        }
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
    const ollamaUrl = agent.config.get('ollamaApiUrl') || 'http://localhost:11434';
    const ollamaHelper = new OllamaHelper(ollamaUrl);
    const hasOllama = await ollamaHelper.isRunning();
    const piAiEnabled = agent.config.get('usePiAI') !== false; // true by default

    console.log('');
    const piTuiStatus = isPiTuiAvailable() ? green('installed') : gray('not installed');
    const modelLines = [
        `${dim('Provider')}  ${brightCyan(bold(currentProvider.toUpperCase()))}`,
        `${dim('Model')}     ${bold(currentModel)}`,
        `${dim('pi-ai')}     ${piAiEnabled ? green('enabled (primary)') : gray('disabled (legacy mode)')}`,
        `${dim('pi-tui')}    ${piTuiStatus}`,
    ];
    box(modelLines, { title: '⭐ ACTIVE MODEL', width: 52, color: c.brightCyan });

    console.log('');
    const providerLines = [
        `${statusDot(hasOpenAI, '')}  ${bold('OpenAI')}       ${hasOpenAI ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasOpenRouter, '')}  ${bold('OpenRouter')}   ${hasOpenRouter ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasOllama, '')}  ${bold('Ollama')}       ${hasOllama ? green('Online') : gray('Offline')}`,
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
                { name: `  🔄 ${bold('pi-ai Model Browser')} ${dim(`(${piAiEnabled ? 'active · 15+ providers' : 'disabled'})`)}`, value: 'pi_ai' },
                new inquirer.Separator(gradient('  ─── Per-Provider Config ──────────', [c.green, c.gray])),
                { name: `  ${statusDot(hasOpenAI, '')} OpenAI ${dim('(GPT-4, etc.)')}`, value: 'openai' },
                { name: `  ${statusDot(hasOpenRouter, '')} OpenRouter ${dim('(multi-model gateway)')}`, value: 'openrouter' },
                { name: `  ${statusDot(hasOllama, '')} Ollama ${dim('(local models)')}`, value: 'ollama' },
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
    } else if (provider === 'pi_ai') {
        await showPiAIConfig();
    } else if (provider === 'openai') {
        await showOpenAIConfig();
    } else if (provider === 'openrouter') {
        await showOpenRouterConfig();
    } else if (provider === 'ollama') {
        await showOllamaMenu();
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

// ── pi-ai model catalogue ───────────────────────────────────────────
// Catalogue is now fetched dynamically from agent.llm.getPiAICatalogue()

async function showOllamaMenu() {
    console.clear();
    banner();
    sectionHeader('🦙', 'Ollama / Local Models');

    const ollamaUrl = agent.config.get('ollamaApiUrl') || 'http://localhost:11434';
    const helper = new OllamaHelper(ollamaUrl);
    
    const isInstalled = await helper.isInstalled();
    const isRunning = await helper.isRunning();
    const localModels = isRunning ? await helper.listModels() : [];
    const runningModels = isRunning ? await helper.listRunningModels() : [];
    const currentModel = agent.config.get('modelName');
    const currentProvider = agent.config.get('llmProvider');

    console.log('');
    const statusLines = [
        `${dim('Status')}     ${isRunning ? green('● ONLINE') : red('○ OFFLINE')}`,
        `${dim('Installed')}  ${isInstalled ? green('Yes') : yellow('No (Download below)')}`,
        `${dim('URL')}        ${ollamaUrl}`,
    ];
    if (isRunning && runningModels.length > 0) {
        statusLines.push(`${dim('Active')}     ${green(runningModels.map(m => m.name.split(':')[0]).join(', '))}`);
    }
    box(statusLines, { title: '📡 OLLAMA STATUS', width: 52, color: isRunning ? c.brightGreen : c.brightRed });

    if (!isRunning && !isInstalled) {
        console.log(yellow('\n  ⚠ Ollama is not detected on your system.'));
        console.log(dim('  To use local models, please download Ollama and install it first.'));
    } else if (!isRunning) {
        console.log(yellow('\n  ⚠ Ollama is installed but the server is not running.'));
        console.log(dim('  Select "Start Ollama Server" below to launch it.'));
    }

    if (isRunning && localModels.length > 0) {
        console.log('');
        const modelLines = localModels.map(m => 
            `${m === currentModel && currentProvider === 'ollama' ? brightGreen('●') : gray('○')} ${m}`
        );
        box(modelLines, { title: '📦 LOCAL MODELS', width: 52, color: c.brightCyan });
    }

    console.log('');
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Ollama Management:'),
            choices: [
                { name: `  ⭐ ${bold('Set as Primary Provider')}`, value: 'set_primary', disabled: !isRunning },
                { name: `  📦 ${bold('Select Local Model')}`, value: 'select_model', disabled: !isRunning || localModels.length === 0 },
                { name: `  ⬇️  ${bold('Pull New Model')}`, value: 'pull_model', disabled: !isRunning },
                { name: `  🚀 ${bold('Start Ollama Server')}`, value: 'start_server', disabled: isRunning },
                { name: `  🌐 ${bold('Download Ollama')} ${dim('(ollama.com)')}`, value: 'download' },
                { name: `  🔄 ${bold('Refresh Status')}`, value: 'refresh' },
                new inquirer.Separator(gradient('  ─── Configuration ────────────────', [c.cyan, c.gray])),
                { name: `  ⚙️  Set API URL ${dim(`(${ollamaUrl})`)}`, value: 'set_url' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.cyan, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu();
    if (action === 'refresh') return showOllamaMenu();

    if (action === 'download') {
        if (process.platform === 'linux' || process.platform === 'darwin') {
            console.log(yellow('\n  Running Ollama installation script (requires sudo)...'));
            const success = await helper.installOllama((output) => {
                process.stdout.write(dim(output));
            });
            if (success) {
                console.log(green('\n  ✓ Ollama installed successfully.'));
            } else {
                console.log(red('\n  ✗ Installation failed. You may need to run the command manually:'));
                console.log(cyan('  curl -fsSL https://ollama.com/install.sh | sh'));
            }
        } else {
            console.log(yellow('\n  Opening Ollama download page in your browser...'));
            helper.openDownloadPage();
            console.log(dim('  Once installed, restart OrcBot.'));
        }
        await waitKeyPress();
        return showOllamaMenu();
    }

    if (action === 'set_primary') {
        agent.config.set('llmProvider', 'ollama');
        console.log(green('\n  ✓ Ollama set as primary provider.'));
        await waitKeyPress();
        return showOllamaMenu();
    }

    if (action === 'select_model') {
        const { model } = await inquirer.prompt([
            {
                type: 'list',
                name: 'model',
                message: 'Select model to use:',
                choices: localModels.map(m => ({ name: m, value: m }))
            }
        ]);
        agent.config.set('modelName', model);
        agent.config.set('llmProvider', 'ollama');
        console.log(green(`\n  ✓ Active model set to ${model} via Ollama.`));
        await waitKeyPress();
        return showOllamaMenu();
    }

    if (action === 'pull_model') {
        const { modelName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'modelName',
                message: 'Enter model name to pull (e.g. llama3, mistral):',
                validate: (input) => input.length > 0 || 'Please enter a model name.'
            }
        ]);
        console.log(yellow(`\n  Pulling ${modelName}...`));
        
        const success = await helper.pullModel(modelName, (status, completed, total) => {
            if (completed !== undefined && total !== undefined) {
                const percent = Math.round((completed / total) * 100);
                process.stdout.write(`\r  ${cyan('●')} ${status}: ${percent}% (${Math.round(completed/1024/1024)}MB / ${Math.round(total/1024/1024)}MB)      `);
            } else {
                process.stdout.write(`\r  ${cyan('●')} ${status}...                              `);
            }
        });

        if (success) {
            console.log(green(`\n\n  ✓ Model ${modelName} pulled successfully.`));
        } else {
            console.log(red(`\n\n  ✗ Failed to pull model ${modelName}. Check logs for details.`));
        }
        await waitKeyPress();
        return showOllamaMenu();
    }

    if (action === 'start_server') {
        helper.startServer();
        console.log(yellow('\n  Starting Ollama server in background...'));
        console.log(dim('  Checking status...'));
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (await helper.isRunning()) {
                console.log(green('  ✓ Ollama is now online!'));
                break;
            }
        }
        await waitKeyPress();
        return showOllamaMenu();
    }

    if (action === 'set_url') {
        const { url } = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Enter Ollama API URL:',
                default: ollamaUrl
            }
        ]);
        agent.config.set('ollamaApiUrl', url);
        console.log(green(`\n  ✓ Ollama API URL set to ${url}`));
        await waitKeyPress();
        return showOllamaMenu();
    }
}

async function showPiAIConfig() {
    console.clear();
    banner();
    sectionHeader('🔄', 'pi-ai Model Browser');

    const catalogue = await agent.llm.getPiAICatalogue();

    const piAiEnabled = agent.config.get('usePiAI') !== false;
    const currentModel = agent.config.get('modelName') || 'gpt-4o';

    // Key lookup per catalogue provider
    const piKeyMap: Record<string, () => string | undefined> = {
        openai: () => agent.config.get('openaiApiKey'),
        google: () => agent.config.get('googleApiKey'),
        openrouter: () => agent.config.get('openrouterApiKey'),
        'amazon-bedrock': () => agent.config.get('bedrockAccessKeyId'),
        groq: () => agent.config.get('groqApiKey'),
        mistral: () => agent.config.get('mistralApiKey'),
        cerebras: () => agent.config.get('cerebrasApiKey'),
        xai: () => agent.config.get('xaiApiKey'),
        huggingface: () => agent.config.get('huggingfaceApiKey'),
        'kimi-coding': () => agent.config.get('kimiApiKey'),
        minimax: () => agent.config.get('minimaxApiKey'),
        'minimax-cn': () => agent.config.get('minimaxApiKey'),
        zai: () => agent.config.get('zaiApiKey'),
        perplexity: () => agent.config.get('perplexityApiKey'),
        deepseek: () => agent.config.get('deepseekApiKey'),
        opencode: () => agent.config.get('opencodeApiKey'),
        anthropic: () => agent.config.get('anthropicApiKey') || (agent.llm.isPiAiLinked('anthropic') ? 'oauth' : undefined),
        'github-copilot': () => agent.llm.isPiAiLinked('github-copilot') ? 'oauth' : undefined,
        'google-antigravity': () => agent.llm.isPiAiLinked('google-antigravity') ? 'oauth' : undefined,
        'google-gemini-cli': () => agent.llm.isPiAiLinked('google-gemini-cli') ? 'oauth' : undefined,
        'openai-codex': () => agent.llm.isPiAiLinked('openai-codex') ? 'oauth' : undefined,
        'azure-openai-responses': () => agent.config.get('openaiApiKey') && agent.config.get('azureEndpoint'),
        'google-vertex': () => agent.config.get('googleProjectId') && agent.config.get('googleLocation'),
    };
    // Config key to store when the user enters a key for a pi-ai provider
    const piConfigKey: Record<string, string> = {
        openai: 'openaiApiKey', google: 'googleApiKey', anthropic: 'anthropicApiKey',
        openrouter: 'openrouterApiKey', 'amazon-bedrock': 'bedrockAccessKeyId',
        groq: 'groqApiKey', mistral: 'mistralApiKey', cerebras: 'cerebrasApiKey', xai: 'xaiApiKey',
        huggingface: 'huggingfaceApiKey', 'kimi-coding': 'kimiApiKey', minimax: 'minimaxApiKey',
        'minimax-cn': 'minimaxApiKey', zai: 'zaiApiKey', perplexity: 'perplexityApiKey',
        deepseek: 'deepseekApiKey', opencode: 'opencodeApiKey',
        'azure-openai-responses': 'openaiApiKey', // Primary key
        'google-vertex': 'googleProjectId', // Primary field
    };

    console.log('');
    box([
        `${dim('Status')}   ${piAiEnabled ? green('Enabled (primary transport)') : yellow('Disabled (legacy mode)')}`,
        `${dim('Model')}    ${bold(currentModel)}`,
        `${dim('Providers')} ${cyan(String(Object.keys(catalogue).length))} providers found dynamically`,
    ], { title: '🔄 pi-ai STATUS', width: 58, color: piAiEnabled ? c.green : c.yellow });
    console.log('');

    const topChoices: any[] = [
        { name: `  ${piAiEnabled ? '✅ Disable pi-ai' : '🔄 Enable pi-ai'} ${dim('(toggle)')}`, value: 'toggle' },
        { name: `  📦 ${bold('Check for Catalog Updates')} ${dim('(npm update)')}`, value: 'update_catalog' },
        new inquirer.Separator(gradient('  ─── Browse & Select Model ────────────', [c.brightCyan, c.gray])),
        ...Object.entries(catalogue).map(([key, cat]: [string, any]) => {
            const hasKey = !!(piKeyMap[key] ? piKeyMap[key]() : undefined);
            return {
                name: `  ${statusDot(hasKey, '')} ${bold(cat.label.padEnd(32))} ${hasKey ? green('key set') : yellow('no key')}  ${dim(`${cat.models.length} models`)}`,
                value: `cat:${key}`,
            };
        }),
        new inquirer.Separator(gradient('  ────────────────────────────────────', [c.brightCyan, c.gray])),
        { name: dim('  ← Back'), value: 'back' },
    ];

    const { choice } = await inquirer.prompt([{
        type: 'list', name: 'choice',
        message: cyan('pi-ai options:'),
        choices: topChoices,
    }]);

    if (choice === 'back') return showModelsMenu();

    if (choice === 'toggle') {
        const newVal = !piAiEnabled;
        agent.config.set('usePiAI', newVal);
        console.log(newVal ? green('pi-ai enabled — it will be tried first on every LLM call') : yellow('pi-ai disabled — using legacy provider code directly'));
        await waitKeyPress();
        return showPiAIConfig();
    }

    if (choice === 'update_catalog') {
        await performPiAIUpdate();
        return showPiAIConfig();
    }

    if ((choice as string).startsWith('cat:')) {
        const catKey = (choice as string).slice(4);
        const cat = catalogue[catKey];
        const hasKey = !!(piKeyMap[catKey] ? piKeyMap[catKey]() : undefined);

        const modelChoices = cat.models.map(m => ({
            name: `  ${bold(m.id.padEnd(46))} ${dim(m.note)}`,
            value: m.id,
        }));
        modelChoices.push({ name: dim('  ✏️  Enter custom model ID...'), value: '__custom__' } as any);
        if (!hasKey) {
            modelChoices.push({ name: yellow(`  🔑 Set ${cat.label} API key first`), value: '__setkey__' } as any);
        }
        modelChoices.push({ name: dim('  ← Back'), value: '__back__' } as any);

        const { selectedModel } = await inquirer.prompt([{
            type: 'list', name: 'selectedModel',
            message: cyan(`${cat.label}${hasKey ? '' : yellow(' ⚠ no key set')} — select model:`),
            choices: modelChoices,
        }]);

        if (selectedModel === '__back__') return showPiAIConfig();

        if (selectedModel === '__setkey__') {
            const oauthProvider = ['github-copilot', 'google-antigravity', 'google-gemini-cli', 'openai-codex', 'opencode'].includes(catKey);

            if (oauthProvider) {
                const { doLogin } = await inquirer.prompt([{
                    type: 'confirm', name: 'doLogin',
                    message: `${cat.label} requires OAuth. Authorize & Login now?`,
                    default: true,
                }]);

                if (doLogin) {
                    console.log(cyan(`\n  Opening browser for ${cat.label} authorization...`));
                    await agent.llm.piAiLogin(catKey);
                    console.log(green(`\n  Login process completed. Try selecting a model again.`));
                } else {
                    console.log(yellow(`\n  ℹ  Manual login instructions:`));
                    console.log(`     Run: ${bold(`npx @mariozechner/pi-ai /login ${catKey}`)}`);
                }
            } else if (catKey === 'azure-openai-responses') {
                const { endpoint } = await inquirer.prompt([{
                    type: 'input', name: 'endpoint',
                    message: `Enter Azure OpenAI Endpoint URL (e.g. https://NAME.openai.azure.com/):`,
                    default: agent.config.get('azureEndpoint'),
                }]);
                if (endpoint?.trim()) agent.config.set('azureEndpoint', endpoint.trim());

                const { keyVal } = await inquirer.prompt([{
                    type: 'input', name: 'keyVal',
                    message: `Enter Azure OpenAI API Key:`,
                    default: agent.config.get('openaiApiKey'),
                }]);
                if (keyVal?.trim()) agent.config.set('openaiApiKey', keyVal.trim());

                console.log(green(`Azure OpenAI credentials saved.`));
            } else if (catKey === 'google-vertex') {
                const { project } = await inquirer.prompt([{
                    type: 'input', name: 'project',
                    message: `Enter Google Cloud Project ID:`,
                    default: agent.config.get('googleProjectId'),
                }]);
                if (project?.trim()) agent.config.set('googleProjectId', project.trim());

                const { location } = await inquirer.prompt([{
                    type: 'input', name: 'location',
                    message: `Enter Vertex AI Location (e.g. us-central1):`,
                    default: agent.config.get('googleLocation'),
                }]);
                if (location?.trim()) agent.config.set('googleLocation', location.trim());

                console.log(green(`Google Vertex credentials saved.`));
            } else {
                const cfgKey = piConfigKey[catKey];
                if (cfgKey) {
                    const { keyVal } = await inquirer.prompt([{
                        type: 'input', name: 'keyVal',
                        message: `Enter ${cat.label} API key:`,
                        default: agent.config.get(cfgKey),
                    }]);
                    if (keyVal?.trim()) {
                        agent.config.set(cfgKey, keyVal.trim());
                        console.log(green(`${cat.label} API key saved.`));
                    }
                }
            }
            await waitKeyPress();
            return showPiAIConfig();
        }

        let finalModel = selectedModel;
        if (selectedModel === '__custom__') {
            const { custom } = await inquirer.prompt([{
                type: 'input', name: 'custom',
                message: `Enter ${cat.label} model ID:`,
                default: currentModel,
            }]);
            finalModel = custom;
        }

        agent.config.set('modelName', finalModel);
        // Sync llmProvider so the Active Model box reflects the real provider
        const legacyMap: Record<string, string> = {
            openai: 'openai',
            google: 'google',
            anthropic: 'anthropic',
            openrouter: 'openrouter',
            'amazon-bedrock': 'bedrock',
            groq: 'groq',
            mistral: 'mistral',
            deepseek: 'deepseek',
            xai: 'xai',
            perplexity: 'perplexity',
            cerebras: 'cerebras'
        };
        const legacyProvider = legacyMap[catKey];
        if (legacyProvider !== undefined) {
            agent.config.set('llmProvider', legacyProvider as any);
        } else {
            // Unmapped provider — fallback to auto
            agent.config.set('llmProvider', undefined);
        }
        if (!piAiEnabled) agent.config.set('usePiAI', true);

        // If no key is set for this provider, ask now
        const keyAfterSelect = piKeyMap[catKey] ? piKeyMap[catKey]() : undefined;
        if (!keyAfterSelect && piConfigKey[catKey]) {
            console.log('');
            console.log(yellow(`⚠  No API key configured for ${cat.label}.`));
            const { setNow } = await inquirer.prompt([{
                type: 'confirm', name: 'setNow',
                message: `Set ${cat.label} API key now?`,
                default: true,
            }]);
            if (setNow) {
                const { keyVal } = await inquirer.prompt([{
                    type: 'input', name: 'keyVal',
                    message: `Enter ${cat.label} API key:`,
                }]);
                if (keyVal?.trim()) {
                    agent.config.set(piConfigKey[catKey], keyVal.trim());
                    console.log(green(`${cat.label} API key saved.`));
                }
            }
        }

        console.log(green(`Model set to: ${finalModel}`));
        await waitKeyPress();
        return showPiAIConfig();
    }

    return showPiAIConfig();
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
    console.clear();
    banner();
    sectionHeader('🤖', 'Google Gemini (Cloud API)');

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('googleApiKey') || 'Not Set';

    console.log(dim('\n  Note: This is for Google\'s Cloud API.'));
    console.log(dim('  If you are using a Gemini model via Ollama, use the "Ollama" menu instead.\n'));

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

async function showWorldEventsMenu() {
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

    console.clear();
    banner();
    sectionHeader('🌍', 'World Events');
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
    box(lines, { title: '🌍 WORLD EVENTS', width: 56, color: c.brightBlue });
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
        return showWorldEventsMenu();
    }

    if (action === 'refresh') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Refresh interval in seconds:', default: refreshSeconds }
        ]);
        agent.config.set('worldEventsRefreshSeconds', Number(val) || refreshSeconds);
        return showWorldEventsMenu();
    }

    if (action === 'lookback') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Lookback window in minutes:', default: lookbackMinutes }
        ]);
        agent.config.set('worldEventsLookbackMinutes', Number(val) || lookbackMinutes);
        return showWorldEventsMenu();
    }

    if (action === 'max') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Max records per fetch:', default: maxRecords }
        ]);
        agent.config.set('worldEventsMaxRecords', Number(val) || maxRecords);
        return showWorldEventsMenu();
    }

    if (action === 'batch') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Batch window in minutes:', default: batchMinutes }
        ]);
        agent.config.set('worldEventsBatchMinutes', Number(val) || batchMinutes);
        return showWorldEventsMenu();
    }

    if (action === 'query') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'GDELT query filter:', default: gdeltQuery }
        ]);
        agent.config.set('worldEventsGdeltQuery', String(val || 'global'));
        return showWorldEventsMenu();
    }

    if (action === 'globe_mode') {
        const { val } = await inquirer.prompt([
            {
                type: 'list',
                name: 'val',
                message: 'Select globe renderer:',
                choices: [
                    { name: 'mapscii (full-screen map)', value: 'mapscii' },
                    { name: 'Flat map (embedded)', value: 'map' },
                    { name: 'Built-in ASCII globe', value: 'ascii' },
                    { name: 'External CLI globe', value: 'external' }
                ]
            }
        ]);
        agent.config.set('worldEventsGlobeRenderer', val);
        return showWorldEventsMenu();
    }

    if (action === 'globe_cmd') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'External globe CLI command:', default: globeCommand }
        ]);
        agent.config.set('worldEventsGlobeCommand', String(val || 'globe'));
        return showWorldEventsMenu();
    }

    if (action === 'globe_args') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'External globe CLI args (space-separated):', default: globeArgs.join(' ') }
        ]);
        agent.config.set('worldEventsGlobeArgs', parseGlobeArgs(val));
        return showWorldEventsMenu();
    }

    if (action === 'toggle_store') {
        agent.config.set('worldEventsStoreEnabled', !storeEnabled);
        return showWorldEventsMenu();
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
            store: storeEnabled
        });
        await waitKeyPress();
        return showWorldEventsMenu();
    }
}

async function showConnectionsMenu() {
    console.clear();
    banner();
    sectionHeader('🔌', 'Connections');

    const hasTelegram = !!agent.config.get('telegramToken');
    const hasWhatsapp = !!agent.config.get('whatsappEnabled');
    const hasDiscord = !!agent.config.get('discordToken');
    const hasSlack = !!agent.config.get('slackBotToken');
    const hasEmail = !!agent.config.get('emailEnabled');
    const tgAuto = agent.config.get('telegramAutoReplyEnabled');
    const waAuto = agent.config.get('whatsappAutoReplyEnabled');
    const dcAuto = agent.config.get('discordAutoReplyEnabled');
    const slAuto = agent.config.get('slackAutoReplyEnabled');
    const emAuto = agent.config.get('emailAutoReplyEnabled');

    console.log('');
    const channelLines = [
        `${statusDot(hasTelegram, '')} ${bold('Telegram')}    ${hasTelegram ? green('Connected') : gray('Not configured')}  ${tgAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasWhatsapp, '')} ${bold('WhatsApp')}    ${hasWhatsapp ? green('Enabled') : gray('Disabled')}        ${waAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasDiscord, '')} ${bold('Discord')}     ${hasDiscord ? green('Connected') : gray('Not configured')}  ${dcAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasSlack, '')} ${bold('Slack')}       ${hasSlack ? green('Connected') : gray('Not configured')}  ${slAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasEmail, '')} ${bold('Email')}       ${hasEmail ? green('Enabled') : gray('Not configured')}  ${emAuto ? dim('auto-reply ✓') : ''}`,
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
                { name: `  ${hasSlack ? '💼' : '  '} ${bold('Slack Bot')}         ${hasSlack ? green('●') : gray('○')}`, value: 'slack' },
                { name: `  ${hasEmail ? '📧' : '  '} ${bold('Email (SMTP/IMAP)')}  ${hasEmail ? green('●') : gray('○')}`, value: 'email' },
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
    } else if (channel === 'slack') {
        await showSlackConfig();
    } else if (channel === 'email') {
        await showEmailConfig();
    }
}

async function showTelegramConfig() {
    const currentToken = agent.config.get('telegramToken') || 'Not Set';
    const autoReply = agent.config.get('telegramAutoReplyEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('telegram');
    console.clear();
    banner();
    sectionHeader('✈️', 'Telegram Settings');
    console.log('');
    const tgLines = [
        `${dim('Token')}       ${currentToken === 'Not Set' ? gray('Not Set') : green(currentToken.substring(0, 12) + '…')}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}    ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
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
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
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
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('telegram');
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
    const autonomyAllowed = isAutonomyEnabledForChannel('whatsapp');

    console.clear();
    banner();
    sectionHeader('💬', 'WhatsApp Settings');
    console.log('');
    const onOff = (v: any) => v ? green(bold('● ON')) : gray('○ OFF');
    const waLines = [
        `${dim('Status')}            ${enabled ? green(bold('ENABLED')) : red(bold('DISABLED'))}`,
        `${dim('Linked Account')}    ${ownerJid === 'Not Linked' ? gray(ownerJid) : cyan(ownerJid)}`,
        `${dim('Autonomy')}          ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
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
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: statusReply ? 'Disable Status Interactions' : 'Enable Status Interactions', value: 'toggle_status' },
                { name: autoReact ? 'Disable Auto-React' : 'Enable Auto-React', value: 'toggle_react' },
                { name: contextProfiling ? 'Disable Context Profiling' : 'Enable Context Profiling', value: 'toggle_profile' },
                { name: 'Run Context Profiling (Batch)', value: 'trigger_profiling' },
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
        case 'toggle_autonomy':
            toggleAutonomyChannel('whatsapp');
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
        case 'trigger_profiling': {
            if (!agent.whatsapp) {
                console.log(red('\nWhatsApp is not connected.'));
                await waitKeyPress();
                break;
            }

            const contacts = agent.whatsapp.getRecentContacts();
            if (contacts.length === 0) {
                console.log(yellow('\nNo recent contacts found to profile.'));
                await waitKeyPress();
                break;
            }

            const duration = agent.estimateProfilingDuration(contacts.length);

            console.log('\n' + c.bgYellow + c.black + ' ⚠️  HEAVY TASK WARNING ' + c.reset);
            console.log(yellow('Context profiling reads past chat history and uses AI to build relationship context.'));
            console.log(`${dim('contacts:')}      ${contacts.length}`);
            console.log(`${dim('estimated duration:')} ~${duration} minutes`);
            console.log(dim('costs: LLM tokens will be consumed for each contact.'));
            console.log('');

            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Do you want to proceed with profiling?', default: false }
            ]);

            if (!confirm) break;

            console.log('\n' + cyan('Starting context profiling...'));

            // Progress bar helper (simple)
            const updateProgress = (processed: number, total: number, name: string) => {
                const percent = Math.round((processed / total) * 100);
                const barWidth = 20;
                const filled = Math.round((processed / total) * barWidth);
                const empty = barWidth - filled;
                const bar = '█'.repeat(filled) + '░'.repeat(empty);
                process.stdout.write(`\r[${bar}] ${percent}% | Analyzing: ${name.substring(0, 20).padEnd(20)}`);
            };

            const result = await agent.profileWhatsAppHistory(contacts, 20, updateProgress);

            process.stdout.write('\r' + ' '.repeat(70) + '\r'); // Clear progress line
            console.log(green(`\n\n✅ Profiling complete! ${result.updated} contacts updated.`));
            await waitKeyPress();
            break;
        }
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

async function showSlackConfig() {
    const currentToken = agent.config.get('slackBotToken') || 'Not Set';
    const currentAppToken = agent.config.get('slackAppToken') || 'Not Set';
    const currentSigningSecret = agent.config.get('slackSigningSecret') || 'Not Set';
    const autoReply = agent.config.get('slackAutoReplyEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('slack');
    console.clear();
    banner();
    sectionHeader('💼', 'Slack Settings');
    console.log('');
    const slLines = [
        `${dim('Bot Token')}   ${currentToken === 'Not Set' ? gray('Not Set') : green(currentToken.substring(0, 8) + '…' + currentToken.slice(-4))}`,
        `${dim('App Token')}   ${currentAppToken === 'Not Set' ? gray('Not Set') : green(currentAppToken.substring(0, 8) + '…' + currentAppToken.slice(-4))}`,
        `${dim('Signing Secret')} ${currentSigningSecret === 'Not Set' ? gray('Not Set') : green(currentSigningSecret.substring(0, 6) + '…' + currentSigningSecret.slice(-4))}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}    ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
    ];
    box(slLines, { title: '💼 SLACK', width: 46, color: c.brightCyan });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Slack Options:',
            choices: [
                { name: 'Set Bot Token', value: 'set' },
                { name: 'Set App Token (Socket Mode)', value: 'set_app' },
                { name: 'Set Signing Secret', value: 'set_signing' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: 'Test Connection', value: 'test' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu();

    if (action === 'set') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Slack Bot Token (xoxb-...):' }
        ]);
        agent.config.set('slackBotToken', token);
        console.log('Token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showSlackConfig();
    } else if (action === 'set_app') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Slack App Token (xapp-...):' }
        ]);
        agent.config.set('slackAppToken', token);
        console.log('App token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showSlackConfig();
    } else if (action === 'set_signing') {
        const { secret } = await inquirer.prompt([
            { type: 'input', name: 'secret', message: 'Enter Slack Signing Secret:' }
        ]);
        agent.config.set('slackSigningSecret', secret);
        console.log('Signing secret updated! (Restart required for token changes)');
        await waitKeyPress();
        return showSlackConfig();
    } else if (action === 'toggle_auto') {
        agent.config.set('slackAutoReplyEnabled', !autoReply);
        return showSlackConfig();
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('slack');
        return showSlackConfig();
    } else if (action === 'test') {
        if (!agent.slack) {
            console.log('Slack channel not initialized. Please set a token and restart.');
        } else {
            console.log('Testing Slack connection...');
            try {
                await agent.slack.start();
                console.log(green('  ✓ Slack auth successful!'));
            } catch (error: any) {
                console.log(red(`  ✗ Connection test failed: ${error.message}`));
            }
        }
        await waitKeyPress();
        return showSlackConfig();
    }
}


async function showEmailConfig() {
    const enabled = agent.config.get('emailEnabled') === true;
    const autoReply = agent.config.get('emailAutoReplyEnabled') === true;
    const processUnreadOnStart = agent.config.get('emailProcessUnreadOnStart') === true;
    const emailAddress = agent.config.get('emailAddress') || agent.config.get('smtpUsername') || 'Not Set';
    const smtpHost = agent.config.get('smtpHost') || 'Not Set';
    const imapHost = agent.config.get('imapHost') || 'Not Set';
    const smtpSecure = agent.config.get('smtpSecure') === true;
    const smtpStartTls = agent.config.get('smtpStartTls') !== false;
    const imapSecure = agent.config.get('imapSecure') !== false;
    const imapStartTls = agent.config.get('imapStartTls') !== false;
    const timeoutMs = Number(agent.config.get('emailSocketTimeoutMs') || 15000);
    const autonomyAllowed = isAutonomyEnabledForChannel('email');

    console.clear();
    banner();
    sectionHeader('📧', 'Email Settings');
    console.log('');
    const lines = [
        `${dim('Enabled')}      ${enabled ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Address')}      ${emailAddress === 'Not Set' ? gray('Not Set') : green(emailAddress)}`,
        `${dim('Autonomy')}     ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
        `${dim('SMTP')}         ${smtpHost}`,
        `${dim('IMAP')}         ${imapHost}`,
        `${dim('SMTP Security')} ${smtpSecure ? green('Direct TLS (SMTPS)') : (smtpStartTls ? green('STARTTLS') : yellow('Plain (not recommended)'))}`,
        `${dim('IMAP Security')} ${imapSecure ? green('Direct TLS (IMAPS)') : (imapStartTls ? green('STARTTLS') : yellow('Plain (not recommended)'))}`,
        `${dim('Socket Timeout')} ${timeoutMs}ms`,
        `${dim('Auto-Reply')}   ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Startup Inbox')} ${processUnreadOnStart ? yellow('Process existing unread') : green('Ignore existing unread')}`,
    ];
    box(lines, { title: '📧 EMAIL', width: 58, color: c.yellow });
    console.log(dim('SMTP = sending outbound mail.'));
    console.log(dim('IMAP = reading inbound inbox (auto-reply/tasks). Not required for SMTP-only sending/tests.'));
    console.log(dim('Default: OrcBot ignores unread backlog on connect and only processes new inbound mail.'));
    console.log(dim('Enable startup backlog processing only if you intentionally want the agent to catch up on old unread mail.'));
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Email Options:',
            choices: [
                { name: enabled ? 'Disable Email Channel' : 'Enable Email Channel', value: 'toggle_enabled' },
                { name: 'Set Email Address', value: 'set_email' },
                { name: 'Set SMTP Settings', value: 'set_smtp' },
                { name: 'Set IMAP Settings', value: 'set_imap' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: processUnreadOnStart ? 'Disable Startup Backlog Processing' : 'Enable Startup Backlog Processing', value: 'toggle_startup_backlog' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: 'Test SMTP Connection', value: 'test_smtp' },
                { name: 'Test IMAP Connection', value: 'test_imap' },
                { name: 'Test SMTP + IMAP Connection', value: 'test' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu();

    if (action === 'toggle_enabled') {
        const next = !enabled;
        agent.config.set('emailEnabled', next);
        if (next && !agent.email) {
            agent.setupChannels();
        }
        return showEmailConfig();
    }

    if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('email');
        return showEmailConfig();
    }

    if (action === 'set_email') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'emailAddress', message: 'Email Address (From):', default: agent.config.get('emailAddress') || '' },
            { type: 'input', name: 'emailFromName', message: 'From Name:', default: agent.config.get('emailFromName') || agent.config.get('agentName') || 'OrcBot' },
            { type: 'input', name: 'emailDefaultSubject', message: 'Default Subject:', default: agent.config.get('emailDefaultSubject') || 'OrcBot response' },
            { type: 'number', name: 'emailSocketTimeoutMs', message: 'Socket Timeout (ms):', default: agent.config.get('emailSocketTimeoutMs') || 15000 },
        ]);
        agent.config.set('emailAddress', ans.emailAddress);
        agent.config.set('emailFromName', ans.emailFromName);
        agent.config.set('emailDefaultSubject', ans.emailDefaultSubject);
        agent.config.set('emailSocketTimeoutMs', Math.max(3000, Number(ans.emailSocketTimeoutMs) || 15000));
        return showEmailConfig();
    }

    if (action === 'set_smtp') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'smtpHost', message: 'SMTP Host:', default: agent.config.get('smtpHost') || '' },
            { type: 'number', name: 'smtpPort', message: 'SMTP Port:', default: agent.config.get('smtpPort') || 587 },
            { type: 'confirm', name: 'smtpSecure', message: 'Use TLS (SMTPS)?', default: agent.config.get('smtpSecure') === true },
            { type: 'confirm', name: 'smtpStartTls', message: 'Use STARTTLS upgrade (recommended for port 587)?', default: agent.config.get('smtpStartTls') !== false, when: (a) => !a.smtpSecure },
            { type: 'input', name: 'smtpUsername', message: 'SMTP Username:', default: agent.config.get('smtpUsername') || '' },
            { type: 'password', name: 'smtpPassword', message: 'SMTP Password (leave blank to keep current):' },
        ]);
        agent.config.set('smtpHost', ans.smtpHost);
        agent.config.set('smtpPort', Number(ans.smtpPort) || 587);
        agent.config.set('smtpSecure', !!ans.smtpSecure);
        if (!ans.smtpSecure) agent.config.set('smtpStartTls', ans.smtpStartTls !== false);
        agent.config.set('smtpUsername', ans.smtpUsername);
        if (ans.smtpPassword) agent.config.set('smtpPassword', ans.smtpPassword);
        return showEmailConfig();
    }

    if (action === 'set_imap') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'imapHost', message: 'IMAP Host:', default: agent.config.get('imapHost') || '' },
            { type: 'number', name: 'imapPort', message: 'IMAP Port:', default: agent.config.get('imapPort') || 993 },
            { type: 'confirm', name: 'imapSecure', message: 'Use TLS (IMAPS)?', default: agent.config.get('imapSecure') !== false },
            { type: 'confirm', name: 'imapStartTls', message: 'Use STARTTLS upgrade (recommended for port 143)?', default: agent.config.get('imapStartTls') !== false, when: (a) => !a.imapSecure },
            { type: 'input', name: 'imapUsername', message: 'IMAP Username:', default: agent.config.get('imapUsername') || '' },
            { type: 'password', name: 'imapPassword', message: 'IMAP Password (leave blank to keep current):' },
        ]);
        agent.config.set('imapHost', ans.imapHost);
        agent.config.set('imapPort', Number(ans.imapPort) || 993);
        agent.config.set('imapSecure', !!ans.imapSecure);
        if (!ans.imapSecure) agent.config.set('imapStartTls', ans.imapStartTls !== false);
        agent.config.set('imapUsername', ans.imapUsername);
        if (ans.imapPassword) agent.config.set('imapPassword', ans.imapPassword);
        return showEmailConfig();
    }

    if (action === 'toggle_auto') {
        agent.config.set('emailAutoReplyEnabled', !autoReply);
        return showEmailConfig();
    }

    if (action === 'toggle_startup_backlog') {
        agent.config.set('emailProcessUnreadOnStart', !processUnreadOnStart);
        return showEmailConfig();
    }

    if (action === 'test_smtp' || action === 'test_imap' || action === 'test') {
        if (!agent.email) {
            agent.setupChannels();
        }
        if (!agent.email) {
            console.log('Email channel not available. Configure SMTP/IMAP credentials first.');
        } else {
            const label = action === 'test_smtp' ? 'SMTP' : action === 'test_imap' ? 'IMAP' : 'SMTP + IMAP';
            console.log(`Testing Email ${label}...`);
            try {
                if (action === 'test_smtp') {
                    await agent.email.testSmtpConnection();
                    console.log(green('  ✓ SMTP connection test successful (outbound send).'));
                } else if (action === 'test_imap') {
                    await agent.email.testImapConnection();
                    console.log(green('  ✓ IMAP connection test successful (inbox access).'));
                } else {
                    await agent.email.testConnections();
                    console.log(green('  ✓ Email connection test successful (SMTP send + IMAP access).'));
                }
            } catch (error: any) {
                console.log(red(`  ✗ ${label} connection test failed: ${error.message}`));
            }
        }
        await waitKeyPress();
        return showEmailConfig();
    }
}

async function showDiscordConfig() {
    const currentToken = agent.config.get('discordToken') || 'Not Set';
    const autoReply = agent.config.get('discordAutoReplyEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('discord');
    console.clear();
    banner();
    sectionHeader('🎮', 'Discord Settings');
    console.log('');
    const dcLines = [
        `${dim('Token')}       ${currentToken === 'Not Set' ? gray('Not Set') : green('***' + currentToken.slice(-8))}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}    ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
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
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
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
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('discord');
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

async function showWorldGovernanceMenu() {
    console.clear();
    banner();
    sectionHeader('🌍', 'World Governance');

    const worldPath = agent.config.get('worldPath');
    let worldContent = '';
    try {
        if (require('fs').existsSync(worldPath)) {
            worldContent = require('fs').readFileSync(worldPath, 'utf-8');
        } else {
            worldContent = '(WORLD.md not found)';
        }
    } catch (e) {
        worldContent = `(Error reading WORLD.md: ${e})`;
    }

    const preview = worldContent.length > 800 ? worldContent.slice(0, 800) + '...' : worldContent;
    
    box([preview || '(Empty)'], { title: '📜 WORLD.MD PREVIEW', width: 64, color: c.brightBlue });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Governance Options:'),
            choices: [
                { name: `  📝 ${bold('Edit WORLD.md (Manual)')}`, value: 'edit' },
                { name: `  🤖 ${bold('Ask Agent to Update World')}`, value: 'agent_update' },
                { name: `  👥 ${bold('View Peer Agent Worlds')}`, value: 'peers' },
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'edit': {
            console.log(yellow('\nOpening WORLD.md in your default editor...'));
            // Use OS-specific open command
            const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            require('child_process').spawn(cmd, [worldPath], { shell: true });
            await waitKeyPress();
            return showWorldGovernanceMenu();
        }
        case 'agent_update': {
            const { topic, content } = await inquirer.prompt([
                { type: 'input', name: 'topic', message: 'Governance Topic (e.g. "Security Protocol"):', validate: (v: string) => v.trim().length > 0 || 'Topic required' },
                { type: 'input', name: 'content', message: 'Rules/Content:', validate: (v: string) => v.trim().length > 0 || 'Content required' }
            ]);
            
            try {
                const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n**User Entry via TUI**\n\n${content}\n\n---`;
                require('fs').appendFileSync(worldPath, entry);
                console.log(green('\n✅ WORLD.md updated successfully.'));
            } catch (e: any) {
                console.log(red(`\n❌ Failed to update world: ${e.message}`));
            }
            await waitKeyPress();
            return showWorldGovernanceMenu();
        }
        case 'peers': {
            const orchestrator = agent.orchestrator;
            const status = orchestrator.getStatus();
            if (status.activeAgents <= 1) { // Primary is 1
                console.log(yellow('\nNo peer agents found.'));
                await waitKeyPress();
                return showWorldGovernanceMenu();
            }

            const peers = orchestrator.getAgents().filter(a => a.id !== 'primary' && a.status !== 'terminated');
            const { peerId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'peerId',
                    message: 'Select peer to view their world state:',
                    choices: peers.map(p => ({ name: `${p.name} (${p.role})`, value: p.id }))
                }
            ]);

            const peer = orchestrator.getAgent(peerId);
            if (peer) {
                const peerWorldPath = require('path').join(require('path').dirname(peer.memoryPath), 'WORLD.md');
                if (require('fs').existsSync(peerWorldPath)) {
                    const peerWorld = require('fs').readFileSync(peerWorldPath, 'utf-8');
                    console.clear();
                    banner();
                    sectionHeader('👥', `${peer.name}'s World`);
                    box(peerWorld.split('\n'), { title: '📜 PEER WORLD.MD', width: 64, color: c.magenta });
                } else {
                    console.log(red('\n❌ Peer WORLD.md not found.'));
                }
            }
            await waitKeyPress();
            return showWorldGovernanceMenu();
        }
    }
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

async function showAgenticUserMenu() {
    console.clear();
    banner();
    sectionHeader('🤖', 'Agentic User (HITL Proxy)');

    const au = agent.agenticUser;
    const settings = au.getSettings();
    const stats = au.getStats();
    const isActive = au.isActive();

    console.log('');
    const enabledBadge = settings.enabled
        ? (isActive ? green(bold('● ACTIVE')) : yellow(bold('● ENABLED (not running)')))
        : gray(bold('○ DISABLED'));
    const proactiveBadge = settings.proactiveGuidance ? green('ON') : gray('OFF');

    const notifyUser = agent.config.get('agenticUserNotifyUser') !== false;
    const notifyBadge = notifyUser ? green('ON') : gray('OFF');

    const auLines = [
        `${dim('Status')}         ${enabledBadge}`,
        `${dim('Response Delay')} ${cyan(bold(String(settings.responseDelay)))}${dim('s')}  ${dim('(wait before intervening)')}`,
        `${dim('Confidence')}     ${cyan(bold(String(settings.confidenceThreshold)))}${dim('%')}  ${dim('(min to auto-intervene)')}`,
        `${dim('Proactive')}      ${proactiveBadge}  ${dim(`after ${settings.proactiveStepThreshold} steps`)}`,
        `${dim('Notify User')}    ${notifyBadge}  ${dim('(send updates to channel)')}`,
        `${dim('Max per Action')} ${cyan(bold(String(settings.maxInterventionsPerAction)))}`,
        `${dim('Check Interval')} ${cyan(bold(String(settings.checkIntervalSeconds)))}${dim('s')}`,
        '',
        `${dim('Interventions')}  ${cyan(bold(String(stats.totalInterventions)))} total  ${dim('│')}  ${green(bold(String(stats.appliedInterventions)))} applied`,
        `${dim('Active Timers')}  ${cyan(bold(String(stats.activeTimers)))}`,
    ];
    box(auLines, { title: '🤖 AGENTIC USER STATUS', width: 56, color: isActive ? c.green : c.gray });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Agentic User Options:'),
            choices: [
                new inquirer.Separator(gradient('  ─── Control ──────────────────────', [c.cyan, c.gray])),
                {
                    name: settings.enabled
                        ? `  ${red('○')} ${bold('Disable')} Agentic User`
                        : `  ${green('●')} ${bold('Enable')} Agentic User`, value: 'toggle'
                },
                new inquirer.Separator(gradient('  ─── Settings ─────────────────────', [c.yellow, c.gray])),
                { name: `  ⏱️  Response Delay ${dim(`(${settings.responseDelay}s)`)}`, value: 'response_delay' },
                { name: `  📊 Confidence Threshold ${dim(`(${settings.confidenceThreshold}%)`)}`, value: 'confidence' },
                { name: `  🔄 Proactive Guidance ${dim(`(${proactiveBadge})`)}`, value: 'proactive' },
                { name: `  📈 Proactive Step Threshold ${dim(`(${settings.proactiveStepThreshold})`)}`, value: 'step_threshold' },
                { name: `  🔁 Check Interval ${dim(`(${settings.checkIntervalSeconds}s)`)}`, value: 'check_interval' },
                { name: `  🚫 Max Interventions/Action ${dim(`(${settings.maxInterventionsPerAction})`)}`, value: 'max_interventions' },
                { name: `  🔔 Notify User on Intervention ${dim(`(${notifyBadge})`)}`, value: 'notify_user' },
                new inquirer.Separator(gradient('  ─── History ──────────────────────', [c.magenta, c.gray])),
                { name: `  📜 View Intervention Log ${dim(`(${stats.totalInterventions} entries)`)}`, value: 'view_log' },
                { name: `  🗑️  Clear History`, value: 'clear_history' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'toggle': {
            const newVal = !settings.enabled;
            agent.config.set('agenticUserEnabled', newVal);
            au.reloadSettings();
            console.log(newVal
                ? `\n${green('●')} Agentic User ${green(bold('enabled'))}. It will monitor actions and intervene when confident.`
                : `\n${gray('○')} Agentic User ${gray(bold('disabled'))}. No autonomous interventions will occur.`);
            break;
        }
        case 'response_delay': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Response delay in seconds (current: ${settings.responseDelay}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 0 ? true : 'Enter a non-negative number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserResponseDelay', Number(val));
                au.reloadSettings();
                console.log(`\n⏱️  Response delay set to ${bold(val)}s`);
            }
            break;
        }
        case 'confidence': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Confidence threshold 0-100 (current: ${settings.confidenceThreshold}):`, validate: (v: string) => { const n = Number(v); return !isNaN(n) && n >= 0 && n <= 100 ? true : 'Enter a number 0-100'; } }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserConfidenceThreshold', Number(val));
                au.reloadSettings();
                console.log(`\n📊 Confidence threshold set to ${bold(val)}%`);
            }
            break;
        }
        case 'proactive': {
            const newVal = !settings.proactiveGuidance;
            agent.config.set('agenticUserProactiveGuidance', newVal);
            au.reloadSettings();
            console.log(newVal
                ? `\n🔄 Proactive guidance ${green(bold('enabled'))}. Agent will receive guidance when stuck.`
                : `\n🔄 Proactive guidance ${gray(bold('disabled'))}.`);
            break;
        }
        case 'step_threshold': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Steps before proactive guidance kicks in (current: ${settings.proactiveStepThreshold}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 1 ? true : 'Enter a positive number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserProactiveStepThreshold', Number(val));
                au.reloadSettings();
                console.log(`\n📈 Proactive step threshold set to ${bold(val)}`);
            }
            break;
        }
        case 'check_interval': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Check interval in seconds (current: ${settings.checkIntervalSeconds}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 5 ? true : 'Enter a number ≥ 5' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserCheckInterval', Number(val));
                au.reloadSettings();
                console.log(`\n🔁 Check interval set to ${bold(val)}s`);
            }
            break;
        }
        case 'max_interventions': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Max interventions per action (current: ${settings.maxInterventionsPerAction}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 1 ? true : 'Enter a positive number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserMaxInterventions', Number(val));
                au.reloadSettings();
                console.log(`\n🚫 Max interventions per action set to ${bold(val)}`);
            }
            break;
        }
        case 'notify_user': {
            const newVal = !notifyUser;
            agent.config.set('agenticUserNotifyUser', newVal);
            console.log(newVal
                ? `\n🔔 User notifications ${green(bold('enabled'))}. You'll be messaged on the originating channel when the Agentic User intervenes.`
                : `\n🔕 User notifications ${gray(bold('disabled'))}. Interventions will happen silently.`);
            break;
        }
        case 'view_log': {
            const log = au.getInterventionLog(20);
            console.log('');
            if (log.length === 0) {
                console.log(dim('  No interventions recorded yet.'));
            } else {
                for (const entry of log) {
                    const appliedTag = entry.applied ? green(bold('APPLIED')) : yellow('SKIPPED');
                    const typeTag = entry.type === 'question-answer' ? cyan('Q&A')
                        : entry.type === 'direction-guidance' ? magenta('GUIDE')
                            : yellow('STUCK');
                    console.log(`  ${dim(entry.timestamp.slice(0, 19))}  ${typeTag}  ${appliedTag}  ${dim('conf:')}${entry.confidence}%`);
                    console.log(`    ${dim('Action:')} ${entry.actionId}`);
                    console.log(`    ${dim('Trigger:')} ${entry.trigger.slice(0, 80)}${entry.trigger.length > 80 ? '…' : ''}`);
                    console.log(`    ${dim('Response:')} ${entry.response.slice(0, 100)}${entry.response.length > 100 ? '…' : ''}`);
                    console.log('');
                }
            }
            await waitKeyPress();
            return showAgenticUserMenu();
        }
        case 'clear_history': {
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Clear all intervention history?', default: false }
            ]);
            if (confirm) {
                au.clearHistory();
                console.log('\n🗑️  Intervention history cleared.');
            }
            break;
        }
    }

    await waitKeyPress();
    return showAgenticUserMenu();
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

    // Per-worker summary lines
    if (detailedWorkers.length > 0) {
        orchLines.push('');
        const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
        const tokenMap = new Map(workerTokens.map(wt => [wt.agentId, wt]));

        for (const w of detailedWorkers) {
            const statusIcon = w.isRunning ? (w.currentTaskId ? '🔄' : '💤') : '⏸️';
            const statusColor = w.isRunning ? (w.currentTaskId ? yellow : green) : gray;
            const statusLabel = w.isRunning ? (w.currentTaskId ? 'working' : 'idle') : 'stopped';
            const tokens = tokenMap.get(w.agentId);
            const tokenStr = tokens ? dim(` ${(tokens.totalTokens / 1000).toFixed(1)}k tok`) : '';
            const taskStr = w.currentTaskDescription
                ? dim(` → ${w.currentTaskDescription.slice(0, 30)}${w.currentTaskDescription.length > 30 ? '…' : ''}`)
                : '';
            orchLines.push(`${statusIcon} ${bold(w.name.slice(0, 14).padEnd(14))} ${statusColor(statusLabel.padEnd(7))}${tokenStr}${taskStr}`);
        }
    }

    box(orchLines, { title: '📊 ORCHESTRATION STATUS', width: 64, color: c.magenta });
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
                { name: `  👥 ${bold('Create Peer Agent (Clone)')}`, value: 'create_peer' },
                { name: `  ⚙️  ${bold('Configure Peer Agent')}`, value: 'configure_peer' },
                { name: `  ➕ ${bold('Spawn New Worker')}`, value: 'spawn' },
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
            banner();
            sectionHeader('📊', 'Orchestration Dashboard');

            // Summary box
            const summaryLines = [
                `${dim('Agents')}     ${brightCyan(bold(String(status.activeAgents)))} active  ${dim('(')}${green(String(status.idleAgents))} idle${dim(',')} ${yellow(String(status.workingAgents))} working${dim(')')}`,
                `${dim('Workers')}    ${runningWorkers.length > 0 ? green(bold(String(runningWorkers.length))) : gray('0')} running`,
                `${dim('Tasks')}      ${status.pendingTasks > 0 ? yellow(bold(String(status.pendingTasks))) + ' pending' : green('0 pending')}  ${green(String(status.completedTasks))} done  ${status.failedTasks > 0 ? red(String(status.failedTasks)) + ' failed' : dim('0 failed')}`,
            ];
            console.log('');
            box(summaryLines, { title: '📈 OVERVIEW', width: 64, color: c.cyan });

            // Token usage box
            const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
            if (workerTokens.length > 0) {
                const totalAllTokens = workerTokens.reduce((sum, wt) => sum + wt.totalTokens, 0);
                const totalRealTokens = workerTokens.reduce((sum, wt) => sum + wt.realTokens, 0);
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
                box(tokenLines, { title: '🔢 WORKER TOKEN USAGE', width: 64, color: c.yellow });
            }

            // Per-worker details
            if (detailedWorkers.length > 0) {
                console.log('');
                console.log(gradient('  ─── Worker Details ──────────────────────────────────', [c.magenta, c.gray]));
                for (const w of detailedWorkers) {
                    const statusIcon = w.isRunning ? (w.currentTaskId ? '🔄' : '💤') : '⏸️';
                    const statusLabel = w.isRunning ? (w.currentTaskId ? yellow('working') : green('idle')) : gray('stopped');
                    const pidStr = w.pid ? dim(` PID:${w.pid}`) : '';
                    const agentIdShort = w.agentId.slice(0, 10);

                    console.log(`\n  ${statusIcon} ${bold(w.name)} ${dim('(' + agentIdShort + '…)')} ${statusLabel}${pidStr}`);
                    console.log(`     ${dim('Role')} ${w.role}  ${dim('Last')} ${new Date(w.lastActiveAt).toLocaleTimeString()}`);

                    if (w.currentTaskId) {
                        const desc = w.currentTaskDescription || '(no description)';
                        console.log(`     ${dim('Task')} ${cyan(desc.slice(0, 60))}${desc.length > 60 ? dim('…') : ''}`);
                    }

                    // Read memory stats from worker dir if accessible
                    const agentData = orchestrator.getAgent(w.agentId);
                    if (agentData?.memoryPath) {
                        try {
                            const workerDir = require('path').dirname(agentData.memoryPath);
                            // Memory counts
                            if (require('fs').existsSync(agentData.memoryPath)) {
                                const memData = JSON.parse(require('fs').readFileSync(agentData.memoryPath, 'utf-8'));
                                const shortCount = memData.short?.length || 0;
                                const episodicCount = memData.episodic?.length || 0;
                                console.log(`     ${dim('Memory')} ${shortCount} short, ${episodicCount} episodic`);
                            }
                            // Knowledge store
                            const ksPath = require('path').join(workerDir, 'knowledge_store.json');
                            if (require('fs').existsSync(ksPath)) {
                                const ksData = JSON.parse(require('fs').readFileSync(ksPath, 'utf-8'));
                                const docs = ksData.documents?.length || 0;
                                const chunks = ksData.chunks?.length || 0;
                                if (docs > 0) console.log(`     ${dim('Knowledge')} ${docs} docs, ${chunks} chunks`);
                            }
                        } catch { /* skip if files unreadable */ }
                    }
                }
            } else {
                console.log(`\n  ${dim('No workers spawned. Use ')}${cyan('Spawn New Agent')}${dim(' to create one.')}`);
            }

            // Running processes
            if (runningWorkers.length > 0) {
                console.log('');
                console.log(gradient('  ─── Processes ───────────────────────────────────────', [c.green, c.gray]));
                for (const w of runningWorkers) {
                    console.log(`  ⚡ ${bold(w.name)} ${dim('PID:' + w.pid)} ${dim('(' + w.agentId.slice(0, 10) + '…)')}`);
                }
            }
            console.log('');
            break;
        }
        case 'worker_details': {
            console.clear();
            banner();
            sectionHeader('🔍', 'Worker Task Details');
            if (detailedWorkers.length === 0) {
                console.log(`\n  ${dim('No workers available.')}`);
            } else {
                const workerTokens = orchestrator.getAggregateWorkerTokenUsage();
                const tokenMap = new Map(workerTokens.map(wt => [wt.agentId, wt]));

                for (const w of detailedWorkers) {
                    const statusIcon = w.isRunning ? (w.currentTaskId ? '🔄' : '💤') : '⏸️';
                    const statusLabel = w.isRunning ? (w.currentTaskId ? 'WORKING' : 'IDLE') : 'STOPPED';
                    const statusColor = w.isRunning ? (w.currentTaskId ? yellow : green) : gray;

                    const wLines: string[] = [];
                    wLines.push(`${dim('Status')}     ${statusIcon} ${statusColor(bold(statusLabel))}${w.pid ? dim(` (PID: ${w.pid})`) : ''}`);
                    wLines.push(`${dim('Role')}       ${w.role}`);
                    wLines.push(`${dim('Last Active')} ${new Date(w.lastActiveAt).toLocaleString()}`);

                    if (w.currentTaskId) {
                        wLines.push(`${dim('Task ID')}    ${cyan(w.currentTaskId)}`);
                        const desc = w.currentTaskDescription || '(no description)';
                        // Wrap long descriptions
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

                    // Token usage for this worker
                    const tokens = tokenMap.get(w.agentId);
                    if (tokens) {
                        wLines.push(`${dim('Tokens')}     ${bold((tokens.totalTokens / 1000).toFixed(1) + 'k')} total ${dim('(')}${green((tokens.realTokens / 1000).toFixed(1) + 'k')} real, ${yellow((tokens.estimatedTokens / 1000).toFixed(1) + 'k')} est${dim(')')}`);
                    }

                    // Memory stats from disk
                    const agentData = orchestrator.getAgent(w.agentId);
                    if (agentData?.memoryPath) {
                        try {
                            const workerDir = require('path').dirname(agentData.memoryPath);
                            if (require('fs').existsSync(agentData.memoryPath)) {
                                const memData = JSON.parse(require('fs').readFileSync(agentData.memoryPath, 'utf-8'));
                                wLines.push(`${dim('Memory')}     ${memData.short?.length || 0} short, ${memData.episodic?.length || 0} episodic`);
                            }
                            const ksPath = require('path').join(workerDir, 'knowledge_store.json');
                            if (require('fs').existsSync(ksPath)) {
                                const ksData = JSON.parse(require('fs').readFileSync(ksPath, 'utf-8'));
                                if (ksData.documents?.length > 0) {
                                    wLines.push(`${dim('Knowledge')}  ${ksData.documents.length} docs, ${ksData.chunks?.length || 0} chunks`);
                                }
                            }
                        } catch { /* skip */ }
                    }

                    console.log('');
                    box(wLines, { title: `🤖 ${w.name.toUpperCase()}`, width: 64, color: w.isRunning ? c.cyan : c.gray });
                }
            }
            console.log('');
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
        case 'create_peer': {
            const { name, role, governance } = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Peer name:', validate: (v: string) => v.trim().length > 0 || 'Name required' },
                { type: 'input', name: 'role', message: 'Specialized role (e.g. "Security Auditor"):', default: 'peer' },
                { type: 'input', name: 'governance', message: 'Additional governance rules (optional):' }
            ]);

            // Call the same underlying logic as the create_peer_agent skill
            try {
                // Prepare the spawn
                const agentInstance = orchestrator.spawnAgent({
                    name: name.trim(),
                    role: role.trim(),
                    autoStart: false
                });

                const agentDir = require('path').dirname(agentInstance.memoryPath);
                if (!require('fs').existsSync(agentDir)) require('fs').mkdirSync(agentDir, { recursive: true });

                // 1. Clone Identity
                const primaryIdPath = agent.config.get('agentIdentityPath');
                if (primaryIdPath && require('fs').existsSync(primaryIdPath)) {
                    const content = require('fs').readFileSync(primaryIdPath, 'utf-8');
                    const newId = content.replace(/Name: .*/, `Name: ${name}`);
                    require('fs').writeFileSync(require('path').join(agentDir, 'AGENT.md'), newId);
                }

                // 2. Clone World
                const primaryWorldPath = agent.config.get('worldPath');
                let worldContent = '';
                if (primaryWorldPath && require('fs').existsSync(primaryWorldPath)) {
                    worldContent = require('fs').readFileSync(primaryWorldPath, 'utf-8');
                } else {
                    worldContent = '# Agent World\nThis file contains the internal environment cluster and governance structure.\n';
                }

                if (governance) {
                    worldContent += `\n\n## Specialized Peer Governance: ${name}\n${governance}\n`;
                }
                require('fs').writeFileSync(require('path').join(agentDir, 'WORLD.md'), worldContent);

                // 3. Start
                orchestrator.startWorkerProcess(agentInstance);
                console.log(`\n✅ Peer agent created and started: ${agentInstance.id} (${agentInstance.name})`);
            } catch (err: any) {
                console.log(`\n❌ Error creating peer: ${err.message}`);
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
            console.log(`\n✅ Agent spawned: ${newAgent.id} (${newAgent.name})`);
            break;
        }
        case 'configure_peer': {
            const agents = orchestrator.listAgents().filter(a => a.id !== 'primary');
            if (agents.length === 0) {
                console.log('\n❌ No peer agents available to configure.');
                break;
            }

            const { agentId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select peer agent to configure:',
                    choices: agents.map(a => ({ name: `${a.name} (${a.id.slice(0, 8)}...)`, value: a.id }))
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
                    when: (a) => a.key === 'custom'
                },
                {
                    type: 'input',
                    name: 'value',
                    message: 'Enter new value:',
                }
            ]);

            const finalKey = key === 'custom' ? key.customKey : key;
            const updates: Record<string, any> = { [finalKey]: value };

            // Call the same underlying logic as the configure_peer_agent skill
            try {
                const agentInstance = orchestrator.getAgent(agentId);
                if (!agentInstance) throw new Error('Agent not found');

                const workerDir = require('path').dirname(agentInstance.memoryPath);
                const workerConfigPath = require('path').join(workerDir, 'orcbot.config.yaml');

                const yamlMod = require('yaml');
                const currentCfg = require('fs').existsSync(workerConfigPath) 
                    ? yamlMod.parse(require('fs').readFileSync(workerConfigPath, 'utf-8')) 
                    : {};
                
                const newCfg = { ...currentCfg, ...updates };
                if (updates.telegramToken || updates.discordToken) newCfg.allowWorkerChannels = true;

                require('fs').writeFileSync(workerConfigPath, yamlMod.stringify(newCfg));

                if (orchestrator.isWorkerRunning(agentId)) {
                    console.log(yellow(`\n🔄 Restarting peer ${agentId} to apply changes...`));
                    orchestrator.stopWorkerProcess(agentId);
                    setTimeout(() => orchestrator.startWorkerProcess(agentInstance), 6000);
                }
                console.log(green(`\n✅ Peer configuration updated.`));
            } catch (err: any) {
                console.log(red(`\n❌ Error configuring peer: ${err.message}`));
            }
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
    const overrideMode = agent.config.get('overrideMode');
    const selfModEnabled = agent.config.get('enableSelfModification') || false;
    const allowList = (agent.config.get('commandAllowList') || []) as string[];
    const denyList = (agent.config.get('commandDenyList') || []) as string[];
    const adminUsers = agent.config.get('adminUsers') as any || {};
    const tgAdmins = (adminUsers.telegram || []) as string[];
    const dcAdmins = (adminUsers.discord || []) as string[];
    const waAdmins = (adminUsers.whatsapp || []) as string[];
    const slAdmins = (adminUsers.slack || []) as string[];
    const totalAdmins = tgAdmins.length + dcAdmins.length + waAdmins.length;
    const adminConfigured = totalAdmins > 0;

    console.log('');
    const safeBadge = safeMode ? red(bold('🔒 LOCKED')) : green(bold('🔓 OPEN'));
    const sudoBadge = sudoMode ? yellow(bold('⚠️  ENABLED')) : green(bold('✅ OFF'));
    const selfModBadge = selfModEnabled ? red(bold('🛠️  ENABLED')) : green(bold('✅ OFF'));
    const overrideBadge = overrideMode ? red(bold('☠️  ACTIVE')) : green(bold('✅ OFF'));
    const adminBadge = adminConfigured ? green(bold(`👤 ${totalAdmins} admin(s)`)) : yellow(bold('⚠️  OPEN'));
    const secLines = [
        `${dim('Safe Mode')}     ${safeBadge}     ${dim(safeMode ? 'commands disabled' : 'commands allowed')}`,
        `${dim('Sudo Mode')}     ${sudoBadge}  ${dim(sudoMode ? 'all commands allowed' : 'allowList enforced')}`,
        `${dim('Self-Mod')}      ${selfModBadge}  ${dim(selfModEnabled ? 'codebase access allowed' : 'codebase access blocked')}`,
        `${dim('Override')}      ${overrideBadge}  ${dim(overrideMode ? 'persona boundaries OFF' : 'persona boundaries enforced')}`,
        `${dim('Admin Users')}   ${adminBadge}  ${dim(adminConfigured ? `TG:${tgAdmins.length} DC:${dcAdmins.length} WA:${waAdmins.length}` : 'everyone has full access')}`,
        ``,
        `${dim('Allow List')}    ${cyan(bold(String(allowList.length)))} commands  ${dim(allowList.length > 0 ? allowList.slice(0, 5).join(', ') + (allowList.length > 5 ? '…' : '') : '(empty)')}`,
        `${dim('Block List')}    ${cyan(bold(String(denyList.length)))} commands  ${dim(denyList.length > 0 ? denyList.slice(0, 5).join(', ') + (denyList.length > 5 ? '…' : '') : '(empty)')}`,
    ];
    box(secLines, { title: '🛡️  SECURITY STATUS', width: 58, color: overrideMode ? c.red : (safeMode ? c.red : (sudoMode ? c.yellow : c.green)) });
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
                { name: selfModEnabled ? `  🛠️  ${bold('Disable Self-Modification')} ${dim('(block codebase access)')}` : `  🛠️  ${bold('Enable Self-Modification')} ${dim('(allow codebase access)')}`, value: 'toggle_self_mod' },
                new inquirer.Separator(gradient('  ─── Dangerous ────────────────────', [c.red, c.brightRed || c.red])),
                { name: overrideMode ? `  ☠️  ${bold('Disable Override')} ${dim('(restore persona boundaries)')}` : `  ☠️  ${bold('Enable Override')} ${dim('(remove ALL behavioral limits)')}`, value: 'toggle_override' },
                new inquirer.Separator(gradient('  ─── Allow List ───────────────────', [c.green, c.gray])),
                { name: `  ➕ Add Command to Allow List`, value: 'add_allow' },
                { name: `  ➖ Remove Command from Allow List`, value: 'remove_allow' },
                { name: `  📋 View Full Allow List ${dim(`(${allowList.length})`)}`, value: 'view_allow' },
                new inquirer.Separator(gradient('  ─── Block List ───────────────────', [c.red, c.gray])),
                { name: `  ➕ Add Command to Block List`, value: 'add_deny' },
                { name: `  ➖ Remove Command from Block List`, value: 'remove_deny' },
                { name: `  📋 View Full Block List ${dim(`(${denyList.length})`)}`, value: 'view_deny' },
                new inquirer.Separator(gradient('  ─── Admin Users ──────────────────', [c.cyan, c.gray])),
                { name: `  👤 ${bold('Manage Admin Users')} ${dim(`(${totalAdmins} configured)`)}`, value: 'manage_admins' },
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
        case 'toggle_self_mod':
            if (!selfModEnabled) {
                const { confirm } = await inquirer.prompt([
                    { 
                        type: 'confirm', 
                        name: 'confirm', 
                        message: `⚠️  ${bold('Self-Modification')} allows the agent to read and EDIT its own source code.\nThis is a high-autonomy feature that could lead to unexpected changes or bugs.\nAre you sure you want to enable this?`, 
                        default: false 
                    }
                ]);
                if (confirm) {
                    agent.config.set('enableSelfModification', true);
                    console.log('\n🛠️  Self-Modification enabled. Agent can now access and modify its own codebase.');
                }
            } else {
                agent.config.set('enableSelfModification', false);
                console.log('\n✅ Self-Modification disabled. Codebase access is now blocked.');
            }
            break;
        case 'toggle_override':
            if (!overrideMode) {
                console.log('');
                console.log(red(bold('  ╔══════════════════════════════════════════════════╗')));
                console.log(red(bold('  ║         ☠️  BEHAVIORAL OVERRIDE WARNING ☠️         ║')));
                console.log(red(bold('  ╠══════════════════════════════════════════════════╣')));
                console.log(red('  ║  This removes ALL persona safety boundaries.     ║'));
                console.log(red('  ║  The agent will comply with ANY request —         ║'));
                console.log(red('  ║  including rude, offensive, or unhinged content.  ║'));
                console.log(red('  ║                                                  ║'));
                console.log(red('  ║  SOUL.md rules, tone restrictions, and refusal    ║'));
                console.log(red('  ║  behaviors are fully suspended while active.      ║'));
                console.log(red(bold('  ╚══════════════════════════════════════════════════╝')));
                console.log('');
                const { confirm: c1 } = await inquirer.prompt([
                    { type: 'confirm', name: 'confirm', message: red('I understand this removes behavioral guardrails. Continue?'), default: false }
                ]);
                if (c1) {
                    const { confirm: c2 } = await inquirer.prompt([
                        { type: 'input', name: 'confirm', message: red('Type OVERRIDE to confirm:') }
                    ]);
                    if (c2 === 'OVERRIDE') {
                        agent.config.set('overrideMode', true);
                        console.log('\n☠️  Override Mode ' + red(bold('ACTIVE')) + '. All persona boundaries suspended.');
                    } else {
                        console.log('\nAborted — confirmation did not match.');
                    }
                }
            } else {
                agent.config.set('overrideMode', false);
                console.log('\n✅ Override Mode disabled. Persona boundaries restored.');
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
        case 'manage_admins':
            await showAdminUsersMenu();
            return; // showAdminUsersMenu handles navigation
    }

    await waitKeyPress();
    return showSecurityMenu();
}

/**
 * Admin Users Management submenu.
 * Allows adding/removing admin user IDs per channel (Telegram, Discord, WhatsApp).
 * When no admin users are configured, everyone has full access (backwards compatible).
 */
async function showAdminUsersMenu() {
    console.clear();
    banner();
    sectionHeader('👤', 'Admin Users Management');

    const adminUsers = agent.config.get('adminUsers') as any || {};
    const tgAdmins = (adminUsers.telegram || []) as string[];
    const dcAdmins = (adminUsers.discord || []) as string[];
    const waAdmins = (adminUsers.whatsapp || []) as string[];
    const slAdmins = (adminUsers.slack || []) as string[];

    // Fetch known users per channel for pick-lists (excluding already-admin users)
    const knownTg = agent.getKnownUsers('telegram').filter(u => !tgAdmins.includes(u.id));
    const knownDc = agent.getKnownUsers('discord').filter(u => !dcAdmins.includes(u.id));
    const knownWa = agent.getKnownUsers('whatsapp').filter(u => !waAdmins.includes(u.id));
    const knownSl = agent.getKnownUsers('slack').filter(u => !slAdmins.includes(u.id));

    // Helper: format admin ID with known user name if available
    const nameForId = (id: string, channel: 'telegram' | 'discord' | 'whatsapp' | 'slack') => {
        const user = agent.getKnownUsers(channel).find(u => u.id === id);
        return user ? `${user.name}${user.username ? ` (@${user.username})` : ''} — ${id}` : id;
    };

    console.log('');
    const adminLines = [
        `${dim('When admin users are configured, only listed users can trigger')}`,
        `${dim('elevated skills (shell, files, browser, scheduling, image gen).')}`,
        `${dim('Unlisted users can still chat but with restricted permissions.')}`,
        `${dim('If NO admins are set for a channel, everyone has full access.')}`,
        ``,
        `${dim('Telegram')}    ${cyan(bold(String(tgAdmins.length)))} admin(s)  ${dim(tgAdmins.length > 0 ? tgAdmins.slice(0, 3).map(id => nameForId(id, 'telegram')).join(', ') + (tgAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('Discord')}     ${cyan(bold(String(dcAdmins.length)))} admin(s)  ${dim(dcAdmins.length > 0 ? dcAdmins.slice(0, 3).map(id => nameForId(id, 'discord')).join(', ') + (dcAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('WhatsApp')}    ${cyan(bold(String(waAdmins.length)))} admin(s)  ${dim(waAdmins.length > 0 ? waAdmins.slice(0, 3).map(id => nameForId(id, 'whatsapp')).join(', ') + (waAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('Slack')}       ${cyan(bold(String(slAdmins.length)))} admin(s)  ${dim(slAdmins.length > 0 ? slAdmins.slice(0, 3).map(id => nameForId(id, 'slack')).join(', ') + (slAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        ``,
        `${dim('Known users')} ${cyan(bold(String(knownTg.length + knownDc.length + knownWa.length + knownSl.length)))} ${dim('available to add')}  ${dim(`(${knownTg.length} tg, ${knownDc.length} dc, ${knownWa.length} wa, ${knownSl.length} sl)`)}`,
    ];
    box(adminLines, { title: '👤 ADMIN USERS', width: 62, color: c.cyan });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Admin Users Options:'),
            choices: [
                new inquirer.Separator(gradient('  ─── Telegram ─────────────────────', [c.blue, c.gray])),
                { name: `  ➕ Add Telegram Admin ${knownTg.length > 0 ? cyan(`(${knownTg.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_tg' },
                { name: `  ➖ Remove Telegram Admin ${dim(`(${tgAdmins.length})`)}`, value: 'remove_tg' },
                new inquirer.Separator(gradient('  ─── Discord ──────────────────────', [c.magenta, c.gray])),
                { name: `  ➕ Add Discord Admin ${knownDc.length > 0 ? cyan(`(${knownDc.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_dc' },
                { name: `  ➖ Remove Discord Admin ${dim(`(${dcAdmins.length})`)}`, value: 'remove_dc' },
                new inquirer.Separator(gradient('  ─── WhatsApp ─────────────────────', [c.green, c.gray])),
                { name: `  ➕ Add WhatsApp Admin ${knownWa.length > 0 ? cyan(`(${knownWa.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_wa' },
                { name: `  ➖ Remove WhatsApp Admin ${dim(`(${waAdmins.length})`)}`, value: 'remove_wa' },
                new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])),
                { name: dim('  ← Back to Security'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showSecurityMenu();

    const saveAdminUsers = (tg: string[], dc: string[], wa: string[]) => {
        const updated: any = {};
        if (tg.length > 0) updated.telegram = tg;
        if (dc.length > 0) updated.discord = dc;
        if (wa.length > 0) updated.whatsapp = wa;
        // If all empty, set adminUsers to undefined (backwards compatible — no restrictions)
        agent.config.set('adminUsers', Object.keys(updated).length > 0 ? updated : undefined);
    };

    switch (action) {
        case 'add_tg': {
            let id = '';
            if (knownTg.length > 0) {
                const choices = knownTg.map(u => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ID: ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('  ✏️  Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a Telegram user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownTg.length === 0) console.log(dim('  No known Telegram users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter Telegram numeric user ID (e.g., 123456789):' }
                ]);
                id = userId.trim();
            }
            if (id && /^\d+$/.test(id)) {
                const newList = [...new Set([...tgAdmins, id])];
                saveAdminUsers(newList, dcAdmins, waAdmins);
                const user = agent.getKnownUsers('telegram').find(u => u.id === id);
                console.log(`\n✅ Telegram admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\n❌ Invalid Telegram user ID. Must be numeric.');
            }
            break;
        }
        case 'remove_tg': {
            if (tgAdmins.length === 0) { console.log('\nNo Telegram admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select Telegram admin to remove:', choices: tgAdmins.map(id => ({ name: nameForId(id, 'telegram'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins.filter(id => id !== userId), dcAdmins, waAdmins);
            console.log(`\n✅ Telegram admin removed: ${nameForId(userId, 'telegram')}`);
            break;
        }
        case 'add_dc': {
            let id = '';
            if (knownDc.length > 0) {
                const choices = knownDc.map(u => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ID: ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('  ✏️  Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a Discord user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownDc.length === 0) console.log(dim('  No known Discord users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter Discord snowflake user ID (e.g., 876513738667229184):' }
                ]);
                id = userId.trim();
            }
            if (id && /^\d{15,20}$/.test(id)) {
                const newList = [...new Set([...dcAdmins, id])];
                saveAdminUsers(tgAdmins, newList, waAdmins);
                const user = agent.getKnownUsers('discord').find(u => u.id === id);
                console.log(`\n✅ Discord admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\n❌ Invalid Discord user ID. Must be a 15-20 digit snowflake.');
            }
            break;
        }
        case 'remove_dc': {
            if (dcAdmins.length === 0) { console.log('\nNo Discord admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select Discord admin to remove:', choices: dcAdmins.map(id => ({ name: nameForId(id, 'discord'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins, dcAdmins.filter(id => id !== userId), waAdmins);
            console.log(`\n✅ Discord admin removed: ${nameForId(userId, 'discord')}`);
            break;
        }
        case 'add_wa': {
            let id = '';
            if (knownWa.length > 0) {
                const choices = knownWa.map(u => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('  ✏️  Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a WhatsApp user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownWa.length === 0) console.log(dim('  No known WhatsApp users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter WhatsApp JID (e.g., 2348012345678@s.whatsapp.net):' }
                ]);
                id = userId.trim();
                // Auto-append @s.whatsapp.net if they just typed a phone number
                if (id && /^\d+$/.test(id)) {
                    id = `${id}@s.whatsapp.net`;
                    console.log(dim(`  → Formatted as ${id}`));
                }
            }
            if (id && id.includes('@')) {
                const newList = [...new Set([...waAdmins, id])];
                saveAdminUsers(tgAdmins, dcAdmins, newList);
                const user = agent.getKnownUsers('whatsapp').find(u => u.id === id);
                console.log(`\n✅ WhatsApp admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\n❌ Invalid WhatsApp JID. Use format: phonenumber@s.whatsapp.net');
            }
            break;
        }
        case 'remove_wa': {
            if (waAdmins.length === 0) { console.log('\nNo WhatsApp admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select WhatsApp admin to remove:', choices: waAdmins.map(id => ({ name: nameForId(id, 'whatsapp'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins, dcAdmins, waAdmins.filter(id => id !== userId));
            console.log(`\n✅ WhatsApp admin removed: ${nameForId(userId, 'whatsapp')}`);
            break;
        }
    }

    await waitKeyPress();
    return showAdminUsersMenu();
}

async function showConfigMenu() {
    console.clear();
    banner();
    sectionHeader('⚙️', 'Agent Configuration');
    console.log('');

    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = [
        'agentName', 'llmProvider', 'modelName', 'projectRoot', 'openaiApiKey', 'anthropicApiKey',
        'openrouterApiKey', 'openrouterBaseUrl', 'openrouterReferer', 'openrouterAppName',
        'googleApiKey', 'nvidiaApiKey', 'serperApiKey', 'braveSearchApiKey', 'searxngUrl',
        'searchProviderOrder', 'captchaApiKey', 'autonomyInterval', 'telegramToken',
        'whatsappEnabled', 'slackBotToken', 'slackAutoReplyEnabled', 'whatsappAutoReplyEnabled',
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

    if (key === 'searchProviderOrder' || key === 'commandAllowList' || key === 'commandDenyList' || key === 'pluginAllowList' || key === 'pluginDenyList' || key === 'guidanceAckPatterns' || key === 'guidanceLowValuePatterns' || key === 'guidanceClarificationKeywords' || key === 'guidanceQuestionStopWords' || key === 'orcbotControlCliAllowList' || key === 'orcbotControlCliDenyList') {
        const parsed = (value || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        agent.config.set(key as any, parsed);
    } else if (key === 'safeMode' || key === 'sudoMode' || key === 'progressFeedbackEnabled' || key === 'progressFeedbackForceInitial' || key === 'progressFeedbackTypingOnly' || key === 'enforceExplicitFileRequestForSendFile' || key === 'onboardingQuestionnaireEnabled' || key === 'reconnectBriefingEnabled' || key === 'whatsappEnabled' || key === 'slackAutoReplyEnabled' || key === 'whatsappAutoReplyEnabled' || key === 'robustReasoningMode' || key === 'reasoningExposeChecklist' || key === 'orcbotControlEnabled') {
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

/**
 * Fetch and display skills from the community vault (github.com/fredabila/orcbot-skills).
 */
async function showCommunitySkillsMenu() {
    console.clear();
    banner();
    sectionHeader('🌐', 'Community Skills');
    console.log(gray('  Fetching latest skills from fredabila/orcbot-skills...'));

    try {
        const repoUrl = 'https://github.com/fredabila/orcbot-skills';
        const apiUrl = 'https://api.github.com/repos/fredabila/orcbot-skills/contents/skills';
        
        // Use global fetch (Node 18+)
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'OrcBot-CLI' }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const items = await response.json() as any[];
        const skills = items.filter(item => item.type === 'dir').map(item => item.name);

        if (skills.length === 0) {
            console.log(yellow('\n  No skills found in the community repository.'));
            await waitKeyPress();
            return;
        }

        console.log(dim(`\n  Found ${skills.length} community skills in the vault:\n`));

        const choices = skills.map(name => ({
            name: `  📦 ${bold(name)}`,
            value: name
        }));
        choices.push(new inquirer.Separator(gradient('  ──────────────────────────────────', [c.gray, c.gray])));
        choices.push({ name: dim('  ← Back'), value: 'back' });

        const { selection } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selection',
                message: 'Select a community skill:',
                choices,
                pageSize: 15
            }
        ]);

        if (selection === 'back') return;

        // --- New Submenu for Skill Actions ---
        const skillName = selection;
        const skillUrl = `${repoUrl}/tree/main/skills/${skillName}`;
        const rawSkillUrl = `https://raw.githubusercontent.com/fredabila/orcbot-skills/main/skills/${skillName}/SKILL.md`;

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Skill: ${bold(skillName)}`,
                choices: [
                    { name: `  📖 ${bold('View Details')} ${dim('(Description & Requirements)')}`, value: 'view' },
                    { name: `  📥 ${bold('Install Skill')} ${dim('to this OrcBot')}`, value: 'install' },
                    new inquirer.Separator(),
                    { name: dim('  ← Back to list'), value: 'back' }
                ]
            }
        ]);

        if (action === 'back') return showCommunitySkillsMenu();

        if (action === 'view') {
            console.log(gray('\n  Fetching skill details...'));
            try {
                const res = await fetch(rawSkillUrl);
                if (!res.ok) throw new Error(`Could not fetch SKILL.md (${res.status})`);
                const content = await res.text();
                const parsed = agent.skills.parseSkillMd(content);

                if (parsed) {
                    console.clear();
                    banner();
                    sectionHeader('📖', `Skill: ${skillName}`);
                    
                    console.log(`\n  ${bold('Description:')}`);
                    console.log(`  ${parsed.meta.description}\n`);

                    if (parsed.meta.orcbot?.triggerPatterns) {
                        console.log(`  ${bold('Auto-Activation Patterns:')}`);
                        parsed.meta.orcbot.triggerPatterns.forEach(p => console.log(`  - ${dim(p)}`));
                        console.log('');
                    }

                    if (parsed.meta.allowedTools) {
                        const tools = Array.isArray(parsed.meta.allowedTools) ? parsed.meta.allowedTools : [parsed.meta.allowedTools];
                        console.log(`  ${bold('Allowed Tools:')}`);
                        tools.forEach(t => console.log(`  - ${dim(t)}`));
                        console.log('');
                    }

                    if (parsed.meta.metadata) {
                        console.log(`  ${bold('Metadata:')}`);
                        Object.entries(parsed.meta.metadata).forEach(([k, v]) => console.log(`  - ${k}: ${dim(String(v))}`));
                        console.log('');
                    }

                    const { proceed } = await inquirer.prompt([
                        { type: 'confirm', name: 'proceed', message: 'Install this skill now?', default: true }
                    ]);
                    if (!proceed) return showCommunitySkillsMenu();
                } else {
                    console.log(yellow('\n  This skill uses a loose format. Full content:'));
                    console.log(dim(content.split('\n').slice(0, 10).join('\n') + '...'));
                    const { proceed } = await inquirer.prompt([
                        { type: 'confirm', name: 'proceed', message: 'Install anyway?', default: true }
                    ]);
                    if (!proceed) return showCommunitySkillsMenu();
                }
            } catch (e: any) {
                console.log(red(`\n  Failed to load preview: ${e.message}`));
                await waitKeyPress();
                return showCommunitySkillsMenu();
            }
        }

        // Proceed to installation
        console.log(`\n📦 Installing "${skillName}" from community vault...`);
        const result = await agent.skills.installSkillFromUrl(skillUrl);
        
        if (result.success) {
            console.log(green(`\n✅ ${result.message}`));
        } else {
            console.log(red(`\n❌ ${result.message}`));
        }
        await waitKeyPress();

    } catch (e: any) {
        console.log(red(`\n❌ Failed to fetch community skills: ${e.message}`));
        console.log(dim(`   You can manually install from: https://github.com/fredabila/orcbot-skills`));
        await waitKeyPress();
    }
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

    // Section: Community
    choices.push(new inquirer.Separator(gradient('  ─── Community ────────────────────', [c.magenta, c.gray])));
    choices.push({ name: `  🌐 ${bold('Browse Community Skills')} ${dim('(orcbot-skills)')}`, value: 'browse_community' });

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

    // ── Browse Community Skills ──
    if (selection === 'browse_community') {
        await showCommunitySkillsMenu();
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

async function performPiAIUpdate() {
    const { execSync } = require('child_process');
    const orcbotDir = path.resolve(__dirname, '..', '..');

    console.log('\n🔄 Checking for PI AI Catalog updates...');
    console.log(dim('   This will update the @mariozechner/pi-ai library to get the newest models.\n'));

    try {
        console.log('📡 Fetching latest catalog metadata via npm...');
        execSync('npm update @mariozechner/pi-ai', { cwd: orcbotDir, stdio: 'inherit' });

        console.log(green('\n✅ Catalog update complete!'));
        console.log(dim('   The model list will be refreshed the next time you open the browser.'));
    } catch (e) {
        console.log(red(`\n❌ Failed to update catalog: ${e.message}`));
    }

    await waitKeyPress();
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
            execSync('git fetch origin', { cwd: orcbotDir });

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
            const logs = execSync('git log --oneline HEAD..origin/main', { cwd: orcbotDir, encoding: 'utf8' });
            console.log(logs);

            // Force update: discard local changes and sync to origin/main
            console.log('\n⬇️  Applying latest changes (force update)...');
            execSync('git reset --hard origin/main', { cwd: orcbotDir });
            execSync('git clean -fd', { cwd: orcbotDir });

            // Install dependencies
            console.log('\n📦 Installing dependencies...');
            execSync('npm install', { cwd: orcbotDir });
            
            // Rebuild
            console.log('\n🔨 Rebuilding OrcBot...');
            execSync('npm run build', { cwd: orcbotDir });

            // Re-link globally
            const packageJson = JSON.parse(fs.readFileSync(path.join(orcbotDir, 'package.json'), 'utf8'));
            if (packageJson.bin) {
                console.log('\n🔗 Re-installing global command...');
                try {
                    execSync('npm install -g .', { cwd: orcbotDir });
                } catch (e) {
                    // Ignore global link errors in restricted environments
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
    const hasSlack = !!agent.slack;
    const model = agent.config.get('modelName') || 'gpt-4o';
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
    ], { title: '🤖 AI ENGINE', width: 52, color: c.brightCyan });

    // Memory Panel
    const memTotal = shortMem + episodicMem;
    console.log('');
    box([
        `${c.white}Short-term${c.reset}  ${c.yellow}${c.bold}${String(shortMem).padStart(4)}${c.reset} entries  ${progressBar(shortMem, 200, 16)}`,
        `${c.white}Episodic${c.reset}    ${c.cyan}${c.bold}${String(episodicMem).padStart(4)}${c.reset} entries  ${progressBar(episodicMem, 50, 16, { colorFn: cyan })}`,
        `${c.white}Total${c.reset}       ${c.bold}${c.brightWhite}${String(memTotal).padStart(4)}${c.reset} entries`,
    ], { title: '🧠 MEMORY', width: 52, color: c.magenta });

    // Channels Panel — fixed-width label column for clean alignment
    console.log('');
    const chLine = (ok: boolean, color: string, label: string) =>
        `${ok ? `${c.brightGreen}●${c.reset}` : `${c.gray}○${c.reset}`} ${color}${label}${c.reset}${' '.repeat(Math.max(0, 12 - label.length))}${ok ? `${c.brightGreen}Connected${c.reset}` : `${c.gray}Not configured${c.reset}`}`;
    box([
        chLine(hasTelegram, c.brightCyan, 'Telegram'),
        chLine(hasWhatsapp, c.brightGreen, 'WhatsApp'),
        chLine(hasDiscord, c.brightMagenta, 'Discord'),
        chLine(hasSlack, c.brightYellow, 'Slack'),
    ], { title: '🔌 CHANNELS', width: 52, color: c.brightBlue });

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
            const statusIcon = a.status === 'completed' ? `${c.brightGreen}✓${c.reset}` : a.status === 'failed' ? `${c.red}✗${c.reset}` : a.status === 'in-progress' ? `${c.cyan}▶${c.reset}` : a.status === 'waiting' ? `${c.magenta}⏸${c.reset}` : `${c.yellow}…${c.reset}`;
            const desc = ((a as any).payload?.description || 'Unknown').slice(0, 38);
            queueLines.push(`  ${statusIcon} ${c.gray}${a.id.slice(0, 6)}${c.reset} ${c.white}${desc}${c.reset}`);
        }
    }
    box(queueLines, { title: '📋 ACTION QUEUE', width: 52, color: c.yellow });

    console.log('');
}

function showGuardrailMetrics(limit: number = 10) {
    console.clear();
    banner();
    sectionHeader('🧪', 'Guardrail Metrics');

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
    ], { title: '📉 FALLBACK SUMMARY', width: 64, color: c.yellow });

    const recent = metricEntries.slice(0, Math.max(1, limit));
    if (recent.length === 0) {
        console.log('');
        box([dim('No guardrail metric events recorded yet.')], { title: '🕘 RECENT EVENTS', width: 64, color: c.gray });
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
    box([`${dim('Recent')} ${recent.length} ${dim('event(s)')}`], { title: '🕘 RECENT EVENTS', width: 64, color: c.cyan });
    table(rows, { indent: '  ', separator: '   ', headerColor: brightCyan });
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
    const accuracy = tracker.getAccuracyReport();

    // Accuracy banner — the key info users need to understand their numbers
    console.log('');
    const realPct = accuracy.realPct;
    const estPct = accuracy.estimatedPct;
    const accuracyColor = realPct >= 80 ? c.brightGreen : realPct >= 50 ? c.yellow : c.brightRed;
    const accuracyLabel = realPct >= 80 ? '✓ High' : realPct >= 50 ? '~ Medium' : '⚠ Low';
    box([
        `${c.white}Data accuracy:${c.reset}         ${accuracyColor}${c.bold}${accuracyLabel} (${realPct}% API-reported)${c.reset}`,
        `${c.white}API-reported calls:${c.reset}    ${c.bold}${c.brightWhite}${accuracy.realCalls.toLocaleString().padStart(8)}${c.reset}  ${c.gray}│${c.reset}  ${c.brightGreen}${(summary.realTotals?.totalTokens?.toLocaleString() || '0').padStart(12)}${c.reset} tokens`,
        `${c.white}Estimated calls:${c.reset}       ${c.bold}${c.brightWhite}${accuracy.estimatedCalls.toLocaleString().padStart(8)}${c.reset}  ${c.gray}│${c.reset}  ${c.yellow}${(summary.estimatedTotals?.totalTokens?.toLocaleString() || '0').padStart(12)}${c.reset} tokens`,
        `${c.gray}${'─'.repeat(52)}${c.reset}`,
        `${c.white}If numbers seem high, estimated calls use a heuristic${c.reset}`,
        `${c.white}that can over-count. Run${c.reset} ${c.bold}${c.brightCyan}orcbot tokens recount${c.reset} ${c.white}to rebuild.${c.reset}`,
    ], { title: '🎯 DATA ACCURACY', width: 58, color: accuracyColor });

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
        `  ${c.gray}└ Estimated:${c.reset}    ${c.yellow}${estTotal.toLocaleString().padStart(10)}${c.reset}  ${estTotal > 0 ? `${c.gray}(~30-60% inflated)${c.reset}` : ''}`,
    ], { title: '🔢 TOKEN TOTALS', width: 48, color: c.brightCyan });

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
        box(providerLines, { title: '🏢 BY PROVIDER', width: 58, color: c.green });
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
        box(modelLines, { title: '🤖 TOP MODELS', width: 58, color: c.magenta });
    }

    console.log('');
    console.log(gray(`  Last updated: ${summary.lastUpdated}`));
    console.log('');
}

async function waitKeyPress() {
    // White text so the prompt is clearly visible (gray was nearly invisible on dark terminals)
    await inquirer.prompt([{ type: 'input', name: 'continue', message: `${c.brightCyan}›${c.reset} ${c.white}Press Enter to continue...${c.reset}` }]);
}

/**
 * Toggle whether a channel is allowed to send messages autonomously.
 */
function toggleAutonomyChannel(channel: string) {
    let allowedChannels = agent.config.get('autonomyAllowedChannels');
    if (!Array.isArray(allowedChannels)) allowedChannels = [];
    
    // Create a new array to ensure config.set detects the change
    let nextChannels: string[];
    if (allowedChannels.includes(channel)) {
        nextChannels = allowedChannels.filter(c => c !== channel);
    } else {
        nextChannels = [...allowedChannels, channel];
    }
    agent.config.set('autonomyAllowedChannels', nextChannels);
}

/**
 * Check if a channel is allowed to send messages autonomously.
 */
function isAutonomyEnabledForChannel(channel: string): boolean {
    const allowedChannels = agent.config.get('autonomyAllowedChannels');
    return Array.isArray(allowedChannels) && allowedChannels.includes(channel);
}

program.parse(process.argv);
