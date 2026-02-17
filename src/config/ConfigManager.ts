import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';

export interface AgentConfig {
    agentName: string;
    llmProvider?: 'openai' | 'google' | 'bedrock' | 'openrouter' | 'nvidia' | 'anthropic';
    providerModelNames?: Record<string, string>; // Per-provider remembered model names
    telegramToken?: string;
    openaiApiKey?: string;
    openrouterApiKey?: string;
    openrouterBaseUrl?: string;
    openrouterReferer?: string;
    openrouterAppName?: string;
    googleApiKey?: string;
    nvidiaApiKey?: string;
    anthropicApiKey?: string;
    braveSearchApiKey?: string;
    searxngUrl?: string;
    searchProviderOrder?: string[];
    serperApiKey?: string;
    captchaApiKey?: string;
    modelName?: string;
    bedrockRegion?: string;
    bedrockAccessKeyId?: string;
    bedrockSecretAccessKey?: string;
    bedrockSessionToken?: string;
    autonomyEnabled?: boolean;
    autonomyInterval?: number; // In minutes, default 0 (disabled)
    autonomyBacklogLimit?: number;
    maxActionRunMinutes?: number;
    maxStaleActionMinutes?: number;
    memoryPath?: string;
    skillsPath?: string;
    userProfilePath?: string;
    agentIdentityPath?: string;
    actionQueuePath?: string;
    journalPath?: string;
    learningPath?: string;
    pluginsPath?: string;
    toolsPath?: string;
    whatsappEnabled?: boolean;
    whatsappSessionPath?: string;
    whatsappAutoReplyEnabled?: boolean;
    whatsappStatusReplyEnabled?: boolean;
    whatsappAutoReactEnabled?: boolean;
    whatsappContextProfilingEnabled?: boolean;
    whatsappOwnerJID?: string;
    telegramAutoReplyEnabled?: boolean;
    maxMessagesPerAction?: number;
    maxStepsPerAction?: number;
    messageDedupWindow?: number;
    commandTimeoutMs?: number;
    commandRetries?: number;
    commandWorkingDir?: string;
    commandAllowList?: string[];
    commandDenyList?: string[];
    safeMode?: boolean;
    sudoMode?: boolean;
    overrideMode?: boolean;
    pluginAllowList?: string[];
    pluginDenyList?: string[];
    pluginHealthCheckIntervalMinutes?: number; // Plugin health check interval (default 15)
    browserProfileDir?: string;
    browserProfileName?: string;
    browserEngine?: 'playwright' | 'lightpanda';  // Browser engine to use (default: playwright)
    lightpandaEndpoint?: string;                  // Lightpanda CDP endpoint (default: ws://127.0.0.1:9222)
    lightpandaPath?: string;                      // Path to Lightpanda binary
    browserDebugAlwaysSave?: boolean;             // Save debug artifacts on every navigation/snapshot
    browserTraceEnabled?: boolean;                // Enable Playwright trace recording
    browserTraceDir?: string;                     // Optional trace output directory
    browserTraceScreenshots?: boolean;            // Include screenshots in trace
    browserTraceSnapshots?: boolean;              // Include DOM snapshots in trace
    googleComputerUseEnabled?: boolean;           // Enable Gemini computer-use routing for browser tools
    googleComputerUseModel?: string;              // Gemini computer-use model name
    tokenUsagePath?: string;
    tokenLogPath?: string;
    // Discord
    discordToken?: string;                // Discord bot token
    discordAutoReplyEnabled?: boolean;    // Auto-reply in Discord (default false)
    slackBotToken?: string;               // Slack bot token (xoxb-...)
    slackAppToken?: string;               // Slack app token (xapp-...) for Socket Mode
    slackSigningSecret?: string;          // Slack signing secret (for events API)
    slackAutoReplyEnabled?: boolean;      // Auto-reply in Slack (default false)
    // World events
    worldEventsSources?: string[];        // e.g. ['gdelt', 'usgs', 'opensky']
    worldEventsRefreshSeconds?: number;   // Live view refresh (default 60)
    worldEventsLookbackMinutes?: number;  // GDELT/USGS lookback window (default 60)
    worldEventsMaxRecords?: number;       // Max records per fetch (default 250)
    worldEventsBatchMinutes?: number;     // Summarization batch window (default 10)
    worldEventsStoreEnabled?: boolean;    // Store summaries in vector memory
    worldEventsHeartbeatEnabled?: boolean; // Enable heartbeat-time world event ingestion (default true)
    worldEventsGdeltQuery?: string;       // GDELT query filter (default 'global')
    worldEventsGlobeRenderer?: 'ascii' | 'external' | 'map' | 'mapscii'; // Renderer mode
    worldEventsGlobeCommand?: string;     // External globe CLI command
    worldEventsGlobeArgs?: string[];      // External globe CLI args
    // Session scoping & identity links
    sessionScope?: 'main' | 'per-peer' | 'per-channel-peer'; // Thread scope strategy for inbound context
    identityLinks?: Record<string, string>; // Map channel identities (e.g. telegram:123) to canonical person keys
    // Adaptive guidance (reduce hardcoded behavior)
    guidanceMode?: 'strict' | 'balanced' | 'fluid';
    guidanceAckPatterns?: string[];
    guidanceLowValuePatterns?: string[];
    guidanceClarificationKeywords?: string[];
    guidanceQuestionStopWords?: string[];
    guidanceRepeatQuestionThreshold?: number;
    guidanceShortReplyMaxWords?: number;
    guidanceShortReplyMaxChars?: number;
    robustReasoningMode?: boolean; // Enable stricter reasoning guardrails and verification
    reasoningExposeChecklist?: boolean; // Send checklist preview to users for non-trivial tasks
    reasoningChecklistMaxItems?: number; // Max checklist items to show in preview
    orcbotControlEnabled?: boolean; // Enable admin-gated app-level control skill
    orcbotControlCliAllowList?: string[]; // Allowed `orcbot` CLI command prefixes for app control
    orcbotControlCliDenyList?: string[]; // Denied `orcbot` CLI command prefixes for app control
    orcbotControlTimeoutMs?: number; // Timeout for app-control CLI execution
    // Operational
    autoExecuteCommands?: boolean;        // Auto-execute commands without confirmation (default false)
    skillRoutingRules?: Array<{
        match: string;
        prefer?: string[];
        avoid?: string[];
        requirePreferred?: boolean;
    }>;
    autopilotNoQuestions?: boolean;
    autopilotNoQuestionsAllow?: string[];
    autopilotNoQuestionsDeny?: string[];
    progressFeedbackEnabled?: boolean;
    progressFeedbackStepInterval?: number; // Silent-step threshold before automatic status update
    progressFeedbackForceInitial?: boolean; // Force an initial status update before deep tool work
    sessionAnchorEnabled?: boolean; // Persist and reuse workspace/artifact anchors per session scope
    sessionAnchorMaxHints?: number; // Maximum session continuity hints to inject into reasoning context
    // Memory limits
    memoryContextLimit?: number;          // Recent memories in context (default 20)
    memoryEpisodicLimit?: number;         // Episodic summaries to include (default 5)
    memoryConsolidationThreshold?: number; // When to consolidate (default 30)
    memoryConsolidationBatch?: number;    // How many to consolidate at once (default 20)
    // Token optimization
    skipSimulationForSimpleTasks?: boolean; // Skip planning step for simple tasks (default true)
    compactSkillsPrompt?: boolean;          // Use compact skills format (default false)
    fastModelName?: string;                 // Cheaper/faster model for internal reasoning (auto-detected from primary provider if unset)
    // Web Gateway
    gatewayPort?: number;                 // Port for web gateway (default 3100)
    gatewayHost?: string;                 // Host to bind gateway (default 0.0.0.0)
    gatewayApiKey?: string;               // API key for gateway authentication
    gatewayCorsOrigins?: string[];        // CORS allowed origins (default ['*'])
    // Image Generation
    imageGenProvider?: 'openai' | 'google';       // Which provider for image gen (default: auto based on available keys)
    imageGenModel?: string;                       // Model name (e.g. 'dall-e-3', 'gpt-image-1', 'gemini-2.5-flash-image')
    imageGenSize?: string;                        // Default size (e.g. '1024x1024')
    imageGenQuality?: string;                     // Default quality (e.g. 'medium', 'high', 'hd')
    // Agentic User (autonomous HITL proxy)
    agenticUserEnabled?: boolean;              // Master toggle (default false)
    agenticUserResponseDelay?: number;         // Seconds to wait before intervening (default 120)
    agenticUserConfidenceThreshold?: number;   // Min confidence 0-100 to auto-intervene (default 70)
    agenticUserProactiveGuidance?: boolean;    // Enable proactive stuck-detection guidance (default true)
    agenticUserProactiveStepThreshold?: number; // Steps before proactive guidance (default 8)
    agenticUserCheckInterval?: number;         // Check interval in seconds (default 30)
    agenticUserMaxInterventions?: number;      // Max interventions per action (default 3)
    agenticUserNotifyUser?: boolean;              // Send notification to user on intervention (default true)
    // User Permissions
    adminUsers?: {
        telegram?: string[];   // Telegram numeric user IDs (e.g., ["123456789"])
        discord?: string[];    // Discord snowflake user IDs (e.g., ["876513738667229184"])
        whatsapp?: string[];   // WhatsApp JIDs (e.g., ["5511999998888@s.whatsapp.net"])
        slack?: string[];      // Slack user IDs (e.g., ["U012ABCDEF"])
    };
}

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
        const defaults = this.getStringDefaultConfig();
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
            bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
            bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
            bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
            bedrockSessionToken: process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
            // @ts-ignore - Dynamic key support
            MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY
        };

        // Filter out undefined env vars
        const activeEnv = Object.fromEntries(
            Object.entries(envConfig).filter(([_, v]) => v !== undefined)
        );

        const mergedConfig: AgentConfig = {
            ...defaults,
            ...globalConfig,
            ...homeConfig,
            ...localConfig,
            ...customConfig
        };

        // Apply env vars only as fallback when config value is missing
        Object.entries(activeEnv).forEach(([key, value]) => {
            const current = (mergedConfig as any)[key];
            if (current === undefined || current === null || current === '') {
                (mergedConfig as any)[key] = value;
            } else if (!silent) {
                logger.info(`ConfigManager: Ignoring env override for ${key} because config already defines a value.`);
            }
        });

        const normalized = this.normalizePlatformPaths(mergedConfig, silent);
        const typed = this.coerceConfigTypes(normalized, defaults);
        return this.repairWorkerCorruption(typed, silent);
    }

    /**
     * Coerce string values (from CLI/env/manual YAML edits) to expected types
     * based on defaults. Prevents bugs like "false" being treated as truthy.
     */
    private coerceConfigTypes(config: AgentConfig, defaults: AgentConfig): AgentConfig {
        const out: any = { ...config };

        const toBool = (v: any): any => {
            if (typeof v !== 'string') return v;
            const s = v.trim().toLowerCase();
            if (s === 'true') return true;
            if (s === 'false') return false;
            return v;
        };

        const toNumber = (v: any): any => {
            if (typeof v === 'number') return v;
            if (typeof v !== 'string') return v;
            const s = v.trim();
            if (!s) return v;
            const n = Number(s);
            return Number.isFinite(n) ? n : v;
        };

        for (const [key, defaultValue] of Object.entries(defaults as any)) {
            const current = out[key];
            if (current === undefined || current === null) continue;

            if (typeof defaultValue === 'boolean') {
                out[key] = toBool(current);
                continue;
            }

            if (typeof defaultValue === 'number') {
                out[key] = toNumber(current);
                continue;
            }
        }

        return out as AgentConfig;
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
            'actionQueuePath', 'journalPath', 'learningPath', 'tokenUsagePath', 'tokenLogPath'
        ];
        const defaults = this.getStringDefaultConfig();
        let repaired = false;

        for (const key of pathKeys) {
            const value = config[key];
            if (typeof value === 'string' && value.includes('orchestrator') && value.includes('instances')) {
                if (!silent) logger.warn(`ConfigManager: Repairing worker-corrupted path for ${String(key)}: ${value} → default`);
                (config as any)[key] = (defaults as any)[key];
                repaired = true;
            }
        }

        // Also reset agentName if it looks like a worker name
        if (config.agentName && /^(Researcher|Worker|Agent)_\d+$/i.test(config.agentName)) {
            if (!silent) logger.warn(`ConfigManager: Repairing worker-corrupted agentName: ${config.agentName} → default`);
            config.agentName = defaults.agentName;
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
        if (process.platform !== 'win32') return config;

        const pathKeys: Array<keyof AgentConfig> = [
            'memoryPath',
            'skillsPath',
            'userProfilePath',
            'agentIdentityPath',
            'actionQueuePath',
            'journalPath',
            'learningPath',
            'pluginsPath',
            'toolsPath',
            'whatsappSessionPath',
            'browserProfileDir',
            'tokenUsagePath',
            'tokenLogPath'
        ];

        const remapIfCiOrPosix = (value: string): string => {
            const normalized = value.replace(/\\/g, '/');

            // Handle relative paths (./something or just filename) - resolve to dataHome
            if (normalized.startsWith('./') || normalized.startsWith('../') || !path.isAbsolute(value)) {
                const basename = normalized.replace(/^\.\//, '').replace(/^\.\.\//, '');
                return path.join(this.dataHome, basename);
            }

            // If it points inside a .orcbot folder on POSIX, map the suffix into our dataHome.
            const idx = normalized.indexOf('/.orcbot/');
            if (idx >= 0) {
                const suffix = normalized.slice(idx + '/.orcbot/'.length).replace(/^\/+/, '');
                return path.join(this.dataHome, ...suffix.split('/'));
            }

            // If it's exactly a .orcbot directory (rare), map to dataHome.
            if (normalized.endsWith('/.orcbot')) {
                return this.dataHome;
            }

            // For other POSIX-rooted absolute paths, keep as-is (user may genuinely want it),
            // but warn once so it's not silently creating directories at drive root.
            if (normalized.startsWith('/')) {
                if (!silent) {
                    logger.warn(`ConfigManager: Detected POSIX-style absolute path on Windows: ${value}. Consider removing it or setting ORCBOT_DATA_DIR.`);
                }
            }

            return value;
        };

        for (const key of pathKeys) {
            const current = config[key];
            if (typeof current !== 'string' || current.trim() === '') continue;

            const remapped = remapIfCiOrPosix(current);
            if (remapped !== current && !silent) {
                logger.info(`ConfigManager: Normalized ${String(key)} to ${remapped}`);
            }
            (config as any)[key] = remapped;
        }

        return config;
    }

    private getStringDefaultConfig(): AgentConfig {
        return {
            agentName: 'OrcBot',
            llmProvider: undefined,
            modelName: 'gpt-4o',
            providerModelNames: {
                openai: 'gpt-4o',
                google: 'gemini-2.5-flash',
                openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
                nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
                anthropic: 'claude-3-5-sonnet-latest',
                bedrock: 'anthropic.claude-3-5-sonnet-20240620-v1:0'
            },
            searchProviderOrder: ['serper', 'brave', 'searxng', 'google', 'bing', 'duckduckgo'],
            autonomyEnabled: true,
            autonomyInterval: 15,
            autonomyBacklogLimit: 3,
            maxActionRunMinutes: 10,
            maxStaleActionMinutes: 30,
            memoryPath: path.join(this.dataHome, 'memory.json'),
            skillsPath: path.join(this.dataHome, 'SKILLS.md'),
            userProfilePath: path.join(this.dataHome, 'USER.md'),
            agentIdentityPath: path.join(this.dataHome, '.AI.md'),
            actionQueuePath: path.join(this.dataHome, 'actions.json'),
            journalPath: path.join(this.dataHome, 'JOURNAL.md'),
            learningPath: path.join(this.dataHome, 'LEARNING.md'),
            pluginsPath: path.join(this.dataHome, 'plugins'),
            toolsPath: path.join(this.dataHome, 'tools'),
            whatsappEnabled: false,
            whatsappSessionPath: path.join(this.dataHome, 'whatsapp-session'),
            whatsappAutoReplyEnabled: false,
            whatsappStatusReplyEnabled: false,
            whatsappAutoReactEnabled: false,
            whatsappContextProfilingEnabled: false,
            whatsappOwnerJID: undefined,
            telegramAutoReplyEnabled: false,
            maxMessagesPerAction: 10,
            maxStepsPerAction: 30,
            messageDedupWindow: 10,
            commandTimeoutMs: 120000,
            commandRetries: 1,
            commandWorkingDir: undefined,
            commandAllowList: [
                'npm',
                'node',
                'npx',
                'git',
                'python',
                'pip',
                'pip3',
                'curl',
                'wget',
                'powershell',
                'pwsh',
                'bash',
                'apt',
                'apt-get',
                'yum',
                'dnf',
                'pacman',
                'brew',
                'sudo',
                'systemctl',
                'service',
                'cat',
                'ls',
                'dir',
                'echo',
                'mkdir',
                'touch',
                'cp',
                'mv',
                'head',
                'tail',
                'grep',
                'find',
                'which',
                'whoami',
                'uname',
                'hostname'
            ],
            commandDenyList: [
                'rm',
                'rmdir',
                'del',
                'erase',
                'format',
                'mkfs',
                'dd',
                'shutdown',
                'reboot',
                'poweroff',
                'reg',
                'diskpart',
                'netsh'
            ],
            safeMode: false,
            pluginAllowList: [],
            pluginDenyList: [],
            pluginHealthCheckIntervalMinutes: 15,
            browserProfileDir: path.join(this.dataHome, 'browser-profiles'),
            browserProfileName: 'default',
            browserEngine: 'playwright',
            lightpandaEndpoint: 'ws://127.0.0.1:9222',
            browserDebugAlwaysSave: false,
            browserTraceEnabled: false,
            browserTraceDir: path.join(this.dataHome, 'browser-traces'),
            browserTraceScreenshots: true,
            browserTraceSnapshots: true,
            googleComputerUseEnabled: false,
            googleComputerUseModel: 'gemini-2.5-computer-use-preview-10-2025',
            tokenUsagePath: path.join(this.dataHome, 'token-usage-summary.json'),
            tokenLogPath: path.join(this.dataHome, 'token-usage.log'),
            discordAutoReplyEnabled: false,
            slackAutoReplyEnabled: false,
            slackAppToken: undefined,
            slackSigningSecret: undefined,
            worldEventsSources: ['gdelt', 'usgs'],
            worldEventsRefreshSeconds: 60,
            worldEventsLookbackMinutes: 60,
            worldEventsMaxRecords: 250,
            worldEventsBatchMinutes: 10,
            worldEventsStoreEnabled: true,
            worldEventsHeartbeatEnabled: true,
            worldEventsGdeltQuery: 'global',
            worldEventsGlobeRenderer: 'mapscii',
            worldEventsGlobeCommand: 'mapscii',
            worldEventsGlobeArgs: [],
            sessionScope: 'per-channel-peer',
            identityLinks: {},
            guidanceMode: 'balanced',
            guidanceAckPatterns: [
                '^(understood|got it|on it|acknowledged|okay|ok|alright|sure|perfect)\\b',
                '^thanks?[,.!\\s]',
                "\\bi\\s*(am|'m)\\s*(ready|working on|going to|about to)\\b",
                '\\bi\\s*will\\s*now\\b',
                '\\bworking on it\\b',
                '\\blet me\\b'
            ],
            guidanceLowValuePatterns: [
                '^(got it|on it|working on it|one moment|hang tight|be right back|still working)[.!]?$',
                "^i('m| am) (checking|working on|looking into)\\b",
                '^quick update[:\\-]?\\s*$',
                '^sorry[,\\s]',
                '^(understood|acknowledged)[,.!\\s]',
                "\\bi\\s*(am|'m)\\s*ready\\s*to\\b",
                '\\bi\\s*will\\s*now\\b'
            ],
            guidanceClarificationKeywords: [
                'clarif', 'question', 'which', 'what', 'prefer', 'preference', 'confirm', 'api', 'details'
            ],
            guidanceQuestionStopWords: [
                'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
                'be', 'been', 'being', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'please',
                'you', 'your', 'me', 'my', 'we', 'our', 'it', 'this', 'that', 'with', 'about', 'if', 'as', 'by'
            ],
            guidanceRepeatQuestionThreshold: 0.65,
            guidanceShortReplyMaxWords: 7,
            guidanceShortReplyMaxChars: 48,
            robustReasoningMode: false,
            reasoningExposeChecklist: false,
            reasoningChecklistMaxItems: 5,
            orcbotControlEnabled: true,
            orcbotControlCliAllowList: ['config get', 'config set', 'models', 'gateway', 'security', 'agentic-user'],
            orcbotControlCliDenyList: ['reset', 'ui', 'setup', 'builder', 'daemon stop'],
            orcbotControlTimeoutMs: 45000,
            autoExecuteCommands: false,
            bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
            bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
            bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
            sudoMode: false,
            overrideMode: false,
            bedrockSessionToken: process.env.BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            skillRoutingRules: [],
            autopilotNoQuestions: false,
            autopilotNoQuestionsAllow: [],
            autopilotNoQuestionsDeny: [],
            progressFeedbackEnabled: true,
            progressFeedbackStepInterval: 4,
            progressFeedbackForceInitial: true,
            sessionAnchorEnabled: true,
            sessionAnchorMaxHints: 4,
            memoryContextLimit: 20,
            memoryEpisodicLimit: 5,
            memoryConsolidationThreshold: 30,
            memoryConsolidationBatch: 20,
            skipSimulationForSimpleTasks: true,
            compactSkillsPrompt: false,
            fastModelName: undefined,
            imageGenProvider: undefined,
            imageGenModel: undefined,
            imageGenSize: '1024x1024',
            imageGenQuality: 'medium',
            // Agentic User defaults
            agenticUserEnabled: false,
            agenticUserResponseDelay: 120,
            agenticUserConfidenceThreshold: 70,
            agenticUserProactiveGuidance: true,
            agenticUserProactiveStepThreshold: 8,
            agenticUserCheckInterval: 30,
            agenticUserMaxInterventions: 3,
            agenticUserNotifyUser: true
        };
    }

    public get(key: string): any {
        return (this.config as any)[key];
    }

    public set(key: string, value: any) {
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
        // Worker configs have isolated paths (e.g. orchestrator/instances/agent-xxx/)
        // and empty channel tokens.  Syncing these would corrupt the parent config.
        const isWorkerConfig = this.configPath.includes('orchestrator')
            && this.configPath.includes('instances');
        if (isWorkerConfig) {
            return; // Workers must NEVER overwrite shared config files
        }

        for (const target of targets) {
            if (!fs.existsSync(target) && target !== globalPath) continue;
            try {
                // If a target file already exists, merge rather than overwrite:
                // preserve any keys in the target that are set but empty/missing in
                // the current config (protects tokens set in different config locations).
                if (fs.existsSync(target)) {
                    let existing: any = {};
                    try { existing = yaml.parse(fs.readFileSync(target, 'utf-8')) || {}; } catch { /* proceed with full overwrite */ }

                    // Critical keys that should never be blanked by a sync
                    const protectedKeys = [
                        'telegramToken', 'discordToken', 'slackBotToken', 'slackAppToken', 'slackSigningSecret', 'openaiApiKey', 'googleApiKey',
                        'nvidiaApiKey', 'anthropicApiKey', 'openrouterApiKey', 'serperApiKey',
                        'captchaApiKey', 'braveSearchApiKey', 'bedrockAccessKeyId',
                        'bedrockSecretAccessKey', 'bedrockSessionToken'
                    ];

                    const merged = { ...this.config };
                    for (const key of protectedKeys) {
                        const current = (merged as any)[key];
                        const targetVal = (existing as any)[key];
                        // If we'd blank out a key that exists in the target, keep the target's value
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
