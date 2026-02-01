import { logger } from './logger';

export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    retryCondition?: (error: any) => boolean;
}

export class ErrorHandler {
    /**
     * Executes a function with exponential backoff retries.
     */
    public static async withRetry<T>(
        fn: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const {
            maxRetries = 3,
            initialDelay = 1000,
            maxDelay = 10000,
            factor = 2,
            retryCondition = () => true
        } = options;

        let lastError: any;
        let delay = initialDelay;

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;

                if (attempt > maxRetries || !retryCondition(error)) {
                    break;
                }

                logger.warn(`ErrorHandler: Attempt ${attempt} failed. Retrying in ${delay}ms... (Error: ${error.message})`);
                await new Promise(resolve => setTimeout(resolve, delay));

                delay = Math.min(delay * factor, maxDelay);
            }
        }

        throw lastError;
    }

    /**
     * Executes a function with a fallback if it fails after all retries.
     */
    public static async withFallback<T>(
        fn: () => Promise<T>,
        fallback: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        try {
            return await this.withRetry(fn, options);
        } catch (error) {
            logger.warn(`ErrorHandler: Final attempt failed. Triggering fallback...`);
            return await fallback();
        }
    }
}
