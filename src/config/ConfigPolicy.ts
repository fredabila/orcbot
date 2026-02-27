/**
 * ConfigPolicy - Defines which configuration options can be safely modified by agents
 * and which require human approval or are completely locked.
 */

export enum ConfigChangeLevel {
    SAFE = 'safe',           // Agent can modify without approval
    APPROVAL = 'approval',   // Agent can suggest, requires approval
    LOCKED = 'locked'        // Agent cannot modify at all
}

export interface ConfigPolicyRule {
    key: string;
    level: ConfigChangeLevel;
    description: string;
    validation?: (value: any) => boolean;
    reason?: string;  // Why this level is set
}

/**
 * Defines the policy for each configuration option
 */
export class ConfigPolicy {
    private static policies: Map<string, ConfigPolicyRule> = new Map([
        // SAFE - Agent can modify these autonomously
        ['modelName', {
            key: 'modelName',
            level: ConfigChangeLevel.SAFE,
            description: 'Primary LLM model name',
            reason: 'Agents can switch models to optimize for different tasks',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['llmProvider', {
            key: 'llmProvider',
            level: ConfigChangeLevel.SAFE,
            description: 'LLM provider selection',
            reason: 'Agents can switch providers based on availability and task requirements',
            validation: (value: any) => ['openai', 'google', 'bedrock', 'openrouter', 'nvidia', 'anthropic', 'ollama'].includes(value)
        }],
        ['ollamaApiUrl', {
            key: 'ollamaApiUrl',
            level: ConfigChangeLevel.SAFE,
            description: 'Local Ollama API URL',
            reason: 'Non-sensitive endpoint configuration',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['memoryContextLimit', {
            key: 'memoryContextLimit',
            level: ConfigChangeLevel.SAFE,
            description: 'Number of recent memories in context',
            reason: 'Agents can adjust memory context to optimize performance',
            validation: (value: any) => typeof value === 'number' && value > 0 && value <= 100
        }],
        ['memoryEpisodicLimit', {
            key: 'memoryEpisodicLimit',
            level: ConfigChangeLevel.SAFE,
            description: 'Number of episodic summaries to include',
            reason: 'Agents can adjust episodic memory for better context',
            validation: (value: any) => typeof value === 'number' && value > 0 && value <= 20
        }],
        ['stepCompactionExpandOnDemand', {
            key: 'stepCompactionExpandOnDemand',
            level: ConfigChangeLevel.SAFE,
            description: 'Expand compacted middle step history for continuity-heavy tasks',
            reason: 'Non-sensitive context shaping behavior',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['stepCompactionExpansionMaxMiddleSteps', {
            key: 'stepCompactionExpansionMaxMiddleSteps',
            level: ConfigChangeLevel.SAFE,
            description: 'Maximum number of middle steps to expand on continuity intent',
            reason: 'Non-sensitive context sizing control',
            validation: (value: any) => typeof value === 'number' && value >= 1 && value <= 50
        }],
        ['stepCompactionExpansionMaxChars', {
            key: 'stepCompactionExpansionMaxChars',
            level: ConfigChangeLevel.SAFE,
            description: 'Maximum characters reserved for expanded middle-step context',
            reason: 'Non-sensitive context sizing control',
            validation: (value: any) => typeof value === 'number' && value >= 400 && value <= 20000
        }],
        ['memoryInteractionBatchSize', {
            key: 'memoryInteractionBatchSize',
            level: ConfigChangeLevel.SAFE,
            description: 'Batch size for scoped short→episodic interaction consolidation',
            reason: 'Non-sensitive memory quality tuning',
            validation: (value: any) => typeof value === 'number' && value >= 4 && value <= 100
        }],
        ['memoryInteractionStaleMinutes', {
            key: 'memoryInteractionStaleMinutes',
            level: ConfigChangeLevel.SAFE,
            description: 'Max stale minutes before pending interaction batch is consolidated',
            reason: 'Non-sensitive memory durability tuning',
            validation: (value: any) => typeof value === 'number' && value >= 1 && value <= 180
        }],
        ['memoryDedupWindowMinutes', {
            key: 'memoryDedupWindowMinutes',
            level: ConfigChangeLevel.SAFE,
            description: 'Deduplication window for duplicate inbound memory events',
            reason: 'Non-sensitive reliability tuning for webhook retries',
            validation: (value: any) => typeof value === 'number' && value >= 1 && value <= 120
        }],
        ['userExchangeContextLimit', {
            key: 'userExchangeContextLimit',
            level: ConfigChangeLevel.SAFE,
            description: 'Scoped user exchange count injected into decisions',
            reason: 'Non-sensitive context sizing control',
            validation: (value: any) => typeof value === 'number' && value >= 3 && value <= 30
        }],
        ['maxStepsPerAction', {
            key: 'maxStepsPerAction',
            level: ConfigChangeLevel.SAFE,
            description: 'Maximum steps per action',
            reason: 'Agents can adjust complexity limits based on task needs',
            validation: (value: any) => typeof value === 'number' && value >= 5 && value <= 100
        }],
        ['maxMessagesPerAction', {
            key: 'maxMessagesPerAction',
            level: ConfigChangeLevel.SAFE,
            description: 'Maximum user-facing messages per action',
            reason: 'Agents can adjust delivery budget for long-running tasks and verbose progress updates',
            validation: (value: any) => typeof value === 'number' && value >= 3 && value <= 100
        }],
        ['progressFeedbackEnabled', {
            key: 'progressFeedbackEnabled',
            level: ConfigChangeLevel.SAFE,
            description: 'Enable progress feedback messages',
            reason: 'Agents can adjust feedback verbosity',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['progressFeedbackTypingOnly', {
            key: 'progressFeedbackTypingOnly',
            level: ConfigChangeLevel.SAFE,
            description: 'Use typing indicators instead of sending progress status messages',
            reason: 'Agents can reduce channel noise while preserving feedback via typing indicators',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['enforceExplicitFileRequestForSendFile', {
            key: 'enforceExplicitFileRequestForSendFile',
            level: ConfigChangeLevel.SAFE,
            description: 'Require explicit user request before send_file is allowed',
            reason: 'Agents can tune delivery strictness for file attachments',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['searchProviderOrder', {
            key: 'searchProviderOrder',
            level: ConfigChangeLevel.SAFE,
            description: 'Order of search providers to try',
            reason: 'Agents can optimize search provider selection',
            validation: (value: any) => Array.isArray(value)
        }],
        ['browserDebugAlwaysSave', {
            key: 'browserDebugAlwaysSave',
            level: ConfigChangeLevel.SAFE,
            description: 'Save browser debug artifacts on every snapshot/navigation',
            reason: 'Non-sensitive diagnostic setting',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['browserTraceEnabled', {
            key: 'browserTraceEnabled',
            level: ConfigChangeLevel.SAFE,
            description: 'Enable Playwright tracing for browser sessions',
            reason: 'Non-sensitive diagnostic setting',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['browserTraceDir', {
            key: 'browserTraceDir',
            level: ConfigChangeLevel.SAFE,
            description: 'Output directory for browser traces',
            reason: 'Non-sensitive path setting',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['browserTraceScreenshots', {
            key: 'browserTraceScreenshots',
            level: ConfigChangeLevel.SAFE,
            description: 'Include screenshots in trace output',
            reason: 'Non-sensitive diagnostic setting',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['browserTraceSnapshots', {
            key: 'browserTraceSnapshots',
            level: ConfigChangeLevel.SAFE,
            description: 'Include DOM snapshots in trace output',
            reason: 'Non-sensitive diagnostic setting',
            validation: (value: any) => typeof value === 'boolean'
        }],

        // APPROVAL - Agent can suggest, but needs approval
        ['openaiApiKey', {
            key: 'openaiApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'OpenAI API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.startsWith('sk-')
        }],
        ['googleApiKey', {
            key: 'googleApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Google API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['nvidiaApiKey', {
            key: 'nvidiaApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'NVIDIA API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['anthropicApiKey', {
            key: 'anthropicApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Anthropic API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.startsWith('sk-ant-')
        }],
        ['openrouterApiKey', {
            key: 'openrouterApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'OpenRouter API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['braveSearchApiKey', {
            key: 'braveSearchApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Brave Search API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['serperApiKey', {
            key: 'serperApiKey',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Serper API key',
            reason: 'API keys are sensitive and should be approved',
            validation: (value: any) => typeof value === 'string' && value.length > 0
        }],
        ['autonomyEnabled', {
            key: 'autonomyEnabled',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Enable autonomous operation',
            reason: 'Autonomy mode should be explicitly approved',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['autonomyInterval', {
            key: 'autonomyInterval',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Autonomous operation interval in minutes',
            reason: 'Autonomy settings affect system behavior significantly',
            validation: (value: any) => typeof value === 'number' && value >= 1
        }],
        ['workerPoolAllowAutonomyDuringUserWork', {
            key: 'workerPoolAllowAutonomyDuringUserWork',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Allow autonomy lane to keep running while user lane is busy',
            reason: 'Parallel autonomy can increase throughput but may compete for LLM/tool resources',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['skillRoutingRules', {
            key: 'skillRoutingRules',
            level: ConfigChangeLevel.APPROVAL,
            description: 'Skill routing rules configuration',
            reason: 'Routing rules can affect which tools are used',
            validation: (value: any) => Array.isArray(value)
        }],

        // LOCKED - Agent cannot modify
        ['telegramToken', {
            key: 'telegramToken',
            level: ConfigChangeLevel.LOCKED,
            description: 'Telegram bot token',
            reason: 'Critical authentication credential',
        }],
        ['slackBotToken', {
            key: 'slackBotToken',
            level: ConfigChangeLevel.LOCKED,
            description: 'Slack bot token',
            reason: 'Critical authentication credential',
        }],
        ['slackAppToken', {
            key: 'slackAppToken',
            level: ConfigChangeLevel.LOCKED,
            description: 'Slack app token (Socket Mode)',
            reason: 'Critical authentication credential',
        }],
        ['slackSigningSecret', {
            key: 'slackSigningSecret',
            level: ConfigChangeLevel.LOCKED,
            description: 'Slack signing secret',
            reason: 'Critical authentication credential',
        }],
        ['whatsappEnabled', {
            key: 'whatsappEnabled',
            level: ConfigChangeLevel.LOCKED,
            description: 'WhatsApp channel enabled',
            reason: 'Channel configuration affects system architecture',
        }],
        ['commandDenyList', {
            key: 'commandDenyList',
            level: ConfigChangeLevel.LOCKED,
            description: 'Denied commands list',
            reason: 'Security-critical configuration',
        }],
        ['safeMode', {
            key: 'safeMode',
            level: ConfigChangeLevel.LOCKED,
            description: 'Safe mode enabled',
            reason: 'Security-critical configuration',
        }],
        ['enableSelfModification', {
            key: 'enableSelfModification',
            level: ConfigChangeLevel.LOCKED,
            description: 'Allow agent to modify its own source code',
            reason: 'Security-critical — grants the agent access to its own implementation',
        }],
        ['sudoMode', {
            key: 'sudoMode',
            level: ConfigChangeLevel.LOCKED,
            description: 'Sudo mode enabled',
            reason: 'Security-critical configuration',
        }],
        ['overrideMode', {
            key: 'overrideMode',
            level: ConfigChangeLevel.LOCKED,
            description: 'Behavioral override mode',
            reason: 'Security-critical configuration — bypasses persona boundaries',
        }],
        ['bedrockAccessKeyId', {
            key: 'bedrockAccessKeyId',
            level: ConfigChangeLevel.LOCKED,
            description: 'AWS Bedrock access key',
            reason: 'Critical authentication credential',
        }],
        ['bedrockSecretAccessKey', {
            key: 'bedrockSecretAccessKey',
            level: ConfigChangeLevel.LOCKED,
            description: 'AWS Bedrock secret key',
            reason: 'Critical authentication credential',
        }],
        ['adminUsers', {
            key: 'adminUsers',
            level: ConfigChangeLevel.LOCKED,
            description: 'Admin user allowlists per channel',
            reason: 'Security-critical — controls who can issue elevated commands via channels',
        }],
        ['imageGenProvider', {
            key: 'imageGenProvider',
            level: ConfigChangeLevel.SAFE,
            description: 'Image generation provider',
            reason: 'Non-critical preference setting',
        }],
        ['imageGenModel', {
            key: 'imageGenModel',
            level: ConfigChangeLevel.SAFE,
            description: 'Image generation model name',
            reason: 'Non-critical preference setting',
        }],
    ]);

    /**
     * Get the policy for a configuration key
     */
    static getPolicy(key: string): ConfigPolicyRule | undefined {
        return this.policies.get(key);
    }

    /**
     * Check if a configuration key can be safely modified by an agent
     */
    static canAutoModify(key: string): boolean {
        const policy = this.policies.get(key);
        if (!policy) {
            // Unknown keys default to requiring approval
            return false;
        }
        return policy.level === ConfigChangeLevel.SAFE;
    }

    /**
     * Check if a configuration key requires approval
     */
    static requiresApproval(key: string): boolean {
        const policy = this.policies.get(key);
        if (!policy) {
            // Unknown keys default to requiring approval
            return true;
        }
        return policy.level === ConfigChangeLevel.APPROVAL;
    }

    /**
     * Check if a configuration key is locked (cannot be modified by agent)
     */
    static isLocked(key: string): boolean {
        const policy = this.policies.get(key);
        if (!policy) {
            // Unknown keys default to requiring approval (not locked)
            return false;
        }
        return policy.level === ConfigChangeLevel.LOCKED;
    }

    /**
     * Validate a configuration value
     */
    static validate(key: string, value: any): { valid: boolean; error?: string } {
        const policy = this.policies.get(key);
        if (!policy) {
            return { valid: false, error: 'Unknown configuration key' };
        }

        if (policy.validation) {
            const isValid = policy.validation(value);
            return {
                valid: isValid,
                error: isValid ? undefined : `Validation failed for ${key}`
            };
        }

        // No validation function means any value is acceptable
        return { valid: true };
    }

    /**
     * Get all safe configuration keys
     */
    static getSafeKeys(): string[] {
        return Array.from(this.policies.entries())
            .filter(([, policy]) => policy.level === ConfigChangeLevel.SAFE)
            .map(([key]) => key);
    }

    /**
     * Get all approval configuration keys
     */
    static getApprovalKeys(): string[] {
        return Array.from(this.policies.entries())
            .filter(([, policy]) => policy.level === ConfigChangeLevel.APPROVAL)
            .map(([key]) => key);
    }

    /**
     * Get all locked configuration keys
     */
    static getLockedKeys(): string[] {
        return Array.from(this.policies.entries())
            .filter(([, policy]) => policy.level === ConfigChangeLevel.LOCKED)
            .map(([key]) => key);
    }

    /**
     * Get human-readable description of all policies
     */
    static getPolicyDescription(): string {
        let description = '=== Configuration Policy ===\n\n';
        
        description += '** SAFE (Agent can modify) **\n';
        this.getSafeKeys().forEach(key => {
            const policy = this.policies.get(key)!;
            description += `- ${key}: ${policy.description}\n  Reason: ${policy.reason}\n`;
        });

        description += '\n** REQUIRES APPROVAL **\n';
        this.getApprovalKeys().forEach(key => {
            const policy = this.policies.get(key)!;
            description += `- ${key}: ${policy.description}\n  Reason: ${policy.reason}\n`;
        });

        description += '\n** LOCKED (Agent cannot modify) **\n';
        this.getLockedKeys().forEach(key => {
            const policy = this.policies.get(key)!;
            description += `- ${key}: ${policy.description}\n  Reason: ${policy.reason}\n`;
        });

        return description;
    }
}
