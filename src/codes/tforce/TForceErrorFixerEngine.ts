export class TForceErrorFixerEngine {
    buildRecoveryPlan(errorText: string | undefined, description: string): string[] {
        if (!errorText) {
            return ['Standard Path: Execute the next planned step and verify state transitions.'];
        }

        const normalized = errorText.toLowerCase();
        const plan: string[] = [
            `CRITICAL OBJECTIVE: ${description.slice(0, 80)}...`,
            'DIAGNOSTIC: Run a "dry-run" or "list" command to verify environment assumptions (paths, permissions, variables).'
        ];

        // 1. Connectivity / API Errors
        if (normalized.includes('timeout') || normalized.includes('fetch') || normalized.includes('network') || normalized.includes('econn')) {
            plan.push('NETWORK RECOVERY: Check connectivity using a simple ping/curl. If down, wait 30s or use a local fallback tool.');
            plan.push('STRATEGY: Reduce payload size or increase timeout parameters in the next tool call.');
        }
        
        // 2. Resource Errors
        else if (normalized.includes('not found') || normalized.includes('enoent') || normalized.includes('directory')) {
            plan.push('RESOURCE RECOVERY: The target file/dir is missing. Use "ls" or "find" to locate it before retrying.');
            plan.push('FIX: If it should exist, create it. If it moved, update your path references.');
        }

        // 3. Permission Errors
        else if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('eacces')) {
            plan.push('AUTH RECOVERY: You lack permissions. Check if you are in the correct directory or if sudo is allowed.');
            plan.push('ALTERNATIVE: Find a path you own (e.g. workspace/temp) or use a different tool that doesn\'t require elevation.');
        }

        // 4. Rate Limiting
        else if (normalized.includes('429') || normalized.includes('rate limit') || normalized.includes('too many requests')) {
            plan.push('CAPACITY RECOVERY: You are being rate-limited. Switch to a DIFFERENT provider/model if available, or schedule a retry.');
        }

        // 5. Syntax / Validation
        else if (normalized.includes('syntax') || normalized.includes('unexpected') || normalized.includes('invalid')) {
            plan.push('VALIDATION RECOVERY: Your last command had a syntax error. Re-read the tool documentation and escape special characters.');
        }

        plan.push('TERMINATION RULE: If this fix fails, report the EXACT error string to the user and request manual intervention.');
        return plan;
    }
}
