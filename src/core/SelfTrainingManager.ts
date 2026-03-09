import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Action } from '../memory/ActionQueue';
import { MultiLLM, LLMProvider } from './MultiLLM';
import { DeliveryAuditResult, StepLedger } from './CompletionAudit';
import { SelfTrainingEvalReport, SelfTrainingEvalRunner } from './SelfTrainingEvalRunner';
import { TrajectoryStore, TrainingTrajectory, TrainingTrajectoryStep } from './TrajectoryStore';

export interface SelfTrainingCaptureInput {
    action: Action;
    actionStatus: 'completed' | 'failed';
    goalsMet: boolean;
    currentStep: number;
    messagesSent: number;
    substantiveDeliveriesSent: number;
    sentMessagesInAction: string[];
    stepLedger: StepLedger;
    deliveryAudit: DeliveryAuditResult;
    isUserFacingAction: boolean;
    modelName?: string;
    provider?: string;
    skillCallCounts?: Record<string, number>;
    isLikelyAcknowledgementMessage?: (message: string) => boolean;
}

export interface SelfTrainingCaptureResult {
    captured: boolean;
    accepted: boolean;
    reason: string;
    qualityScore?: number;
    trajectoryId?: string;
}

export interface PreparedTrainingJob {
    id: string;
    createdAt: string;
    status: 'prepared';
    acceptedTrajectoryCount: number;
    datasetFingerprint: string;
    exportPath: string;
    storePath: string;
    recommendedProvider?: string;
    recommendedModel?: string;
    trajectoryIds: string[];
    notes: string[];
}

export interface SelfTrainingCandidateModel {
    id: string;
    registeredAt: string;
    modelName: string;
    provider?: string;
    sourceJobId?: string;
    sourceLaunchSessionId?: string;
    evaluationAverageScore?: number;
    evaluationPassRate?: number;
    evaluationPassThreshold?: number;
    evaluationMatched: boolean;
    launchMatched: boolean;
    notes: string[];
    status: 'registered' | 'promoted';
    promotedAt?: string;
}

export interface SelfTrainingPromotionRecord {
    promotedAt: string;
    candidateId: string;
    modelName: string;
    provider?: string;
    previousModelName?: string;
    previousProvider?: string;
    evaluationAverageScore?: number;
    evaluationPassRate?: number;
    evaluationPassThreshold?: number;
}

export interface SelfTrainingStatus {
    enabled: boolean;
    trainOnIdle: boolean;
    minQualityScore: number;
    minAcceptedExamples: number;
    promotionMinAverageScore: number;
    requireEvalForPromotion: boolean;
    stats: {
        total: number;
        accepted: number;
        rejected: number;
        lastCapturedAt?: string;
        lastAcceptedAt?: string;
        averageQualityScore: number;
    };
    paths: {
        storePath: string;
        exportPath: string;
        jobManifestPath: string;
        evalReportPath: string;
        launchRecordPath: string;
        candidateRegistryPath: string;
        promotionRecordPath: string;
    };
    lastPreparedJob?: PreparedTrainingJob;
    lastEvaluationReport?: SelfTrainingEvalReport;
    lastLaunchRecord?: LaunchedTrainingJobRecord;
    lastPromotionRecord?: SelfTrainingPromotionRecord;
    candidates: SelfTrainingCandidateModel[];
}

export interface PrepareTrainingJobResult {
    prepared: boolean;
    reason: string;
    job?: PreparedTrainingJob;
}

export interface RunEvaluationOptions {
    limit?: number;
    provider?: LLMProvider;
    modelName?: string;
    generateCandidate?: (trajectory: TrainingTrajectory) => Promise<string> | string;
}

export interface PreparedTrainingLaunchPlan {
    jobId: string;
    sessionId: string;
    command: string;
    cwd: string;
    jobManifestPath: string;
    exportPath: string;
    storePath: string;
    recommendedProvider?: string;
    recommendedModel?: string;
}

export interface LaunchPlanResult {
    ready: boolean;
    reason: string;
    plan?: PreparedTrainingLaunchPlan;
}

export interface LaunchedTrainingJobRecord {
    launchedAt: string;
    jobId: string;
    sessionId: string;
    command: string;
    cwd: string;
    pid?: number;
}

