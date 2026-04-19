# Feature Tour

A screenshot walk through the UI. Use this page as your "what can Nexus actually do" skim — deeper pages link from the "see also" notes.

## Dashboard

![Nexus dashboard with per-node cards, a fleet-wide telemetry strip, and an alerts panel](images/dashboard.png)

The landing view shows per-node status cards (CPU, RAM, uptime, load), a fleet-wide telemetry strip, and any firing alert rules. Click through any card for its detail page. All widgets auto-refresh while the tab is focused.

## Command Palette (⌘K)

![Command palette showing a search box with fuzzy-matched VMs, CTs, nodes, and action commands](images/command-palette.png)

Press `⌘K` (or `Ctrl+K` on Linux/Windows) anywhere in the app to open the palette. It fuzzy-matches every VM, CT, node, storage, and top-level action in the app. Hit Enter to jump. `↑`/`↓` to navigate, `Esc` to dismiss.

## Resource tree & cluster view

![Cluster resource tree showing nodes expanded to their VMs and CTs with running-state badges](images/resource-tree.png)

The left-hand rail mirrors PVE's resource tree, but pulls from `/cluster/resources` so multi-node clusters show as one coherent tree. Running-state badges update in real time.

## VM/CT lifecycle

![VM detail page with tabs for summary, console, hardware, options, snapshots, backup, and firewall](images/vm-detail.png)

Per-VM and per-CT pages cover everything the stock UI does: start/stop/shutdown/reboot, clone, migrate, snapshot, backup/restore, firewall, hardware edits, and console. Lifecycle actions that take a while return a PVE task UPID; Nexus tracks it to completion and surfaces errors as toasts.

**See also:** [Bulk Operations](Bulk-Operations) for running the same action across many VMs at once.

## Live telemetry / RRD charts

![RRD charts for CPU, RAM, network, and disk I/O across a 24-hour window](images/telemetry-chart.png)

Per-node, per-VM, and per-CT RRD charts cover CPU, RAM, network, and disk I/O, with selectable windows (hour / day / week / month / year). Polling is throttled and stale-while-revalidate so idle tabs don't hammer the PVE API.

## Embedded xterm console

![In-browser xterm console attached to a VM's VNC websocket](images/console.png)

Every VM and CT detail page has a **Console** tab. It's xterm.js wired to PVE's VNC websocket proxy — same capability as the stock UI, no extra auth dance, no popup, no plugin. Works from inside an LXC install too.

## Alerts & notifications

![Alert rule editor with severity picker and notification channel assignments](images/alerts.png)

Define rules against fleet telemetry ("CPU > 80 % on node X for 5 min", "CT 201 stopped"), pick severity, and wire them to notification channels (email via SMTP, plus any channel the installed version supports). Firing alerts appear on the dashboard; resolved alerts fire a separate notification with a `firingFor` duration templated into the message.

**See also:** [FAQ](FAQ) for how to turn alerts off.

## Community Scripts & chains

![Community Scripts catalogue two-pane with list on the left, per-script detail on the right](images/scripts-catalogue.png)

A browsable catalogue of the [community-scripts.org](https://community-scripts.org) marketplace. Fill in env overrides, run, and watch the live log. Compose ordered chains and schedule them on a cron.

**See also:** [Community Scripts](Community-Scripts), [Script Chains](Script-Chains).
