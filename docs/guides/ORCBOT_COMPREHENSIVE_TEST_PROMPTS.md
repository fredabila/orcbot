 # OrcBot Comprehensive Test Prompts

A structured prompt bank covering every major OrcBot capability. Use these in any connected channel (Telegram, Discord, WhatsApp, Gateway) and verify outcomes against the expected behaviour notes.

---

## How to use this pack

- Run prompts in section order for a full-system regression, or jump to a specific section.
- For each prompt verify:
  - Correct tool(s) called (check logs / TUI)
  - Response delivered to the right channel
  - No duplicate messages or tool-call loops
  - Clean completion signal (no premature cutoff)
  - Appropriate fallback on failure
- Capture pass/fail in the Notes Template (Section 27).

---

## 0) Warm-up and baseline

### Prompt 0.1
"Before we start, list what you can do in this environment in 5 bullets. Include any limits or missing integrations."

**Expected**: concise bullet list; capabilities match what is configured; no hallucinated features.

### Prompt 0.2
"Give me a 3-sentence summary of how you plan tasks, choose tools, and decide when you are done."

**Expected**: mentions simulation/planning phase, tool loop, termination review.

### Prompt 0.3
"I want concise answers by default unless I ask for deep detail. Confirm you saved that."

**Expected**: one-sentence confirmation; `update_user_profile` called in the background.

---

## 1) Onboarding and personalization

### Prompt 1.1
"prefs: detail=deep, updates=normal, tone=casual, initiative=balanced
soul: challenge weak assumptions, be direct, avoid fluff
user: I run product and engineering, I want tradeoffs and clear next actions"

**Expected**: preferences saved via `update_user_profile`; acknowledgement with brief summary of what was stored.

### Prompt 1.2
"What preferences did you save from my last onboarding message?"

**Expected**: recalls detail level, tone, and role context accurately.

### Prompt 1.3
"Switch me to detail=short and updates=minimal."

**Expected**: profile updated; confirmation; no re-asking.

### Prompt 1.4
"Now respond in exactly one concise paragraph: why are caching bugs hard in distributed systems?"

**Expected**: one paragraph only, technical, no preamble or postamble.

---

## 2) Thread continuity and memory

### Prompt 2.1
"My preferred deployment strategy is blue-green and I never release on Fridays. Remember that."

**Expected**: `update_user_profile` called; stored entry confirmed.

### Prompt 2.2
"What did I just tell you about deployment strategy and release timing?"

**Expected**: accurately recalls blue-green + no Friday releases from memory, not just context window.

### Prompt 2.3
"Summarize the last 3 things I asked you in this chat."

**Expected**: uses `recall_memory` or thread context; correctly lists preceding prompts.

### Prompt 2.4
"Based on what you know about my preferences, give me a release recommendation for next Friday."

**Expected**: recommends against Friday (applies stored preference); references blue-green.

---

## 3) Clarification handling and resume

### Prompt 3.1
"Draft a production rollout plan for my API migration."

**Expected**: if underspecified, sends a clarifying question via `request_supporting_data` that actually arrives in the active channel. Does NOT loop asking the same question.

### Prompt 3.2 (follow-up if bot asks)
"Node.js API, 40k daily users, multi-region, zero downtime."

**Expected**: resumes and produces the plan without re-asking already-answered questions.

### Prompt 3.3
"Continue from there. Do not ask me the same question again unless absolutely required."

**Expected**: no repeat clarification; plan progresses cleanly.

### Prompt 3.4
"Condense that plan into a one-page executive summary."

**Expected**: tight structured summary; respects detail=short preference if active.

---

## 4) Communication quality and anti-silence

### Prompt 4.1
"Investigate this: checkout failures in eu-west for enterprise tier, timeouts against payment provider, started 35 minutes ago."

**Expected**: uses `web_search` or `deep_reason`; sends at least one progress update; does NOT silently stall.

### Prompt 4.2
"While you work, send me progress updates but avoid spam."

**Expected**: 1–2 intermediate updates then a final conclusion. No wall of status messages.

### Prompt 4.3
"Finish with one concrete output: root-cause hypothesis, confidence %, and next 3 actions."

**Expected**: structured 3-part answer; no filler text.

### Prompt 4.4
"Give me the same answer for customers in non-technical language. Max 80 words."

