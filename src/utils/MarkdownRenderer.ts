/**
 * MarkdownRenderer — Channel-aware markdown/formatting converter
 * 
 * LLMs produce standard Markdown (CommonMark). Each output channel supports
 * different formatting:
 * 
 *   - Telegram: MarkdownV2 (strict escaping rules) or HTML
 *   - WhatsApp: Subset (*bold*, _italic_, ~strike~, ```code```)
 *   - Discord: Full Markdown (pass-through)
 *   - Gateway: Raw Markdown (client renders)
 *   - Terminal: ANSI escape codes
 *   - Plain: Strip all formatting
 * 
 * This module converts LLM Markdown into the target format, handling edge
 * cases like nested formatting, code blocks, links, and special characters.
 */

import { logger } from './logger';

// ─── Types ───────────────────────────────────────────────────────────

export type RenderTarget =
    | 'telegram'     // MarkdownV2 with escaping
    | 'telegram_html' // HTML parse_mode for Telegram
    | 'whatsapp'     // WhatsApp-native subset
    | 'discord'      // Full markdown (pass-through, minor cleanup)
    | 'slack'        // Full markdown (Slack mrkdwn compatible subset)
    | 'gateway'      // Raw markdown (client renders)
    | 'terminal'     // ANSI color codes
    | 'plain';       // Strip all formatting

export interface RenderOptions {
    /** Maximum output length (will be truncated with "…" if exceeded) */
    maxLength?: number;
    /** Preserve code blocks without transformation */
    preserveCodeBlocks?: boolean;
    /** Strip image references (![alt](url)) */
    stripImages?: boolean;
}

// ─── ANSI helpers (for terminal) ─────────────────────────────────────

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    strikethrough: '\x1b[9m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
    bgGray: '\x1b[100m',
};

// ─── Code block extraction/restoration ───────────────────────────────
// We extract code blocks first so inner content isn't mangled by formatting.

interface CodeBlock {
    placeholder: string;
    original: string;
    lang?: string;
    code: string;
    inline: boolean;
}

let placeholderCounter = 0;

function extractCodeBlocks(text: string): { cleaned: string; blocks: CodeBlock[] } {
    const blocks: CodeBlock[] = [];
    let cleaned = text;

    // Fenced code blocks (```lang\n...\n```)
    cleaned = cleaned.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
        const ph = `\x00CB${placeholderCounter++}\x00`;
        blocks.push({ placeholder: ph, original: _match, lang: lang || undefined, code, inline: false });
        return ph;
    });

    // Fenced code blocks without trailing newline after lang (```lang...```)
    cleaned = cleaned.replace(/```(\w*)([\s\S]*?)```/g, (_match, lang, code) => {
        const ph = `\x00CB${placeholderCounter++}\x00`;
        blocks.push({ placeholder: ph, original: _match, lang: lang || undefined, code, inline: false });
        return ph;
    });

    // Inline code (`...`)
    cleaned = cleaned.replace(/`([^`\n]+?)`/g, (_match, code) => {
        const ph = `\x00CB${placeholderCounter++}\x00`;
        blocks.push({ placeholder: ph, original: _match, lang: undefined, code, inline: true });
        return ph;
    });

    return { cleaned, blocks };
}

// ─── Telegram MarkdownV2 ─────────────────────────────────────────────

/** Characters that must be escaped in Telegram MarkdownV2 outside special contexts */
const TG_ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

function escTg(text: string): string {
    return text.replace(TG_ESCAPE_CHARS, '\\$1');
}

function renderTelegramMarkdownV2(text: string, blocks: CodeBlock[]): string {
    let out = text;

    // Headings → bold
    out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, content) => `*${escTg(content.trim())}*`);

    // Bold: **text** or __text__
    out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner) => `*${escTg(inner)}*`);
    out = out.replace(/__(.+?)__/g, (_m, inner) => `*${escTg(inner)}*`);

    // Italic: *text* or _text_ (single)
    // Must come after bold replacement
    out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, inner) => `_${escTg(inner)}_`);
    out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_m, inner) => `_${escTg(inner)}_`);

    // Strikethrough: ~~text~~
    out = out.replace(/~~(.+?)~~/g, (_m, inner) => `~${escTg(inner)}~`);

    // Images: ![alt](url) → just link (MUST come before links)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `[${escTg(alt || 'image')}](${url})`);

    // Links: [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `[${escTg(label)}](${url})`);

    // Blockquotes: > text
    out = out.replace(/^>\s?(.*)$/gm, (_m, line) => `>${escTg(line)}`);

    // Horizontal rules: --- or *** or ___
    out = out.replace(/^[-*_]{3,}$/gm, '\\-\\-\\-');

    // Unordered list items: - item or * item
    out = out.replace(/^[\s]*[-*+]\s+/gm, (match) => escTg(match));

    // Ordered list items: 1. item
    out = out.replace(/^(\s*\d+)\.\s+/gm, (_m, num) => `${escTg(num)}\\. `);

    // Escape remaining special chars that aren't already in a formatting context
    // We do a selective pass: escape chars not adjacent to formatting markers
    // This is tricky — instead we escape any remaining unescaped specials line-by-line
    // outside of already-formatted segments.
    // For now, trust the above transformations covered the main cases.

    // Restore code blocks
    for (const block of blocks) {
        if (block.inline) {
            out = out.replace(block.placeholder, `\`${block.code}\``);
        } else {
            out = out.replace(block.placeholder, `\`\`\`${block.lang || ''}\n${block.code}\`\`\``);
        }
    }

    return out;
}

