# Polling System Usage Guide

## Overview

The OrcBot polling system provides an event-driven mechanism for waiting on conditions without busy-waiting loops. This prevents the agent from getting stuck checking the same thing repeatedly and wasting resources.

## Why Use Polling?

### ❌ Without Polling (Bad)
```javascript
// Agent gets stuck in a loop checking repeatedly
while (!fileExists('/tmp/output.txt')) {
  // Wastes CPU and agent cycles
  wait(5000);
  checkAgain();
}
```

### ✅ With Polling (Good)
```javascript
// Agent registers job and moves on
register_polling_job(
  "wait-for-output",
  "Waiting for script to generate output.txt",
  "test -f /tmp/output.txt",
  5000,
  60
);
// Agent can do other work while polling runs in background
```

## How It Works

1. **Register a Job**: Create a polling job with a check condition
2. **Background Execution**: Job runs automatically at intervals
3. **Event Emission**: Success/failure events are emitted
4. **Memory Integration**: Results are saved to memory automatically
5. **Clean Exit**: Job stops when condition is met or max attempts reached

## Available Skills

### 1. register_polling_job

**Purpose**: Start monitoring a condition

**Parameters**:
- `id` (required): Unique identifier for the job
- `description` (required): Human-readable description
- `checkCommand` (required): Shell command that returns exit code 0 when condition is met
- `intervalMs` (required): How often to check in milliseconds
- `maxAttempts` (optional): Maximum number of checks before giving up

**Example**:
```javascript
{
  "name": "register_polling_job",
  "metadata": {
    "id": "wait-download",
    "description": "Wait for report.pdf to download",
    "checkCommand": "test -f ~/Downloads/report.pdf",
    "intervalMs": 5000,
    "maxAttempts": 60
  }
}
```

**Result**: `Polling job "wait-download" registered. Will check every 5000ms (max 60 attempts).`

### 2. list_polling_jobs

**Purpose**: See all active polling jobs

**Parameters**: None

**Example**:
```javascript
{
  "name": "list_polling_jobs",
  "metadata": {}
}
```

**Result**:
```
Active polling jobs (2):
- wait-download: Wait for report.pdf to download (12 attempts, 60s elapsed, interval: 5000ms)
- check-server: Wait for server to be ready (5 attempts, 25s elapsed, interval: 5000ms)
```

### 3. get_polling_job_status

**Purpose**: Check status of a specific job

**Parameters**:
- `id` (required): Job ID to check

**Example**:
```javascript
{
  "name": "get_polling_job_status",
  "metadata": {
    "id": "wait-download"
  }
}
```

**Result**:
```
Polling job "wait-download":
- Description: Wait for report.pdf to download
- Attempts: 12
- Duration: 60s
```

### 4. cancel_polling_job

**Purpose**: Stop a running polling job

**Parameters**:
- `id` (required): Job ID to cancel

**Example**:
```javascript
{
  "name": "cancel_polling_job",
  "metadata": {
    "id": "wait-download"
  }
}
```

**Result**: `Polling job "wait-download" cancelled successfully.`

## Common Use Cases

### 1. Waiting for File Download

```javascript
// Start download
browser_click("download-button");

// Register polling to wait for it
register_polling_job(
  "wait-file-download",
  "Waiting for contract.pdf to download",
  "test -f ~/Downloads/contract.pdf && test -s ~/Downloads/contract.pdf",
  3000,
  100
);
```

**Note**: The `test -s` checks file is not empty (download completed).

### 2. Waiting for Server Startup

```javascript
// Start server in background
run_command("npm run dev &");

// Poll until server responds
register_polling_job(
  "wait-server-ready",
  "Waiting for dev server on port 3000",
  "curl -s http://localhost:3000 > /dev/null 2>&1",
  2000,
  30
);
```

### 3. Monitoring Build Process

```javascript
// Start build
run_command("npm run build &");

// Wait for build output
register_polling_job(
  "wait-build-complete",
  "Waiting for build to generate dist folder",
  "test -d dist && test -f dist/index.html",
  5000,
  60
);
```

### 4. Waiting for Email/Message

```javascript
// After sending request that triggers email
register_polling_job(
  "wait-confirmation-email",
  "Checking for confirmation email",
  "grep -q 'Confirmation Code' ~/.orcbot/email-cache.txt",
  10000,
  30
);
```

### 5. Database Query Ready

```javascript
// Submit long-running query
run_command("psql -c 'SELECT * FROM big_table' > /tmp/results.txt &");

// Wait for results
register_polling_job(
  "wait-query-results",
  "Waiting for database query to complete",
  "test -f /tmp/results.txt && test $(wc -l < /tmp/results.txt) -gt 0",
  5000,
  120
);
```

## Check Command Tips

### File Exists
```bash
test -f /path/to/file
```

### File Not Empty
```bash
test -s /path/to/file
```

