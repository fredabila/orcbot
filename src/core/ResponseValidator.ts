import { z } from 'zod';
import { logger } from '../utils/logger';
import { StandardResponse, ToolCall } from './ParserLayer';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const VerificationSchema = z.object({
    goals_met: z.any(),
    analysis: z.string()
}).superRefine((data, ctx) => {
    if (typeof data.goals_met !== 'boolean') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "verification.goals_met must be a boolean",
            path: ["goals_met"]
        });
    }
    if (!data.analysis || data.analysis.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "verification.analysis is empty",
            path: ["analysis"]
        });
    }
});

const MessagingMetadataSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.message !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'message' metadata"
        });
    } else if (data.message.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "has empty message",
            path: ["message"]
        });
    }
});

const SearchMetadataSchema = z.any().superRefine((data, ctx) => {
    if (!data) return;
    const query = data.query || data.q;
    if (!query) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'query' metadata"
        });
    } else if (typeof query === 'string' && query.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "has empty query"
        });
    }
});

const BrowserNavigateSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.url !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'url' metadata"
        });
    } else if (data.url.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'url' metadata",
            path: ["url"]
        });
    }
});

const BrowserClickSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.selector !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'selector' metadata"
        });
    } else if (data.selector.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'selector' metadata",
            path: ["selector"]
        });
    }
});

const BrowserTypeSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.selector !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'selector' metadata"
        });
    } else if (data.selector.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'selector' metadata",
            path: ["selector"]
        });
    }
    
    if (!data || data.text === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'text' metadata",
            path: ["text"]
        });
    }
});

const FileMetadataSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.path !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'path' metadata"
        });
    } else if (data.path.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'path' metadata",
            path: ["path"]
        });
    }
});

const CommandMetadataSchema = z.any().superRefine((data, ctx) => {
    if (!data || typeof data.command !== 'string') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'command' metadata"
        });
    } else if (data.command.trim().length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "missing required 'command' metadata",
            path: ["command"]
        });
    }
});

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
        const result = VerificationSchema.safeParse(verification);
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!result.success) {
            for (const issue of result.error.issues) {
                // Treat missing analysis as a warning to be consistent with previous behavior,
                // but type errors as errors.
                if (issue.path.includes('analysis')) {
                    warnings.push(issue.message);
                } else {
                    errors.push(issue.message);
                }
            }
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
            const metadata = tool.metadata || {};

            // Messaging tools validation
            if (toolName && ['send_telegram', 'send_whatsapp', 'send_discord', 'send_slack', 'send_gateway_chat'].includes(toolName)) {
                const result = MessagingMetadataSchema.safeParse(metadata);
                if (!result.success) {
                    errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
                } else {
                    if (toolName === 'send_telegram' && !metadata.chatId) {
                        errors.push(`${tool.name} missing required 'chatId' metadata`);
                    }
                    if (['send_discord', 'send_slack'].includes(toolName) && !metadata.channel_id) {
                        errors.push(`${tool.name} missing required 'channel_id' metadata`);
                    }
                }
            }

            // Search tools validation
            if (toolName && ['web_search', 'google_search', 'bing_search'].includes(toolName)) {
                const result = SearchMetadataSchema.safeParse(metadata);
                if (!result.success) {
                    errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
                }
            }

            // Browser tools validation
            if (toolName === 'browser_navigate') {
                const result = BrowserNavigateSchema.safeParse(metadata);
                if (!result.success) errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
            } else if (toolName === 'browser_click') {
                const result = BrowserClickSchema.safeParse(metadata);
                if (!result.success) errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
            } else if (toolName === 'browser_type') {
                const result = BrowserTypeSchema.safeParse(metadata);
                if (!result.success) errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
            }

            // File operation validation
            if (toolName && ['write_file', 'read_file', 'delete_file'].includes(toolName)) {
                const result = FileMetadataSchema.safeParse(metadata);
                if (!result.success) {
                    errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
                } else if (toolName === 'write_file' && metadata.content === undefined) {
                    errors.push(`${tool.name} missing required 'content' metadata`);
                }
            }

            // Command execution validation
            if (toolName && ['run_command', 'execute_shell'].includes(toolName)) {
                const result = CommandMetadataSchema.safeParse(metadata);
                if (!result.success) {
                    errors.push(...result.error.issues.map(i => `${tool.name} ${i.message}`));
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
