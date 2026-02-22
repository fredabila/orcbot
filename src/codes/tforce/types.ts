export interface TForceIncident {
    actionId: string;
    step: number;
    source: 'decision' | 'tool' | 'system';
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
}

export interface TForceContext {
    actionId: string;
    description: string;
    step: number;
    noToolSteps: number;
    recentTools: string[];
    lastError?: string;
}
