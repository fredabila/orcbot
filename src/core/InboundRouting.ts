import { Action } from '../memory/ActionQueue';

export type InboundRouteKind = 'resume_waiting' | 'queue_after_active' | 'supersede_pending' | 'enqueue_new';

export interface InboundRouteDecision {
    route: InboundRouteKind;
    sessionScopeId?: string;
    waitingActionId?: string;
    activeActionId?: string;
    supersededActionIds: string[];
}

function getThreadScope(action: Action): string | null {
    return action.payload?.sessionScopeId ||
        ((action.payload?.source && action.payload?.sourceId)
            ? `${action.payload.source}:${action.payload.sourceId}`
            : null);
}

function getTimestamp(value?: string): number {
    return value ? (Date.parse(value) || 0) : 0;
}

export function resolveInboundRoute(
    actions: Action[],
    metadata: { source?: string; sourceId?: string; sessionScopeId?: string; messageId?: string }
): InboundRouteDecision {
    const sessionScopeId = metadata?.sessionScopeId ||
        ((metadata?.source && metadata?.sourceId) ? `${metadata.source}:${metadata.sourceId}` : undefined);

    if (!sessionScopeId) {
        return {
            route: 'enqueue_new',
            sessionScopeId,
            supersededActionIds: []
        };
    }

    const sameThread = actions
        .filter(action => getThreadScope(action) === sessionScopeId)
        .filter(action => action.lane !== 'autonomy')
        .filter(action => ['pending', 'waiting', 'in-progress'].includes(action.status))
        .sort((a, b) => getTimestamp(b.updatedAt || b.timestamp) - getTimestamp(a.updatedAt || a.timestamp));

    const waitingAction = sameThread.find(action => action.status === 'waiting');
    if (waitingAction) {
        return {
            route: 'resume_waiting',
            sessionScopeId,
            waitingActionId: waitingAction.id,
            supersededActionIds: []
        };
    }

    const supersededActionIds = sameThread
        .filter(action => action.status === 'pending')
        .filter(action => !action.payload?.isHeartbeat)
        .filter(action => !action.payload?.delegatedFollowup)
        .filter(action => !metadata?.messageId || action.payload?.messageId !== metadata.messageId)
        .map(action => action.id);

    const activeAction = sameThread.find(action => action.status === 'in-progress');
    if (activeAction) {
        return {
            route: 'queue_after_active',
            sessionScopeId,
            activeActionId: activeAction.id,
            supersededActionIds
        };
    }

    if (supersededActionIds.length > 0) {
        return {
            route: 'supersede_pending',
            sessionScopeId,
            supersededActionIds
        };
    }

    return {
        route: 'enqueue_new',
        sessionScopeId,
        supersededActionIds: []
    };
}