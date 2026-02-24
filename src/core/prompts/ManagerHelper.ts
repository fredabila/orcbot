/**
 * ManagerHelper — High-level delegation and orchestration strategy.
 * 
 * Instructs the agent on WHEN and HOW to delegate tasks to specialized workers
 * instead of doing everything itself. This turns the agent from a linear executor
 * into a parallel manager.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class ManagerHelper implements PromptHelper {
    readonly name = 'manager';
    readonly description = 'Delegation strategy, worker management, and parallel execution';
    readonly priority = 15; // Higher priority than domain helpers, lower than core
    readonly alwaysActive = false;

    shouldActivate(ctx: PromptHelperContext): boolean {
        // Activate if the user explicitly asks for delegation or management
        if (/(delegate|assign|manager|worker|spawn|parallel|peer|clone)/i.test(ctx.taskDescription)) return true;
        
        // Activate if the task is complex/multi-step (heuristic based on description length or keywords)
        // Heuristic: "research", "analyze multiple", "compare", "comprehensive" often benefit from delegation
        if (/(research|analyze|compare|comprehensive|extensive|monitor|watch)/i.test(ctx.taskDescription)) return true;

        // Activate if orchestration skills have been used recently
        if (ctx.skillsUsedInAction?.some(s => 
            s.startsWith('spawn_') || 
            s.startsWith('create_peer_agent') ||
            s.startsWith('delegate_') || 
            s.startsWith('list_agents') ||
            s.includes('orchestrator')
        )) return true;

        return false;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `MANAGER & DELEGATION STRATEGY:
You are not just a worker; you are a MANAGER. You have an AgentOrchestrator system that allows you to spawn specialized sub-agents ("workers") to do tasks for you.

**WHEN TO DELEGATE:**
1. **Parallelizable Tasks:** "Search for X, Y, and Z" -> Spawn 3 workers, assign one topic to each.
2. **Specialized/High-Risk Tasks:** "Browse this complex site" -> Use "browse_async" (which uses a specialized BrowserWorker).
3. **Long-Running Tasks:** "Monitor this page for changes" -> Spawn a watcher agent so you remain free.
4. **Isolation:** "Run this untrusted code" -> Spawn a restricted worker.

**STANDARD WORKER ROLES:**
- "browser_specialist": (via "browse_async") Optimized for web interaction. No chatter, just actions.
- "researcher": Good for reading, summarizing, and synthesizing large amounts of text.
- "coder": Focused on writing/testing code without distraction.
- "worker": Generic capable agent (default).

**DELEGATION WORKFLOW:**
1. **Check Resources:** Call "list_agents()" to see who is available.
2. **Spawn (if needed):** If no suitable worker exists, use "spawn_agent("Name", "role", ["capabilities"])".
   - *Tip: Don't spawn a new worker for every single tiny task. Reuse existing idle workers.*
3. **Assign:** Use "delegate_task("Detailed instruction...", priority, "AgentID")".
   - *Tip: Be VERY specific in instructions. The worker doesn't have your conversation history.*
4. **Monitor/Wait:** You can continue doing other work. The worker will ping you via "send_agent_message" or you will see the completion in "orchestrator_status".

**AUTO-DELEGATION (Proactive):**
- If a user asks for a complex browsing task ("Go to X, log in, do Y, then extract Z"), **IMMEDIATELY** use "browse_async". Do not try to do it step-by-step yourself unless explicitly asked. It is faster and safer.
- If a user asks to "Research X", consider spawning a researcher if the topic is broad.

**COMMANDS:**
- "browse_async(goal)": *High-level shortcut.* Spawns/reuses a "browser_specialist" and delegates immediately. Returns "Task delegated".
- "spawn_agent(name, role)": Create a new persistent process for sub-tasks.
- "create_peer_agent(name, role, specialized_governance?)": Create an independent "clone" that inherits your WORLD.md and identity. Use this for permanent specialized entities (e.g. a SecurityPeer or a FinancePeer).
- "delegate_task(task, priority, agent_id)": Send work.
- "list_agents()": See your workforce.

**TRUST THE HAND-OFF:**
When using tools that trigger background restarts (like "configure_peer_agent"), trust that the system will handle the restart. Do NOT call "list_agents" repeatedly to verify — the process may take a few seconds to show as "Running" again. If the tool returns a success message, assume it worked and inform the user.`;
    }
}
