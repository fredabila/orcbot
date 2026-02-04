import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscordChannel } from '../src/channels/DiscordChannel';
import { eventBus } from '../src/core/EventBus';

// Mock discord.js
vi.mock('discord.js', () => {
    const mockGuilds = new Map();
    const mockChannels = new Map();
    
    return {
        Client: vi.fn().mockImplementation(() => ({
            on: vi.fn(),
            once: vi.fn(),
            login: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn(),
            user: { tag: 'TestBot#1234' },
            guilds: {
                cache: mockGuilds,
                fetch: vi.fn().mockImplementation(async (id) => ({
                    id,
                    name: 'Test Server',
                    channels: {
                        fetch: vi.fn().mockResolvedValue(mockChannels)
                    }
                }))
            },
            channels: {
                fetch: vi.fn().mockImplementation(async (id) => {
                    const mockChannel = {
                        id,
                        name: 'test-channel',
                        isTextBased: vi.fn().mockReturnValue(true),
                        send: vi.fn().mockResolvedValue({}),
                        sendTyping: vi.fn().mockResolvedValue(undefined)
                    };
                    return mockChannel;
                })
            }
        })),
        GatewayIntentBits: {
            Guilds: 1,
            GuildMessages: 2,
            MessageContent: 4,
            DirectMessages: 8,
            GuildMembers: 16
        },
        Partials: {
            Channel: 1,
            Message: 2
        },
        AttachmentBuilder: vi.fn()
    };
});

describe('DiscordChannel', () => {
    let discordChannel: DiscordChannel;
    let mockAgent: any;

    beforeEach(() => {
        mockAgent = {
            config: {
                get: vi.fn((key: string) => {
                    if (key === 'discordAutoReplyEnabled') return false;
                    if (key === 'memoryPath') return '/tmp/test/memory.json';
                    return undefined;
                })
            },
            memory: {
                saveMemory: vi.fn().mockResolvedValue(undefined)
            },
            pushTask: vi.fn()
        };

        discordChannel = new DiscordChannel('test-token', mockAgent);
    });

    afterEach(async () => {
        if (discordChannel) {
            await discordChannel.stop();
        }
    });

    it('should initialize correctly', () => {
        expect(discordChannel).toBeDefined();
        expect(discordChannel.name).toBe('Discord');
    });

    it('should start successfully', async () => {
        await discordChannel.start();
        // Client login should have been called
        expect(discordChannel['client'].login).toHaveBeenCalledWith('test-token');
    });

    it('should stop successfully', async () => {
        await discordChannel.start();
        await discordChannel.stop();
        // Client destroy should have been called
        expect(discordChannel['client'].destroy).toHaveBeenCalled();
    });

    it('should send a message to a channel', async () => {
        await discordChannel.start();
        // Manually set isReady to true for testing
        discordChannel['isReady'] = true;

        await discordChannel.sendMessage('123456789', 'Hello World');
        
        expect(discordChannel['client'].channels.fetch).toHaveBeenCalledWith('123456789');
    });

    it('should split long messages correctly', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        // Create a message longer than 2000 characters
        const longMessage = 'A'.repeat(3000);
        
        await discordChannel.sendMessage('123456789', longMessage);
        
        // Should fetch the channel
        expect(discordChannel['client'].channels.fetch).toHaveBeenCalledWith('123456789');
    });

    it('should send a file to a channel', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        // Mock fs.existsSync
        const fs = require('fs');
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);

        await discordChannel.sendFile('123456789', '/path/to/file.txt', 'Test caption');
        
        expect(discordChannel['client'].channels.fetch).toHaveBeenCalledWith('123456789');
    });

    it('should send typing indicator', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        await discordChannel.sendTypingIndicator('123456789');
        
        expect(discordChannel['client'].channels.fetch).toHaveBeenCalledWith('123456789');
    });

    it('should throw error when sending message to non-text channel', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        // Mock a non-text channel
        discordChannel['client'].channels.fetch = vi.fn().mockResolvedValue({
            id: '123456789',
            isTextBased: vi.fn().mockReturnValue(false)
        });

        await expect(discordChannel.sendMessage('123456789', 'Hello'))
            .rejects.toThrow('Channel 123456789 not found or not text-based');
    });

    it('should throw error when not ready', async () => {
        // Don't start the channel
        discordChannel['isReady'] = false;

        await expect(discordChannel.sendMessage('123456789', 'Hello'))
            .rejects.toThrow('Discord client is not ready');
    });

    it('should get guilds list', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        // Mock guilds in cache
        const mockGuild1 = { id: '111', name: 'Guild 1' };
        const mockGuild2 = { id: '222', name: 'Guild 2' };
        discordChannel['client'].guilds.cache.set('111', mockGuild1);
        discordChannel['client'].guilds.cache.set('222', mockGuild2);

        const guilds = await discordChannel.getGuilds();
        
        expect(guilds).toHaveLength(2);
        expect(guilds[0]).toEqual({ id: '111', name: 'Guild 1' });
        expect(guilds[1]).toEqual({ id: '222', name: 'Guild 2' });
    });

    it('should get text channels from a guild', async () => {
        await discordChannel.start();
        discordChannel['isReady'] = true;

        const channels = await discordChannel.getTextChannels('guild-123');
        
        expect(discordChannel['client'].guilds.fetch).toHaveBeenCalledWith('guild-123');
    });

    it('should handle message splitting correctly', () => {
        const shortMessage = 'Hello';
        const chunks = discordChannel['splitMessage'](shortMessage, 2000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe('Hello');

        const longMessage = 'A'.repeat(3000);
        const longChunks = discordChannel['splitMessage'](longMessage, 2000);
        expect(longChunks.length).toBeGreaterThan(1);
        expect(longChunks[0].length).toBeLessThanOrEqual(2000);
    });
});