export interface RegisterCandidateModelInput {
    candidateId?: string;
    modelName: string;
    provider?: string;
    jobId?: string;
    notes?: string[];
}

export interface RegisterCandidateModelResult {
    registered: boolean;
    reason: string;
    candidate?: SelfTrainingCandidateModel;
}

export interface PromotionDecision {
    eligible: boolean;
    reason: string;
    candidate?: SelfTrainingCandidateModel;
    recommendedConfig?: {
        modelName: string;
        provider?: string;
    };
}

export interface BuildLaunchPlanOptions {
    commandTemplate?: string;
    cwd?: string;
    sessionId?: string;
}

export class SelfTrainingManager {
    private enabled: boolean;
    private redactSensitiveData: boolean;
    private minQualityScore: number;
    private store: TrajectoryStore;
    private modelName?: string;
    private provider?: string;
    private trainOnIdle: boolean;
    private minAcceptedExamples: number;
    private preparationCooldownMinutes: number;
    private jobManifestPath: string;
    private lastPreparedJob: PreparedTrainingJob | null = null;
    private evalReportPath: string;
    private evalPassThreshold: number;
    private evalSampleSize: number;
    private lastEvaluationReport: SelfTrainingEvalReport | null = null;
    private launchCommandTemplate?: string;
    private launchCwd?: string;
    private launchSessionPrefix: string;
    private launchRecordPath: string;
    private lastLaunchRecord: LaunchedTrainingJobRecord | null = null;
    private candidateRegistryPath: string;
    private candidates: SelfTrainingCandidateModel[] = [];
    private promotionRecordPath: string;
    private lastPromotionRecord: SelfTrainingPromotionRecord | null = null;
    private promotionMinAverageScore: number;
    private requireEvalForPromotion: boolean;

    constructor(options: {
        enabled: boolean;
        redactSensitiveData: boolean;
        minQualityScore: number;
        maxTrajectories?: number;
        storePath: string;
        exportPath: string;
        trainOnIdle?: boolean;
        minAcceptedExamples?: number;
        preparationCooldownMinutes?: number;
        jobManifestPath?: string;
        evalReportPath?: string;
        evalPassThreshold?: number;
        evalSampleSize?: number;
        launchCommandTemplate?: string;
        launchCwd?: string;
        launchSessionPrefix?: string;
        launchRecordPath?: string;
        candidateRegistryPath?: string;
        promotionRecordPath?: string;
        promotionMinAverageScore?: number;
        requireEvalForPromotion?: boolean;
        modelName?: string;
        provider?: string;
    }) {
        this.enabled = options.enabled;
        this.redactSensitiveData = options.redactSensitiveData;
        this.minQualityScore = options.minQualityScore;
        this.modelName = options.modelName;
        this.provider = options.provider;
        this.trainOnIdle = options.trainOnIdle !== false;
        this.minAcceptedExamples = options.minAcceptedExamples || 25;
        this.preparationCooldownMinutes = options.preparationCooldownMinutes || 60;
        this.jobManifestPath = options.jobManifestPath || path.join(path.dirname(options.storePath), 'self-training-job.json');
        this.evalReportPath = options.evalReportPath || path.join(path.dirname(options.storePath), 'self-training-eval-report.json');
        this.evalPassThreshold = options.evalPassThreshold || 0.55;
        this.evalSampleSize = options.evalSampleSize || 10;
        this.launchCommandTemplate = options.launchCommandTemplate;
        this.launchCwd = options.launchCwd;
        this.launchSessionPrefix = options.launchSessionPrefix || 'self-train';
        this.launchRecordPath = options.launchRecordPath || path.join(path.dirname(options.storePath), 'self-training-launch.json');
        this.candidateRegistryPath = options.candidateRegistryPath || path.join(path.dirname(options.storePath), 'self-training-candidates.json');
        this.promotionRecordPath = options.promotionRecordPath || path.join(path.dirname(options.storePath), 'self-training-promotion.json');
        this.promotionMinAverageScore = options.promotionMinAverageScore || 0.7;
        this.requireEvalForPromotion = options.requireEvalForPromotion !== false;
        this.store = new TrajectoryStore({
            filePath: options.storePath,
            exportPath: options.exportPath,
            maxTrajectories: options.maxTrajectories,
        });
        fs.mkdirSync(path.dirname(this.jobManifestPath), { recursive: true });
        this.lastPreparedJob = this.loadLastPreparedJob();
        this.lastEvaluationReport = this.loadLastEvaluationReport();
        this.lastLaunchRecord = this.loadLastLaunchRecord();
        this.candidates = this.loadCandidates();
        this.lastPromotionRecord = this.loadLastPromotionRecord();
    }

