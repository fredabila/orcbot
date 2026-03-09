import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveBrowserScratchpadTarget } from '../src/core/BrowserScratchpad';

describe('resolveBrowserScratchpadTarget', () => {
    it('returns the default persistent browser scratchpad path', () => {
        const dataHome = path.join(path.sep, 'tmp', 'orcbot');
        const target = resolveBrowserScratchpadTarget(dataHome);

        expect(target).toEqual({
            scriptsDir: path.join(dataHome, 'browser-scripts'),
            scriptPath: path.join(dataHome, 'browser-scratchpad.js'),
            isNamedScript: false
        });
    });

    it('returns a named script path inside browser-scripts', () => {
        const dataHome = path.join(path.sep, 'tmp', 'orcbot');
        const target = resolveBrowserScratchpadTarget(dataHome, 'google-form.js');

        expect(target).toEqual({
            scriptsDir: path.join(dataHome, 'browser-scripts'),
            scriptPath: path.join(dataHome, 'browser-scripts', 'google-form.js'),
            isNamedScript: true
        });
    });

    it('normalizes path input down to a safe basename', () => {
        const dataHome = path.join(path.sep, 'tmp', 'orcbot');
        const target = resolveBrowserScratchpadTarget(dataHome, '../nested/site-flow.js');

        expect(target.scriptPath).toBe(path.join(dataHome, 'browser-scripts', 'site-flow.js'));
    });

    it('rejects filenames without a js extension', () => {
        const dataHome = path.join(path.sep, 'tmp', 'orcbot');

        expect(() => resolveBrowserScratchpadTarget(dataHome, 'site-flow.ts')).toThrow(
            'Filename must end with .js'
        );
    });
});