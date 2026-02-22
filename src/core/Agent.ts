import { MemoryManager } from '../memory/MemoryManager';
import { TokenTracker } from './TokenTracker';
import { MultiLLM } from './MultiLLM';
import { SkillsManager } from './SkillsManager';
import { DecisionEngine } from './DecisionEngine';
import { SimulationEngine } from './SimulationEngine';
import { ActionQueue, Action } from '../memory/ActionQueue';
import { Scheduler } from './Scheduler';
import { PollingManager } from './PollingManager';
import { ConfigManager } from '../config/ConfigManager';
import { TelegramChannel } from '../channels/TelegramChannel';
import { WhatsAppChannel } from '../channels/WhatsAppChannel';
import { DiscordChannel } from '../channels/DiscordChannel';
import { SlackChannel } from '../channels/SlackChannel';
import { EmailChannel } from '../channels/EmailChannel';
import { configManagementSkill } from '../skills/configManagement';
import { WebBrowser } from '../tools/WebBrowser';
import { ComputerUse } from '../tools/ComputerUse';
import { WorkerProfileManager } from './WorkerProfile';
import { AgentOrchestrator } from './AgentOrchestrator';
import { RuntimeTuner } from './RuntimeTuner';
import { BootstrapManager } from './BootstrapManager';
import { UsagePing } from './UsagePing';
import { AgenticUser } from './AgenticUser';
import { KnowledgeStore } from '../memory/KnowledgeStore';
import { memoryToolsSkills } from '../skills/memoryTools';
import { ToolsManager } from './ToolsManager';
import { Cron } from 'croner';
import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import { eventBus } from './EventBus';
import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import { resolveEmoji, detectChannelFromMetadata } from '../utils/ReactionHelper';
import { renderMarkdown, hasMarkdown } from '../utils/MarkdownRenderer';
import { fetchWorldEvents, summarizeWorldEvents, WorldEventSource } from '../tools/WorldEvents';
import { buildWorkflowSignalLog, buildWorkflowSignalMemory, shouldInjectWorkflowSignal, WorkflowSignalLevel } from './WorkflowReviewHelper';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { shellSessions } from '../utils/ShellSession';

/**
 * Skills that require admin-level permissions.
 * Non-admin users (external users not in adminUsers config) cannot trigger these.
 * When adminUsers is not configured, everyone is treated as admin (backwards compatible).
 */
export const ELEVATED_SKILLS = new Set([
    'run_command',
    'shell_start', 'shell_read', 'shell_send', 'shell_stop', 'shell_list',
    'orcbot_control',
    'write_file', 'write_to_file', 'create_file', 'delete_file', 'read_file',
    'install_npm_dependency',
    'browser_navigate', 'browser_click', 'browser_type', 'browser_snapshot', 'browser_close',
    'browser_fill_form', 'browser_extract_data', 'browser_extract_content', 'browser_api_intercept',
    'schedule_task',
    'manage_skills', 'manage_config',
    'generate_image', 'send_image',
    'install_tool', 'approve_tool', 'run_tool_command', 'uninstall_tool', 'activate_tool', 'read_tool_readme',
]);

/**
 * Tracks users who have interacted with the bot across channels.
 * Used in the TUI to select admin users without needing to know raw IDs.
 */
export interface KnownUser {
    id: string;           // channel-specific user ID
    name: string;         // display name
    channel: 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'email';
    username?: string;    // @username if available
    lastSeen: string;     // ISO timestamp
    messageCount: number;
}

export class Agent {
    public memory: MemoryManager;
    public llm: MultiLLM;
    public skills: SkillsManager;
    public decisionEngine: DecisionEngine;
    public simulationEngine: SimulationEngine;
    public tuner: RuntimeTuner;
    public actionQueue: ActionQueue;
    public scheduler: Scheduler;
    public pollingManager: PollingManager;
    public usagePing: UsagePing;
    public config: ConfigManager;
    public telegram: TelegramChannel | undefined;
    public whatsapp: WhatsAppChannel | undefined;
    public discord: DiscordChannel | undefined;
    public slack: SlackChannel | undefined;
    public email: EmailChannel | undefined;
    public browser: WebBrowser;
    public computerUse: ComputerUse;
    public workerProfile: WorkerProfileManager;
    public orchestrator: AgentOrchestrator;
    public tools: ToolsManager;
    public bootstrap: BootstrapManager;
    public agenticUser: AgenticUser;
    public knowledgeStore: KnowledgeStore;
    private lastActionTime: number;
    private lastHeartbeatAt: number = 0;
    private consecutiveIdleHeartbeats: number = 0;
    private lastHeartbeatProductive: boolean = true;
    private heartbeatRunning: boolean = false;
    private lastHeartbeatPushAt: number = 0;
    private lastHeartbeatMessageSentAt: number = 0; // When a heartbeat last actually sent a message to the user
    private lastUserActivityAt: number = 0;
    private maxStepFallbackCount: number = 0;
    private delayRiskHighCount: number = 0;
    private lastWorldEventsRefreshAt: number = 0;
    private lastWorldEventsMemoryWriteAt: number = 0;
    private worldEventsRefreshRunning: boolean = false;
    private lastWorldEventsSummary: string = '';
    private _blankPageCount: number = 0;
    private agentConfigFile: string;
    private agentIdentity: string = '';
    private isBusy: boolean = false;
    /** Per-lane busy flags used by the parallel worker pool */
    private busyLanes: Set<'user' | 'autonomy'> = new Set();
    private lastPluginHealthCheckAt: number = 0;
    private currentActionId: string | null = null;
    /** Per-lane action IDs for the parallel worker pool */
    private currentActionIds: Map<'user' | 'autonomy', string | null> = new Map();
    private currentActionStartAt: number | null = null;
    private cancelledActions: Set<string> = new Set();
    private persistentTypingTimer: NodeJS.Timeout | null = null;
    private instanceLockPath: string | null = null;
    private instanceLockAcquired: boolean = false;
    private heartbeatJobs: Map<string, Cron> = new Map();
    private heartbeatSchedulePath: string;
    private scheduledTasks: Map<string, Cron> = new Map();
    private scheduledTaskMeta: Map<string, any> = new Map();
    private scheduledTasksPath: string = '';

    // Track processed messages to prevent duplicates
    private processedMessages: Set<string> = new Set();
    private processedMessagesMaxSize: number = 1000;
    private recentTaskFingerprints: Map<string, number> = new Map();
    private readonly recentTaskDedupWindowMs: number = 60_000;

    private readonly TOOL_CHANNEL_MAP: Record<string, 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'email' | 'gateway-chat'> = {
        send_telegram: 'telegram',
        telegram_send_buttons: 'telegram',
        telegram_send_poll: 'telegram',
        send_whatsapp: 'whatsapp',
        react_whatsapp: 'whatsapp',
        reply_whatsapp_status: 'whatsapp',
        post_whatsapp_status: 'whatsapp',
        send_discord: 'discord',
        send_discord_file: 'discord',
        send_slack: 'slack',
        send_slack_file: 'slack',
        send_email: 'email',
        send_gateway_chat: 'gateway-chat',
    };
    private readonly CROSS_CHANNEL_EXEMPT_TOOLS: Set<string> = new Set([
        // Email delivery is intentionally cross-channel so users can request
        // "email this" from Telegram/WhatsApp/Discord/Slack.
        'send_email',
    ]);

    // Known users tracker — populated from inbound channel messages
    private knownUsers: Map<string, KnownUser> = new Map();
    private knownUsersPath: string = '';
    private knownUsersDirty: boolean = false;

    /** True when this Agent instance runs inside a worker process (AgentWorker). */
    public readonly isWorker: boolean;

    constructor(options?: { isWorker?: boolean }) {
        this.isWorker = options?.isWorker ?? false;
        this.config = new ConfigManager();
        this.agentConfigFile = this.config.get('agentIdentityPath');
        this.initializeStorage();

        this.tools = new ToolsManager(
            this.config.get('toolsPath') || path.join(this.config.getDataHome(), 'tools')
        );

        this.memory = new MemoryManager(
            this.config.get('memoryPath'),
            this.config.get('userProfilePath')
        );

        // Configure memory limits from config
        this.memory.setLimits({
            contextLimit: this.config.get('memoryContextLimit'),
            episodicLimit: this.config.get('memoryEpisodicLimit'),
            consolidationThreshold: this.config.get('memoryConsolidationThreshold'),
            consolidationBatch: this.config.get('memoryConsolidationBatch'),
            memoryFlushSoftThreshold: this.config.get('memoryFlushSoftThreshold'),
            memoryFlushCooldownMinutes: this.config.get('memoryFlushCooldownMinutes'),
            memoryContentMaxLength: this.config.get('memoryContentMaxLength'),
            memoryExtendedContextLimit: this.config.get('memoryExtendedContextLimit'),
            interactionBatchSize: this.config.get('memoryInteractionBatchSize'),
            interactionStaleMinutes: this.config.get('memoryInteractionStaleMinutes'),
            memoryDedupWindowMinutes: this.config.get('memoryDedupWindowMinutes'),
            userExchangeDefaultLimit: this.config.get('userExchangeContextLimit')
        });

        // Wire processed-messages cache size from config (supports serverMode override)
        const cacheSizeCfg = this.config.get('processedMessagesCacheSize');
        if (typeof cacheSizeCfg === 'number' && cacheSizeCfg > 0) {
            this.processedMessagesMaxSize = cacheSizeCfg;
        }

        // Initialize vector memory for semantic search (gracefully disabled if no API key)
        this.memory.initVectorMemory({
            openaiApiKey: this.config.get('openaiApiKey'),
            googleApiKey: this.config.get('googleApiKey'),
            preferredProvider: this.config.get('llmProvider'),
            maxEntries: this.config.get('vectorMemoryMaxEntries'),
        });

        const tokenTracker = new TokenTracker(
            this.config.get('tokenUsagePath'),
            this.config.get('tokenLogPath')
        );

        this.llm = new MultiLLM({
            apiKey: this.config.get('openaiApiKey'),
            openrouterApiKey: this.config.get('openrouterApiKey'),
            openrouterBaseUrl: this.config.get('openrouterBaseUrl'),
            openrouterReferer: this.config.get('openrouterReferer'),
            openrouterAppName: this.config.get('openrouterAppName'),
            googleApiKey: this.config.get('googleApiKey'),
            nvidiaApiKey: this.config.get('nvidiaApiKey'),
            anthropicApiKey: this.config.get('anthropicApiKey'),
            modelName: this.config.get('modelName'),
            llmProvider: this.config.get('llmProvider'),
            bedrockRegion: this.config.get('bedrockRegion'),
            bedrockAccessKeyId: this.config.get('bedrockAccessKeyId'),
            bedrockSecretAccessKey: this.config.get('bedrockSecretAccessKey'),
            bedrockSessionToken: this.config.get('bedrockSessionToken'),
            tokenTracker,
            usePiAI: this.config.get('usePiAI'),
            groqApiKey: this.config.get('groqApiKey'),
            mistralApiKey: this.config.get('mistralApiKey'),
            cerebrasApiKey: this.config.get('cerebrasApiKey'),
            xaiApiKey: this.config.get('xaiApiKey'),
            fallbackModelNames: this.config.get('fallbackModelNames'),
        });

        // Configure fast model for internal reasoning (reviews, reflections, classification)
        const fastModel = this.config.get('fastModelName');
        if (fastModel) {
            this.llm.setFastModel(fastModel);
        }

        this.skills = new SkillsManager(
            this.config.get('skillsPath') || './SKILLS.md',
            this.config.get('pluginsPath') || './plugins',
            {
                browser: this.browser,
                config: this.config,
                agent: this,
                logger: logger
            }
        );

        // Initialize Bootstrap Manager for workspace files early
        this.bootstrap = new BootstrapManager(this.config.getDataHome());
        this.bootstrap.initializeFiles();
        logger.info('Bootstrap manager initialized');

        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            this.config.get('journalPath'),
            this.config.get('learningPath'),
            this.config,
            this.bootstrap,  // Pass bootstrap manager
            this.tools
        );
        this.decisionEngine.setKnowledgeStore(this.knowledgeStore);
        this.simulationEngine = new SimulationEngine(this.llm);
        this.actionQueue = new ActionQueue(this.config.get('actionQueuePath') || './actions.json', {
            completedTTL: this.config.get('actionQueueCompletedTTL'),
            failedTTL: this.config.get('actionQueueFailedTTL'),
            flushInterval: this.config.get('actionQueueFlushIntervalMs'),
            maintenanceInterval: this.config.get('actionQueueMaintenanceIntervalMs'),
        });
        this.scheduler = new Scheduler();
        this.pollingManager = new PollingManager();
        this.usagePing = new UsagePing(this.config);

        // Initialize RuntimeTuner for self-tuning capabilities
        this.tuner = new RuntimeTuner(path.dirname(this.config.get('memoryPath')));

        this.browser = new WebBrowser(
            this.config.get('serperApiKey'),
            this.config.get('captchaApiKey'),
            this.config.get('braveSearchApiKey'),
            this.config.get('searxngUrl'),
            this.config.get('searchProviderOrder'),
            this.config.get('browserProfileDir'),
            this.config.get('browserProfileName'),
            this.tuner, // Pass tuner to browser
            this.config.get('browserEngine'),      // Browser engine: 'playwright' | 'lightpanda'
            this.config.get('lightpandaEndpoint'),  // Lightpanda CDP endpoint
            {
                alwaysSaveArtifacts: this.config.get('browserDebugAlwaysSave'),
                traceEnabled: this.config.get('browserTraceEnabled'),
                traceDir: this.config.get('browserTraceDir'),
                traceScreenshots: this.config.get('browserTraceScreenshots'),
                traceSnapshots: this.config.get('browserTraceSnapshots')
            }
        );

        // Wire vision analyzer so the browser can auto-fallback to screenshot + LLM vision
        // when semantic snapshots are thin (canvas-heavy, image-based, or custom-component UIs)
        this.browser.setVisionAnalyzer(async (screenshotPath: string, prompt: string) => {
            return this.llm.analyzeMedia(screenshotPath, prompt);
        });

        // Computer Use: vision-based mouse/keyboard control for browser + system
        this.computerUse = new ComputerUse();
        this.computerUse.setVisionAnalyzer(async (screenshotPath: string, prompt: string) => {
            if (this.shouldUseGoogleComputerUse()) {
                const model = this.getGoogleComputerUseModel();
                return this.llm.analyzeMediaWithModel(screenshotPath, prompt, model);
            }
            return this.llm.analyzeMedia(screenshotPath, prompt);
        });
        this.computerUse.setPageGetter(() => this.browser.page);

        this.workerProfile = new WorkerProfileManager();
        this.orchestrator = new AgentOrchestrator();

        this.loadLastActionTime();
        this.loadLastHeartbeatTime();
        this.heartbeatSchedulePath = path.join(path.dirname(this.config.get('actionQueuePath')), 'heartbeat-schedules.json');
        if (!this.isWorker) this.loadHeartbeatSchedules();
        this.scheduledTasksPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'scheduled-tasks.json');
        if (!this.isWorker) this.loadScheduledTasks();
        this.knownUsersPath = path.join(this.config.getDataHome(), 'known_users.json');
        if (!this.isWorker) this.loadKnownUsers();

        // Ensure context is up to date (supports reconfiguration)
        this.skills.setContext({
            browser: this.browser,
            config: this.config,
            agent: this,
            logger: logger,
            workerProfile: this.workerProfile,
            orchestrator: this.orchestrator
        });

        // Initialize RAG Knowledge Store
        this.knowledgeStore = new KnowledgeStore(this.config.getDataHome(), {
            openaiApiKey: this.config.get('openaiApiKey'),
            googleApiKey: this.config.get('googleApiKey'),
            preferredProvider: this.config.get('llmProvider'),
        });

        // Initialize Agentic User only for primary agent (workers don't manage HITL)
        this.agenticUser = new AgenticUser(
            this.memory,
            this.actionQueue,
            this.llm,
            this.config
        );
        if (!this.isWorker) {
            this.agenticUser.start();
        }

        this.loadAgentIdentity();
        this.setupEventListeners();
        // Workers don't set up messaging channels — only the primary agent manages channels
        if (!this.isWorker) {
            this.setupChannels();
        }
        this.registerInternalSkills();
    }

    private initializeStorage() {
        const paths = {
            userProfile: this.config.get('userProfilePath'),
            journal: this.config.get('journalPath'),
            learning: this.config.get('learningPath'),
            actionQueue: this.config.get('actionQueuePath'),
            memory: this.config.get('memoryPath'),
            skills: this.config.get('skillsPath')
        };

        for (const [key, filePath] of Object.entries(paths)) {
            if (!filePath) continue;

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info(`Created directory: ${dir}`);
            }

            // Ensure file exists with default content if missing
            if (!fs.existsSync(filePath)) {
                let defaultContent = '';
                if (key === 'agentIdentity') defaultContent = '# .AI.md\nName: OrcBot\nType: Strategic AI Agent\nPersonality: proactive, concise, professional, adaptive\nAutonomyLevel: high\nVersion: 2.0\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n  - think strategically and simulate before complex actions\n  - learn from interactions and adapt approach\n';
                if (key === 'userProfile') defaultContent = '# User Profile\n\nThis file contains information about the user.\n\n## Core Identity\n- Name: Unknown\n- Preferences: None known yet\n';
                if (key === 'journal') defaultContent = '# Agent Journal\nThis file contains self-reflections and activity logs.\n';
                if (key === 'learning') defaultContent = '# Agent Learning Base\nThis file contains structured knowledge on various topics.\n';
                if (key === 'actionQueue') defaultContent = '[]';
                if (key === 'memory') defaultContent = '{"memories":[]}';
                if (key === 'skills') {
                    const localSkillsPath = path.resolve(process.cwd(), 'SKILLS.md');
                    if (fs.existsSync(localSkillsPath)) {
                        defaultContent = fs.readFileSync(localSkillsPath, 'utf-8');
                    } else {
                        defaultContent = '# OrcBot Skills Registry\n\n(Workspace SKILLS.md not found. Populate this file manually.)\n';
                    }
                }

                try {
                    fs.writeFileSync(filePath, defaultContent);
                    logger.info(`Initialized missing data file: ${filePath}`);
                } catch (e) {
                    logger.error(`Failed to initialize ${key} at ${filePath}: ${e}`);
                }
            }
        }
    }

    private shouldUseGoogleComputerUse(): boolean {
        const enabled = !!this.config.get('googleComputerUseEnabled');
        if (!enabled) return false;
        return !!this.config.get('googleApiKey');
    }

    private getGoogleComputerUseModel(): string {
        return this.config.get('googleComputerUseModel') || 'gemini-2.5-computer-use-preview-10-2025';
    }

    public setupChannels() {
        const telegramToken = this.config.get('telegramToken');
        if (telegramToken) {
            this.telegram = new TelegramChannel(telegramToken, this);
            logger.info('Agent: Telegram channel configured');
        }

        const whatsappEnabled = this.config.get('whatsappEnabled');
        if (whatsappEnabled) {
            this.whatsapp = new WhatsAppChannel(this);
            logger.info('Agent: WhatsApp channel configured');
        }

        const discordToken = this.config.get('discordToken');
        if (discordToken) {
            this.discord = new DiscordChannel(discordToken, this);
            logger.info('Agent: Discord channel configured');
        }

        const slackBotToken = this.config.get('slackBotToken');
        if (slackBotToken) {
            const slackAppToken = this.config.get('slackAppToken');
            this.slack = new SlackChannel(slackBotToken, slackAppToken, this);
            logger.info('Agent: Slack channel configured');
        }


        const emailEnabled = this.config.get('emailEnabled') === true;
        if (emailEnabled) {
            this.email = new EmailChannel(this);
            logger.info('Agent: Email channel configured');
        }
    }

    /**
     * Resolve a Telegram chat ID — if the agent passed a name instead of a numeric ID,
     * look up the real ID from recent memory.
     * Returns the numeric ID string, or null if unresolvable.
     */
    private resolveTelegramChatId(input: string): { id: string; resolved: boolean } | null {
        const trimmed = String(input).trim();
        if (/^-?\d+$/.test(trimmed)) {
            return { id: trimmed, resolved: false };
        }
        // Name passed — search memory for the real numeric ID
        const recentMemories = this.memory.searchMemory('short');
        const match = recentMemories.find((m: any) =>
            m.metadata?.source === 'telegram' &&
            (m.metadata?.senderName?.toLowerCase() === trimmed.toLowerCase() ||
                m.content?.toLowerCase().includes(trimmed.toLowerCase()))
        );
        if (match?.metadata?.chatId && /^-?\d+$/.test(String(match.metadata.chatId))) {
            logger.info(`resolveTelegramChatId: Resolved "${trimmed}" → ${match.metadata.chatId}`);
            return { id: String(match.metadata.chatId), resolved: true };
        }
        return null;
    }

    private getSessionScopeMode(): 'main' | 'per-peer' | 'per-channel-peer' {
        const raw = String(this.config.get('sessionScope') || 'per-channel-peer').toLowerCase();
        if (raw === 'main' || raw === 'per-peer' || raw === 'per-channel-peer') {
            return raw;
        }
        return 'per-channel-peer';
    }

    private getIdentityLinks(): Record<string, string> {
        const links = this.config.get('identityLinks');
        if (!links || typeof links !== 'object' || Array.isArray(links)) {
            return {};
        }
        return links as Record<string, string>;
    }

    private resolveIdentityAlias(source: string, candidate: string): string | null {
        const cleanSource = String(source || '').trim().toLowerCase();
        const cleanCandidate = String(candidate || '').trim();
        if (!cleanSource || !cleanCandidate) return null;

        const links = this.getIdentityLinks();
        const directKey = `${cleanSource}:${cleanCandidate}`;
        const linked = links[directKey];
        if (typeof linked === 'string' && linked.trim().length > 0) {
            return linked.trim();
        }
        return null;
    }

    public resolveSessionScopeId(source: string, identifiers: { sourceId?: string; userId?: string; chatId?: string }): string {
        const mode = this.getSessionScopeMode();
        const cleanSource = String(source || '').trim().toLowerCase() || 'unknown';
        const sourceId = String(identifiers?.sourceId ?? identifiers?.chatId ?? '').trim();
        const userId = String(identifiers?.userId ?? '').trim();

        if (mode === 'main') {
            return 'scope:main';
        }

        if (mode === 'per-peer') {
            const linkedUser = userId ? this.resolveIdentityAlias(cleanSource, userId) : null;
            if (linkedUser) return `scope:peer:${linkedUser}`;

            const linkedSource = sourceId ? this.resolveIdentityAlias(cleanSource, sourceId) : null;
            if (linkedSource) return `scope:peer:${linkedSource}`;

            const fallback = userId || sourceId || 'unknown';
            return `scope:peer:${cleanSource}:${fallback}`;
        }

        const peer = sourceId || userId || 'unknown';
        return `scope:channel-peer:${cleanSource}:${peer}`;
    }

    private getBuildWorkspacePath(): string {
        const configured = String(this.config.get('buildWorkspacePath') || '').trim();
        const fallback = path.join(this.config.getDataHome(), 'workspace');
        const target = configured || fallback;
        const resolved = path.resolve(target);
        try {
            if (!fs.existsSync(resolved)) {
                fs.mkdirSync(resolved, { recursive: true });
            }
        } catch (e) {
            logger.debug(`Agent: Failed to ensure build workspace path "${resolved}": ${e}`);
        }
        return resolved;
    }

    private resolveAgentWorkspacePath(targetPath: string): string {
        const raw = String(targetPath || '').trim();
        if (!raw) {
            return this.getBuildWorkspacePath();
        }
        if (path.isAbsolute(raw)) {
            return path.resolve(raw);
        }
        return path.resolve(this.getBuildWorkspacePath(), raw);
    }



    private hasEmailDeliveryConfig(): boolean {
        const smtpHost = String(this.config.get('smtpHost') || '').trim();
        const smtpUser = String(this.config.get('smtpUsername') || '').trim();
        const smtpPass = String(this.config.get('smtpPassword') || '').trim();
        const fromAddress = String(this.config.get('emailAddress') || smtpUser || '').trim();
        return !!(smtpHost && smtpUser && smtpPass && fromAddress);
    }

    private getOrCreateEmailChannel(): EmailChannel | null {
        if (this.email) return this.email;
        if (!this.hasEmailDeliveryConfig()) return null;
        // Allow outbound email skill usage even when inbound polling is disabled.
        this.email = new EmailChannel(this);
        return this.email;
    }

    private isChannelConfigured(channel: 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'email' | 'gateway-chat'): boolean {

        if (channel === 'gateway-chat') return true;
        if (channel === 'telegram') return !!this.config.get('telegramToken') && !!this.telegram;
        if (channel === 'whatsapp') return this.config.get('whatsappEnabled') !== false && !!this.whatsapp;
        if (channel === 'discord') return !!this.config.get('discordToken') && !!this.discord;
        if (channel === 'slack') return !!this.config.get('slackBotToken') && !!this.slack;
        if (channel === 'email') return !!this.getOrCreateEmailChannel();
        return false;
    }

    private evaluateChannelToolPolicy(action: Action, toolName: string): { allowed: boolean; reason?: string } {
        const targetChannel = this.TOOL_CHANNEL_MAP[toolName];
        if (!targetChannel) return { allowed: true };

        if (!this.isChannelConfigured(targetChannel)) {
            return { allowed: false, reason: `Channel '${targetChannel}' is disabled or not configured.` };
        }

        const source = String(action.payload?.source || '').trim();
        const isAdmin = action.payload?.isAdmin !== false;
        const isSourceChannelTask = ['telegram', 'whatsapp', 'discord', 'slack', 'email', 'gateway-chat'].includes(source);
        const isCrossChannelExempt = this.CROSS_CHANNEL_EXEMPT_TOOLS.has(toolName);

        if (!isAdmin && isSourceChannelTask && source !== targetChannel && !isCrossChannelExempt) {
            return { allowed: false, reason: `Cross-channel send blocked. Action source is '${source}' but tool targets '${targetChannel}'.` };
        }

        const isAutonomous = action.lane === 'autonomy' || !!action.payload?.isHeartbeat || source.includes('heartbeat');
        if (isAutonomous) {
            const allowedChannels = Array.isArray(this.config.get('autonomyAllowedChannels'))
                ? this.config.get('autonomyAllowedChannels')
                : [];
            if (!allowedChannels.includes(targetChannel)) {
                return { allowed: false, reason: `Autonomous/channel heartbeat sends to '${targetChannel}' are disabled by config (autonomyAllowedChannels).` };
            }
        }

        return { allowed: true };
    }

    private registerInternalSkills() {
        // ═══════════════════════════════════════════
        // Channel Messaging & Reaction Skills
        // Workers don't have channel connections — skip these.
        // ═══════════════════════════════════════════
        if (!this.isWorker) {

            // Skill: Send Telegram
            this.skills.registerSkill({
                name: 'send_telegram',
                description: 'Send a message to a Telegram user. The chatId MUST be the numeric Telegram ID (e.g. 123456789), NOT the user\'s name.',
                usage: 'send_telegram(chatId, message)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId || args.id;
                    const message = args.message || args.content || args.text;

                    if (!chat_id) return 'Error: Missing chatId. Use the NUMERIC Telegram chat ID from the message metadata (e.g. 123456789), not the user\'s name.';
                    if (!message) return 'Error: Missing message content.';

                    // Validate: Telegram chat IDs are numeric. If the agent passed a name, try to resolve it.
                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) {
                        return `Error: "${chat_id}" is not a valid Telegram chat ID. Telegram IDs are numeric (e.g. 123456789). Check the incoming message metadata for the correct chatId or userId.`;
                    }
                    chat_id = resolved.id;

                    if (this.telegram) {
                        await this.telegram.sendMessage(chat_id, message);

                        // Persist outbound message so future actions can use it as thread context.
                        this.memory.saveMemory({
                            id: `tg-out-${Date.now()}`,
                            type: 'short',
                            content: `Assistant sent Telegram message to ${chat_id}: ${message}`,
                            timestamp: new Date().toISOString(),
                            metadata: {
                                source: 'telegram',
                                role: 'assistant',
                                chatId: chat_id
                            }
                        });
                        return `Message sent to ${chat_id}`;
                    }
                    return 'Telegram channel not available';
                }
            });

            // Skill: Telegram — send message with inline buttons
            this.skills.registerSkill({
                name: 'telegram_send_buttons',
                description: 'Send a Telegram message with inline keyboard buttons. Use this to ask the user to choose an option, confirm an action, or provide navigation. buttons is a 2-D array of rows; each cell has text and an optional callback_data (payload sent back when pressed) or url.',
                usage: 'telegram_send_buttons(chatId, message, buttons)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId || args.id;
                    const message = args.message || args.content || args.text;
                    let buttons = args.buttons;

                    if (!chat_id) return 'Error: Missing chatId.';
                    if (!message) return 'Error: Missing message content.';
                    if (!Array.isArray(buttons) || buttons.length === 0) return 'Error: buttons must be a non-empty 2-D array, e.g. [[{text:"Yes",callback_data:"yes"},{text:"No",callback_data:"no"}]]';

                    // Auto-coerce: if the LLM passed a flat 1-D array of button objects,
                    // wrap each object into its own row so the call still works.
                    // e.g. [{text:"A"},{text:"B"}] → [[{text:"A"},{text:"B"}]]
                    // e.g. [{text:"A",callback_data:"a"}] → [[{text:"A",callback_data:"a"}]]
                    if (buttons.every((item: any) => item && typeof item === 'object' && !Array.isArray(item))) {
                        buttons = [buttons];
                    }

                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) return `Error: "${chat_id}" is not a valid Telegram chat ID.`;
                    chat_id = resolved.id;

                    if (this.telegram) {
                        try {
                            const messageId = await this.telegram.sendWithButtons(chat_id, message, buttons);
                            this.memory.saveMemory({
                                id: `tg-btn-${Date.now()}`,
                                type: 'short',
                                content: `Assistant sent Telegram inline-buttons message to ${chat_id} (message_id=${messageId}): ${message}`,
                                timestamp: new Date().toISOString(),
                                metadata: { source: 'telegram', role: 'assistant', chatId: chat_id, messageId }
                            });
                            return `Message with buttons sent to ${chat_id} (message_id=${messageId})`;
                        } catch (err: any) {
                            const errMsg = String(err?.response?.description || err?.message || err);
                            // Provide specific guidance: if it's a button/markup issue, tell the LLM to simplify.
                            if (/button|keyboard|markup|inline/i.test(errMsg)) {
                                return `Telegram rejected the inline keyboard: ${errMsg}. Try simplifying the buttons — use only {text, callback_data} fields and keep text short (max 40 chars).`;
                            }
                            return `Telegram API error sending buttons to ${chat_id}: ${errMsg}. Try send_telegram instead if buttons are not required.`;
                        }
                    }
                    return 'Telegram channel not available';
                }
            });

            // Skill: Telegram — edit a sent message in-place
            this.skills.registerSkill({
                name: 'telegram_edit_message',
                description: 'Edit the text of a previously-sent Telegram message in-place. Ideal for live progress updates (e.g. "Searching… → Found 5 results") without spamming new messages. Requires the message_id returned by send_telegram or telegram_send_buttons.',
                usage: 'telegram_edit_message(chatId, messageId, newText)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId;
                    const messageId = parseInt(String(args.message_id || args.messageId || args.id), 10);
                    const newText = args.new_text || args.newText || args.text || args.message || args.content;

                    if (!chat_id) return 'Error: Missing chatId.';
                    if (isNaN(messageId)) return 'Error: Missing or invalid messageId (must be a number).';
                    if (!newText) return 'Error: Missing newText.';

                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) return `Error: "${chat_id}" is not a valid Telegram chat ID.`;
                    chat_id = resolved.id;

                    if (this.telegram) {
                        await this.telegram.editMessage(chat_id, messageId, newText);
                        return `Message ${messageId} in chat ${chat_id} updated`;
                    }
                    return 'Telegram channel not available';
                }
            });

            // Skill: Telegram — create a native poll
            this.skills.registerSkill({
                name: 'telegram_send_poll',
                description: 'Create a native Telegram poll in a chat. Great for gathering structured user input. options is an array of 2–10 strings.',
                usage: 'telegram_send_poll(chatId, question, options, isAnonymous?)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId || args.id;
                    const question = args.question;
                    const options = args.options;
                    const isAnonymous = args.is_anonymous ?? args.isAnonymous ?? true;
                    const allowsMultiple = args.allows_multiple_answers ?? args.allowsMultipleAnswers ?? false;

                    if (!chat_id) return 'Error: Missing chatId.';
                    if (!question) return 'Error: Missing question.';
                    if (!Array.isArray(options) || options.length < 2) return 'Error: options must be an array of at least 2 strings.';
                    if (options.length > 10) return 'Error: Telegram polls support at most 10 options.';

                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) return `Error: "${chat_id}" is not a valid Telegram chat ID.`;
                    chat_id = resolved.id;

                    if (this.telegram) {
                        const messageId = await this.telegram.sendPoll(chat_id, question, options, isAnonymous, allowsMultiple);
                        this.memory.saveMemory({
                            id: `tg-poll-${Date.now()}`,
                            type: 'short',
                            content: `Assistant sent Telegram poll to ${chat_id}: "${question}" [${options.join(', ')}]`,
                            timestamp: new Date().toISOString(),
                            metadata: { source: 'telegram', role: 'assistant', chatId: chat_id, messageId }
                        });
                        return `Poll sent to ${chat_id} (message_id=${messageId})`;
                    }
                    return 'Telegram channel not available';
                }
            });

            // Skill: Telegram — react to a message with an emoji
            this.skills.registerSkill({
                name: 'telegram_react',
                description: 'React to a Telegram message with an emoji. NOTE: Telegram restricts bots from setting native reactions in most chat types (private chats, groups). In those cases the bot automatically falls back to *replying* to the target message with the emoji — this is normal and expected, not an error. Native reactions only work in channels where the bot is an admin. Common emojis: 👍 👎 ❤ 🔥 🎉 🤔 👏 😁 🙏 ✅ ❌. messageId must be the numeric ID of the message to react to.',
                usage: 'telegram_react(chatId, messageId, emoji)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId || args.id;
                    const messageId = String(args.message_id || args.messageId);
                    const emoji = args.emoji || args.reaction || '👍';

                    if (!chat_id) return { success: false, error: 'Missing chatId.' };
                    if (!messageId || messageId === 'undefined') return { success: false, error: 'Missing messageId.' };

                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) return { success: false, error: `"${chat_id}" is not a valid Telegram chat ID.` };
                    chat_id = resolved.id;

                    if (this.telegram) {
                        try {
                            const result = await this.telegram.react(chat_id, messageId, emoji);
                            const method = result.method === 'reply'
                                ? 'reply (native reaction unavailable for bots in this chat type)'
                                : 'native reaction';
                            return { success: true, method, emoji, message: `Reacted with ${emoji} via ${method}` };
                        } catch (err: any) {
                            return { success: false, error: String(err?.message || err) };
                        }
                    }
                    return { success: false, error: 'Telegram channel not available' };
                }
            });

            // Skill: Telegram — pin a message
            this.skills.registerSkill({
                name: 'telegram_pin_message',
                description: 'Pin a message in a Telegram chat (bot must be admin in groups/channels). The pinned message appears at the top of the chat for all members.',
                usage: 'telegram_pin_message(chatId, messageId, silent?)',
                handler: async (args: any) => {
                    let chat_id = args.chat_id || args.chatId || args.id;
                    const messageId = parseInt(String(args.message_id || args.messageId), 10);
                    const silent = args.silent ?? true;

                    if (!chat_id) return 'Error: Missing chatId.';
                    if (isNaN(messageId)) return 'Error: Missing or invalid messageId.';

                    const resolved = this.resolveTelegramChatId(String(chat_id));
                    if (!resolved) return `Error: "${chat_id}" is not a valid Telegram chat ID.`;
                    chat_id = resolved.id;

                    if (this.telegram) {
                        await this.telegram.pinMessage(chat_id, messageId, silent);
                        return `Message ${messageId} pinned in chat ${chat_id}`;
                    }
                    return 'Telegram channel not available';
                }
            });

            // Skill: Send WhatsApp
            this.skills.registerSkill({
                name: 'send_whatsapp',
                description: 'Send a message to a WhatsApp contact or group',
                usage: 'send_whatsapp(jid, message)',
                handler: async (args: any) => {
                    const jid = args.jid || args.to || args.id;
                    const message = args.message || args.content || args.text;

                    if (!jid) return 'Error: Missing jid (WhatsApp ID).';
                    if (!message) return 'Error: Missing message content.';

                    if (this.whatsapp) {
                        await this.whatsapp.sendMessage(jid, message);

                        // Persist outbound message so future actions can use it as thread context.
                        this.memory.saveMemory({
                            id: `wa-out-${Date.now()}`,
                            type: 'short',
                            content: `Assistant sent WhatsApp message to ${jid}: ${message}`,
                            timestamp: new Date().toISOString(),
                            metadata: {
                                source: 'whatsapp',
                                role: 'assistant',
                                senderId: jid,
                                sourceId: jid
                            }
                        });
                        return `Message sent to ${jid} via WhatsApp`;
                    }
                    return 'WhatsApp channel not available';
                }
            });

            // Skill: Send Discord
            this.skills.registerSkill({
                name: 'send_discord',
                description: 'Send a message to a Discord channel',
                usage: 'send_discord(channel_id, message)',
                handler: async (args: any) => {
                    const channel_id = args.channel_id || args.channelId || args.id || args.to;
                    const message = args.message || args.content || args.text;

                    if (!channel_id) return 'Error: Missing channel_id. Use the Discord channel ID.';
                    if (!message) return 'Error: Missing message content.';

                    if (this.discord) {
                        await this.discord.sendMessage(channel_id, message);

                        // Persist outbound message so future actions can use it as thread context.
                        this.memory.saveMemory({
                            id: `discord-out-${Date.now()}`,
                            type: 'short',
                            content: `Assistant sent Discord message to channel ${channel_id}: ${message}`,
                            timestamp: new Date().toISOString(),
                            metadata: {
                                source: 'discord',
                                role: 'assistant',
                                channelId: channel_id,
                                sourceId: channel_id
                            }
                        });
                        return `Message sent to Discord channel ${channel_id}`;
                    }
                    return 'Discord channel not available';
                }
            });

            // Skill: Send Email
            this.skills.registerSkill({
                name: 'send_email',
                description: 'Send an email via configured SMTP account',
                usage: 'send_email(to, subject, message, inReplyTo?, references?) (Note: inReplyTo should be the Message-ID of the email you are responding to for threading)',
                handler: async (args: any) => {
                    const to = args.to || args.email || args.recipient;
                    const subject = args.subject || this.config.get('emailDefaultSubject') || 'OrcBot response';
                    const message = args.message || args.content || args.text || args.body;
                    const inReplyTo = args.inReplyTo;
                    const references = args.references;

                    if (!to) return 'Error: Missing recipient email address (to).';
                    if (!message) return 'Error: Missing message content.';
                    const emailChannel = this.getOrCreateEmailChannel();
                    if (!emailChannel) return 'Email channel not available. Configure SMTP first.';

                    await emailChannel.sendEmail(String(to), String(subject), String(message), inReplyTo, references);

                    this.memory.saveMemory({
                        id: `email-out-${Date.now()}`,
                        type: 'short',
                        content: `Assistant sent email to ${to} with subject "${subject}"`,
                        timestamp: new Date().toISOString(),
                        metadata: {
                            source: 'email',
                            role: 'assistant',
                            sourceId: String(to),
                            subject: String(subject),
                            inReplyTo,
                            references
                        }
                    });

                    return `Email sent to ${to}`;
                }
            });

            // Skill: Search Emails
            this.skills.registerSkill({
                name: 'search_emails',
                description: 'Search for and read emails from the inbox. Useful for checking if a specific email arrived or reading recent history.',
                usage: 'search_emails(params: { sender?: string, subject?: string, daysAgo?: number, unreadOnly?: boolean, limit?: number })',
                handler: async (args: any) => {
                    const emailChannel = this.getOrCreateEmailChannel();
                    if (!emailChannel) return 'Email channel not available. Configure IMAP first.';

                    try {
                        const emails = await emailChannel.searchEmails({
                            sender: args.sender,
                            subject: args.subject,
                            daysAgo: args.daysAgo ? Number(args.daysAgo) : undefined,
                            unreadOnly: args.unreadOnly === true || args.unreadOnly === 'true',
                            limit: args.limit ? Number(args.limit) : 5
                        });

                        if (!emails || emails.length === 0) {
                            return 'No emails matching your search were found.';
                        }

                        let result = `Found ${emails.length} matching emails:\n\n`;
                        for (const email of emails) {
                            result += `--- EMAIL (UID: ${email.uid}) ---\n`;
                            result += `From: ${email.from}\n`;
                            result += `Subject: ${email.subject}\n`;
                            result += `Preview: ${email.text.slice(0, 800)}${email.text.length > 800 ? '...' : ''}\n\n`;
                        }
                        return result;
                    } catch (err: any) {
                        return `Error searching emails: ${err.message}`;
                    }
                }
            });

            // Skill: Send Slack
            this.skills.registerSkill({
                name: 'send_slack',
                description: 'Send a message to a Slack channel or DM',
                usage: 'send_slack(channel_id, message)',
                handler: async (args: any) => {
                    const channel_id = args.channel_id || args.channelId || args.to || args.id;
                    const message = args.message || args.content || args.text;

                    if (!channel_id) return 'Error: Missing channel_id.';
                    if (!message) return 'Error: Missing message content.';

                    if (this.slack) {
                        await this.slack.sendMessage(channel_id, message);

                        this.memory.saveMemory({
                            id: `slack-out-${Date.now()}`,
                            type: 'short',
                            content: `Assistant sent Slack message to ${channel_id}: ${message}`,
                            timestamp: new Date().toISOString(),
                            metadata: {
                                source: 'slack',
                                role: 'assistant',
                                channelId: channel_id
                            }
                        });
                        return `Message sent to Slack channel ${channel_id}`;
                    }
                    return 'Slack channel not available';
                }
            });

            // Skill: Send Slack File
            this.skills.registerSkill({
                name: 'send_slack_file',
                description: 'Send a file to a Slack channel or DM',
                usage: 'send_slack_file(channel_id, file_path, caption?)',
                handler: async (args: any) => {
                    const channel_id = args.channel_id || args.channelId || args.to || args.id;
                    const file_path = args.file_path || args.filePath || args.path;
                    const caption = args.caption || args.message;

                    if (!channel_id) return 'Error: Missing channel_id.';
                    if (!file_path) return 'Error: Missing file_path.';
                    if (!this.slack) return 'Slack channel not available';

                    await this.slack.sendFile(channel_id, file_path, caption);
                    return `File sent to Slack channel ${channel_id}`;
                }
            });

            // Skill: Send Discord File
            this.skills.registerSkill({
                name: 'send_discord_file',
                description: 'Send a file to a Discord channel with optional caption',
                usage: 'send_discord_file(channel_id, file_path, caption?)',
                handler: async (args: any) => {
                    const channel_id = args.channel_id || args.channelId || args.id || args.to;
                    const file_path = args.file_path || args.filePath || args.path;
                    const caption = args.caption || args.message;

                    if (!channel_id) return 'Error: Missing channel_id.';
                    if (!file_path) return 'Error: Missing file_path.';

                    if (this.discord) {
                        await this.discord.sendFile(channel_id, file_path, caption);
                        return `File sent to Discord channel ${channel_id}`;
                    }
                    return 'Discord channel not available';
                }
            });

            // Skill: Send Gateway Chat
            this.skills.registerSkill({
                name: 'send_gateway_chat',
                description: 'Send a message to the Gateway Chat interface',
                usage: 'send_gateway_chat(message)',
                handler: async (args: any) => {
                    const message = args.message || args.content || args.text;

                    if (!message) return 'Error: Missing message content.';

                    // Save assistant message to memory with proper metadata
                    const messageId = `gateway-chat-response-${Date.now()}`;
                    this.memory.saveMemory({
                        id: messageId,
                        type: 'short',
                        content: message,
                        timestamp: new Date().toISOString(),
                        metadata: { source: 'gateway-chat', role: 'assistant' }
                    });

                    // Broadcast via event bus so GatewayServer can forward to WebSocket clients
                    eventBus.emit('gateway:chat:response', {
                        type: 'chat:message',
                        role: 'assistant',
                        content: message,
                        format: hasMarkdown(message) ? 'markdown' : 'text',
                        timestamp: new Date().toISOString(),
                        messageId
                    });

                    return `Message sent to Gateway Chat`;
                }
            });

            // ═══════════════════════════════════════════
            // Reaction Skills (unified across channels)
            // ═══════════════════════════════════════════

            // Skill: React to a message (auto-detect channel)
            this.skills.registerSkill({
                name: 'react',
                description: 'React to a message with an emoji. Auto-detects the channel from context. Supports semantic names ("thumbs_up", "love", "fire", "laugh", "check", "eyes", "thinking") or raw emoji ("👍", "❤️"). The message_id comes from the incoming message metadata.',
                usage: 'react(message_id, emoji, channel?, chat_id?)',
                handler: async (args: any) => {
                    let messageId = args.message_id || args.messageId || args.id;
                    const emojiInput = args.emoji || args.reaction || args.text || 'thumbs_up';
                    let channel = (args.channel || args.source || '').toLowerCase();
                    let chatId = args.chat_id || args.chatId || args.jid || args.to;

                    const isTemplateId = (raw: any) => /\{\{[^}]+\}\}|\[\[[^\]]+\]\]/.test(String(raw || ''));
                    const resolveFallbackMessageId = (sourceHint?: string, chatHint?: string): string | null => {
                        const recent = this.memory.searchMemory('short').slice().reverse();
                        const found = recent.find((m: any) => {
                            const md = m.metadata || {};
                            if (!md.messageId) return false;
                            if (sourceHint && md.source !== sourceHint) return false;
                            if (chatHint && String(md.chatId || md.sourceId || '') !== String(chatHint)) return false;
                            return true;
                        });
                        return found?.metadata?.messageId ? String(found.metadata.messageId) : null;
                    };

                    if (!messageId || isTemplateId(messageId)) {
                        const fallback = resolveFallbackMessageId(channel || undefined, chatId ? String(chatId) : undefined)
                            || resolveFallbackMessageId(channel || undefined)
                            || resolveFallbackMessageId();
                        if (fallback) {
                            logger.warn(`react: Replaced invalid message_id "${messageId}" with fallback "${fallback}" from recent context`);
                            messageId = fallback;
                        }
                    }

                    if (!messageId) return 'Error: Missing message_id. Use the messageId from the incoming message metadata.';
                    if (isTemplateId(messageId)) return 'Error: Invalid message_id template (e.g., {{message.id}}). Use the real numeric/alphanumeric messageId from metadata.';

                    const emoji = resolveEmoji(emojiInput);

                    // Auto-detect channel from action context if not specified
                    if (!channel || !chatId) {
                        const recentMemories = this.memory.searchMemory('short');
                        // Support composite "chatId_msgId" formats - extract the message part for matching
                        const msgIdStr = String(messageId);
                        const plainMsgId = msgIdStr.includes('_') ? msgIdStr.split('_').pop() : msgIdStr;
                        const matchingMemory = recentMemories.find((m: any) =>
                            m.metadata?.messageId === messageId ||
                            m.metadata?.messageId?.toString() === messageId ||
                            m.metadata?.messageId?.toString() === plainMsgId
                        );
                        if (matchingMemory?.metadata) {
                            if (!channel) channel = detectChannelFromMetadata(matchingMemory.metadata);
                            if (!chatId) chatId = matchingMemory.metadata.chatId || matchingMemory.metadata.channelId || matchingMemory.metadata.sourceId;
                        }
                        // If chatId still missing but messageId is composite, extract chatId from it
                        if (!chatId && msgIdStr.includes('_')) {
                            chatId = msgIdStr.split('_')[0];
                        }
                    }

                    if (!channel) return 'Error: Could not detect channel. Specify channel (telegram/whatsapp/discord/slack) explicitly.';
                    if (!chatId) return 'Error: Could not detect chat_id. Specify it explicitly.';

                    try {
                        if (channel === 'telegram' && this.telegram) {
                            await this.telegram.react(chatId, messageId, emoji);
                        } else if (channel === 'whatsapp' && this.whatsapp) {
                            await this.whatsapp.react(chatId, messageId, emoji);
                        } else if (channel === 'discord' && this.discord) {
                            await this.discord.react(chatId, messageId, emoji);
                        } else if (channel === 'slack' && this.slack) {
                            await this.slack.react(chatId, messageId, emoji);
                        } else {
                            return `Error: Channel "${channel}" not available or not recognized.`;
                        }
                        return `Reacted with ${emoji} to message ${messageId} on ${channel}`;
                    } catch (e) {
                        return `Error reacting: ${e}`;
                    }
                }
            });

            // Skill: React Telegram
            this.skills.registerSkill({
                name: 'react_telegram',
                description: 'React to a Telegram message with an emoji. Use semantic names ("thumbs_up", "love", "fire") or raw emoji.',
                usage: 'react_telegram(chat_id, message_id, emoji)',
                handler: async (args: any) => {
                    let chatId = args.chat_id || args.chatId || args.to;
                    let messageId = args.message_id || args.messageId || args.id;
                    const emojiInput = args.emoji || args.reaction || 'thumbs_up';

                    const isTemplateId = (raw: any) => /\{\{[^}]+\}\}|\[\[[^\]]+\]\]/.test(String(raw || ''));
                    const resolveFallbackTelegramMessageId = (chatHint?: string): string | null => {
                        const recent = this.memory.searchMemory('short').slice().reverse();
                        const found = recent.find((m: any) => {
                            const md = m.metadata || {};
                            if (md.source !== 'telegram') return false;
                            if (!md.messageId) return false;
                            if (chatHint && String(md.chatId || md.sourceId || '') !== String(chatHint)) return false;
                            return true;
                        });
                        return found?.metadata?.messageId ? String(found.metadata.messageId) : null;
                    };

                    if (!chatId) return 'Error: Missing chat_id (numeric Telegram ID).';
                    if (!messageId) return 'Error: Missing message_id.';

                    // Resolve name → numeric ID if needed
                    const resolved = this.resolveTelegramChatId(String(chatId));
                    if (!resolved) {
                        return `Error: "${chatId}" is not a valid Telegram chat ID. Use the numeric ID from message metadata.`;
                    }
                    chatId = resolved.id;

                    if (isTemplateId(messageId)) {
                        const fallback = resolveFallbackTelegramMessageId(String(chatId)) || resolveFallbackTelegramMessageId();
                        if (fallback) {
                            logger.warn(`react_telegram: Replaced invalid message_id "${messageId}" with fallback "${fallback}" from recent telegram context`);
                            messageId = fallback;
                        }
                    }

                    if (isTemplateId(messageId)) {
                        return 'Error: Invalid Telegram message_id template (e.g., {{message.id}}). Use the actual numeric messageId from metadata.';
                    }

                    if (!this.telegram) return 'Telegram channel not available';

                    const emoji = resolveEmoji(emojiInput);
                    try {
                        await this.telegram.react(chatId, messageId, emoji);
                        return `Reacted with ${emoji} to Telegram message ${messageId}`;
                    } catch (e) {
                        return `Error: ${e}`;
                    }
                }
            });

            // Skill: React WhatsApp
            this.skills.registerSkill({
                name: 'react_whatsapp',
                description: 'React to a WhatsApp message with an emoji. Use semantic names ("thumbs_up", "love", "fire") or raw emoji.',
                usage: 'react_whatsapp(jid, message_id, emoji)',
                handler: async (args: any) => {
                    const jid = args.jid || args.to || args.chat_id;
                    const messageId = args.message_id || args.messageId || args.id;
                    const emojiInput = args.emoji || args.reaction || 'thumbs_up';

                    if (!jid) return 'Error: Missing jid (WhatsApp ID).';
                    if (!messageId) return 'Error: Missing message_id.';

                    if (!this.whatsapp) return 'WhatsApp channel not available';

                    const emoji = resolveEmoji(emojiInput);
                    try {
                        await this.whatsapp.react(jid, messageId, emoji);
                        return `Reacted with ${emoji} to WhatsApp message ${messageId}`;
                    } catch (e) {
                        return `Error: ${e}`;
                    }
                }
            });

            // Skill: React Discord
            this.skills.registerSkill({
                name: 'react_discord',
                description: 'React to a Discord message with an emoji. Use semantic names ("thumbs_up", "love", "fire") or raw emoji.',
                usage: 'react_discord(channel_id, message_id, emoji)',
                handler: async (args: any) => {
                    const channelId = args.channel_id || args.channelId || args.to;
                    const messageId = args.message_id || args.messageId || args.id;
                    const emojiInput = args.emoji || args.reaction || 'thumbs_up';

                    if (!channelId) return 'Error: Missing channel_id.';
                    if (!messageId) return 'Error: Missing message_id.';

                    if (!this.discord) return 'Discord channel not available';

                    const emoji = resolveEmoji(emojiInput);
                    try {
                        await this.discord.react(channelId, messageId, emoji);
                        return `Reacted with ${emoji} to Discord message ${messageId}`;
                    } catch (e) {
                        return `Error: ${e}`;
                    }
                }
            });

            // Skill: React Slack
            this.skills.registerSkill({
                name: 'react_slack',
                description: 'React to a Slack message with an emoji. message_id should be the Slack message timestamp.',
                usage: 'react_slack(channel_id, message_id, emoji)',
                handler: async (args: any) => {
                    const channelId = args.channel_id || args.channelId || args.to;
                    const messageId = args.message_id || args.messageId || args.id;
                    const emojiInput = args.emoji || args.reaction || 'thumbs_up';

                    if (!channelId) return 'Error: Missing channel_id.';
                    if (!messageId) return 'Error: Missing message_id (Slack timestamp).';
                    if (!this.slack) return 'Slack channel not available';

                    const emoji = resolveEmoji(emojiInput);
                    try {
                        await this.slack.react(channelId, messageId, emoji);
                        return `Reacted with ${emoji} to Slack message ${messageId}`;
                    } catch (e) {
                        return `Error: ${e}`;
                    }
                }
            });

            // Skill: Get Discord Guilds
            this.skills.registerSkill({
                name: 'get_discord_guilds',
                description: 'Get list of Discord servers (guilds) the bot is in',
                usage: 'get_discord_guilds()',
                handler: async (args: any) => {
                    if (this.discord) {
                        const guilds = await this.discord.getGuilds();
                        if (guilds.length === 0) {
                            return 'Bot is not in any Discord servers';
                        }
                        return `Discord servers (${guilds.length}):\n` +
                            guilds.map(g => `- ${g.name} (ID: ${g.id})`).join('\n');
                    }
                    return 'Discord channel not available';
                }
            });

            // Skill: Get Discord Channels
            this.skills.registerSkill({
                name: 'get_discord_channels',
                description: 'Get list of text channels in a Discord server',
                usage: 'get_discord_channels(guild_id)',
                handler: async (args: any) => {
                    const guild_id = args.guild_id || args.guildId || args.server_id;

                    if (!guild_id) return 'Error: Missing guild_id (server ID).';

                    if (this.discord) {
                        const channels = await this.discord.getTextChannels(guild_id);
                        if (channels.length === 0) {
                            return `No text channels found in server ${guild_id}`;
                        }
                        return `Text channels in server ${guild_id} (${channels.length}):\n` +
                            channels.map(c => `- #${c.name} (ID: ${c.id})`).join('\n');
                    }
                    return 'Discord channel not available';
                }
            });

        } // end !isWorker channel skills guard

        // Skill: Download File
        this.skills.registerSkill({
            name: 'download_file',
            description: 'Download a file from the web to the agent\'s local storage.',
            usage: 'download_file(url, filename?)',
            handler: async (args: any) => {
                const url = args.url;
                if (!url) return 'Error: Missing url.';

                // Max 50 MB download cap to prevent runaway memory allocation
                const MAX_BYTES = 50 * 1024 * 1024;
                const TIMEOUT_MS = 60_000;

                // Content-Type → default extension map
                const MIME_EXT: Record<string, string> = {
                    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
                    'image/webp': '.webp', 'image/svg+xml': '.svg',
                    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
                    'video/mp4': '.mp4', 'video/webm': '.webm',
                    'application/pdf': '.pdf', 'application/zip': '.zip',
                    'application/json': '.json', 'text/plain': '.txt',
                    'text/html': '.html', 'text/csv': '.csv',
                };

                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

                    const response = await fetch(url, { signal: controller.signal });
                    clearTimeout(timer);

                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                    // Enforce size cap via Content-Length if provided
                    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
                    if (contentLength > MAX_BYTES) {
                        throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)} MB (max 50 MB)`);
                    }

                    // Stream into a buffer and enforce byte cap
                    const chunks: Uint8Array[] = [];
                    let totalBytes = 0;
                    const reader = response.body?.getReader();
                    if (!reader) {
                        const buf = await response.arrayBuffer();
                        if (buf.byteLength > MAX_BYTES) throw new Error(`File too large (> 50 MB)`);
                        chunks.push(new Uint8Array(buf));
                        totalBytes = buf.byteLength;
                    } else {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            totalBytes += value.byteLength;
                            if (totalBytes > MAX_BYTES) throw new Error(`File exceeds 50 MB limit, aborting download`);
                            chunks.push(value);
                        }
                    }

                    // Determine filename: explicit arg > URL path > content-type ext
                    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
                    const urlBasename = path.basename(new URL(url).pathname);
                    const mimeExt = MIME_EXT[contentType] || '';
                    let filename = args.filename
                        || (urlBasename && urlBasename !== '/' ? urlBasename : '')
                        || `file_${Date.now()}${mimeExt}`;

                    // If the detected basename has no extension but we know one, append it
                    if (!path.extname(filename) && mimeExt) filename += mimeExt;

                    const downloadsDir = path.join(this.config.getDataHome(), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                    const filePath = path.join(downloadsDir, filename);
                    const combined = Buffer.concat(chunks.map(c => Buffer.from(c)));
                    fs.writeFileSync(filePath, combined);

                    return `File downloaded successfully to: ${filePath} (${(totalBytes / 1024).toFixed(1)} KB)`;
                } catch (e: any) {
                    if (e.name === 'AbortError') return `Error: Download timed out after ${TIMEOUT_MS / 1000}s`;
                    return `Error downloading file: ${e.message || e}`;
                }
            }
        });

        // Skill: Send File
        this.skills.registerSkill({
            name: 'send_file',
            description: 'Send a file (image, document, audio) to a contact. Supports WhatsApp, Telegram, Discord, and Gateway Chat. Set "channel" to "discord", "telegram", "whatsapp", or "gateway-chat" to override auto-detection. For gateway-chat, jid can be any value (e.g. "gateway-web").',
            usage: 'send_file(jid, path, caption?, channel?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const filePath = args.path || args.file_path;
                const caption = args.caption || '';
                const explicitChannel = args.channel || args.via;

                if (!jid) return 'Error: Missing jid.';
                if (!filePath) return 'Error: Missing file path.';

                try {
                    // Resolve channel: explicit arg > action source > JID pattern
                    const currentAction = this.actionQueue.getQueue().find(a => a.id === this.currentActionId);
                    const actionSource = currentAction?.payload?.source;
                    const channelHint = explicitChannel || actionSource;

                    // Gateway Chat: encode file as base64 and broadcast via event bus
                    if (channelHint === 'gateway-chat') {
                        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
                        if (!fs.existsSync(resolvedPath)) return `Error: File not found: ${resolvedPath}`;
                        const fileBuffer = fs.readFileSync(resolvedPath);
                        const base64Data = fileBuffer.toString('base64');
                        const ext = path.extname(resolvedPath).toLowerCase().replace('.', '');
                        const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4', mp3: 'audio/mpeg' };
                        const mimeType = mimeMap[ext] || 'application/octet-stream';
                        const messageId = `gateway-file-${Date.now()}`;
                        this.memory.saveMemory({
                            id: messageId,
                            type: 'short',
                            content: caption ? `[Image sent: ${path.basename(resolvedPath)}] ${caption}` : `[Image sent: ${path.basename(resolvedPath)}]`,
                            timestamp: new Date().toISOString(),
                            metadata: { source: 'gateway-chat', role: 'assistant', fileType: mimeType }
                        });
                        eventBus.emit('gateway:chat:file', {
                            type: 'chat:file',
                            role: 'assistant',
                            fileName: path.basename(resolvedPath),
                            fileType: mimeType,
                            data: base64Data,
                            caption,
                            timestamp: new Date().toISOString(),
                            messageId
                        });
                        return `File ${path.basename(resolvedPath)} sent to Gateway Chat`;
                    }

                    const isWhatsApp = channelHint === 'whatsapp' || jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    const isDiscord = channelHint === 'discord' || (!isWhatsApp && /^\d{15,20}$/.test(String(jid)));
                    const isTelegram = channelHint === 'telegram' || (!isWhatsApp && !isDiscord);

                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via WhatsApp to ${jid}`;
                    } else if (isDiscord && this.discord) {
                        await this.discord.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Discord to ${jid}`;
                    } else if (isTelegram && this.telegram) {
                        await this.telegram.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Telegram to ${jid}`;
                    }
                    // Last-resort fallback: try any available channel
                    if (this.discord) {
                        await this.discord.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Discord to ${jid}`;
                    } else if (this.telegram) {
                        await this.telegram.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Telegram to ${jid}`;
                    }
                    return 'No channel available to send file. Is WhatsApp/Telegram/Discord connected?';
                } catch (e) {
                    return `Error sending file: ${e}`;
                }
            }
        });

        // Skill: Write File (cross-platform)
        this.skills.registerSkill({
            name: 'write_file',
            description: 'Write content to a file. Creates parent directories if needed. Use this instead of echo/run_command for creating files.',
            usage: 'write_file(path, content, append?)',
            handler: async (args: any) => {
                const filePath = args.path || args.file_path || args.file;
                const content = args.content || args.text || args.data || '';
                const append = args.append === true || args.append === 'true';

                if (!filePath) return 'Error: Missing file path.';

                // Prevent accidentally writing enormous blobs into context-sized chunks
                const MAX_WRITE_BYTES = 10 * 1024 * 1024; // 10 MB
                if (Buffer.byteLength(String(content), 'utf8') > MAX_WRITE_BYTES) {
                    return `Error: Content too large (> 10 MB). Split the write into smaller chunks.`;
                }

                try {
                    const resolvedPath = this.resolveAgentWorkspacePath(String(filePath));
                    const dir = path.dirname(resolvedPath);

                    // Create parent directories if needed
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    if (append) {
                        fs.appendFileSync(resolvedPath, content);
                        return `Content appended to ${resolvedPath}`;
                    } else {
                        fs.writeFileSync(resolvedPath, content);
                        return `File created: ${resolvedPath}`;
                    }
                } catch (e) {
                    return `Error writing file: ${e}`;
                }
            }
        });

        // Skill: Create Directory (cross-platform)
        this.skills.registerSkill({
            name: 'create_directory',
            description: 'Create a directory (and parent directories if needed). Does not error if directory already exists.',
            usage: 'create_directory(path)',
            handler: async (args: any) => {
                const dirPath = args.path || args.dir || args.directory;

                if (!dirPath) return 'Error: Missing directory path.';

                try {
                    const resolvedPath = this.resolveAgentWorkspacePath(String(dirPath));

                    if (fs.existsSync(resolvedPath)) {
                        return `Directory already exists: ${resolvedPath}`;
                    }

                    fs.mkdirSync(resolvedPath, { recursive: true });
                    return `Directory created: ${resolvedPath}`;
                } catch (e) {
                    return `Error creating directory: ${e}`;
                }
            }
        });

        // Skill: Read File
        this.skills.registerSkill({
            name: 'read_file',
            description: 'Read the contents of a file. Supports optional line range (start_line, end_line) for large files. Returns up to 20 000 chars; use start_line/end_line to page through bigger files.',
            usage: 'read_file(path, start_line?, end_line?)',
            handler: async (args: any) => {
                const filePath = args.path || args.file_path || args.file;

                if (!filePath) return 'Error: Missing file path.';

                try {
                    const resolvedPath = this.resolveAgentWorkspacePath(String(filePath));

                    if (!fs.existsSync(resolvedPath)) {
                        return `Error: File not found: ${resolvedPath}`;
                    }

                    const content = fs.readFileSync(resolvedPath, 'utf8');

                    // Line-range slicing (1-based, inclusive)
                    const startLine = args.start_line ? Math.max(1, parseInt(args.start_line, 10)) : undefined;
                    const endLine = args.end_line ? Math.max(1, parseInt(args.end_line, 10)) : undefined;

                    let result = content;
                    let rangeNote = '';
                    if (startLine !== undefined || endLine !== undefined) {
                        const lines = content.split('\n');
                        const from = (startLine ?? 1) - 1;
                        const to = endLine ?? lines.length;
                        result = lines.slice(from, to).join('\n');
                        rangeNote = ` (lines ${from + 1}–${Math.min(to, lines.length)} of ${lines.length})`;
                    }

                    const MAX_CHARS = 20_000;
                    if (result.length > MAX_CHARS) {
                        const totalLines = result.split('\n').length;
                        return result.substring(0, MAX_CHARS) + `\n\n[...truncated${rangeNote}. ${result.length} chars total. Use start_line/end_line to read specific sections.]`;
                    }
                    return rangeNote ? `[${resolvedPath}${rangeNote}]\n${result}` : result;
                } catch (e) {
                    return `Error reading file: ${e}`;
                }
            }
        });

        // Skill: List Directory
        this.skills.registerSkill({
            name: 'list_directory',
            description: 'List files and subdirectories in a directory.',
            usage: 'list_directory(path)',
            handler: async (args: any) => {
                const dirPath = args.path || args.dir || args.directory || this.getBuildWorkspacePath();

                try {
                    const resolvedPath = this.resolveAgentWorkspacePath(String(dirPath));

                    if (!fs.existsSync(resolvedPath)) {
                        return `Error: Directory not found: ${resolvedPath}`;
                    }

                    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
                    const formatted = entries.map(e => {
                        const indicator = e.isDirectory() ? '📁' : '📄';
                        return `${indicator} ${e.name}`;
                    }).join('\n');

                    return `Contents of ${resolvedPath}:\n${formatted || '(empty directory)'}`;
                } catch (e) {
                    return `Error listing directory: ${e}`;
                }
            }
        });

        // Skill: Analyze Media
        this.skills.registerSkill({
            name: 'analyze_media',
            description: 'Use AI to analyze an image, audio, or document file. Provide the path and what you want to know.',
            usage: 'analyze_media(path, prompt?)',
            handler: async (args: any) => {
                const filePath = args.path || args.file_path;
                const prompt = args.prompt || 'Describe the content of this file.';

                if (!filePath) return 'Error: Missing path.';
                if (!fs.existsSync(filePath)) return `Error: File not found at ${filePath}`;

                try {
                    return await this.llm.analyzeMedia(filePath, prompt);
                } catch (e) {
                    return `Error analyzing media: ${e}`;
                }
            }
        });

        // Skill: Text-to-Speech
        this.skills.registerSkill({
            name: 'text_to_speech',
            description: 'Convert text to an audio file using AI voice synthesis. Returns the file path of the generated audio. Available voices:  achernar, achird, algenib, algieba, alnilam, aoede, autonoe, callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi.',
            usage: 'text_to_speech(text, voice?, speed?)',
            handler: async (args: any) => {
                const text = args.text || args.message || args.content;
                const voice = args.voice || 'nova';
                const speed = parseFloat(args.speed) || 1.0;

                if (!text) return 'Error: Missing text to convert to speech.';
                if (text.length > 4096) return 'Error: Text too long for TTS (max 4096 chars). Shorten the text.';

                try {
                    const downloadsDir = path.join(this.config.getDataHome(), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
                    const requestedOutputPath = path.join(downloadsDir, `tts_${Date.now()}.ogg`);

                    const generatedAudioPath = await this.llm.textToSpeech(text, requestedOutputPath, voice, speed);
                    return `Audio generated successfully: ${generatedAudioPath} (voice: ${voice}, ${text.length} chars)`;
                } catch (e) {
                    return `Error generating speech: ${e}`;
                }
            }
        });

        // Skill: Send Voice Note (compound: TTS + send as voice message)
        this.skills.registerSkill({
            name: 'send_voice_note',
            description: 'Convert text to speech and send it as a voice note/voice message to a contact. The message will appear as a playable voice bubble (not a file attachment). Available voices: alloy, echo, fable, onyx, nova, shimmer.',
            usage: 'send_voice_note(jid, text, voice?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const text = args.text || args.message || args.content;
                const voice = args.voice || 'nova';

                if (!jid) return 'Error: Missing jid (recipient identifier).';
                if (!text) return 'Error: Missing text to convert to voice.';
                if (text.length > 4096) return 'Error: Text too long for TTS (max 4096 chars). Shorten the text.';

                try {
                    // Generate the audio
                    const downloadsDir = path.join(this.config.getDataHome(), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
                    const requestedAudioPath = path.join(downloadsDir, `voice_${Date.now()}.ogg`);
                    const audioPath = await this.llm.textToSpeech(text, requestedAudioPath, voice);

                    // Send as voice note through the appropriate channel
                    // Resolve channel: explicit arg > action source > JID pattern
                    const currentAction = this.actionQueue.getQueue().find(a => a.id === this.currentActionId);
                    const actionSource = currentAction?.payload?.source;
                    const explicitChannel = args.channel || args.via;
                    const channelHint = explicitChannel || actionSource;
                    const isWhatsApp = channelHint === 'whatsapp' || jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    const isDiscord = channelHint === 'discord' || (!isWhatsApp && /^\d{15,20}$/.test(String(jid)));
                    const isTelegram = channelHint === 'telegram' || (!isWhatsApp && !isDiscord);

                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendVoiceNote(jid, audioPath);
                        return `Voice note sent via WhatsApp to ${jid} (voice: ${voice}, ${text.length} chars)`;
                    } else if (isDiscord && this.discord) {
                        // Discord has no native voice-note concept; send as audio file attachment
                        await this.discord.sendFile(jid, audioPath, `🎙️ Voice message (${text.length} chars)`);
                        return `Voice note sent via Discord to ${jid} as audio file (voice: ${voice}, ${text.length} chars)`;
                    } else if (isTelegram && this.telegram) {
                        await this.telegram.sendVoiceNote(jid, audioPath);
                        return `Voice note sent via Telegram to ${jid} (voice: ${voice}, ${text.length} chars)`;
                    }
                    return 'No channel available to send voice note. Is WhatsApp/Telegram/Discord connected?';
                } catch (e) {
                    return `Error sending voice note: ${e}`;
                }
            }
        });

        // Skill: Generate Image
        this.skills.registerSkill({
            name: 'generate_image',
            description: 'Generate an image from a text prompt using AI (DALL·E, GPT Image, or Gemini). Returns the file path of the generated image. IMPORTANT: Prefer send_image() instead — it generates AND sends in one step. Only use generate_image if you need the file without sending it.',
            usage: 'generate_image(prompt, size?, quality?)',
            handler: async (args: any) => {
                const prompt = args.prompt || args.text || args.description;
                const size = args.size || this.config.get('imageGenSize') || '1024x1024';
                const quality = args.quality || this.config.get('imageGenQuality') || 'medium';

                if (!prompt) return 'Error: Missing prompt for image generation.';

                try {
                    const downloadsDir = path.join(this.config.getDataHome(), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
                    const outputPath = path.join(downloadsDir, `image_${Date.now()}.png`);

                    const provider = this.config.get('imageGenProvider') || undefined;
                    const model = this.config.get('imageGenModel') || undefined;

                    const result = await this.llm.generateImage(prompt, outputPath, {
                        provider,
                        model,
                        size,
                        quality,
                    });

                    if (result.success && result.filePath) {
                        const fileName = path.basename(result.filePath);
                        let response = `Image generated successfully: ${result.filePath} (${fileName})`;
                        if (result.revisedPrompt) {
                            response += `\nRevised prompt: ${result.revisedPrompt.substring(0, 200)}`;
                        }
                        response += '\n[SYSTEM: Image already generated. Do NOT call generate_image again. Use send_file() to deliver, or send_image() next time for auto-delivery.]';
                        return response;
                    } else {
                        return `Error generating image: ${result.error || 'Unknown error'}`;
                    }
                } catch (e) {
                    return `Error generating image: ${e}`;
                }
            }
        });

        // Skill: Send Image (compound: generate + send in one step — preferred over generate_image)
        this.skills.registerSkill({
            name: 'send_image',
            description: 'Generate an AI image from a text prompt and immediately send it to a contact. This is the PREFERRED way to deliver generated images — it generates and sends in one step, preventing duplicates. Use this instead of generate_image + send_file. IMPORTANT: set "channel" to the correct platform (discord/telegram/whatsapp/slack/gateway-chat). For gateway-chat, set jid to "gateway-web".',
            usage: 'send_image(jid, prompt, channel?, size?, quality?, caption?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const prompt = args.prompt || args.text || args.description;
                const caption = args.caption || '';
                const size = args.size || this.config.get('imageGenSize') || '1024x1024';
                const quality = args.quality || this.config.get('imageGenQuality') || 'medium';
                const explicitChannel = args.channel || args.via; // 'discord', 'telegram', 'whatsapp'

                if (!jid) return 'Error: Missing jid (recipient identifier).';
                if (!prompt) return 'Error: Missing prompt for image generation.';

                let generatedFilePath = '';
                try {
                    // Generate the image
                    const downloadsDir = path.join(this.config.getDataHome(), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
                    const outputPath = path.join(downloadsDir, `image_${Date.now()}.png`);

                    const provider = this.config.get('imageGenProvider') || undefined;
                    const model = this.config.get('imageGenModel') || undefined;

                    const result = await this.llm.generateImage(prompt, outputPath, {
                        provider,
                        model,
                        size,
                        quality,
                    });

                    if (!result.success || !result.filePath) {
                        return `Error generating image: ${result.error || 'Unknown error'}`;
                    }
                    generatedFilePath = result.filePath;

                    // Determine target channel: action source > explicit parameter > JID pattern detection > fallback
                    // The action's source (which channel the user messaged from) is the most reliable signal.
                    const currentAction = this.actionQueue.getQueue().find(a => a.id === this.currentActionId);
                    const actionSource = currentAction?.payload?.source; // 'discord', 'telegram', 'whatsapp'
                    const imgCaption = caption || (result.revisedPrompt ? result.revisedPrompt.substring(0, 200) : '');
                    const channelHint = explicitChannel || actionSource;
                    const isWhatsApp = channelHint === 'whatsapp' || jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    // Discord snowflake IDs: purely numeric, 17-20 digits
                    const isDiscord = channelHint === 'discord' || (!isWhatsApp && /^\d{15,20}$/.test(String(jid)));
                    const isTelegram = channelHint === 'telegram' || (!isWhatsApp && !isDiscord);

                    // Gateway Chat: encode and broadcast via event bus
                    if (channelHint === 'gateway-chat') {
                        const fileBuffer = fs.readFileSync(result.filePath);
                        const base64Data = fileBuffer.toString('base64');
                        const messageId = `gateway-file-${Date.now()}`;
                        this.memory.saveMemory({
                            id: messageId,
                            type: 'short',
                            content: imgCaption ? `[Image sent: ${path.basename(result.filePath)}] ${imgCaption}` : `[Image sent: ${path.basename(result.filePath)}]`,
                            timestamp: new Date().toISOString(),
                            metadata: { source: 'gateway-chat', role: 'assistant', fileType: 'image/png' }
                        });
                        eventBus.emit('gateway:chat:file', {
                            type: 'chat:file',
                            role: 'assistant',
                            fileName: path.basename(result.filePath),
                            fileType: 'image/png',
                            data: base64Data,
                            caption: imgCaption,
                            timestamp: new Date().toISOString(),
                            messageId
                        });
                        return `Image generated and sent to Gateway Chat (${path.basename(result.filePath)})`;
                    }

                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendFile(jid, result.filePath, imgCaption);
                        return `Image generated and sent via WhatsApp to ${jid} (${path.basename(result.filePath)})`;
                    } else if (isDiscord && this.discord) {
                        await this.discord.sendFile(jid, result.filePath, imgCaption);
                        return `Image generated and sent via Discord to ${jid} (${path.basename(result.filePath)})`;
                    } else if (isTelegram && this.telegram) {
                        await this.telegram.sendFile(jid, result.filePath, imgCaption);
                        return `Image generated and sent via Telegram to ${jid} (${path.basename(result.filePath)})`;
                    }
                    // Fallback: try any available channel
                    if (this.discord) {
                        await this.discord.sendFile(jid, result.filePath, imgCaption);
                        return `Image generated and sent via Discord to ${jid} (${path.basename(result.filePath)})`;
                    } else if (this.telegram) {
                        await this.telegram.sendFile(jid, result.filePath, imgCaption);
                        return `Image generated and sent via Telegram to ${jid} (${path.basename(result.filePath)})`;
                    }
                    return `Image generated at ${result.filePath} but no channel available to send. Use send_file() manually.`;
                } catch (e) {
                    // If the image was generated but the SEND failed, return structured partial success
                    // so the tracking code knows an image exists and the LLM can deliver it via the correct skill
                    if (generatedFilePath) {
                        return {
                            success: false, error: `Send failed: ${e}`, imageGenerated: true, filePath: generatedFilePath,
                            hint: `Image was generated at ${generatedFilePath}. Use send_discord_file, send_file, or the correct channel skill to deliver it.`
                        };
                    }
                    return `Error generating/sending image: ${e}`;
                }
            }
        });

        // Skill: Post WhatsApp Status
        this.skills.registerSkill({
            name: 'post_whatsapp_status',
            description: 'Post a text update to your WhatsApp status (Stories)',
            usage: 'post_whatsapp_status(text)',
            handler: async (args: any) => {
                const text = args.text || args.message || args.content;
                if (!text) return 'Error: Missing text content.';

                if (this.whatsapp) {
                    try {
                        await this.whatsapp.postStatus(text);
                        return 'WhatsApp status update posted successfully';
                    } catch (e) {
                        return `Error posting WhatsApp status: ${e}`;
                    }
                }
                return 'WhatsApp channel not available';
            }
        });

        this.skills.registerSkill({
            name: 'list_available_models',
            description: 'List models available based on configured API keys and current settings.',
            usage: 'list_available_models()',
            handler: async () => {
                return this.llm.getModelAvailabilitySummary();
            }
        });

        this.skills.registerSkill({
            name: 'switch_model',
            description: 'Switch active LLM model/provider to one that has configured credentials. Optionally set provider-specific fallback models.',
            usage: 'switch_model(model, provider?, fallback_model?, fallback_provider?)',
            handler: async (args: any) => {
                const model = String(args.model || args.modelName || '').trim();
                const provider = String(args.provider || args.llmProvider || '').trim();
                const fallbackModel = String(args.fallback_model || args.fallbackModel || '').trim();
                const fallbackProvider = String(args.fallback_provider || args.fallbackProvider || '').trim();

                if (!model) return 'Error: Missing model.';

                if (provider) this.config.set('llmProvider', provider as any);
                this.config.set('modelName', model);

                if (fallbackModel) {
                    const activeProvider = (provider || this.llm.inferProvider(model)) as any;
                    const key = fallbackProvider || activeProvider;
                    const existing = this.config.get('fallbackModelNames') || {};
                    this.config.set('fallbackModelNames', { ...existing, [key]: fallbackModel });
                }

                this.llm.setModel(model);
                return `Model switched to ${model}${provider ? ` (provider: ${provider})` : ''}${fallbackModel ? `; fallback ${fallbackProvider || this.llm.inferProvider(model)} => ${fallbackModel}` : ''}.`;
            }
        });

        // Skill: React to WhatsApp Message
        this.skills.registerSkill({
            name: 'react_whatsapp',
            description: 'React to a specific WhatsApp message with an emoji',
            usage: 'react_whatsapp(jid, message_id, emoji)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const messageId = args.message_id || args.messageId || args.id;
                const emoji = args.emoji || args.reaction || '✅';

                if (!jid) return 'Error: Missing jid.';
                if (!messageId) return 'Error: Missing message_id. You must get this from the message context.';

                if (this.whatsapp) {
                    await this.whatsapp.react(jid, messageId, emoji);
                    return `Reacted with ${emoji} to message ${messageId}`;
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Reply to WhatsApp Status
        this.skills.registerSkill({
            name: 'reply_whatsapp_status',
            description: 'Reply to a contact\'s WhatsApp status update. This sends the message as a proper status reply, visible inside the status thread — NOT as a standalone DM. Use this when reacting to a status someone posted.',
            usage: 'reply_whatsapp_status(jid, message)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const message = args.message || args.content || args.text;

                if (!jid) return 'Error: Missing jid.';
                if (!message) return 'Error: Missing message content.';

                if (this.whatsapp) {
                    // Use sendStatusReply which correctly targets the status thread
                    // rather than opening a new DM conversation
                    await this.whatsapp.sendStatusReply(jid, message);
                    return `Replied to ${jid}'s status successfully.`;
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Update Contact Profile
        this.skills.registerSkill({
            name: 'update_contact_profile',
            description: 'Update the autonomous profile/memory of a specific WhatsApp contact. Use this to store traits, facts, and relationship context.',
            usage: 'update_contact_profile(jid, profile_json)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const profileJson = args.profile_json || args.profile || args.content;

                if (!jid) return 'Error: Missing jid.';
                if (!profileJson) return 'Error: Missing profile_json.';

                try {
                    // Validate JSON if it's a string, or just save it
                    const data = typeof profileJson === 'string' ? profileJson : JSON.stringify(profileJson, null, 2);
                    this.memory.saveContactProfile(jid, data);
                    return `Profile for ${jid} updated successfully.`;
                } catch (e) {
                    return `Error updating profile: ${e}`;
                }
            }
        });

        // Skill: Get Contact Profile
        this.skills.registerSkill({
            name: 'get_contact_profile',
            description: 'Retrieve the stored profile/context for a specific WhatsApp contact.',
            usage: 'get_contact_profile(jid)',
            handler: async (args: any) => {
                const jid = args.jid || args.to || args.id;

                if (!jid) return 'Error: Missing jid.';

                try {
                    const profile = this.memory.getContactProfile(jid);
                    if (!profile) {
                        return `No profile found for ${jid}. You can create one using 'update_contact_profile'.`;
                    }
                    return `Profile for ${jid}:\n${profile}`;
                } catch (e) {
                    return `Error retrieving profile: ${e}`;
                }
            }
        });

        // Skill: List WhatsApp Contacts
        this.skills.registerSkill({
            name: 'list_whatsapp_contacts',
            description: 'List recent WhatsApp contacts that have interacted with the bot. Returns contact JIDs from recent memory.',
            usage: 'list_whatsapp_contacts(limit?)',
            handler: async (args: any) => {
                const limit = parseInt(args.limit || '20', 10);

                try {
                    // Get recent WhatsApp messages from memory
                    const memories = this.memory.searchMemory('short');
                    const whatsappMessages = memories.filter((m: any) =>
                        m.metadata?.source === 'whatsapp' &&
                        m.metadata?.senderId &&
                        m.metadata?.senderId !== 'status@broadcast'
                    );

                    // Extract unique contacts with their last interaction
                    const contactMap = new Map<string, { jid: string; name: string; lastMessage: string; timestamp: string }>();

                    for (const msg of whatsappMessages) {
                        const jid = msg.metadata.senderId;
                        const name = msg.metadata.senderName || jid;
                        if (!contactMap.has(jid)) {
                            contactMap.set(jid, {
                                jid,
                                name,
                                lastMessage: msg.content.substring(0, 100),
                                timestamp: msg.timestamp
                            });
                        }
                    }

                    const contacts = Array.from(contactMap.values())
                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                        .slice(0, limit);

                    if (contacts.length === 0) {
                        return 'No recent WhatsApp contacts found in memory.';
                    }

                    const formatted = contacts.map((c, i) =>
                        `${i + 1}. ${c.name} (${c.jid})\n   Last: ${c.lastMessage.substring(0, 60)}...\n   Time: ${c.timestamp}`
                    ).join('\n\n');

                    return `Recent WhatsApp Contacts (${contacts.length}):\n\n${formatted}`;
                } catch (e) {
                    return `Error listing contacts: ${e}`;
                }
            }
        });

        // Skill: Search WhatsApp Contacts
        this.skills.registerSkill({
            name: 'search_whatsapp_contacts',
            description: 'Search the entire synced WhatsApp phonebook for a contact by name to find their JID.',
            usage: 'search_whatsapp_contacts(query)',
            handler: async (args: any) => {
                const query = args.query || args.name || args.search;

                if (!query) return 'Error: Missing query.';

                if (this.whatsapp) {
                    try {
                        const results = this.whatsapp.searchContacts(query);
                        if (results.length === 0) {
                            return `No contacts found matching "${query}".`;
                        }

                        const formatted = results.map((c, i) =>
                            `${i + 1}. ${c.name} (${c.jid})`
                        ).join('\n');

                        return `Found ${results.length} contacts matching "${query}":\n\n${formatted}`;
                    } catch (e) {
                        return `Error searching contacts: ${e}`;
                    }
                }
                return 'WhatsApp channel not available';
            }
        });

        // Skill: Search Chat History
        this.skills.registerSkill({
            name: 'search_chat_history',
            description: 'Search chat history with a specific contact. Supports semantic search (meaning-based) when vector memory is enabled, falling back to keyword/recency search. Works across WhatsApp, Telegram, and Discord.',
            usage: 'search_chat_history(jid, query?, limit?, source?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to || args.id;
                const query = args.query || args.search || args.q || '';
                const limit = parseInt(args.limit || '10', 10);
                const source = args.source || 'whatsapp'; // Default to whatsapp for backward compat

                if (!jid) return 'Error: Missing jid/contact identifier.';

                try {
                    // Semantic search path: use vector memory for meaning-based retrieval
                    if (query && this.memory.vectorMemory?.isEnabled()) {
                        const semanticHits = await this.memory.semanticSearch(query, limit * 2, { source });
                        const contactHits = semanticHits.filter((h: any) => {
                            const md = h.metadata || {};
                            return md.senderId === jid || md.sourceId === jid || md.chatId === jid;
                        }).slice(0, limit);

                        if (contactHits.length > 0) {
                            const formatted = contactHits.map((m: any, i: number) =>
                                `[${m.timestamp}] (relevance: ${(m.score * 100).toFixed(0)}%) ${m.content}`
                            ).join('\n\n');
                            return `Chat history with ${jid} (${contactHits.length} results, semantic search):\n\n${formatted}`;
                        }
                    }

                    // Fallback: keyword/recency search
                    const memories = this.memory.searchMemory('short');
                    let chatHistory = memories.filter((m: any) =>
                        m.metadata?.source === source &&
                        (m.metadata?.senderId === jid || m.metadata?.sourceId === jid || m.metadata?.chatId === jid)
                    );

                    // Apply keyword filter if query provided
                    if (query) {
                        const queryLower = query.toLowerCase();
                        chatHistory = chatHistory.filter((m: any) =>
                            (m.content || '').toLowerCase().includes(queryLower)
                        );
                    }

                    chatHistory = chatHistory.slice(-limit).reverse();

                    if (chatHistory.length === 0) {
                        return `No chat history found for ${jid}${query ? ` matching "${query}"` : ''}.`;
                    }

                    const formatted = chatHistory.map((m: any, i: number) =>
                        `[${m.timestamp}] ${m.content}`
                    ).join('\n\n');

                    return `Chat history with ${jid} (${chatHistory.length} messages):\n\n${formatted}`;
                } catch (e) {
                    return `Error searching chat history: ${e}`;
                }
            }
        });

        // Skill: Get WhatsApp Chat Context
        this.skills.registerSkill({
            name: 'get_whatsapp_context',
            description: 'Get comprehensive context about a WhatsApp contact including their profile, recent chat history, and relationship notes.',
            usage: 'get_whatsapp_context(jid)',
            handler: async (args: any) => {
                const jid = args.jid || args.to || args.id;

                if (!jid) return 'Error: Missing jid.';

                try {
                    // Get profile
                    const profile = this.memory.getContactProfile(jid);

                    // Get recent chat history
                    const memories = this.memory.searchMemory('short');
                    const chatHistory = memories
                        .filter((m: any) =>
                            m.metadata?.source === 'whatsapp' &&
                            m.metadata?.senderId === jid
                        )
                        .slice(-5);

                    let context = `=== WhatsApp Context for ${jid} ===\n\n`;

                    if (profile) {
                        context += `📋 PROFILE:\n${profile}\n\n`;
                    } else {
                        context += `📋 PROFILE: No profile stored yet.\n\n`;
                    }

                    if (chatHistory.length > 0) {
                        context += `💬 RECENT MESSAGES (${chatHistory.length}):\n`;
                        chatHistory.forEach((m: any) => {
                            context += `[${m.timestamp}] ${m.content}\n`;
                        });
                    } else {
                        context += `💬 RECENT MESSAGES: No recent messages found.\n`;
                    }

                    return context;
                } catch (e) {
                    return `Error getting context: ${e}`;
                }
            }
        });

        // Skill: Recall Memory (Semantic Search)
        this.skills.registerSkill({
            name: 'recall_memory',
            description: 'Search your entire memory semantically — finds relevant memories across ALL channels, time periods, and memory types (short, episodic, long-term). Use this when you need to remember something from a past conversation, find context about a topic, or recall what happened with a specific person/project. Much more powerful than keyword search.',
            usage: 'recall_memory(query, limit?)',
            handler: async (args: any) => {
                const query = args.query || args.search || args.text || args.q;
                const limit = parseInt(args.limit || '10', 10);

                if (!query) return 'Error: Missing query. Provide a natural language description of what you want to recall.';

                try {
                    // Try semantic search first (best quality)
                    if (this.memory.vectorMemory?.isEnabled()) {
                        const results = await this.memory.semanticRecall(query, limit);
                        if (results.length > 0) {
                            const formatted = results.map((r, i) => {
                                const src = r.metadata?.source ? ` [${r.metadata.source}]` : '';
                                const type = r.type || 'unknown';
                                return `${i + 1}. [${r.timestamp}] (${type}${src}, relevance: ${(r.score * 100).toFixed(0)}%) ${r.content}`;
                            }).join('\n\n');
                            return `Found ${results.length} relevant memories:\n\n${formatted}`;
                        }
                    }

                    // Fallback: keyword search across all memory types
                    const queryLower = query.toLowerCase();
                    const allMemories = [
                        ...this.memory.searchMemory('short'),
                        ...this.memory.searchMemory('episodic'),
                    ];
                    const matches = allMemories
                        .filter(m => (m.content || '').toLowerCase().includes(queryLower))
                        .sort((a, b) => {
                            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                            return tb - ta;
                        })
                        .slice(0, limit);

                    if (matches.length === 0) {
                        return `No memories found matching "${query}". The search covers all conversations and past actions.`;
                    }

                    const formatted = matches.map((m, i) => {
                        const src = m.metadata?.source ? ` [${m.metadata.source}]` : '';
                        return `${i + 1}. [${m.timestamp}] (${m.type}${src}) ${m.content}`;
                    }).join('\n\n');
                    return `Found ${matches.length} memories (keyword match):\n\n${formatted}`;
                } catch (e) {
                    return `Error recalling memory: ${e}`;
                }
            }
        });

        // Skill: Run Shell Command
        this.skills.registerSkill({
            name: 'run_command',
            description: 'Execute a shell command on the server. On Windows, commands run in PowerShell — use PowerShell syntax (Get-ChildItem, Get-Command, Start-MpScan, etc.), NOT cmd.exe syntax (dir, where, etc.). For file creation, use write_file skill. To run commands in a specific directory, pass cwd parameter. For long-running commands, tune timeoutMs/retries and timeoutBackoffFactor to adapt to slower environments.',
            usage: 'run_command(command, cwd?, timeoutMs?, retries?, timeoutBackoffFactor?, maxTimeoutMs?)',
            handler: async (args: any) => {
                let command = args.command || args.cmd || args.text;
                if (!command) return 'Error: Missing command string.';

                // Log the command being executed
                logger.info(`run_command: Executing command: ${command}`);

                const isWindows = process.platform === 'win32';
                const trimmedCmd = String(command).trim();

                // Detect problematic Unix-style commands on Windows
                if (isWindows) {
                    // Check for Unix-style multiline echo
                    if (trimmedCmd.includes("echo '") && trimmedCmd.includes("\n")) {
                        return `Error: Multiline echo commands don't work on Windows. Use the create_custom_skill to write files, or use PowerShell's Set-Content/Out-File, or write files one line at a time.`;
                    }
                }

                // Smart handling for "cd <path> ; <command>" or "cd <path> && <command>" patterns
                // Extract the directory and convert to use cwd parameter instead
                // Note: Only handles cd at the start of command. Multi-command chains like
                // "git status && cd /path && git pull" are not supported.
                let workingDir = args.cwd
                    ? this.resolveAgentWorkspacePath(String(args.cwd))
                    : this.config.get('commandWorkingDir')
                        ? this.resolveAgentWorkspacePath(String(this.config.get('commandWorkingDir')))
                        : this.getBuildWorkspacePath();
                let actualCommand = command;

                // Only attempt pattern extraction if explicit cwd is not already provided
                if (!args.cwd) {
                    // Match patterns like: "cd /path/to/dir ; command" or "cd C:\path ; command"
                    // Supports paths with or without quotes
                    const cdPattern = /^\s*cd\s+([^\s;&]+|'[^']+'|"[^"]+"|`[^`]+`)\s*[;&]+\s*(.+)$/i;
                    const cdMatch = trimmedCmd.match(cdPattern);

                    if (cdMatch) {
                        let targetDir = cdMatch[1].trim();
                        const remainingCmd = cdMatch[2].trim();

                        // Remove surrounding quotes if present
                        if ((targetDir.startsWith('"') && targetDir.endsWith('"')) ||
                            (targetDir.startsWith("'") && targetDir.endsWith("'")) ||
                            (targetDir.startsWith('`') && targetDir.endsWith('`'))) {
                            targetDir = targetDir.slice(1, -1);
                        }

                        // Basic path validation to prevent directory traversal attacks
                        // Resolve to absolute path and check for suspicious patterns
                        const resolvedPath = path.resolve(workingDir, targetDir);

                        // Warn if path contains excessive parent directory references
                        // Note: This is a heuristic check; the command will still execute
                        // but administrators are alerted to review potentially suspicious activity
                        const parentDirCount = (targetDir.match(/\.\./g) || []).length;
                        if (parentDirCount > 2) {
                            logger.warn(`run_command: Suspicious path with ${parentDirCount} parent directory references: ${targetDir}`);
                        }

                        // Use the extracted directory as cwd and run only the remaining command
                        workingDir = resolvedPath;
                        actualCommand = remainingCmd;

                        logger.debug(`run_command: Detected directory change pattern. cwd="${workingDir}", actualCommand="${actualCommand}"`);
                    }
                }

                const firstToken = actualCommand.trim().split(/\s+/)[0]?.toLowerCase() || '';
                const allowList = (this.config.get('commandAllowList') || []) as string[];
                const denyList = (this.config.get('commandDenyList') || []) as string[];
                const safeMode = this.config.get('safeMode');
                const sudoMode = this.config.get('sudoMode');

                if (safeMode) {
                    return 'Error: Safe mode is enabled. run_command is disabled.';
                }

                if (!sudoMode) {
                    if (denyList.map(s => s.toLowerCase()).includes(firstToken)) {
                        return `Error: Command '${firstToken}' is blocked by commandDenyList.`;
                    }

                    if (allowList.length > 0 && !allowList.map(s => s.toLowerCase()).includes(firstToken)) {
                        return `Error: Command '${firstToken}' is not in commandAllowList.`;
                    }
                }

                const baseTimeoutMs = parseInt(args.timeoutMs || args.timeout || this.config.get('commandTimeoutMs') || 120000, 10);
                const retries = parseInt(args.retries || this.config.get('commandRetries') || 1, 10);
                const timeoutBackoffFactor = Number(args.timeoutBackoffFactor || this.config.get('commandTimeoutBackoffFactor') || 1.5);
                const maxTimeoutMs = parseInt(args.maxTimeoutMs || this.config.get('commandMaxTimeoutMs') || 600000, 10);

                const { exec } = require('child_process');

                const runOnce = (attemptTimeoutMs: number) => new Promise<string>((resolve) => {
                    const execOptions: any = { cwd: workingDir };
                    // On Windows, use PowerShell as the shell so PowerShell cmdlets work.
                    // Do NOT pass the `timeout` option here on Windows — it relies on SIGKILL
                    // which doesn't work cross-platform.  We handle timeout manually below.
                    if (process.platform === 'win32') {
                        execOptions.shell = 'powershell.exe';
                    }
                    const child = exec(actualCommand, execOptions, (error: any, stdout: string, stderr: string) => {
                        clearTimeout(killTimer);
                        if (error) {
                            if (error.killed || timedOut) {
                                resolve(`Error: Command timed out after ${Math.round(attemptTimeoutMs / 1000)} seconds.`);
                                return;
                            }
                            resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                            return;
                        }
                        let out = stdout || stderr || 'Command executed successfully (no output)';
                        // Cap output to prevent context flooding
                        const MAX_OUT = 8_000;
                        if (out.length > MAX_OUT) {
                            out = out.substring(0, MAX_OUT) + `\n\n[...truncated — ${out.length} chars total. Pipe to a file or use tail/head to get a smaller slice.]`;
                        }
                        resolve(out);
                    });

                    let timedOut = false;
                    const killTimer = setTimeout(() => {
                        timedOut = true;
                        if (process.platform === 'win32' && child.pid) {
                            // On Windows exec() with PowerShell doesn't propagate SIGKILL to the
                            // child tree.  Use taskkill /F /T to forcefully kill the whole tree.
                            require('child_process').exec(`taskkill /PID ${child.pid} /T /F`, () => { });
                        } else {
                            child.kill('SIGKILL');
                        }
                    }, attemptTimeoutMs);

                    child.on('error', (err: any) => {
                        clearTimeout(killTimer);
                        resolve(`Error: Failed to start command: ${err?.message || err}`);
                    });
                });

                let attempt = 0;
                let lastResult = '';
                while (attempt <= retries) {
                    const attemptTimeoutMs = Math.min(
                        maxTimeoutMs,
                        Math.max(1000, Math.round(baseTimeoutMs * Math.pow(Math.max(timeoutBackoffFactor, 1), attempt)))
                    );
                    lastResult = await runOnce(attemptTimeoutMs);
                    if (!lastResult.startsWith('Error:')) return lastResult;
                    attempt++;
                    if (attempt <= retries) {
                        logger.warn(`run_command retry ${attempt}/${retries} (timeout=${attemptTimeoutMs}ms) after error: ${lastResult}`);
                    }
                }

                return lastResult;
            }
        });

        // Skill: Start Interactive Shell Session
        this.skills.registerSkill({
            name: 'shell_start',
            description: 'Spawn a long-running or interactive shell command in the background as a named session. Returns immediately — the process runs asynchronously. Use shell_read to see output later. Ideal for dev servers, build watchers, or any non-terminating command. On Windows uses PowerShell.',
            usage: 'shell_start(id, command, cwd?)',
            handler: async (args: any) => {
                const id = args.id || args.name;
                const command = args.command || args.cmd;
                const cwd = args.cwd
                    ? this.resolveAgentWorkspacePath(String(args.cwd))
                    : this.getBuildWorkspacePath();

                if (!id) return 'Error: Missing session id.';
                if (!command) return 'Error: Missing command.';
                if (this.config.get('safeMode')) return 'Error: Safe mode is enabled. shell_start is disabled.';

                try {
                    const session = shellSessions.start(String(id), String(command), cwd);
                    // Give it 500ms to surface any immediate launch errors
                    await new Promise(r => setTimeout(r, 500));
                    const info = session.info();
                    const preview = session.read(5).join('\n');
                    return `Session "${id}" started (PID=${info.pid}, status=${info.status}).${preview ? `\n\nFirst output:\n${preview}` : '\n(No output yet — use shell_read to check later)'}`;
                } catch (e) {
                    return `Error starting session "${id}": ${e}`;
                }
            }
        });

        // Skill: Read Shell Session Output
        this.skills.registerSkill({
            name: 'shell_read',
            description: 'Read the latest output (stdout + stderr) from a running shell session. Returns the last N lines from the ring buffer.',
            usage: 'shell_read(id, lines?)',
            handler: async (args: any) => {
                const id = args.id || args.name;
                const lines = parseInt(args.lines || args.count || '50', 10);

                if (!id) return 'Error: Missing session id.';

                const session = shellSessions.get(String(id));
                if (!session) return `Error: No session found with id "${id}". Use shell_list to see active sessions.`;

                const output = session.read(lines);
                const info = session.info();
                const header = `Session "${id}" [status=${info.status}, pid=${info.pid ?? 'N/A'}, lines_buffered=${info.lineCount}]`;
                return output.length > 0
                    ? `${header}\n\n${output.join('\n')}`
                    : `${header}\n\n(No output yet)`;
            }
        });

        // Skill: Send Input to Shell Session
        this.skills.registerSkill({
            name: 'shell_send',
            description: 'Send a line of text to the stdin of a running shell session. Useful for answering prompts, sending commands to a REPL, or restarting a watcher.',
            usage: 'shell_send(id, input)',
            handler: async (args: any) => {
                const id = args.id || args.name;
                const input = args.input || args.text || args.command;

                if (!id) return 'Error: Missing session id.';
                if (input === undefined || input === null) return 'Error: Missing input text.';

                const session = shellSessions.get(String(id));
                if (!session) return `Error: No session found with id "${id}".`;

                try {
                    session.send(String(input));
                    return `Sent to "${id}": ${String(input).trim()}`;
                } catch (e) {
                    return `Error sending to session "${id}": ${e}`;
                }
            }
        });

        // Skill: Stop Shell Session
        this.skills.registerSkill({
            name: 'shell_stop',
            description: 'Kill a running shell session by ID. Sends SIGTERM to the process. Use this to stop dev servers, build watchers, or any long-running session started with shell_start.',
            usage: 'shell_stop(id)',
            handler: async (args: any) => {
                const id = args.id || args.name;
                if (!id) return 'Error: Missing session id.';

                try {
                    shellSessions.stop(String(id));
                    return `Session "${id}" stopped.`;
                } catch (e) {
                    return `Error stopping session "${id}": ${e}`;
                }
            }
        });

        // Skill: List Shell Sessions
        this.skills.registerSkill({
            name: 'shell_list',
            description: 'List all shell sessions (running and recently exited) with their status, PID, and output line count.',
            usage: 'shell_list()',
            handler: async (_args: any) => {
                const sessions = shellSessions.list();
                if (sessions.length === 0) return 'No shell sessions active.';

                const lines = sessions.map(s =>
                    `• [${s.status.toUpperCase()}] id="${s.id}" pid=${s.pid ?? 'N/A'} lines=${s.lineCount} cmd="${s.command.substring(0, 60)}" started=${s.startedAt}`
                );
                return `Active sessions (${sessions.length}):\n\n${lines.join('\n')}`;
            }
        });

        // Skill: OrcBot App Control (admin-gated)
        this.skills.registerSkill({
            name: 'orcbot_control',
            description: 'Control OrcBot at the application level using a safe, RBAC-gated interface. Supports listing command capabilities, mapping TUI actions to CLI, and running allowlisted `orcbot` CLI commands. High-risk commands are blocked by policy unless explicitly allowed in config.',
            usage: 'orcbot_control(action, command?, includeExperimental?) where action is one of: help | list_commands | tui_map | run_cli',
            handler: async (args: any) => {
                const action = String(args?.action || args?.mode || 'help').toLowerCase().trim();

                const commandCatalog = [
                    'config get <key>',
                    'config set <key> <value>',
                    'models',
                    'gateway',
                    'security',
                    'agentic-user'
                ];

                const tuiMap = [
                    'TUI: ⚙️ Agent Configuration -> CLI: orcbot config set|get ...',
                    'TUI: 🤖 Model & Providers -> CLI: orcbot models',
                    'TUI: 🌐 Gateway Control -> CLI: orcbot gateway',
                    'TUI: 🔒 Security & Permissions -> CLI: orcbot security',
                    'TUI: 🧠 Agentic User -> CLI: orcbot agentic-user'
                ];

                if (action === 'help' || action === 'list_commands') {
                    const allow = (this.config.get('orcbotControlCliAllowList') || []) as string[];
                    const deny = (this.config.get('orcbotControlCliDenyList') || []) as string[];
                    return [
                        'ORCBOT APP CONTROL',
                        'Available actions: help | list_commands | tui_map | run_cli',
                        '',
                        'Command awareness (safe defaults):',
                        ...commandCatalog.map(c => `- ${c}`),
                        '',
                        `Policy allow-list: ${allow.length ? allow.join(', ') : '(none configured)'}`,
                        `Policy deny-list: ${deny.length ? deny.join(', ') : '(none configured)'}`,
                        '',
                        'Example:',
                        'orcbot_control({ action: "run_cli", command: "orcbot config get modelName" })'
                    ].join('\n');
                }

                if (action === 'tui_map') {
                    return ['TUI TO CLI MAP', ...tuiMap].join('\n');
                }

                if (action !== 'run_cli') {
                    return 'Error: Unknown action. Use one of: help, list_commands, tui_map, run_cli.';
                }

                const enabled = this.config.get('orcbotControlEnabled');
                if (enabled === false) {
                    return 'Error: orcbot_control is disabled by config (orcbotControlEnabled=false).';
                }

                let command = String(args?.command || '').trim();
                if (!command) {
                    return 'Error: Missing command. Example: "orcbot config get modelName"';
                }

                command = command.replace(/^orcbot\s+/i, '').trim();

                // Lightweight typo correction for common misspelling
                if (/^rset(\s|$)/i.test(command)) {
                    command = command.replace(/^rset/i, 'reset');
                }

                // Block shell metacharacters and multiline payloads
                if (/\r|\n/.test(command) || /[;&|><`]/.test(command)) {
                    return 'Error: Unsafe command format. Provide a single orcbot CLI command without shell chaining/redirection.';
                }

                const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
                const allowList = ((this.config.get('orcbotControlCliAllowList') || []) as string[])
                    .map(s => String(s).toLowerCase().trim())
                    .filter(Boolean);
                const denyList = ((this.config.get('orcbotControlCliDenyList') || []) as string[])
                    .map(s => String(s).toLowerCase().trim())
                    .filter(Boolean);

                const matchesPrefix = (prefixes: string[], value: string) => {
                    return prefixes.some(prefix => value === prefix || value.startsWith(prefix + ' '));
                };

                if (matchesPrefix(denyList, normalized)) {
                    return `Error: Command '${command}' is blocked by orcbotControlCliDenyList.`;
                }

                if (allowList.length > 0 && !matchesPrefix(allowList, normalized)) {
                    return `Error: Command '${command}' is not in orcbotControlCliAllowList.`;
                }

                const timeoutMs = Math.max(5000, Number(this.config.get('orcbotControlTimeoutMs') || 45000));
                const cliEntry = path.join(process.cwd(), 'dist', 'cli', 'index.js');
                if (!fs.existsSync(cliEntry)) {
                    return `Error: CLI entry not found at ${cliEntry}. Build first with 'npm run build'.`;
                }

                const { exec } = require('child_process');
                return await new Promise<string>((resolve) => {
                    const child = exec(`node "${cliEntry}" ${command}`, { cwd: process.cwd(), timeout: timeoutMs }, (error: any, stdout: string, stderr: string) => {
                        const output = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
                        if (error) {
                            const msg = output || error.message || String(error);
                            resolve(`Error running orcbot CLI command '${command}': ${msg.slice(0, 3500)}`);
                            return;
                        }
                        resolve(output ? output.slice(0, 3500) : `Command succeeded: orcbot ${command}`);
                    });

                    child.on('error', (err: any) => {
                        resolve(`Error: Failed to start orcbot CLI command '${command}': ${err?.message || err}`);
                    });
                });
            }
        });

        // Skill: Get System Info
        this.skills.registerSkill({
            name: 'get_system_info',
            description: 'Get comprehensive system information including OS, platform, shell, and command syntax guidance',
            usage: 'get_system_info()',
            handler: async () => {
                const os = require('os');
                const isWindows = process.platform === 'win32';
                const isMac = process.platform === 'darwin';
                const isLinux = process.platform === 'linux';

                const platformName = isWindows ? 'Windows' : isMac ? 'macOS' : isLinux ? 'Linux' : process.platform;
                const shell = isWindows ? 'PowerShell' : 'Bash/Zsh';

                const commandGuidance = isWindows ? `
📋 WINDOWS COMMAND GUIDANCE (PowerShell):
- Commands run in PowerShell, NOT cmd.exe
- Use PowerShell cmdlets: Get-ChildItem (not dir), Get-Command (not where), Test-Path (not if exist)
- For virus scans: Start-MpScan -ScanType QuickScan
- Use semicolon (;) to chain commands
- For file creation: Use 'write_file' skill instead of echo
- For directories: Use 'create_directory' skill instead of mkdir
- Path separator: Use \\ or / (both work in PowerShell)
- Environment vars: $env:VAR_NAME`
                    : `
📋 UNIX COMMAND GUIDANCE:
- Use && to chain commands
- Use standard Unix commands (ls, cat, mkdir, echo, etc.)
- Path separator: /
- Environment vars: $VAR_NAME`;

                return `🖥️ SYSTEM INFORMATION
━━━━━━━━━━━━━━━━━━━━━━
Server Time: ${new Date().toLocaleString()}
Platform: ${platformName}
OS Version: ${os.release()}
Architecture: ${os.arch()}
Shell: ${shell}
Hostname: ${os.hostname()}
Home Directory: ${os.homedir()}
Working Directory: ${process.cwd()}
Node.js: ${process.version}
${commandGuidance}`;
            }
        });

        // Skill: System Check
        this.skills.registerSkill({
            name: 'system_check',
            description: 'Verify system dependencies like commands, shared libraries, and file paths. Useful to confirm installs after manual changes.',
            usage: 'system_check(commands?, libraries?, paths?)',
            handler: async (args: any) => {
                const commands: string[] = Array.isArray(args?.commands) ? args.commands : (args?.commands ? String(args.commands).split(',') : []);
                const libraries: string[] = Array.isArray(args?.libraries) ? args.libraries : (args?.libraries ? String(args.libraries).split(',') : []);
                const paths: string[] = Array.isArray(args?.paths) ? args.paths : (args?.paths ? String(args.paths).split(',') : []);

                const os = require('os');
                const isWindows = process.platform === 'win32';
                const isLinux = process.platform === 'linux';

                const { exec } = require('child_process');
                const execCmd = (cmd: string) => new Promise<{ ok: boolean; out: string }>((resolve) => {
                    exec(cmd, { timeout: 15000 }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            resolve({ ok: false, out: (stderr || stdout || error.message || '').trim() });
                            return;
                        }
                        resolve({ ok: true, out: (stdout || stderr || '').trim() });
                    });
                });

                const results: string[] = [];
                results.push(`🧪 SYSTEM CHECK`);
                results.push(`Platform: ${isWindows ? 'Windows' : isLinux ? 'Linux' : os.platform()}`);
                results.push(`Hostname: ${os.hostname()}`);

                if (commands.length > 0) {
                    results.push(`\nCommands:`);
                    for (const raw of commands.map(c => c.trim()).filter(Boolean)) {
                        const cmd = raw;
                        const checkCmd = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
                        const res = await execCmd(checkCmd);
                        results.push(`- ${cmd}: ${res.ok ? '✅ found' : '❌ not found'}${res.ok && res.out ? ` (${res.out.split('\n')[0]})` : ''}`);
                    }
                }

                if (libraries.length > 0) {
                    results.push(`\nShared Libraries:`);
                    for (const raw of libraries.map(l => l.trim()).filter(Boolean)) {
                        const lib = raw;
                        if (isLinux) {
                            const res = await execCmd(`ldconfig -p | grep -m1 "${lib}"`);
                            if (res.ok && res.out) {
                                results.push(`- ${lib}: ✅ found (${res.out.split('\n')[0].trim()})`);
                            } else {
                                // Fallback check common locations
                                const alt = await execCmd(`ls /lib*/*${lib}* /usr/lib*/*${lib}* 2>/dev/null`);
                                results.push(`- ${lib}: ${alt.ok && alt.out ? '✅ found' : '❌ not found'}`);
                            }
                        } else {
                            results.push(`- ${lib}: ⚠️ library checks only supported on Linux`);
                        }
                    }
                }

                if (paths.length > 0) {
                    results.push(`\nPaths:`);
                    for (const raw of paths.map(p => p.trim()).filter(Boolean)) {
                        const p = raw;
                        const exists = fs.existsSync(p);
                        results.push(`- ${p}: ${exists ? '✅ exists' : '❌ missing'}`);
                    }
                }

                if (commands.length === 0 && libraries.length === 0 && paths.length === 0) {
                    results.push(`\nNo checks requested. Provide commands, libraries, or paths.`);
                }

                return results.join('\n');
            }
        });

        // Skill: Self Repair
        this.skills.registerSkill({
            name: 'self_repair_skill',
            description: 'Autonomously diagnose and fix a failing plugin skill. Use this when a tool returns an error or fails to execute correctly.',
            usage: 'self_repair_skill(skillName, errorMessage)',
            handler: async (args: any) => {
                const { skillName, errorMessage } = args;
                if (!skillName || !errorMessage) return 'Error: skillName and errorMessage are required.';

                const skillsList = this.skills.getAllSkills();
                const targetSkill = skillsList.find(s => s.name === skillName);

                if (!targetSkill || !targetSkill.pluginPath) {
                    return `Error: Skill "${skillName}" not found or is a core skill that cannot be modified.`;
                }

                try {
                    const pluginContent = fs.readFileSync(targetSkill.pluginPath, 'utf8');
                    let specContent = '';

                    if (targetSkill.sourceUrl) {
                        try {
                            const res = await fetch(targetSkill.sourceUrl);
                            if (res.ok) specContent = await res.text();
                        } catch (e) {
                            logger.warn(`SelfRepair: Failed to fetch spec from ${targetSkill.sourceUrl}: ${e}`);
                        }
                    }

                    const repairPrompt = `
I am attempting to fix a bug in the OrcBot plugin "${skillName}".
THE ERROR:
"""
${errorMessage}
"""

THE CURRENT CODE:
\`\`\`typescript
${pluginContent}
\`\`\`

${specContent ? `THE ORIGINAL SPECIFICATION:\n\"\"\"\n${specContent}\n\"\"\"\n` : ''}

RULES:
1. Identify the cause of the error (e.g., wrong API endpoint, missing headers, logic bug).
2. Generate the CORRECTED TypeScript code. 
3. Maintain the same "Skill" interface and export structure.
4. Keep the "@source" tag in the header if it exists.
5. Output ONLY the raw TypeScript code, no markdown blocks.

Output the fixed code:
`;

                    logger.info(`SelfRepair: Consulting LLM to fix "${skillName}"...`);
                    const fixedCode = await this.llm.call(repairPrompt, "You are a master at debugging and fixing AI agent plugins.");
                    const cleanCode = fixedCode.replace(/```typescript/g, '').replace(/```/g, '').trim();

                    fs.writeFileSync(targetSkill.pluginPath, cleanCode);
                    this.skills.loadPlugins(); // Reload registry

                    // Regenerate SKILL.md wrapper to keep metadata in sync
                    this.generateSkillMdForPlugin(skillName, targetSkill.description || '', targetSkill.pluginPath);

                    return `Successfully repaired and reloaded skill "${skillName}". You can now try to use it again.`;

                } catch (error: any) {
                    return `Self-repair failed for ${skillName}: ${error.message}`;
                }
            }
        });

        // Skill: Tweak (patch) any skill — core or plugin — by generating a replacement wrapper plugin
        this.skills.registerSkill({
            name: 'tweak_skill',
            description: 'Patch any built-in or plugin skill that keeps failing by generating a replacement wrapper plugin. The patch is saved to the plugins directory and takes effect immediately. Use this when a skill (e.g. telegram_send_buttons, run_command) repeatedly returns errors that you know how to fix.',
            usage: 'tweak_skill(skillName, issue, fix?)',
            handler: async (args: any) => {
                const { skillName, issue, fix } = args;
                if (!skillName || !issue) return 'Error: skillName and issue are required.';

                const skillsList = this.skills.getAllSkills();
                const targetSkill = skillsList.find(s => s.name === skillName);

                if (!targetSkill) {
                    return `Error: Skill "${skillName}" not found. Check the skill name and try again.`;
                }

                const pluginsDir = this.config.get('pluginsPath') || './plugins';

                try {
                    // Get handler source for context (best-effort)
                    let handlerSource = '';
                    if (targetSkill.pluginPath && fs.existsSync(targetSkill.pluginPath)) {
                        handlerSource = fs.readFileSync(targetSkill.pluginPath, 'utf8').slice(0, 2000);
                    } else {
                        try { handlerSource = targetSkill.handler.toString().slice(0, 1500); } catch { handlerSource = '(source not available)'; }
                    }

                    const patchPrompt = `You are an OrcBot skill-patching engine. Generate a patched CommonJS plugin that REPLACES the "${skillName}" skill.

SKILL TO PATCH: "${skillName}"
DESCRIPTION: "${targetSkill.description}"
USAGE: "${targetSkill.usage}"
CURRENT HANDLER SOURCE:
${handlerSource}

PROBLEM: "${issue}"
${fix ? `\nSUGGESTED FIX:\n"${fix}"\n` : ''}

Generate a fixed CommonJS plugin for this skill.

REQUIREMENTS:
1. Output ONLY raw CommonJS code — NO markdown, NO code fences, NO explanation
2. Export format: module.exports = { name, description, usage, handler }
3. name must equal: "${skillName}"
4. handler is: async function(args, context) { ... }
5. context provides: { agent, config, logger, browser }
   - context.agent.telegram → Telegraf bot instance (for Telegram ops)
   - context.agent.whatsapp → WhatsApp sock (for WhatsApp ops)
   - context.agent.discord → Discord client (for Discord ops)
   - context.agent.memory → MemoryManager
   - context.config.get(key) → config values
6. Fix the reported problem — pre-process args, add fallbacks, fix argument shapes, etc.
7. Include error handling with try/catch — return { success: false, error: message } on failure
8. Do not import external packages unless they are available in node_modules
9. Add a comment header: // @tweak: <one-line description of what was fixed>

Output the fixed CommonJS code now:`;

                    logger.info(`TweakSkill: Generating patch for "${skillName}" via LLM...`);
                    const patchCode = await this.llm.call(patchPrompt, 'You are an expert Node.js/TypeScript developer and AI skill-patching engine. Output ONLY the raw CommonJS code with no markdown.');

                    // Strip any accidental markdown fences
                    const cleanCode = patchCode
                        .replace(/^```(?:javascript|typescript|js|ts)?\n?/gm, '')
                        .replace(/^```\s*$/gm, '')
                        .trim();

                    // Basic validation — must contain module.exports
                    if (!cleanCode.includes('module.exports')) {
                        logger.warn(`TweakSkill: LLM output missing module.exports for "${skillName}"`);
                        return `Error: Generated patch for "${skillName}" is invalid (missing module.exports). Try again with a more specific fix description.`;
                    }

                    if (!fs.existsSync(pluginsDir)) {
                        fs.mkdirSync(path.resolve(pluginsDir), { recursive: true });
                    }

                    const patchFileName = `${skillName.replace(/[^a-zA-Z0-9_-]/g, '_')}_patch.js`;
                    const patchFilePath = path.resolve(pluginsDir, patchFileName);
                    fs.writeFileSync(patchFilePath, cleanCode, 'utf8');

                    // Reload plugins so the patch takes effect immediately
                    this.skills.loadPlugins();

                    logger.info(`TweakSkill: Patch for "${skillName}" written to ${patchFilePath} and reloaded.`);
                    return `Successfully patched skill "${skillName}". Patch saved to ${patchFileName} and loaded. You can now retry using "${skillName}".`;

                } catch (error: any) {
                    logger.error(`TweakSkill: Failed to patch "${skillName}": ${error.message}`);
                    return `Patch failed for "${skillName}": ${error.message}`;
                }
            }
        });

        // Skill: Set Config
        this.skills.registerSkill({
            name: 'set_config',
            description: 'Persistently save a configuration key-value pair. Use this to store API keys or settings (e.g., MOLTBOOK_API_KEY).',
            usage: 'set_config(key, value)',
            handler: async (args: any) => {
                const key = args.key;
                const value = args.value;
                if (!key || value === undefined) return 'Error: Key and value are required.';
                this.config.set(key, value);
                return `Successfully saved ${key} to configuration.`;
            }
        });

        // Skill: Manage Skills
        this.skills.registerSkill({
            name: 'manage_skills',
            description: 'Append a skill definition to SKILLS.md (the skill registry doc). This is a LIGHTWEIGHT way to document a new skill. For creating actual EXECUTABLE skills use create_custom_skill. For creating KNOWLEDGE-BASED skills use create_skill.',
            usage: 'manage_skills(skill_definition)',
            handler: async (args: any) => {
                const skill_definition = args.skill_definition || args.definition || args.skill || args.text;
                if (!skill_definition) return 'Error: Missing skill_definition.';

                const skillsPath = this.config.get('skillsPath');
                try {
                    fs.appendFileSync(skillsPath, `\n\n${skill_definition}`);
                    // Instead of re-instantiating, we just log. 
                    // Manual skills are already registered. Plugins can be reloaded.
                    this.skills.loadPlugins();
                    return `Successfully added skill to ${skillsPath}. The new definition is now active in your context.`;
                } catch (e) {
                    return `Failed to update skills: ${e}`;
                }
            }
        });

        // ─── Third-Party Tools (Installed under toolsPath) ────────────────
        this.skills.registerSkill({
            name: 'install_tool',
            description: 'Install a third-party tool from a git URL or local directory into the tools registry. Reads README and creates a manifest.',
            usage: 'install_tool(source, name?, subdir?, allowedCommands?, description?)',
            handler: async (args: any) => {
                if (this.config.get('safeMode')) {
                    return 'Error: Safe mode is enabled. Tool installation is disabled.';
                }
                const source = args.source || args.url || args.path || args.repo;
                if (!source) return 'Error: Missing source.';
                const name = args.name;
                const subdir = args.subdir;
                const description = args.description;
                let allowedCommands: string[] | undefined;
                if (args.allowedCommands) {
                    if (Array.isArray(args.allowedCommands)) {
                        allowedCommands = args.allowedCommands.map((s: any) => String(s).trim()).filter(Boolean);
                    } else if (typeof args.allowedCommands === 'string') {
                        allowedCommands = args.allowedCommands.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                }

                const result = await this.tools.installTool({ source, name, subdir, allowedCommands, description });
                if (result.success && result.name) {
                    this.tools.activateTool(result.name, true);
                }
                return result.message;
            }
        });

        this.skills.registerSkill({
            name: 'list_tools',
            description: 'List installed third-party tools and their approval/activation status.',
            usage: 'list_tools()',
            handler: async () => {
                const tools = this.tools.listTools();
                if (tools.length === 0) return 'No tools installed.';
                return tools.map(t => {
                    const status = t.active ? '🟢 active' : '⚪ inactive';
                    const approval = t.approved ? '✅ approved' : '❌ unapproved';
                    return `- ${t.name}: ${status}, ${approval}${t.description ? ` — ${t.description}` : ''}`;
                }).join('\n');
            }
        });

        this.skills.registerSkill({
            name: 'activate_tool',
            description: 'Activate or deactivate a tool to include its README in context.',
            usage: 'activate_tool(name, active?)',
            handler: async (args: any) => {
                const name = args.name || args.tool || args.tool_name;
                const active = args.active !== false && args.active !== 'false' && args.deactivate !== true;
                if (!name) return 'Error: Missing tool name.';
                return this.tools.activateTool(name, active).message;
            }
        });

        this.skills.registerSkill({
            name: 'approve_tool',
            description: 'Approve a tool for execution. Optionally set allowedCommands (comma-separated or array).',
            usage: 'approve_tool(name, allowedCommands?)',
            handler: async (args: any) => {
                const name = args.name || args.tool || args.tool_name;
                if (!name) return 'Error: Missing tool name.';
                let allowedCommands: string[] | undefined;
                if (args.allowedCommands) {
                    if (Array.isArray(args.allowedCommands)) {
                        allowedCommands = args.allowedCommands.map((s: any) => String(s).trim()).filter(Boolean);
                    } else if (typeof args.allowedCommands === 'string') {
                        allowedCommands = args.allowedCommands.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                }
                return this.tools.approveTool(name, allowedCommands).message;
            }
        });

        this.skills.registerSkill({
            name: 'read_tool_readme',
            description: 'Read the README of an installed tool.',
            usage: 'read_tool_readme(name)',
            handler: async (args: any) => {
                const name = args.name || args.tool || args.tool_name;
                if (!name) return 'Error: Missing tool name.';
                const result = this.tools.readToolReadme(name);
                return result.message;
            }
        });

        this.skills.registerSkill({
            name: 'run_tool_command',
            description: 'Run a command for an approved tool (restricted to the tool directory and its allowlist).',
            usage: 'run_tool_command(name, command, args?, cwd?)',
            handler: async (args: any) => {
                if (this.config.get('safeMode')) {
                    return 'Error: Safe mode is enabled. Tool execution is disabled.';
                }
                const name = args.name || args.tool || args.tool_name;
                const command = args.command || args.cmd;
                const toolArgs = args.args;
                const cwd = args.cwd;
                if (!name || !command) return 'Error: Missing name and/or command.';
                const result = await this.tools.runToolCommand(name, command, toolArgs, cwd);
                return result.message;
            }
        });

        this.skills.registerSkill({
            name: 'uninstall_tool',
            description: 'Uninstall a tool and remove its files.',
            usage: 'uninstall_tool(name)',
            handler: async (args: any) => {
                if (this.config.get('safeMode')) {
                    return 'Error: Safe mode is enabled. Tool uninstall is disabled.';
                }
                const name = args.name || args.tool || args.tool_name;
                if (!name) return 'Error: Missing tool name.';
                return this.tools.uninstallTool(name).message;
            }
        });
        // ─── Agent Skills (SKILL.md Format) ──────────────────────────────

        // Skill: Install Agent Skill (from URL, path, or npm package)
        this.skills.registerSkill({
            name: 'install_skill',
            description: 'Install an Agent Skill from a GitHub repo URL, gist, .skill file URL, raw SKILL.md URL, local path, or npm package (e.g. "firecrawl/cli", "@anthropic/pdf-processing", "npm:my-skill"). Agent Skills follow the agentskills.io format and extend the agent with new capabilities, workflows, and knowledge.',
            usage: 'install_skill(source)',
            handler: async (args: any) => {
                const source = args.source || args.url || args.path || args.repo;
                if (!source) return 'Error: Missing source. Provide a URL, local path, or npm package ref (e.g. "firecrawl/cli").';

                // ── npm package patterns ──────────────────────────────────────
                // Matches: "npm:xxx", "@scope/name", or "vendor/name" (no dots in vendor)
                const isNpmRef =
                    source.startsWith('npm:') ||
                    /^@[a-z0-9-]+\/[a-z0-9-]+$/i.test(source) ||
                    /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(source);

                if (isNpmRef && !source.startsWith('http://') && !source.startsWith('https://')) {
                    const result = await this.skills.installSkillFromNpm(source);
                    if (result.success) {
                        // Auto-activate all newly installed skills
                        const names: string[] = result.skillNames || (result.skillName ? [result.skillName] : []);
                        for (const name of names) this.skills.activateAgentSkill(name);
                    }
                    return result.message;
                }

                // ── URL (GitHub, gist, direct .skill, raw SKILL.md) ──────────
                if (source.startsWith('http://') || source.startsWith('https://')) {
                    const result = await this.skills.installSkillFromUrl(source);
                    if (result.success && result.skillName) {
                        this.skills.activateAgentSkill(result.skillName);
                    }
                    return result.message;
                }

                // ── Local path ────────────────────────────────────────────────
                const result = await this.skills.installSkillFromPath(source);
                if (result.success && result.skillName) {
                    this.skills.activateAgentSkill(result.skillName);
                }
                return result.message;
            }
        });

        // Skill: Create Agent Skill (KNOWLEDGE-BASED — scaffolds SKILL.md with instructions)
        // Use create_skill for knowledge, workflows, prompts, guides, and reference material.
        // Use create_custom_skill for executable code (API calls, automation, data processing).
        this.skills.registerSkill({
            name: 'create_skill',
            description: 'Create a KNOWLEDGE-BASED Agent Skill (SKILL.md format) with instructions, scripts, references, and assets. Use this for skills that teach the agent NEW WORKFLOWS, PROCEDURES, KNOWLEDGE, or PROMPT PATTERNS — not executable code. For skills that need to RUN CODE (API calls, automation, etc.), use create_custom_skill instead.',
            usage: 'create_skill(name, description?, instructions?)',
            handler: async (args: any) => {
                const name = args.name || args.skill_name;
                const description = args.description || args.desc;
                const instructions = args.instructions || args.body;
                if (!name) return 'Error: Missing skill name. Use lowercase-with-hyphens format (e.g., "pdf-processor").';

                const result = this.skills.initSkill(name, description);
                if (!result.success) return result.message;

                // If instructions provided, write them to SKILL.md body
                if (instructions && result.path) {
                    const skillMdPath = path.join(result.path, 'SKILL.md');
                    const content = fs.readFileSync(skillMdPath, 'utf8');
                    const parsed = this.skills.parseSkillMd(content);
                    if (parsed) {
                        const newContent = `---\nname: ${name}\ndescription: "${description || parsed.meta.description}"\nmetadata:\n  author: orcbot\n  version: "1.0"\n---\n\n${instructions}`;
                        fs.writeFileSync(skillMdPath, newContent);
                    }
                }

                // If no instructions provided but we have a description, use LLM to generate
                if (!instructions && description) {
                    try {
                        const prompt = `Generate a SKILL.md body (Markdown instructions, NOT frontmatter) for an Agent Skill called "${name}" described as: "${description}".

Include:
1. ## Overview — what the skill does
2. ## When to Use — triggers and scenarios
3. ## Instructions — step-by-step procedural knowledge for an AI agent
4. ## Examples — concrete input/output examples
5. ## Resources — mention scripts/, references/, assets/ if applicable

Write clear, actionable instructions an AI agent can follow. Be specific. Under 300 lines.
Output ONLY the Markdown body, no YAML frontmatter, no code blocks wrapping it.`;

                        const body = await this.llm.call(prompt, 'You are an expert at writing Agent Skills that teach AI agents new capabilities.');
                        const cleanBody = body.replace(/```markdown/g, '').replace(/```/g, '').trim();
                        const skillMdPath = path.join(result.path, 'SKILL.md');
                        const newContent = `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  author: orcbot\n  version: "1.0"\n---\n\n${cleanBody}`;
                        fs.writeFileSync(skillMdPath, newContent);
                    } catch (e) {
                        logger.warn(`Agent: Failed to generate skill instructions: ${e}`);
                    }
                }

                this.skills.discoverAgentSkills();
                return `${result.message}\n\nThe skill is ready. You can edit SKILL.md and add scripts/references/assets as needed.`;
            }
        });

        // Skill: Activate/Deactivate Agent Skill
        this.skills.registerSkill({
            name: 'activate_skill',
            description: 'Activate or deactivate an Agent Skill. Activated skills have their full instructions loaded into your context. Use this to load specialized knowledge on demand.',
            usage: 'activate_skill(name, active?)',
            handler: async (args: any) => {
                const name = args.name || args.skill_name || args.skill;
                const active = args.active !== false && args.active !== 'false' && args.deactivate !== true;
                if (!name) return 'Error: Missing skill name.';

                if (active) {
                    const skill = this.skills.activateAgentSkill(name);
                    if (!skill) return `Agent skill "${name}" not found. Use list_agent_skills to see available skills.`;
                    return `Activated skill "${name}". Its instructions are now in your context:\n\n${skill.instructions.slice(0, 500)}${skill.instructions.length > 500 ? '...' : ''}`;
                } else {
                    const ok = this.skills.deactivateAgentSkill(name);
                    if (!ok) return `Agent skill "${name}" not found.`;
                    return `Deactivated skill "${name}". Its instructions are removed from context.`;
                }
            }
        });

        // Skill: List Agent Skills
        this.skills.registerSkill({
            name: 'list_agent_skills',
            description: 'List all installed Agent Skills (SKILL.md format) with their metadata, activation status, and available resources.',
            usage: 'list_agent_skills()',
            handler: async () => {
                const agentSkills = this.skills.getAgentSkills();
                if (agentSkills.length === 0) {
                    return 'No Agent Skills installed. Use install_skill(url) to install from GitHub or create_skill(name, description) to create one.';
                }

                const lines: string[] = [`Found ${agentSkills.length} Agent Skills:\n`];
                for (const skill of agentSkills) {
                    const status = skill.activated ? '🟢 Active' : '⚪ Inactive';
                    lines.push(`${status} **${skill.meta.name}**: ${skill.meta.description}`);
                    if (skill.scripts.length > 0) lines.push(`  Scripts: ${skill.scripts.join(', ')}`);
                    if (skill.references.length > 0) lines.push(`  References: ${skill.references.join(', ')}`);
                    if (skill.assets.length > 0) lines.push(`  Assets: ${skill.assets.join(', ')}`);
                    if (skill.meta.metadata?.version) lines.push(`  Version: ${skill.meta.metadata.version}`);
                    lines.push('');
                }

                return lines.join('\n');
            }
        });

        // Skill: Read Skill Resource
        this.skills.registerSkill({
            name: 'read_skill_resource',
            description: 'Read a bundled file from an installed Agent Skill. Use this to load reference docs, read script code, or access asset files on demand (progressive disclosure).',
            usage: 'read_skill_resource(skill_name, file_path)',
            handler: async (args: any) => {
                const skillName = args.skill_name || args.skill || args.name;
                const filePath = args.file_path || args.file || args.path;
                if (!skillName || !filePath) return 'Error: Missing skill_name and/or file_path.';

                const content = this.skills.readSkillResource(skillName, filePath);
                if (content === null) return `Could not read "${filePath}" from skill "${skillName}". Check the path and skill name.`;
                return content;
            }
        });

        // Skill: Validate Skill
        this.skills.registerSkill({
            name: 'validate_skill',
            description: 'Validate an Agent Skill directory against the agentskills.io specification. Checks frontmatter, naming, structure.',
            usage: 'validate_skill(name_or_path)',
            handler: async (args: any) => {
                const input = args.name_or_path || args.name || args.path || args.skill;
                if (!input) return 'Error: Missing skill name or path.';

                // Resolve path: could be a skill name or absolute path
                let skillDir = input;
                if (!path.isAbsolute(input)) {
                    const agentSkill = this.skills.getAgentSkill(input);
                    if (agentSkill) {
                        skillDir = agentSkill.skillDir;
                    } else if (this.config.get('pluginsPath')) {
                        skillDir = path.join(this.config.get('pluginsPath'), 'skills', input);
                    }
                }

                const result = this.skills.validateSkill(skillDir);
                if (result.valid) return `✅ Skill "${input}" is valid.`;
                return `❌ Skill "${input}" has ${result.errors.length} issue(s):\n${result.errors.map(e => `  - ${e}`).join('\n')}`;
            }
        });

        // Skill: Uninstall Agent Skill
        this.skills.registerSkill({
            name: 'uninstall_agent_skill',
            description: 'Uninstall an Agent Skill by removing its directory. This is for SKILL.md-format skills only.',
            usage: 'uninstall_agent_skill(name)',
            handler: async (args: any) => {
                const name = args.name || args.skill_name || args.skill;
                if (!name) return 'Error: Missing skill name.';
                return this.skills.uninstallAgentSkill(name);
            }
        });

        // Skill: Run Skill Script
        this.skills.registerSkill({
            name: 'run_skill_script',
            description: 'Execute a script bundled with an Agent Skill. Scripts can be .js, .py, .sh, or other executable files.',
            usage: 'run_skill_script(skill_name, script, args?)',
            handler: async (args: any) => {
                const skillName = args.skill_name || args.skill || args.name;
                const scriptPath = args.script || args.file;
                const scriptArgs = args.args || '';
                if (!skillName || !scriptPath) return 'Error: Missing skill_name and/or script path.';

                const skill = this.skills.getAgentSkill(skillName);
                if (!skill) return `Agent skill "${skillName}" not found.`;

                const fullScriptPath = path.join(skill.skillDir, 'scripts', scriptPath);
                if (!fullScriptPath.startsWith(skill.skillDir)) return 'Error: Path traversal not allowed.';
                if (!fs.existsSync(fullScriptPath)) return `Script not found: ${scriptPath}`;

                const ext = path.extname(fullScriptPath).toLowerCase();
                let cmd: string;
                if (ext === '.js') cmd = `node "${fullScriptPath}" ${scriptArgs}`;
                else if (ext === '.ts') cmd = `npx ts-node "${fullScriptPath}" ${scriptArgs}`;
                else if (ext === '.py') cmd = `python "${fullScriptPath}" ${scriptArgs}`;
                else if (ext === '.sh') cmd = `bash "${fullScriptPath}" ${scriptArgs}`;
                else if (ext === '.ps1') cmd = `powershell -File "${fullScriptPath}" ${scriptArgs}`;
                else cmd = `"${fullScriptPath}" ${scriptArgs}`;

                return new Promise((resolve) => {
                    const { exec } = require('child_process');
                    exec(cmd, { timeout: 120000, cwd: skill.skillDir }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            resolve(`Script error: ${error.message}\n${stderr}`);
                        } else {
                            resolve(stdout || stderr || 'Script completed with no output.');
                        }
                    });
                });
            }
        });

        // Skill: Write Skill File
        this.skills.registerSkill({
            name: 'write_skill_file',
            description: 'Write or update a file within an Agent Skill directory. Use this to add scripts, references, assets, or edit SKILL.md.',
            usage: 'write_skill_file(skill_name, file_path, content)',
            handler: async (args: any) => {
                const skillName = args.skill_name || args.skill || args.name;
                const filePath = args.file_path || args.file || args.path;
                const content = args.content || args.text || args.body;
                if (!skillName || !filePath || content === undefined) return 'Error: Missing skill_name, file_path, or content.';

                const skill = this.skills.getAgentSkill(skillName);
                if (!skill) return `Agent skill "${skillName}" not found.`;

                const fullPath = path.join(skill.skillDir, filePath);
                if (!fullPath.startsWith(skill.skillDir)) return 'Error: Path traversal not allowed.';

                // Ensure parent directory exists
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                fs.writeFileSync(fullPath, content);

                // Rediscover if SKILL.md was modified
                if (filePath === 'SKILL.md') this.skills.discoverAgentSkills();

                return `Written ${content.length} bytes to ${filePath} in skill "${skillName}".`;
            }
        });

        // Skill: Browser Navigate
        this.skills.registerSkill({
            name: 'browser_navigate',
            description: 'Navigate to a URL and return a fast readable summary. Use browser_examine_page when you need interactive ref IDs. If the site is bot-protected or JS-heavy and returns blank pages, switch to firecrawl_scrape(url) instead (requires firecrawl-cli installed).',
            usage: 'browser_navigate(url, include_snapshot?)',
            handler: async (args: any) => {
                const url = args.url || args.link || args.site;
                if (!url) return 'Error: Missing url.';

                // ── browserProvider hook ──────────────────────────────────────
                // If config.browserProvider is set to 'firecrawl', route through
                // firecrawl_scrape instead of local Playwright. Falls back to
                // Playwright if firecrawl is unavailable or returns an error.
                // Set via: set_config("browserProvider", "firecrawl")
                // Reset via: set_config("browserProvider", "playwright")
                const provider = (this.config?.get?.('browserProvider') as string | undefined)?.toLowerCase();
                if (provider === 'firecrawl') {
                    try {
                        const { execSync } = require('child_process');
                        // Verify firecrawl is installed (fast check)
                        execSync('firecrawl --version', { stdio: 'ignore', timeout: 4000 });
                        const { exec } = require('child_process');
                        const fcResult: string = await new Promise(resolve => {
                            exec(
                                `firecrawl scrape "${url.replace(/"/g, '\\"')}" --format markdown --only-main-content`,
                                { timeout: 90000 },
                                (_err: any, stdout: string, stderr: string) => {
                                    const out = (stdout || '').trim();
                                    resolve(out || (stderr ? `firecrawl error: ${stderr.slice(0, 300)}` : ''));
                                }
                            );
                        });
                        if (fcResult && !fcResult.startsWith('firecrawl error')) {
                            const MAX = 12000;
                            const body = fcResult.length > MAX
                                ? fcResult.slice(0, MAX) + '\n\n[... truncated by browserProvider=firecrawl]'
                                : fcResult;
                            return `[browserProvider: firecrawl] Navigated to ${url}\n\n${body}`;
                        }
                        // Fall through to local Playwright on firecrawl failure
                        logger.warn(`browser_navigate: firecrawl provider failed for ${url}, falling back to Playwright`);
                    } catch {
                        logger.warn('browser_navigate: firecrawl not installed, using Playwright');
                    }
                }
                // ── End browserProvider hook ──────────────────────────────────

                const res = await this.browser.navigate(url);
                if (res.startsWith('Error')) return res;
                const includeSnapshot = Boolean(args.include_snapshot || args.includeSnapshot || args.semantic || args.snapshot);

                // Fast path: extract readable content first (lighter and less brittle than full semantic snapshots)
                const extracted = await this.browser.extractContent();
                const extractedOk = !(extracted.startsWith('Error') || extracted.startsWith('Failed'));

                // Detect blank page even on the fast path so the guard counter stays accurate
                const extractedLooksBlank = !extractedOk ||
                    extracted.includes('Extracted: 0 chars') ||
                    (extracted.match(/Extracted: (\d+) chars/) &&
                        parseInt((extracted.match(/Extracted: (\d+) chars/) || ['', '0'])[1]) < 100);

                if (extractedOk && !includeSnapshot) {
                    if (extractedLooksBlank) {
                        this._blankPageCount = (this._blankPageCount || 0) + 1;
                    } else {
                        this._blankPageCount = 0;
                    }
                    return `${res}\n\n--- QUICK READ ---\n${extracted}`;
                }

                const snapshot = await this.browser.getSemanticSnapshot();

                // Track blank-page results and warn the agent to switch strategy
                const looksBlank = snapshot.includes('(No interactive elements found)') ||
                    (snapshot.includes('HTML length:') && parseInt((snapshot.match(/HTML length: (\d+)/) || ['', '0'])[1]) < 500);
                if (looksBlank) {
                    this._blankPageCount = (this._blankPageCount || 0) + 1;
                    if (this._blankPageCount >= 2) {
                        return snapshot + '\n\n[SYSTEM WARNING: The browser has returned blank/empty pages ' + this._blankPageCount + ' times. The target site may be blocking headless browsers or requires JavaScript that cannot render. STOP using the browser for this task and switch to web_search instead. Do NOT fabricate or hallucinate page content.]';
                    }
                } else {
                    this._blankPageCount = 0; // Reset on successful page load
                }
                return snapshot;
            }
        });

        // Skill: Browser Examine Page
        this.skills.registerSkill({
            name: 'browser_examine_page',
            description: 'Get a text-based semantic snapshot of the current page including all interactive elements with reference IDs.',
            usage: 'browser_examine_page()',
            handler: async () => {
                const snapshot = await this.browser.getSemanticSnapshot();
                // Also track blank pages from examine_page calls
                const looksBlank = snapshot.includes('(No interactive elements found)') ||
                    (snapshot.includes('HTML length:') && parseInt((snapshot.match(/HTML length: (\d+)/) || ['', '0'])[1]) < 500);
                if (looksBlank && this.shouldUseGoogleComputerUse()) {
                    try {
                        logger.info('browser_examine_page: Using Gemini Computer Use visual fallback');
                        this.computerUse.setContext('browser');
                        const screenshotPath = await this.computerUse.captureScreen();
                        const prompt = 'Describe the visible page layout and content. List ALL interactive elements you can see: buttons, links, input fields, menus, tabs, icons, and any clickable areas. For each element, describe its position (top/center/bottom, left/center/right) and apparent function.';
                        const model = this.getGoogleComputerUseModel();
                        const visual = await this.llm.analyzeMediaWithModel(screenshotPath, prompt, model);
                        return `${snapshot}\n\n--- Visual fallback ---\n${visual}`;
                    } catch (e) {
                        logger.warn(`browser_examine_page: Computer-use fallback failed: ${e}`);
                    }
                }
                if (looksBlank && this._blankPageCount >= 2) {
                    return snapshot + '\n\n[SYSTEM WARNING: Browser is consistently returning blank pages. STOP using browser tools for this task and switch to web_search instead. Do NOT fabricate or hallucinate page content.]';
                }
                return snapshot;
            }
        });

        // Skill: Browser Wait
        this.skills.registerSkill({
            name: 'browser_wait',
            description: 'Wait for a specified number of milliseconds',
            usage: 'browser_wait(ms)',
            handler: async (args: any) => {
                const ms = parseInt(args.ms || args.time || '1000');
                return this.browser.wait(ms);
            }
        });

        // Skill: Browser Wait For Selector
        this.skills.registerSkill({
            name: 'browser_wait_for',
            description: 'Wait for a CSS selector to appear on the page',
            usage: 'browser_wait_for(selector, timeout?)',
            handler: async (args: any) => {
                const selector = args.selector || args.css;
                const timeout = args.timeout ? parseInt(args.timeout) : 15000;
                if (!selector) return 'Error: Missing selector.';
                return this.browser.waitForSelector(selector, timeout);
            }
        });

        // Skill: Browser Click
        this.skills.registerSkill({
            name: 'browser_click',
            description: 'Click an element using a CSS selector or a numeric reference ID [ref=N] from the semantic snapshot. Returns a fresh snapshot of the page after clicking.',
            usage: 'browser_click(selector_or_ref)',
            handler: async (args: any) => {
                const selector = args.selector_or_ref || args.selector || args.css || args.ref;
                if (!selector) return 'Error: Missing selector or ref.';
                const selectorStr = String(selector);
                const useComputerUse = this.shouldUseGoogleComputerUse();
                const button = args.button || 'left';

                if (useComputerUse) {
                    logger.info(`browser_click: Trying Gemini Computer Use for selector "${selectorStr}"`);
                    this.computerUse.setContext('browser');
                    const cuResult = await this.computerUse.visionClick(selectorStr, button);
                    const failed = cuResult.startsWith('Error') || cuResult.startsWith('Failed') || cuResult.startsWith('Could not');
                    if (!failed) {
                        logger.info('browser_click: Gemini Computer Use succeeded');
                        try {
                            const snapshot = await this.browser.getSemanticSnapshot();
                            return `${cuResult}\n\n--- Page after click ---\n${snapshot}`;
                        } catch {
                            return cuResult;
                        }
                    }
                    logger.warn(`browser_click: Gemini Computer Use failed, falling back to Playwright. Result: ${cuResult}`);
                }

                const clickResult = await this.browser.click(selectorStr);
                if (clickResult.startsWith('Error') || clickResult.startsWith('Failed')) return clickResult;

                // Auto-snapshot: Return what the page looks like after the click
                // This saves a step (no need for separate browser_examine_page)
                try {
                    const snapshot = await this.browser.getSemanticSnapshot();
                    return `${clickResult}\n\n--- Page after click ---\n${snapshot}`;
                } catch {
                    return clickResult;
                }
            }
        });

        // Skill: Browser Type
        this.skills.registerSkill({
            name: 'browser_type',
            description: 'Type text into an input field using a CSS selector or a numeric reference ID [ref=N].',
            usage: 'browser_type(selector_or_ref, text)',
            handler: async (args: any) => {
                const selector = args.selector_or_ref || args.selector || args.css || args.ref;
                const text = args.text || args.value;
                if (!selector || !text) return 'Error: Missing selector/ref or text.';
                const selectorStr = String(selector);
                const useComputerUse = this.shouldUseGoogleComputerUse();
                if (useComputerUse) {
                    logger.info(`browser_type: Trying Gemini Computer Use for selector "${selectorStr}"`);
                    this.computerUse.setContext('browser');
                    const cuResult = await this.computerUse.visionType(selectorStr, text);
                    const failed = cuResult.startsWith('Error') || cuResult.startsWith('Failed') || cuResult.startsWith('Could not');
                    if (!failed) {
                        logger.info('browser_type: Gemini Computer Use succeeded');
                        return cuResult;
                    }
                    logger.warn(`browser_type: Gemini Computer Use failed, falling back to Playwright. Result: ${cuResult}`);
                }

                return this.browser.type(selectorStr, text);
            }
        });

        // Skill: Browser Press Key
        this.skills.registerSkill({
            name: 'browser_press',
            description: 'Press a keyboard key (e.g. "Enter", "Tab")',
            usage: 'browser_press(key)',
            handler: async (args: any) => {
                const key = args.key || args.name;
                const useComputerUse = this.shouldUseGoogleComputerUse();
                if (useComputerUse) {
                    logger.info(`browser_press: Trying Gemini Computer Use for key "${String(key)}"`);
                    this.computerUse.setContext('browser');
                    const cuResult = await this.computerUse.keyPress(String(key));
                    if (!cuResult.startsWith('Error')) {
                        logger.info('browser_press: Gemini Computer Use succeeded');
                        return cuResult;
                    }
                    logger.warn(`browser_press: Gemini Computer Use failed, falling back to Playwright. Result: ${cuResult}`);
                }
                return this.browser.press(key);
            }
        });

        // Skill: Browser Screenshot
        this.skills.registerSkill({
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current browser state',
            usage: 'browser_screenshot()',
            handler: async () => {
                const captcha = await this.browser.detectCaptcha();
                if (this.shouldUseGoogleComputerUse()) {
                    try {
                        logger.info('browser_screenshot: Using Gemini Computer Use capture');
                        this.computerUse.setContext('browser');
                        const screenshotPath = await this.computerUse.captureScreen();
                        const result = `Screenshot saved to: ${screenshotPath}.`;
                        return `${captcha ? `[WARNING: ${captcha}]\n` : ''}${result}`;
                    } catch (e) {
                        logger.warn(`browser_screenshot: Computer-use screenshot failed: ${e}`);
                    }
                }
                const result = await this.browser.screenshot();
                return `${captcha ? `[WARNING: ${captcha}]\n` : ''}${result}`;
            }
        });

        // Skill: Browser Trace Start
        this.skills.registerSkill({
            name: 'browser_trace_start',
            description: 'Start Playwright tracing for the current browser session.',
            usage: 'browser_trace_start()',
            handler: async () => {
                return this.browser.startTrace();
            }
        });

        // Skill: Browser Trace Stop
        this.skills.registerSkill({
            name: 'browser_trace_stop',
            description: 'Stop Playwright tracing and save the trace to disk.',
            usage: 'browser_trace_stop()',
            handler: async () => {
                return this.browser.stopTrace();
            }
        });

        // Skill: Browser Vision
        this.skills.registerSkill({
            name: 'browser_vision',
            description: 'Use vision (screenshot + AI analysis) to see and describe the current browser page. Use when semantic snapshots are insufficient — e.g. canvas-heavy pages, image-based UIs, complex visual layouts, or when you need spatial understanding of element positions.',
            usage: 'browser_vision(prompt?)',
            handler: async (args: any) => {
                const prompt = args.prompt || args.question || args.text ||
                    'Describe the visible page layout and content. List ALL interactive elements you can see: buttons, links, input fields, menus, tabs, icons, and any clickable areas. For each element, describe its position (top/center/bottom, left/center/right) and apparent function. Also note any visible text, headings, images, or important content areas.';

                const screenshotResult = await this.browser.screenshot();
                if (String(screenshotResult).startsWith('Failed')) {
                    return screenshotResult;
                }

                const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
                if (!fs.existsSync(screenshotPath)) {
                    return `Error: Screenshot file not found at ${screenshotPath}`;
                }

                try {
                    const description = await this.llm.analyzeMedia(screenshotPath, prompt);
                    return `VISION ANALYSIS:\n${description}`;
                } catch (e) {
                    return `Error analyzing screenshot: ${e}`;
                }
            }
        });

        // Skill: Browser Solve CAPTCHA
        this.skills.registerSkill({
            name: 'browser_solve_captcha',
            description: 'Attempt to solve a detected CAPTCHA (reCAPTCHA, hCaptcha, etc.)',
            usage: 'browser_solve_captcha()',
            handler: async () => {
                return this.browser.solveCaptcha();
            }
        });

        // Skill: Browser Run JS
        this.skills.registerSkill({
            name: 'browser_run_js',
            description: 'Run custom JavaScript on the current page.',
            usage: 'browser_run_js(script)',
            handler: async (args: any) => {
                const script = args.script || args.code || args.js;
                if (!script) return 'Error: Missing script.';
                return this.browser.evaluate(script);
            }
        });

        // Skill: Browser Back
        this.skills.registerSkill({
            name: 'browser_back',
            description: 'Navigate back to the previous page in browser history.',
            usage: 'browser_back()',
            handler: async () => {
                return this.browser.goBack();
            }
        });

        // Skill: Browser Scroll
        this.skills.registerSkill({
            name: 'browser_scroll',
            description: 'Scroll the page up or down. Direction must be "up" or "down". Amount is optional pixels (default 600).',
            usage: 'browser_scroll(direction, amount?)',
            handler: async (args: any) => {
                const direction = args.direction || 'down';
                const amount = args.amount ? parseInt(args.amount, 10) : undefined;
                if (direction !== 'up' && direction !== 'down') {
                    return 'Error: direction must be "up" or "down".';
                }
                const useComputerUse = this.shouldUseGoogleComputerUse();
                if (useComputerUse) {
                    logger.info(`browser_scroll: Trying Gemini Computer Use (${direction}, ${amount ?? 600}px)`);
                    this.computerUse.setContext('browser');
                    const ticks = amount ? Math.max(1, Math.round(amount / 200)) : 3;
                    const cuResult = await this.computerUse.scroll(direction, ticks);
                    if (!cuResult.startsWith('Error') && !cuResult.startsWith('Failed')) {
                        logger.info('browser_scroll: Gemini Computer Use succeeded');
                        return cuResult;
                    }
                    logger.warn(`browser_scroll: Gemini Computer Use failed, falling back to Playwright. Result: ${cuResult}`);
                }

                const result = await this.browser.scrollPage(direction, amount);
                // Inject boundary warnings to prevent scroll loops
                if (result.includes('(at bottom)') && direction === 'down') {
                    return `${result}\n\n⚠️ You have reached the BOTTOM of the page. Do NOT scroll down again — there is no more content below. Either scroll up, interact with visible elements, navigate elsewhere, or report your findings to the user.`;
                }
                if (result.includes('(at top)') && direction === 'up') {
                    return `${result}\n\n⚠️ You have reached the TOP of the page. Do NOT scroll up again — there is no more content above. Either scroll down, interact with visible elements, or try a different approach.`;
                }
                return result;
            }
        });

        // Skill: Browser Hover
        this.skills.registerSkill({
            name: 'browser_hover',
            description: 'Hover over an element to trigger tooltips, menus, or hover effects. Use ref number from examine_page or a CSS selector.',
            usage: 'browser_hover(selector)',
            handler: async (args: any) => {
                const selector = args.selector || args.ref || args.element;
                if (!selector) return 'Error: Missing selector.';
                const selectorStr = String(selector);
                const useComputerUse = this.shouldUseGoogleComputerUse();
                if (useComputerUse) {
                    logger.info(`browser_hover: Trying Gemini Computer Use for selector "${selectorStr}"`);
                    this.computerUse.setContext('browser');
                    const located = await this.computerUse.locateElement(selectorStr);
                    if (located.x >= 0 && located.y >= 0) {
                        logger.info(`browser_hover: Gemini Computer Use located target at (${located.x}, ${located.y})`);
                        return this.computerUse.mouseMove(located.x, located.y);
                    }
                    logger.warn('browser_hover: Gemini Computer Use could not locate target, falling back to Playwright');
                }
                return this.browser.hover(selectorStr);
            }
        });

        // Skill: Browser Select
        this.skills.registerSkill({
            name: 'browser_select',
            description: 'Select an option from a dropdown (<select> or custom dropdown). Use the visible label text as the value.',
            usage: 'browser_select(selector, value)',
            handler: async (args: any) => {
                const selector = args.selector || args.ref || args.element;
                const value = args.value || args.option || args.label;
                if (!selector) return 'Error: Missing selector.';
                if (!value) return 'Error: Missing value/option to select.';
                const selectorStr = String(selector);
                const valueStr = String(value);
                const useComputerUse = this.shouldUseGoogleComputerUse();
                if (useComputerUse) {
                    logger.info(`browser_select: Trying Gemini Computer Use for selector "${selectorStr}" and value "${valueStr}"`);
                    this.computerUse.setContext('browser');
                    const openResult = await this.computerUse.visionClick(selectorStr);
                    const openFailed = openResult.startsWith('Error') || openResult.startsWith('Failed') || openResult.startsWith('Could not');
                    if (!openFailed) {
                        const chooseResult = await this.computerUse.visionClick(valueStr);
                        const chooseFailed = chooseResult.startsWith('Error') || chooseResult.startsWith('Failed') || chooseResult.startsWith('Could not');
                        if (!chooseFailed) {
                            logger.info('browser_select: Gemini Computer Use succeeded');
                            return `Selected "${valueStr}" via computer use. Open: ${openResult}. Choose: ${chooseResult}`;
                        }
                    }
                    logger.warn(`browser_select: Gemini Computer Use failed, falling back to Playwright. Open result: ${openResult}`);
                }
                return this.browser.selectOption(selectorStr, valueStr);
            }
        });

        // Skill: Switch Browser Profile
        this.skills.registerSkill({
            name: 'switch_browser_profile',
            description: 'Switch to a persistent browser profile by name (and optional directory).',
            usage: 'switch_browser_profile(profileName, profileDir?)',
            handler: async (args: any) => {
                const profileName = args.profileName || args.name || args.profile;
                const profileDir = args.profileDir || args.dir;
                if (!profileName) return 'Error: Missing profileName.';
                return this.browser.switchProfile(profileName, profileDir);
            }
        });

        // Skill: Switch Browser Engine
        this.skills.registerSkill({
            name: 'switch_browser_engine',
            description: 'Switch between browser engines: "playwright" (Chrome/Chromium via Playwright) or "lightpanda" (lightweight headless browser via CDP). Lightpanda uses 9x less RAM and is 11x faster than Chrome.',
            usage: 'switch_browser_engine(engine, endpoint?)',
            handler: async (args: any) => {
                const engine = args.engine || args.browserEngine;
                const endpoint = args.endpoint || args.lightpandaEndpoint;

                if (!engine) return 'Error: Missing engine. Use "playwright" or "lightpanda".';
                if (engine !== 'playwright' && engine !== 'lightpanda') {
                    return `Error: Invalid engine "${engine}". Use "playwright" or "lightpanda".`;
                }

                // Update config
                this.config.set('browserEngine', engine);
                if (endpoint && engine === 'lightpanda') {
                    this.config.set('lightpandaEndpoint', endpoint);
                }

                // Close existing browser and reinitialize
                await this.browser.close();
                this.browser = new WebBrowser(
                    this.config.get('serperApiKey'),
                    this.config.get('captchaApiKey'),
                    this.config.get('braveSearchApiKey'),
                    this.config.get('searxngUrl'),
                    this.config.get('searchProviderOrder'),
                    this.config.get('browserProfileDir'),
                    this.config.get('browserProfileName'),
                    this.tuner,
                    this.config.get('browserEngine'),
                    this.config.get('lightpandaEndpoint'),
                    {
                        alwaysSaveArtifacts: this.config.get('browserDebugAlwaysSave'),
                        traceEnabled: this.config.get('browserTraceEnabled'),
                        traceDir: this.config.get('browserTraceDir'),
                        traceScreenshots: this.config.get('browserTraceScreenshots'),
                        traceSnapshots: this.config.get('browserTraceSnapshots')
                    }
                );

                // Update skills context
                this.skills.setContext({
                    browser: this.browser,
                    config: this.config,
                    agent: this,
                    logger: logger,
                });

                if (engine === 'lightpanda') {
                    const ep = this.config.get('lightpandaEndpoint') || 'ws://127.0.0.1:9222';
                    return `Switched to Lightpanda browser engine. CDP endpoint: ${ep}. Make sure Lightpanda is running: ./lightpanda serve --host 127.0.0.1 --port 9222`;
                }
                return 'Switched to Playwright browser engine (Chrome/Chromium).';
            }
        });

        // Skill: Browser API Intercept — auto-discover XHR/fetch endpoints
        this.skills.registerSkill({
            name: 'browser_api_intercept',
            description: 'Enable API interception to auto-discover XHR/fetch endpoints that pages call. After enabling, navigate normally — discovered endpoints are collected. Use browser_api_list to see them, then call them directly with http_fetch for speed.',
            usage: 'browser_api_intercept()',
            handler: async () => {
                return this.browser.enableApiInterception();
            }
        });

        // Skill: Browser API List — show discovered API endpoints
        this.skills.registerSkill({
            name: 'browser_api_list',
            description: 'List all API endpoints discovered by API interception. Shows URL, method, content type, and status. Use json_only=true to filter to JSON APIs only.',
            usage: 'browser_api_list(json_only?)',
            handler: async (args: any) => {
                const jsonOnly = args.json_only === true || args.json_only === 'true' || args.jsonOnly === true;
                return this.browser.formatInterceptedApis(jsonOnly);
            }
        });

        // Skill: Browser Extract Content — readability-style text extraction
        this.skills.registerSkill({
            name: 'browser_extract_content',
            description: 'Extract the readable text content from the current page, stripping navigation, ads, and noise. Returns clean markdown-style text. Much faster than a semantic snapshot when you just need to read page content.',
            usage: 'browser_extract_content()',
            handler: async () => {
                return this.browser.extractContent();
            }
        });

        // Skill: Browser Extract Data — CSS-based structured data extraction
        this.skills.registerSkill({
            name: 'browser_extract_data',
            description: 'Extract structured data from elements matching a CSS selector. Returns JSON with text, attributes, and metadata for each matching element. Great for scraping tables, lists, cards, or repeated elements.',
            usage: 'browser_extract_data(selector, attribute?, limit?)',
            handler: async (args: any) => {
                const selector = args.selector || args.css;
                if (!selector) return 'Error: Missing selector.';
                return this.browser.extractData(selector, {
                    attribute: args.attribute || args.attr,
                    limit: args.limit ? parseInt(args.limit, 10) : 50,
                    includeHtml: args.include_html === true || args.include_html === 'true'
                });
            }
        });

        // Skill: Browser Fill Form — batch fill + submit
        this.skills.registerSkill({
            name: 'browser_fill_form',
            description: 'Fill multiple form fields and optionally submit in one call. Much more efficient than individual click→type→click→type sequences. Pass fields as an array of {selector, value, action?} objects. Actions: fill (default), select, check, click.',
            usage: 'browser_fill_form(fields, submit_selector?)',
            handler: async (args: any) => {
                let fields = args.fields;
                if (!fields) return 'Error: Missing fields array.';
                if (!Array.isArray(fields)) {
                    try {
                        fields = JSON.parse(fields);
                    } catch {
                        return 'Error: fields must be an array of {selector, value, action?}.';
                    }
                }

                const submitSelector = args.submit_selector || args.submit || args.submitSelector;
                return this.browser.fillForm(fields, submitSelector);
            }
        });

        // ─── Computer Use Skills (Vision-based mouse/keyboard control) ───

        // Skill: Computer Screenshot
        this.skills.registerSkill({
            name: 'computer_screenshot',
            description: 'Take a screenshot and describe what is on screen. Set context to "browser" or "system". Returns a visual description so you can see the current screen state before acting. NOTE: "system" context requires a display server (X11/Wayland) — it will NOT work on headless servers. Use "browser" context or browser_vision instead on servers.',
            usage: 'computer_screenshot(context?)',
            handler: async (args: any) => {
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else this.computerUse.setContext('browser');
                try {
                    const screenshotPath = await this.computerUse.captureScreen();
                    let result = `Screenshot saved to: ${screenshotPath} (context: ${this.computerUse.getContext()}, available: ${this.computerUse.isAvailable()})`;

                    // Auto-describe the screenshot so the LLM can "see" it
                    if (this.computerUse.hasVision()) {
                        try {
                            const description = await this.computerUse.describeScreen();
                            result += `\n[Screen content: ${description}]`;
                        } catch (e) {
                            result += `\n[Vision description failed: ${e} — use computer_describe for details]`;
                        }
                    }

                    return result;
                } catch (e) {
                    const errMsg = String(e);
                    // On headless servers, guide the agent to use browser-based alternatives
                    if (errMsg.includes('display') || errMsg.includes('DISPLAY') || errMsg.includes('headless server')) {
                        return `Screenshot failed (no display server): ${e}\n\n⚠️ This is a headless server — system-level computer_* tools (computer_screenshot, computer_click, computer_vision_click, etc.) with context="system" will NOT work. Use these alternatives instead:\n• browser_screenshot — take a screenshot of the browser page\n• browser_vision(prompt) — get AI-powered visual description of the browser page\n• browser_examine_page() — get semantic snapshot of interactive elements\n• computer_screenshot(context="browser") — screenshot in browser context only\nDo NOT retry system-context computer_* tools.`;
                    }
                    return `Screenshot failed: ${e}`;
                }
            }
        });

        // Skill: Computer Click (vision-guided)
        this.skills.registerSkill({
            name: 'computer_click',
            description: 'Click at pixel coordinates (x, y) or describe what to click and vision will locate it. Use context "browser" for in-page clicks or "system" for desktop clicks. NOTE: "system" context requires a display server — use browser_click on headless servers.',
            usage: 'computer_click(x?, y?, description?, button?, context?)',
            handler: async (args: any) => {
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                const x = args.x !== undefined ? parseInt(args.x) : undefined;
                const y = args.y !== undefined ? parseInt(args.y) : undefined;
                const description = args.description || args.element || args.target;
                const button = args.button || 'left';

                try {
                    return await this.computerUse.mouseClick({ x, y, button, description });
                } catch (e) {
                    const errMsg = String(e);
                    if (errMsg.includes('display') || errMsg.includes('DISPLAY') || errMsg.includes('headless server')) {
                        return `Computer click failed (headless server — no display): ${e}\nUse browser_click with ref IDs instead, or browser_vision_click for visual element targeting. Do NOT retry system-context computer_* tools.`;
                    }
                    return `Computer click failed: ${e}`;
                }
            }
        });

        // Skill: Computer Vision Click (always uses vision to find element)
        this.skills.registerSkill({
            name: 'computer_vision_click',
            description: 'Click an element by describing it visually. Takes a screenshot, uses AI vision to locate the element, and clicks at the detected coordinates. Best for canvas apps, custom UIs, or when DOM selectors fail. NOTE: On headless servers, use context="browser" only.',
            usage: 'computer_vision_click(description, button?, context?)',
            handler: async (args: any) => {
                const description = args.description || args.element || args.target;
                if (!description) return 'Error: Missing description of element to click.';
                const ctx = args.context || args.mode || 'browser'; // Default to browser (works on headless)
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                try {
                    return await this.computerUse.visionClick(description, args.button || 'left');
                } catch (e) {
                    const errMsg = String(e);
                    if (errMsg.includes('display') || errMsg.includes('DISPLAY') || errMsg.includes('headless server')) {
                        return `Vision click failed (headless server — no display): ${e}\nUse browser_click with ref IDs from browser_examine_page, or browser_vision for visual analysis. Do NOT retry system-context computer_* tools.`;
                    }
                    return `Vision click failed: ${e}`;
                }
            }
        });

        // Skill: Computer Type
        this.skills.registerSkill({
            name: 'computer_type',
            description: 'Type text at the current cursor position using keyboard simulation. Or describe an input field to click it first (vision-guided), then type.',
            usage: 'computer_type(text, inputDescription?, context?)',
            handler: async (args: any) => {
                const text = args.text || args.content || args.input;
                if (!text) return 'Error: Missing text to type.';
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                const inputDescription = args.inputDescription || args.field || args.element;
                if (inputDescription) {
                    return this.computerUse.visionType(inputDescription, text);
                }
                return this.computerUse.keyType(text);
            }
        });

        // Skill: Computer Key Press
        this.skills.registerSkill({
            name: 'computer_key',
            description: 'Press a key or key combination (e.g., "Enter", "ctrl+c", "alt+Tab", "ctrl+shift+s"). Works in both browser and system context.',
            usage: 'computer_key(key, context?)',
            handler: async (args: any) => {
                const key = args.key || args.keys || args.combo;
                if (!key) return 'Error: Missing key to press.';
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                return this.computerUse.keyPress(key);
            }
        });

        // Skill: Computer Mouse Move
        this.skills.registerSkill({
            name: 'computer_mouse_move',
            description: 'Move the mouse cursor to pixel coordinates (x, y).',
            usage: 'computer_mouse_move(x, y, context?)',
            handler: async (args: any) => {
                const x = parseInt(args.x);
                const y = parseInt(args.y);
                if (isNaN(x) || isNaN(y)) return 'Error: Missing or invalid x/y coordinates.';
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                return this.computerUse.mouseMove(x, y);
            }
        });

        // Skill: Computer Drag
        this.skills.registerSkill({
            name: 'computer_drag',
            description: 'Drag from one point to another. Useful for moving elements, selecting text, resizing, etc.',
            usage: 'computer_drag(fromX, fromY, toX, toY, context?)',
            handler: async (args: any) => {
                const fromX = parseInt(args.fromX || args.startX || args.x1);
                const fromY = parseInt(args.fromY || args.startY || args.y1);
                const toX = parseInt(args.toX || args.endX || args.x2);
                const toY = parseInt(args.toY || args.endY || args.y2);
                if ([fromX, fromY, toX, toY].some(isNaN)) return 'Error: Missing coordinates. Need fromX, fromY, toX, toY.';
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                return this.computerUse.mouseDrag(fromX, fromY, toX, toY);
            }
        });

        // Skill: Computer Scroll
        this.skills.registerSkill({
            name: 'computer_scroll',
            description: 'Scroll up/down/left/right in browser or system context. Amount is in scroll ticks (default 3).',
            usage: 'computer_scroll(direction, amount?, x?, y?, context?)',
            handler: async (args: any) => {
                const direction = args.direction || 'down';
                if (!['up', 'down', 'left', 'right'].includes(direction)) {
                    return 'Error: direction must be up, down, left, or right.';
                }
                const amount = parseInt(args.amount) || 3;
                const x = args.x !== undefined ? parseInt(args.x) : undefined;
                const y = args.y !== undefined ? parseInt(args.y) : undefined;
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                return this.computerUse.scroll(direction, amount, x, y);
            }
        });

        // Skill: Computer Locate Element
        this.skills.registerSkill({
            name: 'computer_locate',
            description: 'Use AI vision to find an element on screen by description. Returns pixel coordinates. Useful for planning clicks on complex UIs, canvas apps, or non-DOM elements.',
            usage: 'computer_locate(description, context?)',
            handler: async (args: any) => {
                const description = args.description || args.element || args.target;
                if (!description) return 'Error: Missing description of element to locate.';
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                try {
                    const result = await this.computerUse.locateElement(description);
                    if (result.x < 0 || result.y < 0) {
                        return `Element not found: "${description}". It may not be visible on the current screen. Try scrolling or navigating to reveal it.`;
                    }
                    return `Found "${description}" at coordinates (${result.x}, ${result.y}) [confidence: ${result.confidence}]${result.description ? ` — ${result.description}` : ''}`;
                } catch (e) {
                    return `Failed to locate element: ${e}`;
                }
            }
        });

        // Skill: Computer Describe Screen
        this.skills.registerSkill({
            name: 'computer_describe',
            description: 'Use AI vision to describe what is on screen. Optionally focus on a region around given coordinates.',
            usage: 'computer_describe(x?, y?, radius?, context?)',
            handler: async (args: any) => {
                const ctx = args.context || args.mode || 'system';
                if (ctx === 'system' || ctx === 'desktop') this.computerUse.setContext('system');
                else if (ctx === 'browser' || ctx === 'page') this.computerUse.setContext('browser');

                const x = args.x !== undefined ? parseInt(args.x) : undefined;
                const y = args.y !== undefined ? parseInt(args.y) : undefined;
                const radius = args.radius ? parseInt(args.radius) : undefined;

                try {
                    return await this.computerUse.describeScreen(x, y, radius);
                } catch (e) {
                    return `Failed to describe screen: ${e}`;
                }
            }
        });

        // Skill: Create Custom Skill (CODE-BASED — writes a .ts plugin with executable logic)
        // Use create_custom_skill when you need to write RUNNABLE CODE (API calls, automation, data processing).
        // Use create_skill when you need to capture KNOWLEDGE/INSTRUCTIONS (workflows, guides, prompts).
        this.skills.registerSkill({
            name: 'create_custom_skill',
            description: 'Create a CODE-BASED plugin skill (.ts file) that executes logic. Use this for skills that need to RUN CODE — API integrations, data processing, browser automation, calculations, etc. For KNOWLEDGE-BASED skills (workflow instructions, prompt templates, reference guides), use create_skill instead.\n\nThe "code" argument must be the **BODY** of a Node.js async function.\n\nSYSTEM STANDARDS (MANDATORY):\n1. Do NOT wrap the code in `async function() { ... }` or `() => { ... }`. Provide ONLY the inner logic.\n2. Always `return` a string (or a value that can be safely stringified).\n3. Use `context.browser` for browser automation.\n4. Use `context.config.get(...)` for settings; never hardcode keys.\n5. To call another skill, use `await context.agent.skills.executeSkill("skill_name", { ... })` (or `execute`).\n6. Never access secrets directly; use config.\n7. Keep the plugin CommonJS-friendly and export a named skill object.',
            usage: 'create_custom_skill({ name, description, usage, code })',
            handler: async (args: any) => {
                if (this.config.get('safeMode')) {
                    return 'Error: Safe mode is enabled. Skill creation is disabled.';
                }
                const { name, description, usage, code } = args;
                if (!name || !code) return 'Error: Name and code are required.';

                // Validate skill name (alphanumeric + underscore only)
                if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
                    return 'Error: Skill name must be alphanumeric with underscores, starting with a letter.';
                }

                const pluginsDir = this.config.get('pluginsPath') || './plugins';
                if (!fs.existsSync(pluginsDir)) {
                    fs.mkdirSync(path.resolve(pluginsDir), { recursive: true });
                }

                const fileName = `${name}.ts`;
                const filePath = path.resolve(pluginsDir, fileName);

                // Sanitize code: Remove outer function wrappers if the AI messed up
                let sanitizedCode = code.trim();

                // Remove markdown code blocks if present
                sanitizedCode = sanitizedCode.replace(/^```(?:typescript|ts|javascript|js)?\n?/gm, '');
                sanitizedCode = sanitizedCode.replace(/```$/gm, '');
                sanitizedCode = sanitizedCode.trim();

                // Detect if the LLM provided a FULL MODULE instead of just the handler body
                // Signs: has `const ${name} =`, `export const`, `export default`, or multiple top-level declarations
                const looksLikeFullModule =
                    sanitizedCode.includes('export const') ||
                    sanitizedCode.includes('export default') ||
                    sanitizedCode.match(new RegExp(`const\\s+${name}\\s*=`)) ||
                    // Multiple const/let/var at top level suggests full module
                    (sanitizedCode.match(/^(const|let|var)\s+\w+\s*=/gm) || []).length > 1;

                if (looksLikeFullModule) {
                    // The LLM provided what looks like a full module - try to use it directly
                    // but ensure it has proper exports
                    let moduleCode = sanitizedCode;

                    // If it doesn't have exports, try to add them
                    if (!moduleCode.includes('export const') && !moduleCode.includes('export default')) {
                        // Look for the main skill declaration like: const skillName = { name: "...", handler: ... }
                        const skillDeclRegex = new RegExp(`const\\s+${name}\\s*=\\s*\\{[\\s\\S]*?handler\\s*:`);
                        if (skillDeclRegex.test(moduleCode)) {
                            // Add export to the skill declaration
                            moduleCode = moduleCode.replace(
                                new RegExp(`const\\s+${name}\\s*=`),
                                `export const ${name} =`
                            );
                            moduleCode += `\n\nexport default ${name};`;
                        } else {
                            // Can't figure out the structure - reject it
                            return `Error: The code looks like a full module but doesn't have the expected structure. Please provide ONLY the handler body (the code inside the handler function), not a full plugin file. The handler body should start with your logic, not with 'const' declarations for the skill itself.`;
                        }
                    }

                    // Add source header
                    const finalCode = `// @source: generated-by-orcbot\n// @generated: ${new Date().toISOString()}\n` + moduleCode;

                    // Write and try to load
                    fs.writeFileSync(filePath, finalCode);
                    this.skills.clearLoadError(name);

                    try {
                        this.skills.loadPlugins();
                        const loadError = this.skills.getLoadError(name);
                        if (loadError) {
                            try { fs.unlinkSync(filePath); } catch { }
                            return `Error: The provided module code has errors:\n${loadError}\n\nPlease provide corrected code.`;
                        }

                        const loaded = this.skills.getAllSkills().find(s => s.name === name);
                        if (!loaded) {
                            try { fs.unlinkSync(filePath); } catch { }
                            return `Error: The skill '${name}' failed to register. The module may be missing the required exports (name, description, usage, handler).`;
                        }

                        // Also generate SKILL.md wrapper so plugin is visible in both systems
                        this.generateSkillMdForPlugin(name, description || loaded?.description || '', filePath);
                        return `Skill '${name}' created from full module code at ${filePath} and registered successfully.`;
                    } catch (loadError: any) {
                        try { fs.unlinkSync(filePath); } catch { }
                        return `Error: Skill '${name}' has syntax errors: ${loadError?.message || loadError}`;
                    }
                }

                // Standard case: LLM provided just the handler body
                // Remove outer async function wrapper if present
                const functionWrapperRegex = /^(async\s+)?function\s*\w*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/;
                const arrowWrapperRegex = /^(async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/;
                // Also handle: const funcName = async (args) => { ... }
                const namedArrowRegex = /^const\s+\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/;

                let match = sanitizedCode.match(functionWrapperRegex);
                if (match) {
                    sanitizedCode = match[2].trim();
                } else {
                    match = sanitizedCode.match(arrowWrapperRegex);
                    if (match) {
                        sanitizedCode = match[2].trim();
                    } else {
                        match = sanitizedCode.match(namedArrowRegex);
                        if (match) {
                            sanitizedCode = match[2].trim();
                        }
                    }
                }

                // Check for obvious syntax issues
                const openBraces = (sanitizedCode.match(/\{/g) || []).length;
                const closeBraces = (sanitizedCode.match(/\}/g) || []).length;
                const openParens = (sanitizedCode.match(/\(/g) || []).length;
                const closeParens = (sanitizedCode.match(/\)/g) || []).length;

                if (openBraces !== closeBraces) {
                    return `Error: Mismatched braces in code. Open: ${openBraces}, Close: ${closeBraces}. Please fix and retry.`;
                }
                if (openParens !== closeParens) {
                    return `Error: Mismatched parentheses in code. Open: ${openParens}, Close: ${closeParens}. Please fix and retry.`;
                }

                // Check for await outside async context (common LLM mistake)
                // The handler is already async, so top-level await in the body is fine
                // But if there's a non-async nested function with await, that's an error
                const nonAsyncFunctionWithAwait = sanitizedCode.match(/function\s+\w+\s*\([^)]*\)\s*\{[^}]*\bawait\b/);
                if (nonAsyncFunctionWithAwait) {
                    return `Error: Found 'await' inside a non-async function. All functions that use 'await' must be declared as 'async'. Please fix and retry.`;
                }

                // Escape description and usage for embedding in string
                const safeDesc = (description || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');
                const safeUsage = (usage || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');

                // Build the plugin file
                const finalCode = code.includes('export const') || code.includes('export default') ? code : `
// @source: generated-by-orcbot
// @generated: ${new Date().toISOString()}
import { AgentContext } from '../src/core/SkillsManager';
import fs from 'fs';
import path from 'path';

export const ${name} = {
    name: "${name}",
    description: "${safeDesc}",
    usage: "${safeUsage}",
    handler: async (args: any, context: AgentContext) => {
        // INSTRUCTIONS FOR AI: 
        // 1. Use 'context.browser' to access the browser (e.g. context.browser.evaluate(...))
        // 2. Use 'context.config' to access settings.
        // 3. Use standard 'fetch' for external APIs.
        try {
            ${sanitizedCode}
        } catch (e: any) {
            return \`Error in ${name}: \${e?.message || e}\`;
        }
    }

};

export default ${name};
`;

                // Write the file
                fs.writeFileSync(filePath, finalCode);

                // Clear any previous load error for this skill name
                this.skills.clearLoadError(name);

                // Try to load it and catch errors
                try {
                    this.skills.loadPlugins();

                    // Check for load error
                    const loadError = this.skills.getLoadError(name);
                    if (loadError) {
                        // Skill had compilation errors - clean up
                        try { fs.unlinkSync(filePath); } catch { }
                        return `Error: Skill '${name}' has syntax/compilation errors and was not saved:\n${loadError}\n\nPlease fix the code and try again.`;
                    }

                    // Verify the skill actually loaded
                    const allSkills = this.skills.getAllSkills();
                    const loaded = allSkills.find(s => s.name === name);

                    if (!loaded) {
                        // Skill didn't load - clean up
                        try { fs.unlinkSync(filePath); } catch { }
                        return `Error: Skill '${name}' failed to load after creation. The code may have syntax errors or invalid exports. Please review and provide corrected code.`;
                    }

                    // Also generate SKILL.md wrapper so plugin is visible in both systems
                    this.generateSkillMdForPlugin(name, description || loaded?.description || '', filePath);
                    return `Skill '${name}' created at ${filePath} and registered successfully. You can use it immediately.`;
                } catch (loadError: any) {
                    // Delete the broken file
                    try { fs.unlinkSync(filePath); } catch { }
                    return `Error: Skill '${name}' has syntax errors and was not saved: ${loadError?.message || loadError}`;
                }
            }
        });

        // Skill: Install NPM Dependency
        this.skills.registerSkill({
            name: 'install_npm_dependency',
            description: 'Install an NPM package for use in custom skills.',
            usage: 'install_npm_dependency(packageName)',
            handler: async (args: any) => {
                const pkg = args.packageName || args.package;
                if (!pkg) return 'Error: Missing package name.';

                return new Promise((resolve) => {
                    const { exec } = require('child_process');
                    logger.info(`Agent: Installing NPM package '${pkg}'...`);
                    const child = exec(`npm install ${pkg}`, { timeout: 120000 }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            if (error.killed) {
                                resolve(`Error: Installation of '${pkg}' timed out after 120 seconds. It might still be running in the background, but I am moving on.`);
                            } else {
                                resolve(`Error installing '${pkg}': ${error.message}\n${stderr}`);
                            }
                        } else {
                            resolve(`Package '${pkg}' installed successfully.\n${stdout}`);
                        }
                    });
                });
            }
        });

        // Skill: Web Search
        this.skills.registerSkill({
            name: 'web_search',
            description: 'Search the web for information using multiple engines (APIs + browser fallback)',
            usage: 'web_search(query)',
            handler: async (args: any) => {
                let query = args.query || args.text || args.search || args.q;
                if (!query) return 'Error: Missing search query.';

                // Handle array or object queries - convert to string
                if (Array.isArray(query)) {
                    query = query.join(' ');
                } else if (typeof query === 'object') {
                    query = JSON.stringify(query);
                } else if (typeof query !== 'string') {
                    query = String(query);
                }

                query = query.trim();
                if (!query) return 'Error: Empty search query after processing.';

                logger.info(`Searching: "${query}"`);

                // First attempt with standard search (includes API + browser fallbacks)
                let result = await this.browser.search(query);

                // If all providers failed, try a direct deep browser search
                if (result.includes('Error: All search providers failed')) {
                    logger.warn('All standard search providers failed. Attempting deep browser search...');

                    // Try navigating directly and extracting any useful content
                    try {
                        // Try DuckDuckGo's no-JS version as final fallback
                        const deepResult = await this.browser.navigate(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);

                        if (deepResult && !deepResult.includes('Error')) {
                            // Extract links from the page content
                            const links = await this.browser.page?.evaluate(() => {
                                const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
                                return anchors
                                    .filter(a => {
                                        const href = (a as HTMLAnchorElement).href;
                                        return !href.includes('duckduckgo') &&
                                            !href.includes('duck.co') &&
                                            a.textContent && a.textContent.trim().length > 5;
                                    })
                                    .slice(0, 5)
                                    .map(a => ({
                                        title: a.textContent?.trim() || '',
                                        url: (a as HTMLAnchorElement).href
                                    }));
                            });

                            if (links && links.length > 0) {
                                const formatted = links.map((l: any) => `• [${l.title}](${l.url})`).join('\n');
                                return `Search Results (via lite browser):\n\n${formatted}\n\n[Note: Limited results due to search API unavailability. Consider configuring Serper API for better results.]`;
                            }
                        }
                    } catch (e) {
                        logger.debug(`Deep browser search failed: ${e}`);
                    }

                    // Final fallback: Provide guidance
                    return `Unable to search at this time. Search services are unavailable.\n\nSuggestions:\n• Try again in a few minutes\n• Use browse_website to visit a specific URL directly\n• Configure a search API (Serper, Brave) for reliable results\n\nQuery attempted: "${query}"`;
                }

                return result;
            }
        });

        // Skill: YouTube Trending (reliable fallback for YouTube)
        this.skills.registerSkill({
            name: 'youtube_trending',
            description: 'Get trending videos from YouTube. More reliable than browser navigation for YouTube content.',
            usage: 'youtube_trending(region?, category?)',
            handler: async (args: any) => {
                const region = args.region || args.country || 'US';
                const category = args.category || 'all';

                try {
                    // Try YouTube's public RSS/Atom feeds first (no API key needed)
                    // These don't give "trending" but popular channels work
                    // For trending, we need to use a different approach

                    // Method 1: Use Invidious API (public YouTube frontend)
                    const invidiousInstances = [
                        'https://vid.puffyan.us',
                        'https://invidious.snopyta.org',
                        'https://yewtu.be',
                        'https://invidious.kavin.rocks'
                    ];

                    for (const instance of invidiousInstances) {
                        try {
                            const response = await fetch(`${instance}/api/v1/trending?region=${region}`, {
                                headers: { 'Accept': 'application/json' },
                                signal: AbortSignal.timeout(10000)
                            });

                            if (response.ok) {
                                const videos = await response.json() as any[];
                                if (videos && videos.length > 0) {
                                    const formatted = videos.slice(0, 10).map((v: any, i: number) =>
                                        `${i + 1}. **${v.title}**\n   Channel: ${v.author}\n   Views: ${v.viewCount?.toLocaleString() || 'N/A'}\n   Link: https://youtube.com/watch?v=${v.videoId}`
                                    ).join('\n\n');

                                    return `🔥 **YouTube Trending (${region})**\n\n${formatted}\n\n[via Invidious API]`;
                                }
                            }
                        } catch (e) {
                            logger.debug(`Invidious instance ${instance} failed: ${e}`);
                            continue;
                        }
                    }

                    // Method 2: Fallback to web search for "youtube trending today"
                    logger.warn('Invidious APIs unavailable. Falling back to web search...');
                    const searchResult = await this.browser.search(`youtube trending videos today ${region}`);

                    if (!searchResult.includes('Error')) {
                        return `Could not fetch direct YouTube trending data. Here are search results about trending videos:\n\n${searchResult}`;
                    }

                    return `Unable to fetch YouTube trending at this time. YouTube actively blocks automated access.\n\nAlternatives:\n• Visit https://www.youtube.com/feed/trending manually\n• Check social media for trending video discussions\n• Try a specific search query with web_search`;

                } catch (e) {
                    return `Error fetching YouTube trending: ${e}`;
                }
            }
        });

        // Skill: Extract Article
        this.skills.registerSkill({
            name: 'extract_article',
            description: 'Extract clean text content from a news or article link. Optional: if "url" is omitted, extracts from the current active browser page.',
            usage: 'extract_article(url?)',
            handler: async (args: any) => {
                const url = args.url || args.link;
                try {
                    let html = '';
                    if (url) {
                        // Reuse the shared browser instance — do NOT spawn a new Playwright process
                        const navResult = await this.browser.navigate(url);
                        if (navResult.startsWith('Error')) return navResult;
                        if (!this.browser.page) return 'Error: Browser page unavailable after navigation.';
                        html = await this.browser.page.content();
                    } else {
                        // Extract from current active session
                        if (!this.browser.page) return 'Error: No active browser page to extract from. Provide a URL.';
                        html = await this.browser.page.content();
                    }

                    // Try Readability (best quality for news/articles)
                    try {
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const reader = new Readability(doc as any);
                        const article = reader.parse();
                        if (article && article.textContent && article.textContent.trim().length > 100) {
                            return `Title: ${article.title}\n\nContent:\n${article.textContent.substring(0, 5000)}`;
                        }
                    } catch (readErr) {
                        logger.debug(`extract_article: Readability failed (${readErr}), falling back to extractContent()`);
                    }

                    // Fallback: built-in content extractor
                    const extracted = await this.browser.extractContent();
                    if (extracted.startsWith('Error') || extracted.startsWith('Failed')) {
                        return 'Failed to extract article content: page may be paywalled, JavaScript-heavy, or empty.';
                    }
                    return extracted;
                } catch (e) {
                    return `Error extracting article: ${e}`;
                }
            }
        });

        // Skill: HTTP Fetch (lightweight, no browser)
        this.skills.registerSkill({
            name: 'http_fetch',
            description: 'Fetch a URL using a simple HTTP request (no browser needed). Supports GET, POST, PUT, PATCH, DELETE. Returns the response body as text or JSON. Much faster and lighter than browser_navigate for APIs, JSON endpoints, and simple web pages.',
            usage: 'http_fetch(url, method?, headers?, body?, timeout?)',
            handler: async (args: any) => {
                const url = args.url || args.link;
                if (!url) return 'Error: Missing url.';

                const method = (args.method || 'GET').toUpperCase();
                const timeoutMs = parseInt(args.timeout || '30000', 10);
                let headers: Record<string, string> = {};

                // Parse headers
                if (args.headers) {
                    if (typeof args.headers === 'string') {
                        try { headers = JSON.parse(args.headers); } catch { /* ignore */ }
                    } else if (typeof args.headers === 'object') {
                        headers = args.headers;
                    }
                }

                // Set a default User-Agent if none provided
                if (!headers['User-Agent'] && !headers['user-agent']) {
                    headers['User-Agent'] = 'OrcBot/1.0';
                }

                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeoutMs);

                    const fetchOptions: RequestInit = {
                        method,
                        headers,
                        signal: controller.signal,
                        redirect: 'follow',
                    };

                    // Attach body for non-GET methods
                    if (args.body && method !== 'GET' && method !== 'HEAD') {
                        if (typeof args.body === 'object') {
                            fetchOptions.body = JSON.stringify(args.body);
                            if (!headers['Content-Type'] && !headers['content-type']) {
                                (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
                            }
                        } else {
                            fetchOptions.body = String(args.body);
                        }
                    }

                    const response = await fetch(url, fetchOptions);
                    clearTimeout(timer);

                    const status = response.status;
                    const statusText = response.statusText;
                    const contentType = response.headers.get('content-type') || '';
                    const responseHeaders: Record<string, string> = {};
                    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

                    let body: string;
                    if (contentType.includes('application/json')) {
                        try {
                            const json = await response.json();
                            body = JSON.stringify(json, null, 2);
                        } catch {
                            body = await response.text();
                        }
                    } else {
                        body = await response.text();
                    }

                    // Truncate very large responses
                    const maxLen = 8000;
                    const originalLen = body.length;
                    const truncated = originalLen > maxLen;
                    if (truncated) {
                        body = body.substring(0, maxLen);
                    }

                    return `HTTP ${status} ${statusText}\nContent-Type: ${contentType}\n\n${body}${truncated ? '\n\n[...truncated, response was ' + originalLen + '+ chars]' : ''}`;
                } catch (e: any) {
                    if (e.name === 'AbortError') {
                        return `Error: Request timed out after ${timeoutMs}ms`;
                    }
                    return `Error: ${e.message}`;
                }
            }
        });

        // Skill: Schedule Task (one-off, tracked + persisted)
        this.skills.registerSkill({
            name: 'schedule_task',
            description: 'Schedule a one-off task to run later. Supports relative time (e.g. "in 15 minutes", "in 2 hours", "in 1 day") or cron syntax. Returns an ID you can use with schedule_list / schedule_remove.',
            usage: 'schedule_task(time_or_cron, task_description)',
            handler: async (args: any) => {
                const time_or_cron = args.time_or_cron || args.time || args.schedule;
                const task_description = args.task_description || args.task || args.description;

                if (!time_or_cron || !task_description) return 'Error: Missing time_or_cron or task_description.';

                try {
                    let schedule: string | Date = time_or_cron;
                    let scheduledFor: string = time_or_cron; // human-readable
                    const relativeMatch = time_or_cron.match(/in (\d+) (second|minute|hour|day)s?/i);
                    if (relativeMatch) {
                        const amount = parseInt(relativeMatch[1]);
                        const unit = relativeMatch[2].toLowerCase();
                        const date = new Date();
                        if (unit.startsWith('second')) date.setSeconds(date.getSeconds() + amount);
                        if (unit.startsWith('minute')) date.setMinutes(date.getMinutes() + amount);
                        if (unit.startsWith('hour')) date.setHours(date.getHours() + amount);
                        if (unit.startsWith('day')) date.setDate(date.getDate() + amount);
                        schedule = date;
                        scheduledFor = date.toISOString();
                    }

                    const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                    const cron = new Cron(schedule, () => {
                        logger.info(`⏰ Scheduled Task Triggered [${id}]: ${task_description}`);
                        this.pushTask(`Scheduled Task: ${task_description}`, 8);
                        // Auto-cleanup after firing
                        this.scheduledTasks.delete(id);
                        this.scheduledTaskMeta.delete(id);
                        this.persistScheduledTasks();
                    });

                    const meta = {
                        id,
                        task: task_description,
                        scheduledFor,
                        createdAt: new Date().toISOString(),
                        rawInput: time_or_cron
                    };

                    this.scheduledTasks.set(id, cron);
                    this.scheduledTaskMeta.set(id, meta);
                    this.persistScheduledTasks();

                    return `✅ Task scheduled (id=${id}) for ${scheduledFor}: "${task_description}"`;
                } catch (e) {
                    return `Failed to schedule task: ${e}`;
                }
            }
        });

        // Skill: List Scheduled Tasks (one-off)
        this.skills.registerSkill({
            name: 'schedule_list',
            description: 'List all pending one-off scheduled tasks. For recurring schedules, use heartbeat_list.',
            usage: 'schedule_list()',
            handler: async () => {
                const list = Array.from(this.scheduledTaskMeta.values());
                if (list.length === 0) return 'No pending scheduled tasks.';
                return list.map((s: any) => `• ${s.id} → fires at ${s.scheduledFor} → "${s.task}" (created ${s.createdAt})`).join('\n');
            }
        });

        // Skill: Remove/Cancel a Scheduled Task
        this.skills.registerSkill({
            name: 'schedule_remove',
            description: 'Cancel a pending scheduled task by its ID.',
            usage: 'schedule_remove(id)',
            handler: async (args: any) => {
                const id = args.id || args.task_id;
                if (!id) return 'Error: Missing id.';
                const cron = this.scheduledTasks.get(id);
                if (!cron) return `No scheduled task found for id=${id}.`;
                cron.stop();
                this.scheduledTasks.delete(id);
                this.scheduledTaskMeta.delete(id);
                this.persistScheduledTasks();
                return `Scheduled task cancelled: ${id}`;
            }
        });

        // Skill: Heartbeat Schedule
        this.skills.registerSkill({
            name: 'heartbeat_schedule',
            description: 'Schedule recurring heartbeat tasks (e.g., every 2 hours) that run autonomously.',
            usage: 'heartbeat_schedule(schedule, task_description, priority?)',
            handler: async (args: any) => {
                const scheduleInput = args.schedule || args.time_or_cron || args.time;
                const task_description = args.task_description || args.task || args.description;
                const priority = parseInt(args.priority || '6', 10);

                if (!scheduleInput || !task_description) return 'Error: Missing schedule or task_description.';

                try {
                    const schedule = this.normalizeHeartbeatSchedule(String(scheduleInput));
                    const id = `hb_${Math.random().toString(36).slice(2, 10)}`;

                    const def = {
                        id,
                        schedule,
                        task: task_description,
                        priority: Math.max(1, Math.min(10, priority)),
                        createdAt: new Date().toISOString()
                    };

                    this.registerHeartbeatSchedule(def, true);
                    return `Heartbeat scheduled (id=${id}) at: ${schedule}`;
                } catch (e) {
                    return `Failed to schedule heartbeat: ${e}`;
                }
            }
        });

        // Skill: Heartbeat List
        this.skills.registerSkill({
            name: 'heartbeat_list',
            description: 'List all heartbeat schedules.',
            usage: 'heartbeat_list()',
            handler: async () => {
                const list = Array.from(this.heartbeatJobMeta.values());
                if (list.length === 0) return 'No heartbeat schedules found.';
                return list.map((s: any) => `• ${s.id} → ${s.schedule} → ${s.task} (priority ${s.priority})`).join('\n');
            }
        });

        // Skill: Heartbeat Remove
        this.skills.registerSkill({
            name: 'heartbeat_remove',
            description: 'Remove a heartbeat schedule by id.',
            usage: 'heartbeat_remove(id)',
            handler: async (args: any) => {
                const id = args.id || args.heartbeat_id;
                if (!id) return 'Error: Missing id.';
                if (!this.heartbeatJobs.has(id)) return `No heartbeat schedule found for id=${id}.`;
                this.removeHeartbeatSchedule(String(id));
                return `Heartbeat schedule removed: ${id}`;
            }
        });

        // Skill: Deep Reasoning
        this.skills.registerSkill({
            name: 'deep_reason',
            description: 'Perform an intensive analysis of a topic with multiple steps',
            usage: 'deep_reason(topic)',
            handler: async (args: any) => {
                const topic = args.topic || args.subject || args.query || args.text;
                if (!topic) return 'Error: Missing topic.';

                const system = `You are an elite reasoning engine. Use a meticulous chain-of-thought to analyze the topic.
Break it into components, evaluate pros/cons, and synthesize a deep conclusion.
Be thorough and academic.`;
                return this.llm.call(topic, system);
            }
        });

        // Skill: Learn User Info
        this.skills.registerSkill({
            name: 'update_user_profile',
            description: 'Save permanent information learned about the user (name, preferences, habits, goals). Use this PROACTIVELY whenever you learn something new about the user.',
            usage: 'update_user_profile(info_text)',
            handler: async (args: any) => {
                const info_text = args.info_text || args.info || args.text || args.data;
                if (!info_text) return 'Error: Missing info_text.';

                const userPath = this.config.get('userProfilePath');
                try {
                    // Prepend date for chronological history
                    const entry = `\n- [${new Date().toLocaleDateString()}] ${info_text}`;
                    fs.appendFileSync(userPath, entry);
                    this.memory.refreshUserContext(userPath);
                    logger.info(`User Profile Updated: ${info_text}`);
                    return `Successfully updated user profile with: "${info_text}"`;
                } catch (e) {
                    return `Failed to update profile at ${userPath}: ${e}`;
                }
            }
        });

        // Skill: Evolve Identity (legacy .AI.md compatibility)
        this.skills.registerSkill({
            name: 'update_agent_identity',
            description: 'Update your own identity, personality, or name. Provide a snippet or a full block. Deprecated: Use update_bootstrap_file("IDENTITY.md", content) instead.',
            usage: 'update_agent_identity(trait)',
            handler: async (args: any) => {
                const trait = args.trait || args.info || args.text;
                if (!trait) return 'Error: Missing trait information.';

                const identityPath = this.config.get('agentIdentityPath');
                try {
                    // If the trait looks like a full block or a specific name update, we overwrite/restructure.
                    if (trait.startsWith('#') || trait.includes('Name:')) {
                        fs.writeFileSync(identityPath, trait.trim());
                        this.loadAgentIdentity();
                        return `Identity completely redefined at ${identityPath}.`;
                    } else {
                        fs.appendFileSync(identityPath, `\n- Learned Trait: ${trait}`);
                        this.loadAgentIdentity();
                        return `Successfully added trait to agent identity at ${identityPath}: "${trait}"`;
                    }
                } catch (e) {
                    return `Failed to update identity at ${identityPath}: ${e}`;
                }
            }
        });

        // Skill: Update Bootstrap File (IDENTITY.md, SOUL.md, AGENTS.md, etc.)
        this.skills.registerSkill({
            name: 'update_bootstrap_file',
            description: 'Update a bootstrap file (IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, USER.md). These files define your identity, persona, operating instructions, and user context. Use this to evolve your identity and capabilities.',
            usage: 'update_bootstrap_file(filename, content, mode?)',
            handler: async (args: any) => {
                const filename = args.filename || args.file;
                const content = args.content || args.text;
                const mode = args.mode || 'replace'; // 'replace' or 'append'

                if (!filename) return 'Error: Missing filename (e.g., "IDENTITY.md", "SOUL.md").';
                if (!content) return 'Error: Missing content to write.';

                const validFiles = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'];
                if (!validFiles.includes(filename)) {
                    return `Error: Invalid filename. Must be one of: ${validFiles.join(', ')}`;
                }

                try {
                    if (mode === 'append') {
                        const current = this.bootstrap.getFile(filename) || '';
                        const updated = current + '\n\n' + content;
                        this.bootstrap.updateFile(filename, updated);
                        return `Successfully appended to ${filename}`;
                    } else {
                        this.bootstrap.updateFile(filename, content);
                        return `Successfully updated ${filename}`;
                    }
                } catch (e) {
                    return `Failed to update ${filename}: ${e}`;
                }
            }
        });

        // Skill: Read Bootstrap File
        this.skills.registerSkill({
            name: 'read_bootstrap_file',
            description: 'Read the contents of a bootstrap file (IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, USER.md).',
            usage: 'read_bootstrap_file(filename)',
            handler: async (args: any) => {
                const filename = args.filename || args.file;
                if (!filename) return 'Error: Missing filename.';

                const validFiles = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'];
                if (!validFiles.includes(filename)) {
                    return `Error: Invalid filename. Must be one of: ${validFiles.join(', ')}`;
                }

                try {
                    const content = this.bootstrap.getFile(filename);
                    if (!content) {
                        return `${filename} is empty or does not exist.`;
                    }
                    return `Contents of ${filename}:\n\n${content}`;
                } catch (e) {
                    return `Failed to read ${filename}: ${e}`;
                }
            }
        });

        // Skill: List Bootstrap Files
        this.skills.registerSkill({
            name: 'list_bootstrap_files',
            description: 'List all bootstrap files and their status (exists, size).',
            usage: 'list_bootstrap_files()',
            handler: async () => {
                try {
                    const files = this.bootstrap.listFiles();
                    const result = files.map(f =>
                        `- ${f.name}: ${f.exists ? `${f.size} bytes` : 'not created'}`
                    ).join('\n');
                    return `Bootstrap files:\n${result}`;
                } catch (e) {
                    return `Failed to list bootstrap files: ${e}`;
                }
            }
        });

        // Skill: Update Journal
        this.skills.registerSkill({
            name: 'update_journal',
            description: 'Record a self-reflection entry or activity log in JOURNAL.md',
            usage: 'update_journal(entry_text)',
            handler: async (args: any) => {
                const entry_text = args.entry_text || args.entry || args.text;
                if (!entry_text) return 'Error: Missing entry_text.';

                const journalPath = this.config.get('journalPath');
                try {
                    fs.appendFileSync(journalPath, `\n\n## [${new Date().toISOString()}] Reflection\n${entry_text}`);
                    return `Journal entry saved to ${journalPath}`;
                } catch (e) {
                    return `Failed to update journal at ${journalPath}: ${e}`;
                }
            }
        });

        // Skill: Update Learning - with actual research capability
        this.skills.registerSkill({
            name: 'update_learning',
            description: 'Research a topic using web search and save structured findings to LEARNING.md. If knowledge_content is empty, will auto-research the topic.',
            usage: 'update_learning(topic, knowledge_content?)',
            handler: async (args: any) => {
                const topic = args.topic || args.subject || args.title;
                let knowledge_content = args.knowledge_content || args.content || args.text || args.data;

                if (!topic) return 'Error: Missing topic.';

                // If no content provided, auto-research the topic
                if (!knowledge_content || knowledge_content.trim().length < 50) {
                    try {
                        logger.info(`Learning: Auto-researching topic "${topic}"...`);
                        const searchResult = await this.browser.search(`${topic} latest developments 2024 2025`);

                        if (searchResult && searchResult.length > 100) {
                            // Extract key facts using LLM — cap input to avoid huge prompts
                            const extractPrompt = `Extract 5-10 key facts/insights from this search result about "${topic}". Format as bullet points with clear, factual statements:\n\n${searchResult.slice(0, 3000)}`;
                            const extracted = await this.llm.call(extractPrompt, 'Extract key learnings');
                            knowledge_content = extracted || searchResult.slice(0, 1500);
                        } else {
                            return `Could not find sufficient information about "${topic}" to learn from.`;
                        }
                    } catch (e) {
                        return `Failed to research topic "${topic}": ${e}`;
                    }
                }

                // Cap manually-provided content to 3000 chars to keep LEARNING.md readable
                const MAX_LEARNING_CHARS = 3000;
                let storedContent = String(knowledge_content);
                const wasTruncated = storedContent.length > MAX_LEARNING_CHARS;
                if (wasTruncated) {
                    storedContent = storedContent.substring(0, MAX_LEARNING_CHARS) + '\n\n[...truncated]';
                }

                const learningPath = this.config.get('learningPath');
                try {
                    const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${storedContent}\n\n---`;
                    fs.appendFileSync(learningPath, entry);
                    this.lastHeartbeatProductive = true; // Mark as productive
                    logger.info(`Learning: Saved knowledge about "${topic}" to ${learningPath}`);
                    return `Successfully researched and saved knowledge about "${topic}" to LEARNING.md${wasTruncated ? ' (content was truncated to 3000 chars)' : ''}`;
                } catch (e) {
                    return `Failed to update learning base at ${learningPath}: ${e}`;
                }
            }
        });

        // Skill: Request Supporting Data
        this.skills.registerSkill({
            name: 'request_supporting_data',
            description: 'Pause execution and ask the user for missing information, credentials, or clarification. Sends the question through the active channel before pausing.',
            usage: 'request_supporting_data(question)',
            handler: async (args: any) => {
                const question = args.question || args.text || args.info;
                if (!question) return 'Error: Missing question.';

                // Best-effort: send the question through the channel that originated this action
                try {
                    const currentAction = this.actionQueue.getQueue().find(a => a.id === this.currentActionId);
                    const source = currentAction?.payload?.source;
                    const chatId = currentAction?.payload?.chatId || currentAction?.payload?.sourceId;
                    if (chatId) {
                        if (source === 'telegram' && this.telegram) {
                            await this.telegram.sendMessage(chatId, `❓ ${question}`);
                        } else if (source === 'discord' && this.discord) {
                            await this.discord.sendMessage(chatId, `❓ ${question}`);
                        } else if (source === 'whatsapp' && this.whatsapp) {
                            await this.whatsapp.sendMessage(chatId, `❓ ${question}`);
                        } else if (this.telegram) {
                            await this.telegram.sendMessage(chatId, `❓ ${question}`);
                        }
                    }
                } catch (e) {
                    logger.warn(`request_supporting_data: failed to send question: ${e}`);
                }

                // The agent loop detects this sentinel and pauses the action
                return `CLARIFICATION_REQUESTED: ${question}`;
            }
        });

        // Skill: Cancel Action
        this.skills.registerSkill({
            name: 'cancel_action',
            description: 'Cancel a queued or running action by ID. If the action is currently running, it will stop at the next safe checkpoint.',
            usage: 'cancel_action(action_id, reason?)',
            handler: async (args: any) => {
                const actionId = args.action_id || args.id;
                const reason = args.reason || args.message || 'Cancelled by user';
                if (!actionId) return 'Error: Missing action_id.';

                const action = this.actionQueue.getQueue().find(a => a.id === actionId);
                if (!action) return `Action ${actionId} not found.`;

                if (this.currentActionId === actionId && this.isBusy) {
                    this.cancelledActions.add(actionId);
                    return `Action ${actionId} cancellation requested. It will stop shortly.`;
                }

                this.actionQueue.updateStatus(actionId, 'failed');
                return `Action ${actionId} cancelled (status set to failed).`;
            }
        });

        // Skill: Clear Action Queue
        this.skills.registerSkill({
            name: 'clear_action_queue',
            description: 'Fail all pending/in-progress actions and stop any currently running action.',
            usage: 'clear_action_queue(reason?)',
            handler: async (args: any) => {
                const reason = args.reason || args.message || 'Cleared by user';
                const queue = this.actionQueue.getQueue();
                let cleared = 0;

                for (const action of queue) {
                    if (action.status === 'pending' || action.status === 'waiting' || action.status === 'in-progress') {
                        if (this.currentActionId === action.id && this.isBusy) {
                            this.cancelledActions.add(action.id);
                        }
                        this.actionQueue.updateStatus(action.id, 'failed');
                        cleared++;
                    }
                }

                return `Cleared ${cleared} action(s). Reason: ${reason}`;
            }
        });

        // ==================== MULTI-AGENT ORCHESTRATION SKILLS ====================
        // Workers MUST NOT have orchestration capabilities — prevents recursive
        // spawning and circular delegation. Only the primary agent orchestrates.
        if (!this.isWorker) {

            // Skill: Spawn Agent (Self-Duplication)
            this.skills.registerSkill({
                name: 'spawn_agent',
                description: 'Create a new sub-agent instance for parallel task execution. The spawned agent inherits capabilities and can work independently.',
                usage: 'spawn_agent(name, role, capabilities?)',
                handler: async (args: any) => {
                    const name = args.name || args.agent_name;
                    const role = args.role || 'worker';
                    const capabilities = args.capabilities || ['execute'];

                    if (!name) return 'Error: Missing agent name.';

                    try {
                        const agent = this.orchestrator.spawnAgent({
                            name,
                            role,
                            capabilities: Array.isArray(capabilities) ? capabilities : [capabilities]
                        });
                        return `Successfully spawned agent "${agent.name}" (ID: ${agent.id}) with role "${agent.role}" and capabilities: ${agent.capabilities.join(', ')}`;
                    } catch (e) {
                        return `Error spawning agent: ${e}`;
                    }
                }
            });

            // Skill: List Agents
            this.skills.registerSkill({
                name: 'list_agents',
                description: 'List all agent instances in the orchestration layer with their status and current tasks.',
                usage: 'list_agents()',
                handler: async () => {
                    const agents = this.orchestrator.getAgents();
                    if (agents.length === 0) return 'No agents registered.';

                    return agents.map(a => {
                        const taskInfo = a.currentTask ? ` [Task: ${a.currentTask}]` : '';
                        return `- ${a.name} (${a.id}): ${a.status}${taskInfo} | Role: ${a.role} | Capabilities: ${a.capabilities.join(', ')}`;
                    }).join('\n');
                }
            });

            // Skill: Terminate Agent
            this.skills.registerSkill({
                name: 'terminate_agent',
                description: 'Terminate a spawned agent instance. Cannot terminate the primary agent.',
                usage: 'terminate_agent(agent_id)',
                handler: async (args: any) => {
                    const agentId = args.agent_id || args.id;
                    if (!agentId) return 'Error: Missing agent_id.';

                    const success = this.orchestrator.terminateAgent(agentId);
                    return success
                        ? `Agent ${agentId} terminated successfully.`
                        : `Failed to terminate agent ${agentId}. It may not exist or is the primary agent.`;
                }
            });

            // Skill: Delegate Task
            this.skills.registerSkill({
                name: 'delegate_task',
                description: 'Create a task and optionally assign it to a specific agent or let the orchestrator auto-assign.',
                usage: 'delegate_task(description, priority?, agent_id?)',
                handler: async (args: any) => {
                    const description = args.description || args.task || args.text;
                    const priority = parseInt(args.priority || '5');
                    const agentId = args.agent_id || args.id;

                    if (!description) return 'Error: Missing task description.';

                    const task = this.orchestrator.createTask(description, priority);

                    if (agentId) {
                        const assigned = this.orchestrator.assignTask(task.id, agentId);
                        if (assigned) {
                            return `Task "${task.id}" created and assigned to agent ${agentId}.`;
                        } else {
                            return `Task "${task.id}" created but could not be assigned to ${agentId} (agent busy or not found). Task is pending.`;
                        }
                    }

                    return `Task "${task.id}" created with priority ${priority}. Use distribute_tasks() to auto-assign or assign manually.`;
                }
            });

            // Skill: Distribute Tasks
            this.skills.registerSkill({
                name: 'distribute_tasks',
                description: 'Auto-assign all pending tasks to available agents based on priority and capability.',
                usage: 'distribute_tasks()',
                handler: async () => {
                    const assigned = this.orchestrator.distributeTasks();
                    return assigned > 0
                        ? `Distributed ${assigned} task(s) to available agents.`
                        : 'No tasks were distributed. Either no pending tasks or no available agents.';
                }
            });

            // Skill: Get Orchestrator Status
            this.skills.registerSkill({
                name: 'orchestrator_status',
                description: 'Get a summary of the multi-agent orchestration layer including agent and task counts.',
                usage: 'orchestrator_status()',
                handler: async () => {
                    return this.orchestrator.getSummary();
                }
            });

            // Skill: Complete Delegated Task
            this.skills.registerSkill({
                name: 'complete_delegated_task',
                description: 'Mark a delegated task as completed with an optional result.',
                usage: 'complete_delegated_task(task_id, result?)',
                handler: async (args: any) => {
                    const taskId = args.task_id || args.id;
                    const result = args.result || args.output;

                    if (!taskId) return 'Error: Missing task_id.';

                    const success = this.orchestrator.completeTask(taskId, result);
                    return success
                        ? `Task ${taskId} marked as completed.`
                        : `Failed to complete task ${taskId}. Task may not exist.`;
                }
            });

            // Skill: Fail Delegated Task
            this.skills.registerSkill({
                name: 'fail_delegated_task',
                description: 'Mark a delegated task as failed with an error message.',
                usage: 'fail_delegated_task(task_id, error)',
                handler: async (args: any) => {
                    const taskId = args.task_id || args.id;
                    const error = args.error || args.reason || 'Unknown error';

                    if (!taskId) return 'Error: Missing task_id.';

                    const success = this.orchestrator.failTask(taskId, error);
                    return success
                        ? `Task ${taskId} marked as failed.`
                        : `Failed to update task ${taskId}. Task may not exist.`;
                }
            });

            // Skill: Cancel Delegated Task
            this.skills.registerSkill({
                name: 'cancel_delegated_task',
                description: 'Cancel a delegated task in the orchestrator and mark it as failed.',
                usage: 'cancel_delegated_task(task_id, reason?)',
                handler: async (args: any) => {
                    const taskId = args.task_id || args.id;
                    const reason = args.reason || args.message || 'Cancelled by user';

                    if (!taskId) return 'Error: Missing task_id.';

                    const success = this.orchestrator.cancelTask(taskId, reason);
                    return success
                        ? `Delegated task ${taskId} cancelled.`
                        : `Failed to cancel task ${taskId}. Task may not exist.`;
                }
            });

            // Skill: Send Agent Message
            this.skills.registerSkill({
                name: 'send_agent_message',
                description: 'Send a message from one agent to another for inter-agent communication.',
                usage: 'send_agent_message(to_agent_id, message, type?)',
                handler: async (args: any) => {
                    const to = args.to_agent_id || args.to;
                    const message = args.message || args.content || args.text;
                    const type = args.type || 'command';

                    if (!to || !message) return 'Error: Missing to_agent_id or message.';

                    const msg = this.orchestrator.sendMessage('primary', to, type as any, { message });
                    return `Message sent to ${to}: ${msg.id}`;
                }
            });

            // Skill: Broadcast to Agents
            this.skills.registerSkill({
                name: 'broadcast_to_agents',
                description: 'Broadcast a message to all active agents.',
                usage: 'broadcast_to_agents(message)',
                handler: async (args: any) => {
                    const message = args.message || args.content || args.text;
                    if (!message) return 'Error: Missing message.';

                    this.orchestrator.broadcast('primary', { message });
                    const agents = this.orchestrator.getAgents().filter(a => a.status !== 'terminated' && a.id !== 'primary');
                    return `Broadcast sent to ${agents.length} agent(s).`;
                }
            });

            // Skill: Get Agent Messages
            this.skills.registerSkill({
                name: 'get_agent_messages',
                description: 'Retrieve messages sent to a specific agent.',
                usage: 'get_agent_messages(agent_id?, limit?)',
                handler: async (args: any) => {
                    const agentId = args.agent_id || args.id || 'primary';
                    const limit = parseInt(args.limit || '20');

                    const messages = this.orchestrator.getMessagesFor(agentId, limit);
                    if (messages.length === 0) return `No messages for agent ${agentId}.`;

                    return messages.map(m =>
                        `[${m.timestamp}] From: ${m.from} | Type: ${m.type}\n  ${JSON.stringify(m.payload)}`
                    ).join('\n\n');
                }
            });

            // Skill: Clone Self
            this.skills.registerSkill({
                name: 'clone_self',
                description: 'Create a clone of the primary agent with inherited capabilities for parallel processing.',
                usage: 'clone_self(clone_name, specialized_role?)',
                handler: async (args: any) => {
                    const cloneName = args.clone_name || args.name || `Clone-${Date.now()}`;
                    const role = args.specialized_role || args.role || 'clone';

                    const clone = this.orchestrator.spawnAgent({
                        name: cloneName,
                        role,
                        capabilities: ['execute', 'browse', 'search', 'analyze']
                    });

                    return `Created clone "${clone.name}" (${clone.id}) with full capabilities. Use delegate_task() to assign work to this clone.`;
                }
            });

            // Skill: Get Worker Token Usage
            this.skills.registerSkill({
                name: 'get_worker_token_usage',
                description: 'Get aggregated token usage across all worker agents, broken down by real API-reported vs estimated tokens.',
                usage: 'get_worker_token_usage()',
                handler: async () => {
                    const workerTokens = this.orchestrator.getAggregateWorkerTokenUsage();
                    if (workerTokens.length === 0) return 'No worker token usage data available. Workers may not have been active yet.';

                    let total = 0, totalReal = 0, totalEst = 0;
                    const lines = workerTokens.map(wt => {
                        total += wt.totalTokens;
                        totalReal += wt.realTokens;
                        totalEst += wt.estimatedTokens;
                        return `- ${wt.name} (${wt.agentId}): ${wt.totalTokens.toLocaleString()} tokens (${wt.realTokens.toLocaleString()} real, ${wt.estimatedTokens.toLocaleString()} estimated)`;
                    });
                    lines.push(`\nTotal across workers: ${total.toLocaleString()} tokens (${totalReal.toLocaleString()} real, ${totalEst.toLocaleString()} estimated)`);
                    return lines.join('\n');
                }
            });

            // Skill: Get Detailed Worker Status
            this.skills.registerSkill({
                name: 'get_worker_status',
                description: 'Get detailed status of all worker agents including PID, current task, and whether they are running.',
                usage: 'get_worker_status()',
                handler: async () => {
                    const workers = this.orchestrator.getDetailedWorkerStatus();
                    if (workers.length === 0) return 'No worker agents are currently registered.';

                    return workers.map(w => {
                        const taskInfo = w.currentTaskDescription ? `\n  Task: ${w.currentTaskDescription.slice(0, 100)}...` : '';
                        return `- ${w.name} (${w.agentId}): ${w.status} | PID: ${w.pid || 'N/A'} | Running: ${w.isRunning} | Role: ${w.role}${taskInfo}`;
                    }).join('\n');
                }
            });

        } // end !isWorker orchestration skills guard

        // ============ SELF-TUNING SKILLS ============

        // Skill: Get Tunable Options
        this.skills.registerSkill({
            name: 'get_tuning_options',
            description: 'Get all available settings that can be tuned. Use this to discover what you can adjust.',
            usage: 'get_tuning_options()',
            handler: async () => {
                const options = this.tuner.getTunableOptions();
                return JSON.stringify(options, null, 2);
            }
        });

        // Skill: Tune Browser for Domain
        this.skills.registerSkill({
            name: 'tune_browser_domain',
            description: 'Adjust browser settings for a specific domain. Use when a site fails with timeouts or blocks.',
            usage: 'tune_browser_domain(domain, settings, reason)',
            handler: async (args: any) => {
                const domain = args.domain;
                const reason = args.reason || 'Agent-initiated tuning';

                if (!domain) return 'Error: Missing domain (e.g., "example.com")';

                const settings: any = {};
                if (args.forceHeadful !== undefined) settings.forceHeadful = args.forceHeadful;
                if (args.navigationTimeout !== undefined) settings.navigationTimeout = Number(args.navigationTimeout);
                if (args.clickTimeout !== undefined) settings.clickTimeout = Number(args.clickTimeout);
                if (args.typeTimeout !== undefined) settings.typeTimeout = Number(args.typeTimeout);
                if (args.useSlowTyping !== undefined) settings.useSlowTyping = args.useSlowTyping;
                if (args.slowTypingDelay !== undefined) settings.slowTypingDelay = Number(args.slowTypingDelay);
                if (args.waitAfterClick !== undefined) settings.waitAfterClick = Number(args.waitAfterClick);

                if (Object.keys(settings).length === 0) {
                    return 'Error: No settings provided. Available: forceHeadful, navigationTimeout, clickTimeout, typeTimeout, useSlowTyping, slowTypingDelay, waitAfterClick';
                }

                return this.tuner.tuneBrowserForDomain(domain, settings, reason);
            }
        });

        // Skill: Mark Domain as Headful
        this.skills.registerSkill({
            name: 'mark_headful',
            description: 'Mark a domain as requiring visible browser (headful mode). Use when headless mode fails.',
            usage: 'mark_headful(domain, reason?)',
            handler: async (args: any) => {
                const domain = args.domain;
                const reason = args.reason || 'Headless mode detected/blocked';

                if (!domain) return 'Error: Missing domain';
                return this.tuner.markDomainAsHeadful(domain, reason);
            }
        });

        // Skill: Tune Workflow
        this.skills.registerSkill({
            name: 'tune_workflow',
            description: 'Adjust workflow execution settings like retries, timeouts, and step limits.',
            usage: 'tune_workflow(settings, reason)',
            handler: async (args: any) => {
                const reason = args.reason || 'Agent-initiated tuning';
                const settings: any = {};

                if (args.maxStepsPerAction !== undefined) settings.maxStepsPerAction = Number(args.maxStepsPerAction);
                if (args.maxRetriesPerSkill !== undefined) settings.maxRetriesPerSkill = Number(args.maxRetriesPerSkill);
                if (args.retryDelayMs !== undefined) settings.retryDelayMs = Number(args.retryDelayMs);
                if (args.skillTimeoutMs !== undefined) settings.skillTimeoutMs = Number(args.skillTimeoutMs);

                if (Object.keys(settings).length === 0) {
                    return 'Error: No settings provided. Available: maxStepsPerAction, maxRetriesPerSkill, retryDelayMs, skillTimeoutMs';
                }

                return this.tuner.tuneWorkflow(settings, reason);
            }
        });

        // Skill: Get Tuning State
        this.skills.registerSkill({
            name: 'get_tuning_state',
            description: 'Get the current tuning state including all learned settings and history.',
            usage: 'get_tuning_state()',
            handler: async () => {
                const state = this.tuner.getFullState();
                return JSON.stringify(state, null, 2);
            }
        });

        // Skill: Get Tuning History
        this.skills.registerSkill({
            name: 'get_tuning_history',
            description: 'Get recent tuning changes and their outcomes.',
            usage: 'get_tuning_history(limit?)',
            handler: async (args: any) => {
                const limit = args.limit ? Number(args.limit) : 20;
                const history = this.tuner.getTuningHistory(limit);
                if (history.length === 0) return 'No tuning history yet.';
                return history.map(h =>
                    `[${h.timestamp}] ${h.domain ? `Domain: ${h.domain} | ` : ''}${h.setting}: ${JSON.stringify(h.oldValue)} → ${JSON.stringify(h.newValue)}\n  Reason: ${h.reason}${h.success !== undefined ? ` | Success: ${h.success}` : ''}`
                ).join('\n\n');
            }
        });

        // Skill: Reset Tuning
        this.skills.registerSkill({
            name: 'reset_tuning',
            description: 'Reset tuning to defaults. Use if tuning caused problems.',
            usage: 'reset_tuning(category?)',
            handler: async (args: any) => {
                const category = args.category;
                if (category && !['browser', 'workflow', 'llm'].includes(category)) {
                    return 'Error: Invalid category. Valid: browser, workflow, llm (or omit for all)';
                }
                return this.tuner.resetToDefaults(category);
            }
        });

        // Skill: Config Management
        this.skills.registerSkill(configManagementSkill);

        // Skill: Register Polling Job
        this.skills.registerSkill({
            name: 'register_polling_job',
            description: 'Register a polling job to check a condition periodically. Supports condition types: file_exists, memory_contains, task_status, custom_check',
            usage: 'register_polling_job(job_id, description, condition_type, condition_params, interval_ms, max_attempts?)',
            handler: async (args: any) => {
                const jobId = args.job_id || args.id;
                const description = args.description;
                const conditionType = args.condition_type || args.type;
                const conditionParams = args.condition_params || args.params || {};
                const intervalMs = parseInt(args.interval_ms || args.interval || '5000', 10);
                const maxAttempts = args.max_attempts ? parseInt(args.max_attempts, 10) : undefined;

                if (!jobId || !description) {
                    return 'Error: Missing job_id or description';
                }

                if (!conditionType) {
                    return 'Error: Missing condition_type. Supported types: file_exists, memory_contains, task_status, custom_check';
                }

                // Create the check function based on condition type
                let checkFn: () => Promise<boolean>;

                switch (conditionType) {
                    case 'file_exists':
                        const filePath = conditionParams.path || conditionParams.file_path;
                        if (!filePath) {
                            return 'Error: file_exists condition requires path parameter';
                        }
                        checkFn = async () => {
                            return fs.existsSync(filePath);
                        };
                        break;

                    case 'memory_contains':
                        const searchText = conditionParams.text || conditionParams.search;
                        if (!searchText) {
                            return 'Error: memory_contains condition requires text parameter';
                        }
                        checkFn = async () => {
                            const recentMemories = this.memory.getRecentContext(10);
                            return recentMemories.some(m =>
                                m.content.toLowerCase().includes(searchText.toLowerCase())
                            );
                        };
                        break;

                    case 'task_status':
                        const taskId = conditionParams.task_id || conditionParams.id;
                        const expectedStatus = conditionParams.status || 'completed';
                        if (!taskId) {
                            return 'Error: task_status condition requires task_id parameter';
                        }
                        checkFn = async () => {
                            const action = this.actionQueue.getQueue().find(a => a.id === taskId);
                            return action ? action.status === expectedStatus : false;
                        };
                        break;

                    case 'custom_check':
                        // For custom checks, look for a stored condition in memory
                        const checkKey = conditionParams.check_key || conditionParams.key;
                        if (!checkKey) {
                            return 'Error: custom_check condition requires check_key parameter';
                        }
                        checkFn = async () => {
                            // Look for a custom check result in memory
                            const memories = this.memory.getRecentContext(5);
                            return memories.some(m =>
                                m.content.includes(`${checkKey}:true`) ||
                                m.content.includes(`${checkKey}: true`)
                            );
                        };
                        break;

                    default:
                        return `Error: Unknown condition_type '${conditionType}'. Supported: file_exists, memory_contains, task_status, custom_check`;
                }

                this.pollingManager.registerJob({
                    id: jobId,
                    description: description,
                    checkFn,
                    intervalMs,
                    maxAttempts,
                    onSuccess: (id: string) => {
                        this.pushTask(`Polling job ${id} completed: ${description}`, 7);
                    },
                    onFailure: (id: string, reason: string) => {
                        logger.warn(`Polling job ${id} failed: ${reason}`);
                    }
                });

                return `Polling job '${jobId}' registered with ${intervalMs}ms interval (condition: ${conditionType})`;
            }
        });

        // Skill: Cancel Polling Job
        this.skills.registerSkill({
            name: 'cancel_polling_job',
            description: 'Cancel an active polling job',
            usage: 'cancel_polling_job(job_id)',
            handler: async (args: any) => {
                const jobId = args.job_id || args.id;
                if (!jobId) return 'Error: Missing job_id';

                const cancelled = this.pollingManager.cancelJob(jobId);
                return cancelled
                    ? `Polling job '${jobId}' cancelled successfully`
                    : `Polling job '${jobId}' not found`;
            }
        });

        // Skill: Get Polling Job Status
        this.skills.registerSkill({
            name: 'get_polling_status',
            description: 'Get the status of a polling job or list all active jobs',
            usage: 'get_polling_status(job_id?)',
            handler: async (args: any) => {
                const jobId = args.job_id || args.id;

                if (jobId) {
                    const status = this.pollingManager.getJobStatus(jobId);
                    if (!status.exists) {
                        return `Polling job '${jobId}' not found`;
                    }
                    return `Job '${jobId}': ${status.description}\nAttempts: ${status.attempts}\nDuration: ${Math.round(status.duration! / 1000)}s`;
                } else {
                    const jobs = this.pollingManager.getActiveJobs();
                    if (jobs.length === 0) {
                        return 'No active polling jobs';
                    }
                    return `Active polling jobs (${jobs.length}):\n` +
                        jobs.map(j => `- ${j.id}: ${j.description} (${j.attempts} attempts, ${Math.round(j.duration / 1000)}s)`).join('\n');
                }
            }
        });

        // Memory Tools - Inspired by OpenClaw
        // Register memory tools
        for (const skill of memoryToolsSkills) {
            this.skills.registerSkill(skill);
            logger.info(`Registered memory tool: ${skill.name}`);
        }

        // ─── RAG Knowledge Store Skills ──────────────────────────────────

        this.skills.registerSkill({
            name: 'rag_ingest',
            description: 'Ingest a document or dataset into the RAG knowledge store for future retrieval. Supports text, markdown, CSV, JSON, JSONL, and code files. The content will be chunked, embedded, and stored for semantic search. Use this when the user asks you to learn from, study, or memorize a document/dataset/file. The content parameter should be the full text content to ingest.',
            usage: 'rag_ingest(content, source, collection?, title?, tags?, format?)',
            handler: async (args: any) => {
                try {
                    const content = args.content || args.text || args.data;
                    const source = args.source || args.url || args.filename || 'unknown';
                    const collection = args.collection || 'default';
                    const title = args.title;
                    const tags = args.tags ? (Array.isArray(args.tags) ? args.tags : args.tags.split(',').map((t: string) => t.trim())) : [];
                    const format = args.format;

                    if (!content) return { success: false, error: 'Missing content. Provide the document text to ingest.' };

                    // Auto-parse structured formats
                    const detected = format || this.knowledgeStore['detectFormat'](source);
                    const parsed = this.knowledgeStore.parseContent(content, detected);

                    const result = await this.knowledgeStore.ingest(parsed, source, collection, { title, tags, format: detected });
                    return {
                        success: true,
                        documentId: result.documentId,
                        chunksCreated: result.chunksCreated,
                        collection,
                        message: `Ingested "${title || source}" into knowledge store: ${result.chunksCreated} chunks in collection "${collection}".`
                    };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        this.skills.registerSkill({
            name: 'rag_ingest_file',
            description: 'Read a local file and ingest it into the RAG knowledge store. Reads the file from disk, then chunks and embeds it. Use when the user points you to a file path to learn from.',
            usage: 'rag_ingest_file(file_path, collection?, tags?)',
            handler: async (args: any) => {
                try {
                    const filePath = args.file_path || args.path || args.filePath;
                    if (!filePath) return { success: false, error: 'Missing file_path.' };
                    if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

                    const content = fs.readFileSync(filePath, 'utf-8');
                    const collection = args.collection || 'default';
                    const tags = args.tags ? (Array.isArray(args.tags) ? args.tags : args.tags.split(',').map((t: string) => t.trim())) : [];
                    const detected = this.knowledgeStore['detectFormat'](filePath);
                    const parsed = this.knowledgeStore.parseContent(content, detected);

                    const result = await this.knowledgeStore.ingest(parsed, filePath, collection, {
                        title: args.title || path.basename(filePath),
                        tags,
                        format: detected,
                    });
                    return {
                        success: true,
                        documentId: result.documentId,
                        chunksCreated: result.chunksCreated,
                        collection,
                        message: `Ingested file "${path.basename(filePath)}" → ${result.chunksCreated} chunks in "${collection}".`
                    };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        this.skills.registerSkill({
            name: 'rag_ingest_url',
            description: 'Download a web page or file from a URL and ingest it into the RAG knowledge store. Fetches the content, extracts readable text, then chunks and embeds it. Use when the user asks you to learn from a webpage, dataset URL, or online document.',
            usage: 'rag_ingest_url(url, collection?, tags?, title?)',
            handler: async (args: any) => {
                try {
                    const url = args.url || args.link;
                    if (!url) return { success: false, error: 'Missing url.' };

                    const collection = args.collection || 'default';
                    const tags = args.tags ? (Array.isArray(args.tags) ? args.tags : args.tags.split(',').map((t: string) => t.trim())) : [];

                    // Fetch the URL
                    const response = await fetch(url, {
                        headers: { 'User-Agent': 'OrcBot/1.0 (Knowledge Ingestion)' },
                        signal: AbortSignal.timeout(30000),
                    });
                    if (!response.ok) return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };

                    const contentType = response.headers.get('content-type') || '';
                    let text = await response.text();

                    // Extract readable content from HTML
                    if (contentType.includes('html') || text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
                        try {
                            const doc = new DOMParser().parseFromString(text, 'text/html');
                            const reader = new Readability(doc as any);
                            const article = reader.parse();
                            if (article?.textContent) {
                                text = (article.title ? `# ${article.title}\n\n` : '') + article.textContent;
                            }
                        } catch { /* use raw text */ }
                    }

                    if (text.trim().length < 50) return { success: false, error: 'Page content too short or empty after extraction.' };

                    const format = contentType.includes('json') ? 'json'
                        : contentType.includes('csv') ? 'csv'
                            : contentType.includes('html') ? 'text'
                                : 'text';
                    const parsed = this.knowledgeStore.parseContent(text, format);

                    const result = await this.knowledgeStore.ingest(parsed, url, collection, {
                        title: args.title,
                        tags,
                        format,
                    });
                    return {
                        success: true,
                        documentId: result.documentId,
                        chunksCreated: result.chunksCreated,
                        collection,
                        message: `Ingested "${url}" → ${result.chunksCreated} chunks in "${collection}".`
                    };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        this.skills.registerSkill({
            name: 'rag_search',
            description: 'Search the RAG knowledge store for information relevant to a query. Returns the most similar document chunks with relevance scores. Use this when you need to recall ingested knowledge — documentation, datasets, files, or web pages that were previously stored.',
            usage: 'rag_search(query, limit?, collection?, tags?)',
            handler: async (args: any) => {
                try {
                    const query = args.query || args.q || args.search;
                    if (!query) return { success: false, error: 'Missing query.' };

                    const limit = parseInt(args.limit) || 5;
                    const collection = args.collection;
                    const tags = args.tags ? (Array.isArray(args.tags) ? args.tags : args.tags.split(',').map((t: string) => t.trim())) : undefined;

                    const results = await this.knowledgeStore.search(query, limit, { collection, tags });
                    if (results.length === 0) {
                        return { success: true, results: [], message: 'No relevant knowledge found for this query.' };
                    }

                    const formatted = results.map((r, i) => ({
                        rank: i + 1,
                        score: `${(r.score * 100).toFixed(1)}%`,
                        source: r.source,
                        title: r.title || '(untitled)',
                        collection: r.collection,
                        chunk: `${r.chunkIndex + 1}/${r.totalChunks}`,
                        content: r.content,
                    }));

                    return { success: true, results: formatted, count: results.length };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        this.skills.registerSkill({
            name: 'rag_list',
            description: 'List documents and collections in the RAG knowledge store. Shows what knowledge has been ingested, organized by collection.',
            usage: 'rag_list(collection?)',
            handler: async (args: any) => {
                try {
                    const collections = this.knowledgeStore.listCollections();
                    const collection = args.collection;
                    const documents = this.knowledgeStore.listDocuments(collection);
                    const stats = this.knowledgeStore.getStats();

                    return {
                        success: true,
                        stats: {
                            totalDocuments: stats.totalDocuments,
                            totalChunks: stats.totalChunks,
                            collections: stats.collections,
                            provider: stats.provider,
                            enabled: stats.enabled,
                        },
                        collections: collections.map(c => ({
                            name: c.name,
                            documents: c.documentCount,
                            chunks: c.chunkCount,
                        })),
                        documents: documents.slice(0, 30).map(d => ({
                            id: d.id,
                            title: d.title,
                            source: d.source,
                            collection: d.collection,
                            chunks: d.totalChunks,
                            size: `${(d.sizeBytes / 1024).toFixed(1)}KB`,
                            tags: d.tags,
                            ingestedAt: d.ingestedAt,
                        }))
                    };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        this.skills.registerSkill({
            name: 'rag_delete',
            description: 'Delete a document or collection from the RAG knowledge store. Use document_id to delete a specific document, or collection to delete all documents in a collection.',
            usage: 'rag_delete(document_id?, collection?)',
            handler: async (args: any) => {
                try {
                    if (args.document_id || args.documentId || args.doc_id) {
                        const docId = args.document_id || args.documentId || args.doc_id;
                        const deleted = this.knowledgeStore.deleteDocument(docId);
                        return deleted
                            ? { success: true, message: `Document ${docId} deleted.` }
                            : { success: false, error: `Document ${docId} not found.` };
                    }
                    if (args.collection) {
                        const count = this.knowledgeStore.deleteCollection(args.collection);
                        return { success: true, message: `Collection "${args.collection}" deleted (${count} documents removed).` };
                    }
                    return { success: false, error: 'Provide document_id or collection to delete.' };
                } catch (e: any) {
                    return { success: false, error: e.message || String(e) };
                }
            }
        });

        // Additional Polling Manager Skills (list/status — the core register/cancel
        // skills are registered above in the main polling section)
        this.skills.registerSkill({
            name: 'list_polling_jobs',
            description: 'List all active polling jobs with their status.',
            usage: 'list_polling_jobs()',
            handler: async () => {
                try {
                    const jobs = this.pollingManager.getActiveJobs();
                    if (jobs.length === 0) {
                        return 'No active polling jobs.';
                    }
                    const jobList = jobs.map(j =>
                        `- ${j.id}: ${j.description} (${j.attempts} attempts, ${Math.round(j.duration / 1000)}s elapsed, interval: ${j.intervalMs}ms)`
                    ).join('\n');
                    return `Active polling jobs (${jobs.length}):\n${jobList}`;
                } catch (e) {
                    return `Failed to list polling jobs: ${e}`;
                }
            }
        });

        this.skills.registerSkill({
            name: 'get_polling_job_status',
            description: 'Get the status of a specific polling job.',
            usage: 'get_polling_job_status(id)',
            handler: async (args: any) => {
                const id = args.id || args.job_id;
                if (!id) return 'Error: Missing job id.';

                try {
                    const status = this.pollingManager.getJobStatus(id);
                    if (!status.exists) {
                        return `Polling job "${id}" not found.`;
                    }
                    return `Polling job "${id}":\n- Description: ${status.description}\n- Attempts: ${status.attempts}\n- Duration: ${Math.round((status.duration || 0) / 1000)}s`;
                } catch (e) {
                    return `Failed to get polling job status: ${e}`;
                }
            }
        });

        // ═══════════════════════════════════════════════════════════════
        // Agentic User Skills — review and control the autonomous HITL proxy
        // Workers don't run AgenticUser — skip these.
        // ═══════════════════════════════════════════════════════════════
        if (!this.isWorker) {

            this.skills.registerSkill({
                name: 'agentic_user_status',
                description: 'Check the Agentic User status — whether the autonomous HITL proxy is active, its configuration, and recent intervention stats.',
                usage: 'agentic_user_status()',
                handler: async () => {
                    const stats = this.agenticUser.getStats();
                    const settings = this.agenticUser.getSettings();
                    return JSON.stringify({
                        active: stats.isActive,
                        settings: {
                            enabled: settings.enabled,
                            responseDelay: `${settings.responseDelay}s`,
                            confidenceThreshold: `${settings.confidenceThreshold}%`,
                            proactiveGuidance: settings.proactiveGuidance,
                            maxInterventionsPerAction: settings.maxInterventionsPerAction,
                        },
                        stats: {
                            totalInterventions: stats.totalInterventions,
                            appliedInterventions: stats.appliedInterventions,
                            activeTimers: stats.activeTimers,
                        }
                    }, null, 2);
                }
            });

            this.skills.registerSkill({
                name: 'agentic_user_log',
                description: 'Get recent Agentic User interventions — see what the autonomous HITL proxy decided on behalf of the user.',
                usage: 'agentic_user_log(limit?)',
                handler: async (args: any) => {
                    const limit = args.limit || args.count || 10;
                    const log = this.agenticUser.getInterventionLog(limit);
                    if (log.length === 0) {
                        return 'No Agentic User interventions recorded yet.';
                    }
                    return log.map(entry =>
                        `[${entry.timestamp}] ${entry.type} | Action: ${entry.actionId} | Confidence: ${entry.confidence}% | Applied: ${entry.applied}\n  Trigger: ${entry.trigger.slice(0, 100)}\n  Response: ${entry.response.slice(0, 150)}`
                    ).join('\n\n');
                }
            });

            this.skills.registerSkill({
                name: 'agentic_user_clear',
                description: 'Clear Agentic User intervention history.',
                usage: 'agentic_user_clear()',
                handler: async () => {
                    this.agenticUser.clearHistory();
                    return 'Agentic User intervention history cleared.';
                }
            });

        } // end !isWorker agentic user skills guard
    }

    private loadAgentIdentity() {
        if (fs.existsSync(this.agentConfigFile)) {
            this.agentIdentity = fs.readFileSync(this.agentConfigFile, 'utf-8');
            logger.info(`Agent identity loaded from ${this.agentConfigFile}`);
        } else {
            this.agentIdentity = "You are a capable, direct autonomous agent. Be natural and concise — not a customer service bot.";
            logger.warn(`${this.agentConfigFile} not found. Using default identity.`);
        }
        this.decisionEngine.setAgentIdentity(this.agentIdentity);
    }

    /**
     * When the agent gets stuck in a loop, this method analyzes the failure
     * and considers creating a new skill to handle the situation better.
     */
    private async triggerSkillCreationForFailure(taskDescription: string, failingTool?: string, failingContext?: string, originAction?: any) {
        try {
            // Don't spam skill creation - check if we recently tried
            const recentMemories = this.memory.searchMemory('short');
            const recentSkillCreations = recentMemories.filter(m =>
                m.metadata?.tool === 'auto_skill_creation' &&
                Date.now() - new Date(m.timestamp || 0).getTime() < 30 * 60 * 1000 // 30 min cooldown
            );

            if (recentSkillCreations.length >= 2) {
                logger.info('Agent: Skipping auto skill creation (cooldown - already tried recently)');
                return;
            }

            logger.info(`Agent: Analyzing failure for potential skill creation. Task: "${taskDescription.slice(0, 100)}"`);

            // Use LLM to analyze if a skill would help
            const analysisPrompt = `You are an AI agent that just got stuck in a loop trying to complete a task.

FAILED TASK: "${taskDescription}"
TOOL THAT KEPT FAILING: ${failingTool || 'unknown'}
CONTEXT: ${failingContext || 'none'}

Analyze this failure and decide:
1. Is this a recurring problem that a dedicated skill could solve?
2. What would the skill do differently than the current approach?
3. What APIs, RSS feeds, or alternative methods could work better?

IMPORTANT SELECTIVITY RULES:
- Do NOT auto-create a new skill for every failure.
- If this is primarily a parameter misuse, sequencing bug, or prompt-strategy issue, set should_create_skill=false.
- If the failing tool is core/built-in, only create a skill if there is a clear reusable wrapper/workflow advantage (e.g., orchestrating multiple calls, domain-specific automation, or robust fallback chain).
- Prefer concise reasons over over-engineering.

Respond in JSON:
{
  "should_create_skill": true/false,
  "reason": "brief explanation",
  "skill_name": "suggested_skill_name" (if should_create_skill is true),
  "skill_description": "what it would do" (if should_create_skill is true),
  "implementation_hints": ["hint1", "hint2"] (if should_create_skill is true)
}`;

            const analysis = await this.llm.call(analysisPrompt, 'You are a helpful AI assistant. Respond only with valid JSON.');

            let parsed: any;
            try {
                // Extract JSON from response
                const jsonMatch = analysis.match(/\{[\s\S]*\}/);
                parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            } catch {
                logger.debug('Agent: Could not parse skill creation analysis');
                return;
            }

            if (!parsed?.should_create_skill) {
                logger.info(`Agent: Skill creation not recommended: ${parsed?.reason || 'unknown'}`);
                return;
            }

            // Save memory that we're attempting skill creation
            this.memory.saveMemory({
                id: `auto-skill-${Date.now()}`,
                type: 'short',
                content: `Auto skill creation triggered for: ${parsed.skill_name}. Reason: ${parsed.reason}`,
                metadata: { tool: 'auto_skill_creation', skillName: parsed.skill_name }
            });

            // Push a high-priority task to create the skill
            logger.info(`Agent: Queueing skill creation task for "${parsed.skill_name}"`);
            await this.pushTask(
                `SELF-IMPROVEMENT: Create a new skill called "${parsed.skill_name}" to handle: ${parsed.skill_description}

Implementation hints:
${parsed.implementation_hints?.map((h: string) => `- ${h}`).join('\n') || 'None'}

Choose the right tool:
- If this skill needs EXECUTABLE CODE (API calls, data processing, automation): use create_custom_skill({ name, description, usage, code })
- If this skill needs KNOWLEDGE/INSTRUCTIONS (workflow steps, prompt patterns, guides): use create_skill(name, description, instructions)
- Research APIs and methods first if needed.
This skill should prevent future failures when ${taskDescription.slice(0, 100)}...`,
                9, // High priority
                {
                    source: originAction?.payload?.source || 'self_improvement',
                    sourceId: originAction?.payload?.sourceId,
                    skillName: parsed.skill_name,
                    trigger: 'loop_detection',
                    selfImprovement: true,
                },
                'autonomy'
            );

        } catch (e) {
            logger.debug(`Agent: Auto skill creation analysis failed: ${e}`);
        }
    }

    /**
     * Generate a SKILL.md wrapper for a code-based plugin (.ts/.js) so it appears
     * in the Agent Skills system alongside knowledge-based skills.
     * This bridges the two skill systems — plugin code is executable, SKILL.md provides
     * metadata and discoverability.
     */
    private generateSkillMdForPlugin(skillName: string, description: string, pluginPath: string): void {
        try {
            const pluginsDir = this.config.get('pluginsPath') || './plugins';
            const skillsDir = path.join(pluginsDir, 'skills');
            // Convert underscore plugin names to hyphenated SKILL.md names
            const skillMdName = skillName.replace(/_/g, '-');
            const skillDir = path.join(skillsDir, skillMdName);

            // Don't overwrite if a SKILL.md directory already exists
            if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
                logger.debug(`Agent: SKILL.md already exists for ${skillName}, skipping wrapper generation`);
                return;
            }

            fs.mkdirSync(skillDir, { recursive: true });

            const relPluginPath = path.relative(skillDir, pluginPath).replace(/\\/g, '/');
            const skillMd = `---
name: ${skillMdName}
description: "${(description || '').replace(/"/g, '\\"')}"
metadata:
  author: orcbot
  version: "1.0"
  type: code-plugin
  pluginFile: "${path.basename(pluginPath)}"
orcbot:
  autoActivate: true
  permissions:
    - code-execution
---

# ${skillName}

## Overview

${description || 'Auto-generated code-based skill.'}

This is a **code-based skill** backed by a TypeScript/JavaScript plugin at \`${relPluginPath}\`.
It executes real code when invoked, unlike knowledge-based skills which provide instructions.

## Plugin Details

- **Plugin file**: \`${relPluginPath}\`
- **Skill name**: \`${skillName}\`
- **Type**: Executable code plugin

## Usage

Call this skill directly by name: \`${skillName}(...args)\`

The plugin handles all logic internally. See the plugin source for implementation details.
`;

            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);
            this.skills.discoverAgentSkills();
            logger.info(`Agent: Generated SKILL.md wrapper for plugin "${skillName}" at ${skillDir}`);
        } catch (e) {
            logger.debug(`Agent: Failed to generate SKILL.md wrapper for ${skillName}: ${e}`);
        }
    }

    /**
     * Send progress feedback to the user via their original channel.
     * Respects progressFeedbackEnabled config. Uses lightweight formats to avoid clutter.
     */
    private async sendProgressFeedback(
        action: Action,
        type: 'start' | 'working' | 'error' | 'recovering' | 'retry',
        details?: string
    ): Promise<boolean> {
        if (!this.config.get('progressFeedbackEnabled')) return false;

        const typingOnly = this.config.get('progressFeedbackTypingOnly') !== false;

        // Only send feedback for channel-sourced actions
        const source = action.payload?.source;
        const sourceId = action.payload?.sourceId;
        if (!source) return false;
        // Gateway-chat doesn't require sourceId (uses eventBus broadcast)
        if (source !== 'gateway-chat' && !sourceId) return false;

        if (typingOnly) {
            try {
                if (source === 'telegram' && this.telegram) {
                    await this.telegram.sendTypingIndicator(sourceId);
                    return false;
                } else if (source === 'whatsapp' && this.whatsapp) {
                    await (this.whatsapp as any).sendPresenceComposing(sourceId);
                    return false;
                } else if (source === 'discord' && this.discord) {
                    await this.discord.sendTypingIndicator(sourceId);
                    return false;
                } else if (source === 'slack' && this.slack) {
                    await this.slack.sendTypingIndicator(sourceId);
                    return false;
                } else if (source === 'email') {
                    return false;
                }
                // gateway-chat has no typing indicator; fall back to status text below.
            } catch {
                // Typing indicators are non-critical; if unavailable, fall back to status text.
            }
        }

        // Craft compact, non-intrusive messages
        let message = '';
        switch (type) {
            case 'start':
                message = '⏳ Working on it...';
                break;
            case 'working':
                message = details ? `⚙️ ${details}` : '⚙️ Still working...';
                break;
            case 'error':
                message = details ? `⚠️ Hit a snag: ${details.slice(0, 100)}... retrying` : '⚠️ Encountered an issue, retrying...';
                break;
            case 'recovering':
                message = details ? `🔧 ${details}` : '🔧 Recovering from error...';
                break;
            case 'retry':
                message = details ? `🔄 ${details}` : '🔄 Hit a snag — trying again shortly...';
                break;
        }

        let sentMessage = false;
        try {
            if (source === 'telegram' && this.telegram) {
                await this.telegram.sendMessage(sourceId, message);
                sentMessage = true;
            } else if (source === 'whatsapp' && this.whatsapp) {
                await this.whatsapp.sendMessage(sourceId, message);
                sentMessage = true;
            } else if (source === 'discord' && this.discord) {
                await this.discord.sendMessage(sourceId, message);
                sentMessage = true;
            } else if (source === 'slack' && this.slack) {
                await this.slack.sendMessage(sourceId, message);
                sentMessage = true;
            } else if (source === 'email') {
                const emailChannel = this.getOrCreateEmailChannel();
                if (!emailChannel) return false;
                const subject = action.payload?.subject ? `Re: ${action.payload.subject}` : 'OrcBot update';
                await emailChannel.sendEmail(sourceId, subject, message, action.payload?.inReplyTo, action.payload?.references);
                sentMessage = true;
            } else if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: message,
                    timestamp: new Date().toISOString(),
                    messageId: `progress-${Date.now()}`
                });
                sentMessage = true;
            }

            if (!sentMessage) {
                return false;
            }

            // Save progress messages to memory so the LLM can see them in thread context
            // and knows what status updates it already sent the user.
            const chatId = action.payload?.chatId || sourceId;
            const sessionScopeId = action.payload?.sessionScopeId;
            this.memory.saveMemory({
                id: `${source}-progress-${Date.now()}`,
                type: 'short',
                content: `Assistant sent status update to ${source} ${chatId}: ${message}`,
                timestamp: new Date().toISOString(),
                metadata: {
                    source,
                    role: 'assistant',
                    sessionScopeId,
                    chatId,
                    sourceId,
                    userId: action.payload?.userId,
                    progressType: type
                }
            });
        } catch (e) {
            logger.debug(`Failed to send progress feedback: ${e}`);
            return false;
        }

        return true;
    }

    /**
     * REVIEW GATE for forced terminations.
     * When a hard guardrail (message budget, skill frequency, max steps) wants to kill a task,
     * this method asks the LLM review layer whether the task is truly done or should continue.
     * Returns 'continue' if the task should keep going, 'terminate' if it should stop.
     */

    /**
     * Last-resort user-visible response for channel actions that otherwise produced no output.
     * This bypasses progress-feedback toggles so users are never left with total silence.
     */
    private async sendNoResponseFallback(action: Action, reason?: string): Promise<boolean> {
        const source = action.payload?.source;
        const sourceId = action.payload?.sourceId;
        if (!source) return false;
        if (source !== 'gateway-chat' && !sourceId) return false;

        const message = reason
            ? `⚠️ I ran into an internal issue while handling that request (${reason.slice(0, 120)}). Please retry, or ask me to continue from the last successful step.`
            : '⚠️ I hit an internal issue before I could send a full answer. Please retry, or ask me to continue from the last successful step.';

        try {
            if (source === 'telegram' && this.telegram) {
                await this.telegram.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'whatsapp' && this.whatsapp) {
                await this.whatsapp.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'discord' && this.discord) {
                await this.discord.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'slack' && this.slack) {
                await this.slack.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'email') {
                const emailChannel = this.getOrCreateEmailChannel();
                if (!emailChannel) return false;
                const subject = action.payload?.subject ? `Re: ${action.payload.subject}` : 'OrcBot: request update';
                await emailChannel.sendEmail(sourceId, subject, message, action.payload?.inReplyTo, action.payload?.references);
                return true;
            }
            if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: message,
                    timestamp: new Date().toISOString(),
                    messageId: `fallback-${Date.now()}`
                });
                return true;
            }
        } catch (e) {
            logger.warn(`Agent: Failed to send no-response fallback for action ${action.id}: ${e}`);
            return false;
        }

        return false;
    }

    private async reviewForcedTermination(
        action: Action,
        reason: 'message_budget' | 'skill_frequency' | 'max_steps',
        currentStep: number,
        details: string,
        deliveryContext?: { messagesSent: number; anyUserDeliverySuccess: boolean; substantiveDeliveriesSent: number }
    ): Promise<'continue' | 'terminate'> {
        try {
            const taskDescription = action.payload?.description || 'Unknown task';

            // Fast-path: if a message was already successfully delivered and this is a
            // simple/trivial channel response, don't waste an LLM call — just terminate.
            if (
                deliveryContext?.anyUserDeliverySuccess &&
                reason === 'max_steps' &&
                deliveryContext.messagesSent > 0
            ) {
                logger.info(`Agent: Forced termination review (${reason}): terminate — message already delivered, fast-path exit.`);
                return 'terminate';
            }

            const recentContext = this.memory.getRecentContext();
            const stepHistory = recentContext
                .filter(m => m.content?.includes(action.id) || m.metadata?.actionId === action.id)
                .map(m => m.content)
                .join('\n')
                .slice(-2000); // Last 2000 chars of step history for this action

            const deliverySummary = deliveryContext
                ? `Messages sent: ${deliveryContext.messagesSent}, Successful delivery: ${deliveryContext.anyUserDeliverySuccess}, Substantive deliveries: ${deliveryContext.substantiveDeliveriesSent}`
                : 'Delivery status: unknown';

            const reviewPrompt = `You are a task completion reviewer. A hard safety guardrail is about to TERMINATE a task. Your job is to decide if the task is truly done or if it should continue.

TASK: "${taskDescription}"
TERMINATION REASON: ${reason} — ${details}
CURRENT STEP: ${currentStep}
DELIVERY STATUS: ${deliverySummary}

RECENT STEP HISTORY:
${stepHistory || 'No step history available.'}

RULES:
- If a message has already been SUCCESSFULLY DELIVERED to the user (Delivery Status shows Successful delivery: true), return "terminate" — the task is done.
- If the task was a RESEARCH or DEEP WORK task (gathering info, writing reports, building something) and meaningful progress has been made but it's not done yet, return "continue".
- If the agent is truly stuck in a loop making NO progress at all (same exact calls with same results), return "terminate".
- If the agent has already gathered enough information to deliver a useful response to the user, return "terminate" (it should compile and send what it has).
- If the agent hasn't delivered ANY results to the user yet but has gathered data, return "continue" (it needs to compile and send).
- Prefer "continue" when in doubt — it's better to let the agent wrap up than to leave the user hanging.

Respond with ONLY valid JSON:
{ "decision": "continue" | "terminate", "reason": "brief explanation" }`;

            const response = await this.llm.callFast(reviewPrompt, 'You are a task reviewer. Respond only with valid JSON.');
            const match = response.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                const decision = parsed.decision === 'continue' ? 'continue' : 'terminate';
                logger.info(`Agent: Forced termination review (${reason}): ${decision} — ${parsed.reason || 'no reason'}`);
                return decision;
            }
        } catch (e) {
            logger.debug(`Agent: Forced termination review failed: ${e}. Defaulting to terminate.`);
        }
        return 'terminate';
    }

    /**
     * Check if a skill is a core built-in skill (not a user-created or plugin skill).
     * Core skills should never trigger self-improvement — if they're failing, it's a strategy
     * issue, not a missing capability.
     */
    private isCoreBuiltinSkill(skillName: string): boolean {
        const coreSkills = new Set([
            'web_search', 'browser_navigate', 'browser_click', 'browser_type',
            'browser_examine_page', 'browser_screenshot', 'browser_back',
            'browser_scroll', 'browser_hover', 'browser_select',
            'browser_fill_form', 'browser_extract_data', 'browser_extract_content',
            'browser_api_intercept', 'browser_api_list',
            'computer_screenshot', 'computer_click', 'computer_vision_click',
            'computer_type', 'computer_key', 'computer_mouse_move',
            'computer_drag', 'computer_scroll', 'computer_locate', 'computer_describe',
            'extract_article', 'http_fetch', 'download_file', 'read_file', 'write_to_file',
            'write_file', 'create_file', 'delete_file', 'run_command',
            'send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat',
            'telegram_send_buttons', 'telegram_edit_message', 'telegram_send_poll', 'telegram_react', 'telegram_pin_message',
            'send_voice_note', 'text_to_speech', 'analyze_media',
            'generate_image', 'send_image',
            'update_journal', 'update_learning', 'update_user_profile',
            'update_agent_identity', 'get_system_info', 'system_check',
            'manage_config', 'read_bootstrap_file', 'request_supporting_data',
            'manage_skills', 'create_custom_skill', 'create_skill',
            'schedule_task', 'schedule_list', 'schedule_remove',
            'install_npm_dependency', 'recall_memory'
        ]);
        return coreSkills.has(skillName);
    }

    /**
     * POST-ACTION HOOK: Detect if the agent acknowledged incomplete prior work
     * but didn't actually resume it (empty promise detection).
     * 
     * When a user asks "are u done?" and the agent replies "not yet, working on it!"
     * but then sets goals_met=true and stops, the user is left hanging. This method
     * detects that pattern and auto-pushes a continuation task.
     */
    private hasExistingRecoveryTask(
        trigger: 'completion_audit_recovery' | 'empty_promise_recovery',
        originalActionId: string,
        source?: string,
        sourceId?: string
    ): boolean {
        const now = Date.now();
        const dedupWindowHours = Number(this.config?.get('recoveryDedupWindowHours') ?? 6);
        const recentWindowMs = dedupWindowHours * 60 * 60 * 1000;

        return this.actionQueue.getQueue().some(a => {
            const aTrigger = String(a.payload?.trigger || '');
            const aOriginal = String(a.payload?.originalActionId || '');
            if (aTrigger !== trigger || aOriginal !== originalActionId) return false;

            if (a.status === 'pending' || a.status === 'waiting' || a.status === 'in-progress') {
                return true;
            }

            if (a.status === 'completed') {
                const sameSource = !source || String(a.payload?.source || '') === String(source || '');
                const sameThread = !sourceId || String(a.payload?.sourceId || '') === String(sourceId || '');
                const updatedAt = a.updatedAt ? Date.parse(a.updatedAt) : 0;
                const finishedRecently = updatedAt > 0 && (now - updatedAt) <= recentWindowMs;
                return sameSource && sameThread && finishedRecently;
            }

            return false;
        });
    }

    private async detectAndResumeIncompleteWork(
        action: Action,
        sentMessages: string[],
        stepCount: number
    ): Promise<void> {
        try {
            // Only check short actions (1-3 steps) that sent a message — longer actions likely did real work
            if (stepCount > 3 || sentMessages.length === 0) return;

            // Only check follow-up-style actions (user asking about status/completion)
            const taskDesc = (action.payload?.description || '').toLowerCase();
            const isFollowUpInquiry = /\b(are (you|u) done|is it (ready|done|finished)|status|update|what('?s| is) (the )?(progress|status)|how('?s| is) it going|finished yet|ready yet|done yet|completed)\b/.test(taskDesc);
            if (!isFollowUpInquiry) return;

            // Check if any sent message acknowledges incomplete work
            const incompleteIndicators = [
                'not yet', 'still working', 'not done', 'in progress', 'working on',
                'haven\'t finished', 'haven\'t completed', 'not finished', 'shortly',
                'will deliver', 'will have', 'will send', 'will get', 'almost done',
                'nearly done', 'finishing up', 'wrapping up', 'give me a moment',
                'bear with me', 'just a bit', 'coming soon', 'on it', 'hold on'
            ];

            const lastMessage = sentMessages[sentMessages.length - 1]?.toLowerCase() || '';
            const acknowledgesIncomplete = incompleteIndicators.some(ind => lastMessage.includes(ind));

            if (!acknowledgesIncomplete) return;

            // Check if the agent also scheduled or pushed continuation work
            const recentShort = this.memory.searchMemory('short');
            const thisActionMemories = recentShort.filter(m =>
                m.metadata?.actionId === action.id
            );
            const didScheduleOrContinue = thisActionMemories.some(m =>
                m.metadata?.tool === 'schedule_task' ||
                m.metadata?.tool === 'web_search' ||
                m.metadata?.tool === 'browser_navigate' ||
                m.metadata?.tool === 'extract_article' ||
                m.metadata?.tool === 'run_command'
            );

            if (didScheduleOrContinue) return; // Agent actually did some work, not just a promise

            // EMPTY PROMISE DETECTED: Agent acknowledged incomplete work but didn't continue
            logger.warn(`Agent: Empty promise detected in action ${action.id}. Agent acknowledged incomplete work but didn't resume. Auto-pushing continuation task.`);

            // Try to find the original incomplete task from recent episodic memory
            const episodicMemories = this.memory.searchMemory('episodic');
            const recentIncomplete = episodicMemories
                .filter(m => {
                    const content = (m.content || '').toLowerCase();
                    return content.includes('task finished:') &&
                        m.metadata?.actionId !== action.id &&
                        m.metadata?.steps !== undefined;
                })
                .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                .slice(0, 3); // Check the last 3 completed tasks

            // Also check short-term memories for the original task context
            const taskContextMemories = recentShort
                .filter(m => {
                    const content = (m.content || '').toLowerCase();
                    return (content.includes('web_search') || content.includes('browser_navigate') || content.includes('research')) &&
                        m.metadata?.actionId !== action.id;
                })
                .slice(-5);

            // Build a description for the continuation task
            const contextHint = taskContextMemories.map(m => m.content?.slice(0, 100)).join(' | ');

            const continuationDesc = `CONTINUATION: Resume the incomplete task that the user asked about. The user asked "${action.payload?.description?.slice(0, 100)}" and I acknowledged the work is not done. I MUST now actually complete it. ${contextHint ? `Previous progress context: ${contextHint}` : 'Check episodic memory for the original task details.'}. Compile all available results and deliver a comprehensive response to the user.`;

            if (this.hasExistingRecoveryTask(
                'empty_promise_recovery',
                action.id,
                action.payload?.source,
                action.payload?.sourceId
            )) {
                logger.info(`Agent: Skipping duplicate empty_promise_recovery for ${action.id}; recovery already exists or was recently completed.`);
                return;
            }

            await this.pushTask(
                continuationDesc,
                8, // High priority — user is waiting
                {
                    source: action.payload?.source,
                    sourceId: action.payload?.sourceId,
                    chatId: action.payload?.chatId,
                    userId: action.payload?.userId,
                    trigger: 'empty_promise_recovery',
                    originalActionId: action.id
                },
                action.lane === 'autonomy' ? 'autonomy' : 'user'
            );

            logger.info(`Agent: Auto-pushed continuation task to resume incomplete work.`);
        } catch (e) {
            logger.debug(`Agent: detectAndResumeIncompleteWork failed: ${e}`);
        }
    }

    /**
     * Pre-completion audit: research this action's own execution logs and block
     * premature completion when there are unresolved outcomes.
     */
    private async auditCompletionFromActionLogs(
        action: Action,
        context: {
            currentStep: number;
            messagesSent: number;
            substantiveDeliveriesSent: number;
            deepToolExecutedSinceLastMessage: boolean;
            sentMessagesInAction: string[];
            skillCallCounts: Record<string, number>;
            taskComplexity?: string;
            anyUserDeliverySuccess?: boolean;
        }
    ): Promise<{ ok: boolean; issues: string[] }> {
        try {
            const source = action.payload?.source;
            const isChannelTask = source === 'telegram' || source === 'whatsapp' || source === 'discord' || source === 'slack' || source === 'email' || source === 'gateway-chat';
            if (!isChannelTask) {
                return { ok: true, issues: [] };
            }

            // Trivial tasks (simple greetings, confirmations, quick replies) that already
            // successfully delivered a message are done — skip the full audit.
            // The "substantiveDeliveriesSent === 0" check is too strict for short-form
            // replies like "Hello! How can I help you?" (< 40 chars).
            if (
                context.taskComplexity === 'trivial' &&
                context.anyUserDeliverySuccess === true &&
                context.messagesSent > 0
            ) {
                return { ok: true, issues: [] };
            }

            const issues: string[] = [];
            const actionMemories = this.memory.getActionMemories(action.id);

            const hadToolErrors = actionMemories.some(m => (m.content || '').includes('TOOL ERROR'));
            const hadResearchOrDeepOutput =
                Object.entries(context.skillCallCounts || {}).some(([skill, count]) => {
                    if (!count || count <= 0) return false;
                    return skill === 'web_search' ||
                        skill.startsWith('browser_') ||
                        skill === 'extract_article' ||
                        skill === 'http_fetch' ||
                        skill === 'run_command' ||
                        skill === 'read_file';
                });

            const hadAckOnlyMessages =
                context.sentMessagesInAction.length > 0 &&
                context.sentMessagesInAction.every(msg => this.isLikelyAcknowledgementMessage(msg));

            if (context.messagesSent === 0) {
                issues.push('No user-visible message was sent for this channel task.');
            }

            if (context.deepToolExecutedSinceLastMessage) {
                issues.push('Deep tool output exists after the last sent message (results likely not delivered).');
            }

            // Only flag ack-only messages as an issue when deep/research tools also ran.
            // Pure conversational tasks (greetings, short confirmations) legitimately produce
            // short replies that look like acks — don't penalise them.
            if (context.substantiveDeliveriesSent === 0 && hadResearchOrDeepOutput) {
                issues.push('Deep/research tools ran, but no substantive delivery message was sent.');
            }

            if (context.substantiveDeliveriesSent === 0 && hadAckOnlyMessages && hadResearchOrDeepOutput) {
                issues.push('Only acknowledgement/status-style messages were sent despite running research tools.');
            }

            if (hadToolErrors && context.substantiveDeliveriesSent === 0 && hadResearchOrDeepOutput) {
                issues.push('Tool errors occurred and no substantive user-facing recovery/result message was delivered.');
            }

            return { ok: issues.length === 0, issues };
        } catch (e) {
            logger.debug(`Agent: Completion log audit failed (non-blocking): ${e}`);
            return { ok: true, issues: [] };
        }
    }

    // ─── Post-Action Reflection & Learning ───────────────────────────

    /**
     * POST-ACTION REFLECTION: After an action completes, use the LLM to extract
     * learnings and write a journal reflection. This ensures:
     * 1. Knowledge captured from research/web browsing/tool usage goes into LEARNING.md
     * 2. Reflections on what worked/failed go into JOURNAL.md
     * 3. The agent builds a growing knowledge base automatically
     *
     * Only triggers for substantive actions (3+ steps), not trivial messages.
     */
    private async postActionReflection(
        action: any,
        status: string,
        stepCount: number,
        skillCallCounts: Record<string, number>
    ): Promise<void> {
        // Skip trivial actions (simple messages, quick replies) — not worth reflecting on
        if (stepCount < 3) return;

        // Skip heartbeats — they have their own learning system
        const desc = action.payload?.description || '';
        if (desc.includes('[HEARTBEAT]') || action.payload?.source === 'heartbeat') return;

        // Gather step memories for this action (before cleanup deletes them)
        const actionMemories = this.memory.getActionMemories(action.id);
        if (actionMemories.length < 2) return;

        // Build a compact summary of what happened in this action
        const stepSummary = actionMemories
            .slice(-15) // Last 15 memories max
            .map(m => m.content.slice(0, 300))
            .join('\n---\n');

        const skillsUsed = Object.entries(skillCallCounts)
            .filter(([_, count]) => count > 0)
            .map(([skill, count]) => `${skill}(×${count})`)
            .join(', ');

        try {
            // Use a fast, cheap LLM call to extract learnings + reflection
            const extractPrompt = `You are a post-action reviewer for an AI agent. Analyze this completed action and extract two things:

ACTION: "${desc}"
STATUS: ${status}
STEPS: ${stepCount}
SKILLS USED: ${skillsUsed}

STEP OBSERVATIONS:
${stepSummary.slice(0, 4000)}

Extract:
1. **LEARNINGS** — Any factual knowledge, technical insights, useful URLs, API patterns, tool tips, user preferences, or problem-solving techniques discovered during this action. Focus on things that would be useful for FUTURE tasks. If the action was just a simple conversation with no new knowledge, write "NONE".
2. **REFLECTION** — A brief 1-2 sentence reflection on what went well or what could be improved. If learning from a failure, note what approach would work better next time.

Format your response EXACTLY as:
LEARNINGS: <content or NONE>
REFLECTION: <1-2 sentences>`;

            const response = await this.llm.callFast(extractPrompt, 'Post-action reflection');
            if (!response || response.length < 20) return;

            // Parse the LLM response
            const learningsMatch = response.match(/LEARNINGS?:\s*([\s\S]*?)(?=REFLECTION:|$)/i);
            const reflectionMatch = response.match(/REFLECTION:\s*([\s\S]*?)$/i);

            const learnings = learningsMatch?.[1]?.trim() || '';
            const reflection = reflectionMatch?.[1]?.trim() || '';

            // Write learnings to LEARNING.md (if substantive)
            if (learnings && learnings.toUpperCase() !== 'NONE' && learnings.length > 30) {
                const learningPath = this.config.get('learningPath');
                const topic = this.extractTopicFromDescription(desc);
                const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n**Source**: Auto-extracted from action ${action.id}\n\n${learnings}\n\n---`;

                try {
                    fs.appendFileSync(learningPath, entry);
                    logger.info(`Agent: Auto-learning captured for topic "${topic}" (${learnings.length} chars)`);
                } catch (e) {
                    logger.warn(`Agent: Failed to write auto-learning: ${e}`);
                }

                // NOTE: We intentionally do NOT ingest auto-learnings into the RAG
                // KnowledgeStore.  The store is for user-directed datasets and external
                // documents (rag_ingest / rag_ingest_file / rag_ingest_url).
                // Auto-learnings already persist in LEARNING.md and are surfaced via
                // the DecisionEngine's learning-tail context window.
            }

            // Write reflection to JOURNAL.md
            if (reflection && reflection.length > 15) {
                const journalPath = this.config.get('journalPath');
                const entry = `\n\n## [${new Date().toISOString()}] Post-Action Reflection\n**Task**: ${desc.slice(0, 150)}\n**Status**: ${status} (${stepCount} steps)\n**Skills**: ${skillsUsed || 'none'}\n\n${reflection}\n`;

                try {
                    fs.appendFileSync(journalPath, entry);
                    logger.info(`Agent: Journal reflection written for action ${action.id}`);
                } catch (e) {
                    logger.warn(`Agent: Failed to write journal reflection: ${e}`);
                }
            }

        } catch (e) {
            // Background task — never let this crash the main flow
            logger.debug(`Agent: postActionReflection error: ${e}`);
        }
    }

    /**
     * Extract a topic label from a task description for LEARNING.md headings.
     */
    private extractTopicFromDescription(description: string): string {
        // Remove channel/user prefixes
        let topic = description
            .replace(/^\[.*?\]\s*/g, '')
            .replace(/^Message from .*?:\s*/ig, '')
            .replace(/^Reply to .*?:\s*/ig, '')
            .trim();

        // Truncate to a reasonable heading length
        if (topic.length > 80) {
            // Try to cut at a word boundary
            topic = topic.slice(0, 80).replace(/\s+\S*$/, '') + '...';
        }

        return topic || 'Miscellaneous Action';
    }

    /**
     * Classify task complexity using a fast LLM call.
     * Returns a complexity level that drives all downstream limits (steps, messages, simulation).
     * 
     * Levels:
     *   trivial  — Greetings, acknowledgments, emoji-only (1 step, 1 message)
     *   simple   — Quick questions, yes/no, direct answers (3 steps, 2 messages)
     *   standard — Normal conversation, requests, short tasks (configMaxSteps, configMaxMessages)
     *   complex  — Multi-step work: research, building, browsing, coding (configMaxSteps, higher messages)
     *
     * Falls back to a lightweight heuristic if LLM is unavailable or fails.
     */
    private async classifyTaskComplexity(description: string): Promise<'trivial' | 'simple' | 'standard' | 'complex'> {
        // Extract the actual user message from the task description
        const quotedMatch = description.match(/"([^"]+)"/);
        const payload = (quotedMatch?.[1] || description).trim().toLowerCase();

        // Ultra-fast heuristic pre-filter for obvious trivials (avoid LLM call)
        if (payload.length <= 5 || /^(hi|hey|hello|yo|sup|lol|ok|k|bye|thanks|ty|gm|gn|🙏|👍|👎|❤️|😊)$/i.test(payload)) {
            return 'trivial';
        }

        try {
            const response = await this.llm.callFast(
                `Classify this message's complexity for an AI assistant. Message: "${payload.slice(0, 200)}"\n\nReply with ONLY one word: trivial, simple, standard, or complex.\n- trivial: greetings, thanks, acknowledgments, single emoji, casual openers\n- simple: quick factual questions, yes/no, preferences, one-line answers\n- standard: normal requests, conversation, short tasks\n- complex: research, building, coding, multi-step work, browsing, file creation, image generation`,
                'You are a task classifier. Reply with exactly one word: trivial, simple, standard, or complex. Nothing else.'
            );
            const normalized = response.trim().toLowerCase().replace(/[^a-z]/g, '');
            if (['trivial', 'simple', 'standard', 'complex'].includes(normalized)) {
                logger.debug(`Agent: Task classified as "${normalized}" for: "${payload.slice(0, 60)}..."`);
                return normalized as any;
            }
        } catch (e) {
            logger.debug(`Agent: LLM task classification failed, using heuristic: ${e}`);
        }

        // Heuristic fallback
        if (payload.length <= 50 && !payload.includes('build') && !payload.includes('create') &&
            !payload.includes('search') && !payload.includes('find')) {
            return 'simple';
        }
        return 'standard';
    }

    private getPluginHealthCheckIntervalMs(): number {
        const minutes = this.config.get('pluginHealthCheckIntervalMinutes') || 15;
        return Math.max(1, minutes) * 60 * 1000;
    }

    private async runPluginHealthCheck(trigger: 'startup' | 'tick') {
        const now = Date.now();
        if (now - this.lastPluginHealthCheckAt < this.getPluginHealthCheckIntervalMs()) return;
        this.lastPluginHealthCheckAt = now;

        const { healthy, issues } = await this.skills.checkPluginsHealth();
        if (healthy.length > 0) {
            logger.info(`Agent: Plugin health check (${trigger}) healthy: ${healthy.join(', ')}`);
        }

        if (issues.length === 0) return;

        for (const issue of issues) {
            logger.warn(`Agent: Plugin health issue detected (${issue.skillName}): ${issue.error}`);
            this.memory.saveMemory({
                id: `plugin-health-${issue.skillName}-${Date.now()}`,
                type: 'short',
                content: `Plugin health issue: ${issue.skillName} at ${issue.pluginPath} - ${issue.error}`,
                metadata: { tool: 'plugin_health_check', plugin: issue.skillName, path: issue.pluginPath }
            });

            let repaired = false;
            try {
                await this.skills.executeSkill('self_repair_skill', {
                    skillName: issue.skillName,
                    errorMessage: issue.error,
                    pluginPath: issue.pluginPath,
                    trigger
                });
                repaired = true;
                logger.info(`Agent: self_repair_skill executed for ${issue.skillName}`);
            } catch (e) {
                logger.warn(`Agent: self_repair_skill unavailable or failed for ${issue.skillName}: ${e}`);
            }

            if (!repaired) {
                await this.pushTask(
                    `System Alert: Plugin health check failed for '${issue.skillName}'. Error:\n${issue.error}\n\nPlease use 'self_repair_skill' to fix it immediately.`,
                    10,
                    { source: 'system', error: issue.error, skillName: issue.skillName },
                    'autonomy'
                );
            }
        }
    }

    /**
     * Detects if a message contains a question that requires user input.
     * Used to auto-pause execution and wait for user response.
     */
    private messageContainsQuestion(message: string): boolean {
        const normalized = message.toLowerCase().trim();

        // Direct question indicators
        const questionPatterns = [
            /\?$/,  // Ends with question mark
            /\bwould you (like|prefer|want)\b/i,
            /\bdo you (want|need|prefer)\b/i,
            /\bshould i\b/i,
            /\bwhat (would|do|should)\b/i,
            /\bwhich (one|option|would)\b/i,
            /\bcan you (tell|provide|give|confirm|clarify)\b/i,
            /\blet me know\b/i,
            /\bplease (confirm|clarify|specify|tell)\b/i,
            /\bis that (ok|okay|fine|correct|right)\b/i,
            /\bwhat('s| is) your (preference|choice)\b/i,
            /\b(local files?|deployable|hosted)\s*(or|vs)\b/i,  // Common clarification patterns
            /\bclarif(y|ication)\b/i,
            /\bprefer(ence|red)?\??\b.*\bor\b/i,
        ];

        // Check if message contains question patterns
        for (const pattern of questionPatterns) {
            if (pattern.test(normalized)) {
                return true;
            }
        }

        // Also check for "either...or" choice patterns
        if (/\beither\b.*\bor\b/i.test(normalized)) {
            return true;
        }

        return false;
    }

    private getGuidanceMode(): 'strict' | 'balanced' | 'fluid' {
        const mode = String(this.config.get('guidanceMode') || 'balanced').toLowerCase();
        if (mode === 'strict' || mode === 'balanced' || mode === 'fluid') return mode;
        return 'balanced';
    }

    private extractLikelyPaths(text: string, maxItems: number = 8): string[] {
        if (!text) return [];
        const matches: string[] = [];

        const windowsPathRegex = /[A-Za-z]:\\[^\s"'`]+/g;
        const unixPathRegex = /(?:^|\s)(\/[\w@%./\-]+(?:\.[\w\-]+)?)/g;

        const win = text.match(windowsPathRegex) || [];
        for (const entry of win) {
            matches.push(entry.trim());
            if (matches.length >= maxItems) return Array.from(new Set(matches));
        }

        let unixMatch: RegExpExecArray | null;
        while ((unixMatch = unixPathRegex.exec(text)) !== null) {
            const value = (unixMatch[1] || '').trim();
            if (!value) continue;
            matches.push(value);
            if (matches.length >= maxItems) break;
        }

        return Array.from(new Set(matches)).slice(0, maxItems);
    }

    private buildToolSignatureKey(toolName: string, metadata: any): string {
        const md = metadata || {};
        const salient = md.command || md.cmd || md.url || md.query || md.path || md.selector || md.text || md.message || JSON.stringify(md);
        return `${String(toolName || '').toLowerCase()}:${String(salient || '').toLowerCase().slice(0, 280)}`;
    }

    private buildSessionContinuityHint(payload: any): string {
        if (!this.config.get('sessionAnchorEnabled')) return '';
        if (!payload?.source) return '';

        const source = String(payload.source).toLowerCase();
        const sessionScopeId = payload?.sessionScopeId || (payload?.sourceId ? `${source}:${payload.sourceId}` : undefined);
        if (!sessionScopeId) return '';

        const maxHintsRaw = Number(this.config.get('sessionAnchorMaxHints') ?? 4);
        const maxHints = Number.isFinite(maxHintsRaw) ? Math.max(1, Math.min(8, Math.floor(maxHintsRaw))) : 4;

        const shortAll = this.memory.searchMemory('short');
        const anchors = shortAll
            .filter(m => {
                const md: any = (m as any).metadata || {};
                return md.sessionAnchor === true && String(md.sessionScopeId || '') === String(sessionScopeId);
            })
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            })
            .slice(0, maxHints);

        if (anchors.length === 0) return '';

        const lines = anchors.map(a => {
            const md: any = (a as any).metadata || {};
            const path = md.path || this.extractLikelyPaths(String((a as any).content || ''), 1)[0] || '';
            const tool = md.tool ? ` (${md.tool})` : '';
            return path ? `- ${path}${tool}` : `- ${String((a as any).content || '').slice(0, 160)}`;
        });

        return `SESSION CONTINUITY HINTS:\n${lines.join('\n')}`;
    }

    private buildSimulationContext(payload: any, options?: { maxChars?: number }): string {
        const maxChars = Math.max(1000, Number(options?.maxChars ?? 6000));
        const source = String(payload?.source || '').toLowerCase();
        const sourceId = String(payload?.sourceId || payload?.chatId || payload?.userId || payload?.senderId || '');
        const sessionContinuityHint = this.buildSessionContinuityHint(payload);
        const recentHist = this.memory.getRecentContext(20);
        const recentContext = recentHist
            .map(c => `[${c.type}] ${String(c.content || '').slice(0, 280)}`)
            .join('\n');

        const userSnapshot = String(this.memory.getUserContext()?.raw || '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .slice(0, 8)
            .join(' | ')
            .slice(0, 500);

        const bootstrapCtx = this.bootstrap?.loadBootstrapContext?.() || {};
        const identitySnapshot = String(bootstrapCtx.IDENTITY || '').split('\n').slice(0, 10).join('\n').trim();
        const soulSnapshot = String(bootstrapCtx.SOUL || '').split('\n').slice(0, 10).join('\n').trim();

        const dataHome = this.config.getDataHome();
        const learningPath = this.config.get('learningPath') || path.join(dataHome, 'LEARNING.md');
        const learningTail = fs.existsSync(learningPath)
            ? fs.readFileSync(learningPath, 'utf-8').slice(-1200)
            : '';

        const channelExchanges = (source && sourceId)
            ? this.memory.getUserRecentExchanges({ platform: source, contactId: sourceId }, 6)
                .map(m => `- ${String(m.content || '').slice(0, 180)}`)
                .join('\n')
            : '';

        const raw = [
            recentContext ? `RECENT MEMORY:\n${recentContext}` : '',
            sessionContinuityHint,
            userSnapshot ? `USER.md SNAPSHOT:\n${userSnapshot}` : '',
            identitySnapshot ? `IDENTITY.md SNAPSHOT:\n${identitySnapshot}` : '',
            soulSnapshot ? `SOUL.md SNAPSHOT:\n${soulSnapshot}` : '',
            learningTail ? `LEARNING.md (recent tail):\n${learningTail}` : '',
            channelExchanges ? `CHANNEL EXCHANGES (${source}:${sourceId}):\n${channelExchanges}` : ''
        ].filter(Boolean).join('\n\n');

        return raw.length > maxChars ? raw.slice(-maxChars) : raw;
    }

    private saveSessionAnchorFromToolResult(action: Action, step: number, toolName: string, toolMetadata: any, toolResult: any, resultIndicatesError: boolean): void {
        try {
            if (!this.config.get('sessionAnchorEnabled')) return;
            if (resultIndicatesError) return;
            if (!action?.payload?.source) return;

            const source = String(action.payload.source).toLowerCase();
            const sessionScopeId = action.payload?.sessionScopeId || (action.payload?.sourceId ? `${source}:${action.payload.sourceId}` : undefined);
            if (!sessionScopeId) return;

            const resultString = JSON.stringify(toolResult || '');
            const metadataString = JSON.stringify(toolMetadata || '');
            const paths = [
                ...this.extractLikelyPaths(resultString, 8),
                ...this.extractLikelyPaths(metadataString, 4)
            ];
            const uniquePaths = Array.from(new Set(paths)).slice(0, 4);
            if (uniquePaths.length === 0) return;

            const shortAll = this.memory.searchMemory('short');
            const recentAnchorForScope = shortAll
                .filter(m => {
                    const md: any = (m as any).metadata || {};
                    return md.sessionAnchor === true && String(md.sessionScopeId || '') === String(sessionScopeId);
                })
                .sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                })[0];

            const chosenPath = uniquePaths[0];
            if (recentAnchorForScope) {
                const recentPath = String(((recentAnchorForScope as any).metadata || {}).path || '');
                if (recentPath && recentPath === chosenPath) return;
            }

            this.memory.saveMemory({
                id: `${action.id}-step-${step}-session-anchor-${toolName}`,
                type: 'short',
                content: `[SESSION_ANCHOR] Active path/context: ${chosenPath}. Reuse this location for follow-up steps in the same session.`,
                metadata: {
                    actionId: action.id,
                    step,
                    tool: toolName,
                    sessionAnchor: true,
                    sessionScopeId,
                    source,
                    sourceId: action.payload?.sourceId,
                    path: chosenPath
                }
            });
        } catch (e) {
            logger.debug(`Agent: Failed to save session anchor: ${e}`);
        }
    }

    private buildContinuationPacket(actionId: string): {
        artifactPaths: string[];
        successHighlights: string[];
        repeatFailureHints: string[];
    } {
        const memories = this.memory.getActionMemories(actionId);
        if (!memories || memories.length === 0) {
            return { artifactPaths: [], successHighlights: [], repeatFailureHints: [] };
        }

        const recent = memories.slice(-30);
        const artifactPaths = new Set<string>();
        const successHighlights: string[] = [];
        const repeatFailureHints: string[] = [];

        for (const memoryEntry of recent) {
            const content = String(memoryEntry.content || '');
            const md: any = memoryEntry.metadata || {};

            const directPaths = this.extractLikelyPaths(content, 6);
            directPaths.forEach(p => artifactPaths.add(p));

            if (md?.input?.path && typeof md.input.path === 'string') artifactPaths.add(md.input.path);
            if (md?.input?.cwd && typeof md.input.cwd === 'string') artifactPaths.add(md.input.cwd);
            if (md?.result?.path && typeof md.result.path === 'string') artifactPaths.add(md.result.path);

            const isSuccess = content.startsWith('✅ Tool') || content.includes('FILE DELIVERED SUCCESSFULLY');
            if (isSuccess && successHighlights.length < 5) {
                successHighlights.push(content.slice(0, 260));
            }

            const isFailureHint = content.includes('TOOL ERROR') || content.includes('FAILED with params') || content.includes('CRITICAL —');
            if (isFailureHint && repeatFailureHints.length < 4) {
                repeatFailureHints.push(content.slice(0, 260));
            }
        }

        return {
            artifactPaths: Array.from(artifactPaths).slice(0, 10),
            successHighlights,
            repeatFailureHints
        };
    }

    private isRobustReasoningEnabled(): boolean {
        return !!this.config.get('robustReasoningMode');
    }

    private shouldExposeChecklistPreview(): boolean {
        // Checklist previews are opt-in only; robust mode should not auto-send them.
        return !!this.config.get('reasoningExposeChecklist');
    }

    private extractChecklistItemsFromPlan(plan: string, maxItems: number): string[] {
        if (!plan || typeof plan !== 'string') return [];
        const lines = plan
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !/^execution\s*plan\s*:?$/i.test(line));

        const items: string[] = [];
        for (const line of lines) {
            const numbered = line.match(/^\d+[\.)]\s+(.+)$/);
            const bullet = line.match(/^[\-*•]\s+(.+)$/);
            const checked = line.match(/^\[[ xX]\]\s+(.+)$/);
            const value = (numbered?.[1] || bullet?.[1] || checked?.[1] || '').trim();
            if (!value) continue;
            items.push(value.replace(/\s+/g, ' '));
            if (items.length >= maxItems) break;
        }

        return items;
    }

    private buildChecklistPreviewMessage(executionPlan: string): string {
        const configured = Number(this.config.get('reasoningChecklistMaxItems') ?? 5);
        const maxItems = Number.isFinite(configured)
            ? Math.min(8, Math.max(3, Math.floor(configured)))
            : 5;
        const items = this.extractChecklistItemsFromPlan(executionPlan, maxItems);
        if (items.length === 0) {
            return '';
        }

        const body = items.map((item, index) => `${index + 1}. ${item}`).join('\n');
        const robustTag = this.isRobustReasoningEnabled() ? '\n\nMode: robust reasoning (strict completion checks enabled).' : '';
        return `🧭 Task checklist\n${body}${robustTag}`;
    }

    private async sendChecklistPreview(action: Action, message: string): Promise<boolean> {
        if (!message || !action.payload?.source) return false;
        const source = action.payload.source;
        const sourceId = action.payload.sourceId;

        // Never send internal execution checklists to end-user channels.
        const userFacingSources = new Set(['telegram', 'whatsapp', 'discord', 'slack', 'email', 'gateway-chat']);
        if (userFacingSources.has(String(source).toLowerCase())) {
            logger.debug(`Checklist preview suppressed for user-facing source: ${source}`);
            return false;
        }

        if (source !== 'gateway-chat' && !sourceId) return false;

        try {
            if (source === 'telegram' && this.telegram) {
                await this.telegram.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'whatsapp' && this.whatsapp) {
                await this.whatsapp.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'discord' && this.discord) {
                await this.discord.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'slack' && this.slack) {
                await this.slack.sendMessage(sourceId, message);
                return true;
            }
            if (source === 'email') {
                const emailChannel = this.getOrCreateEmailChannel();
                if (!emailChannel) return false;
                await emailChannel.sendEmail(sourceId, action.payload?.subject ? `Re: ${action.payload.subject}` : 'OrcBot response', message, action.payload?.inReplyTo, action.payload?.references);
                return true;
            }
            if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: message,
                    timestamp: new Date().toISOString(),
                    messageId: `checklist-${Date.now()}`
                });
                return true;
            }
        } catch (e) {
            logger.debug(`Failed to send checklist preview: ${e}`);
        }

        return false;
    }

    private buildAuditCode(issues: string[]): string {
        const auditCodes = (issues || []).map(issue => {
            const normalized = issue.toLowerCase();
            if (normalized.includes('no user-visible message')) return 'NO_SEND';
            if (normalized.includes('deep tool output exists after the last sent message')) return 'UNSENT_RESULTS';
            if (normalized.includes('deep/research tools ran, but no substantive delivery')) return 'NO_SUBSTANTIVE';
            if (normalized.includes('only acknowledgement/status-style messages')) return 'ACK_ONLY';
            if (normalized.includes('tool errors occurred')) return 'ERROR_UNRESOLVED';
            return 'GENERIC';
        });
        const uniqueCodes = Array.from(new Set(auditCodes));
        return `AUDIT_BLOCK:${uniqueCodes.join('+')}`;
    }

    private buildActionTimeSignals(
        action: Action,
        context: {
            actionStartedAtMs: number;
            currentStep: number;
            messagesSent: number;
            stepsSinceLastMessage: number;
            lastUserDeliveryAtMs: number;
            isResearchTask: boolean;
        }
    ): {
        nowIso: string;
        queueAgeSec: number;
        actionRuntimeSec: number;
        sinceLastDeliverySec: number;
        avgSecPerStep: number;
        currentStep: number;
        messagesSent: number;
        stepsSinceLastMessage: number;
        taskIntent: string;
        delayRisk: 'low' | 'medium' | 'high';
    } {
        const now = Date.now();
        const queuedAtMs = action.timestamp ? new Date(action.timestamp).getTime() : context.actionStartedAtMs;
        const queueAgeSec = Math.max(0, Math.floor((context.actionStartedAtMs - queuedAtMs) / 1000));
        const actionRuntimeSec = Math.max(0, Math.floor((now - context.actionStartedAtMs) / 1000));
        const sinceLastDeliverySec = Math.max(0, Math.floor((now - context.lastUserDeliveryAtMs) / 1000));
        const avgSecPerStep = context.currentStep > 0
            ? Number((actionRuntimeSec / context.currentStep).toFixed(1))
            : 0;

        const isUserFacing = ['telegram', 'whatsapp', 'discord', 'slack', 'email', 'gateway-chat'].includes(String(action.payload?.source || '').toLowerCase());
        const taskIntent = action.payload?.isHeartbeat
            ? 'heartbeat'
            : action.payload?.requiresResponse === true
                ? 'user_response'
                : context.isResearchTask
                    ? 'research_execution'
                    : 'task_execution';

        const highRiskNoMessageSeconds = Math.max(5, Number(this.config.get('timeSignalHighRiskNoMessageSeconds') ?? 25));
        const mediumRiskSilentSteps = Math.max(1, Number(this.config.get('timeSignalMediumRiskSilentSteps') ?? 4));
        const mediumRiskSinceDeliverySeconds = Math.max(10, Number(this.config.get('timeSignalMediumRiskSinceDeliverySeconds') ?? 45));

        let delayRisk: 'low' | 'medium' | 'high' = 'low';
        if (isUserFacing) {
            if (context.messagesSent === 0 && actionRuntimeSec >= highRiskNoMessageSeconds) {
                delayRisk = 'high';
            } else if (context.stepsSinceLastMessage >= mediumRiskSilentSteps || sinceLastDeliverySec >= mediumRiskSinceDeliverySeconds) {
                delayRisk = 'medium';
            }
        }

        return {
            nowIso: new Date(now).toISOString(),
            queueAgeSec,
            actionRuntimeSec,
            sinceLastDeliverySec,
            avgSecPerStep,
            currentStep: context.currentStep,
            messagesSent: context.messagesSent,
            stepsSinceLastMessage: context.stepsSinceLastMessage,
            taskIntent,
            delayRisk
        };
    }

    private getGuidanceRegexList(configKey: string, fallbackPatterns: string[]): RegExp[] {
        const raw = this.config.get(configKey);
        const patterns = Array.isArray(raw) && raw.length > 0 ? raw : fallbackPatterns;
        const compiled: RegExp[] = [];
        for (const pattern of patterns) {
            try {
                compiled.push(new RegExp(String(pattern), 'i'));
            } catch {
                // Ignore invalid patterns
            }
        }
        return compiled;
    }

    private getGuidanceStopWords(): Set<string> {
        const raw = this.config.get('guidanceQuestionStopWords');
        const defaults = [
            'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
            'be', 'been', 'being', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'please',
            'you', 'your', 'me', 'my', 'we', 'our', 'it', 'this', 'that', 'with', 'about', 'if', 'as', 'by'
        ];
        const words = Array.isArray(raw) && raw.length > 0 ? raw : defaults;
        return new Set(words.map(w => String(w).toLowerCase().trim()).filter(Boolean));
    }

    private getQuestionSemanticFingerprint(message: string): Set<string> {
        const normalized = (message || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const stopWords = this.getGuidanceStopWords();

        const tokens = normalized
            .split(' ')
            .map(t => t.trim())
            .filter(t => t.length > 2 && !stopWords.has(t));

        return new Set(tokens);
    }

    private questionSimilarity(a: string, b: string): number {
        const setA = this.getQuestionSemanticFingerprint(a);
        const setB = this.getQuestionSemanticFingerprint(b);
        if (setA.size === 0 || setB.size === 0) return 0;

        let overlap = 0;
        for (const token of setA) {
            if (setB.has(token)) overlap++;
        }

        return overlap / Math.max(setA.size, setB.size);
    }

    private getOutboundMessageFingerprint(message: string): Set<string> {
        const normalized = (message || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const stopWords = this.getGuidanceStopWords();
        const tokens = normalized
            .split(' ')
            .map(t => t.trim())
            .filter(t => t.length > 2 && !stopWords.has(t));

        return new Set(tokens);
    }

    private outboundMessageSimilarity(a: string, b: string): number {
        const setA = this.getOutboundMessageFingerprint(a);
        const setB = this.getOutboundMessageFingerprint(b);
        if (setA.size === 0 || setB.size === 0) return 0;

        let overlap = 0;
        for (const token of setA) {
            if (setB.has(token)) overlap++;
        }
        return overlap / Math.max(setA.size, setB.size);
    }

    private isSemanticallyDuplicateOutboundMessage(currentMessage: string, priorMessages: string[]): boolean {
        const current = (currentMessage || '').trim();
        if (!current || priorMessages.length === 0) return false;

        // Keep this conservative to avoid blocking legitimate incremental updates.
        if (current.length < 16) return false;
        if (this.isSubstantiveFollowUpMessage(current)) return false;

        for (const prior of priorMessages.slice(-8)) {
            const candidate = (prior || '').trim();
            if (!candidate) continue;
            const score = this.outboundMessageSimilarity(current, candidate);
            if (score >= 0.88) return true;
        }
        return false;
    }

    private isRepeatedClarificationQuestion(currentMessage: string, priorMessages: string[]): boolean {
        if (!this.messageContainsQuestion(currentMessage)) return false;

        const mode = this.getGuidanceMode();
        const configuredThreshold = Number(this.config.get('guidanceRepeatQuestionThreshold') ?? 0.65);
        const baseThreshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 0.65;
        const similarityThreshold = mode === 'strict'
            ? Math.max(0.4, baseThreshold - 0.1)
            : mode === 'fluid'
                ? Math.min(0.9, baseThreshold + 0.1)
                : baseThreshold;

        const current = (currentMessage || '').trim();
        for (const prior of priorMessages.slice(-6)) {
            if (!this.messageContainsQuestion(prior)) continue;
            const score = this.questionSimilarity(current, prior);
            if (score >= similarityThreshold) {
                return true;
            }
        }
        return false;
    }

    private isLikelyAcknowledgementMessage(message: string): boolean {
        const normalized = (message || '').toLowerCase().trim();
        if (!normalized) return false;

        if (normalized.length > 220) return false;

        const ackPatterns = this.getGuidanceRegexList('guidanceAckPatterns', [
            '^(understood|got it|on it|acknowledged|okay|ok|alright|sure|perfect)\\b',
            '^thanks?[,.!\\s]',
            "\\bi\\s*(am|'m)\\s*(ready|working on|going to|about to)\\b",
            '\\bi\\s*will\\s*now\\b',
            '\\bworking on it\\b',
            '\\blet me\\b'
        ]);

        const hasEnumeratedList = /\n\s*\d+\.|\b1\.|\b2\.|\b3\.|\b4\.|\b5\./.test(normalized);
        const hasMultipleQuestions = (normalized.match(/\?/g) || []).length >= 2;
        if (hasEnumeratedList || hasMultipleQuestions) return false;

        return ackPatterns.some(p => p.test(normalized));
    }

    private isSubstantiveFollowUpMessage(message: string): boolean {
        const normalized = (message || '').trim();
        if (!normalized) return false;

        const hasEnumeratedList = /\n\s*\d+\.|\b1\.|\b2\.|\b3\.|\b4\.|\b5\./.test(normalized);
        const questionCount = (normalized.match(/\?/g) || []).length;
        const isLongEnough = normalized.length >= 120;
        const hasMultipleLines = normalized.split('\n').filter(Boolean).length >= 3;

        return hasEnumeratedList || questionCount >= 2 || (isLongEnough && hasMultipleLines);
    }

    /**
     * Detect whether a sent message is a substantive delivery (not a short status/reassurance).
     * Used by completion gate to avoid terminating after only "working on it"-style replies.
     */
    private isSubstantiveDeliveryMessage(message: string): boolean {
        const normalized = (message || '').toLowerCase().trim();
        if (!normalized) return false;
        if (normalized.length < 40) return false;

        const lowValuePatterns = this.getGuidanceRegexList('guidanceLowValuePatterns', [
            '^(got it|on it|working on it|one moment|hang tight|be right back|still working)[.!]?$',
            "^i('m| am) (checking|working on|looking into)\\b",
            '^quick update[:\\-]?\\s*$',
            '^sorry[,\\s]',
            '^(understood|acknowledged)[,.!\\s]',
            "\\bi\\s*(am|'m)\\s*ready\\s*to\\b",
            '\\bi\\s*will\\s*now\\b'
        ]);
        if (lowValuePatterns.some(p => p.test(normalized))) return false;

        return true;
    }

    private setupEventListeners() {
        eventBus.on('scheduler:tick', async () => {
            try {
                await this.processNextAction();
                await this.runPluginHealthCheck('tick');
                await this.checkHeartbeat();
            } catch (e) {
                logger.error(`Scheduler tick error (non-fatal): ${e}`);
            }
        });

        eventBus.on('action:queued', (action: Action) => {
            logger.info(`Agent: Noticed new action ${action.id} in queue`);
            // Trigger immediate processing without waiting for the next scheduler tick.
            // This ensures channel messages (gateway, Telegram, etc.) are handled ASAP.
            if (!this.isBusy) {
                setImmediate(() => this.processNextAction().catch(e =>
                    logger.error(`Agent: Immediate action trigger error: ${e}`)
                ));
            }
        });

        // Listen for config changes and reload relevant components
        eventBus.on('config:changed', async (data: any) => {
            try {
                logger.info('Agent: Config changed, reloading affected components...');
                const { oldConfig, newConfig } = data;

                // Reload WhatsApp channel if settings changed
                const whatsappChanged =
                    oldConfig.whatsappEnabled !== newConfig.whatsappEnabled ||
                    oldConfig.whatsappAutoReplyEnabled !== newConfig.whatsappAutoReplyEnabled ||
                    oldConfig.whatsappStatusReplyEnabled !== newConfig.whatsappStatusReplyEnabled ||
                    oldConfig.whatsappAutoReactEnabled !== newConfig.whatsappAutoReactEnabled ||
                    oldConfig.whatsappContextProfilingEnabled !== newConfig.whatsappContextProfilingEnabled;

                if (whatsappChanged && this.whatsapp) {
                    logger.info('Agent: WhatsApp config changed, notifying channel...');
                    eventBus.emit('whatsapp:config-changed', newConfig);
                }

                // Reload memory limits if changed
                const memoryChanged =
                    oldConfig.memoryContextLimit !== newConfig.memoryContextLimit ||
                    oldConfig.memoryEpisodicLimit !== newConfig.memoryEpisodicLimit ||
                    oldConfig.memoryConsolidationThreshold !== newConfig.memoryConsolidationThreshold ||
                    oldConfig.memoryConsolidationBatch !== newConfig.memoryConsolidationBatch ||
                    oldConfig.memoryFlushSoftThreshold !== newConfig.memoryFlushSoftThreshold ||
                    oldConfig.memoryFlushCooldownMinutes !== newConfig.memoryFlushCooldownMinutes ||
                    oldConfig.memoryContentMaxLength !== newConfig.memoryContentMaxLength ||
                    oldConfig.memoryExtendedContextLimit !== newConfig.memoryExtendedContextLimit ||
                    oldConfig.memoryInteractionBatchSize !== newConfig.memoryInteractionBatchSize ||
                    oldConfig.memoryInteractionStaleMinutes !== newConfig.memoryInteractionStaleMinutes ||
                    oldConfig.memoryDedupWindowMinutes !== newConfig.memoryDedupWindowMinutes ||
                    oldConfig.userExchangeContextLimit !== newConfig.userExchangeContextLimit;

                if (memoryChanged) {
                    this.memory.setLimits({
                        contextLimit: newConfig.memoryContextLimit,
                        episodicLimit: newConfig.memoryEpisodicLimit,
                        consolidationThreshold: newConfig.memoryConsolidationThreshold,
                        consolidationBatch: newConfig.memoryConsolidationBatch,
                        memoryFlushSoftThreshold: newConfig.memoryFlushSoftThreshold,
                        memoryFlushCooldownMinutes: newConfig.memoryFlushCooldownMinutes,
                        memoryContentMaxLength: newConfig.memoryContentMaxLength,
                        memoryExtendedContextLimit: newConfig.memoryExtendedContextLimit,
                        interactionBatchSize: newConfig.memoryInteractionBatchSize,
                        interactionStaleMinutes: newConfig.memoryInteractionStaleMinutes,
                        memoryDedupWindowMinutes: newConfig.memoryDedupWindowMinutes,
                        userExchangeDefaultLimit: newConfig.userExchangeContextLimit
                    });
                    logger.info('Agent: Memory limits reloaded');
                }

                // Reload AgenticUser settings if changed
                const agenticUserChanged =
                    oldConfig.agenticUserEnabled !== newConfig.agenticUserEnabled ||
                    oldConfig.agenticUserResponseDelay !== newConfig.agenticUserResponseDelay ||
                    oldConfig.agenticUserConfidenceThreshold !== newConfig.agenticUserConfidenceThreshold ||
                    oldConfig.agenticUserProactiveGuidance !== newConfig.agenticUserProactiveGuidance ||
                    oldConfig.agenticUserCheckInterval !== newConfig.agenticUserCheckInterval ||
                    oldConfig.agenticUserMaxInterventions !== newConfig.agenticUserMaxInterventions;

                if (agenticUserChanged) {
                    this.agenticUser.reloadSettings();
                    logger.info('Agent: AgenticUser settings reloaded');
                }
            } catch (e) {
                logger.error(`Agent: Error handling config change: ${e}`);
            }
        });

        // ── Agentic User → notify real user on the originating channel ──
        eventBus.on('agentic-user:intervention', async (data: any) => {
            try {
                // Check if user notifications are enabled
                if (this.config.get('agenticUserNotifyUser') === false) return;

                const { type, confidence, response, source, sourceId, trigger } = data;
                if (!source || source === 'unknown' || !sourceId || sourceId === 'unknown') {
                    logger.debug('AgenticUser notification skipped: no channel info on action');
                    return;
                }

                // Build a concise notification
                const typeLabel = type === 'question-answer' ? '💬 Answered a question'
                    : type === 'direction-guidance' ? '🧭 Provided direction'
                        : '🔧 Stuck recovery';
                const notification = [
                    `🤖 *Agentic User Intervention* (${confidence}% confidence)`,
                    `${typeLabel}`,
                    '',
                    trigger ? `_Trigger:_ ${trigger.slice(0, 150)}${trigger.length > 150 ? '…' : ''}` : '',
                    `_Response:_ ${response.slice(0, 300)}${response.length > 300 ? '…' : ''}`,
                    '',
                    `_Review this and correct if needed. Reply to override._`,
                ].filter(Boolean).join('\n');

                // Route to the originating channel
                if (source === 'telegram' && this.telegram) {
                    await this.telegram.sendMessage(sourceId, notification);
                    logger.info(`Agent: Sent AgenticUser notification to Telegram ${sourceId}`);
                } else if (source === 'whatsapp' && this.whatsapp) {
                    await this.whatsapp.sendMessage(sourceId, notification);
                    logger.info(`Agent: Sent AgenticUser notification to WhatsApp ${sourceId}`);
                } else if (source === 'discord' && this.discord) {
                    await this.discord.sendMessage(sourceId, notification);
                    logger.info(`Agent: Sent AgenticUser notification to Discord ${sourceId}`);
                } else if (source === 'slack' && this.slack) {
                    await this.slack.sendMessage(sourceId, notification);
                    logger.info(`Agent: Sent AgenticUser notification to Slack ${sourceId}`);
                } else if (source === 'email') {
                    const emailChannel = this.getOrCreateEmailChannel();
                    if (!emailChannel) return;
                    await emailChannel.sendEmail(sourceId, 'OrcBot intervention', notification);
                    logger.info(`Agent: Sent AgenticUser notification to Email ${sourceId}`);
                } else if (source === 'gateway' || source === 'gateway-chat') {
                    eventBus.emit('gateway:chat:response', {
                        type: 'chat:message',
                        role: 'system',
                        content: notification,
                        format: 'markdown',
                        agenticUser: true,
                        timestamp: new Date().toISOString()
                    });
                    logger.info(`Agent: Sent AgenticUser notification to Gateway`);
                }
            } catch (err) {
                logger.error(`Agent: Failed to send AgenticUser notification: ${err}`);
            }
        });
    }

    private parseWorldEventSources(input: string[] | string | undefined): WorldEventSource[] {
        const raw = Array.isArray(input) ? input.join(',') : String(input || '');
        const list = raw
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        const allowed: WorldEventSource[] = ['gdelt', 'usgs', 'opensky'];
        const selected = list.filter(s => allowed.includes(s as WorldEventSource)) as WorldEventSource[];
        return selected.length ? selected : ['gdelt', 'usgs'];
    }

    private async maybeRefreshWorldEventsContext(force: boolean = false): Promise<void> {
        if (this.config.get('worldEventsHeartbeatEnabled') === false) return;
        if (this.worldEventsRefreshRunning) return;

        const now = Date.now();
        const refreshSeconds = Math.max(60, Number(this.config.get('worldEventsRefreshSeconds') ?? 60));
        if (!force && (now - this.lastWorldEventsRefreshAt) < refreshSeconds * 1000) return;

        const sources = this.parseWorldEventSources(this.config.get('worldEventsSources'));
        if (!sources.length) return;

        const minutes = Math.max(5, Number(this.config.get('worldEventsLookbackMinutes') ?? 60));
        const maxRecords = Math.max(50, Number(this.config.get('worldEventsMaxRecords') ?? 250));
        const batchMinutes = Math.max(5, Number(this.config.get('worldEventsBatchMinutes') ?? 10));
        const gdeltQuery = String(this.config.get('worldEventsGdeltQuery') ?? 'global');

        this.worldEventsRefreshRunning = true;
        try {
            const events = await fetchWorldEvents(sources, { minutes, maxRecords, gdeltQuery });
            this.lastWorldEventsRefreshAt = now;

            if (!events.length) return;

            const windowEnd = new Date();
            const windowStart = new Date(windowEnd.getTime() - batchMinutes * 60 * 1000);
            const summary = summarizeWorldEvents(events, windowStart, windowEnd);
            const changed = summary !== this.lastWorldEventsSummary;
            this.lastWorldEventsSummary = summary;

            const writeDue = force || (now - this.lastWorldEventsMemoryWriteAt) >= batchMinutes * 60 * 1000;
            if (!changed || !writeDue) return;

            this.memory.saveMemory({
                id: `world-events-heartbeat-${Date.now()}`,
                type: 'episodic',
                content: `[WORLD EVENTS LIVE] ${summary}`,
                metadata: {
                    source: 'world-events-heartbeat',
                    category: 'world-events',
                    important: false
                }
            });
            this.lastWorldEventsMemoryWriteAt = Date.now();
        } catch (error) {
            logger.debug(`Agent: World events refresh skipped due to fetch issue: ${error}`);
        } finally {
            this.worldEventsRefreshRunning = false;
        }
    }

    private async checkHeartbeat() {
        this.detectStalledAction();
        this.recoverStaleInProgressActions();
        await this.maybeRefreshWorldEventsContext();

        // Mutex: prevent overlapping heartbeat evaluations
        if (this.heartbeatRunning) {
            logger.debug('Agent: Heartbeat skipped - another heartbeat evaluation is already running');
            return;
        }

        // CRITICAL: Skip heartbeat if agent is actively processing an action
        if (this.isBusy) {
            logger.debug('Agent: Heartbeat skipped - currently processing an action');
            return;
        }

        const autonomyEnabled = this.config.get('autonomyEnabled');
        const intervalMinutes = this.config.get('autonomyInterval') || 0;
        if (!autonomyEnabled || intervalMinutes <= 0) return;

        // Avoid heartbeat collisions immediately after fresh inbound user activity.
        const postUserCooldownMs = Math.max(0, Number(this.config.get('autonomyPostUserCooldownSeconds') ?? 90)) * 1000;
        if (postUserCooldownMs > 0 && this.lastUserActivityAt > 0) {
            const elapsedSinceUserActivity = Date.now() - this.lastUserActivityAt;
            if (elapsedSinceUserActivity < postUserCooldownMs) {
                logger.debug(`Agent: Heartbeat skipped - recent user activity ${Math.floor(elapsedSinceUserActivity / 1000)}s ago`);
                return;
            }
        }

        // Cooldown: skip if any heartbeat (including cron-scheduled) pushed a task very recently
        const heartbeatCooldownMs = 60_000;
        if (Date.now() - this.lastHeartbeatPushAt < heartbeatCooldownMs) {
            return;
        }

        // Check for tasks the agent is actively executing (in-progress or pending about to run)
        const runningTasks = this.actionQueue.getQueue().filter(a => a.status === 'pending' || a.status === 'in-progress');

        // CRITICAL: Skip heartbeat if there are pending/in-progress tasks
        // This prevents heartbeat from disrupting ongoing work.
        // NOTE: 'waiting' tasks do NOT block heartbeat — the agent is idle while waiting
        // for user input, and heartbeat scheduled tasks should still fire.
        if (runningTasks.length > 0) {
            logger.debug(`Agent: Heartbeat skipped - ${runningTasks.length} active task(s) in queue`);
            return;
        }

        const pendingHeartbeat = this.actionQueue.getQueue().find(a =>
            (a.status === 'pending' || a.status === 'in-progress') && a.payload?.isHeartbeat
        );
        if (pendingHeartbeat) {
            logger.debug(`Agent: Heartbeat skipped - pending heartbeat task ${pendingHeartbeat.id} already queued`);
            return;
        }

        const idleTimeMs = Date.now() - this.lastActionTime;

        // SMART COOLING: If the last heartbeat was unproductive (agent had nothing to do),
        // back off exponentially — 2×, 4×, up to 8× the base interval — so we don't spam
        // LLM calls when the agent is genuinely idle with nothing meaningful to do.
        // When any heartbeat actually does work (goalsMet=true) OR a real user action runs,
        // processNextAction resets lastHeartbeatProductive=true and consecutiveIdleHeartbeats=0.
        const cooldownMultiplier = this.lastHeartbeatProductive ? 1 : Math.min(8, Math.pow(2, this.consecutiveIdleHeartbeats));
        const effectiveIntervalMs = intervalMinutes * cooldownMultiplier * 60 * 1000;

        if ((Date.now() - this.lastHeartbeatAt) <= effectiveIntervalMs) {
            // Still within cooldown window
            return;
        }

        this.heartbeatRunning = true;
        try {
            logger.info(`Agent: Heartbeat trigger - Agent idle for ${Math.floor(idleTimeMs / 60000)}m. Cooldown multiplier: ${cooldownMultiplier}x`);

            // Check if we have workers available for delegation
            const runningWorkers = this.orchestrator.getRunningWorkers();
            const availableAgents = this.orchestrator.getAvailableAgents('execute');

            // Build a smarter, more targeted prompt
            const proactivePrompt = this.buildSmartHeartbeatPrompt(idleTimeMs, runningWorkers.length, availableAgents.length);

            // If we have idle workers, delegate research to them instead
            if (availableAgents.length > 0 && runningWorkers.length > 0) {
                logger.info(`Agent: Delegating heartbeat research to ${availableAgents.length} available worker(s)`);
                this.delegateHeartbeatResearch(availableAgents);
            } else {
                // No workers, do it ourselves but be efficient
                this.pushTask(proactivePrompt, 2, { isHeartbeat: true }, 'autonomy');
            }

            // Preset productivity to false — processNextAction will set it back to true
            // once the heartbeat executes and achieves goalsMet=true.
            this.lastHeartbeatProductive = false;
            this.consecutiveIdleHeartbeats++;
            this.updateLastHeartbeatTime();
            this.lastHeartbeatPushAt = Date.now();
        } finally {
            this.heartbeatRunning = false;
        }
    }

    private buildSmartHeartbeatPrompt(idleTimeMs: number, workerCount: number, availableWorkers: number): string {
        const now = Date.now();

        // ── 0. Heartbeat state — per-check cadence tracking ──────────────────
        // heartbeat-state.json tracks when each class of proactive check last ran.
        // The LLM reads this to avoid redundant rechecks and updates it via write_file.
        const heartbeatStatePath = path.join(path.dirname(this.config.get('actionQueuePath')), 'heartbeat-state.json');
        let heartbeatState: Record<string, number> = {};
        try {
            if (fs.existsSync(heartbeatStatePath)) {
                heartbeatState = JSON.parse(fs.readFileSync(heartbeatStatePath, 'utf-8'));
            }
        } catch { /* use empty state */ }

        const formatCheckAge = (ts: number | undefined): string => {
            if (!ts) return 'never';
            const ageMin = Math.floor((now - ts) / 60000);
            return ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
        };
        const checkStateSummary = [
            `email: ${formatCheckAge(heartbeatState.email)}`,
            `calendar: ${formatCheckAge(heartbeatState.calendar)}`,
            `social: ${formatCheckAge(heartbeatState.social)}`,
            `weather: ${formatCheckAge(heartbeatState.weather)}`,
            `news: ${formatCheckAge(heartbeatState.news)}`,
        ].join(' | ');

        // ── 1. Recent memories (short + episodic) with relative timestamps ──
        const recentMemories = this.memory.getRecentContext(20);
        const recentContext = recentMemories
            .filter(m => m.type === 'episodic' || m.type === 'short')
            .map(m => {
                const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
                const ageMs = now - ts;
                const ageMinutes = Math.floor(ageMs / 60000);
                const ageStr = ageMinutes < 60
                    ? `${ageMinutes}m ago`
                    : ageMinutes < 1440
                        ? `${Math.floor(ageMinutes / 60)}h ago`
                        : `${Math.floor(ageMinutes / 1440)}d ago`;
                const src = m.metadata?.source ? ` [${m.metadata.source}]` : '';
                return `[${ageStr}]${src} ${m.content}`;
            })
            .join('\n');

        // ── 2. Semantic memory highlights (vector search for unresolved/important items) ──
        let semanticHighlights = '';
        if (this.memory.vectorMemory?.isEnabled()) {
            try {
                // Fire-and-forget style: we run this synchronously by building the string later
                // But since we can't await here (sync method), we'll note the capability instead
                semanticHighlights = '(Vector memory active — use `recall_memory(query)` to semantically search all past conversations and actions)';
            } catch { /* graceful */ }
        }

        // ── 3. Task queue: failed, pending, recent completed ──
        const queue = this.actionQueue.getQueue();
        const failedTasks = queue
            .filter(a => a.status === 'failed')
            .slice(-3)
            .map(a => `  ✗ [FAILED] ${a.payload?.description?.slice(0, 100) || 'Unknown'}${a.retry ? ` (attempt ${a.retry.attempts}/${a.retry.maxAttempts})` : ''}`)
            .join('\n');
        const pendingTasks = queue
            .filter(a => a.status === 'pending')
            .slice(0, 3)
            .map(a => `  ⏳ [PENDING] ${a.payload?.description?.slice(0, 100) || 'Unknown'}`)
            .join('\n');
        const completedTasks = queue
            .filter(a => a.status === 'completed')
            .slice(-3)
            .map(a => `  ✓ [DONE] ${a.payload?.description?.slice(0, 100) || 'Unknown'}`)
            .join('\n');
        const taskSummary = [failedTasks, pendingTasks, completedTasks].filter(Boolean).join('\n') || 'No recent tasks';

        // ── 4. Active heartbeat schedules ──
        const activeSchedules = Array.from(this.heartbeatJobMeta.values())
            .map((s: any) => `  🔁 "${s.task}" — ${s.schedule}`)
            .join('\n') || 'None';

        // ── 5. User profile ──
        const userProfilePath = this.config.get('userProfilePath');
        let userContext = '';
        try {
            if (fs.existsSync(userProfilePath)) {
                userContext = fs.readFileSync(userProfilePath, 'utf-8').slice(0, 500);
            }
        } catch { /* ignore */ }

        // ── 6. Journal & Learning tails (match what DecisionEngine sees) ──
        let journalTail = '';
        let learningTail = '';
        try {
            const jp = this.config.get('journalPath');
            if (jp && fs.existsSync(jp)) {
                const full = fs.readFileSync(jp, 'utf-8');
                journalTail = full.length > 800 ? full.slice(-800) : full;
            }
            const lp = this.config.get('learningPath');
            if (lp && fs.existsSync(lp)) {
                const full = fs.readFileSync(lp, 'utf-8');
                learningTail = full.length > 800 ? full.slice(-800) : full;
            }
        } catch { /* ignore */ }

        // ── 7. Active channel status ──
        const channels: string[] = [];
        if (this.telegram) channels.push('Telegram (send_telegram)');
        if (this.whatsapp) channels.push('WhatsApp (send_whatsapp)');
        if (this.discord) channels.push('Discord (send_discord)');
        if (this.slack) channels.push('Slack (send_slack)');
        const channelStatus = channels.length > 0 ? channels.join(', ') : 'No channels active';

        // ── 8. Contact profiles summary ──
        let contactSummary = '';
        try {
            const profilesDir = path.join(path.dirname(this.config.get('actionQueuePath')), 'profiles');
            if (fs.existsSync(profilesDir)) {
                const profileFiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json')).slice(0, 5);
                if (profileFiles.length > 0) {
                    contactSummary = profileFiles.map(f => {
                        try {
                            const data = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf-8'));
                            return `  👤 ${data.name || f.replace('.json', '')}${data.relationship ? ` — ${data.relationship}` : ''}`;
                        } catch { return null; }
                    }).filter(Boolean).join('\n');
                }
            }
        } catch { /* ignore */ }

        // ── 9. Time-of-day and day-of-week awareness ──
        const nowDate = new Date();
        const hour = nowDate.getHours();
        const dayOfWeek = nowDate.toLocaleDateString('en-US', { weekday: 'long' });
        const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
        const isWeekend = nowDate.getDay() === 0 || nowDate.getDay() === 6;

        // ── 10. Compute idle severity for autonomy guidance ──
        const idleMinutes = Math.floor(idleTimeMs / 60000);
        const idleHours = Math.floor(idleMinutes / 60);
        const autonomyLevel = idleHours >= 4 ? 'high' : idleHours >= 1 ? 'moderate' : 'low';

        // ── 10b. Last heartbeat message age ──
        const lastMsgAgeMs = this.lastHeartbeatMessageSentAt > 0 ? now - this.lastHeartbeatMessageSentAt : -1;
        const lastMsgAgeStr = lastMsgAgeMs < 0
            ? 'never (no heartbeat message sent yet this session)'
            : lastMsgAgeMs < 3600_000
                ? `${Math.floor(lastMsgAgeMs / 60000)} minutes ago`
                : `${Math.round(lastMsgAgeMs / 3600_000 * 10) / 10} hours ago`;
        const messagingBarNote = lastMsgAgeMs >= 0 && lastMsgAgeMs < 14400_000
            ? `⚠️  A heartbeat message was sent ${lastMsgAgeStr}. The bar for sending ANOTHER message is VERY HIGH — only message if you have specific new actionable information that was NOT included in the previous message.`
            : lastMsgAgeMs < 0
                ? `No heartbeat message has been sent yet this session.`
                : `Last heartbeat message was ${lastMsgAgeStr} — messaging bar is normal.`;

        // ── 11. Available channels summary (skills are provided by the DecisionEngine, not duplicated here) ──
        const channelSkills = [];
        if (this.telegram) channelSkills.push('send_telegram');
        if (this.whatsapp) channelSkills.push('send_whatsapp');
        if (this.discord) channelSkills.push('send_discord');
        if (this.slack) channelSkills.push('send_slack');
        const channelSkillNote = channelSkills.length > 0
            ? `Messaging: ${channelSkills.join(', ')}`
            : 'No messaging channels active';

        const worldEventAgeMinutes = this.lastWorldEventsRefreshAt > 0
            ? Math.floor((now - this.lastWorldEventsRefreshAt) / 60000)
            : -1;
        const worldEventsContext = this.lastWorldEventsSummary
            ? `LATEST WORLD EVENTS SIGNAL ${worldEventAgeMinutes >= 0 ? `(refreshed ${worldEventAgeMinutes}m ago)` : ''}:\n${this.lastWorldEventsSummary.slice(0, 1200)}`
            : 'LATEST WORLD EVENTS SIGNAL: No recent world-event summary cached yet.';

        return `
PROACTIVE HEARTBEAT — Idle for ${idleMinutes} minutes.
Current Time: ${nowDate.toLocaleString()} (${dayOfWeek} ${timeOfDay})${isWeekend ? ' [Weekend]' : ''}
Autonomy Level: ${autonomyLevel} (${autonomyLevel === 'high' ? 'long idle — creative initiative encouraged' : autonomyLevel === 'moderate' ? 'moderate idle — balanced initiative' : 'short idle — prefer context-reactive actions'})
Workers: ${availableWorkers} available / ${workerCount} total
Active Channels: ${channelStatus} (${channelSkillNote})
Last Checks: ${checkStateSummary}
${semanticHighlights ? `Memory: ${semanticHighlights}` : ''}

═══════════════════════════════════════════
RECENT CONTEXT (sorted by recency):
${recentContext.slice(0, 2000) || 'No recent activity'}

TASK QUEUE:
${taskSummary}

${worldEventsContext}

ACTIVE RECURRING SCHEDULES:
${activeSchedules}
${contactSummary ? `\nKNOWN CONTACTS:\n${contactSummary}` : ''}
${userContext ? `\nUSER PROFILE:\n${userContext.slice(0, 300)}` : ''}
${journalTail ? `\nJOURNAL (recent):\n${journalTail.slice(0, 400)}` : ''}
${learningTail ? `\nKNOWLEDGE BASE (recent):\n${learningTail.slice(0, 400)}` : ''}
═══════════════════════════════════════════

You are an autonomous agent with full capabilities. You have TWO modes of thinking:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE A — REACTIVE (respond to what happened)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Look at the context above and act on it:
1. **Unresolved requests** — Did the user ask for something that wasn't fully delivered? Finish it.
2. **Failed tasks** — Retry with a different strategy. Don't repeat the same approach.
3. **Follow-ups** — User mentioned checking something later, monitoring something, or waiting for a result? Now is the time.
4. **Stale conversations** — A contact hasn't been replied to? Compose a thoughtful response.
5. **World-event deltas** — If world events suggest a risk/opportunity relevant to the user, propose a concrete, low-noise next action.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE B — CREATIVE INITIATIVE (your own ideas)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You don't need to wait for instructions. Think independently about what would be genuinely valuable:

🌐 **Discovery & Awareness**
- Browse news, tech blogs, or sites relevant to the user's interests (infer from profile + past conversations)
- Check if services/APIs/websites the user depends on have updates, outages, or new features
- Research trending topics in the user's domain and prepare a brief
- Look up something you're curious about from past conversations — deepen your understanding

🧠 **Self-Evolution**
- Review your journal — identify patterns in what went well vs. poorly. Write a reflection.
- Audit your knowledge base — is anything outdated? Research and update it.
- Think about what skills you lack. Can you create a plugin for a repeated need?
- Analyze your failure patterns — what types of tasks do you struggle with? Research solutions.

👥 **Relationship Intelligence**
- Review contact profiles — who haven't you heard from in a while? Consider a check-in.
- Prepare context dossiers for contacts you interact with frequently.
- Think about upcoming events (birthdays, deadlines, meetings) from conversation history and prepare.

📊 **Proactive Preparation**
- If the user has recurring patterns (e.g., morning briefings, weekly reviews), prepare content for the next one.
- Draft summaries of recent activity the user might want to review.
- Pre-research topics that came up in recent conversations but weren't fully explored.
- Set up monitoring via \`heartbeat_schedule\` for things the user cares about.

💡 **Creative Value**
- Synthesize insights across different conversations into a useful overview.
- Spot connections the user might not have noticed (e.g., "Contact A mentioned X, which relates to your project Y").
- Compose an unprompted helpful message — a tip, a resource, a summary — but ONLY if it's genuinely high-value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Update heartbeat state:** After completing any proactive check (email/calendar/social/weather/news), use write_file on \`${heartbeatStatePath}\` with updated timestamps so future heartbeats skip redundant rechecks. Example JSON: {"email": ${now}, "news": ${now}}

**Priority Order:**
1. REACTIVE items from the last few hours (unfinished work, failed retries, pending follow-ups)
2. Time-sensitive world-event implications relevant to user context (only if actionable)
3. CREATIVE initiatives that are clearly high-value (real insight, real preparation, real discovery)
4. Self-improvement (journal reflection, knowledge updates, skill analysis)
5. If genuinely nothing valuable → terminate with goals_met: true

**Time-of-day hints** (${dayOfWeek} ${timeOfDay}):
${timeOfDay === 'morning' ? '- Morning: Good time for briefings, daily prep, checking overnight messages' : ''}
${timeOfDay === 'afternoon' ? '- Afternoon: Good time for research, deep work, following up on morning conversations' : ''}
${timeOfDay === 'evening' ? '- Evening: Good time for summaries, reflections, quiet research, preparing for tomorrow' : ''}
${timeOfDay === 'night' || timeOfDay === 'late night' ? '- Night: Good time for background research, knowledge consolidation, low-priority maintenance' : ''}
${isWeekend ? '- Weekend: Lighter touch — avoid unnecessary outreach unless urgent. Focus on self-improvement and preparation.' : ''}

**Autonomy level: ${autonomyLevel}**
${autonomyLevel === 'high' ? '- Long idle period. Creative initiative is STRONGLY encouraged. Don\'t just sit idle — find something genuinely useful to do.' : ''}
${autonomyLevel === 'moderate' ? '- Moderate idle. Balance reactive follow-ups with creative ideas.' : ''}
${autonomyLevel === 'low' ? '- Short idle. Prefer reacting to recent context over creative initiatives.' : ''}

🔧 **YOUR FULL TOOLSET**: All your skills are listed in the "Available Skills" section of the system prompt above. Use whichever tools best serve the task.

**HARD RULES:**
- Never be performative. Every action must create real value.
- **STATUS-ONLY MESSAGES ARE BANNED.** Do NOT send any message whose primary content is just announcing you are online, running, or available — e.g. "OrcBot online and ready", "All systems nominal", "Awaiting tasks", "Just checking in", "I'm here if you need me", or any similar content-free announcement. These offer zero value to the user and are noise. If that's all you have to say, set goals_met: true and terminate silently.
- If you message the user, have something worth reading. No "just checking in" without substance.
- ${messagingBarNote}
- Don't repeat actions that recently failed unless you have a NEW strategy.
- Keep world-event usage contextual: no generic doomscroll summaries; only tie events to user-relevant impact or planning.
- If nothing meaningful to do, terminate cleanly (goals_met: true). Silence is better than noise.
`;
    }

    private async delegateHeartbeatResearch(availableAgents: any[]) {
        // Get context to determine what action to delegate
        const recentMemories = this.memory.getRecentContext(15);
        const now = Date.now();
        const recentContext = recentMemories
            .filter(m => m.type === 'episodic' || m.type === 'short')
            .map(m => {
                const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
                const ageMs = now - ts;
                const ageMinutes = Math.floor(ageMs / 60000);
                const ageStr = ageMinutes < 60
                    ? `${ageMinutes}m ago`
                    : `${Math.floor(ageMinutes / 60)}h ago`;
                const src = m.metadata?.source ? ` [${m.metadata.source}]` : '';
                return `[${ageStr}]${src} ${m.content}`;
            })
            .join('\n');

        if (!recentContext || recentContext.length < 50) {
            logger.info(`Agent: No recent context for heartbeat action, skipping delegation`);
            return;
        }

        // Gather failed tasks for context
        const failedTasks = this.actionQueue.getQueue()
            .filter(a => a.status === 'failed')
            .slice(-3)
            .map(a => `- [FAILED] ${a.payload?.description?.slice(0, 80) || 'Unknown'}`)
            .join('\n');

        // Build dynamic skill list for the delegation prompt
        const skillNames = this.skills.listSkills()
            .map((s: any) => s.usage || s.name)
            .join(', ');

        // Use LLM to determine the best proactive action from context
        try {
            const actionPrompt = `You are an autonomous agent deciding what to do during idle time. Based on the context below, choose ONE valuable action for a worker agent to execute.

The worker has access to ALL of these tools: ${skillNames}

You can pick from TWO categories:

A) REACTIVE — Act on something from the context:
- Follow up on an unresolved user request
- Retry a failed task with a new approach
- Research something mentioned in conversation
- Check a website or service the user discussed

B) CREATIVE — Your own initiative (if nothing reactive is urgent):
- Research something useful related to the user's interests
- Browse a relevant news source or tech blog for updates
- Deepen knowledge on a topic from past conversations
- Prepare a briefing or summary the user might find valuable
- Audit and update the knowledge base

Context (newest first):
${recentContext.slice(0, 1500)}
${failedTasks ? `\nFailed tasks:\n${failedTasks}` : ''}

Respond with a single actionable task description (one sentence). Be specific about WHAT to do, not vague:`;

            const taskDescription = await this.llm.call(actionPrompt, 'Choose a valuable autonomous action for worker delegation');

            if (!taskDescription || taskDescription.length < 10 || taskDescription.length > 200) {
                logger.info(`Agent: Could not extract meaningful action from context`);
                return;
            }

            const worker = availableAgents[0];
            const task = this.orchestrator.delegateTask(
                worker.id,
                taskDescription.trim(),
                3 // Low priority
            );
            logger.info(`Agent: Delegated proactive task to worker ${worker.name}: "${taskDescription.trim().slice(0, 60)}..."`);
            this.lastHeartbeatProductive = true;
            this.consecutiveIdleHeartbeats = 0;
        } catch (e) {
            logger.warn(`Agent: Failed to delegate heartbeat action: ${e}`);
        }
    }

    private updateLastActionTime() {
        this.lastActionTime = Date.now();
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat');
        try {
            fs.writeFileSync(heartbeatPath, this.lastActionTime.toString());
        } catch (e) {
            logger.error(`Failed to save heartbeat: ${e}`);
        }
    }

    private updateLastHeartbeatTime() {
        this.lastHeartbeatAt = Date.now();
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat_autonomy');
        try {
            fs.writeFileSync(heartbeatPath, this.lastHeartbeatAt.toString());
        } catch (e) {
            logger.error(`Failed to save heartbeat autonomy time: ${e}`);
        }
    }

    private loadLastActionTime() {
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat');
        if (fs.existsSync(heartbeatPath)) {
            try {
                const data = fs.readFileSync(heartbeatPath, 'utf-8');
                this.lastActionTime = parseInt(data) || Date.now();
                logger.info(`Agent: Restored last action time: ${new Date(this.lastActionTime).toLocaleString()}`);
            } catch (e) {
                this.lastActionTime = Date.now();
            }
        } else {
            this.lastActionTime = Date.now();
        }
    }

    private loadLastHeartbeatTime() {
        const heartbeatPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'last_heartbeat_autonomy');
        if (fs.existsSync(heartbeatPath)) {
            try {
                const data = fs.readFileSync(heartbeatPath, 'utf-8');
                this.lastHeartbeatAt = parseInt(data) || Date.now();
            } catch (e) {
                this.lastHeartbeatAt = Date.now();
            }
        } else {
            this.lastHeartbeatAt = Date.now();
        }
    }

    private loadHeartbeatSchedules() {
        try {
            if (!fs.existsSync(this.heartbeatSchedulePath)) {
                fs.writeFileSync(this.heartbeatSchedulePath, '[]', 'utf8');
            }
            const raw = fs.readFileSync(this.heartbeatSchedulePath, 'utf8');
            const schedules = JSON.parse(raw || '[]');
            if (Array.isArray(schedules)) {
                schedules.forEach((s) => this.registerHeartbeatSchedule(s, false));
            }
        } catch (e) {
            logger.warn(`Failed to load heartbeat schedules: ${e}`);
        }
    }

    private persistHeartbeatSchedules() {
        try {
            const schedules = Array.from(this.heartbeatJobs.keys()).map((id) => {
                return (this.heartbeatJobMeta.get(id) || null);
            }).filter(Boolean);
            fs.writeFileSync(this.heartbeatSchedulePath, JSON.stringify(schedules, null, 2));
        } catch (e) {
            logger.warn(`Failed to persist heartbeat schedules: ${e}`);
        }
    }

    // --- One-off Scheduled Task persistence ---

    private loadScheduledTasks() {
        try {
            if (!fs.existsSync(this.scheduledTasksPath)) {
                fs.writeFileSync(this.scheduledTasksPath, '[]', 'utf8');
                return;
            }
            const raw = fs.readFileSync(this.scheduledTasksPath, 'utf8');
            const tasks = JSON.parse(raw || '[]');
            if (!Array.isArray(tasks)) return;

            const now = Date.now();
            let changed = false;

            for (const meta of tasks) {
                if (!meta?.id || !meta?.task || !meta?.scheduledFor) continue;

                // If scheduledFor is an ISO date, check if it's in the future
                const scheduledDate = new Date(meta.scheduledFor);
                if (!isNaN(scheduledDate.getTime())) {
                    if (scheduledDate.getTime() <= now) {
                        // Expired while OrcBot was offline — fire it immediately
                        logger.info(`⏰ Scheduled task [${meta.id}] was due while offline. Firing now: "${meta.task}"`);
                        this.pushTask(`Scheduled Task (delayed): ${meta.task}`, 8);
                        changed = true;
                        continue;
                    }

                    // Still in the future — re-register
                    const cron = new Cron(scheduledDate, () => {
                        logger.info(`⏰ Scheduled Task Triggered [${meta.id}]: ${meta.task}`);
                        this.pushTask(`Scheduled Task: ${meta.task}`, 8);
                        this.scheduledTasks.delete(meta.id);
                        this.scheduledTaskMeta.delete(meta.id);
                        this.persistScheduledTasks();
                    });
                    this.scheduledTasks.set(meta.id, cron);
                    this.scheduledTaskMeta.set(meta.id, meta);
                } else {
                    // Cron expression — re-register as-is (it's a repeating pattern, not a one-off date)
                    try {
                        const cron = new Cron(meta.rawInput || meta.scheduledFor, () => {
                            logger.info(`⏰ Scheduled Task Triggered [${meta.id}]: ${meta.task}`);
                            this.pushTask(`Scheduled Task: ${meta.task}`, 8);
                            this.scheduledTasks.delete(meta.id);
                            this.scheduledTaskMeta.delete(meta.id);
                            this.persistScheduledTasks();
                        });
                        this.scheduledTasks.set(meta.id, cron);
                        this.scheduledTaskMeta.set(meta.id, meta);
                    } catch (e) {
                        logger.warn(`Failed to reload scheduled task [${meta.id}]: ${e}`);
                        changed = true;
                    }
                }
            }

            if (changed) this.persistScheduledTasks();
            const count = this.scheduledTasks.size;
            if (count > 0) logger.info(`Loaded ${count} scheduled task(s) from disk.`);
        } catch (e) {
            logger.warn(`Failed to load scheduled tasks: ${e}`);
        }
    }

    private persistScheduledTasks() {
        try {
            const tasks = Array.from(this.scheduledTaskMeta.values());
            fs.writeFileSync(this.scheduledTasksPath, JSON.stringify(tasks, null, 2));
        } catch (e) {
            logger.warn(`Failed to persist scheduled tasks: ${e}`);
        }
    }

    private heartbeatJobMeta: Map<string, any> = new Map();

    private registerHeartbeatSchedule(scheduleDef: any, persist: boolean = true) {
        if (!scheduleDef?.id || !scheduleDef?.schedule || !scheduleDef?.task) return;
        const id = scheduleDef.id;
        if (this.heartbeatJobs.has(id)) return;

        let cron: Cron;
        try {
            cron = new Cron(scheduleDef.schedule, () => {
                // Guard: skip if agent is busy, another heartbeat just fired, or pending heartbeat tasks exist
                if (this.isBusy) {
                    logger.debug(`Heartbeat Schedule ${id}: Skipped - agent is busy`);
                    return;
                }
                // Avoid heartbeat collisions immediately after fresh inbound user activity.
                const postUserCooldownMs = Math.max(0, Number(this.config.get('autonomyPostUserCooldownSeconds') ?? 90)) * 1000;
                if (postUserCooldownMs > 0 && this.lastUserActivityAt > 0) {
                    const elapsedSinceUserActivity = Date.now() - this.lastUserActivityAt;
                    if (elapsedSinceUserActivity < postUserCooldownMs) {
                        logger.debug(`Heartbeat Schedule ${id}: Skipped - recent user activity ${Math.floor(elapsedSinceUserActivity / 1000)}s ago`);
                        return;
                    }
                }
                // Cooldown: don't fire if any heartbeat pushed a task in the last 60 seconds
                const heartbeatCooldownMs = 60_000;
                if (Date.now() - this.lastHeartbeatPushAt < heartbeatCooldownMs) {
                    logger.debug(`Heartbeat Schedule ${id}: Skipped - another heartbeat task pushed ${Math.floor((Date.now() - this.lastHeartbeatPushAt) / 1000)}s ago`);
                    return;
                }
                // Check for existing pending/in-progress heartbeat tasks
                const pendingHeartbeat = this.actionQueue.getQueue().find(a =>
                    (a.status === 'pending' || a.status === 'in-progress') && a.payload?.isHeartbeat
                );
                if (pendingHeartbeat) {
                    logger.debug(`Heartbeat Schedule ${id}: Skipped - heartbeat task ${pendingHeartbeat.id} already in queue`);
                    return;
                }

                logger.info(`Heartbeat Schedule Triggered: ${scheduleDef.task}`);
                this.pushTask(`Heartbeat Task: ${scheduleDef.task}`, scheduleDef.priority || 6, { isHeartbeat: true, heartbeatId: id }, 'autonomy');
                this.lastHeartbeatPushAt = Date.now();
            });
        } catch (e) {
            throw new Error(`Invalid heartbeat schedule "${scheduleDef.schedule}": ${e}`);
        }

        this.heartbeatJobs.set(id, cron);
        this.heartbeatJobMeta.set(id, scheduleDef);

        if (persist) this.persistHeartbeatSchedules();
    }

    private removeHeartbeatSchedule(id: string) {
        const cron = this.heartbeatJobs.get(id);
        if (cron) {
            cron.stop();
            this.heartbeatJobs.delete(id);
            this.heartbeatJobMeta.delete(id);
            this.persistHeartbeatSchedules();
        }
    }

    private normalizeHeartbeatSchedule(input: string): string {
        const raw = input.trim();
        const normalized = raw.toLowerCase();

        if (normalized === 'hourly' || normalized === 'every hour') return '0 * * * *';
        if (normalized === 'daily' || normalized === 'every day') return '0 9 * * *';
        if (normalized === 'weekly' || normalized === 'every week') return '0 9 * * 1';
        if (normalized === 'monthly' || normalized === 'every month') return '0 9 1 * *';
        if (normalized === 'every morning') return '0 9 * * *';
        if (normalized === 'every afternoon') return '0 14 * * *';
        if (normalized === 'every evening') return '0 18 * * *';
        if (normalized === 'every night') return '0 21 * * *';

        const everySecondMatch = raw.match(/every\s+(\d+)\s+(second|sec)s?/i);
        if (everySecondMatch) {
            const amount = parseInt(everySecondMatch[1]);
            if (amount > 0) return `*/${amount} * * * * *`;
        }

        const everyMatch = raw.match(/every\s+(\d+)\s+(minute|min|hour|hr|day)s?/i);
        if (everyMatch) {
            const amount = parseInt(everyMatch[1]);
            const unit = everyMatch[2].toLowerCase();
            if (unit.startsWith('min') || unit === 'm') return `*/${amount} * * * *`;
            if (unit.startsWith('h')) return `0 */${amount} * * *`;
            if (unit.startsWith('day') || unit === 'd') return `0 0 */${amount} * *`;
        }
        return raw; // assume cron
    }

    private detectStalledAction() {
        if (!this.isBusy || !this.currentActionStartAt || !this.currentActionId) return;
        const maxMinutes = this.config.get('maxActionRunMinutes') || 10;
        const elapsedMs = Date.now() - this.currentActionStartAt;
        if (elapsedMs <= maxMinutes * 60 * 1000) return;

        logger.error(`Agent: Action ${this.currentActionId} stalled for ${Math.floor(elapsedMs / 60000)}m. Forcing failure.`);
        this.actionQueue.updateStatus(this.currentActionId, 'failed');
        this.isBusy = false;
        this.currentActionId = null;
        this.currentActionStartAt = null;
    }

    private recoverStaleInProgressActions() {
        const maxMinutes = this.config.get('maxStaleActionMinutes') || 30;
        const threshold = Date.now() - maxMinutes * 60 * 1000;
        const queue = this.actionQueue.getQueue();

        // Recover stale in-progress actions (crash recovery)
        const staleInProgress = queue.filter(a => a.status === 'in-progress' && new Date(a.updatedAt || a.timestamp).getTime() < threshold);
        for (const action of staleInProgress) {
            logger.warn(`Agent: Found stale in-progress action ${action.id}. Marking failed.`);
            this.actionQueue.updateStatus(action.id, 'failed');
        }

        // Recover stale waiting actions — if the user never replied, don't block forever.
        // After maxStaleWaitingMinutes (default 60min), reset to pending so the agent
        // retries the task (it may decide to proceed without the answer or ask again).
        const maxWaitingMinutes = this.config.get('maxStaleWaitingMinutes') || 60;
        const waitingThreshold = Date.now() - maxWaitingMinutes * 60 * 1000;
        const staleWaiting = queue.filter(a => a.status === 'waiting' && new Date(a.updatedAt || a.timestamp).getTime() < waitingThreshold);
        for (const action of staleWaiting) {
            logger.warn(`Agent: Waiting action ${action.id} stale for >${maxWaitingMinutes}min without user reply. Resetting to pending.`);

            // Heartbeat tasks get their context rebuilt at execution time,
            // so don't append stale-waiting notes to them (it just adds noise to a prompt
            // that will be fully replaced with fresh context).
            if (action.payload?.isHeartbeat) {
                this.actionQueue.updatePayload(action.id, {
                    resumedFromStaleWaiting: true
                });
            } else {
                // Append a system note so the agent knows the user didn't reply
                const originalDesc = action.payload?.description || '';
                this.actionQueue.updatePayload(action.id, {
                    description: `${originalDesc}\n\n[SYSTEM: User did not reply to your question within ${maxWaitingMinutes} minutes. Proceed without the answer — either infer the best approach, try an alternative, or inform the user you're proceeding with a default.]`,
                    resumedFromStaleWaiting: true
                });
            }
            this.actionQueue.updateStatus(action.id, 'pending');
        }
    }

    public async resetMemory(options?: {
        memory?: boolean;       // memory.json, actions.json
        identity?: boolean;     // .AI.md, USER.md, JOURNAL.md, LEARNING.md
        plugins?: boolean;      // Custom plugins (.ts/.js in plugins dir)
        agentSkills?: boolean;  // Installed SKILL.md packages (plugins/skills/*)
        profiles?: boolean;     // Contact profiles (profiles/*.json)
        downloads?: boolean;    // Downloaded media files (downloads/*)
        bootstrap?: boolean;    // Bootstrap files (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md)
        schedules?: boolean;    // Heartbeat schedules and scheduled tasks
    }) {
        // Default: clear everything when no options provided
        const clearAll = !options;
        const opts = {
            memory: clearAll || options?.memory || false,
            identity: clearAll || options?.identity || false,
            plugins: clearAll || options?.plugins || false,
            agentSkills: clearAll || options?.agentSkills || false,
            profiles: clearAll || options?.profiles || false,
            downloads: clearAll || options?.downloads || false,
            bootstrap: clearAll || options?.bootstrap || false,
            schedules: clearAll || options?.schedules || false,
        };

        logger.info(`Agent: Resetting${clearAll ? ' ALL' : ''} — ${Object.entries(opts).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
        const dataHome = this.config.getDataHome();
        const memoryPath = this.config.get('memoryPath') || path.join(dataHome, 'memory.json');
        const actionPath = this.config.get('actionQueuePath') || path.join(dataHome, 'actions.json');
        const userPath = this.config.get('userProfilePath') || path.join(dataHome, 'USER.md');
        const journalPath = this.config.get('journalPath') || path.join(dataHome, 'JOURNAL.md');
        const learningPath = this.config.get('learningPath') || path.join(dataHome, 'LEARNING.md');

        // ── Memory & Actions ──
        if (opts.memory) {
            if (fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, JSON.stringify({}, null, 2));
            if (fs.existsSync(actionPath)) fs.writeFileSync(actionPath, JSON.stringify([], null, 2));

            // Clear vector memory (embeddings)
            const vectorMemoryPath = path.join(dataHome, 'vector_memory.json');
            if (fs.existsSync(vectorMemoryPath)) {
                fs.writeFileSync(vectorMemoryPath, JSON.stringify({ entries: [] }, null, 2));
                const bakPath = vectorMemoryPath + '.bak';
                if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
            }

            // Clear daily memory markdown logs
            const dailyMemoryDir = path.join(dataHome, 'memory');
            if (fs.existsSync(dailyMemoryDir)) {
                try {
                    const files = fs.readdirSync(dailyMemoryDir);
                    let count = 0;
                    for (const file of files) {
                        if (file.endsWith('.md')) {
                            fs.unlinkSync(path.join(dailyMemoryDir, file));
                            count++;
                        }
                    }
                    if (count > 0) logger.info(`Agent: Cleared ${count} daily memory log(s)`);
                } catch (e) {
                    logger.error(`Agent: Failed to clear daily memory logs: ${e}`);
                }
            }

            // Reset in-memory runtime state so the agent starts fresh
            this.lastHeartbeatAt = Date.now();
            this.lastActionTime = Date.now();
            this.consecutiveIdleHeartbeats = 0;
            this.lastHeartbeatProductive = true;

            logger.info('Agent: Cleared memory.json, actions.json, vector_memory.json, and daily logs');
        }

        // ── Identity Files ──
        if (opts.identity) {
            const localUserPath = path.resolve(process.cwd(), 'USER.md');
            const defaultUser = fs.existsSync(localUserPath)
                ? fs.readFileSync(localUserPath, 'utf-8')
                : '# User Profile\n\nThis file contains information about the user.\n';
            fs.writeFileSync(userPath, defaultUser);

            const localAIPath = path.resolve(process.cwd(), '.AI.md');
            const defaultAI = fs.existsSync(localAIPath)
                ? fs.readFileSync(localAIPath, 'utf-8')
                : '# .AI.md\nName: OrcBot\nPersonality: proactive, concise, professional\nAutonomyLevel: high\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n';
            fs.writeFileSync(this.agentConfigFile, defaultAI);

            const localJournalPath = path.resolve(process.cwd(), 'JOURNAL.md');
            const defaultJournal = fs.existsSync(localJournalPath)
                ? fs.readFileSync(localJournalPath, 'utf-8')
                : '# Agent Journal\nThis file contains self-reflections and activity logs.\n';
            fs.writeFileSync(journalPath, defaultJournal);

            const localLearningPath = path.resolve(process.cwd(), 'LEARNING.md');
            const defaultLearning = fs.existsSync(localLearningPath)
                ? fs.readFileSync(localLearningPath, 'utf-8')
                : '# Agent Learning Base\nThis file contains structured knowledge on various topics.\n';
            fs.writeFileSync(learningPath, defaultLearning);
            logger.info('Agent: Reset identity files (USER.md, .AI.md, JOURNAL.md, LEARNING.md)');
        }

        // ── Custom Plugins ──
        if (opts.plugins) {
            const removed = this.skills.clearPlugins();
            logger.info(`Agent: Removed ${removed} custom plugin(s)`);
        }

        // ── Agent Skills (SKILL.md packages) ──
        if (opts.agentSkills) {
            const removed = this.skills.clearAgentSkills();
            logger.info(`Agent: Removed ${removed} agent skill(s)`);
        }

        // ── Contact Profiles ──
        if (opts.profiles) {
            const profilesDir = path.join(dataHome, 'profiles');
            if (fs.existsSync(profilesDir)) {
                const files = fs.readdirSync(profilesDir);
                let count = 0;
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        try {
                            fs.unlinkSync(path.join(profilesDir, file));
                            count++;
                        } catch (e) {
                            logger.error(`Agent: Failed to remove profile ${file}: ${e}`);
                        }
                    }
                }
                logger.info(`Agent: Cleared ${count} contact profile(s)`);
            }
        }

        // ── Downloads ──
        if (opts.downloads) {
            const downloadsDir = path.join(dataHome, 'downloads');
            if (fs.existsSync(downloadsDir)) {
                try {
                    const files = fs.readdirSync(downloadsDir);
                    for (const file of files) {
                        fs.unlinkSync(path.join(downloadsDir, file));
                    }
                    logger.info(`Agent: Cleared ${files.length} downloaded file(s)`);
                } catch (e) {
                    logger.error(`Agent: Failed to clear downloads: ${e}`);
                }
            }
        }

        // ── Bootstrap Files ──
        if (opts.bootstrap) {
            if (this.bootstrap) {
                this.bootstrap.resetToDefaults();
                logger.info('Agent: Reset bootstrap files (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md) to defaults');
            }
        }

        // ── Schedules & Heartbeats ──
        if (opts.schedules) {
            const heartbeatDir = path.dirname(actionPath);
            const lastHeartbeatPath = path.join(heartbeatDir, 'last_heartbeat');
            const lastHeartbeatAutonomyPath = path.join(heartbeatDir, 'last_heartbeat_autonomy');
            const heartbeatSchedulesPath = path.join(heartbeatDir, 'heartbeat-schedules.json');

            if (fs.existsSync(lastHeartbeatPath)) {
                fs.unlinkSync(lastHeartbeatPath);
            }
            if (fs.existsSync(lastHeartbeatAutonomyPath)) {
                fs.unlinkSync(lastHeartbeatAutonomyPath);
            }
            if (fs.existsSync(heartbeatSchedulesPath)) {
                fs.writeFileSync(heartbeatSchedulesPath, '[]', 'utf8');
            }

            // Clear heartbeat check-cadence state
            const heartbeatStatePath = path.join(heartbeatDir, 'heartbeat-state.json');
            if (fs.existsSync(heartbeatStatePath)) {
                fs.unlinkSync(heartbeatStatePath);
            }

            // Stop and clear all running heartbeat jobs
            for (const [id, cron] of this.heartbeatJobs.entries()) {
                cron.stop();
                logger.info(`Agent: Stopped heartbeat job: ${id}`);
            }
            this.heartbeatJobs.clear();
            this.heartbeatJobMeta.clear();

            // Stop and clear all one-off scheduled tasks
            for (const [id, cron] of this.scheduledTasks.entries()) {
                cron.stop();
                logger.info(`Agent: Stopped scheduled task: ${id}`);
            }
            this.scheduledTasks.clear();
            this.scheduledTaskMeta.clear();
            if (fs.existsSync(this.scheduledTasksPath)) {
                fs.writeFileSync(this.scheduledTasksPath, '[]', 'utf8');
            }

            // Reset heartbeat tracking variables
            this.lastHeartbeatAt = Date.now();
            this.lastActionTime = Date.now();
            this.consecutiveIdleHeartbeats = 0;
            this.lastHeartbeatProductive = true;
            logger.info('Agent: Cleared all schedules and heartbeat data');
        }

        // ── Reload managers ──
        if (opts.memory || opts.identity) {
            this.memory = new MemoryManager(memoryPath, userPath);
            this.memory.initVectorMemory({
                openaiApiKey: this.config.get('openaiApiKey'),
                googleApiKey: this.config.get('googleApiKey'),
                preferredProvider: this.config.get('llmProvider'),
                maxEntries: this.config.get('vectorMemoryMaxEntries'),
            });
            this.actionQueue = new ActionQueue(actionPath, {
                completedTTL: this.config.get('actionQueueCompletedTTL'),
                failedTTL: this.config.get('actionQueueFailedTTL'),
                flushInterval: this.config.get('actionQueueFlushIntervalMs'),
                maintenanceInterval: this.config.get('actionQueueMaintenanceIntervalMs'),
            });
            this.decisionEngine = new DecisionEngine(
                this.memory,
                this.llm,
                this.skills,
                journalPath,
                learningPath,
                this.config,
                this.bootstrap
            );
            this.decisionEngine.setKnowledgeStore(this.knowledgeStore);
        }

        // Reload plugins if we cleared them (so core skills still work)
        if (opts.plugins || opts.agentSkills) {
            this.skills.loadPlugins();
            this.skills.discoverAgentSkills();
        }

        logger.info('Agent: Reset complete.');
    }

    /**
     * Run a single decision cycle (used by worker processes)
     * Processes the next action in the queue and returns the result
     */
    public async runOnce(): Promise<string | null> {
        const action = this.actionQueue.getNext();
        if (!action) {
            return null;
        }

        this.isBusy = true;
        this.currentActionId = action.id;
        this.currentActionStartAt = Date.now();

        try {
            this.actionQueue.updateStatus(action.id, 'in-progress');

            // Run simulation and decision loop for this single action
            const simulationContext = this.buildSimulationContext(action.payload, { maxChars: 7000 });
            const sessionContinuityHint = this.buildSessionContinuityHint(action.payload);
            const executionPlan = await this.simulationEngine.simulate(
                action.payload.description,
                simulationContext,
                this.skills.getSkillsPrompt()
            );
            const robustReasoningMode = this.isRobustReasoningEnabled();

            const MAX_STEPS = 20; // Reduced from 30 to fail faster on stuck tasks
            let currentStep = 0;
            let result = '';
            let noToolSteps = 0; // Track steps without tool execution
            const MAX_NO_TOOL_STEPS = 3; // Fail if 3 consecutive steps produce no tools

            while (currentStep < MAX_STEPS) {
                currentStep++;
                logger.info(`runOnce: Step ${currentStep}/${MAX_STEPS} for action ${action.id}`);

                if (this.cancelledActions.has(action.id)) {
                    logger.warn(`runOnce: Action ${action.id} cancelled by user`);
                    result = 'Task cancelled by user';
                    this.actionQueue.updateStatus(action.id, 'failed');
                    this.cancelledActions.delete(action.id);
                    return result;
                }

                const decision = await this.decisionEngine.decide({
                    ...action,
                    payload: {
                        ...action.payload,
                        currentStep,
                        executionPlan,
                        robustReasoningMode,
                        sessionContinuityHint
                    }
                });

                // Check for termination via verification.goals_met
                if (decision.verification?.goals_met) {
                    logger.info(`runOnce: goals_met=true at step ${currentStep}`);
                    result = decision.content || 'Task completed';

                    // Still execute any tools before terminating
                    if (decision.tools && decision.tools.length > 0) {
                        for (const tool of decision.tools) {
                            logger.info(`runOnce: Final tool execution: ${tool.name}`);
                            await this.skills.executeSkill(tool.name, tool.metadata || {});
                        }
                    }
                    break;
                }

                if (decision.tools && decision.tools.length > 0) {
                    noToolSteps = 0; // Reset counter
                    for (const tool of decision.tools) {
                        logger.info(`runOnce: Executing tool: ${tool.name}`);
                        await this.skills.executeSkill(tool.name, tool.metadata || {});
                    }
                } else {
                    noToolSteps++;
                    logger.warn(`runOnce: Step ${currentStep} produced no tools (${noToolSteps}/${MAX_NO_TOOL_STEPS})`);

                    if (noToolSteps >= MAX_NO_TOOL_STEPS) {
                        logger.error(`runOnce: Aborting - ${MAX_NO_TOOL_STEPS} consecutive steps with no tools`);
                        result = 'Task aborted: Agent stuck without producing tools. May need clearer instructions.';
                        this.actionQueue.updateStatus(action.id, 'failed');
                        return result;
                    }
                }
            }

            if (currentStep >= MAX_STEPS) {
                logger.warn(`runOnce: Reached max steps (${MAX_STEPS}) for action ${action.id}`);
                result = `Task incomplete: Reached maximum steps (${MAX_STEPS})`;
            }

            this.actionQueue.updateStatus(action.id, 'completed');

            this.memory.saveMemory({
                id: `${action.id}-complete`,
                type: 'episodic',
                content: `Completed Task: "${action.payload.description}" - Result: ${result.slice(0, 200)}`,
                metadata: { actionId: action.id }
            });

            return result;
        } catch (err: any) {
            logger.error(`Agent runOnce error: ${err.message}`);
            this.actionQueue.updateStatus(action.id, 'failed');
            return `Error: ${err.message}`;
        } finally {
            this.isBusy = false;
            this.currentActionId = null;
            this.currentActionStartAt = null;
        }
    }

    /**
     * Run a single decision cycle for a specific lane.
     * This is the parallel-safe variant of runOnce(), used by the dual-lane worker pool.
     * Each call is independent — the user lane and autonomy lane never block each other.
     */
    public async runOnceLane(lane: 'user' | 'autonomy'): Promise<string | null> {
        if (this.busyLanes.has(lane)) return null;

        const action = this.actionQueue.getNext(lane);
        if (!action) return null;

        this.busyLanes.add(lane);
        this.currentActionIds.set(lane, action.id);

        // Also update the legacy isBusy/currentActionId fields for compatibility
        // with existing code that reads them (TUI, cancel logic, etc.)
        if (lane === 'user') {
            this.isBusy = true;
            this.currentActionId = action.id;
            this.currentActionStartAt = Date.now();
        }

        try {
            this.actionQueue.updateStatus(action.id, 'in-progress');

            const simulationContext = this.buildSimulationContext(action.payload, { maxChars: 7000 });
            const sessionContinuityHint = this.buildSessionContinuityHint(action.payload);
            const executionPlan = await this.simulationEngine.simulate(
                action.payload.description,
                simulationContext,
                this.skills.getSkillsPrompt()
            );
            const robustReasoningMode = this.isRobustReasoningEnabled();

            const MAX_STEPS = 20;
            let currentStep = 0;
            let result = '';
            let noToolSteps = 0;
            const MAX_NO_TOOL_STEPS = 3;

            while (currentStep < MAX_STEPS) {
                currentStep++;
                logger.info(`runOnceLane[${lane}]: Step ${currentStep}/${MAX_STEPS} for action ${action.id}`);

                if (this.cancelledActions.has(action.id)) {
                    logger.warn(`runOnceLane[${lane}]: Action ${action.id} cancelled`);
                    result = 'Task cancelled by user';
                    this.actionQueue.updateStatus(action.id, 'failed');
                    this.cancelledActions.delete(action.id);
                    return result;
                }

                const decision = await this.decisionEngine.decide({
                    ...action,
                    payload: {
                        ...action.payload,
                        currentStep,
                        executionPlan,
                        robustReasoningMode,
                        sessionContinuityHint
                    }
                });

                if (decision.verification?.goals_met) {
                    result = decision.content || 'Task completed';
                    if (decision.tools && decision.tools.length > 0) {
                        for (const tool of decision.tools) {
                            await this.skills.executeSkill(tool.name, tool.metadata || {});
                        }
                    }
                    break;
                }

                if (!decision.tools || decision.tools.length === 0) {
                    noToolSteps++;
                    if (noToolSteps >= MAX_NO_TOOL_STEPS) {
                        result = decision.content || 'No tools executed';
                        break;
                    }
                } else {
                    noToolSteps = 0;
                    for (const tool of decision.tools) {
                        await this.skills.executeSkill(tool.name, tool.metadata || {});
                    }
                }

                result = decision.content || result;
            }

            this.actionQueue.updateStatus(action.id, 'completed');
            return result;
        } catch (err: any) {
            logger.error(`Agent runOnceLane[${lane}] error: ${err.message}`);
            this.actionQueue.updateStatus(action.id, 'failed');
            return `Error: ${err.message}`;
        } finally {
            this.busyLanes.delete(lane);
            this.currentActionIds.set(lane, null);
            if (lane === 'user') {
                this.isBusy = false;
                this.currentActionId = null;
                this.currentActionStartAt = null;
            }
        }
    }

    /**
     * Start the dual-lane parallel worker pool.
     *
     * Runs two independent polling loops:
     * - User lane: picks up messages from Telegram, WhatsApp, Discord, Slack — low latency, high priority
     * - Autonomy lane: picks up heartbeats, scheduled tasks, proactive work — runs whenever idle
     *
     * Both workers share the same Agent instance (memory, LLM, skills) but never block each other.
     * The polling interval is short (500ms) to minimise response latency.
     *
     * @param pollIntervalMs  How often each lane checks for new work. Default: 500ms
     * @param autonomyDelayMs Extra idle delay added to the autonomy loop to yield CPU to user lane. Default: 1000ms
     */
    public startWorkerPool(pollIntervalMs: number = 500, autonomyDelayMs: number = 1000): void {
        logger.info('Agent: Starting dual-lane parallel worker pool...');

        // User lane — reacts quickly to incoming channel messages
        const runUserLane = async () => {
            while (true) {
                try {
                    await this.runOnceLane('user');
                } catch (e) {
                    logger.error(`Worker pool [user]: uncaught error: ${e}`);
                }
                await new Promise(r => setTimeout(r, pollIntervalMs));
            }
        };

        // Autonomy lane — background work that should never block user responses
        const runAutonomyLane = async () => {
            while (true) {
                try {
                    const allowDuringUserWork = this.config.get('workerPoolAllowAutonomyDuringUserWork') === true;
                    // Default behavior keeps autonomy lane yielding while user lane is busy to preserve responsiveness and quota.
                    // When enabled, autonomy can continue in parallel so a slow user-lane task doesn't stall background work.
                    if (allowDuringUserWork || !this.busyLanes.has('user')) {
                        await this.runOnceLane('autonomy');
                    }
                } catch (e) {
                    logger.error(`Worker pool [autonomy]: uncaught error: ${e}`);
                }
                await new Promise(r => setTimeout(r, pollIntervalMs + autonomyDelayMs));
            }
        };

        // Fire-and-forget — both loops run concurrently as independent async tasks
        runUserLane();
        runAutonomyLane();

        logger.info(`Agent: Worker pool started (poll=${pollIntervalMs}ms, autonomyDelay=${autonomyDelayMs}ms)`);
    }

    public async start() {
        this.acquireInstanceLock();
        logger.info('Agent is starting...');
        this.scheduler.start();
        this.pollingManager.start();
        void this.usagePing.sendStartupPing();

        const startupTasks: Array<{ name: string; promise: Promise<void> }> = [];
        if (this.telegram) {
            startupTasks.push({ name: 'telegram', promise: this.telegram.start() });
        }
        if (this.whatsapp) {
            startupTasks.push({ name: 'whatsapp', promise: this.whatsapp.start() });
        }
        if (this.discord) {
            startupTasks.push({ name: 'discord', promise: this.discord.start() });
        }
        if (this.slack) {
            startupTasks.push({ name: 'slack', promise: this.slack.start() });
        }
        if (this.email) {
            startupTasks.push({ name: 'email', promise: this.email.start() });
        }

        const results = await Promise.allSettled(startupTasks.map(t => t.promise));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const name = startupTasks[index]?.name || 'unknown';
                logger.error(`Agent: Failed to start ${name} channel: ${result.reason?.message || result.reason}`);
            }
        });
        await this.runPluginHealthCheck('startup');
        logger.info('Agent: All channels initialized');

        // Start the dual-lane parallel worker pool (unless we are a dedicated single-task worker)
        if (!this.isWorker) {
            this.startWorkerPool();
        }
    }

    public async stop() {
        this.scheduler.stop();
        this.pollingManager.stop();
        if (this.telegram) {
            await this.telegram.stop();
        }
        if (this.whatsapp) {
            await this.whatsapp.stop();
        }
        if (this.discord) {
            await this.discord.stop();
        }
        if (this.slack) {
            await this.slack.stop();
        }
        if (this.email) {
            await this.email.stop();
        }
        await this.browser.close();
        if (this.knowledgeStore) {
            this.knowledgeStore.shutdown();
        }
        this.releaseInstanceLock();
        logger.info('Agent stopped.');
    }

    private getInstanceLockPath(): string {
        const actionQueuePath = this.config.get('actionQueuePath') || path.join(os.homedir(), '.orcbot', 'actions.json');
        return path.join(path.dirname(actionQueuePath), 'orcbot.lock');
    }

    private acquireInstanceLock() {
        if (process.env.ORCBOT_WORKER === 'true') return;
        if (this.instanceLockAcquired) return;

        const lockPath = this.getInstanceLockPath();
        this.instanceLockPath = lockPath;

        try {
            if (fs.existsSync(lockPath)) {
                const raw = fs.readFileSync(lockPath, 'utf8');
                const data = JSON.parse(raw || '{}');
                const pid = Number(data.pid);

                if (pid && pid !== process.pid) {
                    try {
                        process.kill(pid, 0);
                        throw new Error(`Another OrcBot instance is already running (PID: ${pid}). Stop it first.`);
                    } catch (e: any) {
                        if (e?.code !== 'ESRCH') {
                            throw e;
                        }
                        // Stale lock; remove
                        fs.unlinkSync(lockPath);
                    }
                }
            }

            const payload = {
                pid: process.pid,
                startedAt: new Date().toISOString(),
                host: os.hostname(),
                cwd: process.cwd()
            };
            fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2));
            this.instanceLockAcquired = true;

            const cleanup = () => {
                this.actionQueue.shutdown();
                if (this.memory.vectorMemory) {
                    this.memory.vectorMemory.shutdown();
                }
                if (this.knowledgeStore) {
                    this.knowledgeStore.shutdown();
                }
                this.saveKnownUsers(); // Flush known users to disk on shutdown
                this.releaseInstanceLock();
            };
            process.once('exit', cleanup);
            process.once('SIGINT', cleanup);
            process.once('SIGTERM', cleanup);
        } catch (e) {
            logger.error(`Instance lock error: ${e}`);
            throw e;
        }
    }

    private releaseInstanceLock() {
        if (!this.instanceLockPath || !this.instanceLockAcquired) return;
        try {
            if (fs.existsSync(this.instanceLockPath)) {
                fs.unlinkSync(this.instanceLockPath);
            }
        } catch (e) {
            logger.warn(`Failed to remove instance lock: ${e}`);
        }
        this.instanceLockAcquired = false;
    }

    /**
     * Load known users from persistent storage.
     */
    private loadKnownUsers(): void {
        try {
            if (fs.existsSync(this.knownUsersPath)) {
                const data = JSON.parse(fs.readFileSync(this.knownUsersPath, 'utf-8'));
                if (Array.isArray(data)) {
                    for (const user of data) {
                        if (user.id && user.channel) {
                            this.knownUsers.set(`${user.channel}:${user.id}`, user);
                        }
                    }
                    logger.info(`Agent: Loaded ${this.knownUsers.size} known user(s) from disk.`);
                }
            }
        } catch (e) {
            logger.warn(`Agent: Failed to load known users: ${e}`);
        }
    }

    /**
     * Save known users to disk (only writes if dirty).
     */
    private saveKnownUsers(): void {
        if (!this.knownUsersDirty) return;
        try {
            const data = Array.from(this.knownUsers.values());
            fs.writeFileSync(this.knownUsersPath, JSON.stringify(data, null, 2));
            this.knownUsersDirty = false;
        } catch (e) {
            logger.warn(`Agent: Failed to save known users: ${e}`);
        }
    }

    /**
     * Track a user who interacted via a channel.
     * Called from pushTask when metadata has source/user info.
     */
    private trackKnownUser(metadata: any): void {
        const source = metadata?.source;
        if (!source || !['telegram', 'discord', 'whatsapp', 'slack', 'email'].includes(source)) return;

        let userId: string | undefined;
        let name: string = metadata.senderName || 'Unknown';
        let username: string | undefined;

        if (source === 'telegram') {
            userId = metadata.userId;
        } else if (source === 'discord') {
            userId = metadata.userId;
            username = metadata.username;
        } else if (source === 'whatsapp') {
            userId = metadata.sourceId; // JID
        } else if (source === 'slack') {
            userId = metadata.userId || metadata.sourceId;
            username = metadata.username;
        } else if (source === 'email') {
            userId = metadata.sourceId || metadata.from || metadata.email;
            username = metadata.fromName;
        }

        if (!userId) return;

        const key = `${source}:${userId}`;
        const existing = this.knownUsers.get(key);

        if (existing) {
            existing.lastSeen = new Date().toISOString();
            existing.messageCount++;
            if (name && name !== 'Unknown') existing.name = name;
            if (username) existing.username = username;
        } else {
            this.knownUsers.set(key, {
                id: userId,
                name,
                channel: source as 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'email',
                username,
                lastSeen: new Date().toISOString(),
                messageCount: 1
            });
        }
        this.knownUsersDirty = true;

        // Persist on every new user, or periodically for updates
        if (!existing || this.knownUsers.size % 5 === 0) {
            this.saveKnownUsers();
        }
    }

    private getOnboardingProfileKey(metadata: any): string | null {
        const source = String(metadata?.source || '').toLowerCase();
        if (!source) return null;

        let identifier = '';
        if (source === 'telegram') {
            identifier = String(metadata?.userId || metadata?.sourceId || metadata?.chatId || '').trim();
        } else if (source === 'discord' || source === 'slack') {
            identifier = String(metadata?.userId || metadata?.sourceId || '').trim();
        } else if (source === 'email') {
            identifier = String(metadata?.sourceId || metadata?.from || '').trim().toLowerCase();
        } else if (source === 'whatsapp') {
            identifier = String(metadata?.sourceId || '').trim();
        } else if (source === 'gateway-chat') {
            identifier = String(metadata?.sourceId || metadata?.chatId || '').trim();
        } else {
            identifier = String(metadata?.sourceId || '').trim();
        }

        if (!identifier) return null;
        return `${source}:${identifier}`;
    }

    private buildOnboardingQuestionnaireMessage(agentName: string): string {
        return `👋 Welcome to ${agentName}!\n\nQuick setup so I can personalize how I work for you:\n\n1) Detail level: short / medium / deep\n2) Progress updates: frequent / normal / minimal\n3) Tone: casual / balanced / formal\n4) Initiative: ask-first / balanced / autonomous\n5) How you want me to behave (saved to SOUL.md):\n   soul: <your preferred agent style/boundaries>\n6) About you (saved to USER.md):\n   user: <who you are, your goals, your working style>\n\nReply in one message, e.g.\n"prefs: detail=deep, updates=normal, tone=casual, initiative=balanced\nsoul: be direct, challenge weak assumptions, avoid fluff\nuser: I run product + engineering, prefer concise decisions with tradeoffs"\n\nYou can update these anytime.`;
    }

    private hasOnboardingQuestionnaireBeenSent(profileKey: string): boolean {
        try {
            const profileRaw = this.memory.getContactProfile(profileKey);
            if (!profileRaw) return false;
            const parsed = JSON.parse(profileRaw);
            return !!parsed?.onboardingQuestionnaireSentAt;
        } catch {
            return false;
        }
    }

    private parseOnboardingQuestionnaireResponse(text: string): {
        detail?: string;
        updates?: string;
        tone?: string;
        initiative?: string;
        soul?: string;
        user?: string;
        onboardingOnly: boolean;
    } | null {
        const raw = String(text || '').trim();
        if (!raw) return null;

        const normalized = raw.toLowerCase();
        const extractValue = (key: string): string | undefined => {
            const m = raw.match(new RegExp(`${key}\\s*=\\s*([^,\\n]+)`, 'i'));
            return m?.[1]?.trim();
        };
        const extractLineValue = (key: string): string | undefined => {
            const m = raw.match(new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*([^\\n]+)`, 'i'));
            return m?.[1]?.trim();
        };

        const detail = extractValue('detail');
        const updates = extractValue('updates');
        const tone = extractValue('tone');
        const initiative = extractValue('initiative');
        const soul = extractLineValue('soul');
        const user = extractLineValue('user');

        const hasPrefs = !!(detail || updates || tone || initiative);
        const hasProfileText = !!(soul || user);
        if (!hasPrefs && !hasProfileText) return null;

        const onboardingOnly =
            normalized.startsWith('prefs:') ||
            normalized.startsWith('soul:') ||
            normalized.startsWith('user:');

        return {
            detail,
            updates,
            tone,
            initiative,
            soul,
            user,
            onboardingOnly
        };
    }

    private appendSectionToMarkdownFile(filePath: string, heading: string, content: string): void {
        const safeContent = String(content || '').trim();
        if (!safeContent) return;

        const timestamp = new Date().toISOString();
        const section = `\n\n## ${heading}\n- Updated: ${timestamp}\n- Notes: ${safeContent}\n`;
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        fs.writeFileSync(filePath, `${existing}${section}`.trimStart());
    }

    private applyOnboardingToBootstrapFiles(profileKey: string, parsed: {
        detail?: string;
        updates?: string;
        tone?: string;
        initiative?: string;
        soul?: string;
        user?: string;
    }): void {
        const preferenceBits = [
            parsed.detail ? `detail=${parsed.detail}` : '',
            parsed.updates ? `updates=${parsed.updates}` : '',
            parsed.tone ? `tone=${parsed.tone}` : '',
            parsed.initiative ? `initiative=${parsed.initiative}` : ''
        ].filter(Boolean).join(', ');

        if (parsed.soul || preferenceBits) {
            const soulPath = path.join(this.config.getDataHome(), 'SOUL.md');
            const soulNote = [
                parsed.soul ? `Style request: ${parsed.soul}` : '',
                preferenceBits ? `Preference signals: ${preferenceBits}` : '',
                `Source profile: ${profileKey}`
            ].filter(Boolean).join(' | ');
            this.appendSectionToMarkdownFile(soulPath, 'User Persona Preference', soulNote);
            if (this.bootstrap) {
                const latest = fs.readFileSync(soulPath, 'utf-8');
                this.bootstrap.updateFile('SOUL.md', latest);
            }
        }

        if (parsed.user || preferenceBits) {
            const userPath = this.config.get('userProfilePath') || path.join(this.config.getDataHome(), 'USER.md');
            const userNote = [
                parsed.user ? `User description: ${parsed.user}` : '',
                preferenceBits ? `Communication preferences: ${preferenceBits}` : '',
                `Source profile: ${profileKey}`
            ].filter(Boolean).join(' | ');
            this.appendSectionToMarkdownFile(userPath, 'Onboarding Profile', userNote);
            this.memory.refreshUserContext(userPath);
            if (this.bootstrap) {
                const latest = fs.readFileSync(userPath, 'utf-8');
                this.bootstrap.updateFile('USER.md', latest);
            }
        }
    }

    private async sendOnboardingCaptureAcknowledgement(metadata: any): Promise<void> {
        const source = String(metadata?.source || '').toLowerCase();
        const sourceId = String(metadata?.sourceId || '').trim();
        const msg = '✅ Saved your onboarding preferences. I will use these for response style, persona behavior, and user context going forward.';

        try {
            if (source === 'telegram' && this.telegram && sourceId) {
                await this.telegram.sendMessage(sourceId, msg);
            } else if (source === 'whatsapp' && this.whatsapp && sourceId) {
                await this.whatsapp.sendMessage(sourceId, msg);
            } else if (source === 'discord' && this.discord && sourceId) {
                await this.discord.sendMessage(sourceId, msg);
            } else if (source === 'slack' && this.slack && sourceId) {
                await this.slack.sendMessage(sourceId, msg);
            } else if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: msg,
                    timestamp: new Date().toISOString(),
                    messageId: `onboarding-ack-${Date.now()}`
                });
            }
        } catch (e) {
            logger.debug(`Agent: Failed to send onboarding acknowledgement: ${e}`);
        }
    }

    private async maybeCaptureOnboardingQuestionnaireResponse(description: string, metadata: any): Promise<{ captured: boolean; onboardingOnly: boolean }> {
        const profileKey = this.getOnboardingProfileKey(metadata);
        if (!profileKey) return { captured: false, onboardingOnly: false };

        const profileRaw = this.memory.getContactProfile(profileKey);
        if (!profileRaw) return { captured: false, onboardingOnly: false };

        let profile: any = {};
        try {
            profile = JSON.parse(profileRaw);
        } catch {
            return { captured: false, onboardingOnly: false };
        }

        if (!profile?.onboardingQuestionnaireSentAt || profile?.onboardingQuestionnaireAnsweredAt) {
            return { captured: false, onboardingOnly: false };
        }

        const parsed = this.parseOnboardingQuestionnaireResponse(description);
        if (!parsed) return { captured: false, onboardingOnly: false };

        profile.preferences = {
            ...(profile.preferences || {}),
            ...(parsed.detail ? { detail: parsed.detail } : {}),
            ...(parsed.updates ? { updates: parsed.updates } : {}),
            ...(parsed.tone ? { tone: parsed.tone } : {}),
            ...(parsed.initiative ? { initiative: parsed.initiative } : {})
        };
        if (parsed.soul) profile.soulPreference = parsed.soul;
        if (parsed.user) profile.userDescription = parsed.user;
        profile.onboardingQuestionnaireAnsweredAt = new Date().toISOString();

        this.memory.saveContactProfile(profileKey, JSON.stringify(profile));
        this.applyOnboardingToBootstrapFiles(profileKey, parsed);
        await this.sendOnboardingCaptureAcknowledgement(metadata);

        this.memory.saveMemory({
            id: `onboarding-captured-${profileKey}-${Date.now()}`,
            type: 'short',
            content: `[SYSTEM: Captured onboarding preferences for ${profileKey}. Applied to SOUL.md/USER.md where provided.]`,
            metadata: { source: metadata?.source, onboarding: true, profileKey, captured: true }
        });

        return { captured: true, onboardingOnly: parsed.onboardingOnly };
    }

    private markOnboardingQuestionnaireSent(profileKey: string, metadata: any): void {
        try {
            const existingRaw = this.memory.getContactProfile(profileKey);
            let profile: any = {};
            if (existingRaw) {
                try {
                    profile = JSON.parse(existingRaw);
                } catch {
                    profile = { notes: String(existingRaw) };
                }
            }

            profile.channel = metadata?.source || profile.channel;
            profile.senderName = metadata?.senderName || profile.senderName;
            profile.onboardingQuestionnaireSentAt = new Date().toISOString();
            profile.preferences = profile.preferences || {
                detail: 'unknown',
                updates: 'unknown',
                tone: 'unknown',
                initiative: 'unknown'
            };

            this.memory.saveContactProfile(profileKey, JSON.stringify(profile));
        } catch (e) {
            logger.debug(`Agent: Failed to mark onboarding questionnaire sent for ${profileKey}: ${e}`);
        }
    }

    private async sendOnboardingQuestionnaireIfNeeded(metadata: any): Promise<void> {
        if (this.config.get('onboardingQuestionnaireEnabled') === false) return;
        const source = String(metadata?.source || '').toLowerCase();
        if (!source) return;

        const profileKey = this.getOnboardingProfileKey(metadata);
        if (!profileKey) return;
        // Only send onboarding questionnaire to admin users (prevent spamming regular contacts)
        try {
            // For WhatsApp, only send onboarding if user is owner
            if (source === 'whatsapp' && !metadata?.isOwner) return;
            if (!this.isUserAdmin(metadata)) return;
        } catch (e) {
            // Be conservative: if admin check fails, don't send
            return;
        }

        if (this.hasOnboardingQuestionnaireBeenSent(profileKey)) return;

        const agentName = String(this.config.get('agentName') || 'OrcBot');
        const msg = this.buildOnboardingQuestionnaireMessage(agentName);

        try {
            if (source === 'telegram' && this.telegram && metadata?.sourceId) {
                await this.telegram.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'whatsapp' && this.whatsapp && metadata?.sourceId) {
                await this.whatsapp.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'discord' && this.discord && metadata?.sourceId) {
                await this.discord.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'slack' && this.slack && metadata?.sourceId) {
                await this.slack.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: msg,
                    timestamp: new Date().toISOString(),
                    messageId: `onboarding-${Date.now()}`
                });
            } else {
                return;
            }

            this.markOnboardingQuestionnaireSent(profileKey, metadata);
            this.memory.saveMemory({
                id: `onboarding-sent-${profileKey}-${Date.now()}`,
                type: 'short',
                content: `[SYSTEM: Sent onboarding questionnaire to ${profileKey}. Awaiting user preferences for response detail/update cadence/tone/initiative.]`,
                metadata: { source: source, onboarding: true, profileKey }
            });
            logger.info(`Agent: Onboarding questionnaire sent to ${profileKey}`);
        } catch (e) {
            logger.debug(`Agent: Failed to send onboarding questionnaire for ${profileKey}: ${e}`);
        }
    }

    // ---------------------------------------------------------------------------
    // Reconnect Briefing — wake-up context for returning users after absence
    // ---------------------------------------------------------------------------

    private hasReconnectBriefingSentThisReturn(profileKey: string, lastSeenBefore: Date): boolean {
        try {
            const profileRaw = this.memory.getContactProfile(profileKey);
            if (!profileRaw) return false;
            const parsed = JSON.parse(profileRaw);
            const sentAt = parsed?.reconnectBriefingSentAt;
            if (!sentAt) return false;
            // If we already sent a briefing AFTER the user's last-seen date, don't resend.
            return new Date(sentAt) > lastSeenBefore;
        } catch {
            return false;
        }
    }

    private markReconnectBriefingSent(profileKey: string): void {
        try {
            const profileRaw = this.memory.getContactProfile(profileKey);
            const profile = profileRaw ? JSON.parse(profileRaw) : {};
            profile.reconnectBriefingSentAt = new Date().toISOString();
            this.memory.saveContactProfile(profileKey, JSON.stringify(profile));
        } catch (e) {
            logger.debug(`Agent: Failed to mark reconnect briefing sent for ${profileKey}: ${e}`);
        }
    }

    private buildReconnectBriefingMessage(opts: {
        agentName: string;
        daysSince: number;
        hoursSince: number;
        recentCompletions: string[];
        pendingTasks: string[];
    }): string {
        const { agentName, daysSince, hoursSince, recentCompletions, pendingTasks } = opts;

        // Format elapsed time naturally
        let elapsed: string;
        if (daysSince >= 1) {
            elapsed = daysSince === 1 ? '1 day' : `${daysSince} days`;
        } else {
            elapsed = hoursSince <= 1 ? 'a while' : `${hoursSince} hours`;
        }

        const lines: string[] = [];
        lines.push(`👋 Welcome back. It's been ${elapsed} since we last talked.`);
        lines.push('');
        lines.push('Updates since you were away:');

        if (recentCompletions.length > 0) {
            recentCompletions.forEach(c => lines.push(`• ✅ ${c}`));
        } else {
            lines.push('• No autonomous tasks ran while you were out.');
        }

        if (pendingTasks.length > 0) {
            lines.push('');
            lines.push('Pending / incomplete:');
            pendingTasks.forEach(t => lines.push(`• ⏳ ${t}`));
        }

        lines.push('');
        lines.push(`${agentName} is online. What are we working on? ⚡`);

        return lines.join('\n');
    }

    private async maybeReconnectBriefing(metadata: any): Promise<void> {
        if (this.config.get('reconnectBriefingEnabled') === false) return;
        const source = String(metadata?.source || '').toLowerCase();
        if (!source) return;

        const profileKey = this.getOnboardingProfileKey(metadata);
        if (!profileKey) return;

        // Only trigger for known users (onboarding must have completed)
        if (!this.hasOnboardingQuestionnaireBeenSent(profileKey)) return;

        // Get last seen from known users registry
        const userId = String(metadata?.userId || metadata?.sourceId || '').trim();
        if (!userId) return;
        const knownUserKey = `${source}:${userId}`;
        const knownUser = this.knownUsers.get(knownUserKey);
        if (!knownUser?.lastSeen) return;

        const lastSeenDate = new Date(knownUser.lastSeen);
        const now = new Date();
        const msAway = now.getTime() - lastSeenDate.getTime();
        const daysSince = Math.floor(msAway / (1000 * 60 * 60 * 24));
        const hoursSince = Math.floor(msAway / (1000 * 60 * 60));

        const thresholdDays = Number(this.config.get('reconnectBriefingThresholdDays') ?? 3);
        if (daysSince < thresholdDays) return;

        // Deduplicate — don't resend if we already briefed for this return
        if (this.hasReconnectBriefingSentThisReturn(profileKey, lastSeenDate)) return;

        // Build content — scan completed/failed tasks since lastSeen
        const queue = this.actionQueue.getQueue();
        const recentCompletions: string[] = [];
        const pendingTasks: string[] = [];

        for (const a of queue) {
            const ts = new Date(a.updatedAt || a.timestamp || 0).getTime();
            if (ts < lastSeenDate.getTime()) continue; // before the absence
            const desc = String(a.payload?.description || a.payload?.task || '').slice(0, 80);
            if (!desc) continue;
            if (a.status === 'completed') {
                recentCompletions.push(desc);
            } else if (a.status === 'pending' || a.status === 'in-progress' || a.status === 'failed') {
                pendingTasks.push(desc);
            }
        }

        const agentName = String(this.config.get('agentName') || 'OrcBot');
        const maxCompletions = Number(this.config.get('reconnectBriefingMaxCompletions') ?? 5);
        const maxPending = Number(this.config.get('reconnectBriefingMaxPending') ?? 3);
        const msg = this.buildReconnectBriefingMessage({
            agentName,
            daysSince,
            hoursSince,
            recentCompletions: recentCompletions.slice(0, maxCompletions),
            pendingTasks: pendingTasks.slice(0, maxPending)
        });

        try {
            if (source === 'telegram' && this.telegram && metadata?.sourceId) {
                await this.telegram.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'whatsapp' && this.whatsapp && metadata?.sourceId) {
                await this.whatsapp.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'discord' && this.discord && metadata?.sourceId) {
                await this.discord.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'slack' && this.slack && metadata?.sourceId) {
                await this.slack.sendMessage(String(metadata.sourceId), msg);
            } else if (source === 'gateway-chat') {
                eventBus.emit('gateway:chat:response', {
                    type: 'chat:message',
                    role: 'assistant',
                    content: msg,
                    timestamp: new Date().toISOString(),
                    messageId: `reconnect-${Date.now()}`
                });
            } else {
                return;
            }

            this.markReconnectBriefingSent(profileKey);
            this.memory.saveMemory({
                id: `reconnect-brief-${profileKey}-${Date.now()}`,
                type: 'short',
                content: `[SYSTEM: Sent reconnect briefing to ${profileKey} after ${daysSince}d away. ${recentCompletions.length} completions, ${pendingTasks.length} pending items surfaced.]`,
                metadata: { source, reconnectBriefing: true, profileKey, daysSince }
            });
            logger.info(`Agent: Reconnect briefing sent to ${profileKey} (${daysSince}d absence)`);
        } catch (e) {
            logger.debug(`Agent: Failed to send reconnect briefing to ${profileKey}: ${e}`);
        }
    }

    /**
     * Get all known users, optionally filtered by channel.
     */
    public getKnownUsers(channel?: 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'email'): KnownUser[] {
        const users = Array.from(this.knownUsers.values());
        if (channel) return users.filter(u => u.channel === channel);
        return users.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    }

    /**
     * Determine if the user who triggered an action has admin-level permissions.
     * When adminUsers is not configured (undefined), everyone is admin (backwards compatible).
     * CLI/Gateway tasks and WhatsApp owner messages are always admin.
     */
    public isUserAdmin(payload: any): boolean {
        const adminUsers = this.config.get('adminUsers') as any;
        // If no adminUsers configured at all, everyone is treated as admin (single-user / backwards compatible)
        if (!adminUsers) return true;

        const source = payload?.source;
        // CLI/Gateway/autonomy tasks (no channel source) are always admin
        if (!source) return true;
        // WhatsApp owner is always admin
        if (source === 'whatsapp' && payload?.isOwner) return true;

        if (source === 'telegram') {
            const list: string[] = adminUsers.telegram || [];
            // If the telegram admin list is empty, all telegram users are admin
            if (list.length === 0) return true;
            return list.includes(String(payload.userId)) || list.includes(String(payload.sourceId));
        }
        if (source === 'discord') {
            const list: string[] = adminUsers.discord || [];
            if (list.length === 0) return true;
            return list.includes(String(payload.userId));
        }
        if (source === 'whatsapp') {
            const list: string[] = adminUsers.whatsapp || [];
            if (list.length === 0) return true;
            return list.includes(String(payload.sourceId));
        }
        if (source === 'slack') {
            const list: string[] = adminUsers.slack || [];
            if (list.length === 0) return true;
            return list.includes(String(payload.userId)) || list.includes(String(payload.sourceId));
        }
        if (source === 'email') {
            const list: string[] = adminUsers.email || [];
            if (list.length === 0) return true;
            const identity = String(payload.sourceId || payload.from || '').trim().toLowerCase();
            return list.map((x: string) => String(x).trim().toLowerCase()).includes(identity);
        }
        return true; // Unknown source = admin
    }

    public async pushTask(description: string, priority: number = 5, metadata: any = {}, lane: 'user' | 'autonomy' = 'user') {
        if (lane === 'user' && metadata?.source && !metadata?.sessionScopeId) {
            metadata.sessionScopeId = this.resolveSessionScopeId(metadata.source, {
                sourceId: metadata.sourceId,
                userId: metadata.userId,
                chatId: metadata.chatId
            });
        }

        const threadScopeKey = metadata?.sessionScopeId || (metadata?.source && metadata?.sourceId
            ? `${metadata.source}:${metadata.sourceId}`
            : null);
        const normalizedDescription = (description || '').trim().replace(/\s+/g, ' ').toLowerCase();

        // Channel-side duplicates are not always guaranteed to carry a stable messageId.
        // Add a short rolling fingerprint guard to prevent enqueuing the same request twice.
        if (lane === 'user' && metadata?.source && threadScopeKey && normalizedDescription.length > 0) {
            const fingerprint = `${threadScopeKey}:${normalizedDescription}`;
            const now = Date.now();
            const previous = this.recentTaskFingerprints.get(fingerprint);
            if (previous && now - previous < this.recentTaskDedupWindowMs) {
                logger.info(`Agent: Suppressing near-duplicate inbound task within ${this.recentTaskDedupWindowMs}ms window (${threadScopeKey})`);
                return;
            }

            // Cleanup stale entries while we're already touching this map.
            for (const [key, ts] of this.recentTaskFingerprints.entries()) {
                if (now - ts > this.recentTaskDedupWindowMs) {
                    this.recentTaskFingerprints.delete(key);
                }
            }
            this.recentTaskFingerprints.set(fingerprint, now);

            // Defensive check against currently active queue entries with semantically identical payload.
            const existingSimilarActiveTask = this.actionQueue.getQueue().find(a => {
                if (!['pending', 'waiting', 'in-progress'].includes(a.status)) return false;
                const existingThreadScope = a.payload?.sessionScopeId ||
                    ((a.payload?.source && a.payload?.sourceId) ? `${a.payload.source}:${a.payload.sourceId}` : null);
                if (existingThreadScope !== threadScopeKey) return false;
                const candidate = (a.payload?.description || '').trim().replace(/\s+/g, ' ').toLowerCase();
                return candidate.length > 0 && candidate === normalizedDescription;
            });
            if (existingSimilarActiveTask) {
                logger.info(`Agent: Suppressing duplicate task; similar active action already exists (${existingSimilarActiveTask.id})`);
                return;
            }
        }

        // Deduplication: If this message was already processed, skip
        const messageId = metadata.messageId;
        if (messageId) {
            const dedupKey = `${metadata.source || 'unknown'}:${messageId}`;
            if (this.processedMessages.has(dedupKey)) {
                logger.debug(`Agent: Skipping duplicate message ${dedupKey}`);
                return;
            }

            // Also check if there's already a pending/waiting/in-progress task for this message
            const existingTask = this.actionQueue.getQueue().find(a =>
                (a.status === 'pending' || a.status === 'waiting' || a.status === 'in-progress') &&
                a.payload?.messageId === messageId
            );
            if (existingTask) {
                logger.debug(`Agent: Task already exists for message ${messageId} (action ${existingTask.id})`);
                return;
            }

            // Mark as processed
            this.processedMessages.add(dedupKey);

            // Prevent unbounded growth — evict oldest 100 entries via iterator (O(1) per delete, no full copy)
            if (this.processedMessages.size > this.processedMessagesMaxSize) {
                let evicted = 0;
                for (const entry of this.processedMessages) {
                    this.processedMessages.delete(entry);
                    if (++evicted >= 100) break;
                }
            }
        }

        // Track this user in the known users registry — must happen before early returns
        // (dedup and waiting-action resume both return before the end of pushTask)
        this.trackKnownUser(metadata);

        // Only trigger onboarding for admin/owner users in new chats, based on agent prompt/context
        if (lane === 'user' && metadata?.source && !metadata?.isHeartbeat) {
            // If this is a new chat and user is admin/owner, let agent decide onboarding
            const isAdmin = this.isUserAdmin(metadata);
            const isOwner = metadata?.isOwner === true;
            const isNewChat = !this.hasOnboardingQuestionnaireBeenSent(this.getOnboardingProfileKey(metadata));
            if ((isAdmin || isOwner) && isNewChat) {
                await this.sendOnboardingQuestionnaireIfNeeded(metadata);
            }
            await this.maybeReconnectBriefing(metadata);
            const onboardingCapture = await this.maybeCaptureOnboardingQuestionnaireResponse(description, metadata);
            if (onboardingCapture.captured && onboardingCapture.onboardingOnly) {
                logger.info('Agent: Onboarding-only response captured; skipping task enqueue.');
                return;
            }
        }

        // Emit user:activity event so AgenticUser suppresses interventions while user is present
        // Only for real user messages (not scheduler, heartbeat, or autonomy tasks)
        if (lane === 'user' && metadata?.source && metadata?.sourceId && !metadata?.isHeartbeat) {
            this.lastUserActivityAt = Date.now();
            eventBus.emit('user:activity', {
                source: metadata.source,
                sourceId: metadata.sourceId,
                sessionScopeId: metadata.sessionScopeId
            });
        }

        // If we have an action paused waiting for a reply from this same source/thread,
        // resume it instead of pushing a brand-new action.
        // We do NOT require platform reply/quote usage; users often respond normally.
        if (metadata?.source && metadata?.sourceId) {
            const waitingAction = this.actionQueue.getQueue()
                .filter(a => {
                    if (a.status !== 'waiting') return false;
                    const currentScope = metadata.sessionScopeId || `${metadata.source}:${metadata.sourceId}`;
                    const queuedScope = a.payload?.sessionScopeId ||
                        ((a.payload?.source && a.payload?.sourceId) ? `${a.payload.source}:${a.payload.sourceId}` : null);
                    return queuedScope === currentScope;
                })
                .sort((a, b) => {
                    const at = Date.parse(a.updatedAt || a.timestamp || '') || 0;
                    const bt = Date.parse(b.updatedAt || b.timestamp || '') || 0;
                    return bt - at;
                })[0];

            if (waitingAction) {
                logger.info(`Agent: Resuming waiting action ${waitingAction.id} due to new inbound message${messageId ? ` ${messageId}` : ''}`);

                const continuationPacket = this.buildContinuationPacket(waitingAction.id);

                // --- Step history contamination fix ---
                // The old action accumulated step memories (e.g. {id}-step-1-web_search, etc.)
                // that will pollute the DecisionEngine's context when the action resumes.
                // Clean them up and save an episodic summary so the old work isn't lost but
                // doesn't dominate the LLM's next decision.
                const oldStepCount = this.memory.getActionStepCount(waitingAction.id);
                if (oldStepCount > 0) {
                    const originalDesc = waitingAction.payload?.description || '(unknown task)';
                    this.memory.saveMemory({
                        id: `${waitingAction.id}-paused-summary`,
                        type: 'episodic',
                        content: `Previous task "${originalDesc.slice(0, 120)}" was paused after ${oldStepCount} steps while waiting for user reply. User has now sent a new message.`,
                        timestamp: new Date().toISOString(),
                        metadata: {
                            actionId: waitingAction.id,
                            source: metadata.source,
                            sourceId: metadata.sourceId,
                            previousStepCount: oldStepCount
                        }
                    });
                    this.memory.cleanupActionMemories(waitingAction.id);
                    logger.info(`Agent: Cleaned up ${oldStepCount} old step memories for resumed action ${waitingAction.id}`);
                }

                // Resume strategy:
                // - If the new user message is short (likely an answer to a clarification),
                //   merge it with the previous task context so the model doesn't lose thread.
                // - If it's a full new request, use it as the primary description.
                const previousDescription = (waitingAction.payload?.description || '').toString().trim();
                const newUserMessage = (description || '').toString().trim();
                const wordCount = newUserMessage.split(/\s+/).filter(Boolean).length;
                const mode = this.getGuidanceMode();
                const configuredWordLimit = Number(this.config.get('guidanceShortReplyMaxWords') ?? 7);
                const configuredCharLimit = Number(this.config.get('guidanceShortReplyMaxChars') ?? 48);
                const shortReplyWordLimit = mode === 'fluid'
                    ? Math.max(configuredWordLimit, 12)
                    : configuredWordLimit;
                const shortReplyCharLimit = mode === 'fluid'
                    ? Math.max(configuredCharLimit, 80)
                    : configuredCharLimit;

                const clarificationKeywordsRaw = this.config.get('guidanceClarificationKeywords');
                const clarificationKeywords = Array.isArray(clarificationKeywordsRaw) && clarificationKeywordsRaw.length > 0
                    ? clarificationKeywordsRaw.map((k: any) => String(k).toLowerCase().trim()).filter(Boolean)
                    : ['clarif', 'question', 'which', 'what', 'prefer', 'preference', 'confirm', 'api', 'details'];

                const previousDescriptionLower = previousDescription.toLowerCase();
                const previousLooksLikeClarificationFlow = clarificationKeywords.some((k: string) => previousDescriptionLower.includes(k));
                const isShortFollowUpAnswer = wordCount > 0 && (wordCount <= shortReplyWordLimit || newUserMessage.length < shortReplyCharLimit);

                const packetLines: string[] = [];
                if (continuationPacket.artifactPaths.length > 0) {
                    packetLines.push(`Known artifact/workspace paths:\n- ${continuationPacket.artifactPaths.join('\n- ')}`);
                }
                if (continuationPacket.successHighlights.length > 0) {
                    packetLines.push(`Recent successful progress:\n- ${continuationPacket.successHighlights.join('\n- ')}`);
                }
                if (continuationPacket.repeatFailureHints.length > 0) {
                    packetLines.push(`Avoid repeating these failed patterns:\n- ${continuationPacket.repeatFailureHints.join('\n- ')}`);
                }

                const continuationContext = packetLines.join('\n\n');

                const resumedDescription = (isShortFollowUpAnswer && previousDescription && previousLooksLikeClarificationFlow)
                    ? `RESUMED CLARIFICATION CONTEXT:\nPrevious task context: ${previousDescription}\n\nUser's latest answer: ${newUserMessage}${continuationContext ? `\n\nCONTINUITY PACKET:\n${continuationContext}` : ''}\n\nUse this answer to continue and progress the original task. Do NOT ask for the same information again unless absolutely required for execution. Reuse existing artifact paths/workspace when available.`
                    : newUserMessage;

                this.actionQueue.updatePayload(waitingAction.id, {
                    description: resumedDescription,
                    previousDescription: previousDescription || undefined,
                    lastUserMessageId: messageId || undefined,
                    lastUserMessageText: newUserMessage,
                    resumedWithMergedContext: isShortFollowUpAnswer && previousLooksLikeClarificationFlow,
                    continuityPacket: continuationContext || undefined,
                    continuityArtifactPaths: continuationPacket.artifactPaths,
                    resumedFromWaitingAt: new Date().toISOString()
                });
                this.actionQueue.updateStatus(waitingAction.id, 'pending');

                this.memory.saveMemory({
                    id: `${waitingAction.id}-resume-${messageId || Date.now()}`,
                    type: 'short',
                    content: isShortFollowUpAnswer && previousLooksLikeClarificationFlow
                        ? `[SYSTEM: User provided a likely clarification answer: "${newUserMessage.slice(0, 200)}". Continue the prior task with this answer and avoid asking the same clarification again.${continuationContext ? ` Reuse continuity packet context (artifact paths/progress/failure hints).` : ''}]`
                        : `[SYSTEM: User sent a new message. This is now your PRIMARY task: "${newUserMessage.slice(0, 200)}". Focus on this new request. Any prior steps from the previous task have been cleared.]`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        actionId: waitingAction.id,
                        resumedFrom: 'waiting',
                        resumedWithMergedContext: isShortFollowUpAnswer && previousLooksLikeClarificationFlow,
                        source: metadata.source,
                        sourceId: metadata.sourceId,
                        messageId: messageId || undefined
                    }
                });
                return;
            }
        }

        // Tag the action with admin status based on the requesting user
        const isAdmin = this.isUserAdmin(metadata);

        const action: Action = {
            id: Math.random().toString(36).substring(7),
            type: 'TASK',
            payload: { description, ...metadata, isAdmin },
            priority,
            lane,
            status: 'pending',
            timestamp: new Date().toISOString(),
        };
        if (!isAdmin) {
            logger.info(`Agent: Non-admin user ${metadata.senderName || metadata.userId || metadata.sourceId || 'unknown'} (${metadata.source}) — elevated skills restricted.`);
        }
        this.actionQueue.push(action);
    }

    public cancelAction(actionId: string, reason: string = 'Cancelled by user'): { success: boolean; message: string } {
        const action = this.actionQueue.getQueue().find(a => a.id === actionId);
        if (!action) {
            return { success: false, message: `Action ${actionId} not found.` };
        }

        if (this.currentActionId === actionId && this.isBusy) {
            this.cancelledActions.add(actionId);
            return { success: true, message: `Action ${actionId} cancellation requested. It will stop shortly.` };
        }

        this.actionQueue.updateStatus(actionId, 'failed');
        return { success: true, message: `Action ${actionId} cancelled. Reason: ${reason}` };
    }

    public clearActionQueue(reason: string = 'Cleared by user'): { success: boolean; cleared: number } {
        const queue = this.actionQueue.getQueue();
        let cleared = 0;

        for (const action of queue) {
            if (action.status === 'pending' || action.status === 'waiting' || action.status === 'in-progress') {
                if (this.currentActionId === action.id && this.isBusy) {
                    this.cancelledActions.add(action.id);
                }
                this.actionQueue.updateStatus(action.id, 'failed');
                cleared++;
            }
        }

        logger.info(`Agent: Cleared ${cleared} action(s). Reason: ${reason}`);
        return { success: true, cleared };
    }

    public cancelDelegatedTask(taskId: string, reason: string = 'Cancelled by user'): { success: boolean; message: string } {
        const success = this.orchestrator.cancelTask(taskId, reason);
        return {
            success,
            message: success ? `Delegated task ${taskId} cancelled.` : `Failed to cancel delegated task ${taskId}.`
        };
    }

    public terminateAgentInstance(agentId: string): { success: boolean; message: string } {
        const success = this.orchestrator.terminateAgent(agentId);
        return {
            success,
            message: success
                ? `Agent ${agentId} terminated successfully.`
                : `Failed to terminate agent ${agentId}. It may not exist or is the primary agent.`
        };
    }

    /**
     * Starts a persistent typing indicator that re-fires every 4 seconds for the
     * duration of the entire action, keeping the indicator alive across LLM calls,
     * web searches, file ops, and any other long-running work.
     * Only fires for real channel-sourced actions (not heartbeats / autonomous tasks).
     */
    private startPersistentTypingIndicator(action: any): void {
        if (this.persistentTypingTimer) return; // already running
        const source = action.payload?.source;
        const to = action.payload?.sourceId;
        if (!source || !to || action.payload?.isHeartbeat) return;
        // Only fire for real inbound-message channels
        const channelSources = ['telegram', 'whatsapp', 'discord', 'slack', 'email', 'gateway-chat'];
        if (!channelSources.includes(source)) return;

        const fire = async () => {
            try {
                if (source === 'telegram' && this.telegram) {
                    await this.telegram.sendTypingIndicator(to);
                } else if (source === 'whatsapp' && this.whatsapp) {
                    await (this.whatsapp as any).sendPresenceComposing(to);
                } else if (source === 'discord' && this.discord) {
                    await this.discord.sendTypingIndicator(to);
                } else if (source === 'slack' && this.slack) {
                    await this.slack.sendTypingIndicator(to);
                }
                // gateway-chat has no typing concept; skip silently
            } catch {
                /* typing indicators are non-critical — swallow all errors */
            }
        };

        fire(); // immediate first fire — don't wait for the first interval tick
        this.persistentTypingTimer = setInterval(fire, 4000);
    }

    /** Stops the persistent typing indicator interval. */
    private stopPersistentTypingIndicator(): void {
        if (this.persistentTypingTimer) {
            clearInterval(this.persistentTypingTimer);
            this.persistentTypingTimer = null;
        }
    }
    private async processNextAction() {
        if (this.isBusy) return;

        const action = this.actionQueue.getNext();
        if (!action) return;

        this.isBusy = true;
        this.currentActionId = action.id;
        this.currentActionStartAt = Date.now();
        this.startPersistentTypingIndicator(action);
        try {
            this.updateLastActionTime();
            this.actionQueue.updateStatus(action.id, 'in-progress');

            // HEARTBEAT FRESHNESS: Rebuild the heartbeat prompt at execution time.
            // Heartbeat prompts embed context (recent memories, task queue, timestamps)
            // at push time, but the task may sit in queue for minutes or hours.
            // By the time it executes, that frozen context is stale.
            if (action.payload?.isHeartbeat) {
                const idleTimeMs = Date.now() - this.lastActionTime;
                const runningWorkers = this.orchestrator.getRunningWorkers();
                const availableAgents = this.orchestrator.getAvailableAgents('execute');
                const freshDescription = this.buildSmartHeartbeatPrompt(
                    idleTimeMs,
                    runningWorkers.length,
                    availableAgents.length
                );
                action.payload.description = freshDescription;
                logger.info(`Agent: Refreshed heartbeat ${action.id} context at execution time (was ${Math.floor((Date.now() - new Date(action.timestamp).getTime()) / 60000)}min old)`);
            }

            // Record Task Start in Episodic Memory
            const taskSummaryForMemory = action.payload?.isHeartbeat
                ? 'Proactive Heartbeat'
                : action.payload.description;
            this.memory.saveMemory({
                id: `${action.id}-start`,
                type: 'episodic',
                content: `Starting Task: "${taskSummaryForMemory}" ${action.payload.source === 'telegram' ? `(via Telegram from ${action.payload.senderName})` : ''}`,
                metadata: { actionId: action.id, source: action.payload.source }
            });

            if (action.payload?.source && !action.payload?.isHeartbeat) {
                const sessionScopeId = action.payload?.sessionScopeId || `${action.payload.source}:${action.payload.sourceId || action.payload.userId || 'unknown'}`;
                this.memory.saveMemory({
                    id: `${action.id}-objective-active`,
                    type: 'short',
                    content: `[OBJECTIVE] ACTIVE: ${String(action.payload.description || '').slice(0, 320)}`,
                    metadata: {
                        actionId: action.id,
                        source: action.payload.source,
                        sourceId: action.payload.sourceId,
                        sessionScopeId,
                        objectiveStatus: 'active',
                        objectiveId: action.id
                    }
                });
            }

            // SIMULATION LAYER (New)
            // Run a quick mental simulation to plan the steps (executed once per action start)
            const simulationContext = this.buildSimulationContext(action.payload, { maxChars: 4000 });
            const sessionContinuityHint = this.buildSessionContinuityHint(action.payload);

            // LLM-based task complexity classification — replaces brittle regex heuristics.
            // For resumed actions, classify the LATEST user message (not the original trigger).
            const isHeartbeatTask = !!action.payload.isHeartbeat;
            const classificationTarget = action.payload.lastUserMessageText
                ? `message: "${action.payload.lastUserMessageText}"`
                : (action.payload.description || '');
            let taskComplexity = isHeartbeatTask ? 'trivial' as const
                : await this.classifyTaskComplexity(classificationTarget);

            const descForComplexity = String(action.payload.description || '').toLowerCase();
            const isPreferenceMemoryTask = /(remember that|remember this|note that|store this|my favorite|i hate friday releases|preference)/i.test(descForComplexity);
            if (isPreferenceMemoryTask) {
                taskComplexity = 'trivial';
            }
            logger.info(`Agent: Task complexity="${taskComplexity}" for action ${action.id}`);

            const isSimpleTask = taskComplexity === 'trivial' || taskComplexity === 'simple' || isHeartbeatTask;
            const actionStartedAtMs = Date.now();
            let lastUserDeliveryAtMs = actionStartedAtMs;

            // PROGRESS FEEDBACK: Let user know we're working on non-trivial tasks
            // Skip for heartbeats — no user initiated this task
            // On retry attempts, say "trying again" rather than "working on it" so the
            // user knows this is a recovery pass, not a fresh start.
            if (!isSimpleTask && action.payload.source) {
                const isRetryAttempt = (action.retry?.attempts ?? 0) > 0;
                if (isRetryAttempt) {
                    const progressSent = await this.sendProgressFeedback(action, 'retry', `Trying again on your request...`);
                    if (progressSent) {
                        lastUserDeliveryAtMs = Date.now();
                    }
                } else {
                    const progressSent = await this.sendProgressFeedback(action, 'start');
                    if (progressSent) {
                        lastUserDeliveryAtMs = Date.now();
                    }
                }
            }

            const executionPlan = isSimpleTask
                ? 'Simple task: Respond directly and terminate. No multi-step planning needed.'
                : await this.simulationEngine.simulate(
                    action.payload.description,
                    simulationContext,
                    this.config.get('compactSkillsPrompt')
                        ? this.skills.getCompactSkillsPrompt()
                        : this.skills.getSkillsPrompt()
                );
            const robustReasoningMode = this.isRobustReasoningEnabled();
            const exposeChecklistPreview = this.shouldExposeChecklistPreview();

            // RESEARCH TOOLS — used for skill-repeat ceiling differentiation (browser/search
            // tools legitimately get called many times in a single action).
            const RESEARCH_TOOLS = new Set([
                'web_search', 'browser_navigate', 'browser_click', 'browser_type',
                'browser_examine_page', 'browser_screenshot', 'browser_back',
                'browser_scroll', 'browser_hover', 'browser_select',
                'browser_fill_form', 'browser_extract_data', 'browser_extract_content',
                'browser_api_intercept', 'browser_api_list',
                'computer_screenshot', 'computer_click', 'computer_vision_click',
                'computer_type', 'computer_key', 'computer_locate', 'computer_describe',
                'extract_article', 'http_fetch', 'download_file', 'read_file', 'write_to_file',
                'write_file', 'create_file', 'send_file',
                'run_command', 'analyze_media', 'recall_memory',
                'generate_image', 'send_image'
            ]);

            // Dynamic limits driven by task complexity classification
            const rawConfigMaxSteps = Number(this.config.get('maxStepsPerAction') || 25);
            const rawConfigMaxMessages = Number(this.config.get('maxMessagesPerAction') || 5);
            const configMaxSteps = Math.max(6, Number.isFinite(rawConfigMaxSteps) ? rawConfigMaxSteps : 25);
            const configMaxMessages = Math.max(3, Number.isFinite(rawConfigMaxMessages) ? rawConfigMaxMessages : 5);

            if (rawConfigMaxSteps < 6 || rawConfigMaxMessages < 3) {
                logger.warn(`Agent: Runtime limits were too low (steps=${rawConfigMaxSteps}, messages=${rawConfigMaxMessages}). Applying safety floor to prevent premature looping (steps=${configMaxSteps}, messages=${configMaxMessages}).`);
            }

            const COMPLEXITY_LIMITS: Record<string, { steps: number; messages: number }> = {
                trivial: { steps: 2, messages: 1 },
                simple: { steps: 5, messages: 2 },
                standard: { steps: configMaxSteps, messages: configMaxMessages },
                complex: { steps: configMaxSteps, messages: Math.max(configMaxMessages, 8) },
            };
            const limits = COMPLEXITY_LIMITS[taskComplexity] || COMPLEXITY_LIMITS.standard;
            const MAX_STEPS = limits.steps;
            const MAX_MESSAGES = limits.messages;
            const isResearchTask = taskComplexity === 'complex';
            const MAX_NO_TOOLS_RETRIES = 3; // Max retries when LLM returns no tools but goals_met=false
            const MAX_SKILL_REPEATS = 5; // Max times any single skill can be called in one action
            const MAX_RESEARCH_SKILL_REPEATS = 15; // Higher ceiling for research tools (web_search, browser_*, etc.)
            const MAX_CONSECUTIVE_FAILURES = 3; // Max consecutive failures of same skill before aborting
            let currentStep = 0;
            let messagesSent = 0;
            let lastMessageContent = '';
            let lastStepToolSignatures = '';
            let loopCounter = 0;
            let noToolsRetryCount = 0; // Track retries for no-tools error state
            let deepToolExecutedSinceLastMessage = true; // Start true to allow Step 1 message
            let stepsSinceLastMessage = 0;
            let lastProgressFeedbackStep = 0;
            let consecutiveNonDeepTurns = 0;
            let waitingForClarification = false; // Track if we're paused for user input
            const sentMessagesInAction: string[] = [];
            let substantiveDeliveriesSent = 0;
            let anyUserDeliverySuccess = false;
            let highDelayMetricLogged = false;
            const blockedFailedSignatures = new Set<string>();
            const blockedFailedTools = new Set<string>();
            const successfulSideEffectKeys = new Set<string>();
            const skillCallCounts: Record<string, number> = {}; // Track how many times each skill is called
            const skillFailCounts: Record<string, number> = {}; // Track consecutive failures per skill
            const recentSkillNames: string[] = []; // Track skill name sequence for pattern detection
            const recentSkillSignatures: string[] = []; // Track skill name+args for smarter pattern detection
            let goalsMet = false; // Track if the task genuinely completed (prevents premature 'completed' marking)
            let imageGeneratedInAction = false; // Track if generate_image has been called in this action
            let imageDeliveredInAction = false; // Track if the generated image has been delivered
            let generatedImagePath = ''; // Path of the most recently generated image
            this._blankPageCount = 0; // Reset blank-page counter for each new action
            this.browser._blankUrlHistory?.clear(); // Reset blank-URL domain tracker for each new action

            const nonDeepSkills = [
                'send_telegram',
                'send_whatsapp',
                'send_discord',
                'send_slack',
                'send_gateway_chat',
                'update_journal',
                // update_learning is NOT in this list — it IS productive work
                'update_user_profile',
                'update_agent_identity',
                'get_system_info',
                'system_check',
                'read_bootstrap_file', // Reading bootstrap files is not progress
                'browser_screenshot',
                'browser_trace_start',
                'browser_trace_stop',
                'request_supporting_data'
            ];

            const configuredProgressInterval = Number(this.config.get('progressFeedbackStepInterval') ?? 4);
            const progressIntervalSteps = Number.isFinite(configuredProgressInterval)
                ? Math.max(2, Math.floor(configuredProgressInterval))
                : 4;
            const forceInitialProgress = this.config.get('progressFeedbackForceInitial') !== false;

            const SIDE_EFFECT_TOOLS = new Set([
                'send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat',
                'telegram_send_buttons', 'telegram_edit_message', 'telegram_send_poll', 'telegram_react', 'telegram_pin_message',
                'send_file', 'send_image', 'send_discord_file', 'send_slack_file'
            ]);
            const buildSideEffectKey = (toolName: string, metadata: any): string => {
                const md = metadata || {};
                const name = String(toolName || '').toLowerCase();
                const target = String(
                    md.chatId || md.channel_id || md.channelId || md.jid || md.to || md.sourceId || ''
                ).trim().toLowerCase();
                const message = String(md.message || md.text || md.caption || '').trim().replace(/\s+/g, ' ').toLowerCase();
                const payload = String(md.path || md.file_path || md.filePath || md.prompt || '').trim().toLowerCase();
                return `${name}|${target}|${message.slice(0, 240)}|${payload.slice(0, 240)}`;
            };

            if (!isSimpleTask && action.payload.source && exposeChecklistPreview) {
                const checklistMessage = this.buildChecklistPreviewMessage(executionPlan);
                if (checklistMessage) {
                    const checklistSent = await this.sendChecklistPreview(action, checklistMessage);
                    if (checklistSent) {
                        messagesSent++;
                        stepsSinceLastMessage = 0;
                        lastMessageContent = checklistMessage;
                        sentMessagesInAction.push(checklistMessage);
                    }
                }
            }

            while (currentStep < MAX_STEPS) {
                currentStep++;
                stepsSinceLastMessage++;
                logger.info(`Agent: Step ${currentStep} for action ${action.id}`);

                if (this.cancelledActions.has(action.id)) {
                    logger.warn(`Agent: Action ${action.id} cancelled by user`);
                    this.actionQueue.updateStatus(action.id, 'failed');
                    this.cancelledActions.delete(action.id);
                    break;
                }

                // PERIODIC PROGRESS FEEDBACK: For long-running tasks, send the user
                // periodic "still working" feedback so they know we haven't stalled.
                // Fires once after 8 consecutive silent steps (stepsSinceLastMessage resets on send).
                if (!isSimpleTask && currentStep > 1 && stepsSinceLastMessage >= progressIntervalSteps && action.payload.source) {
                    const progressSent = await this.sendProgressFeedback(action, 'working', `Still working on your request (step ${currentStep})...`);
                    if (progressSent) {
                        lastUserDeliveryAtMs = Date.now();
                        // Progress message was just sent; reset silent-step counter and count toward message budget.
                        stepsSinceLastMessage = 0;
                        messagesSent++;
                        lastProgressFeedbackStep = currentStep;
                    }
                }

                if (messagesSent >= MAX_MESSAGES) {
                    logger.warn(`Agent: Message budget reached (${messagesSent}/${MAX_MESSAGES}) for action ${action.id}. Checking if task is truly done...`);

                    // REVIEW GATE: Don't blindly kill — ask the review layer if task is actually done
                    const budgetReviewResult = await this.reviewForcedTermination(
                        action, 'message_budget', currentStep,
                        `Message budget reached (${messagesSent}/${MAX_MESSAGES}). Agent has been sending status updates while working.`,
                        { messagesSent, anyUserDeliverySuccess, substantiveDeliveriesSent }
                    );

                    if (budgetReviewResult === 'continue') {
                        // Review layer says the task isn't done — suppress future status messages
                        // by making budget unreachable, but let the agent keep WORKING silently
                        logger.info(`Agent: Review layer says task is NOT done. Suppressing further status messages but continuing work.`);
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-message-budget-suppress`,
                            type: 'short',
                            content: `[SYSTEM: You have sent ${messagesSent} messages already. STOP sending status updates. Focus ONLY on completing the task silently. Only send ONE final message when the task is FULLY complete with all results.]`,
                            metadata: { actionId: action.id, step: currentStep }
                        });
                        // Don't break — just suppress further messages by not resetting budget
                    } else {
                        logger.warn(`Agent: Review layer confirms task is done or unrecoverable. Terminating action ${action.id}.`);
                        break;
                    }
                }


                let decision;
                try {
                    const timeSignals = this.buildActionTimeSignals(action, {
                        actionStartedAtMs,
                        currentStep,
                        messagesSent,
                        stepsSinceLastMessage,
                        lastUserDeliveryAtMs,
                        isResearchTask
                    });
                    if (!highDelayMetricLogged && timeSignals.delayRisk === 'high') {
                        highDelayMetricLogged = true;
                        this.delayRiskHighCount++;
                        this.memory.saveMemory({
                            id: `metric-delay-risk-high-${action.id}-${Date.now()}`,
                            type: 'episodic',
                            content: `[METRIC] delay_risk_high action=${action.id} source=${action.payload?.source || 'unknown'} runtimeSec=${timeSignals.actionRuntimeSec} queueAgeSec=${timeSignals.queueAgeSec} sinceLastDeliverySec=${timeSignals.sinceLastDeliverySec} runtimeTotal=${this.delayRiskHighCount}`,
                            metadata: {
                                source: 'guardrail-metric',
                                metric: 'delay_risk_high',
                                actionId: action.id,
                                channelSource: action.payload?.source || 'unknown',
                                actionRuntimeSec: timeSignals.actionRuntimeSec,
                                queueAgeSec: timeSignals.queueAgeSec,
                                sinceLastDeliverySec: timeSignals.sinceLastDeliverySec,
                                runtimeTotal: this.delayRiskHighCount
                            }
                        });
                    }
                    decision = await ErrorHandler.withRetry(async () => {
                        return await this.decisionEngine.decide({
                            ...action,
                            payload: {
                                ...action.payload,
                                messagesSent,
                                messagingLocked: messagesSent > 0,
                                currentStep,
                                stepsSinceLastMessage,
                                isResearchTask,
                                executionPlan, // Pass plan to DecisionEngine
                                robustReasoningMode,
                                sessionContinuityHint,
                                timeSignals
                            }
                        });
                    }, { maxRetries: 2 });
                } catch (e) {
                    logger.error(`DecisionEngine failed after retries: ${e}`);
                    throw new Error(`LLM Decision Failure: ${e}`);
                }

                if (decision.reasoning) {
                    logger.info(`Agent Reasoning: ${decision.reasoning}`);
                }

                const pipelineNotes = decision.metadata?.pipelineNotes;
                if (pipelineNotes && (pipelineNotes.warnings?.length || pipelineNotes.dropped?.length)) {
                    this.memory.saveMemory({
                        id: `${action.id}-step-${currentStep}-pipeline-notes`,
                        type: 'short',
                        content: `Pipeline notes: ${JSON.stringify(pipelineNotes)}`,
                        metadata: { tool: 'pipeline', ...pipelineNotes }
                    });
                }

                if (decision.verification) {
                    logger.info(`Verification: [Goals Met: ${decision.verification.goals_met}] ${decision.verification.analysis}`);
                }

                // PROACTIVE PRE-TOOL UPDATE: avoid long silent stretches before deep/slow tool execution.
                if (action.payload.source && decision.tools && decision.tools.length > 0) {
                    const hasChannelSendTool = decision.tools.some((t: any) => {
                        const name = String(t?.name || '').toLowerCase();
                        return name === 'send_telegram' || name === 'send_whatsapp' || name === 'send_discord' || name === 'send_slack' || name === 'send_gateway_chat' ||
                            name === 'telegram_send_buttons' || name === 'telegram_edit_message' || name === 'telegram_send_poll' || name === 'telegram_react' || name === 'telegram_pin_message';
                    });

                    const hasDeepTool = decision.tools.some((t: any) => !nonDeepSkills.includes(String(t?.name || '')));
                    const eligibleByCadence = currentStep - lastProgressFeedbackStep >= progressIntervalSteps;
                    const shouldForceInitial = forceInitialProgress && messagesSent === 0;
                    const shouldSendProactive = hasDeepTool && !hasChannelSendTool && (shouldForceInitial || (stepsSinceLastMessage >= progressIntervalSteps && eligibleByCadence));

                    if (shouldSendProactive) {
                        const details = shouldForceInitial
                            ? 'Started your task and working through it now...'
                            : `Still working and making progress (step ${currentStep})...`;
                        const progressSent = await this.sendProgressFeedback(action, 'working', details);
                        if (progressSent) {
                            lastUserDeliveryAtMs = Date.now();
                            messagesSent++;
                            stepsSinceLastMessage = 0;
                            lastProgressFeedbackStep = currentStep;
                        }
                    }
                }

                // IMPORTANT: Execute tools FIRST, then check goals_met
                // The agent might say "goals will be met after I send this message" but we must actually send it!
                if (decision.tools && decision.tools.length > 0) {
                    // Reset no-tools retry counter since we have valid tools
                    noToolsRetryCount = 0;

                    // 1. INTRA-STEP DEDUPLICATION (Fixes multi-call issues on commands)
                    const uniqueTools: any[] = [];
                    const seenSignatures = new Set<string>();
                    for (const t of decision.tools) {
                        const sig = `${t.name}:${JSON.stringify(t.metadata)}`;
                        if (!seenSignatures.has(sig)) {
                            uniqueTools.push(t);
                            seenSignatures.add(sig);
                        } else {
                            logger.warn(`Agent: Dropped intra-step duplicate tool: ${t.name}`);
                        }
                    }
                    decision.tools = uniqueTools;

                    // 2. PLANNING LOOP PROTECTION
                    // If all tools in this turn are non-deep (journal, learning, etc.), increment turn counter
                    const hasDeepToolThisTurn = decision.tools.some((t: any) => !nonDeepSkills.includes(t.name));
                    if (!hasDeepToolThisTurn) {
                        consecutiveNonDeepTurns++;
                        if (consecutiveNonDeepTurns >= 5) {
                            logger.warn(`Agent: Detected planning loop (5 turns without deep action). Terminating action ${action.id}.`);
                            break;
                        }
                    } else {
                        consecutiveNonDeepTurns = 0;
                    }

                    // 3. INFINITE LOGIC LOOP (Signature-based)
                    const currentStepSignatures = decision.tools.map(t => `${t.name}:${JSON.stringify(t.metadata)}`).join('|');
                    if (currentStepSignatures === lastStepToolSignatures) {
                        loopCounter++;
                        if (loopCounter >= 3) {
                            logger.warn(`Agent: Detected persistent redundant logic loop (3x). Breaking action ${action.id}.`);

                            // PROGRESS FEEDBACK: Let user know we got stuck
                            await this.sendProgressFeedback(action, 'recovering', 'Got stuck in a loop. Learning from this to improve...');
                            lastUserDeliveryAtMs = Date.now();

                            // SELF-IMPROVEMENT: Trigger selective analysis. The analyzer decides
                            // whether to create a skill or skip (strategy/parameter issue).
                            const failingTool = decision.tools[0]?.name;
                            if (failingTool) {
                                const failingContext = JSON.stringify(decision.tools[0]?.metadata || {}).slice(0, 200);
                                const taskDescription = typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload);
                                await this.triggerSkillCreationForFailure(taskDescription, failingTool, failingContext, action);
                            }

                            break;
                        } else {
                            logger.info(`Agent: Detected potential loop (${loopCounter}/3). allowing retry...`);
                        }
                    } else {
                        loopCounter = 0;
                    }
                    lastStepToolSignatures = currentStepSignatures;

                    // 4. SKILL FREQUENCY LOOP DETECTION
                    // Track how many times each skill is called across the entire action
                    for (const t of decision.tools) {
                        skillCallCounts[t.name] = (skillCallCounts[t.name] || 0) + 1;
                        recentSkillNames.push(t.name);
                        // Build a short fingerprint: name + key argument (e.g., command, url, query)
                        const meta = t.metadata || {};
                        const argHint = (meta.command || meta.url || meta.query || meta.message || meta.path || '').toString().slice(0, 80);
                        recentSkillSignatures.push(`${t.name}:${argHint}`);
                    }

                    // Research tools (web_search, browser_*, extract_article) get a higher ceiling
                    // because they legitimately need many calls with different queries for deep research.
                    const overusedSkill = Object.entries(skillCallCounts).find(([skillName, count]) => {
                        const limit = RESEARCH_TOOLS.has(skillName) ? MAX_RESEARCH_SKILL_REPEATS : MAX_SKILL_REPEATS;
                        return count >= limit;
                    });

                    if (overusedSkill) {
                        const [skillName, callCount] = overusedSkill;
                        const isResearchTool = RESEARCH_TOOLS.has(skillName);
                        const failCount = skillFailCounts[skillName] || 0;
                        const skillExists = this.skills.getAllSkills().some(s => s.name === skillName);

                        logger.warn(`Agent: Skill '${skillName}' called ${callCount} times in action ${action.id}${isResearchTool ? ' (research tool, higher limit)' : ''}.`);

                        // REVIEW GATE: Ask the review layer before killing the task
                        const reviewResult = await this.reviewForcedTermination(
                            action, 'skill_frequency', currentStep,
                            `Skill '${skillName}' called ${callCount} times. ${isResearchTool ? 'This is a research tool that has hit even the extended ceiling.' : 'Non-research tool exceeded call limit.'} Fail count: ${failCount}. Task: ${action.payload?.description?.slice(0, 200)}`
                        );

                        if (reviewResult === 'continue') {
                            // Review says task isn't done — inject pivot guidance instead of killing
                            logger.info(`Agent: Review layer says task is NOT done despite skill overuse. Injecting pivot guidance.`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-skill-pivot-guidance`,
                                type: 'short',
                                content: `[SYSTEM: You have called '${skillName}' ${callCount} times. STOP using '${skillName}' — you MUST try a completely different approach. ${isResearchTool ? 'If web_search isn\'t finding what you need, try browser_navigate to visit specific sites directly. If browser isn\'t working, try a different search query strategy or compile what you already have.' : 'Switch to a different tool or method entirely.'} Compile and deliver whatever results you have gathered so far.]`,
                                metadata: { actionId: action.id, skill: skillName, callCount, step: currentStep }
                            });
                            // Ban the overused skill for the rest of this action
                            skillCallCounts[skillName] = 0; // Reset so it can be used sparingly
                            // Don't break — let the agent continue with a different approach
                        } else {
                            // Review layer confirms we should stop
                            await this.sendProgressFeedback(action, 'recovering', `Got stuck repeating '${skillName}'. Wrapping up with what I have...`);
                            lastUserDeliveryAtMs = Date.now();

                            // Trigger selective self-improvement analysis for all tool classes.
                            // The analyzer can still choose not to create a skill.
                            if (skillName) {
                                if (skillExists && failCount > 0) {
                                    logger.info(`Agent: Skill '${skillName}' exists but keeps failing (${failCount} errors). Not creating a new skill — this is a parameter issue.`);
                                    this.memory.saveMemory({
                                        id: `${action.id}-step-${currentStep}-skill-loop-guidance`,
                                        type: 'short',
                                        content: `[SYSTEM: You called '${skillName}' ${callCount} times but it kept failing. Options:\n1. WRONG PARAMETERS — review the skill usage and retry with corrected args.\n2. SKILL BUG — if the skill itself is broken (e.g. argument shape mismatch, API quirk), use tweak_skill("${skillName}", "<description of the problem>") to auto-generate a patched replacement that will be loaded immediately.\n3. INFORM USER — if neither option is feasible, tell the user what went wrong.]`,
                                        metadata: { actionId: action.id, skill: skillName, failures: failCount }
                                    });
                                } else {
                                    await this.triggerSkillCreationForFailure(
                                        typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload),
                                        skillName,
                                        `Skill called ${callCount} times without progress`,
                                        action
                                    );
                                }
                            }
                            break;
                        }
                    }

                    // 5. PATTERN-BASED LOOP DETECTION
                    // Detect repeating patterns like [manage_config, run_command, manage_config, run_command]
                    // BUT only break if the arguments are also the same — different args = different work.
                    if (recentSkillNames.length >= 6) {
                        const last6Names = recentSkillNames.slice(-6);
                        const namePattern2 = `${last6Names[0]},${last6Names[1]}`;
                        const nameRepeating = `${last6Names[2]},${last6Names[3]}` === namePattern2 && `${last6Names[4]},${last6Names[5]}` === namePattern2;

                        if (nameRepeating) {
                            // Names repeat — but are the arguments also the same?
                            const last6Sigs = recentSkillSignatures.slice(-6);
                            const sigPattern2 = `${last6Sigs[0]}|${last6Sigs[1]}`;
                            const sigsIdentical = `${last6Sigs[2]}|${last6Sigs[3]}` === sigPattern2 && `${last6Sigs[4]}|${last6Sigs[5]}` === sigPattern2;

                            if (sigsIdentical) {
                                // Same skills with same arguments 3x = genuine loop
                                logger.warn(`Agent: Detected repeating skill+args pattern [${namePattern2}] x3 in action ${action.id}. Breaking loop.`);
                                await this.sendProgressFeedback(action, 'recovering', 'Detected repeating pattern. Trying a different approach...');
                                lastUserDeliveryAtMs = Date.now();
                                break;
                            } else {
                                // Same skill names but different arguments — not a loop, just sequential work
                                logger.debug(`Agent: Skill name pattern [${namePattern2}] repeats but args differ — allowing (sequential work, not a loop).`);
                            }
                        }
                    }

                    let forceBreak = false;
                    let sentMessageCountInThisStep = 0;
                    let firstSentMessageInThisStep = '';
                    let toolsBlockedByCooldown = 0;
                    let totalSendToolsInStep = 0;
                    let duplicateSideEffectsBlockedInStep = 0;
                    let totalSideEffectToolsInStep = 0;
                    let remainingToolsInBatch = decision.tools.length;

                    for (const toolCall of decision.tools) {
                        remainingToolsInBatch--;
                        if (SIDE_EFFECT_TOOLS.has(toolCall.name)) {
                            totalSideEffectToolsInStep++;
                            const sideEffectKey = buildSideEffectKey(toolCall.name, toolCall.metadata || {});
                            if (successfulSideEffectKeys.has(sideEffectKey)) {
                                duplicateSideEffectsBlockedInStep++;
                                logger.warn(`Agent: Blocked duplicate side-effect call '${toolCall.name}' with equivalent intent in action ${action.id}`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-sideeffect-duplicate-blocked`,
                                    type: 'short',
                                    content: `[SYSTEM: BLOCKED duplicate side-effect call for '${toolCall.name}'. Equivalent target/payload already succeeded in this action. Do NOT resend. Continue with next unfinished step or complete.]`,
                                    metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, duplicateSideEffect: true }
                                });
                                continue;
                            }
                        }

                        if (blockedFailedTools.has(toolCall.name)) {
                            logger.warn(`Agent: Blocked tool '${toolCall.name}' after repeated failures in action ${action.id}`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-tool-blocked`,
                                type: 'short',
                                content: `[SYSTEM: TOOL BLOCKED — '${toolCall.name}' already failed repeatedly in this action. Do NOT call it again unless strategy changed fundamentally. Use a different tool/workflow now.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, toolBlocked: true }
                            });
                            continue;
                        }

                        const toolSignature = this.buildToolSignatureKey(toolCall.name, toolCall.metadata || {});
                        if (blockedFailedSignatures.has(toolSignature)) {
                            logger.warn(`Agent: Blocked repeated failed signature for ${toolCall.name} in action ${action.id}`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-signature-blocked`,
                                type: 'short',
                                content: `[SYSTEM: BLOCKED REPEATED FAILURE — '${toolCall.name}' with the same parameters already failed in this action. Do NOT retry this exact call. Choose different parameters or a different approach.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, signatureBlocked: true }
                            });
                            continue;
                        }

                        // Reset cooldown if a deep tool (search, command, browser interaction) is used
                        if (!nonDeepSkills.includes(toolCall.name)) {
                            deepToolExecutedSinceLastMessage = true;
                        }

                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_discord' || toolCall.name === 'send_slack' || toolCall.name === 'send_gateway_chat' ||
                            toolCall.name === 'telegram_send_buttons' || toolCall.name === 'telegram_send_poll') {
                            const isStructuredSend = toolCall.name === 'telegram_send_buttons' || toolCall.name === 'telegram_send_poll';
                            // For structured messages (buttons/polls) include their payload in the key so that
                            // same caption text + different buttons/options is NOT treated as a duplicate.
                            const structuredSuffix = isStructuredSend
                                ? '|' + JSON.stringify(toolCall.metadata?.buttons ?? toolCall.metadata?.options ?? [])
                                : '';
                            const currentMessage = ((toolCall.metadata?.message || toolCall.metadata?.text || toolCall.metadata?.question || '').trim()) + structuredSuffix;
                            totalSendToolsInStep++;

                            // 0. HALLUCINATION / TEMPLATE PLACEHOLDER GUARD
                            // Block messages containing {{PLACEHOLDER}} or similar template syntax — these are fabricated, not real data.
                            const templatePlaceholderPattern = /\{\{[A-Z_]+\}\}|\[\[\w+\]\]|<<[A-Z_]+>>|\{%.*?%\}/;
                            if (templatePlaceholderPattern.test(currentMessage)) {
                                logger.warn(`Agent: Blocked hallucinated message in action ${action.id}. Message contains template placeholders: "${currentMessage.slice(0, 120)}..."`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-blocked-hallucination`,
                                    type: 'short',
                                    content: `[SYSTEM: BLOCKED hallucinated message. Your message contained template placeholders like {{VARIABLE}} instead of real data. You MUST use ACTUAL data from tool results. If the browser returned blank pages, switch to web_search instead of fabricating results. NEVER send messages with placeholder text to the user.]`,
                                    metadata: { actionId: action.id, step: currentStep }
                                });
                                toolsBlockedByCooldown++;
                                continue;
                            }

                            // 1. Block exact duplicates across any step in this action
                            if (sentMessagesInAction.includes(currentMessage)) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Action-wide duplicate).`);
                                toolsBlockedByCooldown++;
                                continue;
                            }

                            // 1.5 Block semantic near-duplicates (same intent/wording drift)
                            if (this.isSemanticallyDuplicateOutboundMessage(currentMessage, sentMessagesInAction)) {
                                logger.warn(`Agent: Blocked semantically duplicate message in action ${action.id}.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-blocked-semantic-duplicate`,
                                    type: 'short',
                                    content: `[SYSTEM: BLOCKED semantic duplicate message. Your outbound message is too similar to one already sent in this action. Send only NEW information or conclude the task.]`,
                                    metadata: { actionId: action.id, step: currentStep, semanticDuplicateBlocked: true }
                                });
                                toolsBlockedByCooldown++;
                                continue;
                            }

                            // 2. Communication Cooldown: Block if no new deep info since last message
                            // Exceptions: 
                            // - Step 1 is mandatory (Greeter)
                            // - If no message has been sent yet in this action (first reply must get through)
                            // - If 15+ steps have passed without an update (Status update for long tasks)
                            // - Structured interactive messages (buttons/polls) ARE the substantive delivery;
                            //   they must never be blocked by the cooldown regardless of prior text sends.
                            if (!isStructuredSend && currentStep > 1 && messagesSent > 0 && !deepToolExecutedSinceLastMessage && stepsSinceLastMessage < 15) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Communication Cooldown - No new deep data).`);
                                toolsBlockedByCooldown++;
                                continue;
                            }

                            // 3. Block double-messages in a single step
                            if (sentMessageCountInThisStep > 0) {
                                const allowSubstantiveFollowUp =
                                    sentMessageCountInThisStep === 1 &&
                                    this.isLikelyAcknowledgementMessage(firstSentMessageInThisStep) &&
                                    this.isSubstantiveFollowUpMessage(currentMessage) &&
                                    !sentMessagesInAction.includes(currentMessage);

                                if (!allowSubstantiveFollowUp) {
                                    logger.warn(`Agent: Blocked redundant message in action ${action.id} (Already sent message in this step).`);
                                    toolsBlockedByCooldown++;
                                    continue;
                                }

                                logger.info(`Agent: Allowing one substantive follow-up message after acknowledgement in step ${currentStep} for action ${action.id}.`);
                            }

                            // 3.5 Clarification loop guard: avoid asking semantically the same
                            // question again when we already resumed with user clarification context.
                            const resumedWithMergedContext = !!action.payload?.resumedWithMergedContext;
                            if (
                                resumedWithMergedContext &&
                                this.messageContainsQuestion(currentMessage) &&
                                this.isRepeatedClarificationQuestion(currentMessage, sentMessagesInAction) &&
                                !deepToolExecutedSinceLastMessage
                            ) {
                                logger.warn(`Agent: Blocked repeated clarification question in action ${action.id}.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-repeated-clarification-blocked`,
                                    type: 'short',
                                    content: `[SYSTEM: BLOCKED repeated clarification question. The user already provided clarification in this thread. Do NOT ask the same question again — proceed using the latest user answer and execute the task.]`,
                                    metadata: { actionId: action.id, step: currentStep, resumedWithMergedContext: true }
                                });
                                toolsBlockedByCooldown++;
                                continue;
                            }

                            sentMessageCountInThisStep++;
                            if (!firstSentMessageInThisStep) {
                                firstSentMessageInThisStep = currentMessage;
                            }

                            // 4. QUESTION DETECTION: If message contains a question, pause and wait for response
                            if (this.messageContainsQuestion(currentMessage)) {
                                logger.info(`Agent: Message contains question. Will pause after sending to wait for user response.`);
                                // Only pause if we actually still need the user's answer to make progress.
                                // If goals are already met, do not block the queue in a waiting state.
                                if (!decision.verification?.goals_met) {
                                    forceBreak = true;
                                }
                            }
                        }

                        // 3. SAFETY GATING (Autonomy Lane)
                        // Autonomous background tasks cannot run dangerous commands without explicit user permission.
                        // sudoMode: true bypasses this restriction (full trust)
                        const sudoMode = this.config.get('sudoMode');
                        const dangerousTools = ['run_command', 'write_to_file', 'write_file', 'create_file', 'install_npm_dependency', 'delete_file', 'manage_skills'];
                        if (!sudoMode && action.lane === 'autonomy' && dangerousTools.includes(toolCall.name)) {
                            logger.warn(`Agent: Blocked dangerous tool ${toolCall.name} in autonomy lane.`);

                            // If we have a Telegram, notify the user
                            if (this.telegram && this.config.get('telegramToken')) {
                                // Find a chatID to notify (from config or last known?)
                                // For now, we rely on the Agent self-correcting strategy or just logging.
                            }

                            const denial = `[PERMISSION DENIED] You are in AUTONOMY MODE. You cannot use '${toolCall.name}' directly. 
System Policy requires you to ASK the user for permission first.
Action: Use 'send_telegram' to explain what you want to do and ask for approval. 
(e.g., "I found a file I want to edit. Can I proceed?")`;

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-denial`,
                                type: 'short',
                                content: denial
                            });
                            // We don't execute the skill. We continue to next loop iteration, effectively "skipping" this tool but logging the denial.
                            // The agent will see this in memory next turn.
                            continue;
                        }

                        // 4. ADMIN PERMISSION GATING
                        // Non-admin users (external users not in adminUsers config) cannot use elevated skills.
                        // This is a hard block — the LLM should have been told not to attempt these,
                        // but this is defense-in-depth in case it does.
                        const isAdmin = action.payload?.isAdmin !== false;
                        if (!isAdmin && ELEVATED_SKILLS.has(toolCall.name)) {
                            logger.warn(`Agent: BLOCKED elevated skill '${toolCall.name}' for non-admin user ${action.payload?.senderName || action.payload?.userId || 'unknown'} (${action.payload?.source}).`);

                            // Send a polite denial message to the user via the appropriate channel
                            const source = action.payload?.source;
                            const sourceId = action.payload?.sourceId;
                            const denialMsg = `Sorry, you don't have permission to do that. This action requires admin privileges.`;

                            if (source === 'telegram' && this.telegram && sourceId) {
                                try { await this.telegram.sendMessage(sourceId, denialMsg); messagesSent++; } catch (e) { /* best effort */ }
                            } else if (source === 'discord' && this.discord && sourceId) {
                                try { await this.discord.sendMessage(sourceId, denialMsg); messagesSent++; } catch (e) { /* best effort */ }
                            } else if (source === 'whatsapp' && this.whatsapp && sourceId) {
                                try { await this.whatsapp.sendMessage(sourceId, denialMsg); messagesSent++; } catch (e) { /* best effort */ }
                            } else if (source === 'slack' && this.slack && sourceId) {
                                try { await this.slack.sendMessage(sourceId, denialMsg); messagesSent++; } catch (e) { /* best effort */ }
                            }

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-admin-denied`,
                                type: 'short',
                                content: `[SYSTEM: PERMISSION DENIED — '${toolCall.name}' is an elevated skill. User "${action.payload?.senderName || 'unknown'}" is NOT an admin. The user has been informed. Do NOT attempt other elevated skills. Only use messaging and search skills for this user.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, denied: true }
                            });
                            forceBreak = true; // Stop trying — non-admin users get one denial then we exit
                            break;
                        }


                        // logger.info(`Executing skill: ${toolCall.name}`); // Redundant, SkillsManager logs this
                        const channelPolicy = this.evaluateChannelToolPolicy(action, toolCall.name);
                        if (!channelPolicy.allowed) {
                            logger.warn(`Agent: Blocked channel tool '${toolCall.name}' for action ${action.id}: ${channelPolicy.reason}`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-channel-policy-blocked`,
                                type: 'short',
                                content: `[SYSTEM: CHANNEL POLICY BLOCKED '${toolCall.name}'. Reason: ${channelPolicy.reason}. Config-level channel policy takes precedence over context/heartbeat/tool suggestions. Use only tools that match the action source channel and enabled channels.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, denied: true }
                            });
                            continue;
                        }

                        // HARD BLOCK: Prevent duplicate generate_image calls within the same action.
                        // If an image was already generated (and optionally delivered), skip this call entirely.
                        if (toolCall.name === 'generate_image' && imageGeneratedInAction) {
                            logger.warn(`Agent: BLOCKED duplicate generate_image in action ${action.id}. Image already generated${imageDeliveredInAction ? ' and delivered' : ''}.`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-generate_image-blocked`,
                                type: 'short',
                                content: `[SYSTEM: generate_image BLOCKED — image was already generated in this action${generatedImagePath ? ` at ${generatedImagePath}` : ''}. ${imageDeliveredInAction ? 'Image was already delivered. Task is COMPLETE — set goals_met=true.' : `Use send_file(jid, "${generatedImagePath}") to deliver it.`}]`,
                                metadata: { actionId: action.id, step: currentStep, skill: 'generate_image', blocked: true }
                            });
                            continue; // Skip execution, move to next tool
                        }

                        const toolStartedAt = Date.now();
                        let toolResult;
                        let executionError: unknown;
                        try {
                            toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});
                            // Reset failure counter on success
                            skillFailCounts[toolCall.name] = 0;
                        } catch (e) {
                            executionError = e;
                            logger.error(`Skill execution failed: ${toolCall.name} - ${e}`);
                            toolResult = `Error executing skill ${toolCall.name}: ${e}`;

                            // Track consecutive failures per skill
                            skillFailCounts[toolCall.name] = (skillFailCounts[toolCall.name] || 0) + 1;
                            if (skillFailCounts[toolCall.name] >= MAX_CONSECUTIVE_FAILURES) {
                                logger.warn(`Agent: Skill '${toolCall.name}' failed ${MAX_CONSECUTIVE_FAILURES} consecutive times in action ${action.id}. Aborting skill.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-skill-failure-limit`,
                                    type: 'short',
                                    content: `[SYSTEM: Skill '${toolCall.name}' has thrown errors ${MAX_CONSECUTIVE_FAILURES} times in a row. Options:\n1. Use tweak_skill("${toolCall.name}", "<describe what keeps failing>") to generate a patched plugin replacement that loads immediately — this is the PREFERRED recovery for built-in skills with API/argument issues.\n2. Try a completely different approach or fallback skill.\n3. Inform the user the method is not working.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name] }
                                });
                            }

                            // PROGRESS FEEDBACK: Let user know we hit an error but are recovering.
                            // Do NOT fire for channel send skills — you can't tell the user
                            // "send_telegram failed" by calling send_telegram again.
                            const sendSkillNames = ['send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat', 'telegram_send_buttons', 'telegram_send_poll', 'send_email'];
                            if (!sendSkillNames.includes(toolCall.name)) {
                                await this.sendProgressFeedback(action, 'error', `${toolCall.name} failed`);
                                lastUserDeliveryAtMs = Date.now();
                            }
                        }

                        // CLARIFICATION HANDLING: Break sequence if agent is asking for info
                        if (toolCall.name === 'request_supporting_data') {
                            const question = toolCall.metadata?.question || toolCall.metadata?.text || 'I need more information to proceed.';

                            // Send clarification to appropriate channel
                            if (this.telegram && action.payload.source === 'telegram') {
                                await this.telegram.sendMessage(action.payload.sourceId, `❓ *Clarification Needed*: ${question}`);
                            } else if (this.whatsapp && action.payload.source === 'whatsapp') {
                                await this.whatsapp.sendMessage(action.payload.sourceId, `❓ Clarification Needed: ${question}`);
                            } else if (this.discord && action.payload.source === 'discord') {
                                await this.discord.sendMessage(action.payload.sourceId, `❓ **Clarification Needed**: ${question}`);
                            } else if (this.slack && action.payload.source === 'slack') {
                                await this.slack.sendMessage(action.payload.sourceId, `❓ *Clarification Needed*: ${question}`);
                            }

                            logger.info(`Agent: Clarification requested. Pausing action ${action.id} - waiting for user response.`);

                            // Mark action as waiting (not completed) so it won't be re-picked until user replies
                            this.actionQueue.updateStatus(action.id, 'waiting');

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-clarification`,
                                type: 'short',
                                content: `[SYSTEM: Agent requested clarification: "${question}". Action PAUSED. Waiting for user response.]`,
                                metadata: { waitingForClarification: true, actionId: action.id, question }
                            });

                            // Set a flag to skip the normal completion logic
                            waitingForClarification = true;
                            forceBreak = true;
                            break;
                        }

                        // Determine if the result indicates an error using STRUCTURED checks first,
                        // then fall back to string scanning for unstructured results.
                        const resultString = JSON.stringify(toolResult) || '';

                        // Structured check: if result is an object with explicit success/error fields, trust those
                        const hasStructuredResult = toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult);
                        let resultIndicatesError: boolean;

                        if (hasStructuredResult && 'success' in toolResult) {
                            // Plugin returned { success: true/false, ... } — trust the explicit field
                            resultIndicatesError = toolResult.success === false;
                        } else if (hasStructuredResult && 'error' in toolResult && typeof toolResult.error === 'string' && toolResult.error.length > 0) {
                            // Plugin returned { error: "some message" } without success field
                            resultIndicatesError = true;
                        } else if (typeof toolResult === 'string') {
                            // Unstructured string result — scan for error indicators
                            // But only at the START of the string (not deeply nested in response data)
                            const lower = toolResult.toLowerCase();
                            resultIndicatesError = lower.startsWith('error') ||
                                lower.startsWith('failed') ||
                                lower.includes('error executing skill');
                        } else {
                            resultIndicatesError = false;
                        }
                        // Channel send skills (telegram, whatsapp, discord, etc.) are NEVER added to
                        // blockedFailedSignatures — they can fail transiently (API errors, parse failures)
                        // and the LLM needs to retry with adjusted content/params.
                        const isChannelSendSkill = [
                            'send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat',
                            'telegram_send_buttons', 'telegram_send_poll', 'telegram_edit_message', 'send_file', 'send_image', 'send_email'
                        ].includes(toolCall.name);

                        if (!nonDeepSkills.includes(toolCall.name) && !resultIndicatesError) {
                            deepToolExecutedSinceLastMessage = true;
                            // Reset failure counter for this skill on success
                            skillFailCounts[toolCall.name] = 0;
                        } else if (resultIndicatesError) {
                            if (!isChannelSendSkill) blockedFailedSignatures.add(toolSignature);
                            // Track ALL tool failures that return error results (not just thrown exceptions)
                            skillFailCounts[toolCall.name] = (skillFailCounts[toolCall.name] || 0) + 1;

                            // Inject explicit error feedback so the LLM learns from this failure
                            const errorSnippet = resultString.slice(0, 300);
                            const paramsSummary = JSON.stringify(toolCall.metadata || {}).slice(0, 200);

                            // Detect rate-limit errors and suggest schedule_task instead of giving up
                            const rateLimitMatch = resultString.match(/(?:wait|retry.*?after|rate.*?limit).*?(\d+)\s*(second|minute|hour|min|sec|hr)s?/i);
                            const hasRetryAfter = hasStructuredResult && (toolResult.retry_after_minutes || toolResult.retry_after_seconds || toolResult.details?.retry_after_minutes || toolResult.details?.retry_after_seconds);

                            if (rateLimitMatch || hasRetryAfter) {
                                let waitMinutes: number;
                                if (hasRetryAfter) {
                                    const retryMins = toolResult.retry_after_minutes || toolResult.details?.retry_after_minutes;
                                    const retrySecs = toolResult.retry_after_seconds || toolResult.details?.retry_after_seconds;
                                    waitMinutes = retryMins ? Number(retryMins) : Math.ceil(Number(retrySecs || 60) / 60);
                                } else {
                                    const amount = parseInt(rateLimitMatch![1]);
                                    const unit = rateLimitMatch![2].toLowerCase();
                                    waitMinutes = unit.startsWith('sec') ? Math.ceil(amount / 60) : unit.startsWith('hr') || unit.startsWith('hour') ? amount * 60 : amount;
                                }
                                // Add 1 minute buffer
                                waitMinutes = Math.max(waitMinutes + 1, 2);

                                logger.info(`Agent: Rate limit detected for '${toolCall.name}'. Suggesting schedule_task for ${waitMinutes} minutes.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-rate-limit-guidance`,
                                    type: 'short',
                                    content: `[SYSTEM: TEMPORAL BLOCKER — '${toolCall.name}' hit a rate limit / cooldown (~${waitMinutes} min). DO NOT retry now. Use schedule_task({ time_or_cron: "in ${waitMinutes} minutes", task_description: "<original task>" }) to auto-retry, then inform the user what you scheduled.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, rateLimitMinutes: waitMinutes, step: currentStep }
                                });
                            } else {
                                // Build shell-aware hint for common failures
                                let hint = '';
                                const isWin = process.platform === 'win32';
                                if (toolCall.name === 'run_command') {
                                    const cmdStr = String(toolCall.metadata?.command || toolCall.metadata?.cmd || '').trim().toLowerCase();
                                    if (isWin) {
                                        if (cmdStr.startsWith('dir ') || cmdStr === 'dir') {
                                            hint = ' HINT: Use Get-ChildItem instead of dir. Commands execute in PowerShell.';
                                        } else if (cmdStr.startsWith('where ')) {
                                            hint = ' HINT: Use Get-Command instead of where. Commands execute in PowerShell.';
                                        } else if (errorSnippet.includes('not recognized') || errorSnippet.includes('not found') || errorSnippet.includes('Could not find')) {
                                            hint = ' HINT: Commands run in PowerShell. Use PowerShell cmdlets (Get-ChildItem, Get-Command, Test-Path, Start-MpScan, etc.).';
                                        } else if (errorSnippet.includes('cannot find the path') || errorSnippet.includes('does not exist')) {
                                            hint = ' HINT: Verify the path exists with Test-Path before using it.';
                                        }
                                    } else {
                                        // Linux/Mac hints
                                        if (errorSnippet.includes('command not found') || errorSnippet.includes('not found')) {
                                            hint = ' HINT: The command is not installed. Try installing it first (e.g., apt install, brew install, npm install -g, pip install), or use an alternative tool that is available. Run "which <command>" or "command -v <command>" to check if a tool exists.';
                                        } else if (errorSnippet.includes('Permission denied') || errorSnippet.includes('permission denied')) {
                                            hint = ' HINT: Permission denied. Try: (1) using a different output directory you have write access to, (2) checking file permissions with "ls -la", (3) using chmod if appropriate.';
                                        } else if (errorSnippet.includes('No such file or directory')) {
                                            hint = ' HINT: File or directory not found. Use "ls" or "find" to locate the correct path. Check for typos in the path.';
                                        } else if (errorSnippet.includes('Connection refused') || errorSnippet.includes('connection refused')) {
                                            hint = ' HINT: Connection refused. The target service may not be running. Check if it needs to be started or if the port/address is correct.';
                                        } else if (errorSnippet.includes('timed out') || errorSnippet.includes('Killed')) {
                                            hint = ' HINT: Command timed out or was killed. Try: (1) a simpler/faster command, (2) adding non-interactive flags (-y, --batch, --no-input), (3) increasing the timeout with timeoutMs parameter.';
                                        } else if (errorSnippet.includes('syntax error') || errorSnippet.includes('unexpected token')) {
                                            hint = ' HINT: Shell syntax error. Check your command for proper quoting, escaping, and shell-compatible syntax. Use get_system_info to check the shell environment.';
                                        }
                                    }
                                }
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-error-feedback`,
                                    type: 'short',
                                    content: `[SYSTEM: TOOL ERROR — '${toolCall.name}' FAILED with params ${paramsSummary}. Error: ${errorSnippet}.${hint} DO NOT call '${toolCall.name}' again with the same parameters. Fix the parameters or try a completely different approach.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name], step: currentStep }
                                });
                            }

                            if (skillFailCounts[toolCall.name] >= MAX_CONSECUTIVE_FAILURES) {
                                logger.warn(`Agent: '${toolCall.name}' returned errors ${MAX_CONSECUTIVE_FAILURES} times in action ${action.id}. Injecting hard stop notice.`);
                                blockedFailedTools.add(toolCall.name);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-failure-limit`,
                                    type: 'short',
                                    content: `[SYSTEM: CRITICAL — '${toolCall.name}' has returned errors ${MAX_CONSECUTIVE_FAILURES} times in a row. STOP calling it with the same approach. Your options:\n1. PATCH IT — call tweak_skill("${toolCall.name}", "<exact description of the error and what to fix>") to generate and load a patched replacement right now.\n2. ALTERNATIVE — use a different skill or method that achieves the same goal.\n3. INFORM USER — explain what failed and ask for guidance.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name] }
                                });
                            }
                        }

                        // Data-returning tools need more of their output visible so the LLM can
                        // recognise success/failure without looping. Message/action tools keep a
                        // tighter cap since their result is just a confirmation string.
                        const DATA_RETURNING_TOOLS = new Set([
                            'run_command', 'read_file', 'write_file', 'web_search',
                            'browser_navigate', 'browser_click', 'http_request',
                            'find_skills', 'list_files', 'search_files',
                        ]);
                        const obsLimit = DATA_RETURNING_TOOLS.has(toolCall.name) ? 1400 : 500;

                        let observation: string;
                        if (resultIndicatesError) {
                            const errorDetail = hasStructuredResult && toolResult.error
                                ? toolResult.error
                                : resultString.slice(0, obsLimit);
                            observation = `⚠️ TOOL ERROR: ${toolCall.name} FAILED — ${errorDetail}`;
                        } else if (hasStructuredResult && toolResult.success === true) {
                            observation = `✅ Tool ${toolCall.name} succeeded: ${resultString.slice(0, obsLimit)}`;
                        } else {
                            observation = `Observation: Tool ${toolCall.name} returned: ${resultString.slice(0, obsLimit)}`;
                        }
                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_gateway_chat' || toolCall.name === 'send_discord' || toolCall.name === 'send_slack' ||
                            toolCall.name === 'telegram_send_buttons' || toolCall.name === 'telegram_send_poll' || toolCall.name === 'send_email') {

                            const isStructuredSend = toolCall.name === 'telegram_send_buttons' || toolCall.name === 'telegram_send_poll';
                            const structuredSuffix = isStructuredSend
                                ? '|' + JSON.stringify(toolCall.metadata?.buttons ?? toolCall.metadata?.options ?? [])
                                : '';
                            const sentMessage = ((toolCall.metadata?.message || toolCall.metadata?.text || toolCall.metadata?.question || '').trim()).toString();
                            const currentMessage = sentMessage + structuredSuffix;

                            if (!resultIndicatesError) {
                                messagesSent++;
                                sentMessagesInAction.push(currentMessage);
                                lastMessageContent = currentMessage;
                                deepToolExecutedSinceLastMessage = false; // Reset cooldown after SUCCESSFUL sending
                                stepsSinceLastMessage = 0; // Reset status update timer

                                anyUserDeliverySuccess = true;
                                lastUserDeliveryAtMs = Date.now();

                                if (this.isSubstantiveDeliveryMessage(sentMessage)) {
                                    substantiveDeliveriesSent++;
                                }
                            }

                            // QUESTION PAUSE: If this message asked a question, pause and wait for response

                            const wasSuccessfulSend = !resultIndicatesError;
                            if (this.messageContainsQuestion(sentMessage) && wasSuccessfulSend && !decision.verification?.goals_met) {
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-waiting`,
                                    type: 'short',
                                    content: `[SYSTEM: Sent question to user. WAITING for response. Do NOT continue until user replies. Question: "${sentMessage.slice(0, 100)}..."]`,
                                    metadata: { waitingForResponse: true, actionId: action.id }
                                });
                                logger.info(`Agent: Pausing action ${action.id} - waiting for user response to question.`);

                                this.actionQueue.updateStatus(action.id, 'waiting');

                                // Actually pause - set flags to break loop and skip completion
                                waitingForClarification = true;
                                forceBreak = true;
                            } else if (this.messageContainsQuestion(sentMessage) && wasSuccessfulSend && decision.verification?.goals_met) {
                                logger.info(`Agent: Sent a question in action ${action.id}, but goals_met=true; not entering waiting state.`);
                            } else if (this.messageContainsQuestion(sentMessage) && !wasSuccessfulSend) {
                                logger.warn(`Agent: Attempted to ask a question via ${toolCall.name}, but send failed; not entering waiting state.`);
                            }
                        }

                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-${toolCall.name}`,
                            type: 'short',
                            content: observation,
                            metadata: { tool: toolCall.name, result: toolResult, input: toolCall.metadata }
                        });

                        const toolDurationMs = Date.now() - toolStartedAt;
                        const signalLevel: WorkflowSignalLevel = resultIndicatesError
                            ? 'error'
                            : toolDurationMs >= 12000
                                ? 'warn'
                                : 'info';

                        if (shouldInjectWorkflowSignal({
                            actionId: action.id,
                            step: currentStep,
                            toolName: toolCall.name,
                            level: signalLevel,
                            toolDurationMs,
                            errorMessage: executionError ? String(executionError) : resultIndicatesError ? String(toolResult) : undefined,
                            consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                            hasExistingErrorGuidance: resultIndicatesError,
                        })) {
                            const workflowSignal = buildWorkflowSignalMemory({
                                actionId: action.id,
                                step: currentStep,
                                toolName: toolCall.name,
                                level: signalLevel,
                                toolDurationMs,
                                errorMessage: executionError ? String(executionError) : resultIndicatesError ? String(toolResult) : undefined,
                                consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                                hasExistingErrorGuidance: resultIndicatesError,
                            });
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-workflow-signal`,
                                type: 'short',
                                content: workflowSignal,
                                metadata: {
                                    actionId: action.id,
                                    step: currentStep,
                                    skill: toolCall.name,
                                    signalLevel,
                                    toolDurationMs,
                                    consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                                }
                            });

                            logger.warn(buildWorkflowSignalLog({
                                actionId: action.id,
                                step: currentStep,
                                toolName: toolCall.name,
                                level: signalLevel,
                                toolDurationMs,
                                errorMessage: executionError ? String(executionError) : resultIndicatesError ? String(toolResult) : undefined,
                                consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                            }));
                        }

                        if (SIDE_EFFECT_TOOLS.has(toolCall.name) && !resultIndicatesError) {
                            const sideEffectKey = buildSideEffectKey(toolCall.name, toolCall.metadata || {});
                            successfulSideEffectKeys.add(sideEffectKey);
                            if (toolCall.name === 'send_file' || toolCall.name === 'send_image' || toolCall.name === 'send_discord_file' || toolCall.name === 'send_slack_file') {
                                anyUserDeliverySuccess = true;
                            }
                        }

                        this.saveSessionAnchorFromToolResult(action, currentStep, toolCall.name, toolCall.metadata || {}, toolResult, resultIndicatesError);

                        // BATCH EXECUTION GUARDRAIL:
                        // If a queued multi-tool sequence hits a failure, stop remaining tools now
                        // and let the next decision step re-plan with fresh error context.
                        if (resultIndicatesError && remainingToolsInBatch > 0) {
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-batch-paused`,
                                type: 'short',
                                content: `[SYSTEM: Paused tool batch after ${toolCall.name} failed. ${remainingToolsInBatch} queued tool(s) were skipped. Re-plan from this failure before continuing.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: toolCall.name, queuedToolsSkipped: remainingToolsInBatch }
                            });

                            const batchPauseSignal = buildWorkflowSignalMemory({
                                actionId: action.id,
                                step: currentStep,
                                toolName: toolCall.name,
                                level: 'warn',
                                toolDurationMs,
                                errorMessage: executionError ? String(executionError) : String(toolResult),
                                consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                                queuedToolsSkipped: remainingToolsInBatch,
                            });

                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-${toolCall.name}-batch-workflow-signal`,
                                type: 'short',
                                content: batchPauseSignal,
                                metadata: {
                                    actionId: action.id,
                                    step: currentStep,
                                    skill: toolCall.name,
                                    queuedToolsSkipped: remainingToolsInBatch,
                                    signalLevel: 'warn',
                                }
                            });

                            logger.warn(buildWorkflowSignalLog({
                                actionId: action.id,
                                step: currentStep,
                                toolName: toolCall.name,
                                level: 'warn',
                                toolDurationMs,
                                errorMessage: executionError ? String(executionError) : String(toolResult),
                                consecutiveFailures: skillFailCounts[toolCall.name] || 0,
                                queuedToolsSkipped: remainingToolsInBatch,
                            }));
                            logger.info(`Agent: Paused queued tools for action ${action.id} after '${toolCall.name}' failure (${remainingToolsInBatch} remaining).`);
                            break;
                        }

                        // HARD BREAK after scheduling to prevent loops
                        if (toolCall.name === 'schedule_task') {
                            logger.info(`Agent: Task scheduled for action ${action.id}. Terminating sequence.`);
                            goalsMet = true;
                            forceBreak = true;
                            break;
                        }

                        // DELIVERY COMPLETION: send_file is a terminal delivery action.
                        // When a file is successfully sent to the user, inject a strong completion signal
                        // so the LLM recognizes that the delivery goal has been met.
                        if (toolCall.name === 'send_file' && !resultIndicatesError) {
                            logger.info(`Agent: File successfully delivered in action ${action.id}. Injecting delivery completion signal.`);
                            const deliveryChannel = resultString.includes('Gateway Chat') ? 'Gateway Chat' : resultString.includes('Telegram') ? 'Telegram' : resultString.includes('WhatsApp') ? 'WhatsApp' : resultString.includes('Discord') ? 'Discord' : 'channel';
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-file-delivered`,
                                type: 'short',
                                content: `[SYSTEM: FILE DELIVERED SUCCESSFULLY via ${deliveryChannel}. The user has received the file. If the task was to send/deliver/resend this file, the goal is NOW COMPLETE — set goals_met=true. Do NOT re-read or re-send the same file.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: 'send_file', delivered: true }
                            });
                        }

                        // IMAGE GENERATION DEDUP: After successful generate_image, set tracking flags
                        // and inject a signal to prevent the LLM from calling it again.
                        if (toolCall.name === 'generate_image' && !resultIndicatesError) {
                            imageGeneratedInAction = true;
                            // Extract file path from result string
                            const pathMatch = resultString.match(/([A-Z]:\\[^\s(]+\.(?:png|jpg|webp))/i) || resultString.match(/(\/[^\s(]+\.(?:png|jpg|webp))/i);
                            if (pathMatch) generatedImagePath = pathMatch[1];
                            logger.info(`Agent: Image generated in action ${action.id}. Injecting dedup signal.`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-image-generated`,
                                type: 'short',
                                content: `[SYSTEM: IMAGE ALREADY GENERATED at ${generatedImagePath || 'path above'}. Do NOT call generate_image again — it will create DUPLICATE files. Send it with send_file(jid, "${generatedImagePath}") or set goals_met=true if task is complete.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: 'generate_image', imageGenerated: true }
                            });
                        }

                        // SEND_IMAGE COMPLETION: compound generate+send is a terminal delivery action.
                        // Treat it like send_file — inject delivery signal and hard break.
                        if (toolCall.name === 'send_image' && !resultIndicatesError) {
                            imageGeneratedInAction = true;
                            imageDeliveredInAction = true;
                            logger.info(`Agent: Image generated and sent in action ${action.id}. Forcing break.`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-image-delivered`,
                                type: 'short',
                                content: `[SYSTEM: IMAGE GENERATED AND DELIVERED SUCCESSFULLY. The user has received the image. Task is COMPLETE.]`,
                                metadata: { actionId: action.id, step: currentStep, skill: 'send_image', delivered: true, imageGenerated: true }
                            });
                            goalsMet = true;
                            forceBreak = true;
                            break;
                        }

                        // SEND_IMAGE PARTIAL FAILURE: image was generated but send failed (e.g. wrong channel).
                        // Mark imageGeneratedInAction so generate_image won't create a duplicate image.
                        // The LLM should use the correct channel-specific send skill to deliver the existing image.
                        if (toolCall.name === 'send_image' && resultIndicatesError) {
                            // Check if the result indicates the image was generated despite send failure
                            const hasImageGenerated = (hasStructuredResult && toolResult.imageGenerated === true) ||
                                resultString.includes('imageGenerated') ||
                                resultString.includes('Image was generated');
                            if (hasImageGenerated) {
                                imageGeneratedInAction = true;
                                // Extract file path from structured result or string
                                const extractedPath = (hasStructuredResult && toolResult.filePath) ||
                                    ((resultString.match(/filePath['"]?:\s*['"]?([^'"\s,}]+\.(?:png|jpg|webp))/i) || [])[1]) ||
                                    ((resultString.match(/([A-Z]:\\[^\s'"]+\.(?:png|jpg|webp))/i) || [])[1]) ||
                                    ((resultString.match(/(\/.+?\.(?:png|jpg|webp))/i) || [])[1]);
                                if (extractedPath) generatedImagePath = extractedPath;
                                logger.warn(`Agent: send_image PARTIAL FAILURE in action ${action.id} — image generated at ${generatedImagePath || 'unknown'} but send failed.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-image-generated-send-failed`,
                                    type: 'short',
                                    content: `[SYSTEM: Image was GENERATED at ${generatedImagePath || 'downloads folder'} but SEND FAILED. Do NOT generate another image. Use the correct channel skill to deliver: send_file("gateway-web", "${generatedImagePath}", "", "gateway-chat") for Gateway Chat, send_discord_file(channel_id, "${generatedImagePath}") for Discord, send_slack_file(channel_id, "${generatedImagePath}") for Slack, and send_file(jid, "${generatedImagePath}") for Telegram/WhatsApp.]`,
                                    metadata: { actionId: action.id, step: currentStep, skill: 'send_image', imageGenerated: true, sendFailed: true }
                                });
                            }
                        }

                        // IMAGE DELIVERY via send_file or send_discord_file: If we generated an image earlier
                        // in this action and now delivered it, force-break to prevent duplicate generation.
                        if ((toolCall.name === 'send_file' || toolCall.name === 'send_discord_file') && !resultIndicatesError && imageGeneratedInAction && !imageDeliveredInAction) {
                            imageDeliveredInAction = true;
                            logger.info(`Agent: Generated image delivered via ${toolCall.name} in action ${action.id}. Forcing break.`);
                            goalsMet = true;
                            forceBreak = true;
                            break;
                        }

                        // HARD BREAK after successful channel message send for "respond to" tasks
                        // This prevents duplicate messages when the LLM doesn't set goals_met correctly
                        const isChannelSend = ['send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat', 'telegram_send_buttons', 'telegram_send_poll'].includes(toolCall.name);
                        const isFileDelivery = toolCall.name === 'send_file' || toolCall.name === 'send_image';
                        const isResponseTask = action.payload?.description?.toLowerCase().includes('respond to') ||
                            action.payload?.requiresResponse === true;
                        const isRecoveryDeliveryTask = action.payload?.trigger === 'completion_audit_recovery';
                        const wasSuccessful = toolResult && !JSON.stringify(toolResult).toLowerCase().includes('error');

                        if (isChannelSend && isResponseTask && wasSuccessful) {
                            logger.info(`Agent: Channel message sent for response task ${action.id}. Terminating to prevent duplicates.`);
                            goalsMet = true;
                            forceBreak = true;
                            break;
                        }

                        if (isChannelSend && isRecoveryDeliveryTask && wasSuccessful) {
                            logger.info(`Agent: Channel message sent for recovery task ${action.id}. Terminating immediately to prevent duplicate recovery sends.`);
                            goalsMet = true;
                            forceBreak = true;
                            break;
                        }

                        // HARD BREAK after successful file delivery for file-centric tasks
                        // Prevents the agent from looping on read_file after the file has already been sent
                        if (isFileDelivery && wasSuccessful) {
                            const taskDesc = (action.payload?.description || '').toLowerCase();
                            const isFileCentricTask = taskDesc.includes('send') || taskDesc.includes('file') ||
                                taskDesc.includes('cut short') || taskDesc.includes('resend') ||
                                taskDesc.includes('deliver') || taskDesc.includes('share') ||
                                taskDesc.includes('truncat') || taskDesc.includes('incomplete') ||
                                taskDesc.includes('image') || taskDesc.includes('picture') ||
                                taskDesc.includes('draw') || taskDesc.includes('generat');
                            if (isFileCentricTask) {
                                logger.info(`Agent: File delivered for file-centric task ${action.id}. Terminating.`);
                                goalsMet = true;
                                forceBreak = true;
                                break;
                            }
                        }
                    }

                    // BROWSING PROGRESS INJECTION: If the agent has been doing browser work
                    // for 2+ steps without sending a user update, nudge it to communicate.
                    const browserSkillsUsed = Object.keys(skillCallCounts).filter(s => s.startsWith('browser_'));
                    const totalBrowserCalls = browserSkillsUsed.reduce((sum, s) => sum + skillCallCounts[s], 0);
                    if (totalBrowserCalls >= 2 && stepsSinceLastMessage >= 2 && messagesSent === 0) {
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-browse-progress-nudge`,
                            type: 'short',
                            content: `[SYSTEM: You have been browsing for ${totalBrowserCalls} steps without sending any update to the user. Send a brief status update NOW describing what you see on the page and what you're doing. Users need visibility into browsing progress — don't go silent. Keep them informed.]`,
                            metadata: { actionId: action.id, step: currentStep, browserCalls: totalBrowserCalls }
                        });
                        logger.info(`Agent: Injected browsing progress nudge at step ${currentStep} (${totalBrowserCalls} browser calls, no user message yet)`);
                    }

                    // GENERAL PROGRESS INJECTION: For non-browser tasks, nudge the agent to
                    // update the user when working silently for too long.
                    // Uses stepsSinceLastMessage as the primary check (accounts for both LLM-sent
                    // messages and system progress feedback that resets this counter).
                    if (totalBrowserCalls === 0 && stepsSinceLastMessage >= 4 && currentStep >= 4) {
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-general-progress-nudge`,
                            type: 'short',
                            content: `[SYSTEM: You have been working for ${stepsSinceLastMessage} steps without sending any message to the user. The user CANNOT see your internal work — they may think you've stopped or stalled. Send a brief progress update NOW: what you've done, what you're doing, and what's left. Even a short "Working on it — found X, now doing Y" helps the user feel informed.]`,
                            metadata: { actionId: action.id, step: currentStep, stepsSilent: stepsSinceLastMessage }
                        });
                        logger.info(`Agent: Injected general progress nudge at step ${currentStep} (${stepsSinceLastMessage} steps without message)`);
                    }

                    // NOW check goals_met AFTER tools have been executed
                    if (decision.verification?.goals_met) {
                        if (robustReasoningMode) {
                            const completionAudit = await this.auditCompletionFromActionLogs(action, {
                                currentStep,
                                messagesSent,
                                substantiveDeliveriesSent,
                                deepToolExecutedSinceLastMessage,
                                sentMessagesInAction,
                                skillCallCounts,
                                taskComplexity,
                                anyUserDeliverySuccess
                            });

                            if (!completionAudit.ok) {
                                const issueSummary = completionAudit.issues.join(' | ');
                                const auditCode = this.buildAuditCode(completionAudit.issues);
                                logger.warn(`Agent: Robust mode blocked completion in-loop for ${action.id} (${auditCode}): ${issueSummary}`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-robust-completion-blocked`,
                                    type: 'short',
                                    content: `[SYSTEM: COMPLETION BLOCKED (${auditCode}). You attempted goals_met=true before delivering concrete results. Resolve these issues now: ${issueSummary}. Send a substantive final result message, then complete.]`,
                                    metadata: { actionId: action.id, step: currentStep, issues: completionAudit.issues, auditCode }
                                });
                                continue;
                            }
                        }

                        logger.info(`Agent: Strategic goal satisfied after execution. Terminating action ${action.id}.`);
                        goalsMet = true;
                        break;
                    }

                    // COOLDOWN COMPLETION: If ALL send tools in this step were blocked and we already
                    // sent a message, the task is done — the agent is just looping trying to send dupes.
                    if (totalSendToolsInStep > 0 && toolsBlockedByCooldown >= totalSendToolsInStep && messagesSent > 0) {
                        if (substantiveDeliveriesSent > 0) {
                            logger.info(`Agent: All ${totalSendToolsInStep} send tool(s) blocked by cooldown/dupe guards after substantive delivery. Completing action ${action.id}.`);
                            goalsMet = true;
                            break;
                        }

                        logger.warn(`Agent: All ${totalSendToolsInStep} send tool(s) blocked but no substantive delivery yet. Forcing continuation for action ${action.id}.`);
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-suppressed-before-substantive`,
                            type: 'short',
                            content: `[SYSTEM: Your recent sends were suppressed, but you have NOT delivered a substantive answer yet. Send ONE concrete, content-rich response now (not an acknowledgment/status update). If needed, combine your acknowledgment and the actual content in a single message.]`,
                            metadata: { actionId: action.id, step: currentStep }
                        });
                    }

                    // SIDE-EFFECT DEDUP GUIDANCE: if every side-effect tool in this step was blocked
                    // as a duplicate of already-successful work, guide the next step instead of hard-stopping.
                    if (totalSideEffectToolsInStep > 0 && duplicateSideEffectsBlockedInStep >= totalSideEffectToolsInStep && successfulSideEffectKeys.size > 0) {
                        const hasDeliveredSubstantiveAnswer = substantiveDeliveriesSent > 0;
                        logger.info(`Agent: All ${totalSideEffectToolsInStep} side-effect tool(s) in step ${currentStep} were duplicate replays (action ${action.id}).`);
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-duplicate-sideeffects-guidance`,
                            type: 'short',
                            content: `[SYSTEM: Duplicate side-effect replays were blocked this step (${duplicateSideEffectsBlockedInStep}/${totalSideEffectToolsInStep}). Do NOT resend completed operations. If user still needs an answer, send ONE fresh substantive message. If all goals are already met, conclude.]`,
                            metadata: { actionId: action.id, step: currentStep, duplicateSideEffectsBlockedInStep, totalSideEffectToolsInStep }
                        });

                        if (hasDeliveredSubstantiveAnswer) {
                            logger.info(`Agent: Duplicate-only side-effect step occurred after substantive delivery. Completing action ${action.id}.`);
                            goalsMet = true;
                            break;
                        }

                        logger.warn(`Agent: Duplicate-only side-effect step before substantive delivery. Continuing action ${action.id} for one fresh response.`);
                        continue;
                    }

                    if (forceBreak) break;
                } else {
                    // No tools in response - check why before self-terminating
                    const toolsWereFiltered = (decision as any).toolsFiltered > 0;
                    const goalsNotMet = decision.verification?.goals_met === false;

                    // Case 1: Tools were filtered by validator - retry with feedback
                    if (toolsWereFiltered && goalsNotMet) {
                        noToolsRetryCount++;
                        if (noToolsRetryCount >= MAX_NO_TOOLS_RETRIES) {
                            logger.error(`Agent: Exceeded max retries (${MAX_NO_TOOLS_RETRIES}) for filtered tools. Terminating action ${action.id}.`);
                            break;
                        }
                        logger.warn(`Agent: ${(decision as any).toolsFiltered} tool(s) were filtered by validator but goals_met=false. Retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);

                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-tools-filtered`,
                            type: 'short',
                            content: `[SYSTEM: Your tool calls were INVALID and filtered. Common issues: browser_click/browser_type require 'selector' (use ref number from snapshot), browser_type requires 'text'. Check your tool metadata and try again with valid parameters.]`,
                            metadata: { actionId: action.id, step: currentStep, toolsFiltered: (decision as any).toolsFiltered }
                        });

                        continue;
                    }

                    // Case 2: LLM said goals_met=false but provided no tools - this is an error, retry
                    if (goalsNotMet && !toolsWereFiltered) {
                        noToolsRetryCount++;
                        if (noToolsRetryCount >= MAX_NO_TOOLS_RETRIES) {
                            logger.error(`Agent: Exceeded max retries (${MAX_NO_TOOLS_RETRIES}) for no-tools error. Terminating action ${action.id}.`);
                            break;
                        }

                        // Check if the pipeline suppressed send tools as duplicates
                        const pipelineDropped = pipelineNotes?.dropped || [];
                        const wasSendSuppressed = pipelineDropped.some((d: string) =>
                            d.startsWith('semantic-dupe:') || d.startsWith('dupe:') || d.startsWith('limit:')
                        );

                        if (wasSendSuppressed && messagesSent === 0) {
                            // Pipeline incorrectly suppressed the first reply — this shouldn't happen
                            // with our fix, but as a safety net, inject a better error message
                            logger.warn(`Agent: Pipeline suppressed first reply as duplicate. Retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES} with better guidance...`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-no-tools-error`,
                                type: 'short',
                                content: `[SYSTEM: Your reply was blocked because it was too similar to a recent message. Rephrase your response with DIFFERENT wording — don't just repeat the same message. Address the user's specific words directly.]`,
                                metadata: { actionId: action.id, step: currentStep, error: 'send_suppressed_as_dupe' }
                            });
                        } else {
                            logger.warn(`Agent: LLM returned goals_met=false but no tools. Retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-no-tools-error`,
                                type: 'short',
                                content: `[SYSTEM: You said goals_met=false but provided NO TOOLS. This is INVALID. If goals are not met, you MUST include at least one tool to make progress. Re-read the task and provide the appropriate tool calls.]`,
                                metadata: { actionId: action.id, step: currentStep, error: 'no_tools_but_goals_not_met' }
                            });
                        }

                        continue;
                    }

                    // Case 3: goals_met=true or undefined with no tools - legitimate termination
                    // BUT: catch silent termination — if from a channel and never sent a message, force a retry
                    const isChannelTask = action.payload.source === 'telegram' || action.payload.source === 'whatsapp' ||
                        action.payload.source === 'discord' || action.payload.source === 'slack' || action.payload.source === 'email' || action.payload.source === 'gateway-chat';
                    if (isChannelTask && messagesSent > 0 && substantiveDeliveriesSent === 0 && currentStep < MAX_STEPS) {
                        noToolsRetryCount++;
                        if (noToolsRetryCount < MAX_NO_TOOLS_RETRIES) {
                            logger.warn(`Agent: Action ${action.id} attempted completion after only non-substantive updates. Forcing retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-non-substantive-completion-blocked`,
                                type: 'short',
                                content: `[SYSTEM: BLOCKED PREMATURE COMPLETION. You sent updates but no substantive final answer. You MUST send a concrete result summary to the user (findings, answer, or outcome), not just status updates.]`,
                                metadata: { actionId: action.id, step: currentStep, error: 'non_substantive_completion_blocked' }
                            });
                            continue;
                        }
                    }

                    // Channel completion safety: if we have produced NEW deep-tool output since
                    // the last user-visible message, we are not done yet. We must send a final
                    // delivery message that includes those results.
                    if (isChannelTask && messagesSent > 0 && deepToolExecutedSinceLastMessage && currentStep < MAX_STEPS) {
                        noToolsRetryCount++;
                        if (noToolsRetryCount < MAX_NO_TOOLS_RETRIES) {
                            logger.warn(`Agent: Action ${action.id} attempted completion with unsent deep-tool output. Forcing retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-unsent-results-blocked`,
                                type: 'short',
                                content: `[SYSTEM: BLOCKED PREMATURE COMPLETION. You executed deep tools after your last message (e.g., web_search/browser/run_command) but did NOT send a final results message. Send one concrete answer with findings now.]`,
                                metadata: { actionId: action.id, step: currentStep, error: 'unsent_results_blocked' }
                            });
                            continue;
                        }
                    }

                    if (isChannelTask && messagesSent === 0 && currentStep < MAX_STEPS) {
                        noToolsRetryCount++;
                        if (noToolsRetryCount < MAX_NO_TOOLS_RETRIES) {
                            logger.warn(`Agent: Action ${action.id} tried to terminate without sending ANY message to channel user. Forcing retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                            this.memory.saveMemory({
                                id: `${action.id}-step-${currentStep}-silent-termination-blocked`,
                                type: 'short',
                                content: `[SYSTEM: BLOCKED SILENT TERMINATION. You tried to finish the task without sending ANY message to the user. Your text/reasoning output is NOT visible to them — the ONLY way to respond is by calling send_${action.payload.source === 'gateway-chat' ? 'gateway_chat' : action.payload.source}. You MUST include a send skill in your next response. The user is waiting for a reply.]`,
                                metadata: { actionId: action.id, step: currentStep, error: 'silent_termination_blocked' }
                            });
                            continue;
                        }
                    }
                    logger.info(`Agent: Action ${action.id} reached self-termination. Reasoning: ${decision.reasoning || 'No further tools needed.'}`);
                    goalsMet = true;
                    break;
                }
            }

            // If we exhausted all steps without completing, review before giving up
            if (currentStep >= MAX_STEPS && !goalsMet) {
                logger.warn(`Agent: Reached max steps (${MAX_STEPS}) for action ${action.id}. Reviewing if task is truly done...`);

                const maxStepsReview = await this.reviewForcedTermination(
                    action, 'max_steps', currentStep,
                    `Reached max steps (${MAX_STEPS}). The agent may have made progress but not delivered results yet.`,
                    { messagesSent, anyUserDeliverySuccess, substantiveDeliveriesSent }
                );

                if (maxStepsReview === 'continue') {
                    // Give the agent a few more steps to compile and deliver results
                    const nonSendCalls = Object.entries(skillCallCounts)
                        .filter(([skillName]) => !['send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat', 'telegram_send_buttons', 'telegram_send_poll', 'send_file'].includes(skillName))
                        .reduce((sum, [, count]) => sum + count, 0);
                    const adaptiveBonus = messagesSent === 0
                        ? Math.max(3, Math.min(8, Math.ceil(nonSendCalls / 2)))
                        : Math.max(2, Math.min(6, Math.ceil(nonSendCalls / 4)));
                    logger.info(`Agent: Review layer says task isn't done. Granting ${Math.min(adaptiveBonus, Math.max(3, MAX_STEPS))} adaptive bonus steps to wrap up.`);
                    this.memory.saveMemory({
                        id: `${action.id}-step-${currentStep}-max-steps-extension`,
                        type: 'short',
                        content: `[SYSTEM: You have used all ${MAX_STEPS} steps. You are getting a FEW BONUS STEPS to wrap up. IMMEDIATELY compile everything you have gathered and send a FINAL comprehensive message to the user. Do NOT start new research — deliver what you have NOW.]`,
                        metadata: { actionId: action.id, step: currentStep }
                    });
                    // Adaptive bonus steps for wrapping up
                    const bonusSteps = Math.min(adaptiveBonus, Math.max(3, MAX_STEPS));
                    let bonusMessageSent = false;
                    let bonusNoToolsRetryCount = 0;
                    let lastBonusTool = '';
                    let bonusSameToolCount = 0;
                    // Continue the loop for bonus steps (simple approach: just don't break, 
                    // but we need to adjust MAX_STEPS since the while loop already exited)
                    // We'll run a mini-loop here
                    for (let bonus = 0; bonus < bonusSteps; bonus++) {
                        currentStep++;
                        logger.info(`Agent: Bonus step ${bonus + 1}/${bonusSteps} for action ${action.id}`);

                        try {
                            const bonusTimeSignals = this.buildActionTimeSignals(action, {
                                actionStartedAtMs,
                                currentStep,
                                messagesSent,
                                stepsSinceLastMessage,
                                lastUserDeliveryAtMs,
                                isResearchTask
                            });
                            const bonusDecision = await ErrorHandler.withRetry(async () => {
                                return await this.decisionEngine.decide({
                                    ...action,
                                    payload: {
                                        ...action.payload,
                                        messagesSent,
                                        messagingLocked: true,
                                        currentStep,
                                        executionPlan,
                                        robustReasoningMode,
                                        sessionContinuityHint,
                                        timeSignals: bonusTimeSignals
                                    }
                                });
                            }, { maxRetries: 2, initialDelay: 1000 });

                            if (!bonusDecision?.tools?.length) {
                                const bonusGoalsNotMet = bonusDecision?.verification?.goals_met === false;
                                if (bonusGoalsNotMet) {
                                    bonusNoToolsRetryCount++;
                                    if (bonusNoToolsRetryCount >= MAX_NO_TOOLS_RETRIES) {
                                        logger.error(`Agent: Bonus steps exceeded max retries (${MAX_NO_TOOLS_RETRIES}) for no-tools error. Terminating action ${action.id}.`);
                                        break;
                                    }
                                    logger.warn(`Agent: Bonus step returned goals_met=false but no tools. Retry ${bonusNoToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                                    this.memory.saveMemory({
                                        id: `${action.id}-bonus-${bonus}-no-tools-error`,
                                        type: 'short',
                                        content: `[SYSTEM: You said goals_met=false but provided NO TOOLS during bonus steps. This is INVALID. If goals are not met, you MUST include at least one tool. Provide the appropriate tool calls to finish the task.]`,
                                        metadata: { actionId: action.id, step: currentStep, error: 'no_tools_but_goals_not_met' }
                                    });
                                    continue;
                                }
                                logger.info(`Agent: No tools in bonus step. Wrapping up.`);
                                break;
                            }

                            let bonusMsgSentThisStep = false;
                            for (const toolCall of bonusDecision.tools) {
                                const isSendTool = toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_discord' || toolCall.name === 'send_slack' || toolCall.name === 'send_gateway_chat' ||
                                    toolCall.name === 'telegram_send_buttons' || toolCall.name === 'telegram_send_poll';

                                // Apply message guards to bonus steps too
                                if (isSendTool) {
                                    const bonusMsg = (toolCall.metadata?.message || '').trim();
                                    // Block duplicates
                                    if (sentMessagesInAction.includes(bonusMsg)) {
                                        logger.warn(`Agent: Blocked duplicate message in bonus step (action ${action.id}).`);
                                        continue;
                                    }
                                    if (this.isSemanticallyDuplicateOutboundMessage(bonusMsg, sentMessagesInAction)) {
                                        logger.warn(`Agent: Blocked semantic duplicate message in bonus step (action ${action.id}).`);
                                        continue;
                                    }
                                    // Block double-message in same bonus step
                                    if (bonusMsgSentThisStep) {
                                        logger.warn(`Agent: Blocked double-message in bonus step (action ${action.id}).`);
                                        continue;
                                    }
                                    // Bonus steps are for wrapping up — block if a message was already
                                    // sent in a PREVIOUS bonus step (one final message is enough).
                                    if (bonusMessageSent) {
                                        logger.warn(`Agent: Blocked extra message in bonus steps — already sent final message (action ${action.id}).`);
                                        continue;
                                    }
                                }

                                try {
                                    const toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});
                                    if (isSendTool) {
                                        messagesSent++;
                                        bonusMsgSentThisStep = true;
                                        bonusMessageSent = true;
                                        sentMessagesInAction.push((toolCall.metadata?.message || '').trim());
                                        lastUserDeliveryAtMs = Date.now();
                                    }
                                    this.memory.saveMemory({
                                        id: `${action.id}-bonus-${bonus}-${toolCall.name}`,
                                        type: 'short',
                                        content: `Bonus step: Tool ${toolCall.name} returned: ${JSON.stringify(toolResult).slice(0, 500)}`,
                                        metadata: { tool: toolCall.name, result: toolResult }
                                    });
                                } catch (e) {
                                    logger.error(`Bonus step skill failed: ${toolCall.name} - ${e}`);
                                }
                            }

                            // Detect bonus-step looping on the same non-messaging tool
                            const primaryBonusTool = bonusDecision.tools[0]?.name || '';
                            if (primaryBonusTool && !primaryBonusTool.startsWith('send_')) {
                                if (primaryBonusTool === lastBonusTool) {
                                    bonusSameToolCount++;
                                    if (bonusSameToolCount >= 2) {
                                        logger.warn(`Agent: Bonus steps looping on ${primaryBonusTool} (${bonusSameToolCount + 1}x). Stopping — send a wrap-up message instead.`);
                                        break;
                                    }
                                } else {
                                    lastBonusTool = primaryBonusTool;
                                    bonusSameToolCount = 0;
                                }
                            }

                            // If we already sent the wrap-up message, no need for more bonus steps
                            if (bonusMessageSent) {
                                logger.info(`Agent: Final message sent in bonus steps. Done.`);
                                goalsMet = true;
                                break;
                            }

                            if (bonusDecision.verification?.goals_met) {
                                logger.info(`Agent: Goals met during bonus steps. Done.`);
                                goalsMet = true;
                                break;
                            }
                        } catch (e) {
                            logger.error(`Bonus step decision failed: ${e}`);
                            break;
                        }
                    }
                } else {
                    // Keep max-step fallback internal. User-facing delivery should come from
                    // normal tool outputs/recovery actions, not this generic guardrail notice.
                    this.maxStepFallbackCount++;
                    logger.info(`Agent: Max-step fallback kept internal for action ${action.id} (messagesSent=${messagesSent}, substantiveDeliveries=${substantiveDeliveriesSent}, totalFallbacks=${this.maxStepFallbackCount})`);
                    this.memory.saveMemory({
                        id: `metric-max-step-fallback-${action.id}-${Date.now()}`,
                        type: 'episodic',
                        content: `[METRIC] max_step_fallback action=${action.id} source=${action.payload?.source || 'unknown'} messagesSent=${messagesSent} substantiveDeliveries=${substantiveDeliveriesSent} runtimeTotal=${this.maxStepFallbackCount}`,
                        metadata: {
                            source: 'guardrail-metric',
                            metric: 'max_step_fallback',
                            actionId: action.id,
                            messagesSent,
                            substantiveDeliveriesSent: substantiveDeliveriesSent,
                            runtimeTotal: this.maxStepFallbackCount
                        }
                    });
                }
            }

            const isUserFacingAction = action.payload?.source === 'telegram' || action.payload?.source === 'whatsapp' ||
                action.payload?.source === 'discord' || action.payload?.source === 'slack' || action.payload?.source === 'email' || action.payload?.source === 'gateway-chat';
            if (!goalsMet && isUserFacingAction && anyUserDeliverySuccess) {
                logger.warn(`Agent: Reconciled final status to completed for ${action.id} because user delivery succeeded.`);
                this.memory.saveMemory({
                    id: `${action.id}-delivery-reconciled`,
                    type: 'short',
                    content: `[SYSTEM: Final-state reconciliation: delivery/send succeeded in this action. Marking task completed to avoid false failure due to guardrail exhaustion.]`,
                    metadata: { actionId: action.id, deliveryReconciled: true, messagesSent, substantiveDeliveriesSent }
                });
                goalsMet = true;
            }

            const finalStatus = this.actionQueue.getQueue().find(a => a.id === action.id)?.status;
            if (finalStatus === 'failed') {
                return;
            }

            // If we're waiting for clarification, don't mark as completed
            if (waitingForClarification) {
                logger.info(`Agent: Action ${action.id} paused awaiting user clarification. Will resume when user responds.`);
                return; // Skip the completion logic - action stays waiting
            }

            // TASK CONTINUITY CHECK: Detect if the agent acknowledged incomplete prior work
            // but didn't actually resume it (empty promise detection)
            await this.detectAndResumeIncompleteWork(action, sentMessagesInAction, currentStep);

            // PRE-COMPLETION LOG AUDIT: Before marking as completed, inspect this action's
            // own logs and block completion if unresolved/missed delivery patterns exist.
            let handedOffToRecovery = false;
            if (goalsMet) {
                const completionAudit = await this.auditCompletionFromActionLogs(action, {
                    currentStep,
                    messagesSent,
                    substantiveDeliveriesSent,
                    deepToolExecutedSinceLastMessage,
                    sentMessagesInAction,
                    skillCallCounts,
                    taskComplexity,
                    anyUserDeliverySuccess
                });

                if (!completionAudit.ok) {
                    const issueSummary = completionAudit.issues.join(' | ');
                    const auditCode = this.buildAuditCode(completionAudit.issues);
                    logger.warn(`Agent: Completion log audit blocked action ${action.id} (${auditCode}): ${issueSummary}`);
                    this.memory.saveMemory({
                        id: `${action.id}-completion-audit-blocked`,
                        type: 'short',
                        content: `[SYSTEM: COMPLETION AUDIT BLOCKED (${auditCode}). This action attempted to complete with unresolved issues: ${issueSummary}. A recovery task has been queued to ensure final delivery.]`,
                        metadata: { actionId: action.id, issues: completionAudit.issues, auditCode }
                    });

                    // Queue a targeted recovery follow-up unless this action is already a recovery run.
                    if (action.payload?.trigger !== 'completion_audit_recovery') {
                        if (this.hasExistingRecoveryTask(
                            'completion_audit_recovery',
                            action.id,
                            action.payload?.source,
                            action.payload?.sourceId
                        )) {
                            logger.info(`Agent: Skipping duplicate completion_audit_recovery for ${action.id}; recovery already exists or was recently completed.`);
                            handedOffToRecovery = true;
                        } else {
                            // Include the original task description so the recovery agent has clear
                            // context and doesn't confuse it with unrelated older tasks in memory.
                            const originalDesc = (action.payload?.description || 'unknown task').slice(0, 300);
                            const recoveryDesc = `RECOVERY for action ${action.id}: The previous attempt at "${originalDesc}" gathered results but did not deliver a concrete final answer to the user. Review ONLY the step logs for action ${action.id} and send a specific answer now. Do not rehash or resend content from unrelated prior tasks.`;
                            await this.pushTask(
                                recoveryDesc,
                                9,
                                {
                                    source: action.payload?.source,
                                    sourceId: action.payload?.sourceId,
                                    chatId: action.payload?.chatId,
                                    userId: action.payload?.userId,
                                    senderName: action.payload?.senderName,
                                    sessionScopeId: action.payload?.sessionScopeId,
                                    trigger: 'completion_audit_recovery',
                                    originalActionId: action.id
                                },
                                action.lane === 'autonomy' ? 'autonomy' : 'user'
                            );
                            handedOffToRecovery = true;
                        }
                    }

                    goalsMet = false;
                }
            }

            // Determine final status based on whether goals were actually achieved
            const actionStatus = (goalsMet || handedOffToRecovery) ? 'completed' : 'failed';

            if (handedOffToRecovery) {
                this.memory.saveMemory({
                    id: `${action.id}-recovery-handoff-complete`,
                    type: 'short',
                    content: `[SYSTEM: Recovery handoff queued for unresolved completion audit issues. Marking original action complete to prevent duplicate auto-retry.]`,
                    metadata: { actionId: action.id, handedOffToRecovery: true }
                });
            }

            if (action.payload?.source && !action.payload?.isHeartbeat) {
                const sessionScopeId = action.payload?.sessionScopeId || `${action.payload.source}:${action.payload.sourceId || action.payload.userId || 'unknown'}`;
                this.memory.saveMemory({
                    id: `${action.id}-objective-${goalsMet ? 'completed' : 'failed'}`,
                    type: 'short',
                    content: `[OBJECTIVE] ${goalsMet ? 'COMPLETED' : 'FAILED'}: ${String(action.payload.description || '').slice(0, 320)}`,
                    metadata: {
                        actionId: action.id,
                        source: action.payload.source,
                        sourceId: action.payload.sourceId,
                        sessionScopeId,
                        objectiveStatus: goalsMet ? 'completed' : 'failed',
                        objectiveId: action.id
                    }
                });
            }

            if (!goalsMet) {
                logger.warn(`Agent: Action ${action.id} terminated without achieving goals (guard rail or exhaustion). Marked as failed.`);
            }
            if (isUserFacingAction && messagesSent === 0) {
                logger.error(`Agent: No user-visible response was delivered for action ${action.id}. source=${action.payload?.source} step=${currentStep}`);
                const fallbackSent = await this.sendNoResponseFallback(action, actionStatus === 'failed' ? 'action-failed' : undefined);
                if (fallbackSent) {
                    messagesSent++;
                    anyUserDeliverySuccess = true;
                    logger.warn(`Agent: Sent no-response fallback message for action ${action.id}.`);
                }
                this.memory.saveMemory({
                    id: `${action.id}-no-response-diagnostic`,
                    type: 'short',
                    content: `[SYSTEM: RESPONSE DIAGNOSTIC — no user-visible message was sent for this channel task.${fallbackSent ? ' A last-resort fallback message WAS sent to the user.' : ' Last-resort fallback message ALSO failed.'} Investigate blocked/suppressed send tools, channel policy, and tool failures for action ${action.id}.`,
                    metadata: { actionId: action.id, source: action.payload?.source, noResponse: true, steps: currentStep, fallbackSent }
                });
            }

            // Record Final Response/Reasoning in Memory upon completion
            this.memory.saveMemory({
                id: `${action.id}-conclusion`,
                type: 'episodic',
                content: `Task ${goalsMet ? 'Finished' : 'Terminated without completion'}: ${action.payload.description}. Status: ${actionStatus}.`,
                metadata: { actionId: action.id, steps: currentStep, goalsMet }
            });

            this.actionQueue.updateStatus(action.id, actionStatus);

            // If ActionQueue silently auto-retried (flipped status back to 'pending'),
            // tell the user so they're not left wondering why nothing happened after
            // being told "Working on it...".
            if (
                actionStatus === 'failed' &&
                action.status === 'pending' &&
                action.retry?.nextRetryAt &&
                action.payload?.source && !action.payload?.isHeartbeat
            ) {
                const delaySecs = Math.max(5, Math.round(
                    (new Date(action.retry.nextRetryAt).getTime() - Date.now()) / 1000
                ));
                await this.sendProgressFeedback(
                    action, 'retry',
                    `Had trouble with that — will try again in ${delaySecs}s.`
                );
            }

            // Reset heartbeat idle counters to prevent false exponential backoff accumulation.
            // • Heartbeat completing with goalsMet=true  → it was productive; reset cooldown.
            // • Non-heartbeat action completing           → agent is clearly active, not idle.
            // Only a heartbeat that exits with goalsMet=false (truly nothing to do) should
            // keep the counter incrementing, to back off genuinely idle periods.
            if (action.payload?.isHeartbeat) {
                if (goalsMet) {
                    this.lastHeartbeatProductive = true;
                    this.consecutiveIdleHeartbeats = 0;
                }
                // !goalsMet → preset false + incremented counter from push time are correct
            } else {
                // Real user-sourced or scheduled task completed — agent is active
                this.lastHeartbeatProductive = true;
                this.consecutiveIdleHeartbeats = 0;
            }

            // POST-ACTION REFLECTION: Extract learnings and journal entries
            // Run BEFORE cleanup so we still have step memories to analyze
            try {
                await this.postActionReflection(action, actionStatus, currentStep, skillCallCounts);
            } catch (e) {
                logger.warn(`Agent: Post-action reflection failed for ${action.id}: ${e}`);
            }

            // CLEANUP: Remove step-scoped memories for this completed action.
            // These are ground-truth during execution but become cross-action pollution after.
            // The episodic summary (-conclusion) persists the outcome; step details are no longer needed.
            try {
                this.memory.cleanupActionMemories(action.id);
            } catch (e) {
                logger.warn(`Agent: Failed to cleanup action memories for ${action.id}: ${e}`);
            }
        } catch (error: any) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');

            // Cleanup step memories even on failure to prevent pollution
            try {
                this.memory.cleanupActionMemories(action.id);
            } catch (e) {
                logger.warn(`Agent: Failed to cleanup action memories for ${action.id}: ${e}`);
            }

            // SOS Notification
            const sosMessage = `⚠️ *Action Failed*: I encountered a persistent error while processing your request: "${action.payload.description}"\n\n*Error*: ${error.message}`;

            if (this.telegram && action.payload.source === 'telegram') {
                await this.telegram.sendMessage(action.payload.sourceId, sosMessage + `\n\nI've logged this to my journal and will attempt to recover in the next turn.`);
            } else if (this.whatsapp && action.payload.source === 'whatsapp') {
                await this.whatsapp.sendMessage(action.payload.sourceId, sosMessage);
            } else if (this.slack && action.payload.source === 'slack') {
                await this.slack.sendMessage(action.payload.sourceId, sosMessage);
            } else if (action.payload.source === 'email') {
                const emailChannel = this.getOrCreateEmailChannel();
                if (emailChannel) {
                    await emailChannel.sendEmail(action.payload.sourceId, action.payload?.subject ? `Re: ${action.payload.subject}` : 'OrcBot action failure', sosMessage, action.payload?.inReplyTo, action.payload?.references);
                }
            }
        } finally {
            this.stopPersistentTypingIndicator();
            this.isBusy = false;
            this.currentActionId = null;
            this.currentActionStartAt = null;

            // Flush any pending memory writes to disk before moving on
            this.memory.flushToDisk();

            // BACKGROUND TASK: Memory Consolidation
            // We do this in the background after the agent is marked as not busy
            // to prevent blocking the next task.
            this.memory.consolidate(this.llm).catch(e => {
                logger.error(`Background Memory Consolidation Error: ${e}`);
            });
            this.memory.consolidateInteractions(this.llm, 'session_end').catch(e => {
                logger.error(`Background Interaction Consolidation Error: ${e}`);
            });
        }
    }

    /**
     * Estimate the time it will take to profile a list of contacts.
     * @param contactCount Number of contacts to profile
     * @returns Duration in minutes
     */
    public estimateProfilingDuration(contactCount: number): number {
        // Assume 5-10 seconds per contact for LLM analysis
        const secondsPerContact = 8;
        const totalSeconds = contactCount * secondsPerContact;
        return Math.ceil(totalSeconds / 60);
    }

    /**
     * Profile WhatsApp chat history for multiple contacts to build context.
     * This is a batch process that should be triggered from the TUI.
     */
    public async profileWhatsAppHistory(
        contacts: Array<{ jid: string, name: string }>,
        msgsPerContact: number = 20,
        onProgress?: (processed: number, total: number, currentName: string) => void
    ): Promise<{ processed: number, updated: number }> {
        if (!this.whatsapp) throw new Error('WhatsApp channel not available');

        let processed = 0;
        let updated = 0;
        const total = contacts.length;

        for (const contact of contacts) {
            try {
                if (onProgress) onProgress(processed, total, contact.name);

                logger.info(`Agent: Profiling history for ${contact.name} (${contact.jid})...`);
                const history = await this.whatsapp.getHistory(contact.jid, msgsPerContact);

                if (history.length === 0) {
                    logger.info(`Agent: No history found for ${contact.name}. Skipping.`);
                    processed++;
                    continue;
                }

                // Format history for LLM
                const formattedHistory = history.map(m => `${m.fromMe ? '[Me]' : '[Contact]'} (${m.timestamp}): ${m.text}`).join('\n');
                const existingProfile = this.memory.getContactProfile(contact.jid) || 'No existing profile.';

                const prompt = `
You are analyzing past WhatsApp chat history to build a persistent context profile for a contact.
Your goal is to understand the relationship between the user and this contact, the contact's preferences, tone, and recurring topics.

CONTACT INFO:
Name: ${contact.name}
JID: ${contact.jid}

EXISTING PROFILE:
${existingProfile}

RECENT CHAT HISTORY (Last ${history.length} messages):
${formattedHistory}

TASK:
Based on the chat history and the existing profile, generate an updated, comprehensive JSON profile for this contact.
Include fields like:
- "relationship": (e.g. friend, colleague, customer)
- "tone_preferences": (e.g. formal, casual, uses emojis, concise)
- "recurring_topics": [list of main subjects discussed]
- "key_facts": [list of important details learned about them]
- "response_strategy": [how the bot should best interact with this person]

Return ONLY the valid JSON object.
`;

                const response = await this.llm.callFast(prompt, "You are a personality and relationship analyst for an AI agent.");

                // Clean up markdown if present
                let jsonStr = response.trim();
                if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
                if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
                if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);

                // Save to memory
                this.memory.saveContactProfile(contact.jid, jsonStr.trim());

                updated++;
                processed++;
            } catch (error) {
                logger.error(`Agent: Error profiling contact ${contact.jid}: ${error}`);
                processed++;
            }
        }

        return { processed, updated };
    }
}
