import { describe, expect, it } from 'vitest';
import { SkillsManager } from '../src/core/SkillsManager';

function makeManager(profile?: { enforced: boolean; capabilities: string[]; allowChannels?: boolean }) {
    return new SkillsManager(undefined as any, undefined, {
        browser: {},
        config: { get: (key: string) => key === 'skillExecutionTimeoutMs' ? 1000 : undefined },
        agent: {},
        logger: console,
        workerCapabilityProfile: profile
    } as any);
}

describe('SkillsManager worker capability policy', () => {
    it('blocks worker command execution when run_command capability is missing', async () => {
        const manager = makeManager({ enforced: true, capabilities: ['web_search'] });
        manager.registerSkill({
            name: 'run_command',
            description: 'Run a command',
            usage: 'run_command(command)',
            handler: async () => 'ok'
        });

        await expect(manager.executeSkill('run_command', { command: 'dir' })).rejects.toThrow(/requires capability run_command/i);
    });

    it('allows skills whose capability is present in the worker profile', async () => {
        const manager = makeManager({ enforced: true, capabilities: ['search'] });
        manager.registerSkill({
            name: 'web_search',
            description: 'Search the web',
            usage: 'web_search(query)',
            handler: async () => 'searched'
        });

        await expect(manager.executeSkill('web_search', { query: 'orcbot' })).resolves.toBe('searched');
    });

    it('blocks messaging skills unless the worker profile explicitly allows channels and messaging', async () => {
        const manager = makeManager({ enforced: true, capabilities: ['messaging'], allowChannels: false });
        manager.registerSkill({
            name: 'send_telegram',
            description: 'Send a Telegram message',
            usage: 'send_telegram(chat_id, message)',
            handler: async () => 'sent'
        });

        await expect(manager.executeSkill('send_telegram', { chat_id: '1', message: 'hi' })).rejects.toThrow(/messaging is disabled/i);
    });
});