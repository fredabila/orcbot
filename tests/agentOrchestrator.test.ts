import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentOrchestrator } from '../src/core/AgentOrchestrator';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('AgentOrchestrator spawnAgent capability normalization', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // best-effort cleanup
            }
        }
    });

    it('keeps execute capability when custom capabilities are provided', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-a',
            role: 'worker',
            capabilities: ['browser', 'search']
        });

        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).toContain('browser');
        expect(agent.capabilities).toContain('search');
    });

    it('normalizes capability casing/whitespace and de-duplicates', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-b',
            role: 'worker',
            capabilities: [' Execute ', 'BROWSER', 'browser', '']
        });

        expect(agent.capabilities.filter(c => c === 'browser')).toHaveLength(1);
        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).not.toContain(' Execute ');
    });

    it('ignores non-string capability values without throwing', () => {
        const dir = makeTempDir('orcbot-orch-');
        dirs.push(dir);

        const orchestrator = new AgentOrchestrator(dir, 'primary-test');
        const agent = orchestrator.spawnAgent({
            name: 'worker-c',
            role: 'worker',
            capabilities: [1, true, { key: 'value' }, ' Search '] as unknown as string[]
        });

        expect(agent.capabilities).toContain('execute');
        expect(agent.capabilities).toContain('1');
        expect(agent.capabilities).toContain('true');
        expect(agent.capabilities).toContain('[object object]');
        expect(agent.capabilities).toContain('search');
    });
});
