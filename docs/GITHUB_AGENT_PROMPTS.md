# GitHub Agent Prompt Helper

This file gives you ready-to-paste prompts for testing OrcBot's GitHub skill surface.

Use these prompts when you want to verify that the agent can operate against GitHub repositories through the built-in `gh`-backed skills.

## Notes

- Replace `owner/repo` with the real target repository.
- For destructive actions like merge, label delete, variable delete, and release upload, use a test repo first.
- If the repo is public but your GitHub account does not have write access, creation/update actions will fail even if the skill is working correctly.
- PR creation is still best tested with `github_cli_command(...)` or after adding a dedicated PR create helper.

## Basic Status Checks

### Check GitHub CLI availability

```text
Check whether GitHub CLI is installed and authenticated. Tell me which account is active and whether you can operate on GitHub right now.
```

### Check repo access

```text
Use the GitHub skills to inspect owner/repo and confirm whether you can work against it from this environment.
```

## Branch Tests

### List branches

```text
List branches for owner/repo. Show me the default branch and up to 10 branch names.
```

### Filter branches

```text
List branches for owner/repo where the branch name contains release. Limit the result to 10.
```

## Issue Tests

### Create an issue

```text
Create an issue on owner/repo titled "GitHub skill smoke test" with a short body explaining that this was created by OrcBot as a GitHub CLI test. Then report the issue URL.
```

### Comment on an issue

```text
Post a comment on issue 123 in owner/repo saying: "Smoke test comment from OrcBot GitHub CLI integration." Then tell me whether it succeeded.
```

## Pull Request Tests

### List PRs

```text
List the 10 most recent open pull requests for owner/repo. Include PR number, title, head branch, base branch, and state.
```

### Check PR status checks

```text
Inspect pull request 123 in owner/repo and summarize its status checks.
```

### Comment on a PR

```text
Post a comment on pull request 123 in owner/repo saying: "Smoke test PR comment from OrcBot GitHub CLI integration." Then confirm whether it succeeded.
```

### Review a PR

```text
Submit a COMMENT review on pull request 123 in owner/repo with the body: "Smoke test review from OrcBot."
```

### Request changes on a PR

```text
Submit a REQUEST_CHANGES review on pull request 123 in owner/repo with the body: "Smoke test request-changes review from OrcBot."
```

### Approve a PR

```text
Submit an APPROVE review on pull request 123 in owner/repo with the body: "Smoke test approval from OrcBot."
```

### Merge a PR

```text
Merge pull request 123 in owner/repo using squash merge. Delete the branch after merge. Report exactly what happened.
```

## Release Tests

### List releases

```text
List the 10 most recent releases for owner/repo. Include tag, release name, draft/prerelease status, and timestamps.
```

### Create a release

```text
Create a GitHub release in owner/repo with tag v-test-gh-skill, title "GitHub Skill Test Release", and generated notes. Then report the result.
```

### Upload release assets

```text
Upload these files to release tag v-test-gh-skill in owner/repo: path/to/file1, path/to/file2. Overwrite existing assets if needed. Then tell me whether it worked.
```

## Workflow Tests

### List workflow runs

```text
List the 10 most recent workflow runs for owner/repo. Include workflow name, branch, status, conclusion, and run ID.
```

### Filter workflow runs

```text
List completed workflow runs for owner/repo for the workflow publish-package.yml on branch main. Limit to 10.
```

### Dispatch a workflow

```text
Dispatch the workflow publish-package.yml in owner/repo on ref main. Pass these fields as JSON if supported: {"dry_run": true}. Then tell me whether the dispatch succeeded.
```

### Rerun a workflow

```text
Rerun workflow run 123456789 in owner/repo. Only rerun failed jobs if possible.
```

## Label Tests

### List labels

```text
List up to 20 labels in owner/repo. Include name, color, and description.
```

### Create or update a label

```text
Create or update a label in owner/repo named smoke-test with color 1d76db and description "Created by OrcBot GitHub CLI smoke test".
```

### Delete a label

```text
Delete the label smoke-test from owner/repo.
```

## Variable Tests

### List variables

```text
List repository variables for owner/repo. Include name and visibility.
```

### Set a variable

```text
Set a repository variable named ORCBOT_SMOKE_TEST to enabled in owner/repo. Use repo visibility defaults unless a visibility option is required.
```

### Delete a variable

```text
Delete the repository variable ORCBOT_SMOKE_TEST from owner/repo.
```

## Raw `gh` Fallback Tests

Use these when you want to explicitly test the low-level `github_cli_command(...)` path.

### Raw release listing

```text
Use the raw GitHub CLI command skill to list the 5 most recent releases for owner/repo in JSON form.
```

### Raw PR creation

```text
Use the raw GitHub CLI command skill to create a pull request in owner/repo from branch my-branch into main, with title "Smoke test PR" and body "Created by OrcBot raw gh test". If local git state is missing, stop and tell me exactly what is missing.
```

### Raw workflow inspection

```text
Use the raw GitHub CLI command skill to inspect workflow runs for owner/repo and return the latest 5 entries.
```

## High-Signal End-To-End Prompts

### Non-destructive public repo check

```text
Test your GitHub integration against owner/repo without making destructive changes. List branches, list open PRs, list releases, and list recent workflow runs. Summarize whether each operation succeeded.
```

### Writable repo smoke test

```text
Run a writable GitHub smoke test against owner/repo. Create a label named smoke-test, create an issue titled "Smoke test issue", comment on that issue, list workflow runs, then delete the smoke-test label. Summarize each step and include any created URLs.
```

### PR operations smoke test

```text
Run a PR operations smoke test against owner/repo for PR 123. List its checks, add a comment, and submit a COMMENT review. Do not merge it. Summarize the results.
```

## Suggested Testing Order

1. Status check
2. Non-destructive reads: branches, PRs, releases, workflow runs
3. Non-destructive writes: comments, labels in a test repo
4. Heavier writes: issues, workflow dispatch, release asset upload
5. Destructive or sensitive actions: merge, variable delete, label delete