**Expected**: plain-language version under 80 words; no jargon.

---

## 5) File operations and artifact delivery

### Prompt 5.1
"Create a markdown incident brief named `incident-eu-west.md` with these sections: Summary, Impact, Timeline, Root Cause Hypothesis, Mitigation, Owners."

**Expected**: `write_file` creates the file in workspace; path returned; all 6 sections present.

### Prompt 5.2
"Send me that file with a 5-line cover message."

**Expected**: `send_file` delivers to the correct channel; cover message appears; file arrives as attachment.

### Prompt 5.3
"Update the file by appending a Follow-ups section with 5 action items."

**Expected**: `write_file` with append or read-modify-write; Follow-ups section added; existing content intact.

### Prompt 5.4
"Read back the Follow-ups section only."

**Expected**: `read_file` with `start_line`/`end_line` to target that section; only Follow-ups shown.

### Prompt 5.5
"Re-send the updated file. Send it exactly once."

**Expected**: single `send_file` call; no duplicate sends; file delivered before completion signal.

---

## 6) Read file pagination

### Prompt 6.1
"Create a file `big-log.txt` with 300 lines of dummy log text."

**Expected**: `write_file` creates it; no size-guard error (content under 10 MB).

### Prompt 6.2
"Read lines 50 to 100 of `big-log.txt`."

**Expected**: `read_file` called with `start_line=50, end_line=100`; returns exactly that range with a header note.

### Prompt 6.3
"Read the last 20 lines of `big-log.txt`."

**Expected**: agent calculates correct line count; correct slice returned; no full-file dump.

---

## 7) Command execution, safety and system inspection

### Prompt 7.1
"Run a safe environment inspection and report Node, npm, and OS details."

**Expected**: `get_system_info()` or `run_command` for `node -v` / `npm -v`; platform info returned; no destructive commands executed.

### Prompt 7.2
"On Windows, list the 5 most recently modified files in my home directory using PowerShell."

**Expected**: `run_command` uses correct PowerShell syntax (`Get-ChildItem ~ | Sort-Object LastWriteTime -Descending | Select-Object -First 5`); output returned within 8 KB cap.

### Prompt 7.3
"Simulate a long-running command (e.g. `Start-Sleep -Seconds 30`) and show that it times out cleanly."

**Expected**: timeout fires at configured limit; returns `Error: Command timed out after X seconds`; no hung terminal; process tree killed on Windows.

### Prompt 7.4
"Tell me which commands would be risky to run in this environment and why. Do not run them."

**Expected**: `rm -rf`, `format`, `del /S`, etc. listed with explanation; no execution.

### Prompt 7.5
"Create a diagnostics report file `diagnostics.md` from the environment inspection outputs and send it."

**Expected**: `write_file` creates the report; `send_file` delivers it; single send.

---

## 8) File download

### Prompt 8.1
"Download https://raw.githubusercontent.com/sindresorhus/awesome/main/readme.md and tell me the file size."

**Expected**: `download_file` succeeds in under 60 s; size reported in KB; saved to downloads dir with correct filename.

### Prompt 8.2
"Download https://speed.hetzner.de/1MB.bin and confirm the file lands with a `.bin` extension."

**Expected**: extension inferred from URL or Content-Type; download succeeds; under 50 MB cap.

### Prompt 8.3
"Try to download a non-existent URL like https://example.com/does-not-exist-orcbot-test and report what happens."

**Expected**: `download_file` returns `HTTP error! status: 404` or similar; no crash; clean error message.

---

## 9) Browser and web research

### Prompt 9.1
"Research current best practices for preventing duplicate chatbot messages in multi-channel systems. Produce at least 5 findings and cite sources."

**Expected**: `web_search` + optional `browser_navigate`; `lastNavigatedUrl` not clobbered by background searches; ≥5 findings with URLs.

### Prompt 9.2
"If the first search returns sparse results, switch query strategy and continue."

**Expected**: second query uses different wording; total result quality improves; no stuck loop.

### Prompt 9.3
"Extract the main article body from https://nodejs.org/en/blog/release/v22 and give a 3-sentence summary."

**Expected**: `extract_article` reuses shared browser (no new Playwright spawn); Readability parse succeeds; summary ≤ 3 sentences.

