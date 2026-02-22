export class TForceErrorFixerEngine {
    buildRecoveryPlan(errorText: string | undefined, description: string): string[] {
        if (!errorText) {
            return ['Execute one low-risk step that advances the task and verify output before continuing.'];
        }

        const normalized = errorText.toLowerCase();
        const plan: string[] = [
            `Re-state the failing objective in one sentence: ${description.slice(0, 120)}`,
            'Capture exact error output and identify the first failing boundary (input, tool call, or environment).'
        ];

        if (normalized.includes('timeout')) {
            plan.push('Retry with reduced scope or a shorter command/runtime, then checkpoint progress.');
        }
        if (normalized.includes('not found') || normalized.includes('enoent')) {
            plan.push('Validate path/resource existence before retrying and create missing prerequisites if safe.');
        }
        if (normalized.includes('permission') || normalized.includes('denied')) {
            plan.push('Switch to a permitted approach and avoid privileged operations unless explicitly configured.');
        }

        plan.push('If two retries fail, emit a concise blocker summary and request/queue fallback path.');
        return plan.slice(0, 5);
    }
}
