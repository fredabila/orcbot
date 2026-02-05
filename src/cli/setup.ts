import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { logger } from '../utils/logger';

import os from 'os';

export async function runSetup() {
    console.log('\n🤖 Welcome to the OrcBot Setup Wizard!\n');

    const dataHome = path.join(os.homedir(), '.orcbot');
    if (!fs.existsSync(dataHome)) fs.mkdirSync(dataHome, { recursive: true });

    const configPath = path.join(dataHome, 'orcbot.config.yaml');
    const envPath = path.join(dataHome, '.env');

    let currentConfig: any = {};
    if (fs.existsSync(configPath)) {
        try {
            currentConfig = yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
        } catch (e) {
            logger.warn('Failed to parse existing config, starting fresh.');
        }
    }

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'modelName',
            message: 'Default LLM Model Name:',
            default: currentConfig.modelName || 'gpt-4o'
        },
        {
            type: 'input',
            name: 'openaiApiKey',
            message: 'OpenAI API Key (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'googleApiKey',
            message: 'Google (Gemini) API Key (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'nvidiaApiKey',
            message: 'NVIDIA API Key (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'anthropicApiKey',
            message: 'Anthropic (Claude) API Key (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'bedrockRegion',
            message: 'AWS Bedrock Region (optional, e.g., us-east-1):'
        },
        {
            type: 'input',
            name: 'bedrockAccessKeyId',
            message: 'Bedrock Access Key ID (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'bedrockSecretAccessKey',
            message: 'Bedrock Secret Access Key (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'bedrockSessionToken',
            message: 'Bedrock Session Token (optional):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'serperApiKey',
            message: 'Serper.dev API Key (for web search):',
            mask: '*'
        },
        {
            type: 'input',
            name: 'telegramToken',
            message: 'Telegram Bot Token:',
            mask: '*'
        },
        {
            type: 'input',
            name: 'pluginsPath',
            message: 'Plugins Directory:',
            default: currentConfig.pluginsPath || './plugins'
        },
        {
            type: 'confirm',
            name: 'whatsappEnabled',
            message: 'Enable WhatsApp Channel?',
            default: currentConfig.whatsappEnabled || false
        },
        {
            type: 'confirm',
            name: 'whatsappAutoReplyEnabled',
            message: 'Enable AI Auto-Reply for 1-on-1 WhatsApp chats?',
            default: currentConfig.whatsappAutoReplyEnabled || false,
            when: (ans) => ans.whatsappEnabled
        }
    ]);

    // Save YAML Config
    const newConfig = {
        modelName: answers.modelName,
        pluginsPath: path.join(dataHome, 'plugins'),
        memoryPath: path.join(dataHome, 'memory.json'),
        userProfilePath: path.join(dataHome, 'USER.md'),
        journalPath: path.join(dataHome, 'JOURNAL.md'),
        learningPath: path.join(dataHome, 'LEARNING.md'),
        agentIdentityPath: path.join(dataHome, '.AI.md'),
        whatsappEnabled: answers.whatsappEnabled,
        whatsappAutoReplyEnabled: answers.whatsappAutoReplyEnabled,
        bedrockRegion: answers.bedrockRegion || undefined
    };

    fs.writeFileSync(configPath, yaml.stringify(newConfig));
    console.log(`✅ Config saved to ${configPath}`);

    // Save .env
    let envContent = '';
    if (answers.openaiApiKey) envContent += `OPENAI_API_KEY=${answers.openaiApiKey}\n`;
    if (answers.googleApiKey) envContent += `GOOGLE_API_KEY=${answers.googleApiKey}\n`;
    if (answers.nvidiaApiKey) envContent += `NVIDIA_API_KEY=${answers.nvidiaApiKey}\n`;
    if (answers.anthropicApiKey) envContent += `ANTHROPIC_API_KEY=${answers.anthropicApiKey}\n`;
    if (answers.bedrockRegion) envContent += `BEDROCK_REGION=${answers.bedrockRegion}\n`;
    if (answers.bedrockAccessKeyId) envContent += `BEDROCK_ACCESS_KEY_ID=${answers.bedrockAccessKeyId}\n`;
    if (answers.bedrockSecretAccessKey) envContent += `BEDROCK_SECRET_ACCESS_KEY=${answers.bedrockSecretAccessKey}\n`;
    if (answers.bedrockSessionToken) envContent += `BEDROCK_SESSION_TOKEN=${answers.bedrockSessionToken}\n`;
    if (answers.serperApiKey) envContent += `SERPER_API_KEY=${answers.serperApiKey}\n`;
    if (answers.telegramToken) envContent += `TELEGRAM_TOKEN=${answers.telegramToken}\n`;

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Environment variables saved to ${envPath}`);

    console.log('\n🚀 Setup complete! You can now run "orcbot start" to begin.\n');
}
