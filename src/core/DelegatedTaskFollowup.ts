import { Action } from '../memory/ActionQueue';
import { OrchestratorTask } from './AgentOrchestrator';

export interface DelegatedTaskReplyContext {
    source?: string;
    sourceId?: string;
    chatId?: string;
    userId?: string;
    senderName?: string;
    sessionScopeId?: string;
    subject?: string;
    inReplyTo?: string;
    references?: string[];
    isAdmin?: boolean;
}

export interface DelegatedTaskMetadata {
    notifyParent?: boolean;
    delegationKind?: string;
    delegatedDescription?: string;
    originalRequest?: string;
    createdByActionId?: string;
    replyContext?: DelegatedTaskReplyContext;
}

export interface DelegatedTaskFollowupOptions {
    task: OrchestratorTask;
    agentId: string;
    workerName?: string;
    outcome: 'completed' | 'failed';
    result?: string;
    error?: string;
}

function asMetadata(task: OrchestratorTask): DelegatedTaskMetadata {
    const metadata = task.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }

    return metadata as DelegatedTaskMetadata;
}

export function buildDelegatedTaskFollowupAction(options: DelegatedTaskFollowupOptions): Action | null {
    const metadata = asMetadata(options.task);
    const replyContext = metadata.replyContext;
    const source = String(replyContext?.source || '').trim();
    const sourceId = String(replyContext?.sourceId || replyContext?.chatId || '').trim();

    if (!metadata.notifyParent || !source) {
        return null;
    }

    if (source !== 'gateway-chat' && !sourceId) {
        return null;
    }

    const workerLabel = String(options.workerName || options.agentId).trim();
    const originalRequest = String(metadata.originalRequest || '').trim();
    const delegatedDescription = String(metadata.delegatedDescription || options.task.description || '').trim();
    const detail = String(
        options.outcome === 'completed'
            ? options.result || options.task.result || 'Task completed successfully.'
            : options.error || options.task.error || 'Task failed.'
    ).trim();

    const description = [
        `A delegated worker has ${options.outcome} a subtask for the user. Send a direct final update in the original channel now.`,
        originalRequest ? `Original user request: ${originalRequest}` : '',
        delegatedDescription ? `Delegated subtask: ${delegatedDescription}` : '',
        `Worker: ${workerLabel} (${options.agentId})`,
        `Outcome: ${options.outcome}`,
        `${options.outcome === 'completed' ? 'Worker result' : 'Worker error'}: ${detail}`,
        'Requirements:',
        '- Reply directly to the user with the useful outcome.',
        '- Do not say you will report back later.',
        '- If the worker failed, explain the failure plainly and mention any partial progress if known.'
    ].filter(Boolean).join('\n');

    return {
        id: `delegated-followup-${options.task.id}-${Date.now()}`,
        type: 'TASK',
        payload: {
            description,
            source,
            sourceId: source === 'gateway-chat' ? (sourceId || 'gateway-web') : sourceId,
            chatId: replyContext?.chatId || sourceId,
            userId: replyContext?.userId,
            senderName: replyContext?.senderName,
            sessionScopeId: replyContext?.sessionScopeId,
            subject: replyContext?.subject,
            inReplyTo: replyContext?.inReplyTo,
            references: replyContext?.references,
            isAdmin: replyContext?.isAdmin,
            suppressProgressFeedback: true,
            delegatedFollowup: true,
            delegatedTaskId: options.task.id,
            delegatedTaskDescription: delegatedDescription,
            delegatedTaskOutcome: options.outcome,
            delegatedTaskResult: detail,
            delegatedAgentId: options.agentId,
            delegatedAgentName: workerLabel,
            delegatedKind: metadata.delegationKind,
            delegatedOriginalRequest: originalRequest || delegatedDescription
        },
        priority: Math.max(8, Number(options.task.priority) || 8),
        lane: 'user',
        status: 'pending',
        timestamp: new Date().toISOString()
    };
}