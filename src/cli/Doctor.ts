import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';

export type DoctorSeverity = 'info' | 'warn' | 'critical';

export interface DoctorFinding {
    id: string;
    severity: DoctorSeverity;
    title: string;
    message: string;
    recommendation?: string;
    area: 'gateway' | 'security' | 'channels' | 'providers' | 'storage' | 'runtime';
}

export interface DoctorReport {
    checkedAt: string;
    summary: {
        critical: number;
        warn: number;
        info: number;
        ok: number;
    };
    facts: {
        dataHome: string;
        configPath?: string;
        gatewayHost: string;
        gatewayPort: number;
        gatewayAuthEnabled: boolean;
        channelsConfigured: string[];
        providersConfigured: string[];
        runtime: {
            lockFilePresent: boolean;
            agentRunning: boolean;
            daemonPidFilePresent: boolean;
            daemonRunning: boolean;
        };
    };
    findings: DoctorFinding[];
}

function isLoopbackHost(host: string): boolean {
    const normalized = String(host || '').trim().toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function hasConfiguredProvider(config: ConfigManager, provider: string): boolean {
    switch (provider) {
        case 'openai':
            return !!config.get('openaiApiKey');
        case 'google':
            return !!config.get('googleApiKey');
        case 'openrouter':
            return !!config.get('openrouterApiKey');
        case 'nvidia':
            return !!config.get('nvidiaApiKey');
        case 'anthropic':
            return !!config.get('anthropicApiKey');
        case 'bedrock':
            return !!config.get('bedrockRegion') && !!config.get('bedrockAccessKeyId') && !!config.get('bedrockSecretAccessKey');
        case 'ollama':
            return config.get('ollamaEnabled') === true;
        default:
            return false;
    }
}

function getConfiguredProviders(config: ConfigManager): string[] {
    const candidates = ['openai', 'google', 'openrouter', 'nvidia', 'anthropic', 'bedrock', 'ollama'];
    return candidates.filter(provider => hasConfiguredProvider(config, provider));
}

function getConfiguredChannels(config: ConfigManager): string[] {
    const configured: string[] = [];
    if (config.get('telegramToken')) configured.push('telegram');
    if (config.get('whatsappEnabled') === true) configured.push('whatsapp');
    if (config.get('discordToken')) configured.push('discord');
    if (config.get('slackBotToken')) configured.push('slack');
    if (config.get('emailEnabled') === true) configured.push('email');
    return configured;
}

function addFinding(findings: DoctorFinding[], finding: DoctorFinding): void {
    findings.push(finding);
}

function processExists(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readJsonFile(filePath: string): any | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function readPidFile(filePath: string): number | null {
    try {
        const value = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

export function collectDoctorReport(config: ConfigManager, options?: { deep?: boolean }): DoctorReport {
    const findings: DoctorFinding[] = [];
    const dataHome = config.getDataHome();
    const lockPath = path.join(dataHome, 'orcbot.lock');
    const daemonPidPath = path.join(dataHome, 'orcbot.pid');
    const gatewayHost = String(config.get('gatewayHost') || '0.0.0.0');
    const gatewayPort = Number(config.get('gatewayPort') || 3100);
    const gatewayApiKey = String(config.get('gatewayApiKey') || '');
    const gatewayCorsOrigins = Array.isArray(config.get('gatewayCorsOrigins')) ? (config.get('gatewayCorsOrigins') as string[]) : ['*'];
    const configuredChannels = getConfiguredChannels(config);
    const configuredProviders = getConfiguredProviders(config);
    const modelName = String(config.get('modelName') || '');
    const llmProvider = String(config.get('llmProvider') || '').trim();
    const safeMode = config.get('safeMode') === true;
    const sudoMode = config.get('sudoMode') === true;
    const autoExecuteCommands = config.get('autoExecuteCommands') === true;
    const sessionScope = String(config.get('sessionScope') || 'per-channel-peer');
    const pluginAllowList = Array.isArray(config.get('pluginAllowList')) ? (config.get('pluginAllowList') as string[]) : [];
    const pluginDenyList = Array.isArray(config.get('pluginDenyList')) ? (config.get('pluginDenyList') as string[]) : [];
    const pluginsPathRaw = String(config.get('pluginsPath') || '').trim();
    const pluginsPath = pluginsPathRaw ? path.resolve(pluginsPathRaw) : path.join(dataHome, 'plugins');
    const lockFilePresent = fs.existsSync(lockPath);
    const daemonPidFilePresent = fs.existsSync(daemonPidPath);
    const lockData = lockFilePresent ? readJsonFile(lockPath) : null;
    const lockPid = Number(lockData?.pid || 0);
    const agentRunning = processExists(lockPid);
    const daemonPid = daemonPidFilePresent ? readPidFile(daemonPidPath) : null;
    const daemonRunning = processExists(Number(daemonPid || 0));

    if (!fs.existsSync(dataHome)) {
        addFinding(findings, {
            id: 'storage.data_home_missing',
            severity: 'critical',
            title: 'Data home is missing',
            message: `Configured data home does not exist: ${dataHome}`,
            recommendation: 'Create the data directory or fix ORCBOT_DATA_DIR / config path resolution.',
            area: 'storage'
        });
    }

    if (lockFilePresent && !agentRunning) {
        addFinding(findings, {
            id: 'runtime.stale_lock_file',
            severity: 'warn',
            title: 'Agent lock file appears stale',
            message: `Found ${lockPath} but the recorded PID is not running.`,
            recommendation: 'Clear the stale lock with orcbot stop or remove the file after verifying OrcBot is not active.',
            area: 'runtime'
        });
    }

    if (lockFilePresent && lockData && (!lockData.startedAt || !lockData.host || !lockData.cwd)) {
        addFinding(findings, {
            id: 'runtime.lock_file_incomplete',
            severity: 'info',
            title: 'Agent lock file is missing metadata',
            message: `The lock file at ${lockPath} is present but missing one or more metadata fields (startedAt, host, cwd).`,
            recommendation: 'Restart OrcBot to refresh the runtime lock metadata if you rely on status tooling.',
            area: 'runtime'
        });
    }

    if (daemonPidFilePresent && !daemonRunning) {
        addFinding(findings, {
            id: 'runtime.stale_daemon_pid_file',
            severity: 'warn',
            title: 'Daemon PID file appears stale',
            message: `Found ${daemonPidPath} but the recorded daemon PID is not running.`,
            recommendation: 'Run orcbot daemon status or remove the stale PID file after confirming the daemon is stopped.',
            area: 'runtime'
        });
    }

    if (agentRunning && daemonRunning && lockPid && daemonPid && lockPid !== daemonPid) {
        addFinding(findings, {
            id: 'runtime.multiple_process_markers',
            severity: 'info',
            title: 'Separate agent and daemon process markers detected',
            message: `The main lock file PID (${lockPid}) and daemon PID (${daemonPid}) both appear active.`,
            recommendation: 'Confirm this is intentional and that only one operator control path is managing the instance.',
            area: 'runtime'
        });
    }

    if (!gatewayApiKey && !isLoopbackHost(gatewayHost)) {
        addFinding(findings, {
            id: 'gateway.bind_no_auth',
            severity: 'critical',
            title: 'Gateway is exposed without auth',
            message: `Gateway host ${gatewayHost}:${gatewayPort} is non-loopback and no gatewayApiKey is configured.`,
            recommendation: 'Set gatewayApiKey and prefer loopback or private-network exposure only.',
            area: 'gateway'
        });
    }

    if (gatewayApiKey && gatewayApiKey.length < 16) {
        addFinding(findings, {
            id: 'gateway.auth_weak_token',
            severity: 'warn',
            title: 'Gateway API key looks short',
            message: 'gatewayApiKey is configured but appears shorter than 16 characters.',
            recommendation: 'Rotate to a long random token before exposing the gateway remotely.',
            area: 'gateway'
        });
    }

    if (!gatewayApiKey && isLoopbackHost(gatewayHost)) {
        addFinding(findings, {
            id: 'gateway.loopback_no_auth',
            severity: 'info',
            title: 'Gateway is local-only without auth',
            message: 'Loopback-only gateway without auth can be acceptable for single-machine development.',
            recommendation: 'Add gatewayApiKey before reverse proxying, tunneling, or binding to non-loopback interfaces.',
            area: 'gateway'
        });
    }

    if (gatewayCorsOrigins.includes('*') && !isLoopbackHost(gatewayHost)) {
        addFinding(findings, {
            id: 'gateway.cors_wildcard_remote',
            severity: 'warn',
            title: 'Wildcard CORS on remote gateway',
            message: 'gatewayCorsOrigins includes "*" while the gateway is configured for non-loopback access.',
            recommendation: 'Restrict gatewayCorsOrigins to explicit trusted origins for remote dashboard/API use.',
            area: 'gateway'
        });
    }

    if (sudoMode) {
        addFinding(findings, {
            id: 'security.sudo_mode_enabled',
            severity: 'critical',
            title: 'Sudo mode is enabled',
            message: 'sudoMode bypasses command allow-list protections and expands tool blast radius.',
            recommendation: 'Disable sudoMode unless you are actively supervising a trusted local debugging session.',
            area: 'security'
        });
    }

    if (autoExecuteCommands && !safeMode) {
        addFinding(findings, {
            id: 'security.auto_execute_commands',
            severity: 'critical',
            title: 'Auto command execution is enabled',
            message: 'autoExecuteCommands is enabled while safeMode is off, allowing unattended command execution.',
            recommendation: 'Disable autoExecuteCommands or enable safeMode for untrusted or shared inboxes.',
            area: 'security'
        });
    }

    if (sessionScope === 'main' && configuredChannels.length > 0) {
        addFinding(findings, {
            id: 'security.session_scope_main',
            severity: 'warn',
            title: 'Main shared session scope is enabled',
            message: 'sessionScope is set to main, which can mix context across users or channels.',
            recommendation: 'Use per-channel-peer for safer multi-user or multi-channel deployments.',
            area: 'security'
        });
    }

    if (configuredChannels.length === 0) {
        addFinding(findings, {
            id: 'channels.none_configured',
            severity: 'info',
            title: 'No external channels configured',
            message: 'Telegram, WhatsApp, Discord, Slack, and Email are all currently disabled or unconfigured.',
            recommendation: 'This is fine for local-only usage; configure at least one channel for messaging workflows.',
            area: 'channels'
        });
    }

    if (configuredProviders.length === 0) {
        addFinding(findings, {
            id: 'providers.none_configured',
            severity: 'critical',
            title: 'No LLM providers configured',
            message: 'No provider API keys or local provider flags were detected.',
            recommendation: 'Configure at least one provider such as OpenAI, Google, OpenRouter, Anthropic, NVIDIA, Bedrock, or Ollama.',
            area: 'providers'
        });
    }

    if (llmProvider && !hasConfiguredProvider(config, llmProvider)) {
        addFinding(findings, {
            id: 'providers.selected_provider_unconfigured',
            severity: 'critical',
            title: 'Selected provider is not configured',
            message: `llmProvider is set to ${llmProvider} but the corresponding credentials/settings are missing.`,
            recommendation: 'Add the provider credentials or change llmProvider to a configured provider.',
            area: 'providers'
        });
    }

    if (/gpt-3\.5|3\.5-turbo|llama.?3.?8b|8b|mini$/i.test(modelName) && (configuredChannels.length > 0 || autoExecuteCommands || !safeMode)) {
        addFinding(findings, {
            id: 'providers.weak_model_for_tooling',
            severity: 'warn',
            title: 'Model may be weak for tool-enabled operation',
            message: `Configured model "${modelName}" may be too weak for reliable tool use or adversarial inputs.`,
            recommendation: 'Prefer a stronger current-generation model for channel-connected or tool-enabled operation.',
            area: 'providers'
        });
    }

    if (fs.existsSync(pluginsPath)) {
        const pluginFiles = fs.readdirSync(pluginsPath).filter(name => /\.(js|cjs|mjs|ts)$/.test(name));
        if (pluginFiles.length > 0 && pluginAllowList.length === 0 && pluginDenyList.length === 0) {
            addFinding(findings, {
                id: 'security.plugins_unrestricted',
                severity: 'warn',
                title: 'Plugins are present without allow/deny policy',
                message: `${pluginFiles.length} plugin file(s) were found in ${pluginsPath} and plugin policy lists are empty.`,
                recommendation: 'Review plugin code and set pluginAllowList or pluginDenyList for tighter control.',
                area: 'security'
            });
        }
    }

    if (options?.deep) {
        const importantFiles = [
            path.join(dataHome, 'orcbot.config.yaml'),
            path.join(dataHome, 'memory.json'),
            path.join(dataHome, 'action_queue.json')
        ];

        for (const filePath of importantFiles) {
            if (!fs.existsSync(filePath)) {
                addFinding(findings, {
                    id: `storage.missing.${path.basename(filePath)}`,
                    severity: 'info',
                    title: 'Expected state file is not present yet',
                    message: `State/config file not found: ${filePath}`,
                    recommendation: 'This can be normal on a fresh install. If unexpected, start OrcBot once to initialize state.',
                    area: 'storage'
                });
            }
        }

        const daemonLogPath = path.join(dataHome, 'daemon.log');
        if (daemonRunning && !fs.existsSync(daemonLogPath)) {
            addFinding(findings, {
                id: 'runtime.daemon_log_missing',
                severity: 'info',
                title: 'Daemon is running without a visible daemon log file',
                message: `The daemon PID is active but ${daemonLogPath} was not found.`,
                recommendation: 'Verify daemon logging configuration if you expect file-backed logs for background operation.',
                area: 'runtime'
            });
        }
    }

    const critical = findings.filter(f => f.severity === 'critical').length;
    const warn = findings.filter(f => f.severity === 'warn').length;
    const info = findings.filter(f => f.severity === 'info').length;
    const ok = Math.max(0, 8 - critical - warn);

    return {
        checkedAt: new Date().toISOString(),
        summary: { critical, warn, info, ok },
        facts: {
            dataHome,
            configPath: path.join(dataHome, 'orcbot.config.yaml'),
            gatewayHost,
            gatewayPort,
            gatewayAuthEnabled: !!gatewayApiKey,
            channelsConfigured: configuredChannels,
            providersConfigured: configuredProviders,
            runtime: {
                lockFilePresent,
                agentRunning,
                daemonPidFilePresent,
                daemonRunning
            }
        },
        findings
    };
}