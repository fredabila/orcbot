import { MultiLLM, LLMProvider } from './MultiLLM';
import { TrainingTrajectory } from './TrajectoryStore';

export interface SelfTrainingEvalSample {
    trajectoryId: string;
    taskDescription: string;
    goldResponse: string;
    candidateResponse: string;
    score: number;
    passed: boolean;
    metrics: {
        keywordCoverage: number;
        jaccardSimilarity: number;
        lengthRatio: number;
    };
}

export interface SelfTrainingEvalReport {
    createdAt: string;
    evaluatedCount: number;
    averageScore: number;
    passRate: number;
    provider?: string;
    modelName?: string;
    passThreshold: number;
    scoringMode: 'deterministic-lexical';
    samples: SelfTrainingEvalSample[];
}

export interface SelfTrainingEvalOptions {
    limit?: number;
    provider?: LLMProvider;
    modelName?: string;
    passThreshold: number;
    generateCandidate?: (trajectory: TrainingTrajectory) => Promise<string> | string;
}

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'this', 'that', 'these', 'those', 'it', 'its', 'with', 'as', 'by', 'from', 'into', 'about', 'after', 'before', 'if',
    'but', 'not', 'you', 'your', 'i', 'we', 'our', 'they', 'their', 'he', 'she', 'them', 'his', 'her', 'my', 'me'
]);

export class SelfTrainingEvalRunner {
    constructor(private llm: MultiLLM) {}

    public async run(trajectories: TrainingTrajectory[], options: SelfTrainingEvalOptions): Promise<SelfTrainingEvalReport> {
        const selected = trajectories.slice(0, Math.max(1, options.limit || trajectories.length));
        const samples: SelfTrainingEvalSample[] = [];

        for (const trajectory of selected) {
            const goldResponse = trajectory.finalDelivery || trajectory.finalMessages[trajectory.finalMessages.length - 1] || '';
            const candidateResponse = options.generateCandidate
                ? await options.generateCandidate(trajectory)
                : await this.generateCandidate(trajectory, options.provider, options.modelName);
            const metrics = this.scoreCandidate(candidateResponse, goldResponse);
            const score = Number((metrics.keywordCoverage * 0.5 + metrics.jaccardSimilarity * 0.3 + metrics.lengthRatio * 0.2).toFixed(3));
            samples.push({
                trajectoryId: trajectory.id,
                taskDescription: trajectory.taskDescription,
                goldResponse,
                candidateResponse,
                score,
                passed: score >= options.passThreshold,
                metrics,
            });
        }

        const averageScore = samples.length > 0
            ? Number((samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length).toFixed(3))
            : 0;
        const passRate = samples.length > 0
            ? Number((samples.filter(sample => sample.passed).length / samples.length).toFixed(3))
            : 0;

        return {
            createdAt: new Date().toISOString(),
            evaluatedCount: samples.length,
            averageScore,
            passRate,
            provider: options.provider,
            modelName: options.modelName,
            passThreshold: options.passThreshold,
            scoringMode: 'deterministic-lexical',
            samples,
        };
    }

    private async generateCandidate(trajectory: TrainingTrajectory, provider?: LLMProvider, modelName?: string): Promise<string> {
        const prompt = `Complete the following user request clearly and directly.\n\nUser request:\n${trajectory.taskDescription}`;
        const systemMessage = 'You are being evaluated on final response quality. Answer the request directly without discussing tools or internal reasoning.';
        return this.llm.call(prompt, systemMessage, provider, modelName);
    }

    private scoreCandidate(candidate: string, gold: string): { keywordCoverage: number; jaccardSimilarity: number; lengthRatio: number } {
        const goldTokens = this.tokenize(gold);
        const candidateTokens = this.tokenize(candidate);

        if (goldTokens.size === 0 || candidateTokens.size === 0) {
            return { keywordCoverage: 0, jaccardSimilarity: 0, lengthRatio: 0 };
        }

        let intersectionCount = 0;
        for (const token of goldTokens) {
            if (candidateTokens.has(token)) intersectionCount++;
        }

        const unionCount = new Set([...goldTokens, ...candidateTokens]).size;
        const goldLength = Math.max(1, gold.trim().length);
        const candidateLength = Math.max(1, candidate.trim().length);

        return {
            keywordCoverage: Number((intersectionCount / goldTokens.size).toFixed(3)),
            jaccardSimilarity: Number((intersectionCount / Math.max(1, unionCount)).toFixed(3)),
            lengthRatio: Number((Math.min(goldLength, candidateLength) / Math.max(goldLength, candidateLength)).toFixed(3)),
        };
    }

    private tokenize(text: string): Set<string> {
        return new Set(
            String(text || '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .map(token => token.trim())
                .filter(token => token.length > 2 && !STOP_WORDS.has(token))
        );
    }
}