### Prompt 9.4
"Fetch https://api.github.com/repos/fredabila/orcbot using HTTP (no browser) and tell me the star count and open issues."

**Expected**: `http_fetch` used (not browser); JSON parsed; `stargazers_count` and `open_issues_count` returned.

### Prompt 9.5
"Turn the research findings into a ranked implementation plan for OrcBot specifically."

**Expected**: plan references OrcBot components (channels, skills, guardrails); no generic filler.

---

## 10) Scheduling and temporal reasoning

### Prompt 10.1
"Schedule a follow-up to check unresolved incident risks in 2 hours."

**Expected**: `schedule_task("in 2 hours", ...)` returns an ID and shows the scheduled-for time.

### Prompt 10.2
"Schedule a recurring daily status summary every weekday at 9 AM."

**Expected**: `heartbeat_schedule("0 9 * * 1-5", ...)` or equivalent; ID returned.

### Prompt 10.3
"List all scheduled one-off tasks and all heartbeat schedules."

**Expected**: `schedule_list` and `heartbeat_list` both called; both IDs visible in output.

### Prompt 10.4
"Cancel the daily summary heartbeat and confirm the ID is gone from the list."

**Expected**: `heartbeat_remove(id)` called; re-running `heartbeat_list` no longer shows it.

---

## 11) Voice note delivery

### Prompt 11.1
"Convert the sentence 'OrcBot is now monitoring your systems' to speech using the nova voice and tell me where the file landed."

**Expected**: `text_to_speech` produces a `.ogg` in downloads dir; path returned.

### Prompt 11.2
"Send that audio as a voice note to my current chat."

**Expected**: `send_voice_note` called with `jid` from action context; WhatsApp = playable voice bubble, Telegram = voice message, Discord = audio file attachment.

### Prompt 11.3 (Discord channel only)
"Send a voice note to this Discord channel."

**Expected**: Discord has no voice-note API so `discord.sendFile` is used as fallback; response confirms it was sent as an audio file.

---

## 12) Image generation and delivery

### Prompt 12.1
"Generate an image of a futuristic server room with blue lighting and send it to this chat."

**Expected**: `send_image` used (not a `generate_image` + `send_file` loop); image arrives as attachment; single send.

### Prompt 12.2
"Generate an image but do not send it yet — just give me the file path."

**Expected**: `generate_image` called; path returned; SYSTEM note in skill output prevents re-generation loop.

### Prompt 12.3
"Now send that file via the correct channel."

**Expected**: `send_file` with channel auto-detected from action source; correct channel used.

---

## 13) RAG knowledge store

### Prompt 13.1
"Ingest this text into the knowledge store under collection 'ops': 'Our on-call rotation is weekly. Primary responder has a 15-minute SLA. Escalation goes to the engineering lead after 30 minutes.'"

**Expected**: `rag_ingest` called; `chunksCreated` ≥ 1; collection = ops.

### Prompt 13.2
"Ingest the OrcBot README from https://raw.githubusercontent.com/fredabila/orcbot/main/README.md into collection 'docs'."

**Expected**: `rag_ingest_url` fetches URL; HTML/Markdown extracted; chunks stored; count reported.

### Prompt 13.3
"Search the knowledge store for 'on-call SLA' and tell me what you find."

**Expected**: `rag_search` returns ops collection entry with correct SLA times.

### Prompt 13.4
"List all documents currently in the RAG store."

**Expected**: `rag_list` returns metadata for both ingested documents with collection labels and chunk counts.

### Prompt 13.5
"Delete the 'ops' collection and confirm it is gone."

**Expected**: `rag_delete(collection='ops')`; re-running `rag_list` shows only 'docs'.

---

## 14) Memory and semantic recall

### Prompt 14.1
"Store this: production database host is db-prod-us-east-1.example.com and replica is db-replica-use1.example.com."

**Expected**: stored via `update_user_profile` or memory write; confirmed.

### Prompt 14.2
"What is the production database host I mentioned?"

**Expected**: `recall_memory("production database host")` or thread context returns correct hostname without hallucination.

### Prompt 14.3
"Search your memory for anything related to deployment preferences."

**Expected**: returns blue-green + no Friday releases from earlier in the session.

---

## 15) Telegram rich UX (Telegram channel only)