// ─── Telegram HTML ───────────────────────────────────────────────────

function escHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderTelegramHTML(text: string, blocks: CodeBlock[]): string {
    let out = text;

    // Headings → bold
    out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, content) => `<b>${escHtml(content.trim())}</b>`);

    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner) => `<b>${escHtml(inner)}</b>`);
    out = out.replace(/__(.+?)__/g, (_m, inner) => `<b>${escHtml(inner)}</b>`);

    // Italic (after bold)
    out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, inner) => `<i>${escHtml(inner)}</i>`);
    out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_m, inner) => `<i>${escHtml(inner)}</i>`);

    // Strikethrough
    out = out.replace(/~~(.+?)~~/g, (_m, inner) => `<s>${escHtml(inner)}</s>`);

    // Images → link (MUST come before links)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<a href="${url}">${escHtml(alt || 'image')}</a>`);

    // Links
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${url}">${escHtml(label)}</a>`);

    // Blockquotes
    out = out.replace(/^>\s?(.*)$/gm, (_m, line) => `<blockquote>${escHtml(line)}</blockquote>`);

    // Horizontal rules
    out = out.replace(/^[-*_]{3,}$/gm, '—————');

    // Escape remaining HTML chars in non-tag regions
    // (Selective — we already escaped inside helpers, but free text may have < > &)
    // We do a final pass that avoids our own tags
    out = out.replace(/&(?!amp;|lt;|gt;)/g, '&amp;');

    // Restore code blocks
    for (const block of blocks) {
        if (block.inline) {
            out = out.replace(block.placeholder, `<code>${escHtml(block.code)}</code>`);
        } else {
            const langAttr = block.lang ? ` class="language-${block.lang}"` : '';
            out = out.replace(block.placeholder, `<pre${langAttr}><code>${escHtml(block.code)}</code></pre>`);
        }
    }

    return out;
}

// ─── WhatsApp ────────────────────────────────────────────────────────

function renderWhatsApp(text: string, blocks: CodeBlock[]): string {
    let out = text;

    // Headings → bold
    out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, content) => `*${content.trim()}*`);

    // Bold: **text** → *text* (WhatsApp)
    out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner) => `*${inner}*`);
    out = out.replace(/__(.+?)__/g, (_m, inner) => `*${inner}*`);

    // Italic: *text* → _text_ (WhatsApp)  
    // Be careful not to re-match our newly created *bold* markers
    // Actually, single-star italic from LLM should be rare after bold conversion;
    // handle _text_ → _text_ (already correct for WhatsApp)

    // Strikethrough: ~~text~~ → ~text~ (WhatsApp)
    out = out.replace(/~~(.+?)~~/g, (_m, inner) => `~${inner}~`);

    // Images: ![alt](url) → url (MUST come before links to avoid partial match)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, url) => url);

    // Links: [text](url) → text (url) — WhatsApp auto-links URLs
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `${label} (${url})`);

    // Blockquotes: > text (WhatsApp doesn't support, use indent)
    out = out.replace(/^>\s?(.*)$/gm, (_m, line) => `▎ ${line}`);

    // Horizontal rules → simple line
    out = out.replace(/^[-*_]{3,}$/gm, '─────────────');

    // Restore code blocks
    for (const block of blocks) {
        if (block.inline) {
            // WhatsApp uses monospace via ``` for inline too (3 backticks)
            out = out.replace(block.placeholder, `\`${block.code}\``);
        } else {
            out = out.replace(block.placeholder, `\`\`\`${block.code}\`\`\``);
        }
    }

    return out;
}

