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
        if (fs.existsSync(this.configPath)) {
            try {
                const fileContents = fs.readFileSync(this.configPath, 'utf8');
                const yamlConfig = yaml.parse(fileContents) || {};

                // Merge YAML with defaults
                return {
                    ...defaults,
                    ...yamlConfig
                };
            } catch (error) {
                logger.error(`Error loading config from ${this.configPath}: ${error}`);
                return defaults;
            }
        }
        return defaults;
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
