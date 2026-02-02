import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';

export interface AgentConfig {
    agentName: string;
    telegramToken?: string;
    openaiApiKey?: string;
    googleApiKey?: string;
    braveSearchApiKey?: string;
    searxngUrl?: string;
    searchProviderOrder?: string[];
    serperApiKey?: string;
    captchaApiKey?: string;
    modelName?: string;
    bedrockRegion?: string;
    bedrockAccessKeyId?: string;
    bedrockSecretAccessKey?: string;
    bedrockSessionToken?: string;
    autonomyEnabled?: boolean;
    autonomyInterval?: number; // In minutes, default 0 (disabled)
    autonomyBacklogLimit?: number;
    maxActionRunMinutes?: number;
    maxStaleActionMinutes?: number;
    memoryPath?: string;
    skillsPath?: string;
    userProfilePath?: string;
    agentIdentityPath?: string;
    actionQueuePath?: string;
    journalPath?: string;
    learningPath?: string;
    pluginsPath?: string;
    whatsappEnabled?: boolean;
    whatsappSessionPath?: string;
    whatsappAutoReplyEnabled?: boolean;
    whatsappStatusReplyEnabled?: boolean;
    whatsappAutoReactEnabled?: boolean;
    whatsappContextProfilingEnabled?: boolean;
    whatsappOwnerJID?: string;
    telegramAutoReplyEnabled?: boolean;
    maxMessagesPerAction?: number;
    maxStepsPerAction?: number;
    messageDedupWindow?: number;
    commandTimeoutMs?: number;
    commandRetries?: number;
    commandWorkingDir?: string;
    commandAllowList?: string[];
    commandDenyList?: string[];
    safeMode?: boolean;
    sudoMode?: boolean;
    pluginAllowList?: string[];
    pluginDenyList?: string[];
    browserProfileDir?: string;
    browserProfileName?: string;
}

export class ConfigManager {
    private configPath: string;
    private config: AgentConfig;
    private dataHome: string;

    constructor(customPath?: string) {
        // Check for environment variable override first (used by worker processes)
        const envConfigPath = process.env.ORCBOT_CONFIG_PATH;
        const envDataDir = process.env.ORCBOT_DATA_DIR;

        this.dataHome = envDataDir || path.join(os.homedir(), '.orcbot');
        if (!fs.existsSync(this.dataHome)) {
            fs.mkdirSync(this.dataHome, { recursive: true });
        }

        // Standard global path
        const globalConfigPath = path.join(this.dataHome, 'orcbot.config.yaml');
        // Local override path
        const localConfigPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        // Final config location: custom > env > local > global
        this.configPath = customPath || envConfigPath || (fs.existsSync(localConfigPath) ? localConfigPath : globalConfigPath);

        this.config = this.loadConfig(customPath);
        this.startWatcher(customPath);
    }