    public updateRuntimeConfig(options: {
        enabled?: boolean;
        minQualityScore?: number;
        trainOnIdle?: boolean;
        minAcceptedExamples?: number;
        preparationCooldownMinutes?: number;
        evalPassThreshold?: number;
        evalSampleSize?: number;
        launchCommandTemplate?: string;
        launchCwd?: string;
        modelName?: string;
        provider?: string;
        promotionMinAverageScore?: number;
        requireEvalForPromotion?: boolean;
    }): void {
        if (options.enabled !== undefined) this.enabled = options.enabled;
        if (options.minQualityScore !== undefined) this.minQualityScore = options.minQualityScore;
        if (options.trainOnIdle !== undefined) this.trainOnIdle = options.trainOnIdle;
        if (options.minAcceptedExamples !== undefined) this.minAcceptedExamples = options.minAcceptedExamples;
        if (options.preparationCooldownMinutes !== undefined) this.preparationCooldownMinutes = options.preparationCooldownMinutes;
        if (options.evalPassThreshold !== undefined) this.evalPassThreshold = options.evalPassThreshold;
        if (options.evalSampleSize !== undefined) this.evalSampleSize = options.evalSampleSize;
        if (options.launchCommandTemplate !== undefined) this.launchCommandTemplate = options.launchCommandTemplate;
        if (options.launchCwd !== undefined) this.launchCwd = options.launchCwd;
        if (options.modelName !== undefined) this.modelName = options.modelName;
        if (options.provider !== undefined) this.provider = options.provider;
        if (options.promotionMinAverageScore !== undefined) this.promotionMinAverageScore = options.promotionMinAverageScore;
        if (options.requireEvalForPromotion !== undefined) this.requireEvalForPromotion = options.requireEvalForPromotion;
    }

    public captureCompletedAction(input: SelfTrainingCaptureInput): SelfTrainingCaptureResult {
        if (!this.enabled) {
            return { captured: false, accepted: false, reason: 'self_training_disabled' };
        }

        const taskDescription = String(input.action.payload?.description || input.action.payload?.task || '').trim();
        if (!taskDescription || input.action.payload?.isHeartbeat) {
            return { captured: false, accepted: false, reason: 'non_trainable_action' };
        }

        const steps = input.stepLedger.all().map(entry => this.redactStep(entry));
        const finalMessages = input.sentMessagesInAction.map(message => this.redactText(message, 1200));
        const finalDelivery = this.selectFinalDelivery(finalMessages, input.isLikelyAcknowledgementMessage);
        const qualityScore = this.computeQualityScore(input, steps, finalDelivery);
        const acceptance = this.evaluateAcceptance(input, qualityScore, finalDelivery);
        const trajectoryId = this.buildId(input.action.id, taskDescription);

        const trajectory: TrainingTrajectory = {
            id: trajectoryId,
            actionId: input.action.id,
            timestamp: new Date().toISOString(),
            taskDescription: this.redactText(taskDescription, 1600) || '',
            source: input.action.payload?.source,
            sourceId: input.action.payload?.sourceId,
            sessionScopeId: input.action.payload?.sessionScopeId,
            lane: input.action.lane,
            modelName: input.modelName || this.modelName,
            provider: input.provider || this.provider,
            actionStatus: input.actionStatus,
            goalsMet: input.goalsMet,
            isUserFacingAction: input.isUserFacingAction,
            messagesSent: input.messagesSent,
            substantiveDeliveriesSent: input.substantiveDeliveriesSent,
            qualityScore,
            acceptedForTraining: acceptance.accepted,
            acceptanceReason: acceptance.reason,
            deliveryAudit: {
                delivered: input.deliveryAudit.delivered,
                reason: this.redactText(input.deliveryAudit.reason, 300) || '',
                unresolvedFailures: input.deliveryAudit.unresolvedFailures,
                onlySentStatusMessages: input.deliveryAudit.onlySentStatusMessages,
            },
            finalMessages: finalMessages.filter((message): message is string => !!message),
            finalDelivery,
            skillCallCounts: { ...(input.skillCallCounts || {}) },
            steps,
        };

        this.store.saveTrajectory(trajectory);

        return {
            captured: true,
            accepted: acceptance.accepted,
            reason: acceptance.reason,
            qualityScore,
            trajectoryId,
        };
    }

