import { TForceIncident } from './types';

export class TForceMemoryEngine {
    private readonly incidentsByAction = new Map<string, TForceIncident[]>();
    private readonly actionTouchOrder: string[] = [];

    constructor(
        private readonly maxIncidentsPerAction: number = 30,
        private readonly maxTrackedActions: number = 200
    ) {}

    recordIncident(incident: TForceIncident): void {
        const list = this.incidentsByAction.get(incident.actionId) || [];
        list.push(incident);
        if (list.length > this.maxIncidentsPerAction) {
            list.splice(0, list.length - this.maxIncidentsPerAction);
        }
        this.incidentsByAction.set(incident.actionId, list);
        this.touchAction(incident.actionId);
        this.evictIfNeeded();
    }

    getRecentHighlights(actionId: string, maxItems: number = 4): string[] {
        const list = this.incidentsByAction.get(actionId) || [];
        return list
            .slice(-maxItems)
            .map(i => `${i.source}@step${i.step}: ${i.summary}`)
            .filter(Boolean);
    }

    private touchAction(actionId: string): void {
        const existingIndex = this.actionTouchOrder.indexOf(actionId);
        if (existingIndex >= 0) {
            this.actionTouchOrder.splice(existingIndex, 1);
        }
        this.actionTouchOrder.push(actionId);
    }

    private evictIfNeeded(): void {
        while (this.incidentsByAction.size > this.maxTrackedActions) {
            const evictActionId = this.actionTouchOrder.shift();
            if (!evictActionId) {
                break;
            }
            this.incidentsByAction.delete(evictActionId);
        }
    }
}
