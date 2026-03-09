export interface CompletionAuditInput {
    isChannelTask: boolean;
    messagesSent: number;
    substantiveDeliveriesSent: number;
    deepToolExecutedSinceLastMessage: boolean;
    sentMessagesInAction: string[];
    taskComplexity?: string;
    loopDetected?: boolean;
    isLikelyAcknowledgementMessage: (message: string) => boolean;
}

export function collectCompletionAuditIssues(input: CompletionAuditInput): string[] {
    if (!input.isChannelTask) {
        return [];
    }

    const issues: string[] = [];
    const messagesSent = Math.max(0, Number(input.messagesSent || 0));
    const substantiveDeliveriesSent = Math.max(0, Number(input.substantiveDeliveriesSent || 0));
    const sentMessagesInAction = Array.isArray(input.sentMessagesInAction) ? input.sentMessagesInAction : [];
    const hasSentMessages = sentMessagesInAction.length > 0;
    const onlyAcknowledgements = hasSentMessages && sentMessagesInAction.every(message => input.isLikelyAcknowledgementMessage(message));
    const taskComplexity = String(input.taskComplexity || 'standard').toLowerCase();
    const isComplexTask = !['trivial', 'simple'].includes(taskComplexity);

    if (messagesSent === 0) {
        if (!input.loopDetected) {
            issues.push('No user-visible message was sent for this channel task.');
        }
        return issues;
    }

    if (substantiveDeliveriesSent === 0 && onlyAcknowledgements && isComplexTask) {
        issues.push('Only acknowledgement/status-style messages were sent before completion.');
    }

    if (substantiveDeliveriesSent === 0 && input.deepToolExecutedSinceLastMessage && isComplexTask) {
        issues.push('Deep/research tools ran after the last user-facing update, but no substantive delivery was sent.');
    }

    return issues;
}