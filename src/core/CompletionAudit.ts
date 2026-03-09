// ─────────────────────────────────────────────────────────────
// Step Ledger — structured log of every tool call in an action
// ─────────────────────────────────────────────────────────────

export interface StepLedgerEntry {
    step: number;
    tool: string;
    args?: string;            // first 200 chars of serialized args
    success: boolean;
    isDeep: boolean;           // work tool (run_command, web_search, etc.)
    isSideEffect: boolean;     // user-facing send_* tool
    resultSnippet?: string;    // first 200 chars of result
    errorSnippet?: string;     // first 200 chars of error (if failed)
    timestamp: number;
}

export class StepLedger {
    private entries: StepLedgerEntry[] = [];

    record(entry: StepLedgerEntry): void {
        this.entries.push(entry);
    }

    /** All entries in chronological order */
    all(): ReadonlyArray<StepLedgerEntry> {
        return this.entries;
    }

    /** Entries for a specific tool */
    forTool(name: string): StepLedgerEntry[] {
        return this.entries.filter(e => e.tool === name);
    }

    /** Last N entries */
    last(n: number): StepLedgerEntry[] {
        return this.entries.slice(-n);
    }

    /** Deep-work entries only */
    deepWork(): StepLedgerEntry[] {
        return this.entries.filter(e => e.isDeep && !e.isSideEffect);
    }

    /** Side-effect (user-facing send) entries only */
    sideEffects(): StepLedgerEntry[] {
        return this.entries.filter(e => e.isSideEffect);
    }

    get size(): number {
        return this.entries.length;
    }

    /**
     * Build a concise human-readable summary of the action's execution.
     * Used by the delivery audit and potentially by the LLM for self-review.
     */
    summarize(): string {
        if (this.entries.length === 0) return 'No tools were executed.';

        const deepCalls = this.deepWork();
        const sends = this.sideEffects();
        const deepSuccesses = deepCalls.filter(e => e.success);
        const deepFailures = deepCalls.filter(e => !e.success);
        const sendSuccesses = sends.filter(e => e.success);

        const lines: string[] = [];
        lines.push(`Total tool calls: ${this.entries.length}`);
        lines.push(`Deep work: ${deepCalls.length} (${deepSuccesses.length} ok, ${deepFailures.length} failed)`);
        lines.push(`User messages: ${sends.length} (${sendSuccesses.length} delivered)`);

        if (deepFailures.length > 0) {
            const failedTools = [...new Set(deepFailures.map(e => e.tool))];
            lines.push(`Failed work tools: ${failedTools.join(', ')}`);
            const lastFailure = deepFailures[deepFailures.length - 1];
            if (lastFailure.errorSnippet) {
                lines.push(`Last failure: ${lastFailure.tool} — ${lastFailure.errorSnippet}`);
            }
        }

        // Check if any deep work succeeded AFTER the failures
        if (deepFailures.length > 0 && deepSuccesses.length > 0) {
            const lastFailStep = Math.max(...deepFailures.map(e => e.step));
            const recoveredAfter = deepSuccesses.some(e => e.step > lastFailStep);
            if (recoveredAfter) {
                lines.push('Recovery: deep work succeeded after earlier failures.');
            } else {
                lines.push('No recovery: all deep work successes occurred before the failures.');
            }
        }

        return lines.join('\n');
    }
}

// ─────────────────────────────────────────────────────────────
// Delivery Audit — deterministic check of actual vs expected
// ─────────────────────────────────────────────────────────────

export interface DeliveryAuditInput {
    ledger: StepLedger;
    taskDescription: string;
    isChannelTask: boolean;
    sentMessagesInAction: string[];
    substantiveDeliveriesSent: number;
    isLikelyAcknowledgementMessage: (msg: string) => boolean;
}

export interface DeliveryAuditResult {
    delivered: boolean;
    reason: string;
    summary: string;            // ledger summary for logging
    unresolvedFailures: boolean; // deep tools failed without later recovery
    onlySentStatusMessages: boolean;
}

/**
 * Reads the step ledger to determine whether the action truly delivered
 * on the task or just sent status/acknowledgement messages.
 *
 * This replaces the flag-based heuristics with a concrete log comparison.
 */
