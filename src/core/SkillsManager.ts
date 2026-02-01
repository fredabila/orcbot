import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface AgentContext {
    browser: any; // WebBrowser
    config: any;  // ConfigManager
    agent: any;   // Agent
    logger: any;  // logger
    [key: string]: any;
}

export interface Skill {
    name: string;
    description: string;
    usage: string;
    handler: (args: any, context?: AgentContext) => Promise<any>;
    pluginPath?: string; // Track source file for uninstallation
}

export class SkillsManager {
    private skills: Map<string, Skill> = new Map();
    private context: AgentContext | undefined;

    constructor(private skillsPath: string = './SKILLS.md', private pluginsDir?: string, context?: AgentContext) {
        this.context = context;
        this.loadSkills();
        if (this.pluginsDir) {
            this.loadPlugins();
        }
    }

    public setContext(context: AgentContext) {
        this.context = context;
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

        // Try to register ts-node if we are loading .ts files
        try {
            // Check if we are already in a TS environment
            if (!process[Symbol.for('ts-node.register.instance')]) {
                require('ts-node').register({
                    transpileOnly: true, // Speed up loading, ignore type errors
                    compilerOptions: {
                        module: 'commonjs' // Ensure we output CommonJS for require()
                    }
                });
                logger.info('SkillsManager: Registered ts-node for plugin compilation.');
            }
        } catch (e) {
            // ts-node might not be installed or already registered
            logger.debug(`SkillsManager: ts-node registration skipped: ${e}`);
        }

        const files = fs.readdirSync(this.pluginsDir);
        logger.info(`SkillsManager: Found ${files.length} files in ${this.pluginsDir}: ${files.join(', ')}`);

        for (const file of files) {
            if (file.endsWith('.js') || file.endsWith('.ts')) {
                const fullPath = path.resolve(this.pluginsDir, file);
                try {
                    // HOT RELOAD: Clear cache to force re-read
                    delete require.cache[fullPath];

                    logger.info(`SkillsManager: Attempting to load plugin from ${fullPath}`);
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const plugin = require(fullPath);

                    if (plugin.default && plugin.default.name) {
                        plugin.default.pluginPath = fullPath;
                        this.registerSkill(plugin.default);
                        logger.info(`SkillsManager: Successfully loaded plugin (default export): ${plugin.default.name}`);
                    } else if (plugin.name) {
                        plugin.pluginPath = fullPath;
                        this.registerSkill(plugin);
                        logger.info(`SkillsManager: Successfully loaded plugin (named export): ${plugin.name}`);
                    } else {
                        // Check for named export matching filename
                        const baseName = path.parse(file).name;
                        if (plugin[baseName] && plugin[baseName].name) {
                            plugin[baseName].pluginPath = fullPath;
                            this.registerSkill(plugin[baseName]);
                            logger.info(`SkillsManager: Successfully loaded plugin (matching export): ${plugin[baseName].name}`);
                        } else {
                            logger.warn(`SkillsManager: Plugin ${file} loaded but contains no valid skill export. Keys: ${Object.keys(plugin).join(', ')}`);
                        }
                    }
                } catch (e) {
                    logger.error(`SkillsManager: Failed to load plugin ${file}: ${e}`);
                }
            } else {
                logger.debug(`SkillsManager: Skipping non-script file: ${file}`);
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
            return await skill.handler(args, this.context);
        } catch (error) {
            logger.error(`Error executing skill ${name}: ${error}`);
            throw error;
        }
    }

    public getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    public uninstallSkill(name: string): string {
        const skill = this.skills.get(name);
        if (!skill) return `Skill ${name} not found.`;
        if (!skill.pluginPath) return `Skill ${name} is a core skill and cannot be uninstalled.`;

        try {
            if (fs.existsSync(skill.pluginPath)) {
                fs.unlinkSync(skill.pluginPath);
                this.skills.delete(name);
                logger.info(`Skill uninstalled: ${name} (File deleted: ${skill.pluginPath})`);
                return `Successfully uninstalled ${name}.`;
            } else {
                return `Skill file not found at ${skill.pluginPath}.`;
            }
        } catch (e) {
            return `Failed to uninstall skill ${name}: ${e}`;
        }
    }

    public getSkillsPrompt(): string {
        const skillsList = this.getAllSkills().map(s => `- ${s.name}: ${s.description} (Usage: ${s.usage})`).join('\n');
        return `Available Skills:\n${skillsList}`;
    }
}
