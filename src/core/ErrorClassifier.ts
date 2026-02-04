import { logger } from '../utils/logger';

export enum ErrorType {
    CONTEXT_OVERFLOW = 'context_overflow',
    RATE_LIMIT = 'rate_limit',
    TIMEOUT = 'timeout',
    INVALID_RESPONSE = 'invalid_response',
    TOOL_ERROR = 'tool_error',
    NETWORK_ERROR = 'network_error',
    UNKNOWN = 'unknown'
}

export interface ClassifiedError {
    type: ErrorType;
    message: string;
    retryable: boolean;
    cooldownMs?: number;
    originalError?: any;
}

/**
 * Classifies errors from LLM calls and tool executions to enable intelligent retry/fallback logic.
 * Inspired by openclaw's error classification approach.
 */
export class ErrorClassifier {
    /**
     * Classify an error to determine appropriate handling strategy
     */
    public static classify(error: any): ClassifiedError {
        const errorMsg = String(error?.message || error || '').toLowerCase();

        // Rate limit errors (check before context overflow)
        if (this.isRateLimit(errorMsg)) {
            const cooldown = this.extractCooldown(errorMsg);
            return {
                type: ErrorType.RATE_LIMIT,
                message: 'Rate limit exceeded',
                retryable: true,
                cooldownMs: cooldown,
                originalError: error
            };
        }

        // Timeout errors
        if (this.isTimeout(errorMsg)) {
            return {
                type: ErrorType.TIMEOUT,
                message: 'Request timeout',
                retryable: true,
                cooldownMs: 5000,
                originalError: error
            };
        }

        // Context overflow errors
        if (this.isContextOverflow(errorMsg)) {
            return {
                type: ErrorType.CONTEXT_OVERFLOW,
                message: 'Context window exceeded',
                retryable: true,
                originalError: error
            };
        }

        // Network errors
        if (this.isNetworkError(errorMsg)) {
            return {
                type: ErrorType.NETWORK_ERROR,
                message: 'Network connectivity issue',
                retryable: true,
                cooldownMs: 3000,
                originalError: error
            };
        }

        // Invalid response format
        if (this.isInvalidResponse(errorMsg)) {
            return {
                type: ErrorType.INVALID_RESPONSE,
                message: 'Invalid or malformed response',
                retryable: false,
                originalError: error
            };
        }

        // Unknown/generic error
        return {
            type: ErrorType.UNKNOWN,
            message: errorMsg || 'Unknown error occurred',
            retryable: false,
            originalError: error
        };
    }

    private static isContextOverflow(msg: string): boolean {
        const patterns = [
            'context length',
            'token limit',
            'maximum context',
            'too many tokens',
            'context window'
        ];
        // Must contain one of the patterns AND contain "exceed" or "limit" or "maximum"
        const hasPattern = patterns.some(p => msg.includes(p));
        const hasIndicator = msg.includes('exceed') || msg.includes('limit') || msg.includes('maximum') || msg.includes('too many');
        return hasPattern && hasIndicator;
    }

    private static isRateLimit(msg: string): boolean {
        const patterns = [
            'rate limit',
            'quota exceeded',
            'too many requests',
            '429',
            'throttle',
            'requests per'
        ];
        return patterns.some(p => msg.includes(p));
    }

    private static isTimeout(msg: string): boolean {
        const patterns = [
            'timeout',
            'timed out',
            'deadline exceeded',
            'econnaborted',
            'etimedout'
        ];
        return patterns.some(p => msg.includes(p));
    }

    private static isNetworkError(msg: string): boolean {
        const patterns = [
            'econnrefused',
            'enotfound',
            'network',
            'connection refused',
            'host not found',
            'econnreset'
        ];
        return patterns.some(p => msg.includes(p));
    }

    private static isInvalidResponse(msg: string): boolean {
        const patterns = [
            'invalid json',
            'parse error',
            'unexpected token',
            'malformed',
            'syntax error'
        ];
        return patterns.some(p => msg.includes(p));
    }

    /**
     * Extract cooldown duration from rate limit messages
     */
    private static extractCooldown(msg: string): number {
        // Look for patterns like "retry after X seconds"
        const secondsMatch = msg.match(/retry after (\d+) second/i);
        if (secondsMatch) {
            return parseInt(secondsMatch[1]) * 1000;
        }

        const minutesMatch = msg.match(/retry after (\d+) minute/i);
        if (minutesMatch) {
            return parseInt(minutesMatch[1]) * 60 * 1000;
        }

        // Default cooldown for rate limits
        return 60000; // 60 seconds
    }

    /**
     * Determine if an error should be retried
     */
    public static shouldRetry(classified: ClassifiedError, attemptCount: number, maxAttempts: number = 3): boolean {
        if (attemptCount >= maxAttempts) {
            return false;
        }

        return classified.retryable;
    }

    /**
     * Calculate backoff delay for retry attempts
     */
    public static getBackoffDelay(attemptCount: number, baseDelay: number = 1000, maxDelay: number = 30000): number {
        // Exponential backoff with jitter
        const exponential = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);
        const jitter = Math.random() * 0.3 * exponential;
        return Math.floor(exponential + jitter);
    }
}
