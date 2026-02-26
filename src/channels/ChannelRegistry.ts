import { IChannel } from './IChannel';
import { logger } from '../utils/logger';
import { eventBus } from '../core/EventBus';
import path from 'path';
import fs from 'fs';

/**
 * ChannelRegistry - Manages messaging channel lifecycle and registration.
 * Supports built-in channels and dynamic plugins.
 */
export class ChannelRegistry {
    private channels: Map<string, IChannel> = new Map();
    private pluginsDir: string;
    private agent?: any;

    constructor(pluginsDir?: string) {
        this.pluginsDir = pluginsDir || path.join(process.cwd(), 'plugins', 'channels');
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
        }
    }

    public setAgent(agent: any): void {
        this.agent = agent;
    }

    /**
     * Register a channel instance.
     */
    public register(name: string, channel: IChannel): void {
        const key = name.toLowerCase();
        this.channels.set(key, channel);
        logger.info(`ChannelRegistry: Registered ${name}`);
        eventBus.emit('channel:registered', { name, channel });

        // Dynamically register skills for this channel if agent is available
        if (this.agent && this.agent.skills) {
            this.registerChannelSkills(name, channel);
        }
    }

    /**
     * Automatically register messaging skills for a channel.
     */
    private registerChannelSkills(name: string, channel: IChannel): void {
        const key = name.toLowerCase();
        
        // Skill: Send Message
        this.agent.skills.registerSkill({
            name: `send_${key}`,
            description: `Send a message via the ${name} channel.`,
            usage: `send_${key}(to, message)`,
            handler: async (args: any) => {
                const to = args.to || args.id || args.recipient;
                const message = args.message || args.content || args.text;
                if (!to || !message) return `Error: 'to' and 'message' are required.`;
                await channel.sendMessage(String(to), String(message));
                return `Message sent via ${name} to ${to}`;
            }
        });

        // Skill: Send File
        this.agent.skills.registerSkill({
            name: `send_${key}_file`,
            description: `Send a file via the ${name} channel.`,
            usage: `send_${key}_file(to, file_path, caption?)`,
            handler: async (args: any) => {
                const to = args.to || args.id || args.recipient;
                const filePath = args.file_path || args.path;
                const caption = args.caption;
                if (!to || !filePath) return `Error: 'to' and 'file_path' are required.`;
                await channel.sendFile(String(to), String(filePath), caption);
                return `File sent via ${name} to ${to}`;
            }
        });
    }

    /**
     * Discover and load channel plugins.
     */
    public async discoverPlugins(): Promise<void> {
        if (!fs.existsSync(this.pluginsDir)) return;

        const files = fs.readdirSync(this.pluginsDir);
        for (const file of files) {
            if (file.endsWith('.ts') || file.endsWith('.js')) {
                try {
                    const filePath = path.join(this.pluginsDir, file);
                    const name = path.parse(file).name;
                    
                    // Dynamic import
                    const module = await import(filePath);
                    const ChannelClass = module.default || module[name] || module[`${name}Channel`];
                    
                    if (ChannelClass && typeof ChannelClass === 'function') {
                        const instance = new ChannelClass(this.agent);
                        this.register(name, instance);
                        await instance.start();
                        logger.info(`ChannelRegistry: Loaded and started plugin ${name}`);
                    }
                } catch (e) {
                    logger.error(`ChannelRegistry: Failed to load plugin ${file}: ${e}`);
                }
            }
        }
    }

    /**
     * Get a registered channel by name.
     */
    public get(name: string): IChannel | undefined {
        return this.channels.get(name.toLowerCase());
    }

    /**
     * List all registered channel names.
     */
    public list(): string[] {
        return Array.from(this.channels.keys());
    }

    /**
     * Stop all channels.
     */
    public async stopAll(): Promise<void> {
        for (const [name, channel] of this.channels.entries()) {
            try {
                await channel.stop();
                logger.info(`ChannelRegistry: Stopped ${name}`);
            } catch (e) {
                logger.error(`ChannelRegistry: Error stopping ${name}: ${e}`);
            }
        }
        this.channels.clear();
    }

    /**
     * Remove and stop a specific channel.
     */
    public async remove(name: string): Promise<boolean> {
        const key = name.toLowerCase();
        const channel = this.channels.get(key);
        if (!channel) return false;

        try {
            await channel.stop();
            this.channels.delete(key);
            logger.info(`ChannelRegistry: Removed ${name}`);
            eventBus.emit('channel:removed', { name });
            return true;
        } catch (e) {
            logger.error(`ChannelRegistry: Error removing ${name}: ${e}`);
            return false;
        }
    }
}
