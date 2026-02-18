# Founder Ops Autopilot — 10-Minute Wow Demo

## Demo Goal
Show OrcBot as an autonomous operations layer that detects a customer issue, investigates, coordinates response across channels/tools, and delivers an executive-ready brief.

---

## Why this demo works
- It is cross-system (chat + docs + tasks + voice update).
- It shows closed-loop behavior (not just chat).
- It demonstrates continuity, safety guardrails, and user-personalized style.

---

## Required setup (30–60 min before demo)

### 1) OrcBot runtime
- Start OrcBot with your preferred channel enabled (Telegram or Discord is easiest live).
- Ensure auto-reply is enabled for the selected channel.
- Keep `robustReasoningMode=true`.
- Keep `progressFeedbackEnabled=true`.

### 2) Integrations (agentic, not hardcoded)
Use plugin skills / tool wrappers (no core code edits) for:
- Notion (create/update incident page)
- ElevenLabs (generate spoken status update)
- Optional: GitHub, Slack, PagerDuty, PostHog/Sentry

If Notion/ElevenLabs are not ready, run the same flow with:
- `write_file` for incident docs and
- `send_file` for distribution.

### 3) Seed data
Prepare one realistic incident seed:
- Customer message text (high urgency)
- A fake log snippet
- A fake metric regression snippet
- A target owner list

---

## Demo storyline
"A production checkout issue is reported by a high-value customer at 08:12. OrcBot handles triage, coordination, and executive reporting in one thread."

---

## Live flow (10 minutes)

## Minute 0–1: Trigger
Send this in your channel to OrcBot:

```text
URGENT: Customer reports checkout is failing for enterprise accounts in EU. Please handle triage end-to-end, coordinate owners, and give me an executive update with ETA.
```

Expected wow:
- OrcBot acknowledges quickly.
- Starts visible progress updates.
- Creates/uses an execution plan.

## Minute 1–3: Investigation and signal merge
Send supporting snippets (or have OrcBot fetch via tools):

```text
Error sample: payment_provider_timeout for org_tier=enterprise region=eu-west
Metric: checkout_success_rate dropped from 97.8% -> 81.2% in last 35m
```

Expected wow:
- OrcBot correlates issue scope.
- Distinguishes likely root cause vs unknowns.
- Avoids silence while researching.

## Minute 3–5: Cross-system action
Prompt:

```text
Create an incident brief in Notion, assign owners, and prepare a customer-safe status summary.
```

Expected wow:
- Uses integration skills/tool wrappers (no hardcoded orchestration).
- Produces a structured incident artifact with owner/action list.
- Confirms completion with links/IDs.

## Minute 5–7: Leadership communication
Prompt:

```text
Now give me: (1) 3-line exec summary, (2) customer-facing update, (3) internal engineering action checklist.
```

Expected wow:
- Audience-specific communication from one source of truth.
- Detail level and tone match your onboarding preferences.

## Minute 7–9: Voice status packet
Prompt:

```text
Generate a 30-second spoken update via ElevenLabs and send it to me.
```

Expected wow:
- OrcBot composes concise spoken script.
- Calls ElevenLabs via integration skill.
- Delivers artifact (audio link/file) and transcript.

## Minute 9–10: Closure + continuity
Prompt:

```text
What remains open? Schedule follow-ups and remind me if no resolution by 2 hours.
```

Expected wow:
- OrcBot lists unresolved risks.
- Schedules follow-up tasks.
- Leaves a durable action trail (memory + artifacts).

---

## Operator script (copy/paste)
Use these messages in order:

1.
```text
URGENT: Customer reports checkout is failing for enterprise accounts in EU. Please handle triage end-to-end, coordinate owners, and give me an executive update with ETA.
```

2.
```text
Error sample: payment_provider_timeout for org_tier=enterprise region=eu-west
Metric: checkout_success_rate dropped from 97.8% -> 81.2% in last 35m
```

3.
```text
Create an incident brief in Notion, assign owners, and prepare a customer-safe status summary.
```

4.
```text
Now give me: (1) 3-line exec summary, (2) customer-facing update, (3) internal engineering action checklist.
```

5.
```text
Generate a 30-second spoken update via ElevenLabs and send it to me.
```

6.
```text
What remains open? Schedule follow-ups and remind me if no resolution by 2 hours.
```

---

## What to highlight while presenting
- "No hardcoded Notion/ElevenLabs workflow in core loop. Integrations are capability modules."
- "It can reason, act, and communicate with audience-specific outputs."
- "Guardrails prevent loops/duplicate sends and keep timing transparent."
- "Onboarding preferences shape tone, depth, and initiative."

---

## Fail-safe fallback (if an integration is unavailable)
If Notion or ElevenLabs fails during demo, say:

"Use local artifact fallback now. Create the incident brief as markdown and deliver the file."

Then prompt:

```text
Integration seems unavailable. Use local fallback: write the incident brief and deliver it as a file, then continue the workflow.
```

This still demonstrates autonomy and resilience.

---

## Success criteria
The demo is successful if OrcBot:
- Produces a coherent triage narrative from sparse inputs.
- Creates at least one concrete artifact (doc/audio/file).
- Delivers role-specific messaging (exec, customer, engineer).
- Schedules at least one follow-up action.
- Maintains clear progress visibility without getting stuck in loops.

---

## Optional "mind-blown" extension (2 extra min)
Ask:

```text
Turn this incident into a reusable runbook and add a pre-incident checklist for next time.
```

If delivered well, this shows OrcBot is not only reactive but continuously compounding operational intelligence.
