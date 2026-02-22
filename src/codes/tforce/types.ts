export interface TForceIncident {
    actionId: string;
    step: number;
    source: 'decision' | 'tool' | 'system' | 'guardrail';
    summary: string;
    error?: string;
    metadata?: Record<string, any>;
    timestamp: string;
}

export interface TForceSnapshot {
    actionId: string;
    step: number;
    conscienceGuidance: string;
    recoveryPlan: string[];
    memoryHighlights: string[];
    shouldEscalate: boolean;
    complexityScore?: number; // 0-100
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface TForceContext {
    actionId: string;
    description: string;
    step: number;
    noToolSteps: number;
    recentTools: string[];
    lastError?: string;
    totalDurationMs?: number;
    messagesSent?: number;
    consecutiveFailures?: number;
}
