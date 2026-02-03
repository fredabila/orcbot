import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * RuntimeTuner - Allows the agent to dynamically adjust tool behaviors
 * 
 * The agent can tune settings based on what's working and what isn't,
 * making it more adaptive to different sites and scenarios.
 */

export interface BrowserTuning {
    // Per-domain overrides
    domainOverrides: {
        [domain: string]: {
            forceHeadful?: boolean;
            navigationTimeout?: number;
            clickTimeout?: number;
            typeTimeout?: number;
            waitAfterClick?: number;
            useSlowTyping?: boolean;
            slowTypingDelay?: number;
            extraStealthMode?: boolean;
            customUserAgent?: string;
        };
    };
    // Global defaults
    defaults: {
        navigationTimeout: number;
        clickTimeout: number;
        typeTimeout: number;
        waitAfterClick: number;
        autoRetryHeadful: boolean;
        slowTypingDelay: number;
    };
}

export interface WorkflowTuning {
    maxStepsPerAction: number;
    maxRetriesPerSkill: number;
    retryDelayMs: number;
    skillTimeoutMs: number;
    parallelSkillExecution: boolean;
}

export interface LLMTuning {
    preferredModelForBrowsing: string | null;
    preferredModelForCoding: string | null;
    preferredModelForAnalysis: string | null;
    temperatureOverrides: {
        creative: number;
        analytical: number;
        default: number;
    };
}

export interface TuningState {
    browser: BrowserTuning;
    workflow: WorkflowTuning;
    llm: LLMTuning;
    learnings: TuningLearning[];
}

export interface TuningLearning {
    timestamp: string;
    domain?: string;
    setting: string;
    oldValue: any;
    newValue: any;
    reason: string;
    success?: boolean;
}

const DEFAULT_STATE: TuningState = {
    browser: {
        domainOverrides: {},
        defaults: {
            navigationTimeout: 30000,
            clickTimeout: 15000,
            typeTimeout: 15000,
            waitAfterClick: 1000,
            autoRetryHeadful: true,
            slowTypingDelay: 50,
        }
    },
    workflow: {
        maxStepsPerAction: 30,
        maxRetriesPerSkill: 2,
        retryDelayMs: 1000,
        skillTimeoutMs: 120000,
        parallelSkillExecution: false,
    },
    llm: {
        preferredModelForBrowsing: null,
        preferredModelForCoding: null,
        preferredModelForAnalysis: null,
        temperatureOverrides: {
            creative: 0.9,
            analytical: 0.3,
            default: 0.7,
        }
    },
    learnings: []
};

export class RuntimeTuner {
    private state: TuningState;
    private statePath: string;
    private maxLearnings: number = 100;

    constructor(dataDir?: string) {
        const dir = dataDir || path.join(os.homedir(), '.orcbot');
        this.statePath = path.join(dir, 'runtime-tuning.json');
        this.state = this.loadState();
    }

    private loadState(): TuningState {
        try {
            if (fs.existsSync(this.statePath)) {
                const raw = fs.readFileSync(this.statePath, 'utf-8');
                const loaded = JSON.parse(raw);
                // Merge with defaults to handle new fields
                return {
                    browser: { ...DEFAULT_STATE.browser, ...loaded.browser },
                    workflow: { ...DEFAULT_STATE.workflow, ...loaded.workflow },
                    llm: { ...DEFAULT_STATE.llm, ...loaded.llm },
                    learnings: loaded.learnings || []
                };
            }
        } catch (e) {
            logger.warn(`RuntimeTuner: Failed to load state, using defaults: ${e}`);
        }
        return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }

    private saveState(): void {
        try {
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            logger.error(`RuntimeTuner: Failed to save state: ${e}`);
        }
    }

    private recordLearning(learning: Omit<TuningLearning, 'timestamp'>): void {
        this.state.learnings.push({
            ...learning,
            timestamp: new Date().toISOString()
        });
        // Keep only recent learnings
        if (this.state.learnings.length > this.maxLearnings) {
            this.state.learnings = this.state.learnings.slice(-this.maxLearnings);
        }
        this.saveState();
    }

    // ============ Browser Tuning ============

