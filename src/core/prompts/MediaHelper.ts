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

    private static readonly MEDIA_SIGNALS: RegExp[] = [
        /\bvoice\b/i, /\baudio\b/i, /\btranscri\b/i, /\bspeech\b/i, /\blisten\b/i,
        /\brecord\b/i, /\bimage\b/i, /\bphoto\b/i, /\bpicture\b/i, /\bscreenshot\b/i,
        /\bvisual\b/i, /\bcamera\b/i, /\bdocument\b/i, /\bpdf\b/i, /\bfile\b/i,
        /\battachment\b/i, /\bupload\b/i, /\bdownload\b/i, /\bvideo\b/i, /\bmedia\b/i,
        /\banalyze\b/i, /\bexamine\b/i, /\bocr\b/i, /\bread image\b/i, /\bsend voice\b/i,
        /\bvoice note\b/i, /\btts\b/i, /\btext to speech\b/i, /\[voice:/i,
        /\bfile stored at:/i, /\bsticker\b/i, /\bgif\b/i, /\bgenerate image\b/i,
        /\bcreate image\b/i, /\bdraw\b/i, /\billustration\b/i, /\bmake an image\b/i,
        /\bmake a picture\b/i, /\bmake me an image\b/i, /\bmake me a picture\b/i,
        /\bgenerate a\b/i, /\bdesign a\b/i, /\brender\b/i, /\bart of\b/i, /\bartwork\b/i
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Contextual signals: file path indicators, file extension mentions
        if (task.includes('file stored at:') || task.includes('[voice:')) return true;
        // File extension pattern: .pdf, .jpg, .mp3, .docx, etc.
        if (/\.(pdf|doc|docx|xls|xlsx|csv|jpg|jpeg|png|gif|svg|mp3|mp4|wav|zip|tar)\b/.test(task)) return true;
        return MediaHelper.MEDIA_SIGNALS.some(rx => rx.test(task));
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `MEDIA & VOICE HANDLING:
- **Auto-Transcription**: When a user sends a voice/audio message, it is AUTOMATICALLY transcribed before reaching you. The transcription text appears in the task description (e.g., [Voice: "..."]) — you do NOT need to call \`analyze_media\` to transcribe voice messages. Just read the transcription and respond normally.
- **Images & Documents**: When a user sends an image or document, the file path appears in the task description (e.g., "File stored at: ..."). Use \`analyze_media(path, prompt)\` to examine visual content or extract document text.
- **Responding with Voice**: You can reply with a voice message using \`send_voice_note(jid, text, voice?)\`. This converts your text to speech and sends it as a playable voice bubble (not a file). Use this when:
  1. The user sent a voice message to you (mirror their communication style)
  2. The user explicitly asks for a voice/audio reply
  3. The message is conversational and voice feels more natural than text
  Available voices:  achernar, achird, algenib, algieba, alnilam, aoede, autonoe, callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi (default: zephyr)
- **Voice + Text**: You can combine both — send a text reply AND a voice note in the same step if appropriate.
- **TTS Only**: Use \`text_to_speech(text, voice?)\` to generate an audio file without sending it. Useful when you want to attach it later or use \`send_file\` instead.
- **Media Files**: Downloaded files (from any channel) are stored in the downloads directory. The path is always provided in the task description.

FILE DELIVERY WORKFLOW:
- **\`send_file\` is the delivery skill**: After producing or downloading any file meant for the user (documents, images, audio, PDFs, text files), use \`send_file(jid, path, caption?)\` to deliver it through the active messaging channel.
- **write_file → send_file pipeline**: If you create content with \`write_file\` or download with \`download_file\`, the file exists only on the host system. The user cannot access it unless you follow up with \`send_file\`. Always chain: produce file → send file → confirm.
- **Don't just announce**: Sending a text message like "I saved the file to evolution.txt" without actually sending the file is incomplete. The user expects to receive the file in their chat.

IMAGE GENERATION:
- **\`send_image\` is the PREFERRED skill**: Use \`send_image(jid, prompt, size?, quality?, caption?)\` to generate AND send an image in one step. This prevents duplicate files and ensures delivery.
- **\`generate_image\` is for FILE-ONLY use**: Use \`generate_image(prompt)\` ONLY when you need the file path without sending it (e.g., for further processing). In most cases, use send_image instead.
- **NEVER call generate_image twice**: One call per image request. If you already generated an image, do NOT generate again — use the file path from the first result.
- **Prompt quality**: Be descriptive — describe the scene, style, lighting, mood. A narrative paragraph produces better results than a keyword list.
- **Available sizes**: 1024x1024 (square, default), 1024x1536 (portrait), 1536x1024 (landscape)
- **Available quality**: low (fast), medium (balanced, default), high (best quality)
- **When to use**: When the user asks to "create", "generate", "draw", "make", "design" an image or picture.`;
    }
}