// ─── Discord ─────────────────────────────────────────────────────────

function renderDiscord(text: string, blocks: CodeBlock[]): string {
    // Discord supports standard Markdown natively.
    // Minimal cleanup: just restore code blocks and handle edge cases.
    let out = text;

    // Discord doesn't support # headings in chat — convert to **bold**
    out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, content) => `**${content.trim()}**`);

    // Images: ![alt](url) → just the URL (Discord will embed it)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, url) => url);

    // Restore code blocks as-is
    for (const block of blocks) {
        if (block.inline) {
            out = out.replace(block.placeholder, `\`${block.code}\``);
        } else {
            out = out.replace(block.placeholder, `\`\`\`${block.lang || ''}\n${block.code}\`\`\``);
        }
    }

    return out;
}

// ─── Terminal (ANSI) ─────────────────────────────────────────────────

function renderTerminal(text: string, blocks: CodeBlock[]): string {
    let out = text;

    // Headings → bold + color
    out = out.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, content) => {
        const level = hashes.length;
        const color = level <= 2 ? ANSI.cyan : level <= 4 ? ANSI.yellow : ANSI.white;
        return `${color}${ANSI.bold}${content.trim()}${ANSI.reset}`;
    });

    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner) => `${ANSI.bold}${inner}${ANSI.reset}`);
    out = out.replace(/__(.+?)__/g, (_m, inner) => `${ANSI.bold}${inner}${ANSI.reset}`);

    // Italic
    out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, inner) => `${ANSI.italic}${inner}${ANSI.reset}`);
    out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_m, inner) => `${ANSI.italic}${inner}${ANSI.reset}`);

    // Strikethrough
    out = out.replace(/~~(.+?)~~/g, (_m, inner) => `${ANSI.strikethrough}${inner}${ANSI.reset}`);

    // Images → dim reference (MUST come before links)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `${ANSI.dim}[${alt || 'image'}: ${url}]${ANSI.reset}`);

    // Links: [text](url) → text (underlined url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `${label} ${ANSI.dim}(${ANSI.underline}${url}${ANSI.reset}${ANSI.dim})${ANSI.reset}`);

    // Blockquotes
    out = out.replace(/^>\s?(.*)$/gm, (_m, line) => `${ANSI.dim}▎${ANSI.reset} ${ANSI.italic}${line}${ANSI.reset}`);

    // Horizontal rules
    out = out.replace(/^[-*_]{3,}$/gm, `${ANSI.dim}${'─'.repeat(40)}${ANSI.reset}`);

    // Unordered list bullets
    out = out.replace(/^(\s*)[-*+]\s+/gm, (_m, indent) => `${indent}${ANSI.cyan}•${ANSI.reset} `);

    // Ordered list
    out = out.replace(/^(\s*)(\d+)\.\s+/gm, (_m, indent, num) => `${indent}${ANSI.cyan}${num}.${ANSI.reset} `);

    // Restore code blocks
    for (const block of blocks) {
        if (block.inline) {
            out = out.replace(block.placeholder, `${ANSI.bgGray}${ANSI.white} ${block.code} ${ANSI.reset}`);
        } else {
            const header = block.lang ? `${ANSI.dim}── ${block.lang} ──${ANSI.reset}\n` : '';
            out = out.replace(block.placeholder, `${header}${ANSI.bgGray}${ANSI.white}\n${block.code}${ANSI.reset}`);
        }
    }

    return out;
}

