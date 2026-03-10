import os from 'os';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { MemoryManager } from '../memory/MemoryManager';

/**
 * Profiles the system the agent is running on and caches knowledge
 * about its environment, capabilities, and configured features.
 * 
 * This prevents the agent from asking "dumb questions" about things
 * it should already know since it's living in that system.
 */
export interface SystemProfile {
    // System info
    os: string;          // 'linux' | 'darwin' | 'win32'
    platform: string;    // Friendly name like 'Windows', 'macOS', 'Linux'
    nodeVersion: string;
    arch: string;        // 'x64' | 'arm64' | 'ia32'
    
    // Capabilities
    availableMemoryMb: number;
    totalMemoryMb: number;
    freeDiskMb?: number;
    
    // Configured features
    enabledChannels: string[];      // telegram, whatsapp, discord, slack, email
    configuredLLMProviders: string[]; // openai, gemini, anthropic, nvidia, etc.
    defaultLLMProvider: string;
    defaultModel: string;
    
    // Available skills
    coreSkillCount: number;
    pluginSkillCount: number;
    pluginNames: string[];
    
    // Tools
    availableTools: string[];      // browser, computer_use, web_search, etc.
    
    // Paths
    dataHome: string;
    pluginsDir: string;
    hasPluginsDir: boolean;
    
    // Capabilities
    canBrowseWeb: boolean;
    canComputerUse: boolean;
    canScheduleTasks: boolean;
    canUseVectorMemory: boolean;
    canMultithread: boolean;
    
    // Config
    autonomyEnabled: boolean;
    sudoMode: boolean;
    
    // Timestamp
    profiledAt: string;
}

export class SystemProfiler {
    private profile: SystemProfile | null = null;
    private profileCachePath: string;

    constructor(dataHome: string) {
        this.profileCachePath = path.join(dataHome, '.system_profile.json');
    }

    /**
     * Load or create a system profile. Should be called on agent startup.
     */
    public async loadOrCreate(options: {
        memory?: MemoryManager;
        channels?: { telegram?: any; whatsapp?: any; discord?: any; slack?: any; email?: any };
        skills?: any;
        config?: any;
    }): Promise<SystemProfile> {
        // Try to load cached profile (reuse if recent)
        if (fs.existsSync(this.profileCachePath)) {
            try {
                const cached = JSON.parse(fs.readFileSync(this.profileCachePath, 'utf-8')) as SystemProfile;
                const cacheDays = (Date.now() - new Date(cached.profiledAt).getTime()) / (1000 * 60 * 60 * 24);
                
                // Invalidate cache if older than 1 day or if config might have changed
                if (cacheDays < 1 && cached.os === os.platform()) {
                    this.profile = cached;
                    logger.debug(`SystemProfiler: Using cached profile from ${cached.profiledAt}`);
                    return cached;
                }
            } catch (e) {
                logger.warn(`SystemProfiler: Failed to load cached profile: ${e}`);
            }
        }

        // Build new profile
        this.profile = this.buildProfile(options);
        
        // Persist for next startup
        try {
            fs.writeFileSync(this.profileCachePath, JSON.stringify(this.profile, null, 2));
        } catch (e) {
            logger.warn(`SystemProfiler: Failed to cache profile: ${e}`);
        }

        // Save to memory if available
        if (options.memory) {
            await this.saveProfileToMemory(options.memory, this.profile);
        }

        return this.profile;
    }

    private buildProfile(options: {
        memory?: MemoryManager;
        channels?: { telegram?: any; whatsapp?: any; discord?: any; slack?: any; email?: any };
        skills?: any;
        config?: any;
    }): SystemProfile {
        const config = options.config;
        const channels = options.channels || {};
        const skills = options.skills;
        
        // Detect enabled channels
        const enabledChannels: string[] = [];
        if (channels.telegram) enabledChannels.push('telegram');
        if (channels.whatsapp) enabledChannels.push('whatsapp');
        if (channels.discord) enabledChannels.push('discord');
        if (channels.slack) enabledChannels.push('slack');
        if (channels.email) enabledChannels.push('email');

        // Detect configured LLM providers
        const configuredProviders = new Set<string>();
        if (config) {
            const provider = config.get?.('llmProvider');
            if (provider) configuredProviders.add(provider);
            
            // Check for provider-specific API keys
            if (config.get?.('openaiApiKey')) configuredProviders.add('openai');
            if (config.get?.('googleApiKey')) configuredProviders.add('gemini');
            if (config.get?.('anthropicApiKey')) configuredProviders.add('anthropic');
            if (config.get?.('nvidiaApiKey')) configuredProviders.add('nvidia');
            if (config.get?.('openrouterApiKey')) configuredProviders.add('openrouter');
            if (config.get?.('bedrockRegion')) configuredProviders.add('bedrock');
            if (config.get?.('ollamaUrl')) configuredProviders.add('ollama');
        }

        // Detect available skills
        let coreSkillCount = 0;
        let pluginSkillCount = 0;
        let pluginNames: string[] = [];
        
        if (skills) {
            const allSkills = skills.getAllSkills?.() || [];
            coreSkillCount = allSkills.filter((s: any) => !s.isPlugin).length;
            pluginSkillCount = allSkills.filter((s: any) => s.isPlugin).length;
            pluginNames = allSkills
                .filter((s: any) => s.isPlugin)
                .map((s: any) => s.name)
                .slice(0, 20); // Cap at 20 for memory efficiency
        }

        // Detect tools
        const availableTools: string[] = [];
        if (config?.get?.('browserPath')) availableTools.push('browser');
        if (config?.get?.('computerUsePath')) availableTools.push('computer_use');
        availableTools.push('web_search');
        availableTools.push('read_file');
        availableTools.push('write_file');
        availableTools.push('run_command');

        // Memory stats
        const freeMem = os.freemem();
        const totalMem = os.totalmem();

        // Disk stats (try to get, but don't fail on error)
        let freeDiskMb: number | undefined;
        try {
            // Rough estimate: check available space on home directory
            // In production, would use something like `disk-usage` library
            freeDiskMb = Math.floor(freeMem / (1024 * 1024) * 2); // Rough estimate
        } catch {
            // Ignore
        }

        // Data home
        const dataHome = config?.getDataHome?.() || path.join(os.homedir(), '.orcbot');
        const pluginsDir = path.join(dataHome, 'plugins');
        const hasPluginsDir = fs.existsSync(pluginsDir);

        const profile: SystemProfile = {
            os: os.platform(),
            platform: this.getPlatformName(os.platform()),
            nodeVersion: process.version,
            arch: os.arch(),
            availableMemoryMb: Math.floor(freeMem / (1024 * 1024)),
            totalMemoryMb: Math.floor(totalMem / (1024 * 1024)),
            freeDiskMb,
            enabledChannels,
            configuredLLMProviders: Array.from(configuredProviders).sort(),
            defaultLLMProvider: config?.get?.('llmProvider') || 'openai',
            defaultModel: config?.get?.('modelName') || 'gpt-4o-mini',
            coreSkillCount,
            pluginSkillCount,
            pluginNames,
            availableTools,
            dataHome,
            pluginsDir,
            hasPluginsDir,
            canBrowseWeb: availableTools.includes('browser'),
            canComputerUse: availableTools.includes('computer_use'),
            canScheduleTasks: true, // Always available
            canUseVectorMemory: !!config?.get?.('openaiApiKey') || !!config?.get?.('googleApiKey'),
            canMultithread: true, // Node supports threading
            autonomyEnabled: config?.get?.('autonomyEnabled') !== false,
            sudoMode: config?.get?.('sudoMode') === true,
            profiledAt: new Date().toISOString(),
        };

        logger.info(`SystemProfiler: Profiled system — ${profile.platform} (${profile.nodeVersion}), ${enabledChannels.length} channels, ${configuredProviders.size} LLM providers, ${pluginSkillCount} plugins`);
        return profile;
    }

