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

export interface GitHubCliRunResult {
    success: boolean;
    binary?: string;
    args: string[];
    stdout: string;
    stderr: string;
    data?: any;
    error?: string;
}

export interface GitHubCliStatus {
    installed: boolean;
    binary?: string;
    authStatus?: any;
    authError?: string;
}

type CsvInput = string | string[] | undefined;

export class GitHubCli {
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

        const configured = String(this.config.get('githubCliPath') || process.env.GITHUB_CLI_PATH || '').trim();
        if (configured) {
            if (path.isAbsolute(configured) || configured.includes(path.sep) || configured.includes('/')) {
                this.resolvedBinary = fs.existsSync(configured) ? configured : configured;
                return this.resolvedBinary;
            }
            this.resolvedBinary = configured;
            return this.resolvedBinary;
        }

        const candidates = process.platform === 'win32'
            ? ['gh.exe', 'gh.cmd', 'gh']
            : ['gh'];

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

    public async getStatus(): Promise<GitHubCliStatus> {
        const binary = this.findBinary();
        if (!binary) {
            return { installed: false };
        }

        const authResult = await this.run(['auth', 'status'], { json: false, timeoutMs: 15000 });
        return {
            installed: true,
            binary,
            authStatus: authResult.success ? (authResult.data ?? authResult.stdout) : undefined,
            authError: authResult.success ? undefined : (authResult.error || authResult.stderr || authResult.stdout),
        };
    }