    public prepareTrainingJobIfNeeded(): PrepareTrainingJobResult {
        if (!this.enabled) {
            return { prepared: false, reason: 'self_training_disabled' };
        }
        if (!this.trainOnIdle) {
            return { prepared: false, reason: 'train_on_idle_disabled' };
        }

        const accepted = this.store.getAcceptedTrajectories();
        if (accepted.length < this.minAcceptedExamples) {
            return { prepared: false, reason: 'not_enough_accepted_examples' };
        }

        const fingerprint = this.buildDatasetFingerprint(accepted);
        if (this.lastPreparedJob?.datasetFingerprint === fingerprint) {
            return { prepared: false, reason: 'dataset_unchanged' };
        }

        if (this.lastPreparedJob?.createdAt) {
            const elapsedMinutes = (Date.now() - new Date(this.lastPreparedJob.createdAt).getTime()) / 60000;
            if (elapsedMinutes < this.preparationCooldownMinutes) {
                return { prepared: false, reason: 'preparation_cooldown_active' };
            }
        }

        const job: PreparedTrainingJob = {
            id: `trainjob-${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12)}`,
            createdAt: new Date().toISOString(),
            status: 'prepared',
            acceptedTrajectoryCount: accepted.length,
            datasetFingerprint: fingerprint,
            exportPath: this.store.getExportPath(),
            storePath: this.store.getFilePath(),
            recommendedProvider: this.provider,
            recommendedModel: this.modelName,
            trajectoryIds: accepted.map(trajectory => trajectory.id),
            notes: [
                'Offline-safe training job manifest generated from accepted trajectories.',
                'Review JSONL export before launching any fine-tuning pipeline.',
                'Do not hot-swap live production weights without evaluation.',
            ],
        };

        fs.writeFileSync(this.jobManifestPath, JSON.stringify(job, null, 2), 'utf-8');
        this.lastPreparedJob = job;
        return { prepared: true, reason: 'training_job_prepared', job };
    }

    public getStatus(): SelfTrainingStatus {
        return {
            enabled: this.enabled,
            trainOnIdle: this.trainOnIdle,
            minQualityScore: this.minQualityScore,
            minAcceptedExamples: this.minAcceptedExamples,
            promotionMinAverageScore: this.promotionMinAverageScore,
            requireEvalForPromotion: this.requireEvalForPromotion,
            stats: this.store.getStats(),
            paths: {
                storePath: this.store.getFilePath(),
                exportPath: this.store.getExportPath(),
                jobManifestPath: this.jobManifestPath,
                evalReportPath: this.evalReportPath,
                launchRecordPath: this.launchRecordPath,
                candidateRegistryPath: this.candidateRegistryPath,
                promotionRecordPath: this.promotionRecordPath,
            },
            lastPreparedJob: this.lastPreparedJob || undefined,
            lastEvaluationReport: this.lastEvaluationReport || undefined,
            lastLaunchRecord: this.lastLaunchRecord || undefined,
            lastPromotionRecord: this.lastPromotionRecord || undefined,
            candidates: [...this.candidates],
        };
    }

