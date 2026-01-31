import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { logger } from '../utils/logger';

export interface AgentConfig {
    agentName: string;
    telegramToken?: string;
    openaiApiKey?: string;
    googleApiKey?: string;
    modelName?: string;
    autonomyInterval?: number; // In minutes, default 0 (disabled)
    memoryPath?: string;
    skillsPath?: string;
    userProfilePath?: string;
}

export class ConfigManager {
    private configPath: string;
    private config: AgentConfig;

    constructor(customPath?: string) {
        this.configPath = customPath || path.resolve(process.cwd(), 'orcbot.config.yaml');
        this.config = this.loadConfig();
    }

    private loadConfig(): AgentConfig {
        if (fs.existsSync(this.configPath)) {
            try {
                const fileContents = fs.readFileSync(this.configPath, 'utf8');
                return yaml.parse(fileContents) as AgentConfig;
            } catch (error) {
                logger.error(`Error loading config from ${this.configPath}: ${error}`);
                return this.getStringDefaultConfig();
            }
        }
        return this.getStringDefaultConfig();
    }

    private getStringDefaultConfig(): AgentConfig {
        return {
            agentName: 'OrcBot',
            modelName: 'gpt-4o',
            autonomyInterval: 15,
            memoryPath: './memory.json',
            skillsPath: './SKILLS.md',
            userProfilePath: './USER.md'
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
