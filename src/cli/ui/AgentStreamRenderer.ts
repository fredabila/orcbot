import { eventBus, EventBus } from '../../core/EventBus';

// ANSI styling conforming to DESIGN.md
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    brightCyan: '\x1b[96m',
    green: '\x1b[32m',
    brightGreen: '\x1b[92m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    brightRed: '\x1b[91m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

export interface ToolCallEvent {
    actionId?: string;
    toolName: string;
    parameters?: Record<string, any>;
    step?: number;
}

export interface ToolResultEvent {
    actionId?: string;
    toolName: string;
    success: boolean;
    durationMs?: number;
    result?: any;
    error?: string;
}

export interface TaskCompleteEvent {
    actionId?: string;
    summary?: string;
    steps?: number;
    durationMs?: number;
    tokens?: number;
}

export class AgentStreamRenderer {
    private attached = false;
    private bus: EventBus;
    private isTTY: boolean;
    private activeToolName: string | null = null;
    private spinnerInterval: NodeJS.Timeout | null = null;
    private spinnerFrame = 0;
    private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    constructor(bus: EventBus = eventBus) {
        this.bus = bus;
        this.isTTY = Boolean(process.stdout.isTTY);
    }

    /** Attach to EventBus and start streaming agent output */
    public attach(): this {
        if (this.attached) return this;
        this.bus.on('tool:call' as any, this.handleToolCall);
        this.bus.on('tool:result' as any, this.handleToolResult);
        this.bus.on('task:complete' as any, this.handleTaskComplete);
        this.bus.on('task:step:start' as any, this.handleStepStart);
        this.attached = true;
        return this;
    }

    /** Detach listeners and clean up */
    public detach(): this {
        if (!this.attached) return this;
        this.stopSpinner();
        this.bus.off('tool:call' as any, this.handleToolCall);
        this.bus.off('tool:result' as any, this.handleToolResult);
        this.bus.off('task:complete' as any, this.handleTaskComplete);
        this.bus.off('task:step:start' as any, this.handleStepStart);
        this.attached = false;
        return this;
    }

    private handleStepStart = (data: { step: number; maxSteps?: number; reasoning?: string }) => {
        this.stopSpinner();
        const maxStr = data.maxSteps ? `/${data.maxSteps}` : '';
        console.log(`\n  ${c.brightCyan}◆ Step ${data.step}${maxStr}${c.reset}`);
        if (data.reasoning) {
            this.renderReasoning(data.reasoning);
        }
    };

    private handleToolCall = (data: ToolCallEvent) => {
        this.stopSpinner();
        this.activeToolName = data.toolName;
        const paramSummary = this.summarizeParams(data.parameters);
        const label = paramSummary ? `${data.toolName} ${c.gray}${paramSummary}${c.reset}` : data.toolName;

        if (this.isTTY) {
            this.startSpinner(`Running ${label}`);
        } else {
            console.log(`  ${c.yellow}⠋${c.reset} ${c.white}${label}${c.reset}`);
        }
    };

    private handleToolResult = (data: ToolResultEvent) => {
        this.stopSpinner();
        const durationStr = data.durationMs != null ? ` ${c.gray}(${data.durationMs}ms)${c.reset}` : '';
        const summary = this.summarizeResult(data.result, data.error);

        if (data.success) {
            console.log(`  ${c.brightGreen}✔${c.reset} ${c.bold}${c.white}${data.toolName}${c.reset}${summary ? `  ${summary}` : ''}${durationStr}`);
        } else {
            const errStr = data.error ? ` ${c.red}${data.error}${c.reset}` : '';
            console.log(`  ${c.brightRed}✖${c.reset} ${c.bold}${c.white}${data.toolName}${c.reset} ${c.red}failed${c.reset}${errStr}${durationStr}`);
        }
    };

    private handleTaskComplete = (data: TaskCompleteEvent) => {
        this.stopSpinner();
        const dur = data.durationMs ? `${(data.durationMs / 1000).toFixed(1)}s` : '';
        const steps = data.steps ? `${data.steps} steps` : '';
        const tokens = data.tokens ? `${data.tokens} tokens` : '';
        const stats = [steps, dur, tokens].filter(Boolean).join(' • ');

        console.log('');
        console.log(`  ${c.brightCyan}◇ Task Complete${c.reset}`);
        if (data.summary) {
            console.log(`  ${c.gray}│${c.reset} ${c.white}${data.summary}${c.reset}`);
        }
        if (stats) {
            console.log(`  ${c.gray}└ ${c.gray}${stats}${c.reset}`);
        }
        console.log('');
    };

    /** Render formatted model reasoning */
    public renderReasoning(thought: string): void {
        const clean = thought.trim();
        if (!clean) return;
        const lines = clean.split('\n');
        for (const line of lines) {
            console.log(`  ${c.gray}│${c.reset} ${c.white}${line}${c.reset}`);
        }
    }

    private startSpinner(message: string): void {
        this.stopSpinner();
        this.spinnerFrame = 0;
        this.spinnerInterval = setInterval(() => {
            const icon = this.spinnerFrames[this.spinnerFrame % this.spinnerFrames.length];
            this.spinnerFrame++;
            process.stdout.write(`\r  ${c.yellow}${icon}${c.reset} ${c.white}${message}${c.reset}  `);
        }, 80);
    }

    private stopSpinner(): void {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
            this.spinnerInterval = null;
            if (this.isTTY) {
                // Clear the spinner line
                process.stdout.write('\r\x1b[K');
            }
        }
        this.activeToolName = null;
    }

    private summarizeParams(params?: Record<string, any>): string {
        if (!params || typeof params !== 'object') return '';
        // Extract key identify flags
        const keys = Object.keys(params);
        if (keys.length === 0) return '';
        const parts: string[] = [];
        for (const k of keys.slice(0, 3)) {
            const val = params[k];
            if (typeof val === 'string') {
                const short = val.length > 30 ? val.slice(0, 27) + '...' : val;
                parts.push(`${k}="${short}"`);
            } else if (typeof val === 'number' || typeof val === 'boolean') {
                parts.push(`${k}=${val}`);
            }
        }
        return parts.join(' ');
    }

    private summarizeResult(result?: any, error?: string): string {
        if (error) return '';
        if (result == null) return '';
        if (typeof result === 'string') {
            const trimmed = result.trim();
            if (trimmed.length > 60) {
                return `${c.gray}${trimmed.slice(0, 57)}...${c.reset}`;
            }
            return `${c.gray}${trimmed}${c.reset}`;
        }
        return '';
    }
}

/** Global default stream renderer */
export const agentStreamRenderer = new AgentStreamRenderer();
