import { describe, expect, it } from 'vitest';
import { auditDelivery, collectCompletionAuditIssues, StepLedger } from '../src/core/CompletionAudit';

describe('collectCompletionAuditIssues', () => {
    const isAcknowledgement = (message: string) => /^(on it|working on it|got it|hang tight|one moment)/i.test(message.trim());

    it('flags silent completion when no message was sent', () => {
        const issues = collectCompletionAuditIssues({
            isChannelTask: true,
            messagesSent: 0,
            substantiveDeliveriesSent: 0,
            deepToolExecutedSinceLastMessage: false,
            sentMessagesInAction: [],
            taskComplexity: 'complex',
            isLikelyAcknowledgementMessage: isAcknowledgement
        });

        expect(issues).toContain('No user-visible message was sent for this channel task.');
    });

    it('flags status-only completion after deep work', () => {
        const issues = collectCompletionAuditIssues({
            isChannelTask: true,
            messagesSent: 1,
            substantiveDeliveriesSent: 0,
            deepToolExecutedSinceLastMessage: true,
            sentMessagesInAction: ['On it. Working on your request now...'],
            taskComplexity: 'complex',
            isLikelyAcknowledgementMessage: isAcknowledgement
        });

        expect(issues).toContain('Only acknowledgement/status-style messages were sent before completion.');
        expect(issues).toContain('Deep/research tools ran after the last user-facing update, but no substantive delivery was sent.');
    });

    it('does not block when a substantive final delivery exists', () => {
        const issues = collectCompletionAuditIssues({
            isChannelTask: true,
            messagesSent: 2,
            substantiveDeliveriesSent: 1,
            deepToolExecutedSinceLastMessage: false,
            sentMessagesInAction: ['On it.', 'Done. I filled and submitted the form successfully.'],
            taskComplexity: 'complex',
            isLikelyAcknowledgementMessage: isAcknowledgement
        });

        expect(issues).toEqual([]);
    });

    it('does not flag loop-detected silent termination', () => {
        const issues = collectCompletionAuditIssues({
            isChannelTask: true,
            messagesSent: 0,
            substantiveDeliveriesSent: 0,
            deepToolExecutedSinceLastMessage: false,
            sentMessagesInAction: [],
            taskComplexity: 'complex',
            loopDetected: true,
            isLikelyAcknowledgementMessage: isAcknowledgement
        });

        expect(issues).toEqual([]);
    });

    it('marks channel work incomplete when deep work finishes after the last user message', () => {
        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            timestamp: 1000,
            resultSnippet: 'On it. Installing now.'
        });
        ledger.record({
            step: 1,
            tool: 'install_skill',
            success: true,
            isDeep: true,
            isSideEffect: false,
            timestamp: 2000,
            resultSnippet: 'Installed skill successfully'
        });
        ledger.record({
            step: 2,
            tool: 'validate_skill',
            success: true,
            isDeep: true,
            isSideEffect: false,
            timestamp: 3000,
            resultSnippet: 'Validated skill successfully'
        });

        const result = auditDelivery({
            ledger,
            taskDescription: 'Install stripe skill and report back',
            isChannelTask: true,
            sentMessagesInAction: ['On it. I am installing that skill now, then I will tell you what info I need.'],
            substantiveDeliveriesSent: 1,
            isLikelyAcknowledgementMessage: isAcknowledgement,
        });

        expect(result.delivered).toBe(false);
        expect(result.reason).toContain('no final completion update was sent');
    });
});