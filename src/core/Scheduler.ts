import { logger } from '../utils/logger';
import { eventBus } from './EventBus';

export class Scheduler {
    private interval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    constructor(private tickRateMs: number = 5000) { }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`Scheduler started with tick rate: ${this.tickRateMs}ms`);

        this.interval = setInterval(() => {
            this.tick();
        }, this.tickRateMs);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('Scheduler stopped');
    }

    private tick() {
        logger.debug('Scheduler tick');
        eventBus.emit('scheduler:tick', { timestamp: new Date().toISOString() });
    }
}
