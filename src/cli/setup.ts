import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import os from 'os';
import { logger } from '../utils/logger';

function checkCancel(val: any) {
    if (p.isCancel(val)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
    }
    return val;
}

export async function runSetup() {
    p.intro(chalk.bgCyan.black(' 🤖 Welcome to the OrcBot Setup Wizard! '));

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

    const maskHint = (key: string) => existingEnv[key] ? chalk.green('(configured - press Enter to keep)') : chalk.gray('(optional)');

    // ── Section 1: Identity & LLM ──
    p.note('Agent Identity & LLM Provider', 'Section 1');

    const agentName = checkCancel(await p.text({
        message: 'Agent Name:',
        initialValue: currentConfig.agentName || 'OrcBot'
    }));

    const llmProvider = checkCancel(await p.select({
        message: 'Primary LLM Provider:',
        initialValue: currentConfig.llmProvider || '',
        options: [
            { label: 'Auto-detect (from available API keys)', value: '' },
            { label: 'OpenAI (GPT-4o, etc.)', value: 'openai' },
            { label: 'Google (Gemini)', value: 'google' },
            { label: 'OpenRouter', value: 'openrouter' },
            { label: 'NVIDIA', value: 'nvidia' },
            { label: 'Anthropic (Claude)', value: 'anthropic' },
            { label: 'AWS Bedrock', value: 'bedrock' },
            { label: 'Groq (ultra-fast inference)', value: 'groq' },
            { label: 'Mistral AI', value: 'mistral' },
            { label: 'Cerebras', value: 'cerebras' },
            { label: 'xAI (Grok)', value: 'xai' }
        ]
    }));

    const modelName = checkCancel(await p.text({
        message: 'Default Model Name:',
        initialValue: currentConfig.modelName || 'gpt-4o'
    }));

    // ── Section 2: API Keys ──
    p.note('API Keys (press Enter to skip/keep existing)', 'Section 2');

    const openaiApiKey = checkCancel(await p.password({ message: `OpenAI API Key ${maskHint('OPENAI_API_KEY')}:` }));
    const googleApiKey = checkCancel(await p.password({ message: `Google (Gemini) API Key ${maskHint('GOOGLE_API_KEY')}:` }));

    let openrouterApiKey;
    if (llmProvider === 'openrouter' || !llmProvider) {
        openrouterApiKey = checkCancel(await p.password({ message: `OpenRouter API Key ${maskHint('OPENROUTER_API_KEY')}:` }));
    }

    const nvidiaApiKey = checkCancel(await p.password({ message: `NVIDIA API Key ${maskHint('NVIDIA_API_KEY')}:` }));
    const anthropicApiKey = checkCancel(await p.password({ message: `Anthropic (Claude) API Key ${maskHint('ANTHROPIC_API_KEY')}:` }));

    let bedrockRegion, bedrockAccessKeyId, bedrockSecretAccessKey;
    if (llmProvider === 'bedrock') {
        bedrockRegion = checkCancel(await p.text({ message: 'AWS Bedrock Region (e.g., us-east-1):' }));
        bedrockAccessKeyId = checkCancel(await p.password({ message: `Bedrock Access Key ID ${maskHint('BEDROCK_ACCESS_KEY_ID')}:` }));
        bedrockSecretAccessKey = checkCancel(await p.password({ message: `Bedrock Secret Access Key ${maskHint('BEDROCK_SECRET_ACCESS_KEY')}:` }));
    }

    const serperApiKey = checkCancel(await p.password({ message: `Serper.dev API Key (web search) ${maskHint('SERPER_API_KEY')}:` }));

    let groqApiKey;
    if (llmProvider === 'groq' || !llmProvider) {
        groqApiKey = checkCancel(await p.password({ message: `Groq API Key ${maskHint('GROQ_API_KEY')}:` }));
    }

    let mistralApiKey;
    if (llmProvider === 'mistral' || !llmProvider) {
        mistralApiKey = checkCancel(await p.password({ message: `Mistral AI API Key ${maskHint('MISTRAL_API_KEY')}:` }));
    }

    let cerebrasApiKey;
    if (llmProvider === 'cerebras') {
        cerebrasApiKey = checkCancel(await p.password({ message: `Cerebras API Key ${maskHint('CEREBRAS_API_KEY')}:` }));
    }

    let xaiApiKey;
    if (llmProvider === 'xai') {
        xaiApiKey = checkCancel(await p.password({ message: `xAI (Grok) API Key ${maskHint('XAI_API_KEY')}:` }));
    }

    // ── Section 3: Channels ──
    p.note('Communication Channels', 'Section 3');

    const telegramToken = checkCancel(await p.password({ message: `Telegram Bot Token ${maskHint('TELEGRAM_TOKEN')}:` }));
    let telegramAutoReplyEnabled = false;
    if (telegramToken || existingEnv['TELEGRAM_TOKEN']) {
        telegramAutoReplyEnabled = checkCancel(await p.confirm({
            message: 'Enable Telegram AI Auto-Reply?',
            initialValue: currentConfig.telegramAutoReplyEnabled || false
        }));
    }

    const whatsappEnabled = checkCancel(await p.confirm({
        message: 'Enable WhatsApp Channel?',
        initialValue: currentConfig.whatsappEnabled || false
    }));
    let whatsappAutoReplyEnabled = false;
    if (whatsappEnabled) {
        whatsappAutoReplyEnabled = checkCancel(await p.confirm({
            message: 'Enable WhatsApp AI Auto-Reply?',
            initialValue: currentConfig.whatsappAutoReplyEnabled || false
        }));
    }

    const discordToken = checkCancel(await p.password({ message: `Discord Bot Token ${maskHint('DISCORD_TOKEN')}:` }));
    let discordAutoReplyEnabled = false;
    if (discordToken || existingEnv['DISCORD_TOKEN']) {
        discordAutoReplyEnabled = checkCancel(await p.confirm({
            message: 'Enable Discord AI Auto-Reply?',
            initialValue: currentConfig.discordAutoReplyEnabled || false
        }));
    }

    const slackBotToken = checkCancel(await p.password({ message: `Slack Bot Token ${maskHint('SLACK_BOT_TOKEN')}:` }));
    const slackAppToken = checkCancel(await p.password({ message: `Slack App Token (Socket Mode) ${maskHint('SLACK_APP_TOKEN')}:` }));
    const slackSigningSecret = checkCancel(await p.password({ message: `Slack Signing Secret ${maskHint('SLACK_SIGNING_SECRET')}:` }));
    let slackAutoReplyEnabled = false;
    if (slackBotToken || existingEnv['SLACK_BOT_TOKEN']) {
        slackAutoReplyEnabled = checkCancel(await p.confirm({
            message: 'Enable Slack AI Auto-Reply?',
            initialValue: currentConfig.slackAutoReplyEnabled || false
        }));
    }

    const emailEnabled = checkCancel(await p.confirm({
        message: 'Enable Email Channel (SMTP + IMAP)?',
        initialValue: currentConfig.emailEnabled || false
    }));

    let emailAddress, smtpHost, smtpPort, smtpSecure, smtpStartTls, smtpUsername, smtpPassword;
    let imapHost, imapPort, imapSecure, imapUsername, imapPassword, emailSocketTimeoutMs, emailAutoReplyEnabled;

    if (emailEnabled) {
        emailAddress = checkCancel(await p.text({ message: `Email Address ${maskHint('EMAIL_ADDRESS')}:` }));
        smtpHost = checkCancel(await p.text({ message: `SMTP Host ${maskHint('SMTP_HOST')}:` }));
        
        const smtpPortInput = checkCancel(await p.text({
            message: 'SMTP Port:',
            initialValue: String(currentConfig.smtpPort || 587)
        }));
        smtpPort = Number(smtpPortInput);
        
        smtpSecure = checkCancel(await p.confirm({
            message: 'Use TLS for SMTP?',
            initialValue: currentConfig.smtpSecure ?? false
        }));
        
        if (!smtpSecure) {
            smtpStartTls = checkCancel(await p.confirm({
                message: 'Use STARTTLS upgrade for SMTP (recommended for port 587)?',
                initialValue: currentConfig.smtpStartTls ?? true
            }));
        }

        smtpUsername = checkCancel(await p.text({ message: `SMTP Username ${maskHint('SMTP_USERNAME')}:` }));
        smtpPassword = checkCancel(await p.password({ message: `SMTP Password ${maskHint('SMTP_PASSWORD')}:` }));

        imapHost = checkCancel(await p.text({ message: `IMAP Host ${maskHint('IMAP_HOST')}:` }));
        
        const imapPortInput = checkCancel(await p.text({
            message: 'IMAP Port:',
            initialValue: String(currentConfig.imapPort || 993)
        }));
        imapPort = Number(imapPortInput);
        
        imapSecure = checkCancel(await p.confirm({
            message: 'Use TLS for IMAP?',
            initialValue: currentConfig.imapSecure ?? true
        }));
        
        imapUsername = checkCancel(await p.text({ message: `IMAP Username ${maskHint('IMAP_USERNAME')}:` }));
        imapPassword = checkCancel(await p.password({ message: `IMAP Password ${maskHint('IMAP_PASSWORD')}:` }));

        const timeoutInput = checkCancel(await p.text({
            message: 'Email socket timeout (ms):',
            initialValue: String(currentConfig.emailSocketTimeoutMs || 15000)
        }));
        emailSocketTimeoutMs = Number(timeoutInput);

        emailAutoReplyEnabled = checkCancel(await p.confirm({
            message: 'Enable Email AI Auto-Reply?',
            initialValue: currentConfig.emailAutoReplyEnabled || false
        }));
    }

    // ── Section 4: Gateway & Safety ──
    p.note('Gateway & Safety', 'Section 4');

    const gatewayEnabled = checkCancel(await p.confirm({
        message: 'Enable Web Gateway (REST API + WebSocket)?',
        initialValue: !!currentConfig.gatewayPort || false
    }));

    let gatewayPort;
    if (gatewayEnabled) {
        const portInput = checkCancel(await p.text({
            message: 'Gateway Port:',
            initialValue: String(currentConfig.gatewayPort || 3100)
        }));
        gatewayPort = Number(portInput);
    }

    const autonomyEnabled = checkCancel(await p.confirm({
        message: 'Enable autonomous task processing (agent works on queued tasks)?',
        initialValue: currentConfig.autonomyEnabled !== false
    }));

    let autonomyInterval;
    if (autonomyEnabled) {
        const intervalInput = checkCancel(await p.text({
            message: 'Autonomy check interval (minutes, 0=continuous):',
            initialValue: String(currentConfig.autonomyInterval || 15)
        }));
        autonomyInterval = Number(intervalInput);
    }

    const projectRoot = checkCancel(await p.text({
        message: 'Project Root Directory (for search/edit skills):',
        initialValue: currentConfig.projectRoot || process.cwd()
    }));

    const pluginsPath = checkCancel(await p.text({
        message: 'Plugins Directory:',
        initialValue: currentConfig.pluginsPath || path.join(dataHome, 'plugins')
    }));

    // Save YAML Config
    const newConfig: Record<string, any> = {
        agentName,
        llmProvider: llmProvider || undefined,
        modelName,
        projectRoot: projectRoot || '.',
        pluginsPath: pluginsPath || path.join(dataHome, 'plugins'),
        memoryPath: path.join(dataHome, 'memory.json'),
        userProfilePath: path.join(dataHome, 'USER.md'),
        journalPath: path.join(dataHome, 'JOURNAL.md'),
        learningPath: path.join(dataHome, 'LEARNING.md'),
        worldPath: path.join(dataHome, 'WORLD.md'),
        agentIdentityPath: path.join(dataHome, '.AI.md'),
        actionQueuePath: path.join(dataHome, 'actions.json'),
        tokenUsagePath: path.join(dataHome, 'token-usage-summary.json'),
        tokenLogPath: path.join(dataHome, 'token-usage.log'),
        // Channels
        telegramAutoReplyEnabled,
        whatsappEnabled,
        whatsappAutoReplyEnabled,
        discordAutoReplyEnabled,
        slackAutoReplyEnabled,
        emailEnabled,
        emailAddress: emailAddress || undefined,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort || undefined,
        smtpSecure: smtpSecure ?? undefined,
        smtpStartTls: smtpStartTls ?? undefined,
        imapHost: imapHost || undefined,
        imapPort: imapPort || undefined,
        imapSecure: imapSecure ?? undefined,
        emailAutoReplyEnabled: emailAutoReplyEnabled || false,
        emailSocketTimeoutMs: emailSocketTimeoutMs || undefined,
        // Autonomy
        autonomyEnabled,
        autonomyInterval: autonomyInterval ?? 15,
        // Gateway
        ...(gatewayEnabled ? { gatewayPort: gatewayPort || 3100 } : {}),
        // Bedrock (non-secret)
        ...(bedrockRegion ? { bedrockRegion } : {})
    };

    // Remove undefined values for clean YAML
    const cleanConfig = Object.fromEntries(
        Object.entries(newConfig).filter(([_, v]) => v !== undefined)
    );

    fs.writeFileSync(configPath, yaml.stringify(cleanConfig));
    p.log.success(`Config saved to ${configPath}`);

    // Save .env (merge with existing — don't wipe keys user didn't update)
    const envEntries: Record<string, string> = { ...existingEnv };
    const envValuesToSave: any = {
        OPENAI_API_KEY: openaiApiKey,
        GOOGLE_API_KEY: googleApiKey,
        OPENROUTER_API_KEY: openrouterApiKey,
        NVIDIA_API_KEY: nvidiaApiKey,
        ANTHROPIC_API_KEY: anthropicApiKey,
        BEDROCK_ACCESS_KEY_ID: bedrockAccessKeyId,
        BEDROCK_SECRET_ACCESS_KEY: bedrockSecretAccessKey,
        SERPER_API_KEY: serperApiKey,
        GROQ_API_KEY: groqApiKey,
        MISTRAL_API_KEY: mistralApiKey,
        CEREBRAS_API_KEY: cerebrasApiKey,
        XAI_API_KEY: xaiApiKey,
        TELEGRAM_TOKEN: telegramToken,
        DISCORD_TOKEN: discordToken,
        SLACK_BOT_TOKEN: slackBotToken,
        SLACK_APP_TOKEN: slackAppToken,
        SLACK_SIGNING_SECRET: slackSigningSecret,
        EMAIL_ADDRESS: emailAddress,
        SMTP_USERNAME: smtpUsername,
        SMTP_PASSWORD: smtpPassword,
        SMTP_STARTTLS: smtpStartTls,
        IMAP_USERNAME: imapUsername,
        IMAP_PASSWORD: imapPassword
    };

    for (const [envKey, value] of Object.entries(envValuesToSave)) {
        if (value !== undefined && value !== '') {
            envEntries[envKey] = String(value);
        }
    }

    const envContent = Object.entries(envEntries)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';

    fs.writeFileSync(envPath, envContent);
    p.log.success(`Environment variables saved to ${envPath}`);

    // Scaffold essential files if they don't exist
    scaffoldFiles(dataHome);

    p.outro(chalk.green('🚀 Setup complete! You can now run "orcbot start" to begin.'));
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
            p.log.step(`Created ${file.name}`);
        }
    }
}
