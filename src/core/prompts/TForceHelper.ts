/**
 * TForceHelper — Tactical Force Multiplier.
 * Always-active guardian that monitors agent health, stagnation, and error loops.
 * Injects tactical recovery plans and conscience-level guidance.
 */

import { PromptHelper, PromptHelperContext } from "./PromptHelper";

export class TForceHelper implements PromptHelper {
  readonly name = "tforce";
  readonly description =
    "Tactical health monitoring, stagnation guard, and error recovery";
  readonly priority = 5; // High priority, near core
  readonly alwaysActive = true;

  shouldActivate(): boolean {
    return true;
  }

  getPrompt(ctx: PromptHelperContext): string {
    const snapshot = ctx.metadata?.tforce;
    if (!snapshot) return "";

    const riskColor =
      snapshot.riskLevel === "critical"
        ? "🔴 CRITICAL"
        : snapshot.riskLevel === "high"
          ? "🟠 HIGH"
          : snapshot.riskLevel === "medium"
            ? "🟡 MEDIUM"
            : "🟢 LOW";

    const highlights =
      snapshot.memoryHighlights && snapshot.memoryHighlights.length > 0
        ? `
RECENT INCIDENTS:
${snapshot.memoryHighlights.map((h: string) => `- ${h}`).join("")}`
        : "";

    const recovery =
      snapshot.recoveryPlan && snapshot.recoveryPlan.length > 0
        ? `
RECOVERY PLAN:
${snapshot.recoveryPlan.map((p: string) => `- ${p}`).join("")}`
        : "";

    return `
🛡️ TFORCE TACTICAL MONITOR:
- Status: ${riskColor} Risk | Complexity: ${snapshot.complexityScore}/100
- Conscience Guidance: ${snapshot.conscienceGuidance}
${highlights}
${recovery}

RULES FOR TFORCE ADHERENCE:
1. **Prioritize Recovery**: If a RECOVERY PLAN is present, you MUST address its points in your next tool call.
2. **Break the Loop**: If TForce warns of a loop or repetitive actions, you MUST pivot to a different tool or verify your environment.
3. **Transparency over Hope**: If risk is HIGH and you are unsure, do NOT guess. Report the blocker clearly to the user.
4. **Action is Truth**: If guidance warns of stagnation (no tools), your priority is to execute a tool that provides objective data.
`;
  }
}
