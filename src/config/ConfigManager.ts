import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';
import { AgentConfig, AgentConfigSchema } from '../types/AgentConfig';

export { AgentConfig };

import { isDeepEqual } from '../utils/ObjectUtils';

export class ConfigManager {
    private configPath: string;
    private config: AgentConfig;
    private dataHome: string;

    constructor(customPath?: string) {
        // Check for environment variable override first (used by worker processes)
        const envConfigPath = process.env.ORCBOT_CONFIG_PATH;
        const envDataDir = process.env.ORCBOT_DATA_DIR;

        this.dataHome = envDataDir || path.join(os.homedir(), '.orcbot');
        if (!fs.existsSync(this.dataHome)) {
            fs.mkdirSync(this.dataHome, { recursive: true });
        }

        // Standard global path
        const globalConfigPath = path.join(this.dataHome, 'orcbot.config.yaml');
        // Local override path
        const localConfigPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        // Final config location: custom > env > local > global
        this.configPath = customPath || envConfigPath || (fs.existsSync(localConfigPath) ? localConfigPath : globalConfigPath);

        this.config = this.loadConfig(customPath);
        this.startWatcher(customPath);
    }

    /**
     * Returns the resolved OrcBot data directory (defaults to ~/.orcbot).
     * This is the base directory where file-backed state should live.
     */
    public getDataHome(): string {
        return this.dataHome;
    }

