import { describe, it, expect } from 'vitest';
import { renderMarkdown, hasMarkdown, stripMarkdown, channelToRenderTarget } from '../src/utils/MarkdownRenderer';

// ─── hasMarkdown detection ───────────────────────────────────────────

describe('hasMarkdown', () => {
    it('should detect bold text', () => {
        expect(hasMarkdown('This is **bold** text')).toBe(true);
        expect(hasMarkdown('This is __also bold__')).toBe(true);
    });

    it('should detect headings', () => {
        expect(hasMarkdown('# Heading 1')).toBe(true);
        expect(hasMarkdown('## Heading 2')).toBe(true);
        expect(hasMarkdown('### Deep Heading')).toBe(true);
    });

    it('should detect code', () => {
        expect(hasMarkdown('Use `code` here')).toBe(true);
        expect(hasMarkdown('```\ncode block\n```')).toBe(true);
    });

    it('should detect links', () => {
        expect(hasMarkdown('Click [here](https://example.com)')).toBe(true);
    });

    it('should detect blockquotes', () => {
        expect(hasMarkdown('> quoted text')).toBe(true);
    });

    it('should detect strikethrough', () => {
        expect(hasMarkdown('This is ~~deleted~~ text')).toBe(true);
    });

    it('should detect list items', () => {
        expect(hasMarkdown('- item one')).toBe(true);
        expect(hasMarkdown('* item two')).toBe(true);
    });

    it('should return false for plain text', () => {
        expect(hasMarkdown('Hello world, no formatting here.')).toBe(false);
        expect(hasMarkdown('Just a simple sentence.')).toBe(false);
    });

    it('should handle empty/null input', () => {
        expect(hasMarkdown('')).toBe(false);
        expect(hasMarkdown(null as any)).toBe(false);
    });
});

// ─── channelToRenderTarget mapping ───────────────────────────────────

describe('channelToRenderTarget', () => {
    it('should map telegram to telegram_html', () => {
        expect(channelToRenderTarget('telegram')).toBe('telegram_html');
    });

    it('should map whatsapp to whatsapp', () => {
        expect(channelToRenderTarget('whatsapp')).toBe('whatsapp');
    });

    it('should map discord to discord', () => {
        expect(channelToRenderTarget('discord')).toBe('discord');
    });

    it('should map gateway to gateway', () => {
        expect(channelToRenderTarget('gateway')).toBe('gateway');
        expect(channelToRenderTarget('gateway-chat')).toBe('gateway');
    });

    it('should default to plain for unknown sources', () => {
        expect(channelToRenderTarget('unknown')).toBe('plain');
        expect(channelToRenderTarget('')).toBe('plain');
    });
});

// ─── stripMarkdown ───────────────────────────────────────────────────

describe('stripMarkdown', () => {
    it('should strip bold', () => {
        expect(stripMarkdown('This is **bold** text')).toBe('This is bold text');
    });

    it('should strip headings and uppercase h1/h2', () => {
        expect(stripMarkdown('# Main Title')).toBe('MAIN TITLE');
        expect(stripMarkdown('## Sub Title')).toBe('SUB TITLE');
        expect(stripMarkdown('### Section')).toBe('Section');
    });

    it('should strip links but preserve text and url', () => {
        expect(stripMarkdown('Visit [Google](https://google.com)')).toBe('Visit Google (https://google.com)');
    });

    it('should strip inline code', () => {
        expect(stripMarkdown('Run `npm install` now')).toBe('Run npm install now');
    });

    it('should strip code blocks', () => {
        const input = 'Before\n```js\nconsole.log("hi")\n```\nAfter';
        const result = stripMarkdown(input);
        expect(result).toContain('console.log("hi")');
        expect(result).not.toContain('```');
    });

    it('should strip strikethrough', () => {
        expect(stripMarkdown('~~removed~~ text')).toBe('removed text');
    });
});

// ─── Telegram HTML rendering ─────────────────────────────────────────