### Prompt 15.1
"Send me a message with two inline buttons: 'Approve' and 'Reject'."

**Expected**: `telegram_send_buttons` called; message appears in Telegram with clickable buttons.

### Prompt 15.2
"Send a poll: 'Should we deploy this Friday?' with options Yes, No, Delay."

**Expected**: `telegram_send_poll` called; native Telegram poll appears.

### Prompt 15.3
"React to your last message with a thumbs up."

**Expected**: `telegram_react` called; native reaction appears OR a 👍 reply sent (graceful fallback); no unhandled error.

### Prompt 15.4
"Edit your last message to add '(Updated)' at the end."

**Expected**: `telegram_edit_message` called with original message ID; text updated in place.

### Prompt 15.5
"Pin that message in this chat."

**Expected**: `telegram_pin_message` called; message pinned; confirmation returned.

---

## 16) Multi-channel delivery correctness

### Prompt 16.1
"Send a test message to this channel."

**Expected**: message sent to the channel this prompt was received from, not hardcoded to Telegram.

### Prompt 16.2 (connected to both Telegram and Discord)
"Send the incident brief to Telegram and a shorter summary to Discord."

**Expected**: separate sends via correct channel skills; content differentiated per channel.

### Prompt 16.3
"Send me the file. If I am on Discord, send it as an attachment. If on Telegram, send it as a document."

**Expected**: correct channel and method used; no wrong-channel delivery.

---

## 17) Multi-audience communication

### Prompt 17.1
"For the EU checkout incident, generate 3 outputs: C-level executive summary, customer-safe status update, and engineering handoff checklist."

**Expected**: 3 clearly separated outputs with distinct tone in a single response.

### Prompt 17.2
"Tone-adjust: exec=formal/brief, customer=calm/reassuring, engineering=direct/technical."

**Expected**: re-generates all 3 with correct tonal shifts.

### Prompt 17.3
"Compress all 3 into one message under 180 words."

**Expected**: combined output ≤ 180 words; all 3 audiences addressed.

---

## 18) Guardrails and anti-loop resilience

### Prompt 18.1
"Work on this complex research task but avoid duplicate status messages and any repeated identical tool calls."

**Expected**: no back-to-back identical tool calls; signature-loop guard fires if triggered; visible in logs.

### Prompt 18.2
"If you hit a blank page while navigating, detect it and switch to search-based fallback automatically."

**Expected**: blank-page counter increments; agent pivots to `web_search` without user intervention.

### Prompt 18.3
"Demonstrate you can conclude cleanly without extra sends or repeated observations."

**Expected**: single final message; no duplicate sends; clean completion in logs.

---

## 19) Admin permissions and policy boundaries

### Prompt 19.1
"Attempt a plugin install and tell me whether this session is authorized."

**Expected**: proceeds if sudo/admin configured; otherwise returns a policy-gate error with the reason and required config change.

### Prompt 19.2
"Summarize exactly which classes of actions are restricted in this session."

**Expected**: lists safe-mode blocks, allow/deny list status, and admin-only skills accurately.

---

## 20) Autonomous capability expansion

### Prompt 20.1
"I need a Notion integration but it is not installed. Detect the capability gap and propose a safe install path."

**Expected**: checks installed tools/skills; proposes `install_skill` or `create_custom_skill` workflow with specific steps.

### Prompt 20.2
"Proceed with the capability bootstrap: plan, install, verify, activate, show validation output."

**Expected**: `install_skill(source)` → `activate_tool` → test call; each step confirmed.

### Prompt 20.3
"If install is blocked by safe mode, show the exact config change needed and the fallback workflow."

**Expected**: shows `safeMode: false` requirement; proposes markdown-artifact fallback.

---

## 21) Self-repair and plugin healing

### Prompt 21.1
"Call `self_repair_skill` on a failing plugin. Show the error, the repair approach, and the result."

**Expected**: `self_repair_skill(skillName, errorMessage)` called; patched code written to plugin file; plugin reloaded; confirmation returned.

### Prompt 21.2
"After repair, call the plugin once to verify it works."

**Expected**: successful tool invocation; no residual error.

---

## 22) Incident command center full simulation

### Prompt 22.1
"You are incident commander. Triage checkout failures in EU enterprise tier, coordinate owners, produce a customer update, and schedule a recheck."

