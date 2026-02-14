# Soak Testing Harness

This project includes a lightweight soak harness to run queue-based workload tests and generate reliability scorecards.

## Commands

- `npm run soak:init`
  - Creates a baseline suite at `~/.orcbot/soak/suites/baseline-24h.json` (or `ORCBOT_DATA_DIR/soak/suites/...`).

- `npm run soak:enqueue -- --suite=<path> --count=10`
  - Enqueues soak tasks into `action_queue.json`.
  - Add `--dryRun` to preview without writing.

- `npm run soak:score -- --sinceHours=24`
  - Computes metrics from:
    - `action_queue.json`
    - `memory.json`
    - `logs/combined.log`
  - Prints JSON score output to terminal.

- `npm run soak:report -- --sinceHours=24`
  - Computes the same metrics and writes a markdown scorecard under:
    - `~/.orcbot/soak/reports/scorecard-<timestamp>.md`

- `npm run soak:report:daily`
  - Shortcut for a 24-hour score export.
  - Intended to be run once per day during the soak window.

## Typical Flow

1. Initialize baseline suite
   - `npm run soak:init`
2. Start OrcBot as usual
   - `npm run dev`
3. Enqueue workload
   - `npm run soak:enqueue -- --count=10`
4. After the test window, generate scorecard
   - `npm run soak:report -- --sinceHours=24`

## Metrics in Scorecard

- `completionRate`: Completed terminal actions / all terminal actions
- `maxStepExitRate`: Max-step exits / terminal actions
- `browserLoopSuppressions`: Browser loop guardrail suppression events from logs
- `fileDeliverySuppressions`: `send_file` answer-first suppressions from logs
- `avgStepsPerCompletedAction`, `p95StepsPerCompletedAction`: Step-depth indicators from memory metadata

## Notes

- The harness defaults to `~/.orcbot` for queue and memory unless `ORCBOT_DATA_DIR` is set.
- Log parsing defaults to workspace `logs/combined.log` (override with `--logs=...`).
- The harness is additive and does not modify agent runtime behavior.
