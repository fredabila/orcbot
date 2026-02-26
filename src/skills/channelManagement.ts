import { logger } from '../utils/logger';
import { Agent } from '../core/Agent';
import fs from 'fs';
import path from 'path';

/**
 * Skill: Manage Channels
 * Allows the agent to list, add, or remove messaging channels.
 */
export function registerChannelManagementSkills(agent: Agent) {
    agent.skills.registerSkill({
        name: 'manage_channels',
        description: 'Manage messaging channels (list, add, remove). To add a channel, provide the name and valid TypeScript code implementing IChannel.',
        usage: 'manage_channels({ action: "list" | "add" | "remove", name?, code? })',
        handler: async (args: any) => {
            const action = args.action || 'list';
            const name = args.name;
            const code = args.code;

            if (action === 'list') {
                const channels = agent.channelRegistry.list();
                return `Currently registered channels: ${channels.join(', ') || 'none'}`;
            }

            if (action === 'add') {
                if (!name || !code) return `Error: 'name' and 'code' are required to add a channel.`;
                
                const pluginsDir = path.join(agent.config.getDataHome(), 'plugins', 'channels');
                if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

                const filePath = path.join(pluginsDir, `${name}.ts`);
                fs.writeFileSync(filePath, code);
                
                // Attempt to load the new channel
                try {
                    // Note: In a real environment, we might need a build step or ts-node support
                    // For now, we inform the user that it's been saved and will be loaded.
                    return `Success: Channel code for '${name}' saved to ${filePath}. It will be loaded on the next restart or if you trigger a reload.`;
                } catch (e) {
                    return `Error loading new channel: ${e}`;
                }
            }

            if (action === 'remove') {
                if (!name) return `Error: 'name' is required to remove a channel.`;
                const success = await agent.channelRegistry.remove(name);
                return success ? `Successfully removed channel: ${name}` : `Channel not found: ${name}`;
            }

            return `Unknown action: ${action}`;
        }
    });
}