**Expected**: multi-step execution; at least one progress update sent; all deliverables in final message.

### Prompt 22.2
"Additional context:
- Timeout errors with payment provider
- Success rate dropped 97.8 → 81.2%
- Support spike in Germany and France"

**Expected**: root-cause hypothesis formed with confidence %; geographic context used.

### Prompt 22.3
"Required deliverables:
1) Incident brief artifact: `incident-full.md`
2) Executive 3-line update
3) Customer-safe status (80 words max)
4) Engineering action checklist (5 bullets)
5) Follow-up scheduled in 2 hours"

**Expected**: all 5 delivered; file created and sent; task scheduled; sent via correct channel.

### Prompt 22.4
"Close the loop: completed items, open items, owners, and ETA confidence."

**Expected**: structured post-mortem summary; nothing omitted; ETA stated.

---

## 23) Quality self-evaluation

### Prompt 23.1
"Score your last response on: correctness, completeness, clarity, actionability, and risk communication (1–10 each). Justify each score briefly."

**Expected**: honest evaluation; not all 10/10; justifications reference specific observable things.

### Prompt 23.2
"List your top 3 assumptions in the last task and how to validate each quickly."

**Expected**: concrete assumptions; actionable validation methods.

### Prompt 23.3
"What is one thing you would improve if you ran that task again from scratch?"

**Expected**: specific, not generic. References a real observed gap.

---

## 24) Channel-specific formatting

### Prompt 24.1
"Send the incident update formatted for Telegram: short sections, bold headers, emoji bullets."

**Expected**: Telegram-optimized formatting; renders cleanly in Telegram.

### Prompt 24.2
"Send the same update formatted for Discord: concise headers, code blocks for technical data."

**Expected**: Discord-appropriate formatting; code blocks used correctly.

### Prompt 24.3
"Send the same update as a plain SMS-style message: no markdown, no emojis, under 160 characters."

**Expected**: stripped output ≤ 160 chars; no markdown syntax visible.

---

## 25) Regression smoke pack (daily — run in sequence)

Run these 10 prompts in sequence for a quick daily health check:

1. "Remember: I prefer deep technical detail and never deploy on Fridays."
2. "What did I just tell you about deployment timing?"
3. "Run `node -v` and `npm -v` and report the versions."
4. "Create and send an incident markdown file `smoke-test.md` with a Summary and Timeline section."
5. "Read lines 1–5 of `smoke-test.md`."
6. "Download https://raw.githubusercontent.com/sindresorhus/awesome/main/readme.md and report the file size."
7. "Schedule a follow-up task in 10 minutes."
8. "Give exec + customer + engineering versions of a mock status update."
9. "If any tool call fails, switch to local fallback and continue."
10. "Close with: completed items, open items, and which channel delivered the response."

---

## 26) Scoring rubric

Score each section 0–5:

| Score | Meaning |
|-------|---------|
| 0 | Failed completely |
| 1 | Major issues, largely wrong behaviour |
| 2 | Partial — core output present but key issues |
| 3 | Usable — minor gaps, no blocking problems |
| 4 | Good — all expected behaviours met |
| 5 | Excellent — meets expectations plus graceful edge handling |

Dimensions to score per section:
- Task completion
- Correct tool(s) selected
- Communication quality (no silence, no spam)
- Loop/duplication suppression
- Channel routing correctness
- Fallback / recovery behaviour
- Personalization fidelity

---

## 27) Notes template

Copy per test run:

```
Date:
Channel:
Model / provider:
Config profile (safeMode, sudoMode, etc.):
Integrations available (Telegram / Discord / WhatsApp / Gateway):
OrcBot version:

Section results (score 0–5):
  0. Warm-up:
  1. Onboarding:
  2. Memory:
  3. Clarification:
  4. Anti-silence:
  5. File ops:
  6. Pagination:
  7. Command execution:
  8. Download:
  9. Browser/web:
  10. Scheduling:
  11. Voice/audio:
  12. Image generation:
  13. RAG:
  14. Semantic recall:
  15. Telegram UX:
  16. Multi-channel delivery:
  17. Multi-audience:
  18. Guardrails:
  19. Admin/policy:
  20. Capability expansion:
  21. Self-repair:
  22. Incident simulation:
  23. Self-evaluation:
  24. Formatting:
  25. Smoke pack:

What worked well:
What failed or was wrong:
Loop / silence incidents:
Wrong-channel delivery:
Best wow moment:
Highest-priority fix:
```

