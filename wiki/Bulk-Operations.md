# Bulk Operations

Bulk operations let you run the same PVE action against a **selection** of VMs or CTs at once — e.g. "snapshot every running CT tagged `prod`" or "shutdown the entire staging node before a maintenance window."

## Selecting items

Every VM/CT dashboard table has a leading checkbox column. Pick individual rows or use the header checkbox for "select all visible." Filters (search, status, tag) narrow the selection before you click the header — a handy way to say "select every stopped CT."

## Supported actions

From the floating action bar that appears once you have at least one row selected:

- **Start** — issues `POST /nodes/{n}/qemu/{id}/status/start` (or `/lxc/{id}/status/start`) per item.
- **Stop** — hard stop (`/status/stop`). Use sparingly.
- **Shutdown** — graceful (`/status/shutdown`) with PVE's default timeout.
- **Reboot** — graceful reboot (`/status/reboot`).
- **Snapshot** — prompts for a snapshot name (`/snapshot`), used across every selected item.

Actions the stock PVE UI doesn't batch (migrate, clone) are intentionally left out of bulk — batching those is genuinely dangerous and a chain is a better fit.

## Concurrency

Bulk always fires **three items at a time**. This is not configurable today.

- Running more in parallel floods the PVE scheduler and produces worse wall-clock completion times.
- Running serially is unnecessarily slow for selections of ten-plus items.

Three is a pragmatic middle that matches PVE's own internal concurrency heuristic for task queueing.

## Progress panel

![Floating progress panel with per-item status rows, PVE UPID links, and an overall counter](images/bulk-progress.png)

A floating panel tracks the batch:

- Per-item rows with a discriminated state (`pending | running | success | failure`) — the compiler enforces illegal states like a `success` row with no UPID.
- UPID links jump straight to PVE's native task log for any item.
- Overall counter: "12 of 20 complete, 3 running, 0 failed."
- Panel is dismissable once every item hits a terminal state (success or failure).

## Error handling

A single failure never aborts the batch. Each item succeeds or fails independently — the progress panel flags failures for you to re-run.

Transient PVE errors (5xx) are not automatically retried in bulk; retry is deliberately manual so you can see which items failed before blindly re-firing.

## See also

- **[Script Chains](Script-Chains)** — for "do A, then B, then C" across **different** actions on the **same** target.
- **[Community Scripts](Community-Scripts)** — for heavier provisioning work.
