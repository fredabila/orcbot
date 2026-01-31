import { logger } from '../utils/logger';
import { eventBus } from './EventBus';

export interface Action {
    id: string;
    type: string;
    payload: any;
    priority: number;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    timestamp: string;
}

export class ActionQueue {
    private queue: Action[] = [];

    constructor() {
        this.initialize();
    }

    private initialize() {
        eventBus.on('action:push', (action: Action) => {
            this.push(action);
        });
    }

    public push(action: Action) {
        this.queue.push(action);
        this.sort();
        logger.info(`Action pushed: ${action.type} (${action.id})`);
        eventBus.emit('action:queued', action);
    }

    private sort() {
        this.queue.sort((a, b) => b.priority - a.priority);
    }

    public getNext(): Action | undefined {
        return this.queue.find(a => a.status === 'pending');
    }

    public updateStatus(id: string, status: Action['status']) {
        const action = this.queue.find(a => a.id === id);
        if (action) {
            action.status = status;
            logger.info(`Action ${id} status updated to ${status}`);
        }
    }

    public getQueue() {
        return [...this.queue];
    }
}
