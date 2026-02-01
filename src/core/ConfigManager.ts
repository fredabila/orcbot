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

        this.configPath = customPath || path.resolve(process.cwd(), 'orcbot.config.yaml');
        this.config = this.loadConfig();
    }

    private loadConfig(): AgentConfig {
        const defaults = this.getStringDefaultConfig();
        let yamlConfig: any = {};

        // 1. Try local dir first, then fallback to global home
        const pathsToTry = [
            this.configPath, // Usually ./orcbot.config.yaml
            path.join(this.dataHome, 'orcbot.config.yaml')
        ];

        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                try {
                    const fileContents = fs.readFileSync(p, 'utf8');
                    yamlConfig = yaml.parse(fileContents) || {};
                    logger.info(`ConfigManager: Loaded config from ${p}`);
                    break;
                } catch (error) {
                    logger.error(`Error loading config from ${p}: ${error}`);
                }
            }
        }

        // 2. Merge Env Vars (Highest priority for keys)
        const envConfig: Partial<AgentConfig> = {
            openaiApiKey: process.env.OPENAI_API_KEY,
            googleApiKey: process.env.GOOGLE_API_KEY,
            serperApiKey: process.env.SERPER_API_KEY,
            captchaApiKey: process.env.CAPTCHA_API_KEY,
            telegramToken: process.env.TELEGRAM_TOKEN
        };

        // Filter out undefined env vars
        const activeEnv = Object.fromEntries(
            Object.entries(envConfig).filter(([_, v]) => v !== undefined)
        );

        return {
            ...defaults,
            ...yamlConfig,
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
            pluginsPath: path.join(this.dataHome, 'plugins')
        };
    }

    public get(key: keyof AgentConfig): any {
        return this.config[key];
    }

    public set(key: keyof AgentConfig, value: any) {
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
