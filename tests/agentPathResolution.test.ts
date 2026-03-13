import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/core/Agent';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function makeAgent(projectRoot: string, buildWorkspacePath: string, dataHome: string) {
    const agent = Object.create(Agent.prototype) as any;
    agent.config = {
        get: (key: string) => {
            const map: Record<string, any> = {
                projectRoot,
                buildWorkspacePath
            };
            return map[key];
        },
        getDataHome: () => dataHome
    };
    return agent;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('Agent path resolution', () => {
    it('prefers project-root relative paths for source files', () => {
        const projectRoot = makeTempDir('orcbot-project-');
        const buildWorkspacePath = makeTempDir('orcbot-workspace-');
        const dataHome = makeTempDir('orcbot-data-');
        const sourceFile = path.join(projectRoot, 'src', 'core', 'Agent.ts');
        fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
        fs.writeFileSync(sourceFile, '// test');

        const agent = makeAgent(projectRoot, buildWorkspacePath, dataHome);
        const resolved = (agent as any).resolveAgentWorkspacePath('src/core/Agent.ts');

        expect(resolved).toBe(sourceFile);
    });

    it('falls back to the build workspace for non-project relative outputs', () => {
        const projectRoot = makeTempDir('orcbot-project-');
        const buildWorkspacePath = makeTempDir('orcbot-workspace-');
        const dataHome = makeTempDir('orcbot-data-');
        const agent = makeAgent(projectRoot, buildWorkspacePath, dataHome);

        const resolved = (agent as any).resolveAgentWorkspacePath('scratch/output.txt');

        expect(resolved).toBe(path.join(buildWorkspacePath, 'scratch', 'output.txt'));
    });

    it('defaults directory exploration to the project root when available', () => {
        const projectRoot = makeTempDir('orcbot-project-');
        const buildWorkspacePath = makeTempDir('orcbot-workspace-');
        const dataHome = makeTempDir('orcbot-data-');
        const agent = makeAgent(projectRoot, buildWorkspacePath, dataHome);

        const resolved = (agent as any).resolveAgentWorkspacePath('');

        expect(resolved).toBe(projectRoot);
    });

    it('rejects absolute paths on unknown Windows drives', () => {
        if (process.platform !== 'win32') return;

        const unavailableDrive = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(letter => !fs.existsSync(`${letter}:\\`));
        if (!unavailableDrive) return;

        const projectRoot = makeTempDir('orcbot-project-');
        const buildWorkspacePath = makeTempDir('orcbot-workspace-');
        const dataHome = makeTempDir('orcbot-data-');
        const agent = makeAgent(projectRoot, buildWorkspacePath, dataHome);

        expect(() => (agent as any).resolveAgentWorkspacePath(`${unavailableDrive}:\\.`)).toThrow(/Unknown or inaccessible drive/);
    });
});