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
import { WorkerProfileManager } from '../core/WorkerProfile';
import { DaemonManager } from '../utils/daemon';

dotenv.config(); // Local .env
dotenv.config({ path: path.join(os.homedir(), '.orcbot', '.env') }); // Global .env

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

program
    .command('run')
    .description('Start the agent autonomous loop (checks for daemon conflicts)')
    .option('-d, --daemon', 'Run in background as a daemon')
    .option('--daemon-child', 'Internal: run as daemon child', false)
    .action(async (options) => {
        const daemonManager = DaemonManager.createDefault();
        const status = daemonManager.isRunning();

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
    .description('View agent memory and action queue')
    .action(() => {
        showStatus();
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
                { name: 'Worker Profile (Digital Identity)', value: 'worker' },
                { name: 'Multi-Agent Orchestration', value: 'orchestration' },
                { name: '🔒 Security & Permissions', value: 'security' },
                { name: 'Configure Agent', value: 'config' },
                { name: '⬆️  Update OrcBot', value: 'update' },
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
        case 'worker':
            await showWorkerProfileMenu();
            break;
        case 'orchestration':
            await showOrchestrationMenu();
            break;
        case 'security':
            await showSecurityMenu();
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

async function showWorkerProfileMenu() {
    console.clear();
    console.log('🪪 Worker Profile (Digital Identity)');
    console.log('=====================================');

    if (!workerProfile.exists()) {
        console.log('No worker profile exists yet.\n');
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

    // Show current profile
    console.log(workerProfile.getSummary());
    console.log('');

    const profile = workerProfile.get()!;
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Profile Options:',
            choices: [
                { name: 'Edit Basic Info (Handle, Name, Bio)', value: 'edit_basic' },
                { name: `${profile.email ? 'Update' : 'Set'} Email Address`, value: 'email' },
                { name: `${profile.password ? 'Update' : 'Set'} Password`, value: 'password' },
                { name: 'Manage Linked Websites', value: 'websites' },
                { name: '🗑️ Delete Worker Profile', value: 'delete' },
                { name: 'Back', value: 'back' }
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
    console.log('🌐 Linked Websites');
    console.log('==================');

    if (profile.websites.length === 0) {
        console.log('No websites linked yet.\n');
    } else {
        profile.websites.forEach((w, i) => {
            console.log(`${i + 1}. ${w.name}: ${w.url}${w.username ? ` (user: ${w.username})` : ''}`);
        });
        console.log('');
    }

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
    console.log('🐙 Multi-Agent Orchestration');
    console.log('============================');

    const orchestrator = agent.orchestrator;
    const status = orchestrator.getStatus();
    const runningWorkers = orchestrator.getRunningWorkers();
    const detailedWorkers = orchestrator.getDetailedWorkerStatus();

    // Show current status
    console.log(`Active Agents: ${status.activeAgents}`);
    console.log(`Running Workers: ${runningWorkers.length} process(es)`);
    console.log(`Pending Tasks: ${status.pendingTasks}`);
    console.log(`Completed Tasks: ${status.completedTasks}`);
    console.log(`Failed Tasks: ${status.failedTasks}`);
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Orchestration Options:',
            choices: [
                { name: '📊 View Detailed Status', value: 'status' },
                { name: '🤖 List Active Agents', value: 'list' },
                { name: '⚡ View Running Processes', value: 'processes' },
                { name: '🔍 View Worker Task Details', value: 'worker_details' },
                { name: '➕ Spawn New Agent', value: 'spawn' },
                { name: '▶️ Start Worker Process', value: 'start_worker' },
                { name: '⏹️ Stop Worker Process', value: 'stop_worker' },
                { name: '📋 Delegate Task to Agent', value: 'delegate' },
                { name: '🔀 Distribute Tasks to All', value: 'distribute' },
                { name: '💬 Broadcast Message', value: 'broadcast' },
                { name: '🗑️ Terminate Agent', value: 'terminate' },
                { name: '🧹 Terminate All Agents', value: 'terminate_all' },
                { name: 'Back', value: 'back' }
            ]
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
    console.log('🔐 Security & Permissions');
    console.log('=========================');

    const safeMode = agent.config.get('safeMode');
    const sudoMode = agent.config.get('sudoMode');
    const allowList = (agent.config.get('commandAllowList') || []) as string[];
    const denyList = (agent.config.get('commandDenyList') || []) as string[];

    console.log(`\nSafe Mode: ${safeMode ? '🔒 ON (run_command disabled)' : '🔓 OFF'}`);
    console.log(`Sudo Mode: ${sudoMode ? '⚠️ ON (all commands allowed)' : '✅ OFF (allowList enforced)'}`);
    console.log(`\nAllowed Commands (${allowList.length}): ${allowList.slice(0, 10).join(', ')}${allowList.length > 10 ? '...' : ''}`);
    console.log(`Blocked Commands (${denyList.length}): ${denyList.join(', ')}`);
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Security Options:',
            choices: [
                { name: safeMode ? '🔓 Disable Safe Mode (allow commands)' : '🔒 Enable Safe Mode (block all commands)', value: 'toggle_safe' },
                { name: sudoMode ? '✅ Disable Sudo Mode (enforce allowList)' : '⚠️ Enable Sudo Mode (allow ALL commands)', value: 'toggle_sudo' },
                { name: '➕ Add Command to Allow List', value: 'add_allow' },
                { name: '➖ Remove Command from Allow List', value: 'remove_allow' },
                { name: '➕ Add Command to Block List', value: 'add_deny' },
                { name: '➖ Remove Command from Block List', value: 'remove_deny' },
                { name: '📋 View Full Allow List', value: 'view_allow' },
                { name: '📋 View Full Block List', value: 'view_deny' },
                { name: 'Back', value: 'back' }
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
    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = ['agentName', 'openaiApiKey', 'googleApiKey', 'serperApiKey', 'braveSearchApiKey', 'searxngUrl', 'searchProviderOrder', 'captchaApiKey', 'modelName', 'autonomyInterval', 'telegramToken', 'whatsappEnabled', 'whatsappAutoReplyEnabled', 'memoryPath', 'commandAllowList', 'commandDenyList', 'safeMode', 'sudoMode', 'pluginAllowList', 'pluginDenyList', 'browserProfileDir', 'browserProfileName'] as const;

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
    } else if (key === 'safeMode' || key === 'sudoMode') {
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
            
            // Rebuild
            console.log('\n🔨 Rebuilding OrcBot...');
            execSync('npm run build', { cwd: orcbotDir, stdio: 'inherit' });
            
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
