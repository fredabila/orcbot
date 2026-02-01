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

            const linkedSpecs = await this.fetchLinkedSkillFiles(content, url);
            const combinedSpec = linkedSpecs.length > 0
                ? `PRIMARY SPEC:\n${content}\n\nLINKED FILES:\n${linkedSpecs.join('\n\n')}`
                : content;

            logger.info('SkillBuilder: Processing spec with LLM...');
            const prompt = `
I need you to generate a TypeScript plugin for OrcBot based on the following specification found at ${url}.
The specification is:
"""
${combinedSpec}
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

    private extractSkillFileUrls(content: string): { url: string; label: string }[] {
        const sectionMatch = content.match(/##\s*Skill Files([\s\S]*?)(?:\n##\s|$)/i);
        if (!sectionMatch) return [];

        const section = sectionMatch[1];
        const lines = section.split('\n').map(line => line.trim()).filter(Boolean);
        const results: { url: string; label: string }[] = [];

        for (const line of lines) {
            const urlMatch = line.match(/https?:\/\/[^\s|)]+/i);
            if (!urlMatch) continue;
            const url = urlMatch[0];
            const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
            const label = cells.length > 1 ? cells[0].replace(/\*\*/g, '') : 'Linked File';
            results.push({ url, label });
        }

        return results;
    }

    private async fetchLinkedSkillFiles(content: string, baseUrl: string): Promise<string[]> {
        const files = this.extractSkillFileUrls(content);
        if (files.length === 0) return [];

        const unique = new Map<string, string>();
        for (const file of files) {
            if (unique.has(file.url)) continue;
            unique.set(file.url, file.label);
        }

        const results: string[] = [];
        for (const [fileUrl, label] of unique.entries()) {
            try {
                const response = await fetch(fileUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                results.push(`[${label}] ${fileUrl}\n${text}`);
            } catch (e) {
                results.push(`[${label}] ${fileUrl}\nError fetching file: ${e}`);
            }
        }

        if (results.length > 0) {
            logger.info(`SkillBuilder: Loaded ${results.length} linked skill files from ${baseUrl}`);
        }

        return results;
    }
}
