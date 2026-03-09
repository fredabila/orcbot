import { describe, expect, it } from 'vitest';
import { parseBrowserPerformActions } from '../src/core/BrowserPerformParser';

describe('parseBrowserPerformActions', () => {
    it('parses a direct JSON array response', () => {
        const actions = parseBrowserPerformActions('[{"tool":"click","ref":"12"},{"tool":"press","key":"Enter"}]');

        expect(actions).toEqual([
            { tool: 'click', ref: '12' },
            { tool: 'press', key: 'Enter' }
        ]);
    });

    it('parses a fenced json block with surrounding prose', () => {
        const response = [
            'Plan:',
            '',
            '```json',
            '[{"tool":"type","ref":"5","text":"hello"}]',
            '```'
        ].join('\n');
        const actions = parseBrowserPerformActions(response);

        expect(actions).toEqual([
            { tool: 'type', ref: '5', text: 'hello' }
        ]);
    });

    it('ignores bracket markers like ref tokens and parses the real json array later', () => {
        const response = 'Click [ref=3] and then use this plan: [{"tool":"click","ref":"3"},{"tool":"wait","ms":500}]';
        const actions = parseBrowserPerformActions(response);

        expect(actions).toEqual([
            { tool: 'click', ref: '3' },
            { tool: 'wait', ms: 500 }
        ]);
    });

    it('accepts an object wrapper with an actions array', () => {
        const response = '{"actions":[{"tool":"scroll","dir":"down"},{"tool":"hover","ref":"21"}]}';
        const actions = parseBrowserPerformActions(response);

        expect(actions).toEqual([
            { tool: 'scroll', dir: 'down' },
            { tool: 'hover', ref: '21' }
        ]);
    });

    it('throws when no valid action plan exists', () => {
        expect(() => parseBrowserPerformActions('click [ref=3] and submit the form')).toThrow(
            'No valid JSON action plan found in model response'
        );
    });
});