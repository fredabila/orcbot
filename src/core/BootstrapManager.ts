import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';

/**
 * Bootstrap file system inspired by OpenClaw.
 * Manages workspace files that inject agent context, identity, and operating instructions.
 * These files are injected into the agent context at session start.
 */

export interface BootstrapFiles {
    AGENTS: string;      // Operating instructions + core memory
    SOUL: string;        // Persona, boundaries, tone
    IDENTITY: string;    // Agent name, vibe, emoji
    TOOLS: string;       // Tool notes and conventions
    USER: string;        // User profile and preferences
}

export class BootstrapManager {
    private workspaceDir: string;
    private files: Map<string, string> = new Map();

    // ── Mtime-based cache: eliminates redundant disk reads ──
    // Each entry stores the file content and its last-known mtime.
    // On loadBootstrapContext(), we stat each file and only re-read if mtime changed.
    private _cache: Map<string, { content: string; mtimeMs: number }> = new Map();

    constructor(workspaceDir?: string) {
        this.workspaceDir = workspaceDir || path.join(os.homedir(), '.orcbot');
        
        // Ensure workspace exists
        if (!fs.existsSync(this.workspaceDir)) {
            fs.mkdirSync(this.workspaceDir, { recursive: true });
            logger.info(`Created workspace directory: ${this.workspaceDir}`);
        }
    }

    /**
     * Initialize bootstrap files with default templates
     * Only creates files that don't exist
     */
    public initializeFiles(): void {
        const templates = this.getDefaultTemplates();
        
        for (const [fileName, defaultContent] of Object.entries(templates)) {
            const filePath = path.join(this.workspaceDir, fileName);
            
            if (!fs.existsSync(filePath)) {
                try {
                    fs.writeFileSync(filePath, defaultContent);
                    logger.info(`Created bootstrap file: ${fileName}`);
                } catch (error) {
                    logger.error(`Failed to create ${fileName}: ${error}`);
                }
            }
        }
    }

    /**
     * Load all bootstrap files into memory.
     * Uses mtime-based caching — files are only re-read from disk when their
     * modification time changes. This eliminates 5 redundant disk reads per
     * DecisionEngine step (called every action step via buildHelperPrompt).
     */
    public loadBootstrapContext(): Partial<BootstrapFiles> {
        const context: Partial<BootstrapFiles> = {};
        const fileNames = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'USER.md'];

        for (const fileName of fileNames) {
            const filePath = path.join(this.workspaceDir, fileName);
            
            try {
                if (!fs.existsSync(filePath)) continue;

                const stat = fs.statSync(filePath);
                const cached = this._cache.get(fileName);

                let content: string;
                if (cached && cached.mtimeMs === stat.mtimeMs) {
                    // Cache hit — skip disk read
                    content = cached.content;
                } else {
                    // Cache miss or stale — read from disk and update cache
                    content = fs.readFileSync(filePath, 'utf-8');
                    this._cache.set(fileName, { content, mtimeMs: stat.mtimeMs });
                }

                if (content.trim()) {
                    const key = fileName.replace('.md', '') as keyof BootstrapFiles;
                    context[key] = content;
                    this.files.set(fileName, content);
                }
            } catch (error) {
                logger.error(`Failed to load ${fileName}: ${error}`);
            }
        }