---

## 28) One-shot mega prompt

Use this for a single comprehensive integration challenge:

```
Act as my autonomous incident operations copilot.

Scenario: Enterprise checkout failures in EU with payment provider timeouts and a 16.6-point success-rate drop over the last 35 minutes.

Requirements:
1) Triage and root-cause hypothesis with confidence %
2) Progress updates while working (max 2 before final answer)
3) Incident brief artifact: incident-mega.md (Summary, Impact, Timeline, Hypothesis, Mitigation, Owners, Follow-ups)
4) Send me the file via this channel
5) Exec summary (3 lines), customer-safe update (80 words max), engineering checklist (5 bullets)
6) Schedule a follow-up recheck in 2 hours
7) If any integration is unavailable, use local markdown fallback without stopping
8) Avoid duplicate messages and repeated tool calls
9) End with: completed items, open items, owners, ETA confidence

Apply my stored preferences for tone and detail level.
```

**Expected**: 8–15 decision steps; all 9 requirements addressed; file delivered; task scheduled; single final summary message; no loops.


---

## 29) Advanced Email Operations

### Prompt 29.1
"Search my inbox for emails from 'Stripe' received in the last 3 days about 'disputes'."

**Expected**: `search_emails` called with `sender="Stripe", daysAgo=3, subject="dispute"`; results summarized or "No emails found" returned.

### Prompt 29.2
"Find the most recent unread email from my boss (boss@example.com) and give me a 2-sentence summary of what it requires."

**Expected**: `search_emails` with `unreadOnly=true, sender="boss@example.com"`; returns summary; no loop.

### Prompt 29.3
"Check for any new emails. If you find an invoice, classify if it needs a reply or just archiving."

**Expected**: `search_emails` called; AI classifier (`classifyEmailNeed`) logic triggered in `EmailChannel`; summary explains why it does or does not need a reply.

### Prompt 29.4
"Send an email to support@github.com regarding my ticket #1234. Attach the `smoke-test.md` file from our workspace."

**Expected**: `send_email` called; file attached correctly; SMTP delivery successful.

---

## 30) Computer Use & Vision-Guided UI

### Prompt 30.1
"Open the browser and go to a site without a clear DOM (e.g., a canvas-heavy dashboard). Use vision to describe the layout."

**Expected**: `browser_navigate` → `browser_vision` or `computer_describe(context="browser")`; description includes spatial positions of visual elements.

### Prompt 30.2
"Find the 'Login' button on this screen visually and click it."

**Expected**: `computer_vision_click(description="Login button")` or `computer_locate` followed by `computer_click`.

### Prompt 30.3
"Type 'admin' into the username field using vision-guided targeting, then press Enter."

**Expected**: `computer_type(text="admin", field="username field")` → `computer_key("Enter")`.

### Prompt 30.4
"Demonstrate a screen drag: move the slider at (200, 300) to (400, 300) in the browser."

**Expected**: `computer_drag(fromX=200, fromY=300, toX=400, toY=300, context="browser")`.

---

## 31) Multi-Agent Orchestration

### Prompt 31.1
"Spawn a worker agent named 'researcher' specialized in market analysis."

**Expected**: `spawn_agent(name="researcher", role="worker")`; confirmation with Agent ID.

### Prompt 31.2
"Delegate a task to the 'researcher' agent: 'Summarize the top 3 competitors in the AI agent space'."

**Expected**: `delegate_task` called with correct Agent ID and description.

### Prompt 31.3
"Show me the current status of all spawned agents and their aggregate token usage."
**Expected**: `list_agents` and `get_worker_token_usage` called; accurate status and token counts shown.

### Prompt 31.4
"Broadcast a message to all agents: 'Priority shift: focus on security analysis for the next 4 hours'."

**Expected**: `broadcast_to_agents` message delivered to all active workers.

### Prompt 31.5
"Clone yourself as 'OrcBot-Clone' to help with parallel file processing."

**Expected**: `clone_self` called; new agent ID generated.

---

