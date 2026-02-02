import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface AgentContext {
    browser: any; // WebBrowser
    config: any;  // ConfigManager
    agent: any;   // Agent
    logger: any;  // logger
    workerProfile?: any; // WorkerProfileManager
    [key: string]: any;
}

export interface Skill {
    name: string;
    description: string;
    usage: string;
    handler: (args: any, context?: AgentContext) => Promise<any>;
    pluginPath?: string; // Track source file for uninstallation
    sourceUrl?: string;  // Original URL if generated from a spec
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

    private ensureTsNodeRegistered() {
        try {
            if (!process[Symbol.for('ts-node.register.instance')]) {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('ts-node').register({
                    transpileOnly: true,
                    compilerOptions: {
                        module: 'commonjs'
                    }
                });
                logger.info('SkillsManager: Registered ts-node for plugin compilation.');
            }
        } catch (e) {
            logger.debug(`SkillsManager: ts-node registration skipped or failed: ${e}`);
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

        if (this.context?.config?.get('safeMode')) {
            logger.warn('SkillsManager: Safe mode enabled; plugin loading is disabled.');
            return;
        }

        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
            return;
        }

        // Try to register ts-node if we are loading .ts files
        this.ensureTsNodeRegistered();

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
                    const loadedModule = require(fullPath);

                    let registerable: any = null;

                    if (loadedModule.default && loadedModule.default.name) {
                        registerable = loadedModule.default;
                    } else if (loadedModule.name) {
                        registerable = loadedModule;
                    } else {
                        // Check for named export matching filename
                        const baseName = path.parse(file).name;
                        if (loadedModule[baseName] && loadedModule[baseName].name) {
                            registerable = loadedModule[baseName];
                        }
                    }

                    if (registerable) {
                        const skillName = registerable.name;

                        const allowList = (this.context?.config?.get('pluginAllowList') || []) as string[];
                        const denyList = (this.context?.config?.get('pluginDenyList') || []) as string[];
                        const normalized = skillName.toLowerCase();
                        const allow = allowList.length === 0 || allowList.map(s => s.toLowerCase()).includes(normalized);
                        const deny = denyList.map(s => s.toLowerCase()).includes(normalized);

                        if (deny) {
                            logger.warn(`SkillsManager: Plugin ${skillName} blocked by pluginDenyList.`);
                            continue;
                        }

                        if (!allow) {
                            logger.warn(`SkillsManager: Plugin ${skillName} not in pluginAllowList.`);
                            continue;
                        }

                        // Try to extract sourceUrl from comment header
                        let sourceUrl: string | undefined;
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const urlMatch = content.match(/\/\/ @source: (https?:\/\/[^\s]+)/);
                            if (urlMatch) sourceUrl = urlMatch[1];
                        } catch (e) { }

                        this.registerSkill({
                            name: skillName,
                            description: registerable.description || '',
                            usage: registerable.usage || '',
                            handler: registerable.handler,
                            pluginPath: fullPath,
                            sourceUrl
                        });
                        logger.info(`SkillsManager: Successfully loaded plugin: ${skillName}`);
                    } else {
                        logger.warn(`SkillsManager: Plugin ${file} loaded but contains no valid skill export.`);
                    }
                } catch (e: any) {
                    logger.error(`SkillsManager: Failed to load plugin ${file}: ${e}`);

                    // SELF REPAIR TRIGGER
                    // If it's a TypeScript compilation error, we can try to auto-repair it.
                    if (e.message && e.message.includes('TSError') && this.context && this.context.agent) {
                        const skillName = path.parse(file).name;
                        logger.warn(`SkillsManager: Triggering self-repair for broken plugin ${skillName}...`);

                        // We push a high priority task to the agent to fix this immediately
                        this.context.agent.pushTask(
                            `System Alert: The plugin skill '${skillName}' failed to compile. Error:\n${e.message}\n\nPlease use 'self_repair_skill' to fix it immediately.`,
                            10,
                            { source: 'system', error: e.message, skillName }
                        );
                    }
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

    public async checkPluginsHealth(): Promise<{ healthy: string[]; issues: { skillName: string; pluginPath: string; error: string }[] }> {
        const issues: { skillName: string; pluginPath: string; error: string }[] = [];
        const healthy: string[] = [];

        if (!this.pluginsDir) return { healthy, issues };

        this.ensureTsNodeRegistered();

        const pluginSkills = this.getAllSkills().filter(s => s.pluginPath);
        for (const skill of pluginSkills) {
            const fullPath = skill.pluginPath as string;
            try {
                delete require.cache[fullPath];
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const loadedModule = require(fullPath);

                let registerable: any = null;
                if (loadedModule.default && loadedModule.default.name) {
                    registerable = loadedModule.default;
                } else if (loadedModule.name) {
                    registerable = loadedModule;
                } else {
                    const baseName = path.parse(fullPath).name;
                    if (loadedModule[baseName] && loadedModule[baseName].name) {
                        registerable = loadedModule[baseName];
                    }
                }

                if (!registerable || !registerable.name) {
                    throw new Error('No valid skill export found during health check');
                }

                const healthcheck = registerable.healthcheck || loadedModule.healthcheck || loadedModule.describe;
                if (typeof healthcheck === 'function') {
                    await Promise.resolve(healthcheck({ dryRun: true, healthcheck: true }, this.context));
                }

                healthy.push(registerable.name);
            } catch (e: any) {
                issues.push({
                    skillName: skill.name,
                    pluginPath: fullPath,
                    error: e?.message || String(e)
                });
            }
        }

        return { healthy, issues };
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
