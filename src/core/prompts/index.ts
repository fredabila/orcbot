/**
 * Prompt Helpers — Modular prompt system for OrcBot.
 * 
 * Each helper is a focused prompt module that injects task-specific instructions
 * into the agent's system prompt. The PromptRouter selects which helpers to
 * activate based on task analysis, so simple tasks get lean prompts and complex
 * tasks get laser-focused guidance.
 * 
 * Architecture:
 *   PromptHelper (interface) — contract for all helpers
 *   PromptRouter — analyzes tasks and composes helpers into optimized prompts
 *   CoreHelper — identity, date/time, system env (always on)
 *   ToolingHelper — CoVe, tool rules, error recovery (always on)
 *   CommunicationHelper — message economy, anti-loop, greetings
 *   BrowserHelper — semantic navigation, blank page fallback
 *   ResearchHelper — task persistence, follow-ups, promise enforcement
 *   SchedulingHelper — smart scheduling, cron, temporal blockers
 *   MediaHelper — voice/audio, images, TTS, file handling
 *   ProfileHelper — contact profiling, user context building
 *   DevelopmentHelper — software development, coding, project scaffolding
 */

export { PromptHelper, PromptHelperContext } from './PromptHelper';
export { PromptRouter, RouteResult, RouterLLM } from './PromptRouter';
export { CoreHelper } from './CoreHelper';
export { ToolingHelper } from './ToolingHelper';
export { CommunicationHelper } from './CommunicationHelper';
export { BrowserHelper } from './BrowserHelper';
export { ResearchHelper } from './ResearchHelper';
export { SchedulingHelper } from './SchedulingHelper';
export { MediaHelper } from './MediaHelper';
export { ProfileHelper } from './ProfileHelper';
export { DevelopmentHelper } from './DevelopmentHelper';