    private startWatcher(customPath?: string) {
        if (!fs.existsSync(this.configPath)) return;

        // Use a simple debounce to avoid double-loading on rapid saves
        let debounceTimer: NodeJS.Timeout | null = null;

        fs.watch(this.configPath, (eventType) => {
            if (eventType === 'change') {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    logger.info(`ConfigManager: Config file changed on disk, reloading...`);
                    // We load without logging the path again to keep it clean
                    this.config = this.loadConfig(customPath, true);
                }, 100);
            }
        });
    }

    private loadConfig(customPath?: string, silent: boolean = false): AgentConfig {
        const defaults = this.getStringDefaultConfig();
        let globalConfig: any = {};
        let homeConfig: any = {};
        let localConfig: any = {};

        // 1. Search paths
        const globalPath = path.join(this.dataHome, 'orcbot.config.yaml');
        const homePath = path.join(os.homedir(), 'orcbot.config.yaml');
        const localPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        // Load Global (~/.orcbot/orcbot.config.yaml)
        if (fs.existsSync(globalPath)) {
            try { globalConfig = yaml.parse(fs.readFileSync(globalPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading global config from ${globalPath}: ${e}`); }
        }
        // Load Home (~/orcbot.config.yaml) - Fallback where user said theirs is
        if (fs.existsSync(homePath)) {
            try { homeConfig = yaml.parse(fs.readFileSync(homePath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading home config from ${homePath}: ${e}`); }
        }
        // Load Local (./orcbot.config.yaml)
        if (fs.existsSync(localPath)) {
            try { localConfig = yaml.parse(fs.readFileSync(localPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading local config from ${localPath}: ${e}`); }
        }
        // Load Custom
        let customConfig: any = {};
        if (customPath && fs.existsSync(customPath)) {
            try { customConfig = yaml.parse(fs.readFileSync(customPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading custom config from ${customPath}: ${e}`); }
        }

        // Set the primary configPath for saving (prioritize most local existing config)
        this.configPath = customPath || (fs.existsSync(localPath) ? localPath : (fs.existsSync(homePath) ? homePath : globalPath));
        if (!silent) logger.info(`ConfigManager: Config path set to ${this.configPath}`);


        // 2. Merge Env Vars (Highest priority for keys)
        const envConfig: Partial<AgentConfig> = {
            openaiApiKey: process.env.OPENAI_API_KEY,
            googleApiKey: process.env.GOOGLE_API_KEY,
            braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
            searxngUrl: process.env.SEARXNG_URL,
            serperApiKey: process.env.SERPER_API_KEY,
            captchaApiKey: process.env.CAPTCHA_API_KEY,
            telegramToken: process.env.TELEGRAM_TOKEN,
            bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
            bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
            bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
            bedrockSessionToken: process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
            // @ts-ignore - Dynamic key support
            MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY
        };

        // Filter out undefined env vars
        const activeEnv = Object.fromEntries(
            Object.entries(envConfig).filter(([_, v]) => v !== undefined)
        );

        const mergedConfig: AgentConfig = {
            ...defaults,
            ...globalConfig,
            ...homeConfig,
            ...localConfig,
            ...customConfig
        };

        // Apply env vars only as fallback when config value is missing
        Object.entries(activeEnv).forEach(([key, value]) => {
            const current = (mergedConfig as any)[key];
            if (current === undefined || current === null || current === '') {
                (mergedConfig as any)[key] = value;
            } else if (!silent) {
                logger.info(`ConfigManager: Ignoring env override for ${key} because config already defines a value.`);
            }
        });

        return mergedConfig;
    }

    private getStringDefaultConfig(): AgentConfig {
        return {
            agentName: 'OrcBot',
            modelName: 'gpt-4o',
            searchProviderOrder: ['serper', 'brave', 'searxng', 'google', 'bing', 'duckduckgo'],
            autonomyEnabled: true,
            autonomyInterval: 15,
            autonomyBacklogLimit: 3,
            maxActionRunMinutes: 10,
            maxStaleActionMinutes: 30,
            memoryPath: path.join(this.dataHome, 'memory.json'),
            skillsPath: path.join(this.dataHome, 'SKILLS.md'),
            userProfilePath: path.join(this.dataHome, 'USER.md'),
            agentIdentityPath: path.join(this.dataHome, '.AI.md'),
            actionQueuePath: path.join(this.dataHome, 'actions.json'),
            journalPath: path.join(this.dataHome, 'JOURNAL.md'),
            learningPath: path.join(this.dataHome, 'LEARNING.md'),
            pluginsPath: path.join(this.dataHome, 'plugins'),
            whatsappEnabled: false,
            whatsappSessionPath: path.join(this.dataHome, 'whatsapp-session'),
            whatsappAutoReplyEnabled: false,
            whatsappStatusReplyEnabled: false,
            whatsappAutoReactEnabled: false,
            whatsappContextProfilingEnabled: false,
            whatsappOwnerJID: undefined,
            telegramAutoReplyEnabled: false,
            maxMessagesPerAction: 3,
            maxStepsPerAction: 30,
            messageDedupWindow: 10,
            commandTimeoutMs: 120000,
            commandRetries: 1,
            commandWorkingDir: undefined,
            commandAllowList: [
                'npm',
                'node',
                'npx',
                'git',
                'python',
                'pip',
                'pip3',
                'curl',
                'wget',
                'powershell',
                'pwsh',
                'bash',
                'apt',
                'apt-get',
                'yum',
                'dnf',
                'pacman',
                'brew',
                'sudo',
                'systemctl',
                'service',
                'cat',
                'ls',
                'dir',
                'echo',
                'mkdir',
                'touch',
                'cp',
                'mv',
                'head',
                'tail',
                'grep',
                'find',
                'which',
                'whoami',
                'uname',
                'hostname'
            ],
            commandDenyList: [
                'rm',
                'rmdir',
                'del',
                'erase',
                'format',
                'mkfs',
                'dd',
                'shutdown',
                'reboot',
                'poweroff',
                'reg',
                'diskpart',
                'netsh'
            ],
            safeMode: false,
            pluginAllowList: [],
            pluginDenyList: [],
            browserProfileDir: path.join(this.dataHome, 'browser-profiles'),
            browserProfileName: 'default',
            bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
            bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
            bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
            sudoMode: false,
            bedrockSessionToken: process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN
        };
    }

    public get(key: string): any {
        return (this.config as any)[key];
    }

    public set(key: string, value: any) {
        (this.config as any)[key] = value;
        this.saveConfig();
        this.syncEnvForKey(key, value);
    }

    public saveConfig() {
        try {
            fs.writeFileSync(this.configPath, yaml.stringify(this.config));
            logger.info(`Configuration saved to ${this.configPath}`);
        } catch (error) {
            logger.error(`Error saving config: ${error}`);
        }
    }

    private syncEnvForKey(key: string, value: any) {
        const envMap: Record<string, string> = {
            openaiApiKey: 'OPENAI_API_KEY',
            googleApiKey: 'GOOGLE_API_KEY',
            braveSearchApiKey: 'BRAVE_SEARCH_API_KEY',
            searxngUrl: 'SEARXNG_URL',
            serperApiKey: 'SERPER_API_KEY',
            captchaApiKey: 'CAPTCHA_API_KEY',
            telegramToken: 'TELEGRAM_TOKEN',
            bedrockRegion: 'BEDROCK_REGION',
            bedrockAccessKeyId: 'BEDROCK_ACCESS_KEY_ID',
            bedrockSecretAccessKey: 'BEDROCK_SECRET_ACCESS_KEY',
            bedrockSessionToken: 'BEDROCK_SESSION_TOKEN'
        };

        const envKey = envMap[key];
        if (!envKey) return;

        const envPath = path.join(this.dataHome, '.env');
        const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        const lines = existing.split(/\r?\n/).filter(l => l.trim().length > 0);
        const filtered = lines.filter(l => !l.startsWith(envKey + '='));

        if (value !== undefined && value !== null && String(value).trim() !== '') {
            filtered.push(`${envKey}=${String(value).trim()}`);
            process.env[envKey] = String(value).trim();
        } else {
            delete process.env[envKey];
        }

        try {
            fs.writeFileSync(envPath, filtered.join('\n') + (filtered.length ? '\n' : ''));
            logger.info(`ConfigManager: Synced ${envKey} to ${envPath}`);
        } catch (error) {
            logger.warn(`ConfigManager: Failed to sync ${envKey} to ${envPath}: ${error}`);
        }
    }

    public getAll(): AgentConfig {
        return { ...this.config };
    }
}