## 32) Dynamic Self-Tuning & Performance

### Prompt 32.1
"Show me which browser settings can be tuned for specific domains."

**Expected**: `get_tuning_options` returns JSON schema of tunable parameters (timeouts, headful mode, etc.).

### Prompt 32.2
"A site is blocking our headless browser. Tune our settings for 'protected-site.com' to use headful mode and slow typing."

**Expected**: `tune_browser_domain` or `mark_headful` called for the domain.

### Prompt 32.3
"Our current workflow is timing out on large tasks. Increase `maxStepsPerAction` to 50 and `skillTimeoutMs` to 60000."

**Expected**: `tune_workflow` updates settings; confirmation returned.

### Prompt 32.4
"Show me a history of all tuning changes made in this session."

**Expected**: `get_tuning_history` or `get_tuning_state` shows the audit log of adjustments.

---

## 33) Multi-Media & Social

### Prompt 33.1
"Post a status update to WhatsApp: 'OrcBot is now fully operational with event-driven email support! 🚀'"

**Expected**: `whatsapp_post_status` called; success confirmation.

### Prompt 33.2
"Read my most recent WhatsApp status and tell me who has viewed it."

**Expected**: `whatsapp_get_context` or similar; status details returned.

### Prompt 33.3
"Generate an AI voice note reading the incident brief and send it to this chat."

**Expected**: `text_to_speech` → `send_voice_note`.

---

## 34) System Repair & Autonomy

### Prompt 34.1
"Assume the `search_emails` skill is failing with a 'socket timeout'. Use your self-repair capability to diagnose and propose a fix."

**Expected**: `self_repair_skill` called; analysis of failure; patch proposed or applied to `EmailChannel.ts`.

### Prompt 34.2
"If you get stuck in a loop during a task, explain how your internal loop detection would trigger a self-improvement task."

**Expected**: references `triggerSkillCreationForFailure` logic; describes the analysis → `create_custom_skill` workflow.

### Prompt 34.3
"Run a full system check and verify all channel connections (Telegram, Discord, Email)."

**Expected**: `system_check` or `get_system_info`; status of each channel reported.

---

## 35) Dynamic Code Execution (execute_typescript)

### Prompt 35.1
"Use your execute_typescript skill to write a simple script that returns the sum of 10 and 20."

**Expected**: `execute_typescript` called; the code exports a default async function returning `30`; no formal plugin created.

### Prompt 35.2
"Write a typescript script using execute_typescript that reads the contents of the current directory using the 'fs' module and returns the count of files."

**Expected**: `execute_typescript` called; uses `require('fs')` or `import`; returns a valid integer count.

### Prompt 35.3
"Write a typescript script that uses your internal Agent context to log a message 'Hello from scratchpad' to the system logger, and then return true."

**Expected**: `execute_typescript` called; script uses `context.logger.info(...)`; returns `true`.

### Prompt 35.4
"Write a typescript script that intentionally throws an error, like 'Test error'. Then read the error output."

**Expected**: `execute_typescript` called; execution fails; agent correctly observes the stack trace/error message without crashing the main process.

---

## 36) Remote Agent Management (Peer Agents)

### Prompt 36.1
"List all registered agents and their current status."

**Expected**: `list_agents` called; returns a formatted list showing the primary agent and any peers.

### Prompt 36.2
"Create a new peer agent named 'dev-ops-bot' with a specialized governance rule: 'Always prioritize system stability over speed'."

**Expected**: `create_peer_agent` called; confirmation of creation and inheritance of the WORLD.md governance rules.

### Prompt 36.3
"Stop the 'dev-ops-bot' agent, then start it again."

**Expected**: `terminate_agent` (if stopping) or `restart_agent` called; followed by `start_agent`; status verified.

---

## 37) Notes Template (v2.1)

Copy per test run:

```
Date:
Channel:
Model / provider:
Config profile:
OrcBot version:

Section results (score 0–5):
  0-28. [Existing results]
  29. Advanced Email:
  30. Computer Use/Vision:
  31. Orchestration:
  32. Self-Tuning:
  33. Multi-Media/Social:
  34. System Repair:
  35. Dynamic TS Execution:
  36. Remote Agent Management:

Critical Failures:
Loop Occurrences:
Performance Wins:
```