        return context;
    }

    /**
     * Get formatted bootstrap context for injection into agent prompts.
     * Delegates to loadBootstrapContext() which uses mtime caching.
     */
    public getFormattedContext(maxLength: number = 10000): string {
        const context = this.loadBootstrapContext();
        const parts: string[] = [];

        // Order matters - most important files first
        const order: Array<keyof BootstrapFiles> = ['IDENTITY', 'SOUL', 'AGENTS', 'USER', 'TOOLS'];

        for (const key of order) {
            if (context[key]) {
                const content = context[key]!;
                const header = `\n## ${key}.md\n\n`;
                
                // Truncate if necessary but keep structure
                if (content.length > maxLength / 5) {
                    const truncated = content.substring(0, maxLength / 5);
                    parts.push(header + truncated + `\n\n... (file truncated, ${content.length - truncated.length} more characters)`);
                } else {
                    parts.push(header + content);
                }
            }
        }

        if (parts.length === 0) {
            return '# Bootstrap Context\n\nNo bootstrap files loaded. Run setup to initialize.';
        }

        return `# Bootstrap Context\n\nThese files define your identity, operating parameters, and user context.\n${parts.join('\n\n---\n')}`;
    }

    /**
     * Update a specific bootstrap file
     */
    public updateFile(fileName: string, content: string): boolean {
        const filePath = path.join(this.workspaceDir, fileName);
        
        try {
            fs.writeFileSync(filePath, content);
            this.files.set(fileName, content);
            // Invalidate mtime cache so next loadBootstrapContext() picks up the change
            this._cache.delete(fileName);
            logger.info(`Updated bootstrap file: ${fileName}`);
            return true;
        } catch (error) {
            logger.error(`Failed to update ${fileName}: ${error}`);
            return false;
        }
    }

    /**
     * Reset all bootstrap files to their default templates.
     * Overwrites any user customizations.
     */
    public resetToDefaults(): void {
        const templates = this.getDefaultTemplates();
        for (const [fileName, content] of Object.entries(templates)) {
            const filePath = path.join(this.workspaceDir, fileName);
            try {
                fs.writeFileSync(filePath, content);
                this.files.set(fileName, content);
                this._cache.delete(fileName); // Invalidate mtime cache
                logger.info(`BootstrapManager: Reset ${fileName} to defaults`);
            } catch (error) {
                logger.error(`BootstrapManager: Failed to reset ${fileName}: ${error}`);
            }
        }
    }

    /**
     * Get a specific file content
     */
    public getFile(fileName: string): string | null {
        const filePath = path.join(this.workspaceDir, fileName);
        
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
        } catch (error) {
            logger.error(`Failed to read ${fileName}: ${error}`);
        }
        
        return null;
    }

    /**
     * List all bootstrap files and their status
     */
    public listFiles(): Array<{ name: string; exists: boolean; size: number }> {
        const fileNames = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'USER.md'];
        
        return fileNames.map(name => {
            const filePath = path.join(this.workspaceDir, name);
            const exists = fs.existsSync(filePath);
            const size = exists ? fs.statSync(filePath).size : 0;
            
            return { name, exists, size };
        });
    }

    /**
     * Default templates for bootstrap files
     */
    private getDefaultTemplates(): Record<string, string> {
        return {
            'IDENTITY.md': `# Agent Identity

**Name:** OrcBot
**Version:** 2.0
**Type:** Strategic AI Agent
**Emoji:** 🤖

## Core Purpose

I am an autonomous reasoning agent designed to assist with complex tasks through strategic simulation and execution.

## Capabilities

- Strategic planning and simulation
- Web browsing and research
- Command execution
- Multi-modal processing
- Self-healing and adaptation
`,

            'SOUL.md': `# Agent Persona & Boundaries

## Personality

- **Direct & Efficient:** I communicate clearly and get to the point
- **Strategic:** I think ahead and plan before acting
- **Adaptive:** I learn from interactions and adjust my approach
- **Helpful:** My primary goal is to assist effectively

## Tone

- Professional yet friendly
- Clear and concise
- Proactive in offering solutions
- Honest about limitations

## Boundaries

- I follow ethical guidelines and legal constraints
- I don't perform harmful actions
- I respect privacy and data security
- I ask for clarification when uncertain
- I explain my reasoning when appropriate

## Values

- Accuracy over speed
- Safety over convenience
- Learning from mistakes
- Transparent communication
`,

            'AGENTS.md': `# Operating Instructions

## Core Behavior

1. **Think Before Acting:** Use simulation to plan complex tasks
2. **Be Strategic:** Anticipate problems and prepare fallbacks
3. **Stay Autonomous:** Work independently but communicate progress
4. **Learn Continuously:** Adapt based on results and feedback

## Task Execution

- Break down complex tasks into manageable steps
- Verify assumptions before proceeding
- Use appropriate tools for each subtask
- Report progress and blockers clearly

## Memory Management

- Store important facts in long-term memory (MEMORY.md)
- Keep daily notes in memory/YYYY-MM-DD.md format
- Remember user preferences and context
- Use memory tools to recall relevant information

## Communication

- Keep users informed of progress
- Ask for clarification when needed
- Explain reasoning for major decisions
- Provide clear error messages and recovery steps

## Tool Usage

- Select the right tool for each task
- Handle errors gracefully with fallbacks
- Respect rate limits and resource constraints
- Clean up temporary resources after use
`,

            'TOOLS.md': `# Tool Notes & Conventions

## Available Tools

### Core Skills
- **web_search:** Research and information gathering
- **web_browse:** Navigate and interact with websites  
- **run_command:** Run system commands
- **file operations:** Read, write, manage files

### Memory Tools
- **memory_search:** Find information in memory logs
- **memory_get:** Retrieve specific memory files
- **memory_write:** Store information for later recall
- **memory_stats:** View memory system status

### Communication
- **telegram:** Send/receive Telegram messages
- **whatsapp:** Send/receive WhatsApp messages
- **discord:** Interact with Discord servers

## Best Practices

- Use memory tools to maintain context across sessions
- Prefer web_search for quick lookups, web_browse for interactive tasks
- Always verify command results before proceeding
- Store learned information using memory_write

## Conventions

- Daily notes go to memory/YYYY-MM-DD.md
- Important facts go to MEMORY.md
- Use categories/sections to organize memory
- Search memory before asking for repeated information
`,

            'USER.md': `# User Profile

## Preferences

_This file should be customized with user-specific information_

## Communication Style

- Preferred level of detail:
- Notification preferences:
- Language preferences:

## Task Preferences

- Autonomy level:
- Confirmation requirements:
- Priority areas:

## Context

_Add any relevant background information about the user's work, projects, or preferences_
`
        };
    }

    /**
     * Get workspace directory
     */
    public getWorkspaceDir(): string {
        return this.workspaceDir;
    }
}