// ─── Plain text ──────────────────────────────────────────────────────

function renderPlain(text: string, blocks: CodeBlock[]): string {
    let out = text;

    // Headings → just the text (uppercase for h1/h2)
    out = out.replace(/^(#{1,2})\s+(.+)$/gm, (_m, _h, content) => content.trim().toUpperCase());
    out = out.replace(/^#{3,6}\s+(.+)$/gm, (_m, content) => content.trim());

    // Bold / italic → plain
    out = out.replace(/\*\*(.+?)\*\*/g, '$1');
    out = out.replace(/__(.+?)__/g, '$1');
    out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
    out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1');

    // Strikethrough
    out = out.replace(/~~(.+?)~~/g, '$1');

    // Images (MUST come before links)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `${alt || 'image'}: ${url}`);

    // Links
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

    // Blockquotes
    out = out.replace(/^>\s?(.*)$/gm, '  $1');

    // Horizontal rules
    out = out.replace(/^[-*_]{3,}$/gm, '---');

    // Restore code blocks as plain text
    for (const block of blocks) {
        if (block.inline) {
            out = out.replace(block.placeholder, block.code);
        } else {
            out = out.replace(block.placeholder, block.code);
        }
    }

    return out;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Convert standard Markdown text to a channel-appropriate format.
 * 
 * @param text - Raw Markdown text (typically from an LLM response)
 * @param target - The output format/channel
 * @param options - Optional rendering configuration
 * @returns Formatted text for the target channel
 */
export function renderMarkdown(text: string, target: RenderTarget, options: RenderOptions = {}): string {
    if (!text) return text;

    try {
        // Extract code blocks to protect them from formatting transformations
        const { cleaned, blocks } = extractCodeBlocks(text);

        let result: string;

        switch (target) {
            case 'telegram':
                result = renderTelegramMarkdownV2(cleaned, blocks);
                break;
            case 'telegram_html':
                result = renderTelegramHTML(cleaned, blocks);
                break;
            case 'whatsapp':
                result = renderWhatsApp(cleaned, blocks);
                break;
            case 'discord':
            case 'slack':
                result = renderDiscord(cleaned, blocks);
                break;
            case 'gateway':
                // Gateway sends raw markdown — client-side rendering
                // Just restore code blocks
                result = cleaned;
                for (const block of blocks) {
                    result = result.replace(block.placeholder, block.original);
                }
                break;
            case 'terminal':
                result = renderTerminal(cleaned, blocks);
                break;
            case 'plain':
                result = renderPlain(cleaned, blocks);
                break;
            default:
                result = text;
        }

        // Strip images if requested
        if (options.stripImages) {
            result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
        }

        // Truncate if needed
        if (options.maxLength && result.length > options.maxLength) {
            result = result.substring(0, options.maxLength - 1) + '…';
        }

        return result;
    } catch (err) {
        logger.warn(`MarkdownRenderer: Error converting to ${target}, returning raw text: ${err}`);
        return text;
    }
}

/**
 * Detect if text contains Markdown formatting.
 * Useful for deciding whether to process through the renderer.
 */
export function hasMarkdown(text: string): boolean {
    if (!text) return false;
    // Check for common markdown patterns
    return /\*\*|__|~~|```|`[^`]+`|^#{1,6}\s|^\s*[-*+]\s|\[.+?\]\(.+?\)|^>\s/m.test(text);
}

/**
 * Strip all Markdown formatting, returning plain text.
 * Convenience wrapper around renderMarkdown(text, 'plain').
 */
export function stripMarkdown(text: string): string {
    return renderMarkdown(text, 'plain');
}

/**
 * Map channel source names to render targets.
 * Used by the agent to auto-detect the right format.
 */
export function channelToRenderTarget(source: string): RenderTarget {
    switch (source?.toLowerCase()) {
        case 'telegram':
            return 'telegram_html';  // HTML is safer than MarkdownV2 (less escaping issues)
        case 'whatsapp':
            return 'whatsapp';
        case 'discord':
            return 'discord';
        case 'slack':
            return 'slack';
        case 'gateway':
        case 'gateway-chat':
            return 'gateway';
        default:
            return 'plain';
    }
}