    private getPlatformName(osType: string): string {
        switch (osType) {
            case 'win32': return 'Windows';
            case 'darwin': return 'macOS';
            case 'linux': return 'Linux';
            default: return osType;
        }
    }

    /**
     * Save system profile to memory as episodic entry so DecisionEngine can reference it.
     */
    private async saveProfileToMemory(memory: MemoryManager, profile: SystemProfile): Promise<void> {
        try {
            const profileContent = `SYSTEM PROFILE (${profile.profiledAt}):
- Platform: ${profile.platform} (${profile.arch}), Node ${profile.nodeVersion}
- Memory: ${profile.availableMemoryMb}MB available / ${profile.totalMemoryMb}MB total
- Enabled Channels: ${profile.enabledChannels.join(', ') || 'none'}
- LLM Providers: ${profile.configuredLLMProviders.join(', ')} (default: ${profile.defaultLLMProvider}/${profile.defaultModel})
- Skills: ${profile.coreSkillCount} core + ${profile.pluginSkillCount} plugins
- Tools: ${profile.availableTools.join(', ')}
- Features: ${[profile.canBrowseWeb && 'browser', profile.canComputerUse && 'computer-use', profile.canScheduleTasks && 'scheduling', profile.canUseVectorMemory && 'vector-memory'].filter(Boolean).join(', ')}
- Data Home: ${profile.dataHome}
- Plugins: ${profile.hasPluginsDir ? 'available' : 'not found'} (${profile.pluginNames.length} loaded)`;

            memory.saveMemory({
                id: 'system-profile',
                type: 'episodic',
                content: profileContent,
                metadata: {
                    source: 'system-profiler',
                    profile: profile,
                    timestamp: new Date().toISOString(),
                }
            });
        } catch (e) {
            logger.warn(`SystemProfiler: Failed to save profile to memory: ${e}`);
        }
    }

    /**
     * Get the current profile without rebuilding.
     */
    public getProfile(): SystemProfile | null {
        return this.profile;
    }

    /**
     * Get a human-readable summary of the system for inclusion in prompts.
     */
    public getSummary(): string {
        if (!this.profile) return '';

        return `YOU ARE RUNNING ON:
- **System**: ${this.profile.platform} (${this.profile.arch}), Node ${this.profile.nodeVersion}
- **Resources**: ${this.profile.availableMemoryMb}MB RAM available, ${this.profile.freeDiskMb ? this.profile.freeDiskMb + 'MB disk' : 'unknown disk space'}
- **Channels**: ${this.profile.enabledChannels.length > 0 ? this.profile.enabledChannels.join(', ') : 'none configured'}
- **LLM**: ${this.profile.defaultLLMProvider}/${this.profile.defaultModel} (also configured: ${this.profile.configuredLLMProviders.filter(p => p !== this.profile!.defaultLLMProvider).join(', ') || 'none'})
- **Skills**: ${this.profile.coreSkillCount} built-in + ${this.profile.pluginSkillCount} custom plugins
- **Capabilities**: ${[
    this.profile.canBrowseWeb && 'web-browsing',
    this.profile.canComputerUse && 'computer-automation',
    this.profile.canScheduleTasks && 'task-scheduling',
    this.profile.canUseVectorMemory && 'semantic-search',
].filter(Boolean).join(', ')}

YOU ALREADY KNOW THIS SYSTEM. Do not ask what OS you're running on, what channels are available, or what your capabilities are.
Instead, USE what you know. If you need a capability not listed above, you can try to use it anyway, but it will likely fail.`;
    }
}
