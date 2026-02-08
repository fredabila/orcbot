import { logger } from './logger';

/**
 * Semantic reaction categories that map to common emoji across platforms.
 * Agents can use semantic names instead of raw emoji to express intent naturally.
 */
export const REACTION_MAP: Record<string, string> = {
    // Positive
    'thumbs_up':    '👍',
    'like':         '👍',
    'ok':           '👍',
    'love':         '❤️',
    'heart':        '❤️',
    'fire':         '🔥',
    'amazing':      '🔥',
    'celebrate':    '🎉',
    'party':        '🎉',
    'clap':         '👏',
    'laugh':        '😂',
    'funny':        '😂',
    'haha':         '😂',
    'wow':          '😮',
    'surprised':    '😮',
    'cool':         '😎',
    'star':         '⭐',
    'hundred':      '💯',
    'perfect':      '💯',
    'rocket':       '🚀',
    'fast':         '🚀',
    'strong':       '💪',
    'pray':         '🙏',
    'thanks':       '🙏',
    'grateful':     '🙏',
    'smile':        '😊',
    'happy':        '😊',
    'wink':         '😉',

    // Acknowledgement
    'eyes':         '👀',
    'seen':         '👀',
    'looking':      '👀',
    'thinking':     '🤔',
    'hmm':          '🤔',
    'check':        '✅',
    'done':         '✅',
    'complete':     '✅',

    // Negative / Caution
    'thumbs_down':  '👎',
    'dislike':      '👎',
    'no':           '👎',
    'sad':          '😢',
    'cry':          '😢',
    'angry':        '😡',
    'warning':      '⚠️',
    'caution':      '⚠️',
    'cross':        '❌',
    'wrong':        '❌',
    'skull':        '💀',

    // Informational
    'question':     '❓',
    'info':         'ℹ️',
    'pin':          '📌',
    'bulb':         '💡',
    'idea':         '💡',
    'wave':         '👋',
    'hi':           '👋',
    'bye':          '👋',
    'clock':        '⏰',
    'wait':         '⏰',
    'soon':         '⏰',
};

/**
 * Resolve an emoji input — accepts either a semantic name (e.g. "thumbs_up", "love")
 * or a raw Unicode emoji (e.g. "👍", "❤️"). Returns the Unicode emoji.
 */
export function resolveEmoji(input: string): string {
    if (!input) return '👍'; // default

    const trimmed = input.trim().toLowerCase();

    // Check if it's a semantic name
    if (REACTION_MAP[trimmed]) {
        return REACTION_MAP[trimmed];
    }

    // Check common aliases without underscores (e.g. "thumbsup" → "thumbs_up")
    const noSpace = trimmed.replace(/[\s-]/g, '_');
    if (REACTION_MAP[noSpace]) {
        return REACTION_MAP[noSpace];
    }

    // If it looks like an emoji already (non-ASCII or known emoji patterns), return as-is
    // Simple heuristic: if it contains a character above basic ASCII, treat as emoji
    if (/[^\x00-\x7F]/.test(trimmed) || /[\u{1F000}-\u{1FFFF}]/u.test(trimmed)) {
        return trimmed;
    }

    // Last resort: check if it's a single word that partially matches a key
    for (const [key, emoji] of Object.entries(REACTION_MAP)) {
        if (key.includes(trimmed) || trimmed.includes(key)) {
            return emoji;
        }
    }

    logger.debug(`ReactionHelper: Unknown emoji "${input}", returning as-is`);
    return input;
}

/**
 * Detect the source channel from metadata of a memory entry.
 * Returns 'telegram' | 'whatsapp' | 'discord' | 'unknown'.
 */
export function detectChannelFromMetadata(metadata: any): 'telegram' | 'whatsapp' | 'discord' | 'unknown' {
    if (!metadata) return 'unknown';
    const source = (metadata.source || '').toLowerCase();
    if (source === 'telegram') return 'telegram';
    if (source === 'whatsapp') return 'whatsapp';
    if (source === 'discord') return 'discord';
    return 'unknown';
}

/**
 * Result of a reaction attempt.
 */
export interface ReactionResult {
    success: boolean;
    channel: string;
    emoji: string;
    error?: string;
}