    public registerCandidateModel(input: RegisterCandidateModelInput): RegisterCandidateModelResult {
        if (!this.enabled) {
            return { registered: false, reason: 'self_training_disabled' };
        }

        const modelName = String(input.modelName || '').trim();
        if (!modelName) {
            return { registered: false, reason: 'missing_model_name' };
        }

        const provider = String(input.provider || '').trim() || undefined;
        const candidateId = input.candidateId || this.buildCandidateId(modelName, provider);
        const matchingEval = this.resolveCandidateEvaluation(modelName, provider);
        const launchMatched = !!this.lastLaunchRecord && (!input.jobId || this.lastLaunchRecord.jobId === input.jobId);
        const existingIndex = this.candidates.findIndex(candidate => candidate.id === candidateId);
        const previous = existingIndex >= 0 ? this.candidates[existingIndex] : undefined;
        const notes = Array.from(new Set([
            ...(previous?.notes || []),
            ...((input.notes || []).map(note => this.redactText(note, 240) || '').filter(Boolean)),
            ...(matchingEval ? [`Matched eval report from ${matchingEval.createdAt}.`] : []),
            ...(launchMatched && this.lastLaunchRecord ? [`Matched launch session ${this.lastLaunchRecord.sessionId}.`] : []),
        ]));

        const candidate: SelfTrainingCandidateModel = {
            id: candidateId,
            registeredAt: new Date().toISOString(),
            modelName,
            provider,
            sourceJobId: input.jobId || this.lastPreparedJob?.id,
            sourceLaunchSessionId: launchMatched ? this.lastLaunchRecord?.sessionId : previous?.sourceLaunchSessionId,
            evaluationAverageScore: matchingEval?.averageScore,
            evaluationPassRate: matchingEval?.passRate,
            evaluationPassThreshold: matchingEval?.passThreshold,
            evaluationMatched: !!matchingEval,
            launchMatched,
            notes,
            status: previous?.status === 'promoted' ? 'promoted' : 'registered',
            promotedAt: previous?.promotedAt,
        };

        if (existingIndex >= 0) {
            this.candidates[existingIndex] = candidate;
        } else {
            this.candidates.unshift(candidate);
        }

        this.saveCandidates();
        return {
            registered: true,
            reason: existingIndex >= 0 ? 'candidate_updated' : 'candidate_registered',
            candidate,
        };
    }

    public preparePromotion(selector: { candidateId?: string; modelName?: string; provider?: string }): PromotionDecision {
        const candidate = this.findCandidate(selector);
        if (!candidate) {
            return { eligible: false, reason: 'candidate_not_found' };
        }

        if (this.requireEvalForPromotion) {
            if (!candidate.evaluationMatched) {
                return { eligible: false, reason: 'missing_matching_eval', candidate };
            }
            if ((candidate.evaluationAverageScore || 0) < this.promotionMinAverageScore) {
                return { eligible: false, reason: 'evaluation_below_promotion_threshold', candidate };
            }
            if ((candidate.evaluationPassRate || 0) <= 0) {
                return { eligible: false, reason: 'evaluation_pass_rate_zero', candidate };
            }
        }

        return {
            eligible: true,
            reason: 'promotion_ready',
            candidate,
            recommendedConfig: {
                modelName: candidate.modelName,
                provider: candidate.provider,
            },
        };
    }

    public buildLaunchPlan(options: BuildLaunchPlanOptions = {}): LaunchPlanResult {
        const job = this.lastPreparedJob || this.prepareTrainingJobIfNeeded().job;
        if (!job) {
            return { ready: false, reason: 'no_prepared_training_job' };
        }

        const template = options.commandTemplate || this.launchCommandTemplate;
        if (!template) {
            return { ready: false, reason: 'launch_command_not_configured' };
        }

        const cwd = options.cwd || this.launchCwd || path.dirname(job.exportPath);
        const sessionId = options.sessionId || `${this.launchSessionPrefix}-${job.id}`;
        const command = template
            .replace(/\{jobManifestPath\}/g, this.quoteForShell(this.jobManifestPath))
            .replace(/\{exportPath\}/g, this.quoteForShell(job.exportPath))
            .replace(/\{storePath\}/g, this.quoteForShell(job.storePath))
            .replace(/\{provider\}/g, job.recommendedProvider || this.provider || '')
            .replace(/\{modelName\}/g, job.recommendedModel || this.modelName || '')
            .replace(/\{jobId\}/g, job.id);

        return {
            ready: true,
            reason: 'launch_plan_ready',
            plan: {
                jobId: job.id,
                sessionId,
                command,
                cwd,
                jobManifestPath: this.jobManifestPath,
                exportPath: job.exportPath,
                storePath: job.storePath,
                recommendedProvider: job.recommendedProvider,
                recommendedModel: job.recommendedModel,
            }
        };
    }

    public recordLaunch(record: LaunchedTrainingJobRecord): void {
        this.lastLaunchRecord = record;
        fs.writeFileSync(this.launchRecordPath, JSON.stringify(record, null, 2), 'utf-8');
    }

