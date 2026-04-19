# Script Chains

A chain is an **ordered sequence of Community Scripts** run one after another. Useful when a workflow needs three scripts in a row (e.g. "create a CT, install Docker inside it, deploy a stack") and you want it repeatable.

![Chain editor with ordered step list, per-step env overrides, and failure-policy toggle](images/chain-editor.png)

## Failure policy

Each chain picks one of:

- **`halt-on-failure`** — if any step exits non-zero, the chain aborts; remaining steps are skipped and marked `skipped`.
- **`continue-on-failure`** — every step runs regardless; a failure just marks that step `failure` and moves on.

There's no mid-chain branching — if you need "run X if Y succeeded, else run Z," use two separate chains.

## Running a chain

Two ways:

- **Ad-hoc:** click **Run now** from the chain page. Same fire-and-forget model as single-script runs; the status bar tracks chain-level state and each step's UPID.
- **Scheduled:** set a 5-field cron expression (`m h dom mon dow`). The scheduler fires the chain at each match in the system timezone of the Nexus host.

![Chain schedule editor with a cron expression and "next fire" preview](images/chain-schedule.png)

## Auto-disable after repeated failures

Scheduled chains that fail **5 times in a row** auto-disable. The chain stays in the list with a `disabled` badge; re-enable it from the chain page once you've fixed the root cause. The `consecutiveFailures` counter resets on any successful fire.

This exists so a broken cron doesn't silently hammer the PVE API forever. If you want the chain to keep running regardless, use `continue-on-failure` — steps succeed even when individual scripts fail, which keeps the counter at 0.

## Persistence

Chains live in `$NEXUS_DATA_DIR/scheduled-chains.json`. If you're running with the default `NEXUS_DATA_DIR=$TMPDIR/nexus-data`, a reboot wipes every chain — **override `NEXUS_DATA_DIR`** before relying on chains in production. See [Configuration](Configuration#data-directory).

## Run history

Unlike single scripts, chain runs are persisted. Each chain keeps a bounded history of its last runs with per-step exit status and duration. This is your audit trail for "did last night's backup chain actually run?"
