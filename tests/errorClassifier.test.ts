import { describe, expect, it } from 'vitest';
import { ErrorClassifier, ErrorType } from '../src/core/ErrorClassifier';

describe('ErrorClassifier', () => {
    it('should classify context overflow errors', () => {
        const errors = [
            'Context length exceeded maximum',
            'Token limit reached',
            'Maximum context window exceeded',
            'Too many tokens in request'
        ];

        for (const errorMsg of errors) {
            const classified = ErrorClassifier.classify({ message: errorMsg });
            expect(classified.type).toBe(ErrorType.CONTEXT_OVERFLOW);
            expect(classified.retryable).toBe(true);
        }
    });

    it('should classify rate limit errors', () => {
        const errors = [
            'Rate limit exceeded',
            'Too many requests',
            'Quota exceeded',
            'Error 429: rate limit'
        ];

        for (const errorMsg of errors) {
            const classified = ErrorClassifier.classify({ message: errorMsg });
            expect(classified.type).toBe(ErrorType.RATE_LIMIT);
            expect(classified.retryable).toBe(true);
            expect(classified.cooldownMs).toBeGreaterThan(0);
        }
    });

    it('should classify timeout errors', () => {
        const errors = [
            'Request timeout',
            'Connection timed out',
            'ETIMEDOUT',
            'Deadline exceeded'
        ];

        for (const errorMsg of errors) {
            const classified = ErrorClassifier.classify({ message: errorMsg });
            expect(classified.type).toBe(ErrorType.TIMEOUT);
            expect(classified.retryable).toBe(true);
        }
    });

    it('should classify network errors', () => {
        const errors = [
            'ECONNREFUSED',
            'Network error',
            'Connection refused',
            'ENOTFOUND'
        ];

        for (const errorMsg of errors) {
            const classified = ErrorClassifier.classify({ message: errorMsg });
            expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
            expect(classified.retryable).toBe(true);
        }
    });

    it('should classify invalid response errors as non-retryable', () => {
        const errors = [
            'Invalid JSON',
            'Parse error in response',
            'Unexpected token',
            'Malformed response'
        ];

        for (const errorMsg of errors) {
            const classified = ErrorClassifier.classify({ message: errorMsg });
            expect(classified.type).toBe(ErrorType.INVALID_RESPONSE);
            expect(classified.retryable).toBe(false);
        }
    });

    it('should extract cooldown from rate limit messages', () => {
        const error = 'Rate limit exceeded. Retry after 30 seconds';
        const classified = ErrorClassifier.classify({ message: error });
        
        expect(classified.type).toBe(ErrorType.RATE_LIMIT);
        expect(classified.cooldownMs).toBe(30000);
    });

    it('should calculate exponential backoff correctly', () => {
        const delays = [];
        for (let i = 0; i < 5; i++) {
            delays.push(ErrorClassifier.getBackoffDelay(i, 1000, 30000));
        }

        // Each delay should be roughly double the previous (with jitter)
        for (let i = 1; i < delays.length; i++) {
            expect(delays[i]).toBeGreaterThan(delays[i - 1]);
        }

        // Should cap at max delay
        const maxedDelay = ErrorClassifier.getBackoffDelay(10, 1000, 5000);
        expect(maxedDelay).toBeLessThanOrEqual(5000 * 1.3); // Allow for jitter
    });

    it('should respect max attempts in retry decision', () => {
        const classified = ErrorClassifier.classify({ message: 'Rate limit exceeded' });
        
        expect(ErrorClassifier.shouldRetry(classified, 1, 3)).toBe(true);
        expect(ErrorClassifier.shouldRetry(classified, 2, 3)).toBe(true);
        expect(ErrorClassifier.shouldRetry(classified, 3, 3)).toBe(false);
        expect(ErrorClassifier.shouldRetry(classified, 4, 3)).toBe(false);
    });

    it('should not retry non-retryable errors', () => {
        const classified = ErrorClassifier.classify({ message: 'Invalid JSON response' });
        
        expect(ErrorClassifier.shouldRetry(classified, 1, 3)).toBe(false);
    });

    it('should handle unknown errors', () => {
        const classified = ErrorClassifier.classify({ message: 'Something weird happened' });
        
        expect(classified.type).toBe(ErrorType.UNKNOWN);
        expect(classified.retryable).toBe(false);
    });

    it('should preserve original error in classification', () => {
        const originalError = new Error('Test error');
        const classified = ErrorClassifier.classify(originalError);
        
        expect(classified.originalError).toBe(originalError);
    });
});