    public recordPromotion(record: SelfTrainingPromotionRecord): void {
        this.lastPromotionRecord = record;
        this.candidates = this.candidates.map(candidate => candidate.id === record.candidateId
            ? { ...candidate, status: 'promoted', promotedAt: record.promotedAt }
            : candidate
        );
        this.saveCandidates();
        fs.writeFileSync(this.promotionRecordPath, JSON.stringify(record, null, 2), 'utf-8');
    }

    public async runEvaluation(llm: MultiLLM, options: RunEvaluationOptions = {}): Promise<SelfTrainingEvalReport> {
        const accepted = this.store.getAcceptedTrajectories();
        const runner = new SelfTrainingEvalRunner(llm);
        const report = await runner.run(accepted.slice(-Math.max(1, options.limit || this.evalSampleSize)), {
            limit: options.limit || this.evalSampleSize,
            provider: options.provider,
            modelName: options.modelName,
            passThreshold: this.evalPassThreshold,
            generateCandidate: options.generateCandidate,
        });
        fs.writeFileSync(this.evalReportPath, JSON.stringify(report, null, 2), 'utf-8');
        this.lastEvaluationReport = report;
        return report;
    }

    private evaluateAcceptance(input: SelfTrainingCaptureInput, qualityScore: number, finalDelivery?: string): { accepted: boolean; reason: string } {
        if (input.actionStatus !== 'completed' || !input.goalsMet) {
            return { accepted: false, reason: 'action_not_completed' };
        }
        if (input.deliveryAudit.unresolvedFailures) {
            return { accepted: false, reason: 'unresolved_failures' };
        }
        if (input.deliveryAudit.onlySentStatusMessages) {
            return { accepted: false, reason: 'status_only_delivery' };
        }
        if (input.isUserFacingAction && (!input.deliveryAudit.delivered || !finalDelivery)) {
            return { accepted: false, reason: 'no_substantive_delivery' };
        }
        if (qualityScore < this.minQualityScore) {
            return { accepted: false, reason: 'quality_below_threshold' };
        }
        return { accepted: true, reason: 'accepted_for_training' };
    }

    private computeQualityScore(input: SelfTrainingCaptureInput, steps: TrainingTrajectoryStep[], finalDelivery?: string): number {
        const deepSteps = steps.filter(step => step.isDeep && !step.isSideEffect);
        const successfulDeepSteps = deepSteps.filter(step => step.success).length;
        let score = 0;

        if (input.goalsMet) score += 0.35;
        if (input.deliveryAudit.delivered) score += 0.2;
        if (successfulDeepSteps > 0) score += 0.15;
        if (input.substantiveDeliveriesSent > 0) score += 0.15;
        if (finalDelivery) score += 0.1;

        if (input.deliveryAudit.unresolvedFailures) score -= 0.25;
        if (input.deliveryAudit.onlySentStatusMessages) score -= 0.2;
        if (input.actionStatus !== 'completed') score -= 0.15;
        if (input.currentStep > 20) score -= Math.min(0.1, (input.currentStep - 20) * 0.01);

        return Math.max(0, Math.min(1, Number(score.toFixed(3))));
    }

    private selectFinalDelivery(messages: Array<string | undefined>, isLikelyAcknowledgementMessage?: (message: string) => boolean): string | undefined {
        const filtered = messages.filter((message): message is string => !!message);
        if (filtered.length === 0) return undefined;
        for (let index = filtered.length - 1; index >= 0; index--) {
            const candidate = filtered[index];
            if (isLikelyAcknowledgementMessage && isLikelyAcknowledgementMessage(candidate)) continue;
            return candidate;
        }
        return filtered[filtered.length - 1];
    }

    private redactStep(entry: { step: number; tool: string; success: boolean; isDeep: boolean; isSideEffect: boolean; args?: string; resultSnippet?: string; errorSnippet?: string; timestamp: number }): TrainingTrajectoryStep {
        return {
            step: entry.step,
            tool: entry.tool,
            success: entry.success,
            isDeep: entry.isDeep,
            isSideEffect: entry.isSideEffect,
            args: this.redactText(entry.args, 240),
            resultSnippet: this.redactText(entry.resultSnippet, 240),
            errorSnippet: this.redactText(entry.errorSnippet, 240),
            timestamp: entry.timestamp,
        };
    }

