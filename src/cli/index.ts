#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { ConfigManager } from '../core/ConfigManager';

dotenv.config();

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
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (provider === 'back') return showMainMenu();

    if (provider === 'openai') {
        await showOpenAIConfig();
    } else if (provider === 'google') {
        await showGeminiConfig();
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
                { name: 'Back', value: 'back' },
            ]
        }
    ]);

    if (channel === 'back') return showMainMenu();

    if (channel === 'telegram') {
        const currentToken = agent.config.get('telegramToken') || 'Not Set';
        console.log(`Current Telegram Token: ${currentToken}`);

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Telegram Settings:',
                choices: [
                    { name: 'Set Token', value: 'set' },
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
            console.log('Token updated! Restart the agent to apply changes.');
            await waitKeyPress();
            return showConnectionsMenu();
        }
    }
}

async function showConfigMenu() {
    const config = agent.config.getAll();
    // Ensure we show explicit keys relative to core config
    const keys = ['agentName', 'openaiApiKey', 'googleApiKey', 'serperApiKey', 'captchaApiKey', 'modelName', 'autonomyInterval', 'telegramToken', 'memoryPath'] as const;

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

    agent.config.set(key as any, value);
    console.log('Configuration updated!');
    await waitKeyPress();
    await showConfigMenu();
}

function showStatus() {
    console.log('--- Agent Status ---');
    console.log(`Memory Entries: ${agent.memory.searchMemory('short').length} (short-term)`);
    console.log(`Action Queue: ${agent.actionQueue.getQueue().length} total actions`);
    console.log(`Telegram Bot: ${agent.telegram ? 'Configured' : 'Not Configured'}`);
    console.log('--------------------');
}

async function waitKeyPress() {
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
}

program.parse(process.argv);
