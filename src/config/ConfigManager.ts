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
    serperApiKey?: string;
    captchaApiKey?: string;
    modelName?: string;
    autonomyInterval?: number; // In minutes, default 0 (disabled)
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
}

export class ConfigManager {
    private configPath: string;
    private config: AgentConfig;
    private dataHome: string;

    constructor(customPath?: string) {
        this.dataHome = path.join(os.homedir(), '.orcbot');
        if (!fs.existsSync(this.dataHome)) {
            fs.mkdirSync(this.dataHome, { recursive: true });
        }

        // Standard global path
        const globalConfigPath = path.join(this.dataHome, 'orcbot.config.yaml');
        // Local override path
        const localConfigPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        // Final config location: custom > local > global
        this.configPath = customPath || (fs.existsSync(localConfigPath) ? localConfigPath : globalConfigPath);

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
            serperApiKey: process.env.SERPER_API_KEY,
            captchaApiKey: process.env.CAPTCHA_API_KEY,
            telegramToken: process.env.TELEGRAM_TOKEN,
            // @ts-ignore - Dynamic key support
            MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY
        };

        // Filter out undefined env vars
        const activeEnv = Object.fromEntries(
            Object.entries(envConfig).filter(([_, v]) => v !== undefined)
        );

        return {
            ...defaults,
            ...globalConfig,
            ...homeConfig,
            ...localConfig,
            ...customConfig,
            ...activeEnv
        };
    }

    private getStringDefaultConfig(): AgentConfig {
        return {
            agentName: 'OrcBot',
            modelName: 'gpt-4o',
            autonomyInterval: 15,
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
            telegramAutoReplyEnabled: false
        };
    }

    public get(key: string): any {
        return (this.config as any)[key];
    }

    public set(key: string, value: any) {
        (this.config as any)[key] = value;
        this.saveConfig();
    }

    public saveConfig() {
        try {
            fs.writeFileSync(this.configPath, yaml.stringify(this.config));
            logger.info(`Configuration saved to ${this.configPath}`);
        } catch (error) {
            logger.error(`Error saving config: ${error}`);
        }
    }

    public getAll(): AgentConfig {
        return { ...this.config };
    }
}
