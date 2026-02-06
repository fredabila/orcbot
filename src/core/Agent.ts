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
import { configManagementSkill } from '../skills/configManagement';
import { WebBrowser } from '../tools/WebBrowser';
import { WorkerProfileManager } from './WorkerProfile';
import { AgentOrchestrator } from './AgentOrchestrator';
import { RuntimeTuner } from './RuntimeTuner';
import { BootstrapManager } from './BootstrapManager';
import { memoryToolsSkills } from '../skills/memoryTools';
import { Cron } from 'croner';
import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import { eventBus } from './EventBus';
import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/ErrorHandler';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
    public config: ConfigManager;
    public telegram: TelegramChannel | undefined;
    public whatsapp: WhatsAppChannel | undefined;
    public discord: DiscordChannel | undefined;
    public browser: WebBrowser;
    public workerProfile: WorkerProfileManager;
    public orchestrator: AgentOrchestrator;
    public bootstrap: BootstrapManager;
    private lastActionTime: number;
    private lastHeartbeatAt: number = 0;
    private consecutiveIdleHeartbeats: number = 0;
    private lastHeartbeatProductive: boolean = true;
    private agentConfigFile: string;
    private agentIdentity: string = '';
    private isBusy: boolean = false;
    private lastPluginHealthCheckAt: number = 0;
    private currentActionId: string | null = null;
    private currentActionStartAt: number | null = null;
    private cancelledActions: Set<string> = new Set();
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

    constructor() {
        this.config = new ConfigManager();
        this.agentConfigFile = this.config.get('agentIdentityPath');
        this.initializeStorage();

        this.memory = new MemoryManager(
            this.config.get('memoryPath'),
            this.config.get('userProfilePath')
        );
        
        // Configure memory limits from config
        this.memory.setLimits({
            contextLimit: this.config.get('memoryContextLimit'),
            episodicLimit: this.config.get('memoryEpisodicLimit'),
            consolidationThreshold: this.config.get('memoryConsolidationThreshold'),
            consolidationBatch: this.config.get('memoryConsolidationBatch')
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
            tokenTracker
        });
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
            this.bootstrap  // Pass bootstrap manager
        );
        this.simulationEngine = new SimulationEngine(this.llm);
        this.actionQueue = new ActionQueue(this.config.get('actionQueuePath') || './actions.json');
        this.scheduler = new Scheduler();
        this.pollingManager = new PollingManager();
        
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
            this.config.get('lightpandaEndpoint')  // Lightpanda CDP endpoint
        );
        this.workerProfile = new WorkerProfileManager();
        this.orchestrator = new AgentOrchestrator();

        this.loadLastActionTime();
        this.loadLastHeartbeatTime();
        this.heartbeatSchedulePath = path.join(path.dirname(this.config.get('actionQueuePath')), 'heartbeat-schedules.json');
        this.loadHeartbeatSchedules();
        this.scheduledTasksPath = path.join(path.dirname(this.config.get('actionQueuePath')), 'scheduled-tasks.json');
        this.loadScheduledTasks();

        // Ensure context is up to date (supports reconfiguration)
        this.skills.setContext({
            browser: this.browser,
            config: this.config,
            agent: this,
            logger: logger,
            workerProfile: this.workerProfile,
            orchestrator: this.orchestrator
        });

        this.loadAgentIdentity();
        this.setupEventListeners();
        this.setupChannels();
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
                if (key === 'userProfile') defaultContent = '# User Profile\n\nThis file contains information about the user.\n\n## Core Identity\n- Name: Frederick\n- Preferences: None known yet\n';
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
    }

    private registerInternalSkills() {
        // Skill: Send Telegram
        this.skills.registerSkill({
            name: 'send_telegram',
            description: 'Send a message to a Telegram user',
            usage: 'send_telegram(chatId, message)',
            handler: async (args: any) => {
                const chat_id = args.chat_id || args.chatId || args.id;
                const message = args.message || args.content || args.text;

                if (!chat_id) return 'Error: Missing chat_id. Use the numeric ID provided in context.';
                if (!message) return 'Error: Missing message content.';

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
                    timestamp: new Date().toISOString(),
                    messageId
                });

                return `Message sent to Gateway Chat`;
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

        // Skill: Download File
        this.skills.registerSkill({
            name: 'download_file',
            description: 'Download a file from the web to the agent\'s local storage.',
            usage: 'download_file(url, filename?)',
            handler: async (args: any) => {
                const url = args.url;
                if (!url) return 'Error: Missing url.';

                try {
                    let filename = args.filename || path.basename(new URL(url).pathname) || `file_${Date.now()}`;
                    const downloadsDir = path.join(path.dirname(this.config.get('memoryPath')), 'downloads');
                    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

                    const filePath = path.join(downloadsDir, filename);
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                    const buffer = await response.arrayBuffer();
                    fs.writeFileSync(filePath, Buffer.from(buffer));

                    return `File downloaded successfully to: ${filePath}`;
                } catch (e) {
                    return `Error downloading file: ${e}`;
                }
            }
        });

        // Skill: Send File
        this.skills.registerSkill({
            name: 'send_file',
            description: 'Send a file (image, document, audio) to a Telegram or WhatsApp contact.',
            usage: 'send_file(jid, path, caption?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const filePath = args.path || args.file_path;
                const caption = args.caption || '';

                if (!jid) return 'Error: Missing jid.';
                if (!filePath) return 'Error: Missing file path.';

                try {
                    const isWhatsApp = jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via WhatsApp to ${jid}`;
                    } else if (this.telegram && !isWhatsApp) {
                        await this.telegram.sendFile(jid, filePath, caption);
                        return `File ${path.basename(filePath)} sent via Telegram to ${jid}`;
                    }
                    return 'Appropriate channel not available or JID type not recognized.';
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

                try {
                    const resolvedPath = path.resolve(filePath);
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
                    const resolvedPath = path.resolve(dirPath);
                    
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
            description: 'Read the contents of a file.',
            usage: 'read_file(path)',
            handler: async (args: any) => {
                const filePath = args.path || args.file_path || args.file;

                if (!filePath) return 'Error: Missing file path.';

                try {
                    const resolvedPath = path.resolve(filePath);
                    
                    if (!fs.existsSync(resolvedPath)) {
                        return `Error: File not found: ${resolvedPath}`;
                    }
                    
                    const content = fs.readFileSync(resolvedPath, 'utf8');
                    return content.length > 10000 
                        ? content.substring(0, 10000) + '\n\n[... truncated, file too large ...]'
                        : content;
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
                const dirPath = args.path || args.dir || args.directory || '.';

                try {
                    const resolvedPath = path.resolve(dirPath);
                    
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
            description: 'Convert text to an audio file using AI voice synthesis. Returns the file path of the generated audio. Available voices: alloy, echo, fable, onyx, nova, shimmer.',
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
                    const outputPath = path.join(downloadsDir, `tts_${Date.now()}.ogg`);
                    
                    await this.llm.textToSpeech(text, outputPath, voice, speed);
                    return `Audio generated successfully: ${outputPath} (voice: ${voice}, ${text.length} chars)`;
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
                    const audioPath = path.join(downloadsDir, `voice_${Date.now()}.ogg`);
                    await this.llm.textToSpeech(text, audioPath, voice);

                    // Send as voice note through the appropriate channel
                    const isWhatsApp = jid.includes('@s.whatsapp.net') || jid.includes('@g.us');
                    if (isWhatsApp && this.whatsapp) {
                        await this.whatsapp.sendVoiceNote(jid, audioPath);
                        return `Voice note sent via WhatsApp to ${jid} (voice: ${voice}, ${text.length} chars)`;
                    } else if (this.telegram && !isWhatsApp) {
                        await this.telegram.sendVoiceNote(jid, audioPath);
                        return `Voice note sent via Telegram to ${jid} (voice: ${voice}, ${text.length} chars)`;
                    }
                    return 'Appropriate channel not available or JID type not recognized.';
                } catch (e) {
                    return `Error sending voice note: ${e}`;
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
            description: 'Reply to a contact\'s WhatsApp status update',
            usage: 'reply_whatsapp_status(jid, message)',
            handler: async (args: any) => {
                const jid = args.jid || args.to;
                const message = args.message || args.content || args.text;

                if (!jid) return 'Error: Missing jid.';
                if (!message) return 'Error: Missing message content.';

                if (this.whatsapp) {
                    // For status reply, the JID is the person who posted the status
                    await this.whatsapp.sendMessage(jid, message);
                    return `Replied to status of ${jid}`;
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

        // Skill: Search Chat History
        this.skills.registerSkill({
            name: 'search_chat_history',
            description: 'Search chat history with a specific WhatsApp contact. Returns recent messages from memory.',
            usage: 'search_chat_history(jid, limit?)',
            handler: async (args: any) => {
                const jid = args.jid || args.to || args.id;
                const limit = parseInt(args.limit || '10', 10);

                if (!jid) return 'Error: Missing jid.';

                try {
                    const memories = this.memory.searchMemory('short');
                    const chatHistory = memories
                        .filter((m: any) => 
                            m.metadata?.source === 'whatsapp' && 
                            m.metadata?.senderId === jid
                        )
                        .slice(-limit)
                        .reverse();

                    if (chatHistory.length === 0) {
                        return `No chat history found for ${jid}.`;
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

        // Skill: Run Shell Command
        this.skills.registerSkill({
            name: 'run_command',
            description: 'Execute a shell command on the server. For file creation, use separate commands or write_file skill. Do not use Unix echo with multiline content on Windows. To run commands in a specific directory, either use "cd /path && command" or pass cwd parameter.',
            usage: 'run_command(command, cwd?)',
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
                let workingDir = args.cwd || this.config.get('commandWorkingDir') || process.cwd();
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
                        const resolvedPath = path.resolve(targetDir);
                        
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

                const timeoutMs = parseInt(args.timeoutMs || args.timeout || this.config.get('commandTimeoutMs') || 120000, 10);
                const retries = parseInt(args.retries || this.config.get('commandRetries') || 1, 10);

                const { exec } = require('child_process');

                const runOnce = () => new Promise<string>((resolve) => {
                    const child = exec(actualCommand, { timeout: timeoutMs, cwd: workingDir }, (error: any, stdout: string, stderr: string) => {
                        if (error) {
                            if (error.killed) {
                                resolve(`Error: Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
                                return;
                            }
                            resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                            return;
                        }
                        resolve(stdout || stderr || "Command executed successfully (no output)");
                    });

                    child.on('error', (err: any) => {
                        resolve(`Error: Failed to start command: ${err?.message || err}`);
                    });
                });

                let attempt = 0;
                let lastResult = '';
                while (attempt <= retries) {
                    lastResult = await runOnce();
                    if (!lastResult.startsWith('Error:')) return lastResult;
                    attempt++;
                    if (attempt <= retries) {
                        logger.warn(`run_command retry ${attempt}/${retries} after error: ${lastResult}`);
                    }
                }

                return lastResult;
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
                const shell = isWindows ? 'PowerShell/CMD' : 'Bash/Zsh';
                
                const commandGuidance = isWindows ? `
📋 WINDOWS COMMAND GUIDANCE:
- Use semicolon (;) to chain commands, NOT &&
- Use PowerShell cmdlets when possible (Get-ChildItem, Set-Content, etc.)
- For file creation: Use 'write_file' skill instead of echo
- For directories: Use 'create_directory' skill instead of mkdir
- Path separator: Use \\ or / (both work in PowerShell)
- Environment vars: $env:VAR_NAME (PowerShell) or %VAR_NAME% (CMD)` 
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

        // ─── Agent Skills (SKILL.md Format) ──────────────────────────────

        // Skill: Install Agent Skill (from URL or path)
        this.skills.registerSkill({
            name: 'install_skill',
            description: 'Install an Agent Skill from a GitHub repo URL, gist, .skill file URL, raw SKILL.md URL, or local path. Agent Skills follow the agentskills.io format and extend the agent with new capabilities, workflows, and knowledge.',
            usage: 'install_skill(source)',
            handler: async (args: any) => {
                const source = args.source || args.url || args.path || args.repo;
                if (!source) return 'Error: Missing source. Provide a URL or local path to a skill.';

                if (source.startsWith('http://') || source.startsWith('https://')) {
                    const result = await this.skills.installSkillFromUrl(source);
                    if (result.success && result.skillName) {
                        // Auto-activate newly installed skill
                        this.skills.activateAgentSkill(result.skillName);
                    }
                    return result.message;
                } else {
                    const result = await this.skills.installSkillFromPath(source);
                    if (result.success && result.skillName) {
                        this.skills.activateAgentSkill(result.skillName);
                    }
                    return result.message;
                }
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
            description: 'Navigate to a URL and return a semantic snapshot of interactive elements.',
            usage: 'browser_navigate(url)',
            handler: async (args: any) => {
                const url = args.url || args.link || args.site;
                if (!url) return 'Error: Missing url.';
                const res = await this.browser.navigate(url);
                if (res.startsWith('Error')) return res;
                return await this.browser.getSemanticSnapshot();
            }
        });

        // Skill: Browser Examine Page
        this.skills.registerSkill({
            name: 'browser_examine_page',
            description: 'Get a text-based semantic snapshot of the current page including all interactive elements with reference IDs.',
            usage: 'browser_examine_page()',
            handler: async () => {
                return await this.browser.getSemanticSnapshot();
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
            description: 'Click an element using a CSS selector or a numeric reference ID [ref=N] from the semantic snapshot.',
            usage: 'browser_click(selector_or_ref)',
            handler: async (args: any) => {
                const selector = args.selector_or_ref || args.selector || args.css || args.ref;
                if (!selector) return 'Error: Missing selector or ref.';
                return this.browser.click(String(selector));
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
                return this.browser.type(String(selector), text);
            }
        });

        // Skill: Browser Press Key
        this.skills.registerSkill({
            name: 'browser_press',
            description: 'Press a keyboard key (e.g. "Enter", "Tab")',
            usage: 'browser_press(key)',
            handler: async (args: any) => {
                const key = args.key || args.name;
                if (!key) return 'Error: Missing key.';
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
                const result = await this.browser.screenshot();
                return captcha ? `${result}\n[SYSTEM ALERT: ${captcha}. You should use browser_solve_captcha() now.]` : result;
            }
        });

        // Skill: Browser Vision
        this.skills.registerSkill({
            name: 'browser_vision',
            description: 'Use vision to analyze the current browser page when semantic snapshots are insufficient.',
            usage: 'browser_vision(prompt?)',
            handler: async (args: any) => {
                const prompt = args.prompt || args.question || args.text || 'Describe what you see on the page.';

                const screenshotResult = await this.browser.screenshot();
                if (String(screenshotResult).startsWith('Failed')) {
                    return screenshotResult;
                }

                const screenshotPath = path.join(os.homedir(), '.orcbot', 'screenshot.png');
                if (!fs.existsSync(screenshotPath)) {
                    return `Error: Screenshot file not found at ${screenshotPath}`;
                }

                try {
                    return await this.llm.analyzeMedia(screenshotPath, prompt);
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
                    this.config.get('lightpandaEndpoint')
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
                            try { fs.unlinkSync(filePath); } catch {}
                            return `Error: The provided module code has errors:\n${loadError}\n\nPlease provide corrected code.`;
                        }
                        
                        const loaded = this.skills.getAllSkills().find(s => s.name === name);
                        if (!loaded) {
                            try { fs.unlinkSync(filePath); } catch {}
                            return `Error: The skill '${name}' failed to register. The module may be missing the required exports (name, description, usage, handler).`;
                        }
                        
                        // Also generate SKILL.md wrapper so plugin is visible in both systems
                        this.generateSkillMdForPlugin(name, description || loaded?.description || '', filePath);
                        return `Skill '${name}' created from full module code at ${filePath} and registered successfully.`;
                    } catch (loadError: any) {
                        try { fs.unlinkSync(filePath); } catch {}
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
                        try { fs.unlinkSync(filePath); } catch {}
                        return `Error: Skill '${name}' has syntax/compilation errors and was not saved:\n${loadError}\n\nPlease fix the code and try again.`;
                    }
                    
                    // Verify the skill actually loaded
                    const allSkills = this.skills.getAllSkills();
                    const loaded = allSkills.find(s => s.name === name);
                    
                    if (!loaded) {
                        // Skill didn't load - clean up
                        try { fs.unlinkSync(filePath); } catch {}
                        return `Error: Skill '${name}' failed to load after creation. The code may have syntax errors or invalid exports. Please review and provide corrected code.`;
                    }
                    
                    // Also generate SKILL.md wrapper so plugin is visible in both systems
                    this.generateSkillMdForPlugin(name, description || loaded?.description || '', filePath);
                    return `Skill '${name}' created at ${filePath} and registered successfully. You can use it immediately.`;
                } catch (loadError: any) {
                    // Delete the broken file
                    try { fs.unlinkSync(filePath); } catch {}
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
                        const { chromium } = require('playwright');
                        const browser = await chromium.launch({ headless: true });
                        const page = await browser.newPage();
                        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
                        html = await page.content();
                        await browser.close();
                    } else {
                        // Extract from current active session
                        if (!this.browser.page) return "Error: No active browser page to extract from. Provide a URL.";
                        html = await this.browser.page.content();
                    }

                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const reader = new Readability(doc as any);
                    const article = reader.parse();

                    if (!article) return "Failed to extract article content.";
                    return `Title: ${article.title}\n\nContent:\n${article.textContent.substring(0, 5000)}`;
                } catch (e) {
                    return `Error extracting article: ${e}`;
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
            description: 'Save permanent information learned about the user (name, preferences, habits, goals). Use this PROACTIVELY whenever you learn something new about Frederick.',
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
                            // Extract key facts using LLM
                            const extractPrompt = `Extract 5-10 key facts/insights from this search result about "${topic}". Format as bullet points with clear, factual statements:\n\n${searchResult.slice(0, 4000)}`;
                            const extracted = await this.llm.call(extractPrompt, 'Extract key learnings');
                            knowledge_content = extracted || searchResult.slice(0, 2000);
                        } else {
                            return `Could not find sufficient information about "${topic}" to learn from.`;
                        }
                    } catch (e) {
                        return `Failed to research topic "${topic}": ${e}`;
                    }
                }

                const learningPath = this.config.get('learningPath');
                try {
                    const entry = `\n\n## ${topic}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${knowledge_content}\n\n---`;
                    fs.appendFileSync(learningPath, entry);
                    this.lastHeartbeatProductive = true; // Mark as productive
                    logger.info(`Learning: Saved knowledge about "${topic}" to ${learningPath}`);
                    return `Successfully researched and saved knowledge about "${topic}" to LEARNING.md`;
                } catch (e) {
                    return `Failed to update learning base at ${learningPath}: ${e}`;
                }
            }
        });

        // Skill: Request Supporting Data
        this.skills.registerSkill({
            name: 'request_supporting_data',
            description: 'Pause execution and ask the user for missing information, credentials, or clarification.',
            usage: 'request_supporting_data(question)',
            handler: async (args: any) => {
                const question = args.question || args.text || args.info;
                if (!question) return 'Error: Missing question.';

                // We'll rely on the Agent loop to handle the "pause" by detecting this tool call.
                // But we should actually send the message here if we can.
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

        // Polling Manager Skills
        this.skills.registerSkill({
            name: 'register_polling_job',
            description: 'Register a polling job to wait for a condition to be met. Useful for monitoring tasks, waiting for file changes, or checking status periodically.',
            usage: 'register_polling_job(id, description, checkCommand, intervalMs, maxAttempts?)',
            handler: async (args: any) => {
                const id = args.id || args.job_id;
                const description = args.description || args.desc;
                const checkCommand = args.checkCommand || args.command || args.check;
                const intervalMs = args.intervalMs || args.interval || 5000;
                const maxAttempts = args.maxAttempts || args.max_attempts;

                if (!id) return 'Error: Missing job id.';
                if (!description) return 'Error: Missing description.';
                if (!checkCommand) return 'Error: Missing checkCommand (a shell command that returns exit code 0 when condition is met).';

                try {
                    this.pollingManager.registerJob({
                        id,
                        description,
                        checkFn: async () => {
                            // Execute shell command and check exit code
                            const { exec } = require('child_process');
                            return new Promise((resolve) => {
                                exec(checkCommand, (error: any) => {
                                    // Exit code 0 = success = condition met
                                    resolve(!error);
                                });
                            });
                        },
                        intervalMs,
                        maxAttempts,
                        onSuccess: (jobId) => {
                            logger.info(`Polling job "${jobId}" succeeded`);
                            this.memory.saveMemory({
                                id: `polling-success-${Date.now()}`,
                                type: 'short',
                                content: `Polling job "${jobId}" (${description}) completed successfully`,
                                timestamp: new Date().toISOString(),
                                metadata: { source: 'polling', jobId }
                            });
                        },
                        onFailure: (jobId, reason) => {
                            logger.warn(`Polling job "${jobId}" failed: ${reason}`);
                            this.memory.saveMemory({
                                id: `polling-failure-${Date.now()}`,
                                type: 'short',
                                content: `Polling job "${jobId}" (${description}) failed: ${reason}`,
                                timestamp: new Date().toISOString(),
                                metadata: { source: 'polling', jobId, reason }
                            });
                        }
                    });
                    return `Polling job "${id}" registered. Will check every ${intervalMs}ms${maxAttempts ? ` (max ${maxAttempts} attempts)` : ''}.`;
                } catch (e) {
                    return `Failed to register polling job: ${e}`;
                }
            }
        });

        this.skills.registerSkill({
            name: 'cancel_polling_job',
            description: 'Cancel a running polling job by ID.',
            usage: 'cancel_polling_job(id)',
            handler: async (args: any) => {
                const id = args.id || args.job_id;
                if (!id) return 'Error: Missing job id.';

                try {
                    const cancelled = this.pollingManager.cancelJob(id);
                    if (cancelled) {
                        return `Polling job "${id}" cancelled successfully.`;
                    } else {
                        return `Polling job "${id}" not found.`;
                    }
                } catch (e) {
                    return `Failed to cancel polling job: ${e}`;
                }
            }
        });

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
    }

    private loadAgentIdentity() {
        if (fs.existsSync(this.agentConfigFile)) {
            this.agentIdentity = fs.readFileSync(this.agentConfigFile, 'utf-8');
            logger.info(`Agent identity loaded from ${this.agentConfigFile}`);
        } else {
            this.agentIdentity = "You are a professional autonomous agent.";
            logger.warn(`${this.agentConfigFile} not found. Using default identity.`);
        }
        this.decisionEngine.setAgentIdentity(this.agentIdentity);
    }

    /**
     * When the agent gets stuck in a loop, this method analyzes the failure
     * and considers creating a new skill to handle the situation better.
     */
    private async triggerSkillCreationForFailure(taskDescription: string, failingTool?: string, failingContext?: string) {
        try {
            // GUARD: Never trigger self-improvement for core built-in skills.
            // If web_search or browser_navigate is "failing", it's a strategy problem, not a missing skill.
            if (failingTool && this.isCoreBuiltinSkill(failingTool)) {
                logger.info(`Agent: Skipping auto skill creation — '${failingTool}' is a core built-in skill. Strategy issue, not missing capability.`);
                return;
            }

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
                { source: 'self_improvement', skillName: parsed.skill_name, trigger: 'loop_detection' },
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
        type: 'start' | 'working' | 'error' | 'recovering',
        details?: string
    ): Promise<void> {
        if (!this.config.get('progressFeedbackEnabled')) return;
        
        // Only send feedback for channel-sourced actions
        const source = action.payload?.source;
        const sourceId = action.payload?.sourceId;
        if (!source || !sourceId) return;
        
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
        }
        
        try {
            if (source === 'telegram' && this.telegram) {
                await this.telegram.sendMessage(sourceId, message);
            } else if (source === 'whatsapp' && this.whatsapp) {
                await this.whatsapp.sendMessage(sourceId, message);
            }
        } catch (e) {
            logger.debug(`Failed to send progress feedback: ${e}`);
        }
    }

    /**
     * REVIEW GATE for forced terminations.
     * When a hard guardrail (message budget, skill frequency, max steps) wants to kill a task,
     * this method asks the LLM review layer whether the task is truly done or should continue.
     * Returns 'continue' if the task should keep going, 'terminate' if it should stop.
     */
    private async reviewForcedTermination(
        action: Action,
        reason: 'message_budget' | 'skill_frequency' | 'max_steps',
        currentStep: number,
        details: string
    ): Promise<'continue' | 'terminate'> {
        try {
            const taskDescription = action.payload?.description || 'Unknown task';
            const recentContext = this.memory.getRecentContext();
            const stepHistory = recentContext
                .filter(m => m.content?.includes(action.id) || m.metadata?.actionId === action.id)
                .map(m => m.content)
                .join('\n')
                .slice(-2000); // Last 2000 chars of step history for this action

            const reviewPrompt = `You are a task completion reviewer. A hard safety guardrail is about to TERMINATE a task. Your job is to decide if the task is truly done or if it should continue.

TASK: "${taskDescription}"
TERMINATION REASON: ${reason} — ${details}
CURRENT STEP: ${currentStep}

RECENT STEP HISTORY:
${stepHistory || 'No step history available.'}

RULES:
- If the task was a RESEARCH or DEEP WORK task (gathering info, writing reports, building something) and meaningful progress has been made but it's not done yet, return "continue".
- If the agent is truly stuck in a loop making NO progress at all (same exact calls with same results), return "terminate".
- If the agent has already gathered enough information to deliver a useful response to the user, return "terminate" (it should compile and send what it has).
- If the agent hasn't delivered ANY results to the user yet but has gathered data, return "continue" (it needs to compile and send).
- Prefer "continue" when in doubt — it's better to let the agent wrap up than to leave the user hanging.

Respond with ONLY valid JSON:
{ "decision": "continue" | "terminate", "reason": "brief explanation" }`;

            const response = await this.llm.call(reviewPrompt, 'You are a task reviewer. Respond only with valid JSON.');
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
            'extract_article', 'download_file', 'read_file', 'write_to_file',
            'write_file', 'create_file', 'delete_file', 'run_command',
            'send_telegram', 'send_whatsapp', 'send_discord', 'send_gateway_chat',
            'send_voice_note', 'text_to_speech', 'analyze_media',
            'update_journal', 'update_learning', 'update_user_profile',
            'update_agent_identity', 'get_system_info', 'system_check',
            'manage_config', 'read_bootstrap_file', 'request_supporting_data',
            'manage_skills', 'create_custom_skill', 'create_skill',
            'schedule_task', 'schedule_list', 'schedule_remove',
            'install_npm_dependency'
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

    private isTrivialSocialIntent(text: string): boolean {
        const normalized = (text || '').toLowerCase();
        const quotedMatch = normalized.match(/"([^"]+)"/);
        const payload = (quotedMatch?.[1] || normalized).trim();

        if (payload.length === 0) return false;

        const patterns = [
            /^hi\b/, /^hello\b/, /^hey\b/, /^yo\b/,
            /\bgood (morning|afternoon|evening)\b/,
            /\bhow are you\b/,
            /\bhow's it going\b/,
            /\byou there\b/,
            /\bare you there\b/,
            /\bare you ignoring me\b/,
            /\bp(i|y)ng\b/,
            /^thanks\b/, /^thank you\b/
        ];

        return payload.length <= 80 && patterns.some(p => p.test(payload));
    }

    /**
     * Detect simple response tasks that don't need simulation planning (token saving)
     * Simple tasks: short questions, acknowledgments, single-step requests
     */
    private isSimpleResponseTask(text: string): boolean {
        const normalized = (text || '').toLowerCase();
        const quotedMatch = normalized.match(/"([^"]+)"/);
        const payload = (quotedMatch?.[1] || normalized).trim();
        
        // Very short messages are usually simple
        if (payload.length <= 50) return true;
        
        // Questions that can be answered directly
        const simplePatterns = [
            /^what('s| is) (your|the) (name|time|date)\b/,
            /^who are you\b/,
            /^can you\b.*\?$/,
            /^do you\b.*\?$/,
            /^are you\b.*\?$/,
            /^tell me about yourself\b/,
            /^what can you do\b/,
            /\b(yes|no|ok|okay|sure|alright|fine|great|cool|nice|awesome)\b/,
            /^(👍|👎|🙏|😊|😀|🤔|❤️|✅|❌)/  // Emoji-only or emoji-start responses
        ];
        
        // Complex keywords that indicate multi-step tasks
        const complexPatterns = [
            /\b(search|find|look up|research)\b/,
            /\b(download|install|setup|configure)\b/,
            /\b(create|build|make|generate)\b.*(file|project|app)/,
            /\b(analyze|investigate|debug)\b/,
            /\b(run|execute|deploy)\b/,
            /\bstep.?by.?step\b/,
            /\bmultiple\b/
        ];
        
        const isComplex = complexPatterns.some(p => p.test(payload));
        if (isComplex) return false;
        
        const isSimple = payload.length <= 100 || simplePatterns.some(p => p.test(payload));
        return isSimple;
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

    private setupEventListeners() {
        eventBus.on('scheduler:tick', async () => {
            try {
                await this.processNextAction();
                await this.runPluginHealthCheck('tick');
                this.checkHeartbeat();
            } catch (e) {
                logger.error(`Scheduler tick error (non-fatal): ${e}`);
            }
        });

        eventBus.on('action:queued', (action: Action) => {
            logger.info(`Agent: Noticed new action ${action.id} in queue`);
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
                    oldConfig.memoryConsolidationBatch !== newConfig.memoryConsolidationBatch;
                
                if (memoryChanged) {
                    this.memory.setLimits({
                        contextLimit: newConfig.memoryContextLimit,
                        episodicLimit: newConfig.memoryEpisodicLimit,
                        consolidationThreshold: newConfig.memoryConsolidationThreshold,
                        consolidationBatch: newConfig.memoryConsolidationBatch
                    });
                    logger.info('Agent: Memory limits reloaded');
                }
            } catch (e) {
                logger.error(`Agent: Error handling config change: ${e}`);
            }
        });
    }

    private checkHeartbeat() {
        this.detectStalledAction();
        this.recoverStaleInProgressActions();

        // CRITICAL: Skip heartbeat if agent is actively processing an action
        if (this.isBusy) {
            logger.debug('Agent: Heartbeat skipped - currently processing an action');
            return;
        }

        const autonomyEnabled = this.config.get('autonomyEnabled');
        const intervalMinutes = this.config.get('autonomyInterval') || 0;
        if (!autonomyEnabled || intervalMinutes <= 0) return;

        // Check for ACTIVE tasks (pending, waiting, or in-progress)
        const activeTasks = this.actionQueue.getQueue().filter(a => a.status === 'pending' || a.status === 'waiting' || a.status === 'in-progress');

        // CRITICAL: Skip heartbeat if there are ANY pending/in-progress tasks
        // This prevents heartbeat from disrupting ongoing work
        if (activeTasks.length > 0) {
            logger.debug(`Agent: Heartbeat skipped - ${activeTasks.length} active task(s) in queue`);
            return;
        }

        const idleTimeMs = Date.now() - this.lastActionTime;
        const heartbeatDue = (Date.now() - this.lastHeartbeatAt) > intervalMinutes * 60 * 1000;

        // SMART COOLING: If last heartbeat was unproductive, exponentially back off
        // After 3 unproductive heartbeats, wait 2x, then 4x, then 8x the interval
        const cooldownMultiplier = this.lastHeartbeatProductive ? 1 : Math.min(8, Math.pow(2, this.consecutiveIdleHeartbeats));
        const effectiveInterval = intervalMinutes * cooldownMultiplier;
        const smartHeartbeatDue = (Date.now() - this.lastHeartbeatAt) > effectiveInterval * 60 * 1000;

        if (!smartHeartbeatDue) {
            // Still cooling off
            return;
        }

        if (heartbeatDue) {
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

            // Track productivity
            this.lastHeartbeatProductive = false; // Will be set true if actual learning/action occurs
            this.consecutiveIdleHeartbeats++;
            this.updateLastHeartbeatTime();
        }
    }

    private buildSmartHeartbeatPrompt(idleTimeMs: number, workerCount: number, availableWorkers: number): string {
        // Get recent memory to understand context and find actionable opportunities
        const recentMemories = this.memory.getRecentContext(20);
        const now = Date.now();
        
        // Format memories with relative time for recency awareness
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
                return `[${ageStr}] ${m.content}`;
            })
            .join('\n');

        // Check for incomplete/failed tasks
        const recentTasks = this.actionQueue.getQueue()
            .filter(a => a.status === 'failed' || a.status === 'completed')
            .slice(-5)
            .map(a => `[${a.status}] ${a.payload?.description?.slice(0, 100) || 'Unknown'}`)
            .join('\n');

        // Get user profile for personalized actions
        const userProfilePath = this.config.get('userProfilePath');
        let userContext = '';
        try {
            if (fs.existsSync(userProfilePath)) {
                userContext = fs.readFileSync(userProfilePath, 'utf-8').slice(0, 500);
            }
        } catch { /* ignore */ }

        return `
PROACTIVE HEARTBEAT - Idle for ${Math.floor(idleTimeMs / 60000)} minutes.
Workers: ${availableWorkers} available / ${workerCount} total
Current Time: ${new Date().toLocaleString()}

═══════════════════════════════════════════
RECENT CONVERSATION & TASKS (sorted by recency):
${recentContext.slice(0, 2000) || 'No recent activity'}

RECENT TASK HISTORY:
${recentTasks || 'No recent tasks'}

USER PROFILE:
${userContext.slice(0, 300) || 'No profile yet'}
═══════════════════════════════════════════

YOU HAVE FULL CAPABILITIES. Based on the context above, choose an ACTION:

⚡ **PRIORITIZATION RULES**:
- PRIORITIZE items from the last few minutes/hours over older items
- Items marked "Xm ago" or "Xh ago" are NEWER and should take priority
- Items marked "Xd ago" (days) are OLDER - only act on these if nothing recent is actionable
- If the user asked you to do something recently, that takes priority over old tasks

🔄 **FOLLOW UP ON SOMETHING**
- Did the user ask you to check something later? Do it now.
- Was there a task that failed? Try a different approach.
- Did user mention a website/service? Go check it for updates.

📬 **PROACTIVE OUTREACH**
- Send the user a useful update via Telegram/WhatsApp
- Share something relevant you found
- Ask if they need help with something mentioned earlier

🔍 **INVESTIGATE & RESEARCH**
- User mentioned a problem? Research solutions and report back
- Something was unclear? Look it up and prepare an answer
- Browse a site the user cares about and summarize what's new

🛠️ **MAINTENANCE & IMPROVEMENT**
- Clean up old memories or consolidate learnings
- Update your identity/persona based on interactions
- Retry a failed automation with a new strategy

📚 **LEARN SOMETHING CONTEXTUAL**
- Research deeper into a topic the user discussed
- update_learning("topic from context") to auto-research and save

⏹️ **NOTHING TO DO**
- If context is empty or nothing actionable: terminate with goals_met: true
- Don't force an action if there's genuinely nothing useful

RULES:
- RECENT actions (minutes/hours ago) take priority over OLD ones (days ago)
- Actions must relate to the conversation context above
- Be genuinely helpful, not performative
- If you message the user, have something valuable to say
- If nothing meaningful to do, just terminate
`;
    }

    private async delegateHeartbeatResearch(availableAgents: any[]) {
        // Get context to determine what action to delegate
        const recentMemories = this.memory.getRecentContext(15);
        const recentContext = recentMemories
            .filter(m => m.type === 'episodic' || m.type === 'short')
            .map(m => m.content)
            .join('\n');

        if (!recentContext || recentContext.length < 50) {
            logger.info(`Agent: No recent context for heartbeat action, skipping delegation`);
            return;
        }

        // Use LLM to determine the best proactive action from context
        try {
            const actionPrompt = `Based on this conversation context, what is ONE useful proactive action a worker agent could do? 
Consider: following up on something, researching a topic mentioned, checking a website, preparing information.

Context:
${recentContext.slice(0, 1500)}

Respond with a single actionable task description (one sentence):`;
            
            const taskDescription = await this.llm.call(actionPrompt, 'Extract proactive action');
            
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

        const cron = new Cron(scheduleDef.schedule, () => {
            logger.info(`Heartbeat Schedule Triggered: ${scheduleDef.task}`);
            this.pushTask(`Heartbeat Task: ${scheduleDef.task}`, scheduleDef.priority || 6, { isHeartbeat: true, heartbeatId: id }, 'autonomy');
        });

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
        const everyMatch = raw.match(/every\s+(\d+)\s+(minute|hour|day)s?/i);
        if (everyMatch) {
            const amount = parseInt(everyMatch[1]);
            const unit = everyMatch[2].toLowerCase();
            if (unit.startsWith('minute')) return `*/${amount} * * * *`;
            if (unit.startsWith('hour')) return `0 */${amount} * * *`;
            if (unit.startsWith('day')) return `0 0 */${amount} * *`;
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
        const stale = queue.filter(a => a.status === 'in-progress' && new Date(a.updatedAt || a.timestamp).getTime() < threshold);
        if (stale.length === 0) return;

        for (const action of stale) {
            logger.warn(`Agent: Found stale in-progress action ${action.id}. Marking failed.`);
            this.actionQueue.updateStatus(action.id, 'failed');
        }
    }

    public async resetMemory() {
        logger.info('Agent: Resetting all memory and identity files...');
        const dataHome = this.config.getDataHome();

        // Clear memory.json
        const memoryPath = this.config.get('memoryPath') || path.join(dataHome, 'memory.json');
        if (fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, JSON.stringify({}, null, 2));

        // Clear actions.json
        const actionPath = this.config.get('actionQueuePath') || path.join(dataHome, 'actions.json');
        if (fs.existsSync(actionPath)) fs.writeFileSync(actionPath, JSON.stringify([], null, 2));

        // Reset USER.md
        const userPath = this.config.get('userProfilePath') || path.join(dataHome, 'USER.md');
        const localUserPath = path.resolve(process.cwd(), 'USER.md');
        const defaultUser = fs.existsSync(localUserPath)
            ? fs.readFileSync(localUserPath, 'utf-8')
            : '# User Profile\n\nThis file contains information about the user.\n';
        fs.writeFileSync(userPath, defaultUser);

        // Reset .AI.md
        const localAIPath = path.resolve(process.cwd(), '.AI.md');
        const defaultAI = fs.existsSync(localAIPath)
            ? fs.readFileSync(localAIPath, 'utf-8')
            : '# .AI.md\nName: OrcBot\nPersonality: proactive, concise, professional\nAutonomyLevel: high\nDefaultBehavior: \n  - prioritize tasks based on user goals\n  - act proactively when deadlines are near\n  - consult SKILLS.md tools to accomplish actions\n';
        fs.writeFileSync(this.agentConfigFile, defaultAI);

        // Reset JOURNAL.md
        const journalPath = this.config.get('journalPath') || path.join(dataHome, 'JOURNAL.md');
        const localJournalPath = path.resolve(process.cwd(), 'JOURNAL.md');
        const defaultJournal = fs.existsSync(localJournalPath)
            ? fs.readFileSync(localJournalPath, 'utf-8')
            : '# Agent Journal\nThis file contains self-reflections and activity logs.\n';
        fs.writeFileSync(journalPath, defaultJournal);

        // Reset LEARNING.md
        const learningPath = this.config.get('learningPath') || path.join(dataHome, 'LEARNING.md');
        const localLearningPath = path.resolve(process.cwd(), 'LEARNING.md');
        const defaultLearning = fs.existsSync(localLearningPath)
            ? fs.readFileSync(localLearningPath, 'utf-8')
            : '# Agent Learning Base\nThis file contains structured knowledge on various topics.\n';
        fs.writeFileSync(learningPath, defaultLearning);

        // Clear heartbeat data
        const heartbeatDir = path.dirname(actionPath);
        const lastHeartbeatPath = path.join(heartbeatDir, 'last_heartbeat');
        const lastHeartbeatAutonomyPath = path.join(heartbeatDir, 'last_heartbeat_autonomy');
        const heartbeatSchedulesPath = path.join(heartbeatDir, 'heartbeat-schedules.json');
        
        if (fs.existsSync(lastHeartbeatPath)) {
            fs.unlinkSync(lastHeartbeatPath);
            logger.info('Agent: Cleared last_heartbeat file');
        }
        if (fs.existsSync(lastHeartbeatAutonomyPath)) {
            fs.unlinkSync(lastHeartbeatAutonomyPath);
            logger.info('Agent: Cleared last_heartbeat_autonomy file');
        }
        if (fs.existsSync(heartbeatSchedulesPath)) {
            fs.writeFileSync(heartbeatSchedulesPath, '[]', 'utf8');
            logger.info('Agent: Cleared heartbeat schedules');
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

        // Reload managers
        this.memory = new MemoryManager(memoryPath, userPath);
        this.actionQueue = new ActionQueue(actionPath);
        this.decisionEngine = new DecisionEngine(
            this.memory,
            this.llm,
            this.skills,
            journalPath,
            learningPath,
            this.config,
            this.bootstrap
        );

        logger.info('Agent: Memory and Identity have been reset.');
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
            const recentHist = this.memory.getRecentContext();
            const contextStr = recentHist.map(c => `[${c.type}] ${c.content}`).join('\n');
            const executionPlan = await this.simulationEngine.simulate(
                action.payload.description,
                contextStr,
                this.skills.getSkillsPrompt()
            );

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
                        executionPlan
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

    public async start() {
        this.acquireInstanceLock();
        logger.info('Agent is starting...');
        this.scheduler.start();
        this.pollingManager.start();

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

        const results = await Promise.allSettled(startupTasks.map(t => t.promise));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const name = startupTasks[index]?.name || 'unknown';
                logger.error(`Agent: Failed to start ${name} channel: ${result.reason?.message || result.reason}`);
            }
        });
        await this.runPluginHealthCheck('startup');
        logger.info('Agent: All channels initialized');
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
        await this.browser.close();
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

            const cleanup = () => this.releaseInstanceLock();
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

    public async pushTask(description: string, priority: number = 5, metadata: any = {}, lane: 'user' | 'autonomy' = 'user') {
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
            
            // Prevent unbounded growth
            if (this.processedMessages.size > this.processedMessagesMaxSize) {
                const entries = Array.from(this.processedMessages);
                entries.slice(0, 100).forEach(e => this.processedMessages.delete(e));
            }
        }

        // If we have an action paused waiting for a reply from this same source/thread,
        // resume it instead of pushing a brand-new action.
        // We do NOT require platform reply/quote usage; users often respond normally.
        if (metadata?.source && metadata?.sourceId) {
            const waitingAction = this.actionQueue.getQueue()
                .filter(a => a.status === 'waiting' && a.payload?.source === metadata.source && a.payload?.sourceId === metadata.sourceId)
                .sort((a, b) => {
                    const at = Date.parse(a.updatedAt || a.timestamp || '') || 0;
                    const bt = Date.parse(b.updatedAt || b.timestamp || '') || 0;
                    return bt - at;
                })[0];

            if (waitingAction) {
                logger.info(`Agent: Resuming waiting action ${waitingAction.id} due to new inbound message${messageId ? ` ${messageId}` : ''}`);
                // Update the ACTION DESCRIPTION to include the new user message.
                // This is critical — the DecisionEngine deliberates on payload.description,
                // so if we don't update it, the LLM keeps re-reading the stale original task.
                const originalDesc = waitingAction.payload?.description || '';
                const updatedDesc = `${originalDesc}\n\n[USER FOLLOW-UP]: ${description}`;
                this.actionQueue.updatePayload(waitingAction.id, {
                    description: updatedDesc,
                    lastUserMessageId: messageId || undefined,
                    lastUserMessageText: description,
                    resumedFromWaitingAt: new Date().toISOString()
                });
                this.actionQueue.updateStatus(waitingAction.id, 'pending');

                this.memory.saveMemory({
                    id: `${waitingAction.id}-resume-${messageId || Date.now()}`,
                    type: 'short',
                    content: `[SYSTEM: New user message received; resuming previously paused action ${waitingAction.id}.]`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        actionId: waitingAction.id,
                        resumedFrom: 'waiting',
                        source: metadata.source,
                        sourceId: metadata.sourceId,
                        messageId: messageId || undefined
                    }
                });
                return;
            }
        }
        
        const action: Action = {
            id: Math.random().toString(36).substring(7),
            type: 'TASK',
            payload: { description, ...metadata },
            priority,
            lane,
            status: 'pending',
            timestamp: new Date().toISOString(),
        };
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

    private async processNextAction() {
        if (this.isBusy) return;

        const action = this.actionQueue.getNext();
        if (!action) return;

        this.isBusy = true;
        this.currentActionId = action.id;
        this.currentActionStartAt = Date.now();
        try {
            this.updateLastActionTime();
            this.actionQueue.updateStatus(action.id, 'in-progress');

            // Record Task Start in Episodic Memory
            this.memory.saveMemory({
                id: `${action.id}-start`,
                type: 'episodic',
                content: `Starting Task: "${action.payload.description}" ${action.payload.source === 'telegram' ? `(via Telegram from ${action.payload.senderName})` : ''}`,
                metadata: { actionId: action.id, source: action.payload.source }
            });

            // SIMULATION LAYER (New)
            // Run a quick mental simulation to plan the steps (executed once per action start)
            const recentHist = this.memory.getRecentContext();
            const contextStr = recentHist.map(c => `[${c.type}] ${c.content}`).join('\n');
            const isSocialFastPath = this.isTrivialSocialIntent(action.payload.description || '');
            const skipSimulation = this.config.get('skipSimulationForSimpleTasks');
            
            // Detect simple tasks that don't need simulation (token saving)
            const isSimpleTask = isSocialFastPath || 
                (skipSimulation && this.isSimpleResponseTask(action.payload.description || ''));
            
            // PROGRESS FEEDBACK: Let user know we're working on non-trivial tasks
            if (!isSimpleTask && action.payload.source) {
                await this.sendProgressFeedback(action, 'start');
            }
            
            const executionPlan = isSimpleTask
                ? 'Simple task: Respond directly and terminate. No multi-step planning needed.'
                : await this.simulationEngine.simulate(
                    action.payload.description,
                    contextStr.slice(-1000), // Limit context for simulation to save tokens
                    this.config.get('compactSkillsPrompt') 
                        ? this.skills.getCompactSkillsPrompt() 
                        : this.skills.getSkillsPrompt()
                );

            // RESEARCH TASK DETECTION
            // Research/deep-work tasks legitimately need many tool calls and status updates.
            // We give them higher budgets so they don't get killed mid-work.
            const RESEARCH_TOOLS = new Set([
                'web_search', 'browser_navigate', 'browser_click', 'browser_type',
                'browser_examine_page', 'browser_screenshot', 'browser_back',
                'extract_article', 'download_file', 'read_file', 'write_to_file',
                'run_command', 'analyze_media'
            ]);
            const taskDesc = (action.payload.description || '').toLowerCase();
            const researchKeywords = [
                'research', 'deep dive', 'investigate', 'find out', 'look up', 'search for',
                'compile', 'gather', 'aggregate', 'analyze', 'explore', 'discover',
                'browse', 'scrape', 'crawl', 'download', 'collect', 'summarize',
                'report on', 'write about', 'create a report', 'build a', 'develop a',
                'set up', 'configure', 'install', 'deploy', 'with pictures', 'with images'
            ];
            const isResearchTask = !isSocialFastPath && researchKeywords.some(kw => taskDesc.includes(kw));

            const MAX_STEPS = isSocialFastPath ? 1 : (this.config.get('maxStepsPerAction') || 15);
            const MAX_MESSAGES = isSocialFastPath ? 1 : isResearchTask ? 8 : (this.config.get('maxMessagesPerAction') || 3);
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
            let consecutiveNonDeepTurns = 0;
            let waitingForClarification = false; // Track if we're paused for user input
            const sentMessagesInAction: string[] = [];
            const skillCallCounts: Record<string, number> = {}; // Track how many times each skill is called
            const skillFailCounts: Record<string, number> = {}; // Track consecutive failures per skill
            const recentSkillNames: string[] = []; // Track skill name sequence for pattern detection

            const nonDeepSkills = [
                'send_telegram',
                'send_whatsapp',
                'send_gateway_chat',
                'update_journal',
                'update_learning',
                'update_user_profile',
                'update_agent_identity',
                'get_system_info',
                'system_check',
                'manage_config',  // Config reads are not progress-making actions
                'read_bootstrap_file', // Reading bootstrap files is not progress
                'browser_examine_page', // Examining without action is low info
                'browser_screenshot',
                'request_supporting_data'
            ];

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

                if (messagesSent >= MAX_MESSAGES) {
                    logger.warn(`Agent: Message budget reached (${messagesSent}/${MAX_MESSAGES}) for action ${action.id}. Checking if task is truly done...`);
                    
                    // REVIEW GATE: Don't blindly kill — ask the review layer if task is actually done
                    const budgetReviewResult = await this.reviewForcedTermination(
                        action, 'message_budget', currentStep,
                        `Message budget reached (${messagesSent}/${MAX_MESSAGES}). Agent has been sending status updates while working.`
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

                if (this.telegram && action.payload.source === 'telegram') {
                    await this.telegram.sendTypingIndicator(action.payload.sourceId);
                }

                let decision;
                try {
                    decision = await ErrorHandler.withRetry(async () => {
                        return await this.decisionEngine.decide({
                            ...action,
                            payload: {
                                ...action.payload,
                                messagesSent,
                                messagingLocked: messagesSent > 0,
                                currentStep,
                                executionPlan // Pass plan to DecisionEngine
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
                        if (consecutiveNonDeepTurns >= 3) {
                            logger.warn(`Agent: Detected planning loop (3 turns without deep action). Terminating action ${action.id}.`);
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
                            
                            // SELF-IMPROVEMENT: Only trigger for non-core tools (core tools looping = strategy issue, not missing skill)
                            const failingTool = decision.tools[0]?.name;
                            if (failingTool && !this.isCoreBuiltinSkill(failingTool) && !RESEARCH_TOOLS.has(failingTool)) {
                                const failingContext = JSON.stringify(decision.tools[0]?.metadata || {}).slice(0, 200);
                                const taskDescription = typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload);
                                await this.triggerSkillCreationForFailure(taskDescription, failingTool, failingContext);
                            } else {
                                logger.info(`Agent: Loop on core/research tool '${failingTool}' — not triggering self-improvement (strategy issue, not missing skill).`);
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
                            
                            // Only trigger self-improvement for NON-core, non-research skills
                            if (!isResearchTool && !this.isCoreBuiltinSkill(skillName)) {
                                if (skillExists && failCount > 0) {
                                    logger.info(`Agent: Skill '${skillName}' exists but keeps failing (${failCount} errors). Not creating a new skill — this is a parameter issue.`);
                                    this.memory.saveMemory({
                                        id: `${action.id}-step-${currentStep}-skill-loop-guidance`,
                                        type: 'short',
                                        content: `[SYSTEM: You called '${skillName}' ${callCount} times but it kept failing. The skill EXISTS and works — the problem is that you are passing WRONG PARAMETERS. Review the skill's usage instructions carefully, check what parameters it expects, and try again with correct values. If you cannot determine the right parameters, INFORM THE USER that you need help with this skill.]`,
                                        metadata: { actionId: action.id, skill: skillName, failures: failCount }
                                    });
                                } else {
                                    await this.triggerSkillCreationForFailure(
                                        typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload),
                                        skillName,
                                        `Skill called ${callCount} times without progress`
                                    );
                                }
                            } else {
                                logger.info(`Agent: '${skillName}' is a core/research tool — skipping self-improvement trigger (not a missing capability).`);
                            }
                            break;
                        }
                    }

                    // 5. PATTERN-BASED LOOP DETECTION
                    // Detect repeating patterns like [manage_config, run_command, manage_config, run_command]
                    if (recentSkillNames.length >= 6) {
                        const last6 = recentSkillNames.slice(-6);
                        const pattern2 = `${last6[0]},${last6[1]}`;
                        const isRepeating2 = `${last6[2]},${last6[3]}` === pattern2 && `${last6[4]},${last6[5]}` === pattern2;
                        if (isRepeating2) {
                            logger.warn(`Agent: Detected repeating skill pattern [${pattern2}] x3 in action ${action.id}. Breaking loop.`);
                            await this.sendProgressFeedback(action, 'recovering', 'Detected repeating pattern. Trying a different approach...');
                            break;
                        }
                    }

                    let forceBreak = false;
                    let hasSentMessageInThisStep = false;

                    for (const toolCall of decision.tools) {
                        // Reset cooldown if a deep tool (search, command, browser interaction) is used
                        if (!nonDeepSkills.includes(toolCall.name)) {
                            deepToolExecutedSinceLastMessage = true;
                        }

                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_gateway_chat') {
                            const currentMessage = (toolCall.metadata?.message || '').trim();

                            // 1. Block exact duplicates across any step in this action
                            if (sentMessagesInAction.includes(currentMessage)) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Action-wide duplicate).`);
                                continue;
                            }

                            // 2. COMPLETION MESSAGE CONTRADICTION CHECK
                            // If the message claims completion but verification.goals_met is false, block it
                            const completionPhrases = [
                                'done', 'completed', 'finished', 'deployed', 'ready',
                                'successfully', 'all set', 'live now', 'published'
                            ];
                            const messageIndicatesCompletion = completionPhrases.some(phrase => 
                                currentMessage.toLowerCase().includes(phrase)
                            );
                            
                            if (messageIndicatesCompletion && !decision.verification?.goals_met) {
                                // Allow messages that contain questions - they're asking for input, not claiming done
                                const messageHasQuestion = currentMessage.includes('?') || this.messageContainsQuestion(currentMessage);
                                
                                // Allow messages that are actually reporting blockers/problems, not claiming success
                                const blockerPhrases = [
                                    "can't", "cannot", "unable", "couldn't", "not yet", "still pending",
                                    "need you to", "waiting for", "error", "failed", "problem",
                                    "issue", "blocked", "requires", "hold on", "not claimed",
                                    "before i can", "prerequisite", "first need", "however",
                                    "but", "although", "what would", "what do", "what should"
                                ];
                                const isReportingBlocker = blockerPhrases.some(phrase =>
                                    currentMessage.toLowerCase().includes(phrase)
                                );
                                
                                if (messageHasQuestion) {
                                    logger.info(`Agent: Allowing message through despite completion phrases — message contains a question (asking for input, not claiming done).`);
                                } else if (isReportingBlocker) {
                                    logger.info(`Agent: Allowing blocker-report message through despite completion phrases (goals_met=false but message reports a problem).`);
                                } else {
                                    logger.warn(`Agent: Blocked premature completion message in action ${action.id}. Message claims completion but goals_met=false. Message: "${currentMessage.slice(0, 100)}..."`);
                                    
                                    // Save to memory so the agent learns not to do this
                                    this.memory.saveMemory({
                                        id: `${action.id}-step-${currentStep}-blocked-premature-completion`,
                                        type: 'short',
                                        content: `[SYSTEM: BLOCKED premature completion message. You tried to tell the user the task is done, but verification.goals_met was false. This means you haven't actually completed the task yet. Continue working and only claim completion when goals_met=true.]`,
                                        metadata: { actionId: action.id, step: currentStep }
                                    });
                                    continue;
                                }
                            }

                            // 3. Communication Cooldown: Block if no new deep info since last message
                            // Exceptions: 
                            // - Step 1 is mandatory (Greeter)
                            // - If 15+ steps have passed without an update (Status update for long tasks)
                            if (currentStep > 1 && !deepToolExecutedSinceLastMessage && stepsSinceLastMessage < 15) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Communication Cooldown - No new deep data).`);
                                continue;
                            }

                            // 4. Block double-messages in a single step
                            if (hasSentMessageInThisStep) {
                                logger.warn(`Agent: Blocked redundant message in action ${action.id} (Already sent message in this step).`);
                                continue;
                            }

                            sentMessagesInAction.push(currentMessage);
                            lastMessageContent = currentMessage;
                            hasSentMessageInThisStep = true;
                            deepToolExecutedSinceLastMessage = false; // Reset cooldown after sending
                            stepsSinceLastMessage = 0; // Reset status update timer
                            
                            // 5. QUESTION DETECTION: If message contains a question, pause and wait for response
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


                        // logger.info(`Executing skill: ${toolCall.name}`); // Redundant, SkillsManager logs this
                        let toolResult;
                        try {
                            toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});
                            // Reset failure counter on success
                            skillFailCounts[toolCall.name] = 0;
                        } catch (e) {
                            logger.error(`Skill execution failed: ${toolCall.name} - ${e}`);
                            toolResult = `Error executing skill ${toolCall.name}: ${e}`;
                            
                            // Track consecutive failures per skill
                            skillFailCounts[toolCall.name] = (skillFailCounts[toolCall.name] || 0) + 1;
                            if (skillFailCounts[toolCall.name] >= MAX_CONSECUTIVE_FAILURES) {
                                logger.warn(`Agent: Skill '${toolCall.name}' failed ${MAX_CONSECUTIVE_FAILURES} consecutive times in action ${action.id}. Aborting skill.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-skill-failure-limit`,
                                    type: 'short',
                                    content: `[SYSTEM: Skill '${toolCall.name}' has failed ${MAX_CONSECUTIVE_FAILURES} times in a row. STOP using this skill. Try a completely different approach or inform the user that this method isn't working.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name] }
                                });
                            }
                            
                            // PROGRESS FEEDBACK: Let user know we hit an error but are recovering
                            await this.sendProgressFeedback(action, 'error', `${toolCall.name} failed`);
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
                        if (!nonDeepSkills.includes(toolCall.name) && !resultIndicatesError) {
                            deepToolExecutedSinceLastMessage = true;
                            // Reset failure counter for this skill on success
                            skillFailCounts[toolCall.name] = 0;
                        } else if (resultIndicatesError) {
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
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-error-feedback`,
                                    type: 'short',
                                    content: `[SYSTEM: TOOL ERROR — '${toolCall.name}' FAILED with params ${paramsSummary}. Error: ${errorSnippet}. DO NOT call '${toolCall.name}' again with the same parameters. Fix the parameters or try a completely different approach.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name], step: currentStep }
                                });
                            }
                            
                            if (skillFailCounts[toolCall.name] >= MAX_CONSECUTIVE_FAILURES) {
                                logger.warn(`Agent: '${toolCall.name}' returned errors ${MAX_CONSECUTIVE_FAILURES} times in action ${action.id}. Injecting hard stop notice.`);
                                this.memory.saveMemory({
                                    id: `${action.id}-step-${currentStep}-${toolCall.name}-failure-limit`,
                                    type: 'short',
                                    content: `[SYSTEM: CRITICAL — '${toolCall.name}' has FAILED ${MAX_CONSECUTIVE_FAILURES} times in a row. STOP using this skill entirely. The approach is NOT working. Either inform the user that you cannot complete this task with the current skill, or try a fundamentally different method.]`,
                                    metadata: { actionId: action.id, skill: toolCall.name, failures: skillFailCounts[toolCall.name] }
                                });
                            }
                        }

                        let observation: string;
                        if (resultIndicatesError) {
                            const errorDetail = hasStructuredResult && toolResult.error 
                                ? toolResult.error 
                                : resultString.slice(0, 400);
                            observation = `⚠️ TOOL ERROR: ${toolCall.name} FAILED — ${errorDetail}`;
                        } else if (hasStructuredResult && toolResult.success === true) {
                            observation = `✅ Tool ${toolCall.name} succeeded: ${resultString.slice(0, 500)}`;
                        } else {
                            observation = `Observation: Tool ${toolCall.name} returned: ${resultString.slice(0, 500)}`;
                        }
                        if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_gateway_chat' || toolCall.name === 'send_discord') {
                            messagesSent++;
                            
                            // QUESTION PAUSE: If this message asked a question, pause and wait for response
                            const sentMessage = toolCall.metadata?.message || '';
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

                        // HARD BREAK after scheduling to prevent loops
                        if (toolCall.name === 'schedule_task') {
                            logger.info(`Agent: Task scheduled for action ${action.id}. Terminating sequence.`);
                            forceBreak = true;
                            break;
                        }

                        // HARD BREAK after successful channel message send for "respond to" tasks
                        // This prevents duplicate messages when the LLM doesn't set goals_met correctly
                        const isChannelSend = ['send_telegram', 'send_whatsapp', 'send_discord', 'send_gateway_chat'].includes(toolCall.name);
                        const isResponseTask = action.payload?.description?.toLowerCase().includes('respond to') ||
                                               action.payload?.requiresResponse === true;
                        const wasSuccessful = toolResult && !JSON.stringify(toolResult).toLowerCase().includes('error');
                        
                        if (isChannelSend && isResponseTask && wasSuccessful) {
                            logger.info(`Agent: Channel message sent for response task ${action.id}. Terminating to prevent duplicates.`);
                            forceBreak = true;
                            break;
                        }
                    }

                    // NOW check goals_met AFTER tools have been executed
                    if (decision.verification?.goals_met) {
                        logger.info(`Agent: Strategic goal satisfied after execution. Terminating action ${action.id}.`);
                        break;
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
                        logger.warn(`Agent: LLM returned goals_met=false but no tools. Retry ${noToolsRetryCount}/${MAX_NO_TOOLS_RETRIES}...`);
                        
                        this.memory.saveMemory({
                            id: `${action.id}-step-${currentStep}-no-tools-error`,
                            type: 'short',
                            content: `[SYSTEM: You said goals_met=false but provided NO TOOLS. This is INVALID. If goals are not met, you MUST include at least one tool to make progress. Re-read the task and provide the appropriate tool calls.]`,
                            metadata: { actionId: action.id, step: currentStep, error: 'no_tools_but_goals_not_met' }
                        });
                        
                        continue;
                    }
                    
                    // Case 3: goals_met=true or undefined with no tools - legitimate termination
                    logger.info(`Agent: Action ${action.id} reached self-termination. Reasoning: ${decision.reasoning || 'No further tools needed.'}`);
                    break;
                }
            }

            // If we exhausted all steps, review before giving up
            if (currentStep >= MAX_STEPS) {
                logger.warn(`Agent: Reached max steps (${MAX_STEPS}) for action ${action.id}. Reviewing if task is truly done...`);
                
                const maxStepsReview = await this.reviewForcedTermination(
                    action, 'max_steps', currentStep,
                    `Reached max steps (${MAX_STEPS}). The agent may have made progress but not delivered results yet.`
                );
                
                if (maxStepsReview === 'continue') {
                    // Give the agent a few more steps to compile and deliver results
                    logger.info(`Agent: Review layer says task isn't done. Granting ${Math.min(5, MAX_STEPS)} bonus steps to wrap up.`);
                    this.memory.saveMemory({
                        id: `${action.id}-step-${currentStep}-max-steps-extension`,
                        type: 'short',
                        content: `[SYSTEM: You have used all ${MAX_STEPS} steps. You are getting a FEW BONUS STEPS to wrap up. IMMEDIATELY compile everything you have gathered and send a FINAL comprehensive message to the user. Do NOT start new research — deliver what you have NOW.]`,
                        metadata: { actionId: action.id, step: currentStep }
                    });
                    // Grant up to 5 bonus steps for wrapping up
                    const bonusSteps = Math.min(5, MAX_STEPS);
                    // Continue the loop for bonus steps (simple approach: just don't break, 
                    // but we need to adjust MAX_STEPS since the while loop already exited)
                    // We'll run a mini-loop here
                    for (let bonus = 0; bonus < bonusSteps; bonus++) {
                        currentStep++;
                        logger.info(`Agent: Bonus step ${bonus + 1}/${bonusSteps} for action ${action.id}`);
                        
                        try {
                            const bonusDecision = await ErrorHandler.withRetry(async () => {
                                return await this.decisionEngine.decide({
                                    ...action,
                                    payload: {
                                        ...action.payload,
                                        messagesSent,
                                        messagingLocked: true,
                                        currentStep,
                                        executionPlan
                                    }
                                });
                            }, { maxRetries: 2, initialDelay: 1000 });
                            
                            if (!bonusDecision?.tools?.length) {
                                logger.info(`Agent: No tools in bonus step. Wrapping up.`);
                                break;
                            }
                            
                            for (const toolCall of bonusDecision.tools) {
                                try {
                                    const toolResult = await this.skills.executeSkill(toolCall.name, toolCall.metadata || {});
                                    if (toolCall.name === 'send_telegram' || toolCall.name === 'send_whatsapp' || toolCall.name === 'send_discord' || toolCall.name === 'send_gateway_chat') {
                                        messagesSent++;
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
                            
                            if (bonusDecision.verification?.goals_met) {
                                logger.info(`Agent: Goals met during bonus steps. Done.`);
                                break;
                            }
                        } catch (e) {
                            logger.error(`Bonus step decision failed: ${e}`);
                            break;
                        }
                    }
                } else {
                    await this.sendProgressFeedback(action, 'recovering', `Reached the step limit (${MAX_STEPS}). I couldn't complete this task — it may need a different approach or manual help.`);
                }
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

            // Record Final Response/Reasoning in Memory upon completion
            this.memory.saveMemory({
                id: `${action.id}-conclusion`,
                type: 'episodic',
                content: `Task Finished: ${action.payload.description}. Current status marked as completed.`,
                metadata: { actionId: action.id, steps: currentStep }
            });

            this.actionQueue.updateStatus(action.id, 'completed');
        } catch (error: any) {
            logger.error(`Error processing action ${action.id}: ${error}`);
            this.actionQueue.updateStatus(action.id, 'failed');

            // SOS Notification
            const sosMessage = `⚠️ *Action Failed*: I encountered a persistent error while processing your request: "${action.payload.description}"\n\n*Error*: ${error.message}`;

            if (this.telegram && action.payload.source === 'telegram') {
                await this.telegram.sendMessage(action.payload.sourceId, sosMessage + `\n\nI've logged this to my journal and will attempt to recover in the next turn.`);
            } else if (this.whatsapp && action.payload.source === 'whatsapp') {
                await this.whatsapp.sendMessage(action.payload.sourceId, sosMessage);
            }
        } finally {
            this.isBusy = false;
            this.currentActionId = null;
            this.currentActionStartAt = null;

            // BACKGROUND TASK: Memory Consolidation
            // We do this in the background after the agent is marked as not busy
            // to prevent blocking the next task.
            this.memory.consolidate(this.llm).catch(e => {
                logger.error(`Background Memory Consolidation Error: ${e}`);
            });
        }
    }
}
