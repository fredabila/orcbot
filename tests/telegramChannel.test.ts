import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { TelegramChannel } from '../src/channels/TelegramChannel';

const sendPhoto = vi.fn();
const sendDocument = vi.fn();
const sendVideo = vi.fn();
const sendAudio = vi.fn();
const sendVoice = vi.fn();

vi.mock('telegraf', () => ({
    Telegraf: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        command: vi.fn(),
        on: vi.fn(),
        telegram: {
            sendPhoto,
            sendDocument,
            sendVideo,
            sendAudio,
            sendVoice,
            sendChatAction: vi.fn(),
            editMessageText: vi.fn(),
            getFileLink: vi.fn()
        }
    }))
}));

describe('TelegramChannel.sendFile', () => {
    let channel: TelegramChannel;

    beforeEach(() => {
        sendPhoto.mockReset();
        sendDocument.mockReset();
        sendVideo.mockReset();
        sendAudio.mockReset();
        sendVoice.mockReset();

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);

        const mockAgent = {
            config: {
                get: vi.fn((key: string) => {
                    if (key === 'agentName') return 'TestBot';
                    return undefined;
                }),
                getDataHome: vi.fn(() => 'D:/orcbot-test')
            },
            memory: {
                searchMemory: vi.fn(() => []),
                deleteMemory: vi.fn(),
                saveMemory: vi.fn()
            },
            actionQueue: {
                getQueue: vi.fn(() => []),
                getActive: vi.fn(() => [])
            },
            skills: {
                getAllSkills: vi.fn(() => [])
            },
            llm: {
                getModelAvailabilitySummary: vi.fn(() => ''),
                analyzeMedia: vi.fn()
            },
            getKnownUsers: vi.fn(() => []),
            getCurrentActionId: vi.fn(() => null),
            resolveSessionScopeId: vi.fn(() => 'scope:test'),
            messageBus: {
                dispatch: vi.fn()
            },
            cancelAction: vi.fn()
        } as any;

        channel = new TelegramChannel('fake-token', mockAgent);
    });

    it('sends svg files as documents instead of photos', async () => {
        await channel.sendFile('12345', 'D:/orcbot-test/flying-duck.svg', 'Duck');

        expect(sendPhoto).not.toHaveBeenCalled();
        expect(sendDocument).toHaveBeenCalledOnce();
    });

    it('falls back to document when Telegram image processing fails', async () => {
        sendPhoto.mockRejectedValueOnce({
            response: {
                description: 'Bad Request: IMAGE_PROCESS_FAILED'
            }
        });

        await channel.sendFile('12345', 'D:/orcbot-test/flying-duck.png', 'Duck');

        expect(sendPhoto).toHaveBeenCalledOnce();
        expect(sendDocument).toHaveBeenCalledOnce();
    });
});