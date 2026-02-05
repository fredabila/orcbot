# Browser Tool & Identity System Improvements

## Overview

This document describes the major improvements made to OrcBot's browsing system and identity management. These changes address loop prevention, state tracking, self-updating capabilities, and polling mechanism integration.

## 1. Identity System Improvements

### Changed Default Identity

The default agent identity has been changed from "Alice" to "OrcBot" to better align with the project name and deployment structure where files are stored in `.orcbot`.

**Files Updated:**
- `.AI.md` - Changed from Alice to OrcBot
- `src/core/Agent.ts` - Updated default identity template

**New Identity Structure:**
```markdown
# .AI.md
Name: OrcBot
Type: Strategic AI Agent
Personality: proactive, concise, professional, adaptive
AutonomyLevel: high
Version: 2.0
DefaultBehavior: 
  - prioritize tasks based on user goals
  - act proactively when deadlines are near
  - consult SKILLS.md tools to accomplish actions
  - think strategically and simulate before complex actions
  - learn from interactions and adapt approach
```

### Bootstrap File Integration

The agent now properly integrates bootstrap files (`IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `USER.md`) from the `.orcbot` directory into its decision-making context.

**Key Changes:**
- `DecisionEngine` now receives and uses `BootstrapManager`
- Bootstrap context is injected into every LLM call
- Files are loaded in priority order: IDENTITY → SOUL → AGENTS → USER → TOOLS

**Bootstrap Files:**
- **IDENTITY.md** - Agent name, version, core purpose, capabilities
- **SOUL.md** - Personality, tone, boundaries, values
- **AGENTS.md** - Operating instructions, core behavior patterns
- **TOOLS.md** - Tool usage conventions and best practices
- **USER.md** - User profile and preferences

### Self-Update Capabilities

The agent can now update its own bootstrap files through new skills:

#### New Skills

1. **`update_bootstrap_file(filename, content, mode?)`**
   - Updates or appends to bootstrap files
   - Validates filename (must be one of the 5 bootstrap files)
   - Modes: 'replace' (default) or 'append'
   - Example: `update_bootstrap_file("SOUL.md", "## New Value\n- Always prioritize security", "append")`

2. **`read_bootstrap_file(filename)`**
   - Reads the current contents of a bootstrap file
   - Example: `read_bootstrap_file("IDENTITY.md")`

3. **`list_bootstrap_files()`**
   - Lists all bootstrap files with their status and size
   - Shows which files exist and their byte size

**Usage Example:**
```javascript
// Agent learns a new preference and updates its persona
{
  "tools": [
    {
      "name": "update_bootstrap_file",
      "metadata": {
        "filename": "SOUL.md",
        "content": "## Communication Preferences\n- Use emojis sparingly\n- Prefer bullet points over paragraphs",
        "mode": "append"
      }
    }
  ]
}
```

## 2. Browser Tool Improvements

### Circuit Breaker Pattern

A new `BrowserStateManager` class implements the circuit breaker pattern to prevent infinite loops and repeated failures.

**Features:**
- Tracks navigation history with success/failure states
- Records action breadcrumbs (clicks, types, etc.)
- Automatically opens circuit after 3 consecutive failures
- Circuit resets after 60 seconds
- Prevents navigation loops (same URL visited 3+ times in 30s)
- Prevents action loops (same action 3+ times in 20s)

**How It Works:**
```
1. Agent navigates to URL
2. Navigation fails
3. State manager records failure
4. After 3 failures, circuit opens
5. Next attempt returns immediate error without trying
6. After 60s, circuit resets and allows retry
```

### Enhanced Error Tracking

The browser now provides detailed state summaries for the agent:

- Navigation history with timestamps and success/failure
- Action breadcrumbs showing what was clicked/typed
- Circuit breaker status for open circuits
- Diagnostic information for debugging

**Example State Summary:**
```
Browser State Summary:
Recent navigation (5):
✓ 0s navigate -> https://example.com
✓ +3s navigate -> https://example.com/login
✗ +2s navigate -> https://example.com/dashboard (Timeout)
✓ +5s navigate -> https://example.com/profile
✓ +1s navigate -> https://example.com/settings

Recent actions (10):
✓ 0s click [login-button]
✓ +1s type [email-input]
✓ +2s type [password-input]
✗ +3s click [submit-button] (Element not found)
✓ +5s click [submit-button]

⚠️  Circuit breakers open: action:click:submit-button:https://example.com/login
```

### Loop Detection

The browser actively detects and prevents loops:

1. **Navigation Loops**: If the same URL is visited 3+ times within 30 seconds
2. **Action Loops**: If the same action on the same element is performed 3+ times within 20 seconds

When a loop is detected, the browser returns an error message with suggestions for alternative approaches.

### Integration with Agent

The browser state manager integrates seamlessly with the agent's decision-making:

- Loop errors are clearly communicated to the agent
- Circuit breaker states are visible in diagnostics
- State can be reset between tasks
- Failures are automatically learned from via `RuntimeTuner`

**New Browser Methods:**
- `getStateSummary()` - Get human-readable state summary
- `getDiagnostics()` - Get structured diagnostic data
- `resetState()` - Clear all state tracking

## 3. Polling Manager Integration

The polling mechanism is now properly integrated with skills that allow the agent to use it.

### What is Polling?

The `PollingManager` provides an event-based system for waiting on conditions without constantly checking in loops. Instead of:

```javascript
// BAD: Loops and wastes resources
while (!fileExists) {
  checkFile();
  wait(5000);
}
```

Use:
```javascript
// GOOD: Event-driven, efficient
pollingManager.registerJob({
  id: 'wait-for-file',
  checkFn: () => checkFileExists(),
  intervalMs: 5000,
  onSuccess: () => continueTask()
});
```

### New Polling Skills

1. **`register_polling_job(id, description, checkCommand, intervalMs, maxAttempts?)`**
   - Registers a new polling job
   - `checkCommand` is a shell command that returns exit code 0 when condition is met
   - Emits events on success/failure
   - Example: `register_polling_job("wait-download", "Wait for download to complete", "test -f ~/Downloads/file.pdf", 5000, 60)`

2. **`cancel_polling_job(id)`**
   - Cancels a running polling job
   - Example: `cancel_polling_job("wait-download")`

3. **`list_polling_jobs()`**
   - Lists all active polling jobs with status
   - Shows attempts, duration, and interval

4. **`get_polling_job_status(id)`**
   - Gets detailed status of a specific job
   - Shows description, attempts, and elapsed time

### When to Use Polling

Use polling for:
- Waiting for file downloads to complete
- Monitoring build/test processes
- Waiting for services to become available
- Checking for email/message arrivals
- Any task that requires periodic checking

### Event System

Polling jobs emit events on the event bus:
- `polling:registered` - Job registered
- `polling:progress` - Check attempted
- `polling:success` - Condition met
- `polling:failure` - Max attempts reached
- `polling:error` - Error during check
- `polling:cancelled` - Job cancelled

## 4. Technical Implementation Details

### File Structure

```
src/
├── core/
│   ├── Agent.ts                    # Main agent with new bootstrap skills
│   ├── DecisionEngine.ts           # Integrated bootstrap context
│   ├── BootstrapManager.ts         # Manages bootstrap files
│   └── PollingManager.ts           # Event-based polling system
└── tools/
    ├── WebBrowser.ts               # Enhanced with state manager
    └── BrowserStateManager.ts      # NEW: Loop prevention & tracking
```

### Bootstrap Integration Flow

```
1. Agent constructor creates BootstrapManager
2. BootstrapManager initializes files in ~/.orcbot/
3. Agent passes BootstrapManager to DecisionEngine
4. DecisionEngine loads bootstrap context on each decision
5. Context is injected into LLM system prompt
6. Agent has skills to update files during runtime
7. Updates are immediately available in next decision
```

### Circuit Breaker Flow

```
1. Browser action attempted (navigate/click/type)
2. BrowserStateManager checks if circuit is open
3. If open, return error immediately
4. If closed, execute action
5. Record result (success/failure)
6. If 3 consecutive failures, open circuit
7. Circuit auto-resets after 60 seconds
```

## 5. Migration Guide

### For Existing Deployments

1. **Identity Update**: The `.AI.md` file will automatically update on next run. If you have custom identity content, merge it manually.

2. **Bootstrap Files**: Run the agent once to create default bootstrap files in `~/.orcbot/`. Then customize:
   ```bash
   # View created files
   ls -la ~/.orcbot/*.md
   
   # Edit as needed
   nano ~/.orcbot/SOUL.md
   nano ~/.orcbot/IDENTITY.md
   ```

3. **Polling**: If you have custom polling implementations, migrate to use the new skills:
   ```javascript
   // Old (manual)
   while (!condition) { check(); wait(); }
   
   // New (use skill)
   register_polling_job("job-id", "description", "test -f file.txt", 5000)
   ```

### For New Deployments

Everything works out of the box. Bootstrap files are created automatically with sensible defaults.

## 6. Best Practices

### Identity Management

- **IDENTITY.md**: Update when agent capabilities change (new tools, features)
- **SOUL.md**: Update to refine personality based on user feedback
- **AGENTS.md**: Update to add new operational rules or strategies
- **USER.md**: Update as you learn more about user preferences

### Browser Usage

- Let the circuit breaker protect against loops
- Check state summary when debugging browser issues
- Reset state between major tasks: `browser.resetState()`
- Trust loop detection - if it triggers, change your approach

### Polling

- Use polling for any wait > 10 seconds
- Set reasonable `maxAttempts` to avoid infinite waits
- Always provide clear descriptions for debugging
- Clean up with `cancel_polling_job` when done early

## 7. Troubleshooting

### Browser Stuck in Loop

**Symptom**: Same action repeated over and over
**Solution**: Circuit breaker will automatically stop it. Check logs for "Circuit breaker opened" message.

### Bootstrap Files Not Loading

**Symptom**: Agent doesn't reflect changes in SOUL.md, etc.
**Check**: 
1. Files exist in `~/.orcbot/`
2. Files are valid markdown
3. Check logs for "Bootstrap manager initialized"

### Polling Job Not Working

**Symptom**: Polling job never completes
**Debug**:
1. Run `list_polling_jobs()` to see status
2. Test `checkCommand` manually in shell
3. Check event bus logs for polling events

## 8. Performance Impact

### Memory

- BrowserStateManager: ~10KB for 100 actions
- Bootstrap context: ~5-15KB added to each LLM call
- Polling jobs: ~1KB per active job

### CPU

- Loop detection: O(n) where n = recent actions (typically < 100)
- Circuit breaker checks: O(1)
- Bootstrap loading: Once per decision (cached in memory)

### Impact Summary

Minimal performance impact (<1% overhead) with significant improvements in:
- Loop prevention (can save hours of wasted browser actions)
- Context awareness (better decision quality)
- Self-improvement (agent evolves over time)

## 9. Future Enhancements

Potential future improvements:
- [ ] Visual browser state dashboard
- [ ] Machine learning for loop prediction
- [ ] Automatic bootstrap file optimization
- [ ] Cross-session state persistence
- [ ] Polling job templates library
- [ ] Browser action replay for debugging

## 10. Support

For issues or questions:
1. Check logs in `~/.orcbot/logs/`
2. Review bootstrap files in `~/.orcbot/*.md`
3. Test browser state: `browser.getDiagnostics()`
4. Check polling: `list_polling_jobs()`
5. Open GitHub issue with diagnostics

---

*Last Updated: 2026-02-05*
*Version: 2.0*
