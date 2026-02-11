import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface ToolManifest {
    name: string;
    description?: string;
    source?: string;
    installPath: string;
    readmePath?: string;
    allowedCommands: string[]; // first token allowlist, "*" allows any
    approved: boolean;
    active: boolean;
    installedAt: string;
}

export class ToolsManager {
    constructor(private toolsDir: string) {
        this.ensureToolsDir();
    }

    private ensureToolsDir() {
        if (!fs.existsSync(this.toolsDir)) {
            fs.mkdirSync(this.toolsDir, { recursive: true });
        }
    }

    private getToolDir(name: string): string {
        return path.join(this.toolsDir, name);
    }

    private getManifestPath(name: string): string {
        return path.join(this.getToolDir(name), 'orcbot.tool.json');
    }

    private isValidName(name: string): boolean {
        return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && !/--/.test(name) && name.length <= 64;
    }

    private findReadme(dir: string): string | undefined {
        if (!fs.existsSync(dir)) return undefined;
        const entries = fs.readdirSync(dir);
        const readme = entries.find(e => /^readme(\.|$)/i.test(e));
        return readme ? path.join(dir, readme) : undefined;
    }

    private readmeExcerpt(readmePath?: string, maxChars: number = 1500): string {
        if (!readmePath || !fs.existsSync(readmePath)) return '';
        const content = fs.readFileSync(readmePath, 'utf8');
        if (content.length <= maxChars) return content;
        return content.slice(0, maxChars) + '\n\n[...truncated]';
    }

    private loadManifest(name: string): ToolManifest | null {
        const manifestPath = this.getManifestPath(name);
        if (!fs.existsSync(manifestPath)) return null;
        try {
            const raw = fs.readFileSync(manifestPath, 'utf8');
            return JSON.parse(raw) as ToolManifest;
        } catch (e) {
            logger.warn(`ToolsManager: Failed to read manifest for ${name}: ${e}`);
            return null;
        }
    }

    private writeManifest(manifest: ToolManifest): void {
        const manifestPath = this.getManifestPath(manifest.name);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    public listTools(): ToolManifest[] {
        this.ensureToolsDir();
        const entries = fs.readdirSync(this.toolsDir, { withFileTypes: true });
        const tools: ToolManifest[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifest = this.loadManifest(entry.name);
            if (manifest) tools.push(manifest);
        }
        return tools;
    }

    public getTool(name: string): ToolManifest | null {
        return this.loadManifest(name);
    }

    public getToolsPrompt(): string {
        const tools = this.listTools();
        if (tools.length === 0) return '';
        const lines = ['<available_tools>'];
        for (const t of tools) {
            const status = t.active ? 'active' : 'inactive';
            const approval = t.approved ? 'approved' : 'unapproved';
            lines.push(`  <tool>`);
            lines.push(`    <name>${t.name}</name>`);
            if (t.description) lines.push(`    <description>${t.description}</description>`);
            lines.push(`    <status>${status}</status>`);
            lines.push(`    <approval>${approval}</approval>`);
            if (t.allowedCommands?.length) lines.push(`    <allowedCommands>${t.allowedCommands.join(', ')}</allowedCommands>`);
            lines.push(`  </tool>`);
        }
        lines.push('</available_tools>');
        return lines.join('\n');
    }

    public getActivatedToolsContext(): string {
        const tools = this.listTools().filter(t => t.active);
        if (tools.length === 0) return '';
        const parts: string[] = ['<activated_tools>'];
        for (const t of tools) {
            const excerpt = this.readmeExcerpt(t.readmePath);
            parts.push(`<tool name="${t.name}">`);
            if (t.description) parts.push(`Description: ${t.description}`);
            if (excerpt) parts.push(`README:\n${excerpt}`);
            parts.push(`</tool>`);
        }
        parts.push('</activated_tools>');
        return parts.join('\n');
    }

    public activateTool(name: string, active: boolean): { success: boolean; message: string } {
        const manifest = this.loadManifest(name);
        if (!manifest) return { success: false, message: `Tool "${name}" not found.` };
        manifest.active = active;
        this.writeManifest(manifest);
        return { success: true, message: `${active ? 'Activated' : 'Deactivated'} tool "${name}".` };
    }

    public approveTool(name: string, allowedCommands?: string[]): { success: boolean; message: string } {
        const manifest = this.loadManifest(name);
        if (!manifest) return { success: false, message: `Tool "${name}" not found.` };
        manifest.approved = true;
        if (allowedCommands && allowedCommands.length > 0) {
            manifest.allowedCommands = allowedCommands;
        }
        this.writeManifest(manifest);
        return { success: true, message: `Approved tool "${name}".` };
    }

    public readToolReadme(name: string): { success: boolean; message: string } {
        const manifest = this.loadManifest(name);
        if (!manifest) return { success: false, message: `Tool "${name}" not found.` };
        const excerpt = this.readmeExcerpt(manifest.readmePath, 8000);
        if (!excerpt) return { success: false, message: `README not found for "${name}".` };
        return { success: true, message: excerpt };
    }

    private copyDirRecursive(src: string, dest: string) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.gitkeep') continue;
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    private resolveInstallName(source: string): string {
        const base = source.replace(/\/+$/, '').split('/').pop() || 'tool';
        return base.replace(/\.git$/i, '').toLowerCase();
    }

    public async installTool(options: {
        source: string;
        name?: string;
        subdir?: string;
        allowedCommands?: string[];
        description?: string;
    }): Promise<{ success: boolean; message: string; name?: string }> {
        const { source, name, subdir, allowedCommands, description } = options;
        if (!source) return { success: false, message: 'Missing source.' };

        const toolName = (name || this.resolveInstallName(source)).toLowerCase();
        if (!this.isValidName(toolName)) {
            return { success: false, message: 'Invalid tool name. Use lowercase letters, numbers, hyphens. Max 64 chars.' };
        }

        const toolDir = this.getToolDir(toolName);
        if (fs.existsSync(toolDir)) {
            return { success: false, message: `Tool "${toolName}" already exists.` };
        }
        fs.mkdirSync(toolDir, { recursive: true });

        try {
            const isUrl = /^https?:\/\//i.test(source);
            if (isUrl) {
                const { execSync } = require('child_process');
                const tempDir = path.join(this.toolsDir, `_temp_${Date.now()}`);

                // Prefer git clone for repos/urls
                execSync(`git clone --depth 1 "${source}" "${tempDir}"`, { timeout: 120000, stdio: 'pipe' });

                const sourcePath = subdir ? path.join(tempDir, subdir) : tempDir;
                if (!fs.existsSync(sourcePath)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return { success: false, message: `Subdir not found: ${subdir}` };
                }

                this.copyDirRecursive(sourcePath, toolDir);
                fs.rmSync(tempDir, { recursive: true, force: true });
            } else {
                // local path
                if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
                    return { success: false, message: `Source path not found or not a directory: ${source}` };
                }
                const sourcePath = subdir ? path.join(source, subdir) : source;
                if (!fs.existsSync(sourcePath)) {
                    return { success: false, message: `Subdir not found: ${subdir}` };
                }
                this.copyDirRecursive(sourcePath, toolDir);
            }

            const readmePath = this.findReadme(toolDir);
            const manifest: ToolManifest = {
                name: toolName,
                description,
                source,
                installPath: toolDir,
                readmePath,
                allowedCommands: allowedCommands || [],
                approved: false,
                active: false,
                installedAt: new Date().toISOString()
            };
            this.writeManifest(manifest);

            return { success: true, message: `Installed tool "${toolName}".`, name: toolName };
        } catch (e: any) {
            try { fs.rmSync(toolDir, { recursive: true, force: true }); } catch {}
            return { success: false, message: `Failed to install tool: ${e.message || e}` };
        }
    }

