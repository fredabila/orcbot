import fs from 'fs';
import { logger } from '../utils/logger';

export interface Skill {
    name: string;
    description: string;
    usage: string;
    handler: (args: any) => Promise<any>;
}

export class SkillsManager {
    private skills: Map<string, Skill> = new Map();

    constructor() {
        this.loadSkills();
    }

    private loadSkills() {
        const skillsPath = process.env.SKILLS_FILE_PATH || './SKILLS.md';
        if (fs.existsSync(skillsPath)) {
            const content = fs.readFileSync(skillsPath, 'utf-8');
            // In a real implementation, we would parse the markdown to extract skill definitions
            // For now, let's log that we found the file
            logger.info(`SkillsManager: Loaded skills definition from ${skillsPath}`);
        } else {
            logger.warn('SkillsManager: SKILLS.md not found.');
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
