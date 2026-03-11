# Google Workspace CLI Integration

OrcBot can use the Google Workspace CLI (`gws`) as a broad Google Workspace backend instead of hard-coding each Google API integration one by one.

This is the recommended path when you want the agent to work across Google Docs, Drive, Sheets, Calendar, Gmail, and other Workspace services through a single authenticated CLI.

## Why This Exists

The built-in Google identity service in OrcBot is intentionally narrow. It currently focuses on:

- Google OAuth connection state
- Gmail search for auth workflows
- OTP extraction from Gmail

The Google Workspace CLI integration is for broader operations such as:

- Creating and updating Google Docs
- Listing and managing Drive files
- Working with Sheets, Calendar, Gmail, and other Workspace APIs
- Expanding Workspace support without writing custom OrcBot API clients for every service

## Prerequisites

Install the Google Workspace CLI:

```bash
npm install -g @googleworkspace/cli
```

Then authenticate it:

```bash
gws auth setup
gws auth login
```

If you already have a configured Google Cloud project and OAuth client, you can also use the manual setup flow documented by the `gws` project.

## OrcBot Configuration

Optional config keys:

```yaml
googleWorkspaceCliPath: gws
googleWorkspaceCliAccount: your-account@example.com
```

Environment variable equivalents:

```bash
export GOOGLE_WORKSPACE_CLI_PATH="gws"
export GOOGLE_WORKSPACE_CLI_ACCOUNT="your-account@example.com"
```

On Windows PowerShell:

```powershell
$env:GOOGLE_WORKSPACE_CLI_PATH="gws"
$env:GOOGLE_WORKSPACE_CLI_ACCOUNT="your-account@example.com"
```

## Built-In OrcBot Skills

- `google_workspace_status()`
  Checks whether `gws` is installed and whether auth context appears available.

- `google_workspace_command(args:array, json?, account?)`
  Runs a structured `gws` command without using a shell.

- `google_docs_create(title, content?, account?)`
  Creates a Google Doc and optionally appends initial text.

- `google_docs_write(document_id, text, account?)`
  Appends plain text to a Google Doc.

- `google_drive_list(query?, pageSize?, account?)`
  Lists Drive files with optional filtering.

- `google_sheets_create(title, account?)`
  Creates a new Google Sheets spreadsheet.

- `google_sheets_read(spreadsheet_id, range, account?)`
  Reads values from a range such as `Sheet1!A1:D20`.

- `google_sheets_append(spreadsheet_id, values|json_values, account?, dryRun?)`
  Appends one row or multiple rows to a spreadsheet.

- `google_calendar_create_event(summary, start, end, calendar?, location?, description?, attendees?, account?, dryRun?)`
  Creates a calendar event using the `gws calendar +insert` helper.

- `google_gmail_triage(max?, query?, labels?, account?)`
  Returns an unread inbox summary through the `gws gmail +triage` helper.

- `google_gmail_send(to, subject, body, cc?, bcc?, account?, dryRun?)`
  Sends a plain-text Gmail message.

- `google_gmail_reply(message_id, body, to?, cc?, bcc?, from?, account?, dryRun?)`
  Replies to a Gmail message while preserving threading headers.

- `google_gmail_reply_all(message_id, body, to?, cc?, bcc?, remove?, from?, account?, dryRun?)`
  Reply-all variant with optional recipient removal.

## Examples

Check whether `gws` is ready:

```javascript
google_workspace_status()
```

Create a Google Doc:

```javascript
google_docs_create({
  title: "Meeting Notes",
  content: "Kickoff notes for the new project"
})
```

Append text to an existing doc:

```javascript
google_docs_write({
  document_id: "YOUR_DOCUMENT_ID",
  text: "\nAction items:\n- Finalize scope\n- Assign owners"
})
```

List Drive files:

```javascript
google_drive_list({
  query: "name contains 'Report'",
  pageSize: 10
})
```

Create a spreadsheet:

```javascript
google_sheets_create({
  title: "Ops Tracker"
})
```

Read sheet values:

```javascript
google_sheets_read({
  spreadsheet_id: "YOUR_SHEET_ID",
  range: "Sheet1!A1:D10"
})
```

Append sheet rows:

```javascript
google_sheets_append({
  spreadsheet_id: "YOUR_SHEET_ID",
  json_values: [["Alice", "Ready"], ["Bob", "Blocked"]]
})
```

Create a calendar event:

```javascript
google_calendar_create_event({
  summary: "Weekly Review",
  start: "2026-06-17T09:00:00-07:00",
  end: "2026-06-17T09:30:00-07:00",
  attendees: ["alice@example.com", "bob@example.com"]
})
```

Triage unread Gmail:

```javascript
google_gmail_triage({
  max: 10,
  query: "is:unread newer_than:7d"
})
```

Send a Gmail message:

```javascript
google_gmail_send({
  to: ["team@example.com"],
  subject: "Deployment update",
  body: "Prod rollout completed successfully.",
  dryRun: true
})
```

Reply to a Gmail thread:

```javascript
google_gmail_reply({
  message_id: "18f1a2b3c4d",
  body: "Thanks, I have it."
})
```

Run a raw `gws` command through OrcBot:

```javascript
google_workspace_command({
  args: ["sheets", "spreadsheets", "create", "--json", "{\"properties\":{\"title\":\"Budget\"}}"],
  json: true
})
```

## Security Model

- OrcBot executes `gws` without a shell. Arguments are passed as structured tokens.
- These skills are elevated because they can read and write user Workspace data.
- Scope grants are managed by `gws`, not by OrcBot directly.
- Avoid granting broad scopes unless you actually need them.

## Recommended Usage Model

Use the two Google layers for different jobs:

- Google identity service: OAuth state, Gmail auth mail, OTP workflows
- Google Workspace CLI: broad Workspace actions such as Docs, Drive, Sheets, Calendar, and Gmail operations

That split keeps OrcBot maintainable while still giving the agent a much wider Google capability surface.