import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';
import fs from 'fs';
import path from 'path';

export interface Action {
    id: string;
    type: string;
    payload: any;
    priority: number;
    lane?: 'user' | 'autonomy';
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    timestamp: string;
    updatedAt?: string;
}

export class ActionQueue {
    private filePath: string;

    constructor(filePath: string = './actions.json') {
        this.filePath = path.resolve(process.cwd(), filePath);
        this.initialize();
    }

    private initialize() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
        }
        eventBus.on('action:push', (action: Action) => {
            this.push(action);
        });
    }

    private readQueue(): Action[] {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            const data = fs.readFileSync(this.filePath, 'utf-8');
            if (!data || data.trim().length === 0) {
                return [];
            }
            return JSON.parse(data);
        } catch (e) {
            logger.error(`Failed to read ActionQueue: ${e}`);
            // Auto-recover from corrupt JSON by backing up and resetting
            try {
                const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
                if (fs.existsSync(this.filePath)) {
                    fs.renameSync(this.filePath, corruptPath);
                    logger.warn(`ActionQueue: Corrupt file moved to ${corruptPath}`);
                }
                fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
            } catch (recoveryError) {
                logger.error(`ActionQueue recovery failed: ${recoveryError}`);
            }
            return [];
        }
    }

    private saveQueue(queue: Action[]) {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(queue, null, 2));
        } catch (e) {
            logger.error(`Failed to save ActionQueue: ${e}`);
        }
    }

    public push(action: Action) {
        const queue = this.readQueue();
        queue.push(action);
        queue.sort((a, b) => b.priority - a.priority);
        this.saveQueue(queue);
        logger.info(`Action pushed and saved: ${action.type} (${action.id})`);
        eventBus.emit('action:queued', action);
    }

    public getNext(): Action | undefined {
        const queue = this.readQueue();
        return queue.find(a => a.status === 'pending');
    }

    public updateStatus(id: string, status: Action['status']) {
        const queue = this.readQueue();
        const action = queue.find(a => a.id === id);
        if (action) {
            action.status = status;
            action.updatedAt = new Date().toISOString();
            this.saveQueue(queue);
            logger.info(`Action ${id} status updated to ${status} (persistent)`);
        }
    }

    public getQueue() {
        return this.readQueue();
    }

    public getAction(id: string): Action | undefined {
        const queue = this.readQueue();
        return queue.find(action => action.id === id);
    }
}
