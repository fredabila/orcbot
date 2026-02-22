import { TForceIncident } from './types';

export class TForceMemoryEngine {
    private readonly incidentsByAction = new Map<string, TForceIncident[]>();

    constructor(private readonly maxIncidentsPerAction: number = 30) {}

    recordIncident(incident: TForceIncident): void {
        const list = this.incidentsByAction.get(incident.actionId) || [];
        list.push(incident);
        if (list.length > this.maxIncidentsPerAction) {
            list.splice(0, list.length - this.maxIncidentsPerAction);
        }
        this.incidentsByAction.set(incident.actionId, list);
    }

    getRecentHighlights(actionId: string, maxItems: number = 4): string[] {
        const list = this.incidentsByAction.get(actionId) || [];
        return list
            .slice(-maxItems)
            .map(i => `${i.source}@step${i.step}: ${i.summary}`)
            .filter(Boolean);
    }
}
