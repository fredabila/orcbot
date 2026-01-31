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
            const { task, priority } = await inquirer.prompt([
                { type: 'input', name: 'task', message: 'Enter task description:' },
                { type: 'number', name: 'priority', message: 'Enter priority (1-10):', default: 5 },
            ]);
            await agent.pushTask(task, priority);
            console.log('Task pushed!');
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'status':
            showStatus();
            await waitKeyPress();
            await showMainMenu();
            break;
        case 'config':
            await showConfigMenu();
            break;
        case 'exit':
            process.exit(0);
    }
}

async function showConfigMenu() {
    const config = agent.config.getAll();
    const choices = Object.keys(config).map(key => ({ name: `${key}: ${config[key as keyof typeof config]}`, value: key }));
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
