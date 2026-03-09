import fs from 'fs';
import path from 'path';
import { JSONAdapter } from '../storage/JSONAdapter';

export interface TrainingTrajectoryStep {
    step: number;
    tool: string;
    success: boolean;
    isDeep: boolean;
    isSideEffect: boolean;
    args?: string;
    resultSnippet?: string;
    errorSnippet?: string;
    timestamp: number;
}

export interface TrainingTrajectory {
    id: string;
    actionId: string;
    timestamp: string;
    taskDescription: string;
    source?: string;
    sourceId?: string;
    sessionScopeId?: string;
    lane?: 'user' | 'autonomy';
    modelName?: string;
    provider?: string;
    actionStatus: 'completed' | 'failed';
    goalsMet: boolean;
    isUserFacingAction: boolean;
    messagesSent: number;
    substantiveDeliveriesSent: number;
    qualityScore: number;
    acceptedForTraining: boolean;
    acceptanceReason: string;
    deliveryAudit: {
        delivered: boolean;
        reason: string;
        unresolvedFailures: boolean;
        onlySentStatusMessages: boolean;
    };
    finalMessages: string[];
    finalDelivery?: string;
    skillCallCounts: Record<string, number>;
    steps: TrainingTrajectoryStep[];
}

export interface TrajectoryStats {
    total: number;
    accepted: number;
    rejected: number;
    lastCapturedAt?: string;
    lastAcceptedAt?: string;
    averageQualityScore: number;
}

interface JsonlRecord {
    instruction: string;
    response: string;
    metadata: Record<string, any>;
}

export class TrajectoryStore {
    private storage: JSONAdapter;
    private exportPath: string;
    private filePath: string;
    private maxTrajectories: number;

    constructor(options: { filePath: string; exportPath: string; maxTrajectories?: number }) {
        fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
        fs.mkdirSync(path.dirname(options.exportPath), { recursive: true });
        this.filePath = options.filePath;
        this.storage = new JSONAdapter(options.filePath);
        this.exportPath = options.exportPath;
        this.maxTrajectories = options.maxTrajectories || 1000;
    }

    public saveTrajectory(trajectory: TrainingTrajectory): void {
        const existing = this.getTrajectories();
        const next = [...existing, trajectory].slice(-this.maxTrajectories);
        this.storage.save('trajectories', next);
        this.storage.flush();
        this.rewriteExport(next);
    }

    public getTrajectories(): TrainingTrajectory[] {
        return this.storage.get('trajectories') || [];
    }

    public getAcceptedTrajectories(): TrainingTrajectory[] {
        return this.getTrajectories().filter(trajectory => trajectory.acceptedForTraining && !!trajectory.finalDelivery);
    }

    public getStats(): TrajectoryStats {
        const trajectories = this.getTrajectories();
        const accepted = trajectories.filter(trajectory => trajectory.acceptedForTraining);
        const totalScore = trajectories.reduce((sum, trajectory) => sum + (trajectory.qualityScore || 0), 0);
        return {
            total: trajectories.length,
            accepted: accepted.length,
            rejected: trajectories.length - accepted.length,
            lastCapturedAt: trajectories[trajectories.length - 1]?.timestamp,
            lastAcceptedAt: accepted[accepted.length - 1]?.timestamp,
            averageQualityScore: trajectories.length > 0 ? Number((totalScore / trajectories.length).toFixed(3)) : 0,
        };
    }

    public getFilePath(): string {
        return this.filePath;
    }

    public getExportPath(): string {
        return this.exportPath;
    }

    private rewriteExport(trajectories: TrainingTrajectory[]): void {
        const accepted = trajectories.filter(t => t.acceptedForTraining && t.finalDelivery);
        const lines = accepted.map(t => JSON.stringify(this.toJsonlRecord(t))).join('\n');
        fs.writeFileSync(this.exportPath, lines ? `${lines}\n` : '', 'utf-8');
    }

    private toJsonlRecord(trajectory: TrainingTrajectory): JsonlRecord {
        return {
            instruction: trajectory.taskDescription,
            response: trajectory.finalDelivery || trajectory.finalMessages[trajectory.finalMessages.length - 1] || '',
            metadata: {
                actionId: trajectory.actionId,
                timestamp: trajectory.timestamp,
                source: trajectory.source,
                sourceId: trajectory.sourceId,
                sessionScopeId: trajectory.sessionScopeId,
                lane: trajectory.lane,
                modelName: trajectory.modelName,
                provider: trajectory.provider,
                qualityScore: trajectory.qualityScore,
                messagesSent: trajectory.messagesSent,
                substantiveDeliveriesSent: trajectory.substantiveDeliveriesSent,
                deliveryAudit: trajectory.deliveryAudit,
                tools: trajectory.steps.map(step => ({
                    step: step.step,
                    tool: step.tool,
                    success: step.success,
                })),
            }
        };
    }
}