export function auditDelivery(input: DeliveryAuditInput): DeliveryAuditResult {
    const { ledger, isChannelTask, sentMessagesInAction, substantiveDeliveriesSent } = input;
    const summary = ledger.summarize();

    // Non-channel tasks (autonomy, internal) — different expectations
    if (!isChannelTask) {
        const deepWork = ledger.deepWork();
        const deepFailures = deepWork.filter(e => !e.success);
        const deepSuccesses = deepWork.filter(e => e.success);
        const unresolvedFailures = deepFailures.length > 0 &&
            !deepSuccesses.some(s => s.step > Math.max(...deepFailures.map(f => f.step)));
        return {
            delivered: !unresolvedFailures || deepSuccesses.length > 0,
            reason: unresolvedFailures ? 'Deep work tools failed without recovery' : 'Non-channel task completed',
            summary,
            unresolvedFailures,
            onlySentStatusMessages: false,
        };
    }

    // ── Channel task audit ──

    const deepWork = ledger.deepWork();
    const sends = ledger.sideEffects();
    const deepFailures = deepWork.filter(e => !e.success);
    const deepSuccesses = deepWork.filter(e => e.success);

    // 1. No tools ran at all
    if (ledger.size === 0) {
        return {
            delivered: false,
            reason: 'No tools were executed at all',
            summary,
            unresolvedFailures: false,
            onlySentStatusMessages: false,
        };
    }

    // 2. Check if deep work failures were resolved by later successes
    const lastFailStep = deepFailures.length > 0 ? Math.max(...deepFailures.map(e => e.step)) : -1;
    const recoveredAfterFailure = deepFailures.length > 0 &&
        deepSuccesses.some(s => s.step > lastFailStep);
    const unresolvedFailures = deepFailures.length > 0 && !recoveredAfterFailure;

    // 3. Check message quality — were messages just status/acknowledgements?
    const allMessagesAreStatus = sentMessagesInAction.length > 0 &&
        sentMessagesInAction.every(msg => input.isLikelyAcknowledgementMessage(msg));
    const onlySentStatusMessages = sends.length > 0 && substantiveDeliveriesSent === 0 && allMessagesAreStatus;

    // 4. Key question: did the action do real work AND deliver results?
    //    Pattern: tool failed → sent "I'm investigating" → went idle
    if (unresolvedFailures && (sends.length === 0 || onlySentStatusMessages)) {
        return {
            delivered: false,
            reason: `Deep work failed (${deepFailures.length} failures) and only status messages were sent — task not actually completed`,
            summary,
            unresolvedFailures: true,
            onlySentStatusMessages,
        };
    }

    // 5. Deep work failed but substantive message was sent (user got a real answer)
    if (unresolvedFailures && substantiveDeliveriesSent > 0) {
        return {
            delivered: true,
            reason: 'Deep work had failures but substantive delivery was sent to user',
            summary,
            unresolvedFailures: true,
            onlySentStatusMessages: false,
        };
    }

    // 6. No deep work was attempted (pure conversation / simple response)
    if (deepWork.length === 0 && sends.length > 0) {
        return {
            delivered: substantiveDeliveriesSent > 0 || !allMessagesAreStatus,
            reason: 'No deep work needed; response sent directly',
            summary,
            unresolvedFailures: false,
            onlySentStatusMessages: allMessagesAreStatus,
        };
    }

    // 7. Deep work succeeded and messages sent
    if (deepSuccesses.length > 0 && substantiveDeliveriesSent > 0) {
        return {
            delivered: true,
            reason: 'Deep work succeeded and substantive delivery was sent',
            summary,
            unresolvedFailures: false,
            onlySentStatusMessages: false,
        };
    }

    // 8. Deep work succeeded but nothing sent to user
    if (deepSuccesses.length > 0 && sends.length === 0) {
        return {
            delivered: false,
            reason: 'Deep work succeeded but no message was sent to the user',
            summary,
            unresolvedFailures: false,
            onlySentStatusMessages: false,
        };
    }

    // 9. Fallback: if we have substantive deliveries, consider it delivered
    if (substantiveDeliveriesSent > 0) {
        return {
            delivered: true,
            reason: 'Substantive delivery was sent',
            summary,
            unresolvedFailures,
            onlySentStatusMessages: false,
        };
    }

    return {
        delivered: false,
        reason: 'No substantive delivery detected and work may be incomplete',
        summary,
        unresolvedFailures,
        onlySentStatusMessages,
    };
}

// ─────────────────────────────────────────────────────────────
// Original counter-based audit (kept for backwards compat)
// ─────────────────────────────────────────────────────────────

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