    public async run(
        args: string[],
        options?: { json?: boolean; parseJson?: boolean; timeoutMs?: number; cwd?: string }
    ): Promise<GitHubCliRunResult> {
        const binary = this.findBinary();
        if (!binary) {
            return {
                success: false,
                args: [],
                stdout: '',
                stderr: '',
                error: 'GitHub CLI (gh) is not installed or not on PATH.'
            };
        }

        const finalArgs = [...args.map(arg => String(arg))];
        if (options?.json && !finalArgs.includes('--json')) {
            finalArgs.push('--json');
        }

        const execFile = this.deps?.execFile || require('child_process').execFile;

        return await new Promise<GitHubCliRunResult>((resolve) => {
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
                    if (options?.json || options?.parseJson) {
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

    public async listPullRequests(input?: {
        state?: string;
        limit?: number;
        repo?: string;
        base?: string;
        head?: string;
        author?: string;
        assignee?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'pr',
            'list',
            '--limit',
            String(Math.min(100, Math.max(1, Number(input?.limit) || 10))),
            '--json',
            'number,title,state,isDraft,headRefName,baseRefName,url,author,createdAt,updatedAt'
        ];

        if (input?.state) args.push('--state', input.state);
        if (input?.repo) args.push('--repo', input.repo);
        if (input?.base) args.push('--base', input.base);
        if (input?.head) args.push('--head', input.head);
        if (input?.author) args.push('--author', input.author);
        if (input?.assignee) args.push('--assignee', input.assignee);

        return this.run(args, { json: true, cwd: input?.cwd });
    }

    public async createIssue(input: {
        title: string;
        body?: string;
        repo?: string;
        labels?: CsvInput;
        assignees?: CsvInput;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'issue',
            'create',
            '--title',
            input.title,
        ];

        if (typeof input.body === 'string') {
            args.push('--body', input.body);
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }
        this.pushOptionalCsvFlag(args, '--label', input.labels);
        this.pushOptionalCsvFlag(args, '--assignee', input.assignees);

        const result = await this.run(args, { cwd: input.cwd });
        return result.success
            ? {
                ...result,
                data: {
                    url: this.extractFirstUrl(result.stdout),
                    output: result.stdout,
                },
            }
            : result;
    }

    public async createRelease(input: {
        tag: string;
        title?: string;
        notes?: string;
        repo?: string;
        target?: string;
        draft?: boolean;
        prerelease?: boolean;
        generateNotes?: boolean;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'release',
            'create',
            input.tag,
        ];

        if (input.title) {
            args.push('--title', input.title);
        }
        if (input.notes) {
            args.push('--notes', input.notes);
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }
        if (input.target) {
            args.push('--target', input.target);
        }
        if (input.draft) {
            args.push('--draft');
        }
        if (input.prerelease) {
            args.push('--prerelease');
        }
        if (input.generateNotes) {
            args.push('--generate-notes');
        }

        const result = await this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
        return result.success
            ? {
                ...result,
                data: {
                    url: this.extractFirstUrl(result.stdout),
                    output: result.stdout,
                },
            }
            : result;
    }

    public async listReleases(input?: {
        repo?: string;
        limit?: number;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'release',
            'list',
            '--limit',
            String(Math.min(100, Math.max(1, Number(input?.limit) || 10))),
            '--json',
            'createdAt,isDraft,isImmutable,isLatest,isPrerelease,name,publishedAt,tagName'
        ];

        if (input?.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { json: true, cwd: input?.cwd, timeoutMs: 60000 });
    }

    public async listWorkflowRuns(input?: {
        workflow?: string;
        branch?: string;
        event?: string;
        status?: string;
        limit?: number;
        repo?: string;
        user?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'run',
            'list',
            '--limit',
            String(Math.min(100, Math.max(1, Number(input?.limit) || 10))),
            '--json',
            'attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName'
        ];

        if (input?.workflow) args.push('--workflow', input.workflow);
        if (input?.branch) args.push('--branch', input.branch);
        if (input?.event) args.push('--event', input.event);
        if (input?.status) args.push('--status', input.status);
        if (input?.repo) args.push('--repo', input.repo);
        if (input?.user) args.push('--user', input.user);

        return this.run(args, { json: true, cwd: input?.cwd, timeoutMs: 60000 });
    }

    public async rerunWorkflowRun(input: {
        runId: string | number;
        failed?: boolean;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'run',
            'rerun',
            String(input.runId),
        ];

        if (input.failed) {
            args.push('--failed');
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async getPullRequestChecks(input: {
        pullRequest: string | number;
        repo?: string;
        watcher?: boolean;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'pr',
            'checks',
            String(input.pullRequest),
            '--json',
            'bucket,completedAt,description,event,link,name,startedAt,state,workflow'
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }
        if (input.watcher) {
            args.push('--watch');
        }

        return this.run(args, { json: true, cwd: input.cwd, timeoutMs: input.watcher ? 300000 : 60000 });
    }

    public async reviewPullRequest(input: {
        pullRequest: string | number;
        event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
        body?: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'pr',
            'review',
            String(input.pullRequest),
        ];

        if (input.event === 'APPROVE') {
            args.push('--approve');
        } else if (input.event === 'REQUEST_CHANGES') {
            args.push('--request-changes');
        } else {
            args.push('--comment');
        }

        if (typeof input.body === 'string' && input.body.trim()) {
            args.push('--body', input.body);
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async mergePullRequest(input: {
        pullRequest: string | number;
        strategy?: 'merge' | 'squash' | 'rebase';
        subject?: string;
        body?: string;
        auto?: boolean;
        admin?: boolean;
        deleteBranch?: boolean;
        matchHeadCommit?: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'pr',
            'merge',
            String(input.pullRequest),
        ];

        if (input.strategy === 'squash') {
            args.push('--squash');
        } else if (input.strategy === 'rebase') {
            args.push('--rebase');
        } else {
            args.push('--merge');
        }

        if (input.subject) {
            args.push('--subject', input.subject);
        }
        if (input.body) {
            args.push('--body', input.body);
        }
        if (input.auto) {
            args.push('--auto');
        }
        if (input.admin) {
            args.push('--admin');
        }
        if (input.deleteBranch) {
            args.push('--delete-branch');
        }
        if (input.matchHeadCommit) {
            args.push('--match-head-commit', input.matchHeadCommit);
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async commentOnIssue(input: {
        issue: string | number;
        body: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'issue',
            'comment',
            String(input.issue),
            '--body',
            input.body,
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async commentOnPullRequest(input: {
        pullRequest: string | number;
        body: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'pr',
            'comment',
            String(input.pullRequest),
            '--body',
            input.body,
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async dispatchWorkflow(input: {
        workflow: string;
        ref?: string;
        repo?: string;
        fields?: Record<string, string | number | boolean>;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'workflow',
            'run',
            input.workflow,
        ];

        if (input.ref) {
            args.push('--ref', input.ref);
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }
        for (const [key, value] of Object.entries(input.fields || {})) {
            const fieldKey = String(key || '').trim();
            if (!fieldKey) continue;
            args.push('--field', `${fieldKey}=${String(value)}`);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async listBranches(input?: {
        repo?: string;
        limit?: number;
        query?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const repoResult = await this.resolveRepoSlug(input?.repo, input?.cwd);
        if (!repoResult.success || !repoResult.repo) {
            return {
                success: false,
                args: [],
                stdout: repoResult.stdout || '',
                stderr: repoResult.stderr || '',
                error: repoResult.error || 'Unable to determine repository for branch listing.',
            };
        }

        const branchResult = await this.run([
            'api',
            `repos/${repoResult.repo}/branches?per_page=${Math.min(100, Math.max(1, Number(input?.limit) || 20))}`
        ], { parseJson: true, cwd: input?.cwd, timeoutMs: 60000 });
        if (!branchResult.success) {
            return branchResult;
        }

        const query = String(input?.query || '').trim().toLowerCase();
        const refs = Array.isArray(branchResult.data) ? branchResult.data : [];
        const filtered = refs
            .filter((ref: any) => !query || String(ref?.name || '').toLowerCase().includes(query))
            .slice(0, Math.min(100, Math.max(1, Number(input?.limit) || 20)));

        return {
            ...branchResult,
            data: {
                defaultBranch: repoResult.defaultBranch,
                branches: filtered.map((branch: any) => ({
                    name: branch?.name,
                    protected: !!branch?.protected,
                    sha: branch?.commit?.sha,
                })),
            },
        };
    }

    public async uploadReleaseAsset(input: {
        tag: string;
        files: string[];
        repo?: string;
        clobber?: boolean;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'release',
            'upload',
            input.tag,
            ...input.files,
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }
        if (input.clobber) {
            args.push('--clobber');
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 180000 });
    }

    public async listLabels(input?: {
        repo?: string;
        limit?: number;
        search?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'label',
            'list',
            '--limit',
            String(Math.min(100, Math.max(1, Number(input?.limit) || 20))),
            '--json',
            'name,color,description,isDefault,updatedAt'
        ];

        if (input?.repo) {
            args.push('--repo', input.repo);
        }
        if (input?.search) {
            args.push('--search', input.search);
        }

        return this.run(args, { json: true, cwd: input?.cwd, timeoutMs: 60000 });
    }

    public async createLabel(input: {
        name: string;
        color: string;
        description?: string;
        force?: boolean;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'label',
            'create',
            input.name,
            '--color',
            input.color,
        ];

        if (input.description) {
            args.push('--description', input.description);
        }
        if (input.force) {
            args.push('--force');
        }
        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async deleteLabel(input: {
        name: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'label',
            'delete',
            input.name,
            '--yes',
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async listVariables(input?: {
        repo?: string;
        limit?: number;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'variable',
            'list',
            '--limit',
            String(Math.min(100, Math.max(1, Number(input?.limit) || 20))),
            '--json',
            'name,updatedAt,value,visibility,numSelectedRepos'
        ];

        if (input?.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { json: true, cwd: input?.cwd, timeoutMs: 60000 });
    }

    public async setVariable(input: {
        name: string;
        value: string;
        repo?: string;
        visibility?: 'all' | 'private' | 'selected';
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'variable',
            'set',
            input.name,
            '--body',
            input.value,
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }
        if (input.visibility) {
            args.push('--visibility', input.visibility);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
    }

    public async deleteVariable(input: {
        name: string;
        repo?: string;
        cwd?: string;
    }): Promise<GitHubCliRunResult> {
        const args = [
            'variable',
            'delete',
            input.name,
        ];

        if (input.repo) {
            args.push('--repo', input.repo);
        }

        return this.run(args, { cwd: input.cwd, timeoutMs: 120000 });
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

    private extractFirstUrl(text: string): string | undefined {
        const match = String(text || '').match(/https?:\/\/\S+/);
        return match?.[0];
    }

    private async resolveRepoSlug(repo?: string, cwd?: string): Promise<{
        success: boolean;
        repo?: string;
        defaultBranch?: string;
        stdout?: string;
        stderr?: string;
        error?: string;
    }> {
        const trimmedRepo = String(repo || '').trim();
        const args = ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'];
        if (trimmedRepo) {
            args.splice(2, 0, trimmedRepo);
        }

        const result = await this.run(args, { json: true, cwd, timeoutMs: 60000 });
        if (!result.success) {
            return {
                success: false,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error || result.stderr || result.stdout,
            };
        }

        const resolvedRepo = String(result.data?.nameWithOwner || trimmedRepo || '').trim();
        return {
            success: !!resolvedRepo,
            repo: resolvedRepo || undefined,
            defaultBranch: result.data?.defaultBranchRef?.name,
            stdout: result.stdout,
            stderr: result.stderr,
            error: resolvedRepo ? undefined : 'GitHub CLI did not return nameWithOwner for this repository.',
        };
    }
}