    /**
     * Get browser settings for a specific domain
     */
    public getBrowserSettingsForDomain(url: string): BrowserTuning['defaults'] & BrowserTuning['domainOverrides'][string] {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            const override = Object.entries(this.state.browser.domainOverrides)
                .find(([domain]) => hostname.includes(domain));
            
            if (override) {
                return { ...this.state.browser.defaults, ...override[1] };
            }
        } catch { }
        return this.state.browser.defaults;
    }

    /**
     * Tune browser settings for a specific domain
     */
    public tuneBrowserForDomain(
        domain: string,
        settings: Partial<BrowserTuning['domainOverrides'][string]>,
        reason: string
    ): string {
        const oldSettings = this.state.browser.domainOverrides[domain] || {};
        this.state.browser.domainOverrides[domain] = { ...oldSettings, ...settings };
        
        this.recordLearning({
            domain,
            setting: 'browser.domainOverrides',
            oldValue: oldSettings,
            newValue: this.state.browser.domainOverrides[domain],
            reason
        });

        logger.info(`RuntimeTuner: Updated browser settings for ${domain}: ${JSON.stringify(settings)}`);
        return `Browser settings for ${domain} updated: ${JSON.stringify(settings)}`;
    }

    /**
     * Tune global browser defaults
     */
    public tuneBrowserDefaults(
        settings: Partial<BrowserTuning['defaults']>,
        reason: string
    ): string {
        const oldDefaults = { ...this.state.browser.defaults };
        this.state.browser.defaults = { ...this.state.browser.defaults, ...settings };
        
        this.recordLearning({
            setting: 'browser.defaults',
            oldValue: oldDefaults,
            newValue: this.state.browser.defaults,
            reason
        });

        logger.info(`RuntimeTuner: Updated browser defaults: ${JSON.stringify(settings)}`);
        return `Browser defaults updated: ${JSON.stringify(settings)}`;
    }

    /**
     * Mark a domain as requiring headful mode (learned from failure)
     */
    public markDomainAsHeadful(domain: string, reason: string): string {
        return this.tuneBrowserForDomain(domain, { forceHeadful: true }, reason);
    }

    /**
     * Check if domain should force headful mode
     */
    public shouldForceHeadful(url: string): boolean {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            for (const [domain, settings] of Object.entries(this.state.browser.domainOverrides)) {
                if (hostname.includes(domain) && settings.forceHeadful) {
                    return true;
                }
            }
        } catch { }
        return false;
    }

    // ============ Workflow Tuning ============

    /**
     * Get current workflow settings
     */
    public getWorkflowSettings(): WorkflowTuning {
        return { ...this.state.workflow };
    }

    /**
     * Tune workflow settings
     */
    public tuneWorkflow(
        settings: Partial<WorkflowTuning>,
        reason: string
    ): string {
        const oldSettings = { ...this.state.workflow };
        this.state.workflow = { ...this.state.workflow, ...settings };
        
        this.recordLearning({
            setting: 'workflow',
            oldValue: oldSettings,
            newValue: this.state.workflow,
            reason
        });

        logger.info(`RuntimeTuner: Updated workflow settings: ${JSON.stringify(settings)}`);
        return `Workflow settings updated: ${JSON.stringify(settings)}`;
    }

    // ============ LLM Tuning ============

    /**
     * Get LLM settings
     */
    public getLLMSettings(): LLMTuning {
        return { ...this.state.llm };
    }

    /**
     * Tune LLM settings
     */
    public tuneLLM(
        settings: Partial<LLMTuning>,
        reason: string
    ): string {
        const oldSettings = { ...this.state.llm };
        this.state.llm = { ...this.state.llm, ...settings };
        
        this.recordLearning({
            setting: 'llm',
            oldValue: oldSettings,
            newValue: this.state.llm,
            reason
        });

        logger.info(`RuntimeTuner: Updated LLM settings: ${JSON.stringify(settings)}`);
        return `LLM settings updated: ${JSON.stringify(settings)}`;
    }

    // ============ Learning & Feedback ============

    /**
     * Record whether a tuning change was successful
     */
    public recordTuningOutcome(settingPath: string, success: boolean): void {
        const learning = this.state.learnings.find(l => 
            l.setting === settingPath && l.success === undefined
        );
        if (learning) {
            learning.success = success;
            this.saveState();
        }
    }

    /**
     * Get recent tuning history
     */
    public getTuningHistory(limit: number = 20): TuningLearning[] {
        return this.state.learnings.slice(-limit);
    }

    /**
     * Get all tunable options (for agent discovery)
     */
    public getTunableOptions(): object {
        return {
            browser: {
                domainOverrides: {
                    description: 'Per-domain browser settings',
                    tunableFields: ['forceHeadful', 'navigationTimeout', 'clickTimeout', 'typeTimeout', 'waitAfterClick', 'useSlowTyping', 'slowTypingDelay', 'extraStealthMode', 'customUserAgent']
                },
                defaults: {
                    description: 'Global browser defaults',
                    current: this.state.browser.defaults,
                    tunableFields: Object.keys(this.state.browser.defaults)
                }
            },
            workflow: {
                description: 'Workflow execution settings',
                current: this.state.workflow,
                tunableFields: Object.keys(this.state.workflow)
            },
            llm: {
                description: 'LLM behavior settings',
                current: this.state.llm,
                tunableFields: ['preferredModelForBrowsing', 'preferredModelForCoding', 'preferredModelForAnalysis', 'temperatureOverrides']
            }
        };
    }

    /**
     * Get current full state (for debugging/introspection)
     */
    public getFullState(): TuningState {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Reset tuning to defaults
     */
    public resetToDefaults(category?: 'browser' | 'workflow' | 'llm'): string {
        if (category) {
            (this.state as any)[category] = JSON.parse(JSON.stringify((DEFAULT_STATE as any)[category]));
            this.saveState();
            return `Reset ${category} tuning to defaults`;
        } else {
            this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
            this.saveState();
            return 'Reset all tuning to defaults';
        }
    }
}
