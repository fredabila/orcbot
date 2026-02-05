import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface AgentContext {
    browser: any; // WebBrowser
    config: any;  // ConfigManager
    agent: any;   // Agent
    logger: any;  // logger
    workerProfile?: any; // WorkerProfileManager
    orchestrator?: any;  // AgentOrchestrator
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

/**
 * Agent Skills (SKILL.md) format - compatible with agentskills.io specification.
 * These are declarative skill packages containing instructions, scripts, references, and assets.
 */
export interface AgentSkillMeta {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    allowedTools?: string;
    // OrcBot extensions
    orcbot?: {
        autoActivate?: boolean;           // Activate by default on startup
        requiredConfig?: string[];        // Config keys required
        requiredPackages?: string[];      // NPM packages needed
        permissions?: string[];           // e.g. ['network', 'filesystem', 'browser']
        triggerPatterns?: string[];       // Regex patterns that auto-activate the skill
    };
}

export interface AgentSkill {
    meta: AgentSkillMeta;
    instructions: string;    // Full SKILL.md body (loaded on activation)
    skillDir: string;        // Absolute path to skill directory
    activated: boolean;      // Whether instructions are currently loaded into context
    scripts: string[];       // Relative paths of files in scripts/
    references: string[];    // Relative paths of files in references/
    assets: string[];        // Relative paths of files in assets/
}

export class SkillsManager {
    private skills: Map<string, Skill> = new Map();
    private agentSkills: Map<string, AgentSkill> = new Map();
    private context: AgentContext | undefined;
    private lastLoadErrors: Map<string, string> = new Map();

    constructor(private skillsPath: string = './SKILLS.md', private pluginsDir?: string, context?: AgentContext) {
        this.context = context;
        this.loadSkills();
        if (this.pluginsDir) {
            this.loadPlugins();
            this.discoverAgentSkills();
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
                    const errorMsg = e?.message || String(e);
                    logger.error(`SkillsManager: Failed to load plugin ${file}: ${errorMsg}`);
                    
                    // Track this error for later querying
                    this.lastLoadErrors.set(path.parse(file).name, errorMsg);

                    // SELF REPAIR TRIGGER
                    // If it's a TypeScript compilation error, we can try to auto-repair it.
                    if ((errorMsg.includes('TSError') || errorMsg.includes('SyntaxError') || errorMsg.includes('Unexpected')) && this.context && this.context.agent) {
                        const skillName = path.parse(file).name;
                        logger.warn(`SkillsManager: Triggering self-repair for broken plugin ${skillName}...`);

                        // We push a high priority task to the agent to fix this immediately
                        this.context.agent.pushTask(
                            `System Alert: The plugin skill '${skillName}' failed to compile. Error:\n${errorMsg}\n\nPlease use 'self_repair_skill' to fix it immediately.`,
                            10,
                            { source: 'system', error: errorMsg, skillName }
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

    // ─── Agent Skills (SKILL.md format) ──────────────────────────────────

    /**
     * Discover SKILL.md-based skills in the plugins directory.
     * Scans for directories containing a SKILL.md file and parses their frontmatter.
     */
    public discoverAgentSkills() {
        if (!this.pluginsDir) return;

        const skillsDir = path.join(this.pluginsDir, 'skills');
        if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true });
            return;
        }

        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(skillsDir, entry.name);
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            try {
                const content = fs.readFileSync(skillMdPath, 'utf8');
                const parsed = this.parseSkillMd(content);
                if (!parsed) {
                    logger.warn(`SkillsManager: Invalid SKILL.md in ${entry.name} — skipping`);
                    continue;
                }

                // Validate name matches directory
                if (parsed.meta.name !== entry.name) {
                    logger.warn(`SkillsManager: SKILL.md name "${parsed.meta.name}" doesn't match directory "${entry.name}" — using directory name`);
                    parsed.meta.name = entry.name;
                }

                // Discover bundled resources
                const scripts = this.listDir(path.join(skillDir, 'scripts'));
                const references = this.listDir(path.join(skillDir, 'references'));
                const assets = this.listDir(path.join(skillDir, 'assets'));

                const agentSkill: AgentSkill = {
                    meta: parsed.meta,
                    instructions: parsed.body,
                    skillDir,
                    activated: false,
                    scripts,
                    references,
                    assets
                };

                this.agentSkills.set(parsed.meta.name, agentSkill);
                logger.info(`SkillsManager: Discovered agent skill: ${parsed.meta.name} — ${parsed.meta.description.slice(0, 80)}...`);

                // Auto-activate if configured
                if (parsed.meta.orcbot?.autoActivate) {
                    agentSkill.activated = true;
                }
            } catch (e: any) {
                logger.error(`SkillsManager: Error loading skill from ${entry.name}: ${e.message}`);
                this.lastLoadErrors.set(entry.name, e.message);
            }
        }

        logger.info(`SkillsManager: Discovered ${this.agentSkills.size} agent skills`);
    }

    /**
     * Parse a SKILL.md file into frontmatter metadata and body instructions.
     */
    public parseSkillMd(content: string): { meta: AgentSkillMeta; body: string } | null {
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        if (!fmMatch) return null;

        const fmText = fmMatch[1];
        const body = fmMatch[2].trim();

        // Simple YAML parser for frontmatter (avoids adding yaml dependency to this module)
        const meta: any = {};
        let currentKey = '';
        let inOrcbot = false;
        let inArray = false;
        let arrayKey = '';
        const orcbot: any = {};
        const metadataMap: Record<string, string> = {};
        let inMetadata = false;

        for (const line of fmText.split('\n')) {
            const trimmed = line.trimEnd();

            // Array item
            if (trimmed.match(/^\s+-\s+/)) {
                const val = trimmed.replace(/^\s+-\s+/, '').replace(/^['"]|['"]$/g, '');
                if (inArray && arrayKey) {
                    if (inOrcbot) {
                        if (!orcbot[arrayKey]) orcbot[arrayKey] = [];
                        orcbot[arrayKey].push(val);
                    }
                }
                continue;
            }

            inArray = false;

            // Nested key detection
            if (trimmed.match(/^\s{2,}\w/)) {
                const kvMatch = trimmed.match(/^\s+(\w[\w-]*)\s*:\s*(.*)/);
                if (kvMatch) {
                    const k = kvMatch[1].trim();
                    const v = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');
                    if (inOrcbot) {
                        if (!v) {
                            inArray = true;
                            arrayKey = k;
                        } else if (v === 'true') orcbot[k] = true;
                        else if (v === 'false') orcbot[k] = false;
                        else orcbot[k] = v;
                    } else if (inMetadata) {
                        metadataMap[k] = v;
                    }
                }
                continue;
            }

            inOrcbot = false;
            inMetadata = false;

            const kvMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)/);
            if (kvMatch) {
                currentKey = kvMatch[1].trim();
                const rawVal = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');

                if (currentKey === 'orcbot') {
                    inOrcbot = true;
                    continue;
                }
                if (currentKey === 'metadata') {
                    inMetadata = true;
                    continue;
                }

                if (!rawVal) {
                    inArray = true;
                    arrayKey = currentKey;
                } else {
                    meta[currentKey] = rawVal;
                }
            }
        }

        if (Object.keys(orcbot).length > 0) meta.orcbot = orcbot;
        if (Object.keys(metadataMap).length > 0) meta.metadata = metadataMap;

        if (!meta.name || !meta.description) return null;

        return { meta: meta as AgentSkillMeta, body };
    }

    /**
     * Validate a SKILL.md file/directory against the Agent Skills specification.
     */
    public validateSkill(skillDir: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        if (!fs.existsSync(skillMdPath)) {
            return { valid: false, errors: ['SKILL.md not found'] };
        }

        const content = fs.readFileSync(skillMdPath, 'utf8');
        const parsed = this.parseSkillMd(content);

        if (!parsed) {
            errors.push('Invalid or missing YAML frontmatter');
            return { valid: false, errors };
        }

        const { meta } = parsed;

        // Name validation
        if (meta.name.length > 64) errors.push('name must be 64 characters or fewer');
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(meta.name)) errors.push('name must be lowercase alphanumeric with hyphens, cannot start/end with hyphen');
        if (/--/.test(meta.name)) errors.push('name must not contain consecutive hyphens');

        // Directory name must match
        const dirName = path.basename(skillDir);
        if (dirName !== meta.name) errors.push(`name "${meta.name}" must match directory name "${dirName}"`);

        // Description validation
        if (meta.description.length > 1024) errors.push('description must be 1024 characters or fewer');
        if (meta.description.length < 10) errors.push('description is too short — include what the skill does and when to use it');

        // Compatibility
        if (meta.compatibility && meta.compatibility.length > 500) errors.push('compatibility must be 500 characters or fewer');

        // Body validation
        if (parsed.body.split('\n').length > 500) {
            errors.push('SKILL.md body exceeds 500 lines — consider moving content to references/');
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Get all discovered agent skills (metadata only — for progressive disclosure).
     */
    public getAgentSkills(): AgentSkill[] {
        return Array.from(this.agentSkills.values());
    }

    /**
     * Get a specific agent skill by name.
     */
    public getAgentSkill(name: string): AgentSkill | undefined {
        return this.agentSkills.get(name);
    }

    /**
     * Activate an agent skill — loads its full instructions into context.
     */
    public activateAgentSkill(name: string): AgentSkill | undefined {
        const skill = this.agentSkills.get(name);
        if (!skill) return undefined;
        skill.activated = true;
        logger.info(`SkillsManager: Activated agent skill: ${name}`);
        return skill;
    }

    /**
     * Deactivate an agent skill — removes its instructions from context.
     */
    public deactivateAgentSkill(name: string): boolean {
        const skill = this.agentSkills.get(name);
        if (!skill) return false;
        skill.activated = false;
        logger.info(`SkillsManager: Deactivated agent skill: ${name}`);
        return true;
    }

    /**
     * Read a bundled resource file from an agent skill.
     */
    public readSkillResource(skillName: string, relativePath: string): string | null {
        const skill = this.agentSkills.get(skillName);
        if (!skill) return null;
        const fullPath = path.join(skill.skillDir, relativePath);
        // Security: ensure we stay inside the skill directory
        if (!fullPath.startsWith(skill.skillDir)) return null;
        if (!fs.existsSync(fullPath)) return null;
        return fs.readFileSync(fullPath, 'utf8');
    }

    /**
     * Get the agent skills metadata prompt for injection into LLM context.
     * Only metadata is included (progressive disclosure level 1).
     */
    public getAgentSkillsPrompt(): string {
        if (this.agentSkills.size === 0) return '';

        const lines: string[] = ['<available_skills>'];
        for (const skill of this.agentSkills.values()) {
            lines.push(`  <skill>`);
            lines.push(`    <name>${skill.meta.name}</name>`);
            lines.push(`    <description>${skill.meta.description}</description>`);
            if (skill.scripts.length > 0) lines.push(`    <scripts>${skill.scripts.join(', ')}</scripts>`);
            if (skill.references.length > 0) lines.push(`    <references>${skill.references.join(', ')}</references>`);
            lines.push(`  </skill>`);
        }
        lines.push('</available_skills>');
        return lines.join('\n');
    }

    /**
     * Get the full instructions of all activated skills (progressive disclosure level 2).
     */
    public getActivatedSkillsContext(): string {
        const activated = Array.from(this.agentSkills.values()).filter(s => s.activated);
        if (activated.length === 0) return '';

        const parts: string[] = ['<activated_skills>'];
        for (const skill of activated) {
            parts.push(`<skill name="${skill.meta.name}">`);
            parts.push(skill.instructions);
            parts.push('</skill>');
        }
        parts.push('</activated_skills>');
        return parts.join('\n');
    }

    /**
     * Match agent skills to a task description (for auto-activation).
     */
    public matchSkillsForTask(taskDescription: string): AgentSkill[] {
        const lower = taskDescription.toLowerCase();
        const matches: AgentSkill[] = [];

        for (const skill of this.agentSkills.values()) {
            // Check trigger patterns first
            if (skill.meta.orcbot?.triggerPatterns) {
                for (const pattern of skill.meta.orcbot.triggerPatterns) {
                    try {
                        if (new RegExp(pattern, 'i').test(taskDescription)) {
                            matches.push(skill);
                            break;
                        }
                    } catch (e) { /* invalid regex, skip */ }
                }
                continue;
            }

            // Fuzzy match: check if description keywords overlap with task
            const descWords = skill.meta.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const matchCount = descWords.filter(w => lower.includes(w)).length;
            if (matchCount >= 3 || (matchCount >= 2 && descWords.length <= 8)) {
                matches.push(skill);
            }
        }

        return matches;
    }

    /**
     * Install a skill from a local directory or .skill (zip) file.
     */
    public async installSkillFromPath(sourcePath: string): Promise<{ success: boolean; message: string; skillName?: string }> {
        if (!this.pluginsDir) return { success: false, message: 'No plugins directory configured' };
        const skillsDir = path.join(this.pluginsDir, 'skills');

        // Handle .skill (zip) files
        if (sourcePath.endsWith('.skill') || sourcePath.endsWith('.zip')) {
            try {
                const { execSync } = require('child_process');
                const tempDir = path.join(skillsDir, '_temp_' + Date.now());
                fs.mkdirSync(tempDir, { recursive: true });

                // Use tar on unix, PowerShell on Windows
                if (process.platform === 'win32') {
                    execSync(`powershell -Command "Expand-Archive -Force -Path '${sourcePath}' -DestinationPath '${tempDir}'"`, { timeout: 30000 });
                } else {
                    execSync(`unzip -o "${sourcePath}" -d "${tempDir}"`, { timeout: 30000 });
                }

                // Find the SKILL.md inside
                const entries = this.findSkillMdRecursive(tempDir);
                if (entries.length === 0) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return { success: false, message: 'No SKILL.md found in archive' };
                }

                // Move the skill directory to the proper location
                const extractedDir = path.dirname(entries[0]);
                const content = fs.readFileSync(entries[0], 'utf8');
                const parsed = this.parseSkillMd(content);
                const skillName = parsed?.meta?.name || path.basename(extractedDir);
                const targetDir = path.join(skillsDir, skillName);

                if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
                fs.renameSync(extractedDir, targetDir);
                fs.rmSync(tempDir, { recursive: true, force: true });

                this.discoverAgentSkills();
                return { success: true, message: `Installed skill "${skillName}"`, skillName };
            } catch (e: any) {
                return { success: false, message: `Failed to extract archive: ${e.message}` };
            }
        }

        // Handle directory copy
        if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
            const skillMdPath = path.join(sourcePath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                return { success: false, message: 'No SKILL.md found in source directory' };
            }

            const content = fs.readFileSync(skillMdPath, 'utf8');
            const parsed = this.parseSkillMd(content);
            if (!parsed) return { success: false, message: 'Invalid SKILL.md format' };

            const targetDir = path.join(skillsDir, parsed.meta.name);
            if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });

            this.copyDirRecursive(sourcePath, targetDir);
            this.discoverAgentSkills();
            return { success: true, message: `Installed skill "${parsed.meta.name}"`, skillName: parsed.meta.name };
        }

        return { success: false, message: `Source path not found: ${sourcePath}` };
    }

    /**
     * Install a skill from a GitHub URL, gist, or raw URL.
     */
    public async installSkillFromUrl(url: string): Promise<{ success: boolean; message: string; skillName?: string }> {
        if (!this.pluginsDir) return { success: false, message: 'No plugins directory configured' };
        const skillsDir = path.join(this.pluginsDir, 'skills');
        if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

        try {
            const { execSync } = require('child_process');

            // GitHub repo URL — clone it
            const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+))?$/i);
            if (ghMatch) {
                const [, owner, repo, branch, subpath] = ghMatch;
                const tempDir = path.join(skillsDir, '_temp_' + Date.now());

                if (subpath) {
                    // Sparse checkout for subdirectory
                    const repoUrl = `https://github.com/${owner}/${repo}.git`;
                    const branchArg = branch || 'main';
                    execSync(`git clone --depth 1 --filter=blob:none --sparse -b ${branchArg} "${repoUrl}" "${tempDir}"`, { timeout: 60000, stdio: 'pipe' });
                    execSync(`git -C "${tempDir}" sparse-checkout set "${subpath}"`, { timeout: 30000, stdio: 'pipe' });
                    const sourcePath = path.join(tempDir, subpath);
                    const result = await this.installSkillFromPath(sourcePath);
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return result;
                } else {
                    // Clone entire repo
                    const repoUrl = `https://github.com/${owner}/${repo}.git`;
                    execSync(`git clone --depth 1 "${repoUrl}" "${tempDir}"`, { timeout: 60000, stdio: 'pipe' });

                    // Look for SKILL.md in the repo root or one level down
                    const entries = this.findSkillMdRecursive(tempDir, 2);
                    if (entries.length === 0) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        return { success: false, message: 'No SKILL.md found in repository' };
                    }

                    const skillDir = path.dirname(entries[0]);
                    const result = await this.installSkillFromPath(skillDir);
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return result;
                }
            }

            // Gist URL
            const gistMatch = url.match(/gist\.github\.com\/([^/]+)\/([a-f0-9]+)/i);
            if (gistMatch) {
                const [, , gistId] = gistMatch;
                const tempDir = path.join(skillsDir, '_temp_' + Date.now());
                execSync(`git clone --depth 1 "https://gist.github.com/${gistId}.git" "${tempDir}"`, { timeout: 60000, stdio: 'pipe' });
                const result = await this.installSkillFromPath(tempDir);
                fs.rmSync(tempDir, { recursive: true, force: true });
                return result;
            }

            // Direct URL to a .skill or .zip file
            if (url.endsWith('.skill') || url.endsWith('.zip')) {
                const tempFile = path.join(skillsDir, '_download_' + Date.now() + path.extname(url));
                const response = await fetch(url);
                if (!response.ok) return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
                const buffer = Buffer.from(await response.arrayBuffer());
                fs.writeFileSync(tempFile, buffer);
                const result = await this.installSkillFromPath(tempFile);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                return result;
            }

            // Direct URL to a raw SKILL.md — wrap it in a directory
            const response = await fetch(url);
            if (!response.ok) return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
            const content = await response.text();
            const parsed = this.parseSkillMd(content);
            if (!parsed) return { success: false, message: 'URL content is not a valid SKILL.md file' };

            const targetDir = path.join(skillsDir, parsed.meta.name);
            if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content);

            this.discoverAgentSkills();
            return { success: true, message: `Installed skill "${parsed.meta.name}" from URL`, skillName: parsed.meta.name };

        } catch (e: any) {
            return { success: false, message: `Failed to install from URL: ${e.message}` };
        }
    }

    /**
     * Uninstall an agent skill by removing its directory.
     */
    public uninstallAgentSkill(name: string): string {
        const skill = this.agentSkills.get(name);
        if (!skill) return `Agent skill "${name}" not found.`;

        try {
            fs.rmSync(skill.skillDir, { recursive: true, force: true });
            this.agentSkills.delete(name);
            return `Successfully uninstalled agent skill "${name}".`;
        } catch (e: any) {
            return `Failed to uninstall "${name}": ${e.message}`;
        }
    }

    /**
     * Initialize a new skill directory with scaffold (like init_skill.py from the spec).
     */
    public initSkill(skillName: string, description?: string): { success: boolean; path: string; message: string } {
        if (!this.pluginsDir) return { success: false, path: '', message: 'No plugins directory configured' };

        // Validate name
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(skillName) || skillName.length > 64 || /--/.test(skillName)) {
            return { success: false, path: '', message: 'Invalid skill name. Use lowercase letters, numbers, hyphens. No consecutive hyphens. Max 64 chars.' };
        }

        const skillsDir = path.join(this.pluginsDir, 'skills');
        const skillDir = path.join(skillsDir, skillName);

        if (fs.existsSync(skillDir)) {
            return { success: false, path: skillDir, message: `Skill directory already exists: ${skillDir}` };
        }

        const titleName = skillName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const desc = description || `[TODO: Describe what ${titleName} does and when to use it]`;

        // Create directory structure
        fs.mkdirSync(skillDir, { recursive: true });
        fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
        fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
        fs.mkdirSync(path.join(skillDir, 'assets'), { recursive: true });

        // Write SKILL.md
        const skillMd = `---
name: ${skillName}
description: "${desc}"
metadata:
  author: orcbot
  version: "1.0"
orcbot:
  permissions:
    - network
---

# ${titleName}

## Overview

${desc}

## When to Use This Skill

[Describe the specific triggers, keywords, or task types that should activate this skill]

## Instructions

[Step-by-step instructions for the agent to follow when this skill is activated]

## Examples

### Example 1
- Input: [describe example input]
- Output: [describe expected output]

## Resources

- Scripts in \`scripts/\` for executable operations
- References in \`references/\` for documentation loaded on demand
- Assets in \`assets/\` for templates, images, and static files
`;

        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);

        // Write example script
        const exampleScript = `#!/usr/bin/env node
/**
 * Example helper script for ${skillName}
 * Replace with actual implementation or delete if not needed.
 */

async function main() {
    console.log('${titleName} script executed');
    // TODO: Add implementation
}

main().catch(console.error);
`;
        fs.writeFileSync(path.join(skillDir, 'scripts', 'example.js'), exampleScript);

        // Write example reference
        fs.writeFileSync(path.join(skillDir, 'references', 'REFERENCE.md'), `# ${titleName} Reference\n\n[Add detailed reference documentation here]\n`);

        // Write example asset placeholder
        fs.writeFileSync(path.join(skillDir, 'assets', '.gitkeep'), '');

        this.discoverAgentSkills();
        return { success: true, path: skillDir, message: `Skill "${skillName}" initialized at ${skillDir}` };
    }

    // ─── Utility helpers ─────────────────────────────────────────────────

    private listDir(dirPath: string): string[] {
        if (!fs.existsSync(dirPath)) return [];
        try {
            return fs.readdirSync(dirPath).filter(f => !f.startsWith('.'));
        } catch { return []; }
    }

    private findSkillMdRecursive(dir: string, maxDepth: number = 3, depth: number = 0): string[] {
        if (depth > maxDepth) return [];
        const results: string[] = [];
        const skillMd = path.join(dir, 'SKILL.md');
        if (fs.existsSync(skillMd)) results.push(skillMd);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    results.push(...this.findSkillMdRecursive(path.join(dir, entry.name), maxDepth, depth + 1));
                }
            }
        } catch { /* permission error etc */ }

        return results;
    }

    private copyDirRecursive(src: string, dest: string) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.name.startsWith('.') && entry.name !== '.gitkeep') continue;
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
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

    // Compatibility alias for older plugins that call context.agent.skills.execute(...)
    public async execute(name: string, args: any): Promise<any> {
        return this.executeSkill(name, args);
    }

    public getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }
    
    /**
     * Get any load errors from the last loadPlugins() call
     */
    public getLoadError(skillName: string): string | undefined {
        return this.lastLoadErrors.get(skillName);
    }
    
    /**
     * Clear load error for a specific skill
     */
    public clearLoadError(skillName: string): void {
        this.lastLoadErrors.delete(skillName);
    }
    
    /**
     * Get all load errors
     */
    public getAllLoadErrors(): Map<string, string> {
        return new Map(this.lastLoadErrors);
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

    /**
     * Get a compact skills list with just names and brief descriptions (for token saving)
     */
    public getCompactSkillsPrompt(): string {
        const skillsList = this.getAllSkills().map(s => `${s.name}(${s.usage.replace(/^[^(]*\(/, '').replace(/\)$/, '')})`).join(', ');
        return `Tools: ${skillsList}`;
    }

    /**
     * Get skills filtered by relevance to a task (for token saving)
     */
    public getRelevantSkillsPrompt(taskKeywords: string[]): string {
        const allSkills = this.getAllSkills();
        const keywords = taskKeywords.map(k => k.toLowerCase());
        
        // Always include core skills
        const coreSkills = ['send_telegram', 'send_whatsapp', 'send_discord', 'send_gateway_chat', 'web_search', 'run_command', 'request_supporting_data'];
        
        const relevant = allSkills.filter(s => {
            // Include if it's a core skill
            if (coreSkills.includes(s.name)) return true;
            // Include if name or description matches any keyword
            const text = `${s.name} ${s.description}`.toLowerCase();
            return keywords.some(k => text.includes(k));
        });
        
        const skillsList = relevant.map(s => `- ${s.name}: ${s.description} (Usage: ${s.usage})`).join('\n');
        return `Available Skills:\n${skillsList}`;
    }
}
