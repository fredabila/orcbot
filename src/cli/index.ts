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

dotenv.config(); // Local .env
dotenv.config({ path: path.join(os.homedir(), '.orcbot', '.env') }); // Global .env

const program = new Command();
const agent = new Agent();

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

program
    .command('run')
    .description('Start the agent autonomous loop')
    .action(async () => {
        console.log('Agent loop starting... (Press Ctrl+C to stop)');
        await agent.start();
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
    .command('status')
    .description('View agent memory and action queue')
    .action(() => {
        showStatus();
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

async function showMainMenu() {
    console.clear();
    console.log('🤖 OrcBot TUI');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: 'Start Agent Loop', value: 'start' },
                { name: 'Push Task', value: 'push' },
                { name: 'View Status', value: 'status' },
                { name: 'Manage Skills (Plugins)', value: 'skills' },
                { name: 'Manage Connections', value: 'connections' },
                { name: 'Manage AI Models', value: 'models' },
                { name: 'Tooling & APIs', value: 'tooling' },
                { name: 'Configure Agent', value: 'config' },
                { name: 'Exit', value: 'exit' },
            ],
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
        case 'config':
            await showConfigMenu();
            break;
        case 'exit':
            process.exit(0);
    }
}

async function showToolingMenu() {
    const { tool } = await inquirer.prompt([
        {
            type: 'list',
            name: 'tool',
            message: 'Select Tool to Configure:',
            choices: [
                { name: 'Serper (Web Search API)', value: 'serper' },
                { name: 'Brave Search (Web Search API)', value: 'brave' },
                { name: 'SearxNG (Self-hosted Search)', value: 'searxng' },
                { name: 'Search Provider Order', value: 'searchOrder' },
                { name: '2Captcha (CAPTCHA Solver)', value: 'captcha' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (tool === 'back') return showMainMenu();

    if (tool === 'serper') {
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

async function showModelsMenu() {
    const { provider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Select AI Provider to Configure:',
            choices: [
                { name: 'OpenAI (GPT-4, etc.)', value: 'openai' },
                { name: 'Google (Gemini Pro/Flash)', value: 'google' },
                { name: 'AWS Bedrock (Claude/other foundation models)', value: 'bedrock' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (provider === 'back') return showMainMenu();

    if (provider === 'openai') {
        await showOpenAIConfig();
    } else if (provider === 'google') {
        await showGeminiConfig();
    } else if (provider === 'bedrock') {
        await showBedrockConfig();
    }
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
    const { task } = await inquirer.prompt([
        { type: 'input', name: 'task', message: 'Enter task description (or leave empty to go back):' }
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
    const { channel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'channel',
            message: 'Manage Connections:',
            choices: [
                { name: 'Telegram Bot', value: 'telegram' },
                { name: 'WhatsApp (Baileys)', value: 'whatsapp' },
                { name: 'Back', value: 'back' },
            ]
        }
    ]);

    if (channel === 'back') return showMainMenu();

    if (channel === 'telegram') {
        await showTelegramConfig();
    } else if (channel === 'whatsapp') {
        await showWhatsAppConfig();
    }
}

async function showTelegramConfig() {
    const currentToken = agent.config.get('telegramToken') || 'Not Set';
    const autoReply = agent.config.get('telegramAutoReplyEnabled');
    console.log(`\n--- Telegram Settings ---`);
    console.log(`Current Token: ${currentToken}`);
    console.log(`Auto-Reply: ${autoReply ? 'ON' : 'OFF'}`);

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

    console.log(`\n--- WhatsApp Settings ---`);
    console.log(`Status: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Auto-Reply (1-on-1): ${autoReply ? 'ON' : 'OFF'}`);
    console.log(`Status Interactions: ${statusReply ? 'ON' : 'OFF'}`);
    console.log(`Auto-React (Emojis): ${autoReact ? 'ON' : 'OFF'}`);
    console.log(`Context Profiling: ${contextProfiling ? 'ON' : 'OFF'}`);
    console.log(`Linked Account: ${ownerJid}`);

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

async function showConfigMenu() {
    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = ['agentName', 'openaiApiKey', 'googleApiKey', 'serperApiKey', 'braveSearchApiKey', 'searxngUrl', 'searchProviderOrder', 'captchaApiKey', 'modelName', 'autonomyInterval', 'telegramToken', 'whatsappEnabled', 'whatsappAutoReplyEnabled', 'memoryPath', 'commandAllowList', 'commandDenyList', 'safeMode', 'pluginAllowList', 'pluginDenyList'] as const;

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
    } else if (key === 'safeMode') {
        const normalized = String(value).trim().toLowerCase();
        agent.config.set(key as any, normalized === 'true' || normalized === '1' || normalized === 'yes');
    } else {
        agent.config.set(key as any, value);
    }
    console.log('Configuration updated!');
    await waitKeyPress();
    await showConfigMenu();
}

async function showSkillsMenu() {
    const skills = agent.skills.getAllSkills();
    const choices = skills.map(s => ({
        name: `${s.name} ${s.pluginPath ? '(Plugin)' : '(Core)'}: ${s.description}`,
        value: s.name
    }));
    choices.push({ name: '✨ Build New Skill from URL', value: 'build' });
    choices.push({ name: 'Back', value: 'back' });

    const { selection } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selection',
            message: 'Manage Agent Skills:',
            choices
        }
    ]);

    if (selection === 'back') return showMainMenu();

    if (selection === 'build') {
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter URL for SKILLS.md specification:' }
        ]);
        if (url) {
            const { SkillBuilder } = require('./builder');
            const builder = new SkillBuilder();
            console.log('Building skill...');
            const result = await builder.buildFromUrl(url);
            console.log(result);
            agent.skills.loadPlugins(); // Reload to pick up new skill
            await waitKeyPress();
        }
        return showSkillsMenu();
    }

    // Individual skill management
    const selectedSkill = skills.find(s => s.name === selection);
    if (selectedSkill?.pluginPath) {
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Skill: ${selection}`,
                choices: [
                    { name: '🗑️ Uninstall (Delete Plugin)', value: 'uninstall' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (action === 'uninstall') {
            const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Really delete ${selection}?`, default: false }]);
            if (confirm) {
                const res = agent.skills.uninstallSkill(selection);
                console.log(res);
                await waitKeyPress();
            }
        }
    } else {
        console.log(`\nCore skill "${selection}" cannot be uninstalled.\nUsage: ${selectedSkill?.usage}`);
        await waitKeyPress();
    }

    return showSkillsMenu();
}

function showStatus() {
    console.log('--- Agent Status ---');
    console.log(`Memory Entries: ${agent.memory.searchMemory('short').length} (short-term)`);
    console.log(`Action Queue: ${agent.actionQueue.getQueue().length} total actions`);
    console.log(`Telegram Bot: ${agent.telegram ? 'Connected' : 'Disconnected/Not Set'}`);
    console.log(`WhatsApp: ${agent.whatsapp ? 'Connected' : 'Disconnected/Disabled'}`);
    console.log('--------------------');
}

async function waitKeyPress() {
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
}

program.parse(process.argv);
