import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ConfigManager } from '../config/ConfigManager';

type ExecFileLike = (
    file: string,
    args: readonly string[],
    options: {
        cwd?: string;
        timeout?: number;
        maxBuffer?: number;
        windowsHide?: boolean;
    },
    callback: (error: any, stdout: string, stderr: string) => void
) => void;

export interface GoogleWorkspaceRunResult {
    success: boolean;
    binary?: string;
    args: string[];
    stdout: string;
    stderr: string;
    data?: any;
    error?: string;
}

export interface GoogleWorkspaceStatus {
    installed: boolean;
    binary?: string;
    configuredAccount?: string;
    authStatus?: any;
    authError?: string;
}

type CsvInput = string | string[] | undefined;

export class GoogleWorkspaceCli {
    private resolvedBinary: string | null | undefined;

    constructor(
        private config: ConfigManager,
        private deps?: {
            execFile?: ExecFileLike;
            resolveBinary?: () => string | null;
        }
    ) {}

    public findBinary(): string | null {
        if (this.resolvedBinary !== undefined) {
            return this.resolvedBinary;
        }

        if (this.deps?.resolveBinary) {
            this.resolvedBinary = this.deps.resolveBinary();
            return this.resolvedBinary;
        }

        const configured = String(this.config.get('googleWorkspaceCliPath') || process.env.GOOGLE_WORKSPACE_CLI_PATH || '').trim();
        if (configured) {
            if (path.isAbsolute(configured) || configured.includes(path.sep) || configured.includes('/')) {
                this.resolvedBinary = fs.existsSync(configured) ? configured : configured;
                return this.resolvedBinary;
            }
            this.resolvedBinary = configured;
            return this.resolvedBinary;
        }

        const candidates = process.platform === 'win32'
            ? ['gws.cmd', 'gws.exe', 'gws']
            : ['gws'];

        for (const candidate of candidates) {
            try {
                const locateCmd = process.platform === 'win32'
                    ? `where ${candidate}`
                    : `command -v ${candidate}`;
                const resolved = String(execSync(locateCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim().split(/\r?\n/)[0];
                if (resolved) {
                    this.resolvedBinary = resolved;
                    return this.resolvedBinary;
                }
            } catch {
                // try next candidate
            }
        }

        this.resolvedBinary = null;
        return null;
    }

    public invalidateBinaryCache(): void {
        this.resolvedBinary = undefined;
    }

    public async getStatus(): Promise<GoogleWorkspaceStatus> {
        const binary = this.findBinary();
        const configuredAccount = String(this.config.get('googleWorkspaceCliAccount') || process.env.GOOGLE_WORKSPACE_CLI_ACCOUNT || '').trim() || undefined;
        if (!binary) {
            return { installed: false, configuredAccount };
        }

        const authResult = await this.run(['auth', 'status'], { json: true });
        return {
            installed: true,
            binary,
            configuredAccount,
            authStatus: authResult.success ? (authResult.data ?? authResult.stdout) : undefined,
            authError: authResult.success ? undefined : (authResult.error || authResult.stderr || authResult.stdout)
        };
    }

    public async run(
        args: string[],
        options?: { json?: boolean; account?: string; timeoutMs?: number; cwd?: string }
    ): Promise<GoogleWorkspaceRunResult> {
        const binary = this.findBinary();
        if (!binary) {
            return {
                success: false,
                args: [],
                stdout: '',
                stderr: '',
                error: 'Google Workspace CLI (gws) is not installed or not on PATH.'
            };
        }

        const finalArgs: string[] = [];
        const account = String(options?.account || this.config.get('googleWorkspaceCliAccount') || process.env.GOOGLE_WORKSPACE_CLI_ACCOUNT || '').trim();
        if (account) {
            finalArgs.push('--account', account);
        }
        if (options?.json) {
            finalArgs.push('--format', 'json');
        }
        finalArgs.push(...args.map(arg => String(arg)));

        const execFile = this.deps?.execFile || require('child_process').execFile;

        return await new Promise<GoogleWorkspaceRunResult>((resolve) => {
            execFile(
                binary,
                finalArgs,
                {
                    cwd: options?.cwd,
                    timeout: options?.timeoutMs || 45000,
                    maxBuffer: 2 * 1024 * 1024,
                    windowsHide: true,
                },
                (error: any, stdout: string, stderr: string) => {
                    const trimmedStdout = String(stdout || '').trim();
                    const trimmedStderr = String(stderr || '').trim();
                    if (error) {
                        resolve({
                            success: false,
                            binary,
                            args: finalArgs,
                            stdout: trimmedStdout,
                            stderr: trimmedStderr,
                            error: trimmedStderr || trimmedStdout || error.message || String(error),
                        });
                        return;
                    }

                    let data: any;
                    if (options?.json) {
                        try {
                            data = trimmedStdout ? JSON.parse(trimmedStdout) : undefined;
                        } catch {
                            // leave raw stdout available
                        }
                    }

                    resolve({
                        success: true,
                        binary,
                        args: finalArgs,
                        stdout: trimmedStdout,
                        stderr: trimmedStderr,
                        data,
                    });
                }
            );
        });
    }

    public async createDoc(title: string, account?: string): Promise<GoogleWorkspaceRunResult> {
        return this.run([
            'docs',
            'documents',
            'create',
            '--json',
            JSON.stringify({ title })
        ], { json: true, account });
    }

    public async appendToDoc(documentId: string, text: string, account?: string): Promise<GoogleWorkspaceRunResult> {
        return this.run([
            'docs',
            '+write',
            '--document',
            documentId,
            '--text',
            text
        ], { account });
    }

    public async createSpreadsheet(title: string, account?: string): Promise<GoogleWorkspaceRunResult> {
        return this.run([
            'sheets',
            'spreadsheets',
            'create',
            '--json',
            JSON.stringify({ properties: { title } })
        ], { json: true, account });
    }

    public async readSheet(input: { spreadsheetId: string; range: string; account?: string }): Promise<GoogleWorkspaceRunResult> {
        return this.run([
            'sheets',
            '+read',
            '--spreadsheet',
            input.spreadsheetId,
            '--range',
            input.range,
        ], { json: true, account: input.account });
    }

    public async appendSheet(input: {
        spreadsheetId: string;
        values?: string | string[];
        jsonValues?: unknown[][];
        account?: string;
        dryRun?: boolean;
    }): Promise<GoogleWorkspaceRunResult> {
        const args = [
            'sheets',
            '+append',
            '--spreadsheet',
            input.spreadsheetId,
        ];

        if (Array.isArray(input.jsonValues) && input.jsonValues.length > 0) {
            args.push('--json-values', JSON.stringify(input.jsonValues));
        } else if (Array.isArray(input.values)) {
            args.push('--values', input.values.map((value) => String(value)).join(','));
        } else if (typeof input.values === 'string' && input.values.trim()) {
            args.push('--values', input.values.trim());
        }

        if (input.dryRun) {
            args.push('--dry-run');
        }

        return this.run(args, { json: true, account: input.account });
    }

    public async createCalendarEvent(input: {
        summary: string;
        start: string;
        end: string;
        calendar?: string;
        location?: string;
        description?: string;
        attendees?: string[];
        account?: string;
        dryRun?: boolean;
    }): Promise<GoogleWorkspaceRunResult> {
        const args = [
            'calendar',
            '+insert',
            '--summary',
            input.summary,
            '--start',
            input.start,
            '--end',
            input.end,
        ];

        if (input.calendar) {
            args.push('--calendar', input.calendar);
        }
        if (input.location) {
            args.push('--location', input.location);
        }
        if (input.description) {
            args.push('--description', input.description);
        }
        for (const attendee of input.attendees || []) {
            const trimmed = String(attendee || '').trim();
            if (trimmed) {
                args.push('--attendee', trimmed);
            }
        }
        if (input.dryRun) {
            args.push('--dry-run');
        }

        return this.run(args, { json: true, account: input.account });
    }

    public async gmailTriage(input?: { max?: number; query?: string; labels?: boolean; account?: string }): Promise<GoogleWorkspaceRunResult> {
        const args = ['gmail', '+triage'];
        if (input?.max && Number.isFinite(Number(input.max))) {
            args.push('--max', String(Math.max(1, Number(input.max))));
        }
        if (input?.query) {
            args.push('--query', input.query);
        }
        if (input?.labels) {
            args.push('--labels');
        }

        return this.run(args, { json: true, account: input?.account });
    }

    public async sendGmail(input: {
        to: CsvInput;
        subject: string;
        body: string;
        cc?: CsvInput;
        bcc?: CsvInput;
        account?: string;
        dryRun?: boolean;
    }): Promise<GoogleWorkspaceRunResult> {
        const args = [
            'gmail',
            '+send',
            '--to',
            this.toCsv(input.to),
            '--subject',
            input.subject,
            '--body',
            input.body,
        ];

        this.pushOptionalCsvFlag(args, '--cc', input.cc);
        this.pushOptionalCsvFlag(args, '--bcc', input.bcc);
        if (input.dryRun) {
            args.push('--dry-run');
        }

        return this.run(args, { json: true, account: input.account });
    }

    public async replyGmail(input: {
        messageId: string;
        body: string;
        from?: string;
        to?: CsvInput;
        cc?: CsvInput;
        bcc?: CsvInput;
        remove?: CsvInput;
        account?: string;
        dryRun?: boolean;
        replyAll?: boolean;
    }): Promise<GoogleWorkspaceRunResult> {
        const args = [
            'gmail',
            input.replyAll ? '+reply-all' : '+reply',
            '--message-id',
            input.messageId,
            '--body',
            input.body,
        ];

        if (input.from) {
            args.push('--from', input.from);
        }
        this.pushOptionalCsvFlag(args, '--to', input.to);
        this.pushOptionalCsvFlag(args, '--cc', input.cc);
        this.pushOptionalCsvFlag(args, '--bcc', input.bcc);
        if (input.replyAll) {
            this.pushOptionalCsvFlag(args, '--remove', input.remove);
        }
        if (input.dryRun) {
            args.push('--dry-run');
        }

        return this.run(args, { json: true, account: input.account });
    }

    public async listDriveFiles(input?: { query?: string; pageSize?: number; account?: string }): Promise<GoogleWorkspaceRunResult> {
        const params: Record<string, any> = {
            pageSize: Math.min(50, Math.max(1, Number(input?.pageSize) || 10))
        };
        if (input?.query) {
            params.q = input.query;
        }

        return this.run([
            'drive',
            'files',
            'list',
            '--params',
            JSON.stringify(params),
            '--fields',
            'files(id,name,mimeType,webViewLink)'
        ], { json: true, account: input?.account });
    }

    private toCsv(input: CsvInput): string {
        if (Array.isArray(input)) {
            return input
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(',');
        }

        return String(input || '').trim();
    }

    private pushOptionalCsvFlag(args: string[], flag: string, input: CsvInput): void {
        const value = this.toCsv(input);
        if (value) {
            args.push(flag, value);
        }
    }
}