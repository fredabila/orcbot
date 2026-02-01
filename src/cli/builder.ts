import fs from 'fs';
import path from 'path';
import { MultiLLM } from '../core/MultiLLM';
import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../utils/logger';

export class SkillBuilder {
    private llm: MultiLLM;
    private config: ConfigManager;

    constructor() {
        this.config = new ConfigManager();
        this.llm = new MultiLLM({
            apiKey: this.config.get('openaiApiKey'),
            googleApiKey: this.config.get('googleApiKey'),
            modelName: this.config.get('modelName')
        });
    }

    public async buildFromUrl(url: string): Promise<string> {
        logger.info(`SkillBuilder: Fetching spec from ${url}...`);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            const content = await response.text();

            logger.info('SkillBuilder: Processing spec with LLM...');
            const prompt = `
I need you to generate a TypeScript plugin for OrcBot based on the following specification found at ${url}.
The specification is:
"""
${content}
"""

RULES for the generated code:
1. Export a default object that implements the Skill interface:
   {
     name: string,
     description: string,
     usage: string,
     handler: async (args: any, context: AgentContext) => Promise<any>
   }
2. The code MUST be self-contained. Import necessary Node.js modules (fs, path, child_process, etc.).
3. The 'context' object contains: browser, config, agent, memory, and a 'logger' object.
4. IMPORTANT: Use 'context.logger' for all logging. DO NOT attempt to import the internal OrcBot logger.
5. IMPORTANT: Use 'context.config.get("KEY_NAME")' to retrieve API keys or settings. DO NOT use direct property access (e.g., context.config.KEY_NAME is wrong).
6. NO EXTERNAL DEPENDENCIES besides what is already in the project (playwright, telegraf, croner, etc.).
7. Output ONLY the raw TypeScript code, no markdown blocks.

Output the code for the .ts file:
`;

            const generatedCode = await this.llm.call(prompt, "You are an expert TypeScript developer specializing in autonomous AI agent plugins.");

            // Extract code if LLM wrapped it in backticks (safeguard)
            const cleanCode = generatedCode.replace(/```typescript/g, '').replace(/```/g, '').trim();

            // Generate a filename from the skill name if possible, or use a timestamp
            const skillNameMatch = cleanCode.match(/name:\s*['"]([^'"]+)['"]/);
            const fileName = (skillNameMatch ? skillNameMatch[1].toLowerCase().replace(/\s+/g, '_') : `custom_skill_${Date.now()}`) + '.ts';

            const pluginsDir = path.resolve(process.cwd(), this.config.get('pluginsPath') || './plugins');
            if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

            const filePath = path.join(pluginsDir, fileName);
            const taggedCode = `// @source: ${url}\n${cleanCode}`;
            fs.writeFileSync(filePath, taggedCode);

            logger.info(`SkillBuilder: Generated skill saved to ${filePath}`);
            return `Successfully built and installed skill: ${fileName}`;

        } catch (e) {
            logger.error(`SkillBuilder Error: ${e}`);
            return `Error building skill: ${e}`;
        }
    }
}
