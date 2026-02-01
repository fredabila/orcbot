import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface Skill {
    name: string;
    description: string;
    usage: string;
    handler: (args: any) => Promise<any>;
}

export class SkillsManager {
    private skills: Map<string, Skill> = new Map();

    constructor(private skillsPath: string = './SKILLS.md', private pluginsDir?: string) {
        this.loadSkills();
        if (this.pluginsDir) {
            this.loadPlugins();
        }
    }

    private loadSkills() {
        if (fs.existsSync(this.skillsPath)) {
            // Logic for parsing SKILLS.md could go here if needed for documentation
            logger.info(`SkillsManager: Skills definitions active from ${this.skillsPath}`);
        }
    }

    public loadPlugins() {
        if (!this.pluginsDir) return;

        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
            return;
        }

        const files = fs.readdirSync(this.pluginsDir);
        for (const file of files) {
            if (file.endsWith('.js') || file.endsWith('.ts')) {
                const fullPath = path.resolve(this.pluginsDir, file);
                try {
                    // Note: For TS files at runtime, we assume they are either pre-compiled 
                    // or running in a ts-node environment.
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const plugin = require(fullPath);
                    if (plugin.default && plugin.default.name) {
                        this.registerSkill(plugin.default);
                        logger.info(`Loaded plugin: ${plugin.default.name} from ${file}`);
                    } else if (plugin.name) {
                        this.registerSkill(plugin);
                        logger.info(`Loaded plugin: ${plugin.name} from ${file}`);
                    }
                } catch (e) {
                    logger.error(`Failed to load plugin ${file}: ${e}`);
                }
            }
        }
    }

    public registerSkill(skill: Skill) {
        this.skills.set(skill.name, skill);
        logger.info(`Skill registered: ${skill.name}`);
    }

    public async executeSkill(name: string, args: any): Promise<any> {
        const skill = this.skills.get(name);
        if (!skill) {
            throw new Error(`Skill ${name} not found`);
        }
        try {
            logger.info(`Executing skill: ${name}`);
            return await skill.handler(args);
        } catch (error) {
            logger.error(`Error executing skill ${name}: ${error}`);
            throw error;
        }
    }

    public getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    public getSkillsPrompt(): string {
        const skillsList = this.getAllSkills().map(s => `- ${s.name}: ${s.description} (Usage: ${s.usage})`).join('\n');
        return `Available Skills:\n${skillsList}`;
    }
}
