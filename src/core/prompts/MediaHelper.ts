/**
 * MediaHelper — Activated for tasks involving voice, audio, images, or file operations.
 * Provides auto-transcription guidance, media analysis instructions, 
 * voice note creation rules, and file handling protocols.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class MediaHelper implements PromptHelper {
    readonly name = 'media';
    readonly description = 'Voice/audio, image analysis, TTS, file handling';
    readonly priority = 50;
    readonly alwaysActive = false;

    private static readonly MEDIA_SIGNALS = [
        'voice', 'audio', 'transcri', 'speech', 'listen', 'record',
        'image', 'photo', 'picture', 'screenshot', 'visual', 'camera',
        'document', 'pdf', 'file', 'attachment', 'upload', 'download',
        'video', 'media', 'analyze', 'examine', 'ocr', 'read image',
        'send voice', 'voice note', 'tts', 'text to speech',
        '[voice:', 'file stored at:', 'sticker', 'gif'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Also activate if the task contains file path indicators
        if (task.includes('file stored at:') || task.includes('[voice:')) return true;
        return MediaHelper.MEDIA_SIGNALS.some(kw => task.includes(kw));
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `MEDIA & VOICE HANDLING:
- **Auto-Transcription**: When a user sends a voice/audio message, it is AUTOMATICALLY transcribed before reaching you. The transcription text appears in the task description (e.g., [Voice: "..."]) — you do NOT need to call \`analyze_media\` to transcribe voice messages. Just read the transcription and respond normally.
- **Images & Documents**: When a user sends an image or document, the file path appears in the task description (e.g., "File stored at: ..."). Use \`analyze_media(path, prompt)\` to examine visual content or extract document text.
- **Responding with Voice**: You can reply with a voice message using \`send_voice_note(jid, text, voice?)\`. This converts your text to speech and sends it as a playable voice bubble (not a file). Use this when:
  1. The user sent a voice message to you (mirror their communication style)
  2. The user explicitly asks for a voice/audio reply
  3. The message is conversational and voice feels more natural than text
  Available voices: alloy, echo, fable, onyx, nova, shimmer (default: nova)
- **Voice + Text**: You can combine both — send a text reply AND a voice note in the same step if appropriate.
- **TTS Only**: Use \`text_to_speech(text, voice?)\` to generate an audio file without sending it. Useful when you want to attach it later or use \`send_file\` instead.
- **Media Files**: Downloaded files (from any channel) are stored in the downloads directory. The path is always provided in the task description.

FILE DELIVERY WORKFLOW:
- **\`send_file\` is the delivery skill**: After producing or downloading any file meant for the user (documents, images, audio, PDFs, text files), use \`send_file(jid, path, caption?)\` to deliver it through the active messaging channel.
- **write_file → send_file pipeline**: If you create content with \`write_file\` or download with \`download_file\`, the file exists only on the server. The user cannot access it unless you follow up with \`send_file\`. Always chain: produce file → send file → confirm.
- **Don't just announce**: Sending a text message like "I saved the file to evolution.txt" without actually sending the file is incomplete. The user expects to receive the file in their chat.`;
    }
}
