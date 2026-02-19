import { logger } from '../utils/logger';
import { eventBus } from './EventBus';

/**
 * PollingManager - Generic polling system to handle waiting periods
 * 
 * This class provides an event-based polling mechanism that prevents agents
 * from constantly looping to check conditions. Instead, tasks can register
 * polling jobs that emit events when conditions are met.
 */

export interface PollingJob {
    id: string;
    description: string;
    checkFn: () => Promise<boolean>;
    intervalMs: number;
    maxAttempts?: number;
    onSuccess?: (id: string) => void;
    onFailure?: (id: string, reason: string) => void;
    onProgress?: (id: string, attempt: number) => void;
}

export class PollingManager {
    private jobs: Map<string, {
        job: PollingJob;
        interval: NodeJS.Timeout;
        attempts: number;
        startedAt: number;
        inFlight: boolean;
        timeout: NodeJS.Timeout | null;
        currentIntervalMs: number;
    }> = new Map();
    private isRunning: boolean = false;

    constructor() {
        logger.info('PollingManager initialized');
    }

    /**
     * Start the polling manager
     */
    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('PollingManager started');
        eventBus.emit('polling:started', { timestamp: new Date().toISOString() });
    }

    /**
     * Stop the polling manager and clear all jobs
     */
    public stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;

        // Clear all active jobs
        for (const [id, jobData] of this.jobs.entries()) {
            if (jobData.timeout) clearTimeout(jobData.timeout);
            logger.debug(`PollingManager: Stopped job ${id}`);
        }
        this.jobs.clear();

        logger.info('PollingManager stopped');
        eventBus.emit('polling:stopped', { timestamp: new Date().toISOString() });
    }

    /**
     * Register a new polling job
     * @param job The polling job configuration
     * @returns Job ID
     */
    public registerJob(job: PollingJob): string {
        if (this.jobs.has(job.id)) {
            logger.warn(`PollingManager: Job ${job.id} already exists, replacing it`);
            this.cancelJob(job.id);
        }

        logger.info(`PollingManager: Registering job "${job.id}" with interval ${job.intervalMs}ms`);

        const startedAt = Date.now();

        // Store job data first so we can update attempts in place
        const jobData = {
            job,
            interval: null as any,
            attempts: 0,
            startedAt,
            inFlight: false,
            timeout: null as NodeJS.Timeout | null,
            currentIntervalMs: Math.max(100, job.intervalMs)
        };
        this.jobs.set(job.id, jobData);

        const runAttempt = async () => {
            if (!this.isRunning) {
                this.cancelJob(job.id);
                return;
            }

            const currentJobData = this.jobs.get(job.id);
            if (!currentJobData) return;
            if (currentJobData.inFlight) {
                logger.debug(`PollingManager: Job "${job.id}" check still in-flight, skipping overlap`);
                currentJobData.timeout = setTimeout(runAttempt, currentJobData.currentIntervalMs);
                return;
            }

            currentJobData.inFlight = true;
            currentJobData.attempts++;
            const attempts = currentJobData.attempts;

            logger.info(`PollingManager: Job "${job.id}" — attempt ${attempts} (${job.description})`);

            if (job.onProgress) {
                job.onProgress(job.id, attempts);
            }
            eventBus.emit('polling:progress', {
                jobId: job.id,
                attempt: attempts,
                description: job.description
            });

            try {
                const result = await job.checkFn();

                if (result) {
                    logger.info(`PollingManager: Job "${job.id}" completed successfully after ${attempts} attempts`);

                    if (job.onSuccess) {
                        job.onSuccess(job.id);
                    }

                    eventBus.emit('polling:success', {
                        jobId: job.id,
                        attempts,
                        duration: Date.now() - startedAt,
                        description: job.description
                    });

                    this.cancelJob(job.id);
                    return;
                }

                if (job.maxAttempts && attempts >= job.maxAttempts) {
                    const reason = `Max attempts (${job.maxAttempts}) reached`;
                    logger.warn(`PollingManager: Job "${job.id}" failed - ${reason}`);

                    if (job.onFailure) {
                        job.onFailure(job.id, reason);
                    }

                    eventBus.emit('polling:failure', {
                        jobId: job.id,
                        attempts,
                        reason,
                        description: job.description
                    });

                    this.cancelJob(job.id);
                    return;
                }

                // Adaptive waiting: backoff up to 4x base interval to reduce noisy polling.
                currentJobData.currentIntervalMs = Math.min(job.intervalMs * 4, Math.floor(currentJobData.currentIntervalMs * 1.5));
                currentJobData.timeout = setTimeout(runAttempt, currentJobData.currentIntervalMs);
            } catch (error: any) {
                logger.error(`PollingManager: Job "${job.id}" error - ${error.message}`);

                if (job.onFailure) {
                    job.onFailure(job.id, error.message);
                }

                eventBus.emit('polling:error', {
                    jobId: job.id,
                    attempts,
                    error: error.message,
                    description: job.description
                });

                this.cancelJob(job.id);
            } finally {
                const latest = this.jobs.get(job.id);
                if (latest) latest.inFlight = false;
            }
        };

        // First attempt uses the requested base interval.
        jobData.timeout = setTimeout(runAttempt, job.intervalMs);

        eventBus.emit('polling:registered', { 
            jobId: job.id, 
            intervalMs: job.intervalMs,
            maxAttempts: job.maxAttempts,
            description: job.description 
        });

        return job.id;
    }

    /**
     * Cancel a polling job
     * @param jobId The job ID to cancel
     */
    public cancelJob(jobId: string): boolean {
        const jobData = this.jobs.get(jobId);
        if (!jobData) {
            logger.warn(`PollingManager: Job ${jobId} not found`);
            return false;
        }

        if (jobData.timeout) clearTimeout(jobData.timeout);
        this.jobs.delete(jobId);
        
        logger.info(`PollingManager: Job "${jobId}" cancelled`);
        eventBus.emit('polling:cancelled', { 
            jobId, 
            attempts: jobData.attempts,
            description: jobData.job.description 
        });

        return true;
    }

    /**
     * Get the status of a polling job
     * @param jobId The job ID
     */
    public getJobStatus(jobId: string): {
        exists: boolean;
        attempts?: number;
        duration?: number;
        description?: string;
    } {
        const jobData = this.jobs.get(jobId);
        if (!jobData) {
            return { exists: false };
        }

        return {
            exists: true,
            attempts: jobData.attempts,
            duration: Date.now() - jobData.startedAt,
            description: jobData.job.description
        };
    }

    /**
     * Get all active polling jobs
     */
    public getActiveJobs(): Array<{
        id: string;
        description: string;
        attempts: number;
        duration: number;
        intervalMs: number;
    }> {
        const jobs: Array<{
            id: string;
            description: string;
            attempts: number;
            duration: number;
            intervalMs: number;
        }> = [];
        
        for (const [id, jobData] of this.jobs.entries()) {
            jobs.push({
                id,
                description: jobData.job.description,
                attempts: jobData.attempts,
                duration: Date.now() - jobData.startedAt,
                intervalMs: jobData.job.intervalMs
            });
        }

        return jobs;
    }

    /**
     * Check if a job exists
     * @param jobId The job ID
     */
    public hasJob(jobId: string): boolean {
        return this.jobs.has(jobId);
    }

    /**
     * Get the number of active jobs
     */
    public getJobCount(): number {
        return this.jobs.size;
    }
}