    private redactText(value?: string, maxLength: number = 600): string | undefined {
        if (!value) return value;

        let next = String(value);
        if (this.redactSensitiveData) {
            next = next
                .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]')
                .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_GOOGLE_KEY]')
                .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
                .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
                .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED_TOKEN]')
                .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
                .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
        }

        return next.length > maxLength ? `${next.slice(0, maxLength)}...[truncated]` : next;
    }

    private buildId(actionId: string, taskDescription: string): string {
        const hash = crypto.createHash('sha1').update(`${actionId}:${taskDescription}`).digest('hex').slice(0, 12);
        return `trajectory-${hash}`;
    }

    private buildCandidateId(modelName: string, provider?: string): string {
        const fingerprint = `${provider || 'auto'}:${modelName}`;
        const hash = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12);
        return `candidate-${hash}`;
    }

    private buildDatasetFingerprint(trajectories: TrainingTrajectory[]): string {
        const payload = trajectories.map(trajectory => `${trajectory.id}:${trajectory.qualityScore}:${trajectory.timestamp}`).join('|');
        return crypto.createHash('sha1').update(payload).digest('hex');
    }

    private loadLastPreparedJob(): PreparedTrainingJob | null {
        try {
            if (!fs.existsSync(this.jobManifestPath)) return null;
            return JSON.parse(fs.readFileSync(this.jobManifestPath, 'utf-8')) as PreparedTrainingJob;
        } catch {
            return null;
        }
    }

    private loadLastEvaluationReport(): SelfTrainingEvalReport | null {
        try {
            if (!fs.existsSync(this.evalReportPath)) return null;
            return JSON.parse(fs.readFileSync(this.evalReportPath, 'utf-8')) as SelfTrainingEvalReport;
        } catch {
            return null;
        }
    }

    private loadLastLaunchRecord(): LaunchedTrainingJobRecord | null {
        try {
            if (!fs.existsSync(this.launchRecordPath)) return null;
            return JSON.parse(fs.readFileSync(this.launchRecordPath, 'utf-8')) as LaunchedTrainingJobRecord;
        } catch {
            return null;
        }
    }

    private loadCandidates(): SelfTrainingCandidateModel[] {
        try {
            if (!fs.existsSync(this.candidateRegistryPath)) return [];
            const parsed = JSON.parse(fs.readFileSync(this.candidateRegistryPath, 'utf-8')) as { candidates?: SelfTrainingCandidateModel[] };
            return Array.isArray(parsed.candidates) ? parsed.candidates : [];
        } catch {
            return [];
        }
    }

    private loadLastPromotionRecord(): SelfTrainingPromotionRecord | null {
        try {
            if (!fs.existsSync(this.promotionRecordPath)) return null;
            return JSON.parse(fs.readFileSync(this.promotionRecordPath, 'utf-8')) as SelfTrainingPromotionRecord;
        } catch {
            return null;
        }
    }

    private saveCandidates(): void {
        fs.writeFileSync(this.candidateRegistryPath, JSON.stringify({ candidates: this.candidates }, null, 2), 'utf-8');
    }

    private resolveCandidateEvaluation(modelName: string, provider?: string): SelfTrainingEvalReport | undefined {
        const report = this.lastEvaluationReport;
        if (!report) return undefined;
        if (report.modelName && report.modelName !== modelName) return undefined;
        if (provider && report.provider && report.provider !== provider) return undefined;
        return report;
    }

    private findCandidate(selector: { candidateId?: string; modelName?: string; provider?: string }): SelfTrainingCandidateModel | undefined {
        if (selector.candidateId) {
            return this.candidates.find(candidate => candidate.id === selector.candidateId);
        }

        const modelName = String(selector.modelName || '').trim();
        const provider = String(selector.provider || '').trim() || undefined;
        if (!modelName) return undefined;
        return this.candidates.find(candidate => candidate.modelName === modelName && (provider ? candidate.provider === provider : true));
    }

    private quoteForShell(value: string): string {
        return process.platform === 'win32'
            ? `"${value.replace(/"/g, '""')}"`
            : `'${value.replace(/'/g, `'\\''`)}'`;
    }
}