import { describe, expect, it, vi } from 'vitest';
import { GitHubCli } from '../src/core/GitHubCli';

class StubConfig {
    constructor(private values: Record<string, any> = {}) {}

    get(key: string) {
        return this.values[key];
    }
}

describe('GitHubCli', () => {
    it('returns unavailable status when binary is missing', async () => {
        const cli = new GitHubCli(new StubConfig() as any, {
            resolveBinary: () => null,
        });

        const status = await cli.getStatus();
        expect(status.installed).toBe(false);
    });

    it('runs structured commands and parses JSON output', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ name: 'v1.0.5' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.run(['release', 'list'], { json: true, cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(result.data[0].name).toBe('v1.0.5');
        expect(execFile).toHaveBeenCalledOnce();
        expect(execFile.mock.calls[0][0]).toBe('gh');
        expect(execFile.mock.calls[0][1]).toEqual(['release', 'list', '--json']);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('surfaces command errors cleanly', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(new Error('boom'), '', 'not logged in');
        });

        const cli = new GitHubCli(new StubConfig() as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.run(['auth', 'status']);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not logged in');
    });

    it('builds filtered pull request list commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ number: 42, title: 'Fix runtime' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listPullRequests({ repo: 'fredabila/orcbot', state: 'open', limit: 5, base: 'main', cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'pr',
            'list',
            '--limit',
            '5',
            '--json',
            'number,title,state,isDraft,headRefName,baseRefName,url,author,createdAt,updatedAt',
            '--state',
            'open',
            '--repo',
            'fredabila/orcbot',
            '--base',
            'main',
        ]);
    });

    it('builds issue create commands and extracts the issue url', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'https://github.com/fredabila/orcbot/issues/123\n', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.createIssue({
            title: 'New runtime issue',
            body: 'Details',
            repo: 'fredabila/orcbot',
            labels: ['bug', 'runtime'],
            assignees: ['fredabila'],
        });

        expect(result.success).toBe(true);
        expect(result.data?.url).toBe('https://github.com/fredabila/orcbot/issues/123');
        expect(execFile.mock.calls[0][1]).toEqual([
            'issue',
            'create',
            '--title',
            'New runtime issue',
            '--body',
            'Details',
            '--repo',
            'fredabila/orcbot',
            '--label',
            'bug,runtime',
            '--assignee',
            'fredabila',
        ]);
    });

    it('builds release create commands with generated notes support', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'https://github.com/fredabila/orcbot/releases/tag/v1.0.8\n', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.createRelease({
            tag: 'v1.0.8',
            repo: 'fredabila/orcbot',
            target: 'main',
            prerelease: true,
            generateNotes: true,
            cwd: 'D:/orcbot',
        });

        expect(result.success).toBe(true);
        expect(result.data?.url).toBe('https://github.com/fredabila/orcbot/releases/tag/v1.0.8');
        expect(execFile.mock.calls[0][1]).toEqual([
            'release',
            'create',
            'v1.0.8',
            '--repo',
            'fredabila/orcbot',
            '--target',
            'main',
            '--prerelease',
            '--generate-notes',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds release list commands with supported fields', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ tagName: 'v1.0.8', name: '1.0.8', isDraft: false }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listReleases({ repo: 'fredabila/orcbot', limit: 10, cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'release',
            'list',
            '--limit',
            '10',
            '--json',
            'createdAt,isDraft,isImmutable,isLatest,isPrerelease,name,publishedAt,tagName',
            '--repo',
            'fredabila/orcbot',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds workflow run list commands with filters', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ databaseId: 123, workflowName: 'publish-package' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listWorkflowRuns({ workflow: 'publish-package.yml', branch: 'main', status: 'completed', repo: 'fredabila/orcbot', limit: 3 });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'run',
            'list',
            '--limit',
            '3',
            '--json',
            'attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName',
            '--workflow',
            'publish-package.yml',
            '--branch',
            'main',
            '--status',
            'completed',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds workflow rerun commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'requested rerun', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.rerunWorkflowRun({ runId: 321, failed: true, repo: 'fredabila/orcbot', cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'run',
            'rerun',
            '321',
            '--failed',
            '--repo',
            'fredabila/orcbot',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds pull request checks commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ name: 'build', state: 'SUCCESS' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.getPullRequestChecks({ pullRequest: 42, repo: 'fredabila/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'pr',
            'checks',
            '42',
            '--json',
            'bucket,completedAt,description,event,link,name,startedAt,state,workflow',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds pull request review commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'review submitted', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.reviewPullRequest({
            pullRequest: 42,
            event: 'REQUEST_CHANGES',
            body: 'Please fix failing tests.',
            repo: 'fredabila/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'pr',
            'review',
            '42',
            '--request-changes',
            '--body',
            'Please fix failing tests.',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds pull request merge commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'merged', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.mergePullRequest({
            pullRequest: 42,
            strategy: 'squash',
            subject: 'Merge PR #42',
            body: 'Ready to ship',
            auto: true,
            deleteBranch: true,
            matchHeadCommit: 'abc123',
            repo: 'fredabila/orcbot',
            cwd: 'D:/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'pr',
            'merge',
            '42',
            '--squash',
            '--subject',
            'Merge PR #42',
            '--body',
            'Ready to ship',
            '--auto',
            '--delete-branch',
            '--match-head-commit',
            'abc123',
            '--repo',
            'fredabila/orcbot',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds pull request comment commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'commented', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.commentOnPullRequest({
            pullRequest: 42,
            body: 'Looks good overall.',
            repo: 'fredabila/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'pr',
            'comment',
            '42',
            '--body',
            'Looks good overall.',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds issue comment commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'commented', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.commentOnIssue({
            issue: 55,
            body: 'Investigating this now.',
            repo: 'fredabila/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'issue',
            'comment',
            '55',
            '--body',
            'Investigating this now.',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds workflow dispatch commands with fields', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'workflow dispatched', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.dispatchWorkflow({
            workflow: 'publish-package.yml',
            ref: 'main',
            repo: 'fredabila/orcbot',
            fields: { package: 'core', dry_run: true },
            cwd: 'D:/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'workflow',
            'run',
            'publish-package.yml',
            '--ref',
            'main',
            '--repo',
            'fredabila/orcbot',
            '--field',
            'package=core',
            '--field',
            'dry_run=true',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('lists branches and applies local filtering', async () => {
        const execFile = vi
            .fn()
            .mockImplementationOnce((file, args, options, callback) => {
                callback(null, JSON.stringify({
                    nameWithOwner: 'fredabila/orcbot',
                    defaultBranchRef: { name: 'main' },
                }), '');
            })
            .mockImplementationOnce((file, args, options, callback) => {
                callback(null, JSON.stringify([
                    { name: 'main', protected: true, commit: { sha: '111' } },
                    { name: 'feature/github-cli', protected: false, commit: { sha: '222' } },
                    { name: 'fix/heartbeat', protected: false, commit: { sha: '333' } }
                ]), '');
            });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listBranches({ repo: 'fredabila/orcbot', query: 'git', limit: 5, cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(result.data?.defaultBranch).toBe('main');
        expect(result.data?.branches).toEqual([{ name: 'feature/github-cli', protected: false, sha: '222' }]);
        expect(execFile.mock.calls[0][1]).toEqual([
            'repo',
            'view',
            'fredabila/orcbot',
            '--json',
            'nameWithOwner,defaultBranchRef',
        ]);
        expect(execFile.mock.calls[1][1]).toEqual([
            'api',
            'repos/fredabila/orcbot/branches?per_page=5',
        ]);
    });

    it('builds release asset upload commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'uploaded', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.uploadReleaseAsset({
            tag: 'v1.0.8',
            files: ['dist/pkg.tgz', 'dist/manifest.json'],
            repo: 'fredabila/orcbot',
            clobber: true,
            cwd: 'D:/orcbot',
        });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'release',
            'upload',
            'v1.0.8',
            'dist/pkg.tgz',
            'dist/manifest.json',
            '--repo',
            'fredabila/orcbot',
            '--clobber',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds label list commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ name: 'bug', color: 'd73a4a' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listLabels({ repo: 'fredabila/orcbot', search: 'bug', limit: 10, cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'label',
            'list',
            '--limit',
            '10',
            '--json',
            'name,color,description,isDefault,updatedAt',
            '--repo',
            'fredabila/orcbot',
            '--search',
            'bug',
        ]);
    });

    it('builds label create commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'created', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.createLabel({ name: 'needs-triage', color: 'ededed', description: 'Needs triage', force: true, repo: 'fredabila/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'label',
            'create',
            'needs-triage',
            '--color',
            'ededed',
            '--description',
            'Needs triage',
            '--force',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds label delete commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'deleted', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.deleteLabel({ name: 'needs-triage', repo: 'fredabila/orcbot', cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'label',
            'delete',
            'needs-triage',
            '--yes',
            '--repo',
            'fredabila/orcbot',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });

    it('builds variable list commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, JSON.stringify([{ name: 'DEPLOY_ENV', value: 'prod' }]), '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.listVariables({ repo: 'fredabila/orcbot', limit: 10, cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'variable',
            'list',
            '--limit',
            '10',
            '--json',
            'name,updatedAt,value,visibility,numSelectedRepos',
            '--repo',
            'fredabila/orcbot',
        ]);
    });

    it('builds variable set commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'set', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.setVariable({ name: 'DEPLOY_ENV', value: 'prod', repo: 'fredabila/orcbot', visibility: 'all', cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'variable',
            'set',
            'DEPLOY_ENV',
            '--body',
            'prod',
            '--repo',
            'fredabila/orcbot',
            '--visibility',
            'all',
        ]);
    });

    it('builds variable delete commands', async () => {
        const execFile = vi.fn((file, args, options, callback) => {
            callback(null, 'deleted', '');
        });

        const cli = new GitHubCli(new StubConfig({ githubCliPath: 'gh' }) as any, {
            resolveBinary: () => 'gh',
            execFile,
        });

        const result = await cli.deleteVariable({ name: 'DEPLOY_ENV', repo: 'fredabila/orcbot', cwd: 'D:/orcbot' });

        expect(result.success).toBe(true);
        expect(execFile.mock.calls[0][1]).toEqual([
            'variable',
            'delete',
            'DEPLOY_ENV',
            '--repo',
            'fredabila/orcbot',
        ]);
        expect(execFile.mock.calls[0][2].cwd).toBe('D:/orcbot');
    });
});