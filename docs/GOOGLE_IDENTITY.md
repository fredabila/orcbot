# Google Identity Service

OrcBot includes a Google identity service for authenticated browser workflows that need mailbox access, verification emails, magic links, or one-time passcodes from Gmail.

This service is intentionally narrow in scope:

- It manages a single Google OAuth connection for the local OrcBot instance.
- It is designed for browser auth support and email-assisted login flows.
- It currently uses Gmail read-only access and basic Google profile lookup.

## What It Does

The Google identity service provides four operator-facing capabilities:

- Generate a Google OAuth consent URL.
- Exchange an authorization code for a refresh token.
- Search Gmail for recent authentication-related messages.
- Extract the latest numeric OTP code from recent matching mail.

In runtime terms, this is implemented by the Google identity manager in [src/core/GoogleIdentityManager.ts](../src/core/GoogleIdentityManager.ts) and exposed through built-in skills registered by the agent.

## Built-In Skills

- `google_identity_status()`
  Returns whether OrcBot is configured and connected.

- `google_identity_connect(client_id?, client_secret?, code_or_redirect_url?, email?)`
  Stores credentials and either returns an authorization URL or completes the OAuth exchange.

- `google_inbox_search(query, maxResults?)`
  Searches the connected Gmail mailbox.

- `google_latest_otp(from_contains?, subject_contains?)`
  Scans recent Gmail messages and extracts the newest numeric OTP match.

## Required Google Cloud Setup

Create a Google Cloud project and configure OAuth before using this feature.

1. Open Google Cloud Console.
2. Create or select a project for OrcBot.
3. Enable the Gmail API.
4. Configure the OAuth consent screen.
5. Create an OAuth client ID.
6. Add an authorized redirect URI that matches OrcBot's configured redirect URI.

Default redirect URI used by OrcBot:

```text
http://localhost
```

If you use a different redirect URI in Google Cloud, set the same value in OrcBot.

## Required Configuration

OrcBot supports three configuration paths for Google identity credentials.

### Option 1: TUI Setup

Use the interactive setup flow:

```text
orcbot ui
```

Then open:

```text
Tooling -> Google Identity (OAuth + Gmail OTP)
```

From there you can:

- Set OAuth client credentials
- Generate the consent URL
- Exchange an auth code or redirect URL
- Test Gmail search
- Test OTP extraction
- Disconnect the identity

### Option 2: Environment Variables

```bash
export GOOGLE_OAUTH_CLIENT_ID="your-client-id"
export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"
export GOOGLE_OAUTH_REDIRECT_URI="http://localhost"
```

On Windows PowerShell:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID="your-client-id"
$env:GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"
$env:GOOGLE_OAUTH_REDIRECT_URI="http://localhost"
```

### Option 3: YAML Config

Add these keys to your OrcBot config:

```yaml
googleOAuthClientId: your-client-id
googleOAuthClientSecret: your-client-secret
googleOAuthRedirectUri: http://localhost
```

## OAuth Flow

The operational flow is:

1. Configure `googleOAuthClientId` and `googleOAuthClientSecret`.
2. Request a consent URL through the TUI or `google_identity_connect(...)` without a code.
3. Open the URL and approve access in Google.
4. Copy the returned authorization code or full redirect URL.
5. Call `google_identity_connect(...)` again with the code or redirect URL.
6. OrcBot exchanges the code, stores the refresh token, fetches the Google profile, and marks the identity as connected.

## Storage and Security Model

Google identity state is stored under the OrcBot data directory as:

```text
~/.orcbot/google-identity.json
```

Stored state can include:

- Email address
- Refresh token
- Granted scope
- Token type
- Last update timestamp

Important security notes:

- If `ORCBOT_SECRET_KEY` or `orcbotSecretKey` is configured, the refresh token is encrypted before persistence.
- `googleOAuthClientId` is treated as an approval-required config.
- `googleOAuthClientSecret` is treated as a locked config.
- Gmail access is read-only by design.
- Use a dedicated automation mailbox where possible instead of a personal inbox.

Recommended practice:

- Create a separate Google account for OrcBot automation.
- Restrict who can access the local OrcBot data directory.
- Rotate the OAuth client secret if it is ever exposed.
- Review the Gmail inbox contents available to the configured account.

## Example Skill Usage

Get current status:

```javascript
google_identity_status()
```

Get a consent URL after setting credentials:

```javascript
google_identity_connect({
  client_id: "your-client-id",
  client_secret: "your-client-secret"
})
```

Complete the exchange with the returned redirect URL:

```javascript
google_identity_connect({
  code_or_redirect_url: "http://localhost/?code=..."
})
```

Search Gmail for verification mail:

```javascript
google_inbox_search({
  query: "newer_than:3d subject:(verification OR login OR code)",
  maxResults: 5
})
```

Extract the latest OTP:

```javascript
google_latest_otp({
  from_contains: "accounts.google.com",
  subject_contains: "verification"
})
```

## Typical Use Cases

- Fetching OTP codes during browser-driven login flows.
- Locating magic links sent by SaaS products.
- Checking whether an expected verification message arrived.
- Supporting a headful browser worker that needs mailbox-assisted authentication.

## Troubleshooting

### No authorization URL can be generated

Likely cause:

- `googleOAuthClientId` is missing.

Fix:

- Set client ID and client secret first.

### Token exchange fails

Likely causes:

- Redirect URI mismatch between Google Cloud and OrcBot.
- Expired or malformed authorization code.
- Consent was completed without offline access.

Fix:

- Verify the redirect URI exactly matches.
- Re-run consent and provide a fresh code.
- Ensure the OAuth request includes offline access and consent.

### No refresh token returned

Likely cause:

- Google reused an existing consent grant and did not issue a fresh refresh token.

Fix:

- Re-consent with prompt-for-consent behavior and revoke the previous app grant if necessary.

### Inbox search or OTP lookup fails

Likely causes:

- Identity is not connected.
- Gmail API is not enabled.
- The mailbox does not contain matching messages.

Fix:

- Confirm `google_identity_status()` shows `connected: true`.
- Confirm the Gmail API is enabled in Google Cloud.
- Broaden the Gmail query or sender/subject filters.

## Limitations

- One OrcBot instance currently manages one Google identity state file.
- Gmail access is currently read-only.
- OTP extraction currently matches numeric codes with 4 to 8 digits.
- This is not a full account-session manager for browser cookies or OAuth across arbitrary providers.

## Related Files

- [src/core/GoogleIdentityManager.ts](../src/core/GoogleIdentityManager.ts)
- [src/core/Agent.ts](../src/core/Agent.ts)
- [src/cli/index.ts](../src/cli/index.ts)
- [src/types/AgentConfig.ts](../src/types/AgentConfig.ts)
- [src/config/ConfigManager.ts](../src/config/ConfigManager.ts)
- [src/config/ConfigPolicy.ts](../src/config/ConfigPolicy.ts)
- [tests/googleIdentityManager.test.ts](../tests/googleIdentityManager.test.ts)