### Directory Exists
```bash
test -d /path/to/directory
```

### Port is Open
```bash
nc -z localhost 8080
```

### URL Responds
```bash
curl -sf http://example.com > /dev/null
```

### Process Running
```bash
pgrep -f "process-name"
```

### File Contains Text
```bash
grep -q "success" /path/to/log.txt
```

### Combine Multiple Conditions
```bash
test -f /tmp/output.txt && grep -q "done" /tmp/output.txt
```

## Best Practices

### 1. Choose Appropriate Intervals

- **Fast checks** (file operations): 1000-3000ms
- **Network checks** (HTTP, DB): 3000-5000ms
- **Slow operations** (builds, downloads): 5000-10000ms

### 2. Set Reasonable Max Attempts

Calculate: `maxAttempts = (max_expected_time_seconds * 1000) / intervalMs`

Example:
- Expected time: 5 minutes = 300 seconds
- Interval: 5000ms
- Max attempts: `(300 * 1000) / 5000 = 60`

### 3. Provide Clear Descriptions

Good: `"Waiting for invoice-2024.pdf to download from client portal"`
Bad: `"waiting"`

### 4. Clean Up When Done

If you finish a task early:
```javascript
cancel_polling_job("job-id");
```

### 5. Use Unique IDs

Include task context in ID:
```javascript
// Good
"wait-invoice-2024-download"

// Bad (too generic)
"wait-download"
```

## Events and Memory

### Automatic Memory Integration

When a polling job succeeds or fails, it automatically saves to memory:

**Success Event**:
```javascript
{
  id: "polling-success-1234567890",
  type: "short",
  content: "Polling job \"wait-download\" (Wait for report.pdf) completed successfully",
  metadata: { source: "polling", jobId: "wait-download" }
}
```

**Failure Event**:
```javascript
{
  id: "polling-failure-1234567890",
  type: "short",
  content: "Polling job \"wait-download\" (Wait for report.pdf) failed: Max attempts (60) reached",
  metadata: { source: "polling", jobId: "wait-download", reason: "Max attempts (60) reached" }
}
```

### Event Bus

You can also listen to polling events programmatically:

```javascript
eventBus.on('polling:success', (data) => {
  logger.info(`Job ${data.jobId} succeeded after ${data.attempts} attempts`);
});

eventBus.on('polling:failure', (data) => {
  logger.warn(`Job ${data.jobId} failed: ${data.reason}`);
});
```

## Troubleshooting

### Job Never Completes

**Problem**: Polling job runs forever without success

**Debug Steps**:
1. Test command manually:
   ```bash
   bash -c "your-check-command"
   echo $?  # Should print 0 when condition is met
   ```

2. Check job status:
   ```javascript
   get_polling_job_status("job-id")
   ```

3. Verify condition is achievable

### Too Many Active Jobs

**Problem**: Multiple jobs running, consuming resources

**Solution**: List and cancel unnecessary jobs:
```javascript
// See all jobs
list_polling_jobs()

// Cancel ones you don't need
cancel_polling_job("old-job-1")
cancel_polling_job("old-job-2")
```

### Job Completes but Agent Doesn't Notice

**Problem**: Job succeeds but agent doesn't react

**Explanation**: Polling runs in background. Check memory for success event:
```javascript
// Search memory for polling results
memory_search("polling job wait-download")
```

## Advanced Patterns

### Chained Polling

Wait for one thing, then another:

```javascript
// 1. Wait for file A
register_polling_job(
  "wait-step1",
  "Wait for step 1 output",
  "test -f /tmp/step1.txt",
  3000,
  30
);

// 2. After step 1, in next action, register step 2
register_polling_job(
  "wait-step2",
  "Wait for step 2 output",
  "test -f /tmp/step2.txt",
  3000,
  30
);
```

### Polling with Timeout

Set max attempts to enforce timeout:

```javascript
// 2 minute timeout: 120 seconds / 5 seconds = 24 attempts
register_polling_job(
  "wait-with-timeout",
  "Wait max 2 minutes",
  "test -f /tmp/result.txt",
  5000,
  24
);
```

### Health Monitoring

Continuous monitoring (no maxAttempts):

```javascript
// Keep checking indefinitely
register_polling_job(
  "monitor-disk-space",
  "Alert if disk space < 10%",
  "df -h / | awk 'NR==2 {if ($5+0 > 90) exit 1; else exit 0}'",
  60000  // Check every minute
  // No maxAttempts - runs until cancelled
);
```

## Summary

The polling system provides:
- ✅ No busy loops
- ✅ Event-driven architecture
- ✅ Automatic memory integration
- ✅ Resource efficient
- ✅ Easy to use

Use it whenever you need to wait for a condition instead of repeatedly checking in your logic.

---

*For more information, see: BROWSER_IDENTITY_IMPROVEMENTS.md*