describe('renderMarkdown - telegram_html', () => {
    it('should convert bold to <b> tags', () => {
        const result = renderMarkdown('This is **bold** text', 'telegram_html');
        expect(result).toContain('<b>bold</b>');
    });

    it('should convert headings to bold', () => {
        const result = renderMarkdown('## My Section', 'telegram_html');
        expect(result).toContain('<b>My Section</b>');
    });

    it('should convert italic to <i> tags', () => {
        // Use underscore italic to avoid confusion with bold stars
        const result = renderMarkdown('This is __bold__ and more', 'telegram_html');
        expect(result).toContain('<b>bold</b>');
    });

    it('should convert strikethrough to <s> tags', () => {
        const result = renderMarkdown('This is ~~deleted~~ text', 'telegram_html');
        expect(result).toContain('<s>deleted</s>');
    });

    it('should convert links to <a> tags', () => {
        const result = renderMarkdown('Click [here](https://example.com)', 'telegram_html');
        expect(result).toContain('<a href="https://example.com">here</a>');
    });

    it('should convert inline code to <code> tags', () => {
        const result = renderMarkdown('Run `npm install`', 'telegram_html');
        expect(result).toContain('<code>npm install</code>');
    });

    it('should convert code blocks to <pre><code> tags', () => {
        const result = renderMarkdown('```js\nconsole.log("hi")\n```', 'telegram_html');
        expect(result).toContain('<pre');
        expect(result).toContain('<code>');
        expect(result).toContain('console.log');
    });

    it('should escape HTML special chars in regular text', () => {
        const result = renderMarkdown('Use **a < b > c** comparison', 'telegram_html');
        expect(result).toContain('&lt;');
        expect(result).toContain('&gt;');
    });

    it('should convert blockquotes', () => {
        const result = renderMarkdown('> Important note', 'telegram_html');
        expect(result).toContain('<blockquote>');
    });
});

// ─── WhatsApp rendering ──────────────────────────────────────────────

describe('renderMarkdown - whatsapp', () => {
    it('should convert double-star bold to single-star', () => {
        const result = renderMarkdown('This is **bold** text', 'whatsapp');
        expect(result).toBe('This is *bold* text');
    });

    it('should convert headings to bold', () => {
        const result = renderMarkdown('## Title', 'whatsapp');
        expect(result).toBe('*Title*');
    });

    it('should convert strikethrough ~~ to single ~', () => {
        const result = renderMarkdown('~~deleted~~ text', 'whatsapp');
        expect(result).toBe('~deleted~ text');
    });

    it('should convert links to text (url) format', () => {
        const result = renderMarkdown('[Google](https://google.com)', 'whatsapp');
        expect(result).toBe('Google (https://google.com)');
    });

    it('should convert blockquotes to ▎ prefix', () => {
        const result = renderMarkdown('> Note here', 'whatsapp');
        expect(result).toBe('▎ Note here');
    });

    it('should convert images to bare URL', () => {
        const result = renderMarkdown('![photo](https://img.com/a.jpg)', 'whatsapp');
        expect(result).toBe('https://img.com/a.jpg');
    });

    it('should preserve code blocks', () => {
        const result = renderMarkdown('```\nsome code\n```', 'whatsapp');
        expect(result).toContain('```');
        expect(result).toContain('some code');
    });
});

// ─── Discord rendering ───────────────────────────────────────────────

describe('renderMarkdown - discord', () => {
    it('should convert headings to bold (Discord doesnt render # in chat)', () => {
        const result = renderMarkdown('## My Section', 'discord');
        expect(result).toBe('**My Section**');
    });

    it('should preserve bold as-is', () => {
        const result = renderMarkdown('This is **bold** text', 'discord');
        expect(result).toContain('**bold**');
    });

    it('should preserve code blocks', () => {
        const input = '```js\nconsole.log("hi")\n```';
        const result = renderMarkdown(input, 'discord');
        expect(result).toContain('```js');
        expect(result).toContain('console.log("hi")');
    });

    it('should convert images to bare URLs', () => {
        const result = renderMarkdown('![image](https://img.com/a.png)', 'discord');
        expect(result).toBe('https://img.com/a.png');
    });

    it('should preserve links and other formatting', () => {
        const result = renderMarkdown('[link](https://example.com)', 'discord');
        expect(result).toContain('[link](https://example.com)');
    });
});

// ─── Terminal ANSI rendering ─────────────────────────────────────────

