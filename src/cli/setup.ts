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

    // Load existing .env values so we can show masked hints
    let existingEnv: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
        try {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const match = line.match(/^([A-Z_]+)=(.+)$/);
                if (match) existingEnv[match[1]] = match[2];
            }
        } catch {}
    }

    const maskHint = (key: string) => existingEnv[key] ? '(configured - press Enter to keep)' : '(optional)';

    // ── Section 1: Identity & LLM ──
    console.log('─── Agent Identity & LLM Provider ───\n');

    const identityAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'agentName',
            message: 'Agent Name:',
            default: currentConfig.agentName || 'OrcBot'
        },
        {
            type: 'list',
            name: 'llmProvider',
            message: 'Primary LLM Provider:',
            choices: [
                { name: 'Auto-detect (from available API keys)', value: '' },
                { name: 'OpenAI (GPT-4o, etc.)', value: 'openai' },
                { name: 'Google (Gemini)', value: 'google' },
                { name: 'OpenRouter', value: 'openrouter' },
                { name: 'NVIDIA', value: 'nvidia' },
                { name: 'Anthropic (Claude)', value: 'anthropic' },
                { name: 'AWS Bedrock', value: 'bedrock' },
                { name: 'Groq (ultra-fast inference)', value: 'groq' },
                { name: 'Mistral AI', value: 'mistral' },
                { name: 'Cerebras', value: 'cerebras' },
                { name: 'xAI (Grok)', value: 'xai' }
            ],
            default: currentConfig.llmProvider || ''
        },
        {
            type: 'input',
            name: 'modelName',
            message: 'Default Model Name:',
            default: currentConfig.modelName || 'gpt-4o'
        }
    ]);

    // ── Section 2: API Keys ──
    console.log('\n─── API Keys (press Enter to skip/keep existing) ───\n');

    const keyAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'openaiApiKey',
            message: `OpenAI API Key ${maskHint('OPENAI_API_KEY')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'googleApiKey',
            message: `Google (Gemini) API Key ${maskHint('GOOGLE_API_KEY')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'openrouterApiKey',
            message: `OpenRouter API Key ${maskHint('OPENROUTER_API_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'openrouter' || !identityAnswers.llmProvider
        },
        {
            type: 'input',
            name: 'nvidiaApiKey',
            message: `NVIDIA API Key ${maskHint('NVIDIA_API_KEY')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'anthropicApiKey',
            message: `Anthropic (Claude) API Key ${maskHint('ANTHROPIC_API_KEY')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'bedrockRegion',
            message: 'AWS Bedrock Region (e.g., us-east-1):',
            when: () => identityAnswers.llmProvider === 'bedrock'
        },
        {
            type: 'input',
            name: 'bedrockAccessKeyId',
            message: `Bedrock Access Key ID ${maskHint('BEDROCK_ACCESS_KEY_ID')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'bedrock'
        },
        {
            type: 'input',
            name: 'bedrockSecretAccessKey',
            message: `Bedrock Secret Access Key ${maskHint('BEDROCK_SECRET_ACCESS_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'bedrock'
        },
        {
            type: 'input',
            name: 'serperApiKey',
            message: `Serper.dev API Key (web search) ${maskHint('SERPER_API_KEY')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'groqApiKey',
            message: `Groq API Key ${maskHint('GROQ_API_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'groq' || !identityAnswers.llmProvider
        },
        {
            type: 'input',
            name: 'mistralApiKey',
            message: `Mistral AI API Key ${maskHint('MISTRAL_API_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'mistral' || !identityAnswers.llmProvider
        },
        {
            type: 'input',
            name: 'cerebrasApiKey',
            message: `Cerebras API Key ${maskHint('CEREBRAS_API_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'cerebras'
        },
        {
            type: 'input',
            name: 'xaiApiKey',
            message: `xAI (Grok) API Key ${maskHint('XAI_API_KEY')}:`,
            mask: '*',
            when: () => identityAnswers.llmProvider === 'xai'
        }
    ]);

    // ── Section 3: Channels ──
    console.log('\n─── Communication Channels ───\n');

    const channelAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'telegramToken',
            message: `Telegram Bot Token ${maskHint('TELEGRAM_TOKEN')}:`,
            mask: '*'
        },
        {
            type: 'confirm',
            name: 'telegramAutoReplyEnabled',
            message: 'Enable Telegram AI Auto-Reply?',
            default: currentConfig.telegramAutoReplyEnabled || false,
            when: (ans) => !!ans.telegramToken || !!existingEnv['TELEGRAM_TOKEN']
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
            message: 'Enable WhatsApp AI Auto-Reply?',
            default: currentConfig.whatsappAutoReplyEnabled || false,
            when: (ans) => ans.whatsappEnabled
        },
        {
            type: 'input',
            name: 'discordToken',
            message: `Discord Bot Token ${maskHint('DISCORD_TOKEN')}:`,
            mask: '*'
        },
        {
            type: 'confirm',
            name: 'discordAutoReplyEnabled',
            message: 'Enable Discord AI Auto-Reply?',
            default: currentConfig.discordAutoReplyEnabled || false,
            when: (ans) => !!ans.discordToken || !!existingEnv['DISCORD_TOKEN']
        },
        {
            type: 'input',
            name: 'slackBotToken',
            message: `Slack Bot Token ${maskHint('SLACK_BOT_TOKEN')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'slackAppToken',
            message: `Slack App Token (Socket Mode) ${maskHint('SLACK_APP_TOKEN')}:`,
            mask: '*'
        },
        {
            type: 'input',
            name: 'slackSigningSecret',
            message: `Slack Signing Secret ${maskHint('SLACK_SIGNING_SECRET')}:`,
            mask: '*'
        },
        {
            type: 'confirm',
            name: 'slackAutoReplyEnabled',
            message: 'Enable Slack AI Auto-Reply?',
            default: currentConfig.slackAutoReplyEnabled || false,
            when: (ans) => !!ans.slackBotToken || !!existingEnv['SLACK_BOT_TOKEN']
        }
    ]);

    // ── Section 4: Gateway & Safety ──
    console.log('\n─── Gateway & Safety ───\n');

    const safetyAnswers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'gatewayEnabled',
            message: 'Enable Web Gateway (REST API + WebSocket)?',
            default: !!currentConfig.gatewayPort || false
        },
        {
            type: 'number',
            name: 'gatewayPort',
            message: 'Gateway Port:',
            default: currentConfig.gatewayPort || 3100,
            when: (ans) => ans.gatewayEnabled
        },
        {
            type: 'confirm',
            name: 'autonomyEnabled',
            message: 'Enable autonomous task processing (agent works on queued tasks)?',
            default: currentConfig.autonomyEnabled !== false
        },
        {
            type: 'number',
            name: 'autonomyInterval',
            message: 'Autonomy check interval (minutes, 0=continuous):',
            default: currentConfig.autonomyInterval || 15,
            when: (ans) => ans.autonomyEnabled
        },
        {
            type: 'input',
            name: 'pluginsPath',
            message: 'Plugins Directory:',
            default: currentConfig.pluginsPath || path.join(dataHome, 'plugins')
        }
    ]);

    // ── Build config ──
    const answers = { ...identityAnswers, ...keyAnswers, ...channelAnswers, ...safetyAnswers };

    // Save YAML Config
    const newConfig: Record<string, any> = {
        agentName: answers.agentName,
        llmProvider: answers.llmProvider || undefined,
        modelName: answers.modelName,
        pluginsPath: answers.pluginsPath || path.join(dataHome, 'plugins'),
        memoryPath: path.join(dataHome, 'memory.json'),
        userProfilePath: path.join(dataHome, 'USER.md'),
        journalPath: path.join(dataHome, 'JOURNAL.md'),
        learningPath: path.join(dataHome, 'LEARNING.md'),
        agentIdentityPath: path.join(dataHome, '.AI.md'),
        actionQueuePath: path.join(dataHome, 'actions.json'),
        tokenUsagePath: path.join(dataHome, 'token-usage-summary.json'),
        tokenLogPath: path.join(dataHome, 'token-usage.log'),
        // Channels
        telegramAutoReplyEnabled: answers.telegramAutoReplyEnabled || false,
        whatsappEnabled: answers.whatsappEnabled || false,
        whatsappAutoReplyEnabled: answers.whatsappAutoReplyEnabled || false,
        discordAutoReplyEnabled: answers.discordAutoReplyEnabled || false,
        slackAutoReplyEnabled: answers.slackAutoReplyEnabled || false,
        // Autonomy
        autonomyEnabled: answers.autonomyEnabled !== false,
        autonomyInterval: answers.autonomyInterval ?? 15,
        // Gateway
        ...(answers.gatewayEnabled ? { gatewayPort: answers.gatewayPort || 3100 } : {}),
        // Bedrock (non-secret)
        ...(answers.bedrockRegion ? { bedrockRegion: answers.bedrockRegion } : {})
    };

    // Remove undefined values for clean YAML
    const cleanConfig = Object.fromEntries(
        Object.entries(newConfig).filter(([_, v]) => v !== undefined)
    );

    fs.writeFileSync(configPath, yaml.stringify(cleanConfig));
    console.log(`\n✅ Config saved to ${configPath}`);

    // Save .env (merge with existing — don't wipe keys user didn't update)
    const envEntries: Record<string, string> = { ...existingEnv };
    const envMap: Record<string, string> = {
        openaiApiKey: 'OPENAI_API_KEY',
        googleApiKey: 'GOOGLE_API_KEY',
        openrouterApiKey: 'OPENROUTER_API_KEY',
        nvidiaApiKey: 'NVIDIA_API_KEY',
        anthropicApiKey: 'ANTHROPIC_API_KEY',
        bedrockAccessKeyId: 'BEDROCK_ACCESS_KEY_ID',
        bedrockSecretAccessKey: 'BEDROCK_SECRET_ACCESS_KEY',
        serperApiKey: 'SERPER_API_KEY',
        groqApiKey: 'GROQ_API_KEY',
        mistralApiKey: 'MISTRAL_API_KEY',
        cerebrasApiKey: 'CEREBRAS_API_KEY',
        xaiApiKey: 'XAI_API_KEY',
        telegramToken: 'TELEGRAM_TOKEN',
        discordToken: 'DISCORD_TOKEN',
        slackBotToken: 'SLACK_BOT_TOKEN',
        slackAppToken: 'SLACK_APP_TOKEN',
        slackSigningSecret: 'SLACK_SIGNING_SECRET'
    };

    for (const [field, envKey] of Object.entries(envMap)) {
        const value = (answers as any)[field];
        if (value) {
            envEntries[envKey] = value;
        }
    }

    const envContent = Object.entries(envEntries)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Environment variables saved to ${envPath}`);

    // Scaffold essential files if they don't exist
    scaffoldFiles(dataHome);

    console.log('\n🚀 Setup complete! You can now run "orcbot start" to begin.\n');
}

/**
 * Create essential files for a new environment if they don't exist.
 */
export function scaffoldFiles(dataHome: string) {
    const files: Array<{ name: string; content: string }> = [
        { name: 'USER.md', content: '# User Profile\n\nDescribe yourself here so the agent knows who you are.\n' },
        { name: '.AI.md', content: '# Agent Identity\n\nI am OrcBot, an autonomous AI assistant.\n' },
        { name: 'JOURNAL.md', content: '# Agent Journal\n\n' },
        { name: 'LEARNING.md', content: '# Agent Learning\n\n' },
        { name: 'SKILLS.md', content: '# Skills\n\nAvailable skills are auto-discovered at runtime.\n' }
    ];

    const dirs = ['plugins', 'profiles', 'memory', 'downloads'];

    for (const dir of dirs) {
        const dirPath = path.join(dataHome, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    for (const file of files) {
        const filePath = path.join(dataHome, file.name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.content);
            console.log(`   Created ${file.name}`);
        }
    }
}
