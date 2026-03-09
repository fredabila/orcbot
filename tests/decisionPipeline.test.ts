import { describe, expect, it } from 'vitest';
import { DecisionPipeline } from '../src/core/DecisionPipeline';
import { StandardResponse } from '../src/core/ParserLayer';

// Lightweight config stub to avoid touching real disk-backed ConfigManager
class StubConfig {
  private values: Record<string, any>;
  constructor(values: Record<string, any>) {
    this.values = values;
  }
  get(key: string) {
    return this.values[key];
  }
}

describe('DecisionPipeline', () => {
  it('deduplicates messaging tools and enforces message budget', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 2,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [
        { name: 'send_telegram', metadata: { message: 'Hello there' } },
        { name: 'send_telegram', metadata: { message: 'Hello there' } },
        { name: 'send_whatsapp', metadata: { message: 'Second channel' } },
      ],
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a1',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 0,
      currentStep: 1,
    });

    // Should drop the duplicate telegram send and keep the whatsapp send (budget allows 1 more)
    expect(evaluated.tools?.length).toBe(2); // one duplicate dropped; two distinct sends remain
    const names = evaluated.tools?.map((t) => t.name) || [];
    expect(names).toContain('send_telegram');
    expect(names).toContain('send_whatsapp');

    // If we try to send again, budget should block further sends
    const evaluated2 = pipeline.evaluate(evaluated, {
      actionId: 'a1',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 2, // budget now reached (2 total)
      currentStep: 2,
    });
    const remainingSend = (evaluated2.tools || []).filter((t) => t.name.startsWith('send_'));
    expect(remainingSend.length).toBe(0);
  });

  it('terminates when step budget exceeded', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 2,
        maxStepsPerAction: 3,
        messageDedupWindow: 5,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [{ name: 'send_telegram', metadata: { message: 'Hi' } }],
      verification: { goals_met: false, analysis: 'Pending' },
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a2',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 0,
      currentStep: 4, // over budget
    });

    expect(evaluated.tools?.length).toBe(0);
    expect(evaluated.verification?.goals_met).toBe(true);
  });

  it('dedupes per channel/user key but allows same text on different channels', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 3,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
      }) as any,
    );

    const first: StandardResponse = {
      success: true,
      tools: [{ name: 'send_telegram', metadata: { chatId: 'u1', message: 'Same text' } }],
    };

    const evaluatedTelegram = pipeline.evaluate(first, {
      actionId: 'a3',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 0,
      currentStep: 1,
    });

    expect(evaluatedTelegram.tools?.length).toBe(1);
    expect(evaluatedTelegram.tools?.[0].name).toBe('send_telegram');

    // Second pass proposes Telegram duplicate + WhatsApp same text.
    // Telegram should be suppressed as duplicate; WhatsApp should be allowed (different channel key).
    const second: StandardResponse = {
      success: true,
      tools: [
        { name: 'send_telegram', metadata: { chatId: 'u1', message: 'Same text' } },
        { name: 'send_whatsapp', metadata: { jid: 'w1', message: 'Same text' } },
      ],
    };

    const evaluatedAgain = pipeline.evaluate(second, {
      actionId: 'a3',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 1, // First message was already sent in step 1
      currentStep: 2,
    });

    const names = evaluatedAgain.tools?.map((t) => t.name) || [];
    expect(names).toContain('send_whatsapp');
    expect(names).not.toContain('send_telegram');
  });

  it('allows send_file without explicit file request when enforcement is disabled', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 3,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
        enforceExplicitFileRequestForSendFile: false,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [
        { name: 'send_file', metadata: { jid: 'u1', path: '/tmp/result.txt' } },
        { name: 'send_telegram', metadata: { chatId: 'u1', message: 'Done.' } },
      ],
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a4',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 0,
      currentStep: 1,
      fileIntent: 'unknown',
      taskDescription: 'Generate summary and share results',
    });

    const names = evaluated.tools?.map((t) => t.name) || [];
    expect(names).toContain('send_file');
    expect(names).toContain('send_telegram');
  });

  it('suppresses send_file without explicit request when enforcement is enabled', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 3,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
        enforceExplicitFileRequestForSendFile: true,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [
        { name: 'send_file', metadata: { jid: 'u1', path: '/tmp/result.txt' } },
        { name: 'send_telegram', metadata: { chatId: 'u1', message: 'Done.' } },
      ],
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a5',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 0,
      currentStep: 1,
      fileIntent: 'unknown',
      taskDescription: 'Generate summary and share results',
    });

    const names = evaluated.tools?.map((t) => t.name) || [];
    expect(names).not.toContain('send_file');
    expect(names).toContain('send_telegram');
  });


  it('suppresses status-only reassurance when no non-send tool work exists', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 4,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [{ name: 'send_telegram', metadata: { chatId: 'u1', message: 'Working on it now.' } }],
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a6',
      source: 'telegram',
      sourceId: 'u1',
      messagesSent: 1,
      currentStep: 3,
      recentMemories: [],
    });

    expect(evaluated.tools?.length).toBe(0);
  });

  it('extends step budget from execution plan to reduce premature termination', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 4,
        maxStepsPerAction: 8,
        messageDedupWindow: 5,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [{ name: 'run_command', metadata: { command: 'echo ok' } }],
      verification: { goals_met: false, analysis: 'Still running' },
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a7',
      messagesSent: 0,
      currentStep: 11,
      executionPlan: `STEP BUDGET: 12 steps\n1. do work`,
    });

    expect(evaluated.tools?.length).toBe(1);
    expect(evaluated.verification?.goals_met).not.toBe(true);
  });

  it('adds recovery hints when all proposed non-send tools are suppressed', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 4,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
        maxToolLoops: 3,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [
        { name: 'web_search', metadata: { query: 'same query' } }
      ],
      verification: { goals_met: false, analysis: 'Need more research' },
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a8',
      messagesSent: 0,
      currentStep: 4,
      recentMemories: [
        { id: 'a8-step-1-web_search', type: 'short', content: 'Tool web_search returned', metadata: { tool: 'web_search', input: { query: 'same query' } } } as any,
        { id: 'a8-step-2-web_search', type: 'short', content: 'Tool web_search returned', metadata: { tool: 'web_search', input: { query: 'same query' } } } as any,
      ],
    });

    expect(evaluated.tools?.length).toBe(0);
    expect(evaluated.verification?.goals_met).toBe(false);
    expect(String(evaluated.metadata?.recoveryHint || '')).toContain('Do not repeat the same search query');
  });

  it('does not cut off multi-page browsing too early when inspection work exists', () => {
    const pipeline = new DecisionPipeline(
      new StubConfig({
        maxMessagesPerAction: 4,
        maxStepsPerAction: 10,
        messageDedupWindow: 5,
        maxToolLoops: 3,
      }) as any,
    );

    const proposed: StandardResponse = {
      success: true,
      tools: [{ name: 'browser_navigate', metadata: { url: 'https://example.org/next' } }],
      verification: { goals_met: false, analysis: 'Continue browsing' },
    };

    const evaluated = pipeline.evaluate(proposed, {
      actionId: 'a9',
      messagesSent: 0,
      currentStep: 5,
      recentMemories: [
        { id: 'a9-step-1-browser_navigate', type: 'short', content: 'Tool browser_navigate returned', metadata: { tool: 'browser_navigate', input: { url: 'https://example.org/1' } } } as any,
        { id: 'a9-step-2-browser_examine_page', type: 'short', content: 'Tool browser_examine_page returned', metadata: { tool: 'browser_examine_page' } } as any,
        { id: 'a9-step-3-browser_navigate', type: 'short', content: 'Tool browser_navigate returned', metadata: { tool: 'browser_navigate', input: { url: 'https://example.org/2' } } } as any,
        { id: 'a9-step-4-browser_navigate', type: 'short', content: 'Tool browser_navigate returned', metadata: { tool: 'browser_navigate', input: { url: 'https://example.org/3' } } } as any,
      ],
    });

    expect(evaluated.tools?.length).toBe(1);
    expect(evaluated.tools?.[0]?.name).toBe('browser_navigate');
  });

});