    private startWatcher(customPath?: string) {
        if (!fs.existsSync(this.configPath)) return;

        // Use a simple debounce to avoid double-loading on rapid saves
        let debounceTimer: NodeJS.Timeout | null = null;

        fs.watch(this.configPath, (eventType) => {
            if (eventType === 'change') {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    logger.info(`ConfigManager: Config file changed on disk, reloading...`);
                    const oldConfig = { ...this.config };
                    // We load without logging the path again to keep it clean
                    this.config = this.loadConfig(customPath, true);
                    // Emit event for components to react to config changes
                    eventBus.emit('config:changed', { oldConfig, newConfig: this.config });
                    logger.info(`ConfigManager: Config reloaded and config:changed event emitted`);
                }, 100);
            }
        });
    }

    private loadConfig(customPath?: string, silent: boolean = false): AgentConfig {
        let globalConfig: any = {};
        let homeConfig: any = {};
        let localConfig: any = {};

        // 1. Search paths
        const globalPath = path.join(this.dataHome, 'orcbot.config.yaml');
        const homePath = path.join(os.homedir(), 'orcbot.config.yaml');
        const localPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        // Load Global (~/.orcbot/orcbot.config.yaml)
        if (fs.existsSync(globalPath)) {
            try { globalConfig = yaml.parse(fs.readFileSync(globalPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading global config from ${globalPath}: ${e}`); }
        }
        // Load Home (~/orcbot.config.yaml) - Fallback where user said theirs is
        if (fs.existsSync(homePath)) {
            try { homeConfig = yaml.parse(fs.readFileSync(homePath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading home config from ${homePath}: ${e}`); }
        }
        // Load Local (./orcbot.config.yaml)
        if (fs.existsSync(localPath)) {
            try { localConfig = yaml.parse(fs.readFileSync(localPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading local config from ${localPath}: ${e}`); }
        }
        // Load Custom
        let customConfig: any = {};
        if (customPath && fs.existsSync(customPath)) {
            try { customConfig = yaml.parse(fs.readFileSync(customPath, 'utf8')) || {}; } catch (e) { logger.warn(`Error loading custom config from ${customPath}: ${e}`); }
        }

        // Set the primary configPath for saving (prioritize most local existing config)
        this.configPath = customPath || (fs.existsSync(localPath) ? localPath : (fs.existsSync(homePath) ? homePath : globalPath));
        if (!silent) logger.info(`ConfigManager: Config path set to ${this.configPath}`);


        // 2. Merge Env Vars (Highest priority for keys)
        const envConfig: Partial<AgentConfig> = {
            openaiApiKey: process.env.OPENAI_API_KEY,
            openrouterApiKey: process.env.OPENROUTER_API_KEY,
            openrouterBaseUrl: process.env.OPENROUTER_BASE_URL,
            openrouterReferer: process.env.OPENROUTER_REFERER,
            openrouterAppName: process.env.OPENROUTER_APP_NAME,
            googleApiKey: process.env.GOOGLE_API_KEY,
            nvidiaApiKey: process.env.NVIDIA_API_KEY,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
            searxngUrl: process.env.SEARXNG_URL,
            serperApiKey: process.env.SERPER_API_KEY,
            captchaApiKey: process.env.CAPTCHA_API_KEY,
            telegramToken: process.env.TELEGRAM_TOKEN,
            discordToken: process.env.DISCORD_TOKEN,
            slackBotToken: process.env.SLACK_BOT_TOKEN,
            slackAppToken: process.env.SLACK_APP_TOKEN,
            slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
            emailAddress: process.env.EMAIL_ADDRESS,
            smtpHost: process.env.SMTP_HOST,
            smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
            smtpSecure: process.env.SMTP_SECURE ? String(process.env.SMTP_SECURE).toLowerCase() === 'true' : undefined,
            smtpStartTls: process.env.SMTP_STARTTLS ? String(process.env.SMTP_STARTTLS).toLowerCase() === 'true' : undefined,
            smtpUsername: process.env.SMTP_USERNAME,
            smtpPassword: process.env.SMTP_PASSWORD,
            imapHost: process.env.IMAP_HOST,
            imapPort: process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : undefined,
            imapSecure: process.env.IMAP_SECURE ? String(process.env.IMAP_SECURE).toLowerCase() === 'true' : undefined,
            imapUsername: process.env.IMAP_USERNAME,
            imapPassword: process.env.IMAP_PASSWORD,
            emailSocketTimeoutMs: process.env.EMAIL_SOCKET_TIMEOUT_MS ? Number(process.env.EMAIL_SOCKET_TIMEOUT_MS) : undefined,
            bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
            bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
            bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
            bedrockSessionToken: process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
            groqApiKey: process.env.GROQ_API_KEY,
            mistralApiKey: process.env.MISTRAL_API_KEY,
            cerebrasApiKey: process.env.CEREBRAS_API_KEY,
            xaiApiKey: process.env.XAI_API_KEY,
            // @ts-ignore - Dynamic key support
            MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY
        };

        // Filter out undefined env vars
        const activeEnv = Object.fromEntries(
            Object.entries(envConfig).filter(([_, v]) => v !== undefined)
        );

        // Merge hierarchies. Note: AgentConfigSchema provides defaults.
        const mergedRaw: any = {
            ...globalConfig,
            ...homeConfig,
            ...localConfig,
            ...customConfig
        };

        // Apply env vars only as fallback when config value is missing
        Object.entries(activeEnv).forEach(([key, value]) => {
            const current = mergedRaw[key];
            if (current === undefined || current === null) {
                mergedRaw[key] = value;
            } else if (!silent) {
                logger.info(`ConfigManager: Ignoring env override for ${key} because config already defines a value.`);
            }
        });

        // Use Zod to parse, validate and apply defaults
        const parsed = AgentConfigSchema.parse(mergedRaw);

        // Normalized paths - depends on dataHome which is instance-specific
        const normalized = this.normalizePlatformPaths(parsed, silent);
        
        // Final repair step for worker corruption
        const repaired = this.repairWorkerCorruption(normalized, silent);
        
        // Apply server-mode conservative defaults AFTER user overrides are merged in
        if (repaired.serverMode) {
            return this.applyServerModeDefaults(repaired);
        }
        return repaired;
    }

    /**
     * Detect and repair config corruption caused by worker syncConfigAcrossPaths bug.
     * Workers previously wrote their isolated paths (orchestrator/instances/agent-xxx)
     * into the shared global config.  This detects those paths and resets them to defaults.
     */
    private repairWorkerCorruption(config: AgentConfig, silent: boolean): AgentConfig {
        // Only repair if this is NOT a worker process (workers legitimately have instance paths)
        if (process.env.ORCBOT_DATA_DIR?.includes('orchestrator')) return config;

        const pathKeys: Array<keyof AgentConfig> = [
            'memoryPath', 'skillsPath', 'userProfilePath', 'agentIdentityPath',
            'actionQueuePath', 'journalPath', 'learningPath', 'worldPath', 'tokenUsagePath', 'tokenLogPath'
        ];
        
        // Get base defaults for restoration
        const baseDefaults = AgentConfigSchema.parse({});
        let repaired = false;

        for (const key of pathKeys) {
            const value = (config as any)[key];
            if (typeof value === 'string' && value.includes('orchestrator') && value.includes('instances')) {
                if (!silent) logger.warn(`ConfigManager: Repairing worker-corrupted path for ${String(key)}: ${value} → default`);
                (config as any)[key] = (baseDefaults as any)[key];
                repaired = true;
            }
        }

        // Also reset agentName if it looks like a worker name
        if (config.agentName && /^(Researcher|Worker|Agent)_\d+$/i.test(config.agentName)) {
            if (!silent) logger.warn(`ConfigManager: Repairing worker-corrupted agentName: ${config.agentName} → default`);
            config.agentName = baseDefaults.agentName;
            repaired = true;
        }

        // If telegramToken or discordToken are explicitly set to empty string (worker blanked them),
        // delete them so env var fallback can work
        if (config.telegramToken === '') {
            delete (config as any).telegramToken;
            repaired = true;
        }
        if (config.discordToken === '') {
            delete (config as any).discordToken;
            repaired = true;
        }
        if ((config as any).slackBotToken === '') {
            delete (config as any).slackBotToken;
            repaired = true;
        }
        if ((config as any).slackAppToken === '') {
            delete (config as any).slackAppToken;
            repaired = true;
        }
        if ((config as any).slackSigningSecret === '') {
            delete (config as any).slackSigningSecret;
            repaired = true;
        }

        if (repaired) {
            if (!silent) logger.info('ConfigManager: Worker-corruption repair complete. Saving corrected config.');
            // Save the repaired config (will also sync safely now)
            try {
                fs.writeFileSync(this.configPath, yaml.stringify(config));
            } catch (e) {
                logger.error(`ConfigManager: Failed to save repaired config: ${e}`);
            }
        }

        return config;
    }

    /**
     * Normalizes file/directory paths in config to be valid on the current OS.
     *
     * This primarily protects Windows users when a config file contains CI/Linux-style
     * absolute paths like /home/runner/.orcbot/..., by remapping them into the
     * resolved dataHome directory.
     */
    private normalizePlatformPaths(config: AgentConfig, silent: boolean): AgentConfig {
        // Even if not win32, we should ensure certain paths that are 'undefined' after parse (no default)
        // are set to their standard dataHome-relative locations.
        const out = { ...config };
        
        const pathDefaults: Partial<Record<keyof AgentConfig, string>> = {
            memoryPath: 'memory.json',
            skillsPath: 'SKILLS.md',
            userProfilePath: 'USER.md',
            agentIdentityPath: '.AI.md',
            actionQueuePath: 'actions.json',
            journalPath: 'JOURNAL.md',
            learningPath: 'LEARNING.md',
            worldPath: 'world.md',
            pluginsPath: 'plugins',
            toolsPath: 'tools',
            buildWorkspacePath: 'workspace',
            whatsappSessionPath: 'whatsapp-session',
            browserProfileDir: 'browser-profiles',
            browserTraceDir: 'browser-traces',
            tokenUsagePath: 'token-usage-summary.json',
            tokenLogPath: 'token-usage.log'
        };

        for (const [key, base] of Object.entries(pathDefaults)) {
            if (!(out as any)[key]) {
                (out as any)[key] = path.join(this.dataHome, base!);
            }
        }

        if (process.platform !== 'win32') return out;

        const pathKeys = Object.keys(pathDefaults) as Array<keyof AgentConfig>;

        const remapIfCiOrPosix = (value: string): string => {
            const normalized = value.replace(/\\/g, '/');

            // Handle relative paths (./something or just filename) - resolve to dataHome
            if (normalized.startsWith('./') || normalized.startsWith('../') || !path.isAbsolute(value)) {
                let basename = normalized.replace(/^\.\//, '').replace(/^\.\.\//, '');
                basename = basename.replace(/^\.orcbot\//, '');
                return path.join(this.dataHome, basename);
            }

            // If it points inside a .orcbot folder on POSIX, map the suffix into our dataHome.
            const idx = normalized.indexOf('/.orcbot/');
            if (idx >= 0) {
                const suffix = normalized.slice(idx + '/.orcbot/'.length).replace(/^\/+/, '');
                return path.join(this.dataHome, ...suffix.split('/'));
            }

            if (normalized.endsWith('/.orcbot')) return this.dataHome;

            if (normalized.startsWith('/')) {
                if (!silent) {
                    logger.warn(`ConfigManager: Detected POSIX-style absolute path on Windows: ${value}. Consider removing it or setting ORCBOT_DATA_DIR.`);
                }
            }

            return value;
        };

        for (const key of pathKeys) {
            const current = (out as any)[key];
            if (typeof current !== 'string' || current.trim() === '') continue;

            const remapped = remapIfCiOrPosix(current);
            if (remapped !== current && !silent) {
                logger.info(`ConfigManager: Normalized ${String(key)} to ${remapped}`);
            }
            (out as any)[key] = remapped;
        }

        return out;
    }

    /**
     * Override config values with conservative defaults for server/headless deployments.
     * Called automatically from loadConfig() when serverMode is true.
     */
    private applyServerModeDefaults(cfg: AgentConfig): AgentConfig {
        const serverDefaults: Partial<AgentConfig> = {
            actionQueueCompletedTTL: 2 * 60 * 60 * 1000,
            actionQueueFailedTTL: 12 * 60 * 60 * 1000,
            actionQueueFlushIntervalMs: 15000,
            actionQueueMaintenanceIntervalMs: 180000,
            vectorMemoryMaxEntries: 1500,
            processedMessagesCacheSize: 300,
            memoryConsolidationThreshold: 20,
            memoryConsolidationBatch: 15,
            memoryFlushSoftThreshold: 18,
            memoryFlushCooldownMinutes: 20,
            threadContextRecentN: 6,
            threadContextRelevantN: 5,
            journalContextLimit: 800,
            learningContextLimit: 800,
            userContextLimit: 1200,
            memoryExtendedContextLimit: 1000,
            memoryContextLimit: 15,
            skipSimulationForSimpleTasks: true,
            compactSkillsPrompt: true,
        };

        // Only apply server defaults for keys the user has NOT explicitly set in YAML.
        // Get base defaults for comparison.
        const baseDefaults = AgentConfigSchema.parse({});
        
        for (const [k, serverVal] of Object.entries(serverDefaults) as [keyof AgentConfig, any][]) {
            const currentVal = (cfg as any)[k];
            const originalDefault = (baseDefaults as any)[k];
            if (currentVal === originalDefault || currentVal === undefined) {
                (cfg as any)[k] = serverVal;
            }
        }
        return cfg;
    }

    public get(key: string): any {
        return (this.config as any)[key];
    }

    public set(key: string, value: any) {
        // Optimization: skip if value is identical (deep check for objects/arrays)
        if (isDeepEqual((this.config as any)[key], value)) {
            return;
        }

        const oldConfig = { ...this.config };

        // Apply requested change first
        (this.config as any)[key] = value;

        // Keep model/provider relationship coherent across provider switches.
        const providers = new Set(['openai', 'google', 'openrouter', 'nvidia', 'anthropic', 'bedrock']);
        const currentProvider = String((this.config as any).llmProvider || '').toLowerCase();

        // Ensure providerModelNames is always an object
        if (!(this.config as any).providerModelNames || typeof (this.config as any).providerModelNames !== 'object') {
            (this.config as any).providerModelNames = {};
        }

        if (key === 'modelName') {
            // Persist the selected model for the currently selected provider
            if (providers.has(currentProvider) && typeof value === 'string' && value.trim().length > 0) {
                (this.config as any).providerModelNames[currentProvider] = value.trim();
            }
        }

        if (key === 'llmProvider') {
            const nextProvider = String(value || '').toLowerCase();
            if (providers.has(nextProvider)) {
                const providerModel = (this.config as any).providerModelNames?.[nextProvider];
                if (providerModel && typeof providerModel === 'string' && providerModel.trim().length > 0) {
                    (this.config as any).modelName = providerModel.trim();
                }
            }
        }

        this.saveConfig();
        this.syncEnvForKey(key, value);
        // Emit event for components to react to config changes
        eventBus.emit('config:changed', { oldConfig, newConfig: this.config });
        logger.info(`ConfigManager: Config key '${key}' updated and config:changed event emitted`);
    }

    public saveConfig() {
        try {
            // Save the current config as-is. 
            // Stripping defaults is causing 'Key Churn' loops where keys disappear 
            // and reappear in the merge, triggering redundant reloads.
            fs.writeFileSync(this.configPath, yaml.stringify(this.config));
            logger.info(`Configuration saved to ${this.configPath}`);
            this.syncConfigAcrossPaths();
        } catch (error) {
            logger.error(`Error saving config: ${error}`);
        }
    }

    private syncConfigAcrossPaths() {
        const globalPath = path.join(this.dataHome, 'orcbot.config.yaml');
        const homePath = path.join(os.homedir(), 'orcbot.config.yaml');
        const localPath = path.resolve(process.cwd(), 'orcbot.config.yaml');

        const targets = [globalPath, homePath, localPath]
            .filter(p => p !== this.configPath);

        // Safety guard: never propagate worker-specific config to shared locations.
        const isWorkerConfig = this.configPath.includes('orchestrator')
            && this.configPath.includes('instances');
        if (isWorkerConfig) {
            return;
        }

        for (const target of targets) {
            if (!fs.existsSync(target) && target !== globalPath) continue;
            try {
                if (fs.existsSync(target)) {
                    let existing: any = {};
                    try { existing = yaml.parse(fs.readFileSync(target, 'utf-8')) || {}; } catch { /* proceed with full overwrite */ }

                    const protectedKeys = [
                        'telegramToken', 'discordToken', 'slackBotToken', 'slackAppToken', 'slackSigningSecret', 'smtpPassword', 'imapPassword', 'openaiApiKey', 'googleApiKey',
                        'nvidiaApiKey', 'anthropicApiKey', 'openrouterApiKey', 'serperApiKey',
                        'captchaApiKey', 'braveSearchApiKey', 'bedrockAccessKeyId',
                        'bedrockSecretAccessKey', 'bedrockSessionToken'
                    ];

                    const merged = { ...this.config };
                    for (const key of protectedKeys) {
                        const current = (merged as any)[key];
                        const targetVal = (existing as any)[key];
                        if ((!current || String(current).trim() === '') && targetVal && String(targetVal).trim() !== '') {
                            (merged as any)[key] = targetVal;
                        }
                    }

                    fs.writeFileSync(target, yaml.stringify(merged));
                } else {
                    fs.writeFileSync(target, yaml.stringify(this.config));
                }
                logger.info(`Configuration synced to ${target}`);
            } catch (error) {
                logger.warn(`Failed to sync config to ${target}: ${error}`);
            }
        }
    }

    private syncEnvForKey(key: string, value: any) {
        const envMap: Record<string, string> = {
            openaiApiKey: 'OPENAI_API_KEY',
            openrouterApiKey: 'OPENROUTER_API_KEY',
            openrouterBaseUrl: 'OPENROUTER_BASE_URL',
            openrouterReferer: 'OPENROUTER_REFERER',
            openrouterAppName: 'OPENROUTER_APP_NAME',
            googleApiKey: 'GOOGLE_API_KEY',
            nvidiaApiKey: 'NVIDIA_API_KEY',
            anthropicApiKey: 'ANTHROPIC_API_KEY',
            braveSearchApiKey: 'BRAVE_SEARCH_API_KEY',
            searxngUrl: 'SEARXNG_URL',
            serperApiKey: 'SERPER_API_KEY',
            captchaApiKey: 'CAPTCHA_API_KEY',
            telegramToken: 'TELEGRAM_TOKEN',
            discordToken: 'DISCORD_TOKEN',
            slackBotToken: 'SLACK_BOT_TOKEN',
            slackAppToken: 'SLACK_APP_TOKEN',
            slackSigningSecret: 'SLACK_SIGNING_SECRET',
            emailAddress: 'EMAIL_ADDRESS',
            smtpHost: 'SMTP_HOST',
            smtpPort: 'SMTP_PORT',
            smtpSecure: 'SMTP_SECURE',
            smtpStartTls: 'SMTP_STARTTLS',
            smtpUsername: 'SMTP_USERNAME',
            smtpPassword: 'SMTP_PASSWORD',
            imapHost: 'IMAP_HOST',
            imapPort: 'IMAP_PORT',
            imapSecure: 'IMAP_SECURE',
            imapUsername: 'IMAP_USERNAME',
            imapPassword: 'IMAP_PASSWORD',
            emailSocketTimeoutMs: 'EMAIL_SOCKET_TIMEOUT_MS',
            bedrockRegion: 'BEDROCK_REGION',
            bedrockAccessKeyId: 'BEDROCK_ACCESS_KEY_ID',
            bedrockSecretAccessKey: 'BEDROCK_SECRET_ACCESS_KEY',
            bedrockSessionToken: 'BEDROCK_SESSION_TOKEN'
        };

        const envKey = envMap[key];
        if (!envKey) return;

        const envPath = path.join(this.dataHome, '.env');
        const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        const lines = existing.split(/\r?\n/).filter(l => l.trim().length > 0);
        const filtered = lines.filter(l => !l.startsWith(envKey + '='));

        if (value !== undefined && value !== null && String(value).trim() !== '') {
            filtered.push(`${envKey}=${String(value).trim()}`);
            process.env[envKey] = String(value).trim();
        } else {
            delete process.env[envKey];
        }

        try {
            fs.writeFileSync(envPath, filtered.join('\n') + (filtered.length ? '\n' : ''));
            logger.info(`ConfigManager: Synced ${envKey} to ${envPath}`);
        } catch (error) {
            logger.warn(`ConfigManager: Failed to sync ${envKey} to ${envPath}: ${error}`);
        }
    }

    public getAll(): AgentConfig {
        return { ...this.config };
    }
}