describe('renderMarkdown - terminal', () => {
    it('should add ANSI bold for headings', () => {
        const result = renderMarkdown('## Title', 'terminal');
        expect(result).toContain('\x1b[1m');  // bold
        expect(result).toContain('Title');
        expect(result).toContain('\x1b[0m');  // reset
    });

    it('should add ANSI bold for bold text', () => {
        const result = renderMarkdown('**important**', 'terminal');
        expect(result).toContain('\x1b[1m');
        expect(result).toContain('important');
    });

    it('should convert bullets to colored dots', () => {
        const result = renderMarkdown('- item one\n- item two', 'terminal');
        expect(result).toContain('•');
    });

    it('should render blockquotes with bar and italic', () => {
        const result = renderMarkdown('> quote text', 'terminal');
        expect(result).toContain('▎');
    });

    it('should render code blocks with background', () => {
        const result = renderMarkdown('```\ncode\n```', 'terminal');
        expect(result).toContain('\x1b[100m');  // bgGray
        expect(result).toContain('code');
    });

    it('should render inline code with background', () => {
        const result = renderMarkdown('Run `npm install`', 'terminal');
        expect(result).toContain('\x1b[100m');  // bgGray
        expect(result).toContain('npm install');
    });
});

// ─── Gateway (pass-through) ──────────────────────────────────────────

describe('renderMarkdown - gateway', () => {
    it('should pass through markdown unchanged', () => {
        const input = '# Title\n\nThis is **bold** and `code`.\n\n```js\nfoo()\n```';
        const result = renderMarkdown(input, 'gateway');
        expect(result).toContain('# Title');
        expect(result).toContain('**bold**');
        expect(result).toContain('`code`');
        expect(result).toContain('```js');
    });
});

// ─── Edge cases ──────────────────────────────────────────────────────

describe('renderMarkdown - edge cases', () => {
    it('should handle empty string', () => {
        expect(renderMarkdown('', 'telegram_html')).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
        expect(renderMarkdown(null as any, 'plain')).toBe(null);
        expect(renderMarkdown(undefined as any, 'discord')).toBe(undefined);
    });

    it('should handle text with no markdown', () => {
        const plain = 'Just a normal sentence with no formatting.';
        expect(renderMarkdown(plain, 'telegram_html')).toBe(plain);
        expect(renderMarkdown(plain, 'whatsapp')).toBe(plain);
        expect(renderMarkdown(plain, 'discord')).toBe(plain);
    });

    it('should respect maxLength option', () => {
        const long = 'A'.repeat(200);
        const result = renderMarkdown(long, 'plain', { maxLength: 50 });
        expect(result.length).toBe(50);
        expect(result.endsWith('…')).toBe(true);
    });

    it('should protect code blocks from formatting transformations', () => {
        // Code inside backticks should NOT have its underscores treated as italic
        const result = renderMarkdown('Use `my_var_name` in code', 'telegram_html');
        expect(result).toContain('<code>my_var_name</code>');
        // Should NOT be mangled to my<i>var</i>name or similar
        expect(result).not.toContain('<i>');
    });

    it('should handle mixed formatting in a real LLM response', () => {
        const llmResponse = `## Summary

Here's what I found:

1. **File A** - Contains the main logic
2. **File B** - Has the ~~old~~ updated tests

> Note: Run \`npm test\` before merging.

\`\`\`bash
npm run build && npm test
\`\`\`

Visit [docs](https://docs.example.com) for more info.`;

        // Telegram HTML
        const tgHtml = renderMarkdown(llmResponse, 'telegram_html');
        expect(tgHtml).toContain('<b>Summary</b>');
        expect(tgHtml).toContain('<b>File A</b>');
        expect(tgHtml).toContain('<s>old</s>');
        expect(tgHtml).toContain('<code>npm test</code>');
        expect(tgHtml).toContain('<pre');
        expect(tgHtml).toContain('<a href=');

        // WhatsApp
        const wa = renderMarkdown(llmResponse, 'whatsapp');
        expect(wa).toContain('*Summary*');
        expect(wa).toContain('*File A*');
        expect(wa).toContain('~old~');
        expect(wa).toContain('▎');

        // Plain
        const plain = renderMarkdown(llmResponse, 'plain');
        expect(plain).not.toContain('**');
        expect(plain).not.toContain('~~');
        expect(plain).not.toContain('<b>');
    });
});