    public uninstallTool(name: string): { success: boolean; message: string } {
        const toolDir = this.getToolDir(name);
        if (!fs.existsSync(toolDir)) return { success: false, message: `Tool "${name}" not found.` };
        try {
            fs.rmSync(toolDir, { recursive: true, force: true });
            return { success: true, message: `Uninstalled tool "${name}".` };
        } catch (e: any) {
            return { success: false, message: `Failed to uninstall "${name}": ${e.message || e}` };
        }
    }

    public async runToolCommand(
        name: string,
        command: string,
        args?: string,
        cwd?: string
    ): Promise<{ success: boolean; message: string }> {
        const manifest = this.loadManifest(name);
        if (!manifest) return { success: false, message: `Tool "${name}" not found.` };
        if (!manifest.approved) return { success: false, message: `Tool "${name}" is not approved. Use approve_tool("${name}") first.` };

        const allowed = manifest.allowedCommands || [];
        const trimmed = command.trim();
        const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() || '';
        const allowAll = allowed.map(a => a.toLowerCase()).includes('*');
        if (!allowAll && (allowed.length === 0 || !allowed.map(a => a.toLowerCase()).includes(firstToken))) {
            return { success: false, message: `Command "${firstToken}" is not allowed for tool "${name}". Update allowedCommands or re-install with allowedCommands.` };
        }

        const toolDir = manifest.installPath;
        const resolvedCwd = cwd ? path.resolve(toolDir, cwd) : toolDir;
        if (!resolvedCwd.startsWith(toolDir)) {
            return { success: false, message: 'Invalid cwd: path traversal outside tool directory is not allowed.' };
        }

        const fullCommand = args ? `${command} ${args}` : command;

        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const execOptions: any = { timeout: 120000, cwd: resolvedCwd };
            if (process.platform === 'win32') {
                execOptions.shell = 'powershell.exe';
            }
            exec(fullCommand, execOptions, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    resolve({ success: false, message: `Error: ${error.message}\n${stderr}`.trim() });
                    return;
                }
                resolve({ success: true, message: (stdout || stderr || 'Command executed successfully (no output)').trim() });
            });
        });
    }
}
