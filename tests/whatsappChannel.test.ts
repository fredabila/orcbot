import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { eventBus } from '../src/core/EventBus';

const baileysState = vi.hoisted(() => {
    const handlers: Record<string, any> = {};
    const socket = {
        ev: {
            on: vi.fn((event: string, handler: any) => {
                handlers[event] = handler;
            })
        },
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
        end: vi.fn().mockResolvedValue(undefined),
        user: { id: '999999999:1@s.whatsapp.net' }
    };

    return {
        handlers,
        socket,
        downloadMediaMessage: vi.fn().mockResolvedValue(Buffer.from('media'))
    };
});

vi.mock('@whiskeysockets/baileys', () => ({
    __esModule: true,
    default: vi.fn(() => baileysState.socket),
    DisconnectReason: { loggedOut: 401 },
    useMultiFileAuthState: vi.fn().mockResolvedValue({ state: {}, saveCreds: vi.fn() }),
    fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [1, 0, 0], isLatest: true }),
    makeCacheableSignalKeyStore: vi.fn(),
    downloadMediaMessage: baileysState.downloadMediaMessage
}));

vi.mock('qrcode-terminal', () => ({
    __esModule: true,
    default: { generate: vi.fn() },
    generate: vi.fn()
}));

vi.mock('pino', () => ({
    __esModule: true,
    default: vi.fn(() => ({}))
}));

vi.mock('../src/utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}));

import { WhatsAppChannel } from '../src/channels/WhatsAppChannel';

describe('WhatsAppChannel runtime gating', () => {
    let tempDir: string;
    let configValues: Record<string, any>;
    let mockAgent: any;
    let channel: WhatsAppChannel;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcbot-wa-test-'));
        configValues = {
            whatsappSessionPath: path.join(tempDir, 'session'),
            whatsappAutoReplyEnabled: true,
            whatsappStatusReplyEnabled: false,
            whatsappAutoReactEnabled: false,
            whatsappContextProfilingEnabled: false,
            whatsappOwnerJID: '999999999@s.whatsapp.net'
        };

        Object.keys(baileysState.handlers).forEach(key => delete baileysState.handlers[key]);
        baileysState.socket.ev.on.mockClear();
        baileysState.socket.sendMessage.mockClear();
        baileysState.socket.sendPresenceUpdate.mockClear();
        baileysState.socket.end.mockClear();
        baileysState.downloadMediaMessage.mockClear();
        eventBus.removeAllListeners();

        mockAgent = {
            config: {
                get: vi.fn((key: string) => configValues[key]),
                set: vi.fn((key: string, value: any) => {
                    configValues[key] = value;
                }),
                getDataHome: vi.fn(() => tempDir)
            },
            messageBus: {
                dispatch: vi.fn().mockResolvedValue(undefined)
            },
            llm: {
                analyzeMedia: vi.fn().mockResolvedValue('detected media')
            }
        };

        channel = new WhatsAppChannel(mockAgent);
    });

    afterEach(async () => {
        eventBus.removeAllListeners();
        if (channel) {
            await channel.stop();
        }
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('does not suppress the first direct message in a chat', async () => {
        await channel.start();

        await baileysState.handlers['messages.upsert']({
            type: 'notify',
            messages: [
                {
                    key: {
                        remoteJid: '123456789@s.whatsapp.net',
                        fromMe: false,
                        id: 'dm-1'
                    },
                    message: {
                        conversation: 'hello there'
                    },
                    pushName: 'Alice'
                }
            ]
        });

        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledTimes(1);
        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            source: 'whatsapp',
            sourceId: '123456789@s.whatsapp.net',
            content: 'hello there'
        }));
        expect(mockAgent.messageBus.dispatch.mock.calls[0][0].metadata?.suppressReply).toBeUndefined();
    });

    it('suppresses replies when a previous recent user message exists', async () => {
        await channel.start();
        (channel as any).lastUserMessageTimestamps.set('123456789@s.whatsapp.net', Date.now());

        await baileysState.handlers['messages.upsert']({
            type: 'notify',
            messages: [
                {
                    key: {
                        remoteJid: '123456789@s.whatsapp.net',
                        fromMe: false,
                        id: 'dm-2'
                    },
                    message: {
                        conversation: 'second message'
                    },
                    pushName: 'Alice'
                }
            ]
        });

        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledTimes(1);
        expect(mockAgent.messageBus.dispatch.mock.calls[0][0].metadata?.suppressReply).toBe(true);
    });

    it('ignores status updates when status interactions are disabled', async () => {
        await channel.start();

        await baileysState.handlers['messages.upsert']({
            type: 'notify',
            messages: [
                {
                    key: {
                        remoteJid: 'status@broadcast',
                        participant: '234567890@s.whatsapp.net',
                        fromMe: false,
                        id: 'status-1'
                    },
                    message: {
                        conversation: 'new status'
                    },
                    pushName: 'Bob'
                }
            ]
        });

        expect(mockAgent.messageBus.dispatch).not.toHaveBeenCalled();
    });

    it('dispatches status tasks when status interactions are enabled', async () => {
        configValues.whatsappStatusReplyEnabled = true;
        channel = new WhatsAppChannel(mockAgent);
        await channel.start();

        await baileysState.handlers['messages.upsert']({
            type: 'notify',
            messages: [
                {
                    key: {
                        remoteJid: 'status@broadcast',
                        participant: '234567890@s.whatsapp.net',
                        fromMe: false,
                        id: 'status-2'
                    },
                    message: {
                        conversation: 'look at this'
                    },
                    messageTimestamp: 123456,
                    pushName: 'Bob'
                }
            ]
        });

        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledTimes(1);
        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            source: 'whatsapp',
            sourceId: '234567890@s.whatsapp.net',
            content: 'look at this'
        }));
        expect(mockAgent.messageBus.dispatch.mock.calls[0][0].metadata).toEqual(expect.objectContaining({
            type: 'status',
            statusContentType: 'text',
            statusHasMedia: false,
            statusTimestamp: 123456
        }));
    });

    it('continues processing later messages when a group message appears first in the batch', async () => {
        await channel.start();

        await baileysState.handlers['messages.upsert']({
            type: 'notify',
            messages: [
                {
                    key: {
                        remoteJid: '12345@g.us',
                        fromMe: false,
                        id: 'group-1'
                    },
                    message: {
                        conversation: 'group chatter'
                    },
                    pushName: 'Group User'
                },
                {
                    key: {
                        remoteJid: '345678901@s.whatsapp.net',
                        fromMe: false,
                        id: 'dm-3'
                    },
                    message: {
                        conversation: 'follow-up dm'
                    },
                    pushName: 'Charlie'
                }
            ]
        });

        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledTimes(1);
        expect(mockAgent.messageBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            sourceId: '345678901@s.whatsapp.net',
            content: 'follow-up dm'
        }));
    });
});