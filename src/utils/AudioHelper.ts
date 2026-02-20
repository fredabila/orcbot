import path from 'path';
import fs from 'fs';
import os from 'os';
import { logger } from './logger';

// Formats natively accepted by OpenAI Whisper API
const WHISPER_SUPPORTED_FORMATS = new Set(['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']);

// Formats accepted by the Google Gemini / Generative Language API for audio
const GEMINI_AUDIO_SUPPORTED_FORMATS = new Set(['mp3', 'wav', 'aiff', 'aac', 'ogg', 'flac']);

/**
 * Given an audio file path, converts it to MP3 if it's in an unsupported format
 * for OpenAI Whisper. Returns the (possibly new) file path.
 *
 * This uses the bundled @ffmpeg-installer/ffmpeg so no system FFmpeg is required.
 */
export async function convertToWhisperCompatible(inputPath: string): Promise<string> {
    const ext = path.extname(inputPath).toLowerCase().replace('.', '');

    if (WHISPER_SUPPORTED_FORMATS.has(ext)) {
        // Already compatible – return as-is
        return inputPath;
    }

    logger.info(`AudioHelper: Converting unsupported audio format '.${ext}' to MP3 for Whisper...`);
    const outputPath = path.join(os.tmpdir(), `orcbot_audio_${Date.now()}.mp3`);

    try {
        await transcodeWithFfmpeg(inputPath, outputPath);
        logger.info(`AudioHelper: Converted '${inputPath}' → '${outputPath}'`);
        return outputPath;
    } catch (e) {
        logger.error(`AudioHelper: FFmpeg transcoding failed, using original: ${e}`);
        return inputPath; // Graceful fallback – let the API give a proper error message
    }
}

/**
 * Detect whether a file is an audio file based on its extension.
 */
export function isAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const audioExts = new Set([
        'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm',
        'ogg', 'opus', 'flac', 'aac', 'amr', 'aiff', 'wma', 'ra', 'au', 'caf'
    ]);
    return audioExts.has(ext);
}

/**
 * Detect whether a file is an image based on its extension.
 */
export function isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'avif', 'heic']).has(ext);
}

/**
 * Detect whether a file is a video based on its extension.
 */
export function isVideoFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return new Set(['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'ogv', 'm4v', '3gp']).has(ext);
}

/**
 * Get the MIME type for a file, covering a wide range of formats.
 */
export function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap: Record<string, string> = {
        // Images
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        tiff: 'image/tiff', tif: 'image/tiff', svg: 'image/svg+xml',
        avif: 'image/avif', heic: 'image/heic',
        // Video
        mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
        mkv: 'video/x-matroska', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
        webm: 'video/webm', ogv: 'video/ogg', m4v: 'video/x-m4v', '3gp': 'video/3gpp',
        // Audio
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus',
        flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', amr: 'audio/amr',
        aiff: 'audio/aiff', wma: 'audio/x-ms-wma', ra: 'audio/x-realaudio',
        // Documents
        pdf: 'application/pdf', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html',
        xml: 'text/xml', json: 'application/json', md: 'text/markdown',
        // Archives
        zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
        rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
    };
    return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Transcode any audio/video file to MP3 using fluent-ffmpeg.
 */
async function transcodeWithFfmpeg(inputPath: string, outputPath: string): Promise<void> {
    // Lazily load to keep startup fast
    const ffmpeg = (await import('fluent-ffmpeg')).default;
    const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).path;
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .audioBitrate('128k')
            .format('mp3')
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .save(outputPath);
    });
}
