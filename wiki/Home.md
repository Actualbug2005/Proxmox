# Nexus — Modern Proxmox Management UI

![Nexus dashboard showing cluster resource tree, node status cards, and live telemetry charts](images/dashboard.png)

A fast, keyboard-driven web UI for [Proxmox VE](https://www.proxmox.com/) that runs as a lightweight overlay on the Proxmox host. Full parity with the stock ExtJS UI for day-to-day operations, plus a few things the stock UI can't do — bulk actions across VMs/CTs, a Community Scripts marketplace, and scheduled script chains.

Nexus runs alongside the stock PVE UI. It does not replace it, does not modify PVE itself, and only ever calls the public PVE API.

## What you get

- **Full parity for day-to-day ops** — VM/CT lifecycle (create, clone, migrate, snapshot, backup, restore), storage, firewall, HA, users/groups/realms/ACLs, cluster status, S.M.A.R.T. disks, network, certificates, APT updates, journal, remote console.
- **Keyboard-first UX** — global `⌘K` command palette for jump-to-any-resource.
- **Live telemetry** — RRD charts for node / VM / CT, refreshed while you watch.
- **Embedded terminal** — xterm.js wired to the PVE VNC websocket proxy; no separate app.
- **Community Scripts marketplace** — browse, fill in env overrides, run with a live log drawer, abort with one click.
- **Script chains** — compose ordered sequences of Community Scripts, run ad-hoc or on a cron.
- **Bulk operations** — pick a selection of VMs/CTs and fire a start/stop/snapshot batch at up to 3 concurrent, with a floating progress panel.
- **Cluster-aware** — single pane for multi-node deployments.

## Start here

- **[Installation](Installation)** — one-liner, manual, or inside an LXC.
- **[Feature Tour](Feature-Tour)** — screenshot walk through the UI.
- **[FAQ](FAQ)** — the questions everyone asks.

## License & source

MIT-licensed. Source at [github.com/Actualbug2005/Proxmox](https://github.com/Actualbug2005/Proxmox).
