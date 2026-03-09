import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { StepLedger } from '../src/core/CompletionAudit';
import { SelfTrainingManager } from '../src/core/SelfTrainingManager';
import { Action } from '../src/memory/ActionQueue';

function makeAction(overrides?: Partial<Action>): Action {
    return {
        id: 'action-1',
        type: 'user_task',
        payload: {
            description: 'Read the logs and send the user a summary',
            source: 'telegram',
            sourceId: 'chat-1',
            sessionScopeId: 'telegram:chat-1',
        },
        priority: 5,
        lane: 'user',
        status: 'in-progress',
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

describe('SelfTrainingManager', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir && fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('captures accepted trajectories and redacts sensitive data', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            args: 'path=secrets.txt token=sk-123456789012345678901234567890',
            resultSnippet: 'Found issues in config.',
            timestamp: Date.now(),
        });
        ledger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered summary to user@example.com',
            timestamp: Date.now(),
        });

        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
            modelName: 'gpt-4o',
            provider: 'openai',
        });

        const result = manager.captureCompletedAction({
            action: makeAction(),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Done. Summary sent to user@example.com with token sk-123456789012345678901234567890'],
            stepLedger: ledger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
            modelName: 'gpt-4o',
            provider: 'openai',
            skillCallCounts: { read_file: 1, send_telegram: 1 },
            isLikelyAcknowledgementMessage: (message: string) => /^on it/i.test(message),
        });

        expect(result.captured).toBe(true);
        expect(result.accepted).toBe(true);

        const stored = JSON.parse(fs.readFileSync(path.join(tempDir, 'trajectories.json'), 'utf-8'));
        expect(stored.trajectories).toHaveLength(1);
        expect(stored.trajectories[0].finalDelivery).toContain('[REDACTED_EMAIL]');
        expect(stored.trajectories[0].finalDelivery).toContain('[REDACTED_OPENAI_KEY]');
        expect(stored.trajectories[0].steps[0].args).toContain('token=[REDACTED]');

        const jsonl = fs.readFileSync(path.join(tempDir, 'trajectories.jsonl'), 'utf-8');
        expect(jsonl).toContain('Read the logs and send the user a summary');
        expect(jsonl).toContain('[REDACTED_EMAIL]');
    });

    it('stores but rejects low-quality status-only trajectories', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'On it.',
            timestamp: Date.now(),
        });

        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
        });

        const result = manager.captureCompletedAction({
            action: makeAction({ id: 'action-2' }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 1,
            messagesSent: 1,
            substantiveDeliveriesSent: 0,
            sentMessagesInAction: ['On it. Working on your request now.'],
            stepLedger: ledger,
            deliveryAudit: {
                delivered: false,
                reason: 'Only status messages were sent',
                summary: 'status-only',
                unresolvedFailures: false,
                onlySentStatusMessages: true,
            },
            isUserFacingAction: true,
            isLikelyAcknowledgementMessage: (message: string) => /^on it/i.test(message),
        });

        expect(result.captured).toBe(true);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('status_only_delivery');

        const jsonl = fs.readFileSync(path.join(tempDir, 'trajectories.jsonl'), 'utf-8');
        expect(jsonl).toBe('');
    });

    it('prepares an offline training job when enough accepted trajectories exist', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            minAcceptedExamples: 2,
            preparationCooldownMinutes: 0,
            trainOnIdle: true,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
            jobManifestPath: path.join(tempDir, 'self-training-job.json'),
            modelName: 'gpt-4o',
            provider: 'openai',
        });

        const firstLedger = new StepLedger();
        firstLedger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            resultSnippet: 'Read file successfully',
            timestamp: Date.now(),
        });
        firstLedger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered answer',
            timestamp: Date.now(),
        });

        manager.captureCompletedAction({
            action: makeAction({ id: 'action-3' }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Done. Here is the summary.'],
            stepLedger: firstLedger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
        });

        const secondLedger = new StepLedger();
        secondLedger.record({
            step: 1,
            tool: 'search_codebase',
            success: true,
            isDeep: true,
            isSideEffect: false,
            resultSnippet: 'Found target symbol',
            timestamp: Date.now(),
        });
        secondLedger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered answer',
            timestamp: Date.now(),
        });

        manager.captureCompletedAction({
            action: makeAction({ id: 'action-4', payload: { description: 'Find symbol and reply', source: 'telegram', sourceId: 'chat-1', sessionScopeId: 'telegram:chat-1' } }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Done. I found the symbol and replied.'],
            stepLedger: secondLedger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
        });

        const prepared = manager.prepareTrainingJobIfNeeded();
        expect(prepared.prepared).toBe(true);
        expect(prepared.job?.acceptedTrajectoryCount).toBe(2);
        expect(fs.existsSync(path.join(tempDir, 'self-training-job.json'))).toBe(true);

        const status = manager.getStatus();
        expect(status.stats.accepted).toBe(2);
        expect(status.lastPreparedJob?.status).toBe('prepared');
        expect(status.paths.jobManifestPath).toContain('self-training-job.json');
    });

    it('runs deterministic self-training evaluation and saves a report', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            minAcceptedExamples: 1,
            preparationCooldownMinutes: 0,
            trainOnIdle: true,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
            jobManifestPath: path.join(tempDir, 'self-training-job.json'),
            evalReportPath: path.join(tempDir, 'self-training-eval-report.json'),
            evalSampleSize: 5,
            evalPassThreshold: 0.55,
            modelName: 'gpt-4o',
            provider: 'openai',
        });

        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            resultSnippet: 'summary ready',
            timestamp: Date.now(),
        });
        ledger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered answer',
            timestamp: Date.now(),
        });

        manager.captureCompletedAction({
            action: makeAction({ id: 'action-5', payload: { description: 'Summarize the system logs', source: 'telegram', sourceId: 'chat-1', sessionScopeId: 'telegram:chat-1' } }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Summary: the logs show two warnings and one retry.'],
            stepLedger: ledger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
        });

        const report = await manager.runEvaluation({} as any, {
            generateCandidate: async () => 'Summary: the logs show two warnings and one retry.',
            limit: 1,
        });

        expect(report.evaluatedCount).toBe(1);
        expect(report.averageScore).toBeGreaterThanOrEqual(0.55);
        expect(report.samples[0].passed).toBe(true);
        expect(fs.existsSync(path.join(tempDir, 'self-training-eval-report.json'))).toBe(true);
        expect(manager.getStatus().lastEvaluationReport?.evaluatedCount).toBe(1);
    });

    it('builds a launch plan from the prepared training job and records launches', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            minAcceptedExamples: 1,
            preparationCooldownMinutes: 0,
            trainOnIdle: true,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
            jobManifestPath: path.join(tempDir, 'self-training-job.json'),
            launchRecordPath: path.join(tempDir, 'self-training-launch.json'),
            launchCommandTemplate: 'python trainer.py --manifest {jobManifestPath} --export {exportPath} --model {modelName}',
            launchSessionPrefix: 'self-train',
            modelName: 'gpt-4o',
            provider: 'openai',
        });

        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            resultSnippet: 'summary ready',
            timestamp: Date.now(),
        });
        ledger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered answer',
            timestamp: Date.now(),
        });

        manager.captureCompletedAction({
            action: makeAction({ id: 'action-6', payload: { description: 'Summarize logs and reply', source: 'telegram', sourceId: 'chat-1', sessionScopeId: 'telegram:chat-1' } }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Summary: completed successfully.'],
            stepLedger: ledger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
        });

        manager.prepareTrainingJobIfNeeded();
        const launchPlan = manager.buildLaunchPlan();
        expect(launchPlan.ready).toBe(true);
        expect(launchPlan.plan?.command).toContain('trainer.py');
        expect(launchPlan.plan?.command).toContain('self-training-job.json');
        expect(launchPlan.plan?.sessionId).toContain('self-train-');

        manager.recordLaunch({
            launchedAt: new Date().toISOString(),
            jobId: launchPlan.plan!.jobId,
            sessionId: launchPlan.plan!.sessionId,
            command: launchPlan.plan!.command,
            cwd: launchPlan.plan!.cwd,
            pid: 12345,
        });

        expect(fs.existsSync(path.join(tempDir, 'self-training-launch.json'))).toBe(true);
        expect(manager.getStatus().lastLaunchRecord?.pid).toBe(12345);
    });

    it('registers candidates and gates promotion on matching evaluation results', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-self-train-'));
        tempDirs.push(tempDir);
        const manager = new SelfTrainingManager({
            enabled: true,
            redactSensitiveData: true,
            minQualityScore: 0.72,
            minAcceptedExamples: 1,
            preparationCooldownMinutes: 0,
            trainOnIdle: true,
            storePath: path.join(tempDir, 'trajectories.json'),
            exportPath: path.join(tempDir, 'trajectories.jsonl'),
            evalReportPath: path.join(tempDir, 'self-training-eval-report.json'),
            candidateRegistryPath: path.join(tempDir, 'self-training-candidates.json'),
            promotionRecordPath: path.join(tempDir, 'self-training-promotion.json'),
            promotionMinAverageScore: 0.7,
            requireEvalForPromotion: true,
            modelName: 'gpt-4o',
            provider: 'openai',
        });

        const ledger = new StepLedger();
        ledger.record({
            step: 1,
            tool: 'read_file',
            success: true,
            isDeep: true,
            isSideEffect: false,
            resultSnippet: 'summary ready',
            timestamp: Date.now(),
        });
        ledger.record({
            step: 2,
            tool: 'send_telegram',
            success: true,
            isDeep: false,
            isSideEffect: true,
            resultSnippet: 'Delivered answer',
            timestamp: Date.now(),
        });

        manager.captureCompletedAction({
            action: makeAction({ id: 'action-7', payload: { description: 'Summarize logs for promotion test', source: 'telegram', sourceId: 'chat-1', sessionScopeId: 'telegram:chat-1' } }),
            actionStatus: 'completed',
            goalsMet: true,
            currentStep: 2,
            messagesSent: 1,
            substantiveDeliveriesSent: 1,
            sentMessagesInAction: ['Summary: logs are stable and healthy.'],
            stepLedger: ledger,
            deliveryAudit: {
                delivered: true,
                reason: 'Deep work succeeded and substantive delivery was sent',
                summary: 'ok',
                unresolvedFailures: false,
                onlySentStatusMessages: false,
            },
            isUserFacingAction: true,
        });

        await manager.runEvaluation({} as any, {
            provider: 'openai' as any,
            modelName: 'orcbot-selftrain-v1',
            limit: 1,
            generateCandidate: async () => 'Summary: logs are stable and healthy.',
        });

        const registered = manager.registerCandidateModel({
            modelName: 'orcbot-selftrain-v1',
            provider: 'openai',
            notes: ['fine-tuned candidate'],
        });

        expect(registered.registered).toBe(true);
        expect(registered.candidate?.evaluationMatched).toBe(true);

        const decision = manager.preparePromotion({ candidateId: registered.candidate?.id });
        expect(decision.eligible).toBe(true);
        expect(decision.reason).toBe('promotion_ready');

        manager.recordPromotion({
            promotedAt: new Date().toISOString(),
            candidateId: registered.candidate!.id,
            modelName: registered.candidate!.modelName,
            provider: registered.candidate!.provider,
            previousModelName: 'gpt-4o',
            previousProvider: 'openai',
            evaluationAverageScore: registered.candidate!.evaluationAverageScore,
            evaluationPassRate: registered.candidate!.evaluationPassRate,
            evaluationPassThreshold: registered.candidate!.evaluationPassThreshold,
        });

        expect(fs.existsSync(path.join(tempDir, 'self-training-candidates.json'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, 'self-training-promotion.json'))).toBe(true);
        expect(manager.getStatus().lastPromotionRecord?.modelName).toBe('orcbot-selftrain-v1');
        expect(manager.getStatus().candidates[0].status).toBe('promoted');
    });
});