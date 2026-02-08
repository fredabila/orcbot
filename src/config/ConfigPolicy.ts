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
            validation: (value: any) => ['openai', 'google', 'bedrock', 'openrouter', 'nvidia', 'anthropic'].includes(value)
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
        ['maxStepsPerAction', {
            key: 'maxStepsPerAction',
            level: ConfigChangeLevel.SAFE,
            description: 'Maximum steps per action',
            reason: 'Agents can adjust complexity limits based on task needs',
            validation: (value: any) => typeof value === 'number' && value >= 5 && value <= 100
        }],
        ['progressFeedbackEnabled', {
            key: 'progressFeedbackEnabled',
            level: ConfigChangeLevel.SAFE,
            description: 'Enable progress feedback messages',
            reason: 'Agents can adjust feedback verbosity',
            validation: (value: any) => typeof value === 'boolean'
        }],
        ['searchProviderOrder', {
            key: 'searchProviderOrder',
            level: ConfigChangeLevel.SAFE,
            description: 'Order of search providers to try',
            reason: 'Agents can optimize search provider selection',
            validation: (value: any) => Array.isArray(value)
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
