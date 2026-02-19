---
name: firecrawl-cli
description: "Scrape, crawl, search, and extract structured data from any website using Firecrawl's cloud browser. Use this skill when browser_navigate fails due to bot protection, when you need clean markdown/JSON without DOM interaction, or when running an AI extraction agent. Commands: firecrawl_scrape, firecrawl_search, firecrawl_browser, firecrawl_crawl, firecrawl_agent."
license: MIT
compatibility: Requires firecrawl-cli installed globally (npm install -g firecrawl-cli) and FIRECRAWL_API_KEY set, or a self-hosted instance via FIRECRAWL_API_URL.
metadata:
  author: firecrawl
  version: "1.0"
  source: https://github.com/firecrawl/cli
orcbot:
  requiredPackages:
    - firecrawl-cli
  permissions:
    - network
  triggerPatterns:
    - "firecrawl"
    - "scrape.*bot.protect"
    - "extract.*structured.*web"
    - "cloud.*browser"
    - "firecrawl browser"
---

# Firecrawl CLI Skill

## Overview

Firecrawl provides a cloud browser and AI extraction layer on top of any website. Unlike OrcBot's local Playwright browser, Firecrawl runs browser sessions on remote infrastructure, handles bot-protection (Cloudflare, reCAPTCHA, etc.), and can return pre-formatted markdown or structured JSON without you parsing HTML.

## Browser Decision Guide

Always choose the right browser for the job:

| Situation | Use |
|-----------|-----|
| Simple page, just need to read content | `browser_navigate` (Playwright, free, fast) |
| Need to click buttons, fill forms, interact | `browser_navigate` + `browser_click` + `browser_type` |
| Page is bot-protected, Cloudflare, requires JS | `firecrawl_scrape` |
| Need clean markdown without any DOM work | `firecrawl_scrape` |
| Need bulk content from many pages | `firecrawl_crawl` |
| Need structured JSON from web data | `firecrawl_agent` |
| Need to drive a session step by step in cloud | `firecrawl_browser` |

**Do NOT replace working `browser_navigate` calls with firecrawl_scrape just because firecrawl is installed.** Use firecrawl when local Playwright fails or when the task specifically benefits from cloud execution.

## Setup

```bash
# Install the CLI globally
npm install -g firecrawl-cli

# Authenticate (choose one)
firecrawl login                          # interactive browser login
firecrawl login --api-key fc-YOUR-KEY    # direct API key

# Verify
firecrawl --status
```

For a self-hosted Firecrawl instance (no API key needed):
```bash
export FIRECRAWL_API_URL=http://localhost:3002
```

## Skills Available

After this skill is activated OrcBot has access to these callable tools:

### `firecrawl_scrape(url, format?, options?)`

Extract content from a URL via cloud browser. Default format is `markdown`.

```
# Get clean markdown
firecrawl_scrape("https://example.com")

# Get all links from a page
firecrawl_scrape("https://example.com", "links")

# Extract main content only, skip navs and footers
firecrawl_scrape("https://example.com", "markdown", {only_main_content: true})

# Wait 3s for JS to render, then scrape
firecrawl_scrape("https://spa.example.com", "markdown", {wait_for: 3000})
```

### `firecrawl_search(query, limit?, sources?, scrape?, tbs?)`

Web search with optional result scraping.

```
# Basic search
firecrawl_search("React Server Components tutorial")

# Recent news, scrape content
firecrawl_search("AI funding news", 10, "news", true, "qdr:w")

# Find GitHub repos
firecrawl_search("web scraping python", 20, "web", false)
```

### `firecrawl_browser(command, session_id?)`

Control a cloud browser session using natural-language `agent-browser` commands.

**Important**: This is a CLOUD browser managed by Firecrawl infrastructure. It is completely separate from OrcBot's local Playwright browser. Sessions persist by ID until closed or TTL expires.

```
# Step 1 — Launch a session (do this once per task)
run_command("firecrawl browser launch --stream")
# → Returns a session ID like "abc123..."

# Step 2 — Execute commands  
firecrawl_browser("open https://uspto.gov")
firecrawl_browser("snapshot")                  # get page state
firecrawl_browser("click @e5")                 # click by agentbrowser ref
firecrawl_browser("fill @e3 patent number here")
firecrawl_browser("scrape")                    # extract current page content

# Step 3 — Target session explicitly (if multiple sessions exist)
firecrawl_browser("open https://example.com", "abc123")
```

### `firecrawl_crawl(url, limit?, max_depth?, wait?, output?)`

Crawl an entire website. Returns a job ID immediately unless `wait=true`.

```
# Start a crawl
firecrawl_crawl("https://docs.example.com", 200, 3)

# Wait for completion and save results
firecrawl_crawl("https://docs.example.com", 100, 2, true, "docs.json")
```

### `firecrawl_agent(prompt, urls?, schema?, wait?)`

AI-powered structured extraction. The agent autonomously browses to fulfill the prompt.

```
# Research task
firecrawl_agent("Find the top 5 competitors of Notion with their pricing plans")

# Structured JSON extraction
firecrawl_agent("Extract all product names, prices, and SKUs", 
  "https://shop.example.com",
  {type: "object", properties: {products: {type: "array"}}})
```

## Error Recovery

If a `firecrawl_*` skill returns an error:

1. **Not installed** → run `install_npm_dependency("firecrawl-cli")` then authenticate
2. **Auth error** → run `run_command("firecrawl login")` and complete the flow
3. **Rate limited / credits** → check `run_command("firecrawl credit-usage")`
4. **Session expired** → sessions auto-expire; launch a new one with `run_command("firecrawl browser launch")`
5. **Self-hosted** → set `FIRECRAWL_API_URL` env var, auth is auto-skipped

## Installing the OrcBot Plugin

The `firecrawl.ts` plugin registers these skills as native OrcBot tool calls. Install it:

```
# From within OrcBot agent session:
install_skill("firecrawl/cli")

# Or manually copy src/skills/firecrawl.ts to ~/.orcbot/plugins/
```

## References

- [Firecrawl CLI docs](https://docs.firecrawl.dev/cli)
- [Firecrawl API reference](https://docs.firecrawl.dev/)
- [OrcBot plugin guide](https://github.com/fredabila/orcbot)
