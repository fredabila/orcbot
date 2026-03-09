import { describe, expect, it } from 'vitest';
import { getBrowserPageViewportSize } from '../src/tools/ComputerUse';

describe('getBrowserPageViewportSize', () => {
    it('supports Puppeteer-style viewport()', () => {
        const page = {
            viewport: () => ({ width: 1280, height: 720 })
        };

        expect(getBrowserPageViewportSize(page)).toEqual({ width: 1280, height: 720 });
    });

    it('supports Playwright-style viewportSize()', () => {
        const page = {
            viewportSize: () => ({ width: 1440, height: 900 })
        };

        expect(getBrowserPageViewportSize(page)).toEqual({ width: 1440, height: 900 });
    });

    it('returns null when no viewport API is available', () => {
        expect(getBrowserPageViewportSize({})).toBeNull();
    });
});