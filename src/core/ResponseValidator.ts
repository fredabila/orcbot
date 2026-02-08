import { logger } from '../utils/logger';
import { StandardResponse, ToolCall } from './ParserLayer';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates tool calls and responses to catch common errors before execution.
 * Provides guardrails for robust agent behavior.
 */
export class ResponseValidator {
    /**
     * Validate a complete decision response
     */
    public static validateResponse(response: StandardResponse, allowedTools: string[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate tool names
        if (response.tools && response.tools.length > 0) {
            const toolValidation = this.validateToolNames(response.tools, allowedTools);
            errors.push(...toolValidation.errors);
            warnings.push(...toolValidation.warnings);
        }

        // Validate verification block
        if (response.verification) {
            const verifyValidation = this.validateVerification(response.verification);
            errors.push(...verifyValidation.errors);
            warnings.push(...verifyValidation.warnings);
        }

        // Validate tool metadata
        if (response.tools && response.tools.length > 0) {
            const metadataValidation = this.validateToolMetadata(response.tools);
            errors.push(...metadataValidation.errors);
            warnings.push(...metadataValidation.warnings);
        }

        // Validate reasoning presence (only warn when no tools — tool calls are implicit reasoning)
        if ((!response.reasoning || response.reasoning.trim().length === 0) && (!response.tools || response.tools.length === 0)) {
            warnings.push('No reasoning provided in response');
        }

        // Validate termination logic
        if (response.verification?.goals_met === true && response.tools && response.tools.length > 0) {
            warnings.push('Response has goals_met=true but also includes tools - tools will execute before termination');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate tool names against allowed list
     */
    private static validateToolNames(tools: ToolCall[], allowedTools: string[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const allowedSet = new Set(allowedTools.map(t => t.toLowerCase()));

        for (const tool of tools) {
            if (!tool.name || tool.name.trim().length === 0) {
                errors.push('Tool call has empty name');
                continue;
            }

            const toolName = tool.name.toLowerCase();
            if (!allowedSet.has(toolName)) {
                errors.push(`Unknown tool: ${tool.name}`);
            }
        }

        // Check for duplicate tool calls with same metadata
        const signatures = new Set<string>();
        for (const tool of tools) {
            const sig = `${tool.name}:${JSON.stringify(tool.metadata || {})}`;
            if (signatures.has(sig)) {
                warnings.push(`Duplicate tool call: ${tool.name}`);
            }
            signatures.add(sig);
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate verification block structure
     */
    private static validateVerification(verification: any): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (typeof verification.goals_met !== 'boolean') {
            errors.push('verification.goals_met must be a boolean');
        }

        if (!verification.analysis || verification.analysis.trim().length === 0) {
            warnings.push('verification.analysis is empty');
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate tool metadata for common issues
     */
    private static validateToolMetadata(tools: ToolCall[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        for (const tool of tools) {
            const toolName = tool.name?.toLowerCase();

            // Messaging tools validation
            if (toolName && ['send_telegram', 'send_whatsapp', 'send_discord', 'send_gateway_chat'].includes(toolName)) {
                if (!tool.metadata || !tool.metadata.message) {
                    errors.push(`${tool.name} missing required 'message' metadata`);
                }

                if (toolName === 'send_telegram' && !tool.metadata?.chatId) {
                    errors.push(`${tool.name} missing required 'chatId' metadata`);
                }

                if (toolName === 'send_discord' && !tool.metadata?.channel_id) {
                    errors.push(`${tool.name} missing required 'channel_id' metadata`);
                }

                if (tool.metadata?.message && typeof tool.metadata.message === 'string') {
                    if (tool.metadata.message.trim().length === 0) {
                        errors.push(`${tool.name} has empty message`);
                    }
                }
            }

            // Search tools validation
            if (toolName && ['web_search', 'google_search', 'bing_search'].includes(toolName)) {
                if (!tool.metadata || (!tool.metadata.query && !tool.metadata.q)) {
                    errors.push(`${tool.name} missing required 'query' metadata`);
                }

                const query = tool.metadata?.query || tool.metadata?.q;
                if (query && typeof query === 'string' && query.trim().length === 0) {
                    errors.push(`${tool.name} has empty query`);
                }
            }

            // Browser tools validation
            if (toolName && ['browser_navigate', 'browser_click', 'browser_type'].includes(toolName)) {
                if (toolName === 'browser_navigate' && !tool.metadata?.url) {
                    errors.push(`${tool.name} missing required 'url' metadata`);
                }

                if (toolName === 'browser_click' && !tool.metadata?.selector) {
                    errors.push(`${tool.name} missing required 'selector' metadata`);
                }

                if (toolName === 'browser_type') {
                    if (!tool.metadata?.selector) {
                        errors.push(`${tool.name} missing required 'selector' metadata`);
                    }
                    if (tool.metadata?.text === undefined) {
                        errors.push(`${tool.name} missing required 'text' metadata`);
                    }
                }
            }

            // File operation validation
            if (toolName && ['write_file', 'read_file', 'delete_file'].includes(toolName)) {
                if (!tool.metadata || !tool.metadata.path) {
                    errors.push(`${tool.name} missing required 'path' metadata`);
                }

                if (toolName === 'write_file' && tool.metadata?.content === undefined) {
                    errors.push(`${tool.name} missing required 'content' metadata`);
                }
            }

            // Command execution validation
            if (toolName && ['run_command', 'execute_shell'].includes(toolName)) {
                if (!tool.metadata || !tool.metadata.command) {
                    errors.push(`${tool.name} missing required 'command' metadata`);
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Log validation results
     */
    public static logValidation(validation: ValidationResult, context: string = ''): void {
        if (validation.errors.length > 0) {
            logger.error(`ResponseValidator ${context}: ${validation.errors.join('; ')}`);
        }

        if (validation.warnings.length > 0) {
            logger.warn(`ResponseValidator ${context}: ${validation.warnings.join('; ')}`);
        }

        if (validation.valid && validation.errors.length === 0 && validation.warnings.length === 0) {
            logger.debug(`ResponseValidator ${context}: Validation passed`);
        }
    }
}
