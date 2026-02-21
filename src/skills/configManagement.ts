/**
 * ConfigManagementSkill - Allows agents to manage configuration options safely
 * 
 * This skill enables agents to:
 * - View current configuration
 * - Modify safe configuration options
 * - Request approval for sensitive configuration changes
 * - Understand configuration policies
 */

import { logger } from '../utils/logger';
import { ConfigPolicy, ConfigChangeLevel } from '../config/ConfigPolicy';
import { AgentContext } from '../core/SkillsManager';

export interface ConfigChange {
    key: string;
    oldValue: any;
    newValue: any;
    timestamp: number;
    reason?: string;
}

export class ConfigManagementService {
    private pendingApprovals: Map<string, ConfigChange> = new Map();
    private changeHistory: ConfigChange[] = [];
    private maxHistorySize: number = 50;

    /**
     * Get current configuration value
     */
    getConfig(key: string, context: AgentContext): any {
        return context.config.get(key);
    }

    /**
     * Get all configuration with policies
     */
    getAllConfigWithPolicies(context: AgentContext): any {
        const config = context.config.getAll();
        const result: any = {
            safe: {},
            approval: {},
            locked: {}
        };

        for (const key of Object.keys(config)) {
            const policy = ConfigPolicy.getPolicy(key);
            const value = config[key];
            
            if (!policy) {
                result.approval[key] = value;
            } else if (policy.level === ConfigChangeLevel.SAFE) {
                result.safe[key] = value;
            } else if (policy.level === ConfigChangeLevel.APPROVAL) {
                result.approval[key] = '***' // Mask sensitive values
            } else if (policy.level === ConfigChangeLevel.LOCKED) {
                result.locked[key] = '***' // Mask sensitive values
            }
        }

        return result;
    }

    /**
     * Set configuration value (respects policy)
     */
    setConfig(key: string, value: any, reason: string | undefined, context: AgentContext): {
        success: boolean;
        message: string;
        requiresApproval?: boolean;
    } {
        // Check if key is locked
        if (ConfigPolicy.isLocked(key)) {
            return {
                success: false,
                message: `Configuration key "${key}" is locked and cannot be modified by agents. Reason: ${ConfigPolicy.getPolicy(key)?.reason}`
            };
        }

        // Validate the value
        const validation = ConfigPolicy.validate(key, value);
        if (!validation.valid) {
            return {
                success: false,
                message: `Invalid value for "${key}": ${validation.error}`
            };
        }

        const oldValue = context.config.get(key);

        // Check if this is a safe change
        if (ConfigPolicy.canAutoModify(key)) {
            try {
                context.config.set(key, value);
                
                // Record the change
                this.recordChange({
                    key,
                    oldValue,
                    newValue: value,
                    timestamp: Date.now(),
                    reason
                });

                logger.info(`ConfigManagement: Agent modified config "${key}" from ${oldValue} to ${value}`);
                
                return {
                    success: true,
                    message: `Configuration "${key}" updated successfully from ${oldValue} to ${value}`
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to update configuration: ${error}`
                };
            }
        }

        // Requires approval
        if (ConfigPolicy.requiresApproval(key)) {
            this.pendingApprovals.set(key, {
                key,
                oldValue,
                newValue: value,
                timestamp: Date.now(),
                reason
            });

            logger.info(`ConfigManagement: Agent requested approval for config change: ${key}`);
            
            return {
                success: false,
                requiresApproval: true,
                message: `Configuration change for "${key}" requires approval. The request has been queued. Reason for change: ${reason || 'Not provided'}`
            };
        }

        return {
            success: false,
            message: `Configuration key "${key}" has unknown policy. Cannot modify.`
        };
    }

    /**
     * Get pending approval requests
     */
    getPendingApprovals(): ConfigChange[] {
        return Array.from(this.pendingApprovals.values());
    }

    /**
     * Approve a pending configuration change
     */
    approvePending(key: string, context: AgentContext): {
        success: boolean;
        message: string;
    } {
        const pending = this.pendingApprovals.get(key);
        if (!pending) {
            return {
                success: false,
                message: `No pending approval found for "${key}"`
            };
        }

        try {
            context.config.set(key, pending.newValue);
            
            this.recordChange(pending);
            this.pendingApprovals.delete(key);
            
            logger.info(`ConfigManagement: Approved config change for "${key}" from ${pending.oldValue} to ${pending.newValue}`);
            
            return {
                success: true,
                message: `Configuration "${key}" updated to ${pending.newValue} (was: ${pending.oldValue})`
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to apply approved change: ${error}`
            };
        }
    }

    /**
     * Reject a pending configuration change
     */
    rejectPending(key: string): {
        success: boolean;
        message: string;
    } {
        const pending = this.pendingApprovals.get(key);
        if (!pending) {
            return {
                success: false,
                message: `No pending approval found for "${key}"`
            };
        }

        this.pendingApprovals.delete(key);
        logger.info(`ConfigManagement: Rejected config change for "${key}"`);
        
        return {
            success: true,
            message: `Configuration change request for "${key}" has been rejected`
        };
    }

    /**
     * Get change history
     */
    getHistory(limit?: number): ConfigChange[] {
        const count = limit || this.changeHistory.length;
        return this.changeHistory.slice(-count);
    }

    /**
     * Record a configuration change
     */
    private recordChange(change: ConfigChange): void {
        this.changeHistory.push(change);
        
        // Trim history if it exceeds max size
        if (this.changeHistory.length > this.maxHistorySize) {
            this.changeHistory = this.changeHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Suggest optimal configuration based on task context
     */
    suggestOptimizations(taskDescription: string, context: AgentContext): {
        suggestions: Array<{ key: string; value: any; reason: string }>;
    } {
        const suggestions: Array<{ key: string; value: any; reason: string }> = [];
        const currentModel = context.config.get('modelName');
        
        // Example: Suggest model changes based on task
        if (taskDescription.toLowerCase().includes('code') || 
            taskDescription.toLowerCase().includes('programming')) {
            if (!currentModel?.includes('gpt-4')) {
                suggestions.push({
                    key: 'modelName',
                    value: 'gpt-4',
                    reason: 'Code-related tasks benefit from GPT-4\'s superior reasoning'
                });
            }
        }

        // Suggest memory adjustments for complex tasks
        if (taskDescription.length > 500 || 
            taskDescription.toLowerCase().includes('complex') ||
            taskDescription.toLowerCase().includes('multiple')) {
            const currentLimit = context.config.get('memoryContextLimit');
            if (currentLimit < 30) {
                suggestions.push({
                    key: 'memoryContextLimit',
                    value: 30,
                    reason: 'Complex tasks benefit from more context memory'
                });
            }
        }

        // Suggest step/message budget adjustments
        if (taskDescription.toLowerCase().includes('multi-step') ||
            taskDescription.toLowerCase().includes('workflow')) {
            const currentSteps = context.config.get('maxStepsPerAction');
            if (currentSteps < 50) {
                suggestions.push({
                    key: 'maxStepsPerAction',
                    value: 50,
                    reason: 'Multi-step workflows need higher step budgets'
                });
            }

            const currentMessages = Number(context.config.get('maxMessagesPerAction') || 0);
            if (currentMessages < 15) {
                suggestions.push({
                    key: 'maxMessagesPerAction',
                    value: 15,
                    reason: 'Multi-step workflows with progress updates need a higher message budget'
                });
            }
        }

        return { suggestions };
    }
}

// Singleton instance
export const configManagementService = new ConfigManagementService();

/**
 * Export the skill for registration
 */
export const configManagementSkill = {
    name: 'manage_config',
    description: 'Manage agent configuration settings. Can view, modify safe settings, request approval for sensitive settings, and get optimization suggestions.',
    usage: 'manage_config({ action: "get"|"set"|"list"|"policy"|"history"|"pending"|"approve"|"reject"|"suggest", key?: string, value?: any, reason?: string, taskDescription?: string })',
    
    handler: async (args: any, context?: AgentContext) => {
        if (!context) {
            return 'Error: Context not available';
        }

        const action = args.action;

        try {
            switch (action) {
                case 'get':
                    if (!args.key) return 'Error: Missing "key" parameter';
                    const value = configManagementService.getConfig(args.key, context);
                    return `Current value of "${args.key}": ${JSON.stringify(value)}`;

                case 'set':
                    if (!args.key) return 'Error: Missing "key" parameter';
                    if (args.value === undefined) return 'Error: Missing "value" parameter';
                    const setResult = configManagementService.setConfig(
                        args.key,
                        args.value,
                        args.reason,
                        context
                    );
                    return setResult.message;

                case 'list':
                    const allConfig = configManagementService.getAllConfigWithPolicies(context);
                    return `Configuration (by policy level):\n\nSAFE (can modify):\n${JSON.stringify(allConfig.safe, null, 2)}\n\nREQUIRES APPROVAL:\n${JSON.stringify(allConfig.approval, null, 2)}\n\nLOCKED (cannot modify):\n${JSON.stringify(allConfig.locked, null, 2)}`;

                case 'policy':
                    return ConfigPolicy.getPolicyDescription();

                case 'history':
                    const history = configManagementService.getHistory(args.limit || 10);
                    if (history.length === 0) return 'No configuration changes in history';
                    return `Recent configuration changes:\n${history.map(h => 
                        `- ${new Date(h.timestamp).toISOString()}: ${h.key} changed from ${h.oldValue} to ${h.newValue}${h.reason ? ` (Reason: ${h.reason})` : ''}`
                    ).join('\n')}`;

                case 'pending':
                    const pending = configManagementService.getPendingApprovals();
                    if (pending.length === 0) return 'No pending approval requests';
                    return `Pending approval requests:\n${pending.map(p => 
                        `- ${p.key}: ${p.oldValue} → ${p.newValue}${p.reason ? ` (Reason: ${p.reason})` : ''}`
                    ).join('\n')}`;

                case 'approve':
                    if (!args.key) return 'Error: Missing "key" parameter';
                    const approveResult = configManagementService.approvePending(args.key, context);
                    return approveResult.message;

                case 'reject':
                    if (!args.key) return 'Error: Missing "key" parameter';
                    const rejectResult = configManagementService.rejectPending(args.key);
                    return rejectResult.message;

                case 'suggest':
                    if (!args.taskDescription) return 'Error: Missing "taskDescription" parameter';
                    const suggestions = configManagementService.suggestOptimizations(args.taskDescription, context);
                    if (suggestions.suggestions.length === 0) {
                        return 'No optimization suggestions for this task. Current configuration appears optimal.';
                    }
                    return `Configuration optimization suggestions:\n${suggestions.suggestions.map(s => 
                        `- Set ${s.key} to ${s.value}\n  Reason: ${s.reason}`
                    ).join('\n')}`;

                default:
                    return `Unknown action: ${action}. Valid actions: get, set, list, policy, history, pending, approve, reject, suggest`;
            }
        } catch (error) {
            logger.error(`ConfigManagement skill error: ${error}`);
            return `Error executing config management action: ${error}`;
        }
    }
};
