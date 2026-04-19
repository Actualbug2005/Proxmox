# GitHub Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 9-page user-facing GitHub Wiki for `Actualbug2005/Proxmox`, authored in-repo at `wiki/`, auto-synced to the `.wiki.git` remote by a GitHub Actions workflow on push to `main`.

**Architecture:** Pure content — Markdown files in `wiki/` plus one GitHub Actions workflow. No application code touched. The workflow clones `Proxmox.wiki.git`, rsyncs `wiki/` into it (excluding `.git/` and `wiki/README.md`), commits, and pushes. `GITHUB_TOKEN` is tried first with a `WIKI_TOKEN` PAT fallback.

**Tech Stack:** Markdown, GitHub Wiki (`.wiki.git`), GitHub Actions (`ubuntu-latest`), `rsync`, `git`.

**Spec:** [`docs/superpowers/specs/2026-04-19-github-wiki-design.md`](../specs/2026-04-19-github-wiki-design.md)

---

## File structure

Everything below `wiki/` except `wiki/README.md` ends up on the published wiki. `wiki/README.md` is an in-repo-only explainer, excluded from the rsync.

| Path | Purpose |
| --- | --- |
| `wiki/Home.md` | Landing page (GitHub reserved name) |
| `wiki/Installation.md` | Install paths + uninstall |
| `wiki/Configuration.md` | Env vars, Redis, TLS, ports |
| `wiki/Feature-Tour.md` | Screenshot-driven feature walk |
| `wiki/Community-Scripts.md` | Scripts catalogue deep-dive |
| `wiki/Script-Chains.md` | Chain composition + scheduling |
| `wiki/Bulk-Operations.md` | Bulk VM/CT actions |
| `wiki/Upgrading.md` | Releases + in-place update |
| `wiki/FAQ.md` | Common questions |
| `wiki/_Sidebar.md` | Nav sidebar (GitHub reserved name) |
| `wiki/_Footer.md` | Page footer (GitHub reserved name) |
| `wiki/images/.gitkeep` | Empty marker so the dir is tracked |
| `wiki/README.md` | In-repo explainer (NOT synced to wiki) |
| `.github/workflows/publish-wiki.yml` | Sync workflow |

---

## Task 1: Scaffold the `wiki/` directory

**Files:**
- Create: `wiki/images/.gitkeep`
- Create: `wiki/README.md`

- [ ] **Step 1.1: Create `wiki/images/.gitkeep`**

```bash
mkdir -p /Users/devlin/Documents/GitHub/Proxmox/wiki/images
```

Create the empty placeholder file:

Path: `wiki/images/.gitkeep`
Content: (empty file)

- [ ] **Step 1.2: Create `wiki/README.md`**

Path: `wiki/README.md`

````markdown
# Nexus Wiki Source

This directory is the **source of truth** for the Nexus GitHub Wiki.

- Edits land via PR on `main`.
- The [`publish-wiki.yml`](../.github/workflows/publish-wiki.yml) workflow syncs everything in `wiki/` (except this `README.md` and any `.git/` folder) to <https://github.com/Actualbug2005/Proxmox.wiki.git>.
- The live wiki is at <https://github.com/Actualbug2005/Proxmox/wiki>.

## Pre-flight (one time, by a maintainer)

GitHub refuses to clone `.wiki.git` until the Wiki tab has at least one page, so before the workflow can run for the first time:

1. Open repo **Settings** → **General** → **Features** and make sure **Wikis** is enabled.
2. Visit the Wiki tab and click **Create the first page**. Any placeholder content is fine — the workflow will overwrite it on the first successful sync.

## Authentication

The workflow tries `GITHUB_TOKEN` first. If GitHub rejects that (some repos require a PAT for `.wiki.git` pushes), create a fine-grained PAT with **Wiki: Read and write** scope, add it as the repo secret `WIKI_TOKEN`, and re-run the workflow.

## Conventions

- File names become page titles, with `-` rendered as a space: `Feature-Tour.md` → "Feature Tour".
- `Home.md`, `_Sidebar.md`, `_Footer.md` are reserved GitHub Wiki names.
- Images live in `wiki/images/` and are referenced by relative path: `![alt](images/foo.png)`.
````

- [ ] **Step 1.3: Verify the scaffold**

Run:
```bash
ls -la /Users/devlin/Documents/GitHub/Proxmox/wiki/
ls -la /Users/devlin/Documents/GitHub/Proxmox/wiki/images/
```

Expected:
- `wiki/` contains `README.md` and `images/`.
- `wiki/images/` contains `.gitkeep`.

- [ ] **Step 1.4: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/README.md wiki/images/.gitkeep
git commit -m "$(cat <<'EOF'
docs(wiki): scaffold wiki/ source directory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write `Home.md`

**Files:**
- Create: `wiki/Home.md`

- [ ] **Step 2.1: Create `wiki/Home.md`**

Path: `wiki/Home.md`

````markdown
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
````

- [ ] **Step 2.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Home.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Home landing page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `Installation.md`

**Files:**
- Create: `wiki/Installation.md`

- [ ] **Step 3.1: Create `wiki/Installation.md`**

Path: `wiki/Installation.md`

````markdown
# Installation

Nexus ships as a prebuilt Next.js bundle. The installer downloads the latest GitHub Release tarball, unpacks it under `/opt/nexus/releases/<tag>/`, flips a `current` symlink, and installs a `systemd` unit. Your `.env.local` persists across upgrades.

Three install paths below. Pick the one that fits your setup.

## Path 1 — One-liner on the Proxmox host (recommended)

On the Proxmox host, as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Actualbug2005/Proxmox/main/install.sh)
```

The installer:

1. Installs Node.js 22 LTS if missing.
2. Downloads the latest Nexus release tarball to `/opt/nexus/releases/<tag>/`.
3. Flips `/opt/nexus/current` → the new release.
4. Writes `/opt/nexus/.env.local` with an auto-generated `JWT_SECRET` (preserved on future runs).
5. Installs `/etc/systemd/system/nexus.service` and `/usr/local/bin/nexus-update`.
6. Opens the chosen port (default `3000`) in the PVE host firewall.

When it finishes, open `http://<your-pve-ip>:3000` and log in with any PVE credential.

## Path 2 — Manual install

If you need to pin a specific version or can't run the installer non-interactively, install manually.

```bash
# 1. Install Node.js 22 (Debian/Ubuntu example)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 2. Create the directory layout
mkdir -p /opt/nexus/releases
cd /opt/nexus/releases

# 3. Download a specific release tarball (replace v0.28.1 with your target)
TAG=v0.28.1
curl -fsSL "https://github.com/Actualbug2005/Proxmox/releases/download/${TAG}/nexus-${TAG}.tar.gz" | tar -xz
ln -sfn /opt/nexus/releases/${TAG} /opt/nexus/current

# 4. Create .env.local
cat > /opt/nexus/.env.local <<EOF
PROXMOX_HOST=localhost
PORT=3000
JWT_SECRET=$(openssl rand -base64 36)
EOF
chmod 600 /opt/nexus/.env.local

# 5. Install the systemd unit
cat > /etc/systemd/system/nexus.service <<'EOF'
[Unit]
Description=Nexus - Proxmox Management UI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nexus/current
EnvironmentFile=/opt/nexus/.env.local
ExecStart=/usr/bin/node --experimental-strip-types server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nexus
```

Tail the logs while it starts:

```bash
journalctl -u nexus -f
```

## Path 3 — Inside an LXC (isolation-first)

Running Nexus inside a privileged LXC on the Proxmox host keeps the UI's dependencies out of the host OS. The trade-off is one extra network hop.

1. **Create a privileged Debian 12 LXC.** 1 core, 512 MiB RAM, 4 GiB disk is enough.
2. **Inside the LXC**, follow Path 2 above.
3. **Set `PROXMOX_HOST`** to the PVE host's LAN IP (not `localhost` — `localhost` inside the LXC isn't PVE):

   ```bash
   # /opt/nexus/.env.local
   PROXMOX_HOST=192.0.2.10
   ```

4. **Firewall:** open port `3000` on the LXC's interface and make sure the LXC can reach the host's `:8006`.
5. **TLS:** PVE serves a self-signed cert — no extra config needed; Nexus scopes the TLS bypass to `pveFetch` only, so outbound calls to anything else still validate normally.

## Uninstall

```bash
# Stop and remove the service
systemctl disable --now nexus
rm /etc/systemd/system/nexus.service
systemctl daemon-reload

# Remove installed files
rm -rf /opt/nexus
rm -f /usr/local/bin/nexus-update

# Close the firewall port (adjust port if you changed it)
pve-firewall localnet  # find the rule number, then:
# Edit /etc/pve/firewall/cluster.fw and remove the nexus line
```

Your PVE host, VMs, CTs, storage, and settings are untouched — Nexus only ever calls the public PVE API and stores nothing in PVE's data directories.

## Next

- **[Configuration](Configuration)** — env vars, Redis, TLS, ports.
- **[Feature Tour](Feature-Tour)** — what to try first.
````

- [ ] **Step 3.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Installation.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Installation page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write `Configuration.md`

**Files:**
- Create: `wiki/Configuration.md`

- [ ] **Step 4.1: Create `wiki/Configuration.md`**

Path: `wiki/Configuration.md`

````markdown
# Configuration

Nexus reads its configuration from `/opt/nexus/.env.local` (created by the installer) and persists it across upgrades. Every var below is optional except where marked **required**.

## Environment variables

| Variable | Required | Default | When to set | Example |
| --- | --- | --- | --- | --- |
| `PROXMOX_HOST` | **yes** | `localhost` | Always. Set to the LAN IP of the PVE host if Nexus runs outside the host (e.g. in an LXC). | `192.0.2.10` |
| `JWT_SECRET` | **yes** | auto-generated | Only if you're moving the install and want to preserve sessions across the move. | `$(openssl rand -base64 36)` |
| `PORT` | no | `3000` | When port 3000 is already in use, or you want to front Nexus with a reverse proxy on a different port. | `8080` |
| `REDIS_URL` | no | _(in-memory)_ | To run multiple Nexus instances behind a load balancer, or to survive restarts without losing sessions. | `redis://127.0.0.1:6379` |
| `NEXUS_SECURE_COOKIES` | no | `true` in prod, `false` in dev | Set `false` when serving over plain HTTP on a trusted LAN (otherwise browsers refuse the session cookie). | `false` |
| `NEXUS_DATA_DIR` | no | `$TMPDIR/nexus-data` | **Production:** override to a durable path. The default lives under `/tmp` and is wiped on reboot. | `/var/lib/nexus` |
| `NEXUS_VERSION_FILE` | no | `/opt/nexus/current/VERSION` | Rarely set — the release tarball bakes the version in. Override only for custom deployments. | `/etc/nexus/VERSION` |
| `NEXUS_REPO` | no | `Actualbug2005/Proxmox` | If you fork Nexus and want the "new release available" probe to check your fork instead. | `myuser/my-fork` |

After editing `.env.local`, restart the service:

```bash
systemctl restart nexus
```

## Redis (optional)

Without Redis, sessions live in-memory and reset whenever the process restarts — fine for a single-user home setup, not fine for HA or for surviving crashes.

Any reachable Redis works. Examples:

```bash
REDIS_URL=redis://127.0.0.1:6379              # local, no auth
REDIS_URL=redis://:s3cret@redis.internal:6379 # remote, password auth
REDIS_URL=redis://:s3cret@redis.internal:6379/2  # use DB index 2
```

Nexus uses `ioredis` under the hood with automatic reconnection; a Redis outage degrades session lookup but does not crash the app.

## TLS / self-signed certificates

PVE ships with a self-signed cert on port 8006. Earlier Nexus releases set `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide, which disabled cert validation for **every** outbound call.

As of v0.24, Nexus scopes the TLS bypass to a dedicated `undici.Agent` used only by `pveFetch`. Everything else — GitHub API calls for release checks, SMTP for notifications, Community Scripts catalogue fetches — validates certs normally.

**You do not need to set `NODE_TLS_REJECT_UNAUTHORIZED`.** If you see it in your environment, remove it.

## Data directory

The persistent data directory holds:

- `scheduled-jobs.json` — one-shot and recurring script jobs
- `scheduled-chains.json` — [script chains](Script-Chains) and their state (including the `consecutiveFailures` counter that triggers auto-disable)

On a fresh install, `NEXUS_DATA_DIR` defaults to `$TMPDIR/nexus-data` — **`/tmp` on most Linuxes, wiped on reboot**. For any real deployment, override it:

```bash
# /opt/nexus/.env.local
NEXUS_DATA_DIR=/var/lib/nexus
```

Create the directory and give the service user write access:

```bash
mkdir -p /var/lib/nexus
chown root:root /var/lib/nexus   # systemd runs Nexus as root by default
```

## Cookies over plain HTTP

In production, Nexus sets the session cookie with the `Secure` attribute, which browsers refuse over plain HTTP. If you run Nexus behind a reverse proxy that terminates TLS, you're fine — Nexus sees HTTPS at the request boundary.

If you access Nexus directly over `http://<ip>:3000` on your LAN, disable the `Secure` flag:

```bash
NEXUS_SECURE_COOKIES=false
```

Only do this on a trusted network. Any man-in-the-middle on the path can steal the session cookie.

## Changing the port

Three places to update when moving off 3000:

1. `.env.local`: `PORT=8080`
2. PVE host firewall: open the new port, close the old one.
3. Any reverse-proxy config (nginx, Caddy, Cloudflare Tunnel) pointing at Nexus.

Restart with `systemctl restart nexus` and check `ss -lnt | grep 8080` to confirm.
````

- [ ] **Step 4.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Configuration.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Configuration page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write `Feature-Tour.md`

**Files:**
- Create: `wiki/Feature-Tour.md`

- [ ] **Step 5.1: Create `wiki/Feature-Tour.md`**

Path: `wiki/Feature-Tour.md`

````markdown
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
````

- [ ] **Step 5.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Feature-Tour.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Feature Tour page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Write `Community-Scripts.md`

**Files:**
- Create: `wiki/Community-Scripts.md`

- [ ] **Step 6.1: Create `wiki/Community-Scripts.md`**

Path: `wiki/Community-Scripts.md`

````markdown
# Community Scripts

Nexus embeds the full [community-scripts.org](https://community-scripts.org) marketplace (formerly tteck's scripts) with an execution UI tailored for long-running installs.

![Community Scripts catalogue two-pane view](images/scripts-catalogue.png)

## What's in the catalogue

Every script the upstream PocketBase API exposes — LXC templates, VM installers, ad-hoc utility scripts. Metadata (logo, description, default credentials, severity notes, install-method variants) comes from the upstream API, not a local snapshot, so additions show up the next time you refresh.

## Browsing

Two-pane layout: **left** is the scrollable/searchable list with category filters; **right** is the per-script detail pane.

## Per-script detail

![Per-script detail pane with install-method tabs, env overrides, credentials, and severity notes](images/scripts-detail.png)

For each script the detail pane shows:

- **Install-method tabs** — one tab per variant upstream publishes (e.g. "default" vs "advanced").
- **Env overrides** — best-effort form over the script's documented environment variables: hostname, CT ID, CPU/RAM/disk, storage, password. Leave blank for upstream defaults.
- **Credentials** — any default login surface the script ships with (rendered in a copy-to-clipboard block).
- **Severity-coloured notes** — any "requires manual step" or "destructive action" warnings upstream ships.

## Fire-and-forget execution

Most Community Scripts take minutes to run (LXC creation, downloads, builds). Cloudflare Tunnel drops any single HTTP request after 100 seconds, which would kill a foreground run.

Nexus **never blocks the HTTP request on the script finishing.** When you click **Run**:

1. The server spawns the script detached.
2. The API returns a `jobId` immediately (usually under 500 ms).
3. A **floating bottom-right status bar** appears showing the job's state.

![Floating status bar and live-log drawer while a script is running](images/scripts-running.png)

The status bar has two controls:

- **Open log** — slides out a drawer with the live stdout/stderr stream. You can close it and reopen it any time.
- **Abort** — sends SIGTERM, then SIGKILL after a grace period. The job transitions to `failure`.

When the job finishes, the status bar fades out after a few seconds. Completed jobs remain visible in the job list until the page is refreshed.

## Troubleshooting

### "Why did my script run in the wrong storage?"

The env-override form is **best-effort**: it fills in the upstream script's documented env var names, but some variants of the script read storage from a different var name or ignore the env entirely. Check the script's docs on community-scripts.org for the exact knobs, and use the "raw env" section at the bottom of the form to pass anything the UI doesn't know about.

### "How do I see past runs?"

Job state is in-memory on the server — a restart clears the list. Persistent history is tracked for **[Script Chains](Script-Chains)** only; use a chain (even with a single step) if you need a run log that survives restarts.

### "The script hangs forever"

Scripts that prompt on stdin will hang because Nexus spawns them non-interactive. Check the upstream script for a `NONINTERACTIVE=1` env flag (many have one) and set it in the env-override form.
````

- [ ] **Step 6.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Community-Scripts.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Community Scripts page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Write `Script-Chains.md`

**Files:**
- Create: `wiki/Script-Chains.md`

- [ ] **Step 7.1: Create `wiki/Script-Chains.md`**

Path: `wiki/Script-Chains.md`

````markdown
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
````

- [ ] **Step 7.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Script-Chains.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Script Chains page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Write `Bulk-Operations.md`

**Files:**
- Create: `wiki/Bulk-Operations.md`

- [ ] **Step 8.1: Create `wiki/Bulk-Operations.md`**

Path: `wiki/Bulk-Operations.md`

````markdown
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
````

- [ ] **Step 8.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Bulk-Operations.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Bulk Operations page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Write `Upgrading.md`

**Files:**
- Create: `wiki/Upgrading.md`

- [ ] **Step 9.1: Create `wiki/Upgrading.md`**

Path: `wiki/Upgrading.md`

````markdown
# Upgrading

Nexus releases follow SemVer and ship as prebuilt tarballs attached to GitHub Releases. The installer supports side-by-side release directories and an atomic symlink flip, so upgrades are fast and roll back cleanly.

## Release model

- **Versioning:** `MAJOR.MINOR.PATCH` (SemVer).
- **Release tarball:** one `nexus-vX.Y.Z.tar.gz` per release, attached to the GitHub Release at <https://github.com/Actualbug2005/Proxmox/releases>.
- **Version file:** every tarball bakes `VERSION` containing the SemVer string. Nexus reads it at startup and exposes it on `/api/health` and in the UI.
- **Layout on disk:**

  ```
  /opt/nexus/
    releases/
      v0.27.3/          # previous
      v0.28.0/          # previous
      v0.28.1/          # current
    current -> releases/v0.28.1
    .env.local          # persists across upgrades
  ```

## In-place upgrade

The installer drops a `/usr/local/bin/nexus-update` helper for this. Run:

```bash
nexus-update
```

It:

1. Fetches the latest release tarball.
2. Unpacks into `/opt/nexus/releases/<new-tag>/`.
3. Flips the `current` symlink.
4. Restarts the `nexus` systemd unit.

Downtime is sub-second (the time it takes systemd to swap processes). The UI shows a toast when the new version is running and prompts a reload.

## Upgrade via installer re-run

The one-liner installer is also idempotent — running it again fetches the latest release on top of your existing install. Use this if `nexus-update` has been removed or if you want to force a fresh `.env.local` merge.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Actualbug2005/Proxmox/main/install.sh)
```

Your `.env.local` is never overwritten — new defaults are appended as comments only if the schema has grown.

## Rollback

Because previous release directories stay on disk:

```bash
ln -sfn /opt/nexus/releases/v0.27.3 /opt/nexus/current
systemctl restart nexus
```

Done. If the rollback target is before a breaking schema change (see **Breaking changes** below), read that release's notes before flipping.

## What persists across upgrades

| Persists | Resets |
| --- | --- |
| `.env.local` (all env vars) | In-memory sessions (unless `REDIS_URL` is set) |
| Everything under `$NEXUS_DATA_DIR` (scheduled jobs, scheduled chains) | Job run history for single scripts (chain history persists) |
| Redis session store | |

## Breaking changes policy

Major-version bumps (`0.x → 1.x`, `1.x → 2.x`) may introduce breaking changes. Minor and patch bumps **do not** change:

- Persisted file formats (jobs, chains).
- Env var names or semantics.
- Systemd unit file path or service name.

Release notes flag any breaking change with a `⚠️ BREAKING:` prefix and a migration note.

## Changelog

- **GitHub Releases:** <https://github.com/Actualbug2005/Proxmox/releases>
- Each release page shows the full git log since the previous tag, plus any highlighted changes.

## Health check

After any upgrade:

```bash
curl -s http://localhost:3000/api/health | jq
```

You should see `{"status":"ok","version":"<new-tag>","uptime":...}`.
````

- [ ] **Step 9.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/Upgrading.md
git commit -m "$(cat <<'EOF'
docs(wiki): add Upgrading page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Write `FAQ.md`

**Files:**
- Create: `wiki/FAQ.md`

- [ ] **Step 10.1: Create `wiki/FAQ.md`**

Path: `wiki/FAQ.md`

````markdown
# FAQ

## Does Nexus replace the stock PVE UI?

**No.** Nexus runs alongside the stock PVE UI at `:8006`. It never modifies PVE itself, only calls the public PVE API. You can use both UIs simultaneously — switch tabs, nothing breaks.

## Which Proxmox versions are supported?

PVE 8.x. Nexus uses only documented PVE API endpoints, so earlier 7.x may work, but it's not tested.

## Can I run Nexus without systemd?

Yes. `npm run start` in `/opt/nexus/current` runs the server in the foreground. You can wrap it in anything (Docker, launchd, pm2, tmux). systemd is just the default because every PVE host already has it.

## Does it work on a multi-node cluster?

Yes. Nexus pulls from `/cluster/resources` and shows all nodes, VMs, CTs, and storages as one tree. You only need **one** Nexus install to manage the whole cluster — point it at any node that can reach `/api2/json/cluster/*`.

## Can I run multiple Nexus instances (HA / behind a load balancer)?

Yes, if you set `REDIS_URL`. Without Redis, each instance has its own in-memory session store, which means a user logged into instance A would appear logged-out when the load balancer routes them to instance B. With Redis, sessions are shared and every instance is interchangeable.

## Login fails even though my PVE credentials are correct

Three common causes:

1. **Wrong realm.** PVE has `pam` (Linux users on the host) and `pve` (Proxmox-internal accounts) realms. The login form picks the realm from the dropdown — check you're on the right one. `root@pam` is almost always the one you want for day-to-day admin.
2. **`PROXMOX_HOST` unreachable.** Check `curl -k https://<PROXMOX_HOST>:8006/api2/json/version` from the Nexus host. If that fails, fix networking before anything else.
3. **Two-factor auth.** TOTP is supported; the login form shows the code box after your password is verified. U2F is not yet supported.

## Why can't Nexus reach PVE from inside an LXC?

`PROXMOX_HOST=localhost` refers to the LXC's own loopback, not the PVE host. Set `PROXMOX_HOST` to the **PVE host's LAN IP** (e.g. `192.0.2.10`) and make sure the LXC's network can reach the host's port 8006. If you bridged the LXC to `vmbr0`, it usually can by default.

## Is my PVE password stored?

**No.** Nexus logs in with your password once, receives a PVE session ticket (`PVEAuthCookie`), and stores only the opaque ticket in the session store. The password is discarded immediately after the login API call.

Tickets expire per PVE's own policy (default 2 h); Nexus re-auth's transparently within their valid window.

## Can I run Nexus behind Cloudflare Tunnel / a reverse proxy?

Yes. That's actually why the [fire-and-forget script execution](Community-Scripts) model exists — Cloudflare Tunnel drops any HTTP request at 100 s, and a lot of Community Scripts take longer than that. Nexus returns a `jobId` in under a second and streams status separately, so the tunnel never kills a script mid-run.

For the reverse proxy itself: forward to `localhost:3000`, terminate TLS at the proxy, leave `NEXUS_SECURE_COOKIES=true`. Nexus only needs to know the request came over HTTPS at the boundary.

## How do I turn off alerts?

Every alert rule has an **Enabled** toggle on its edit page. Flip it off and the rule stops evaluating. If you want alerts entirely gone: delete every rule from the alerts page.

## How do I report a bug?

Open an issue on the main repo: <https://github.com/Actualbug2005/Proxmox/issues>. Include your Nexus version (from `/api/health`), your PVE version (`pveversion`), and whatever logs `journalctl -u nexus --since '10 min ago'` produced.
````

- [ ] **Step 10.2: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/FAQ.md
git commit -m "$(cat <<'EOF'
docs(wiki): add FAQ page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Write `_Sidebar.md` and `_Footer.md`

**Files:**
- Create: `wiki/_Sidebar.md`
- Create: `wiki/_Footer.md`

- [ ] **Step 11.1: Create `wiki/_Sidebar.md`**

Path: `wiki/_Sidebar.md`

````markdown
### Getting Started

- [Home](Home)
- [Installation](Installation)
- [Configuration](Configuration)
- [Upgrading](Upgrading)

### Features

- [Feature Tour](Feature-Tour)
- [Community Scripts](Community-Scripts)
- [Script Chains](Script-Chains)
- [Bulk Operations](Bulk-Operations)
- [FAQ](FAQ)
````

- [ ] **Step 11.2: Create `wiki/_Footer.md`**

Path: `wiki/_Footer.md`

````markdown
Nexus is MIT-licensed · Report wiki issues on the [main repo](https://github.com/Actualbug2005/Proxmox/issues)
````

- [ ] **Step 11.3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add wiki/_Sidebar.md wiki/_Footer.md
git commit -m "$(cat <<'EOF'
docs(wiki): add sidebar and footer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Add the publish workflow

**Files:**
- Create: `.github/workflows/publish-wiki.yml`

- [ ] **Step 12.1: Create `.github/workflows/publish-wiki.yml`**

Path: `.github/workflows/publish-wiki.yml`

```yaml
name: Publish Wiki

on:
  push:
    branches: [main]
    paths:
      - 'wiki/**'
      - '.github/workflows/publish-wiki.yml'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Clone wiki repo
        env:
          TOKEN: ${{ secrets.WIKI_TOKEN || secrets.GITHUB_TOKEN }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          if ! git clone "https://x-access-token:${TOKEN}@github.com/${REPO}.wiki.git" wiki-repo; then
            echo "::error::Could not clone ${REPO}.wiki.git."
            echo "::error::Wiki must be enabled in repo Settings and have at least one page."
            echo "::error::See wiki/README.md for the one-time pre-flight steps."
            exit 1
          fi

      - name: Sync wiki/ into wiki-repo
        run: |
          set -euo pipefail
          rsync -a --delete \
            --exclude='.git' \
            --exclude='README.md' \
            wiki/ wiki-repo/

      - name: Commit and push
        env:
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          cd wiki-repo
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "No wiki changes to sync."
            exit 0
          fi
          short_sha="${SHA:0:7}"
          git commit -m "Sync wiki from ${short_sha}"
          if ! git push; then
            echo "::warning::First push attempt failed; retrying once..."
            sleep 5
            if ! git push; then
              echo "::error::Push to .wiki.git failed."
              echo "::error::If this persists, set a WIKI_TOKEN repo secret (fine-grained PAT with Wiki: Read and write)."
              exit 1
            fi
          fi
```

- [ ] **Step 12.2: Verify the workflow is valid YAML**

Run:
```bash
cd /Users/devlin/Documents/GitHub/Proxmox
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish-wiki.yml'))" && echo "YAML OK"
```

Expected: `YAML OK` with exit code 0.

- [ ] **Step 12.3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git add .github/workflows/publish-wiki.yml
git commit -m "$(cat <<'EOF'
ci(wiki): auto-sync wiki/ to .wiki.git on push to main

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Verify structure & push

**Files:** (none created — verification only)

- [ ] **Step 13.1: Confirm every page exists**

Run:
```bash
cd /Users/devlin/Documents/GitHub/Proxmox
ls wiki/
```

Expected output includes:
```
Bulk-Operations.md
Community-Scripts.md
Configuration.md
FAQ.md
Feature-Tour.md
Home.md
Installation.md
README.md
Script-Chains.md
Upgrading.md
_Footer.md
_Sidebar.md
images
```

- [ ] **Step 13.2: Confirm workflow is in place**

Run:
```bash
cd /Users/devlin/Documents/GitHub/Proxmox
ls .github/workflows/
```

Expected: file list includes `publish-wiki.yml`.

- [ ] **Step 13.3: Optional markdown lint**

Run (only if `markdownlint-cli` is available):
```bash
cd /Users/devlin/Documents/GitHub/Proxmox
npx --yes markdownlint-cli "wiki/**/*.md" || true
```

Expected: either zero output (no lint errors) or a list of minor style warnings. Nothing here is a blocker — wiki content is prose, not code, and GitHub's renderer tolerates most stylistic differences.

- [ ] **Step 13.4: Review the git log for this change**

Run:
```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git log --oneline main..HEAD
```

Expected: 12 commits from Tasks 1–12, each with a `docs(wiki):` or `ci(wiki):` prefix.

- [ ] **Step 13.5: Push and open a PR**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
git push -u origin HEAD
gh pr create --title "docs(wiki): GitHub Wiki v1 + auto-sync workflow" --body "$(cat <<'EOF'
## Summary
- 9-page user-facing wiki authored in \`wiki/\` (Home, Installation, Configuration, Feature Tour, Community Scripts, Script Chains, Bulk Operations, Upgrading, FAQ) plus \`_Sidebar\` and \`_Footer\`.
- \`.github/workflows/publish-wiki.yml\` syncs \`wiki/\` → \`.wiki.git\` on push to \`main\`.
- In-repo \`wiki/README.md\` documents the one-time pre-flight (enable Wiki in Settings + create initial page).
- Spec: \`docs/superpowers/specs/2026-04-19-github-wiki-design.md\`

## Test plan
- [ ] Merge this PR.
- [ ] One-time: enable Wiki in repo Settings and create a placeholder Home page via the UI.
- [ ] Trigger the workflow manually (\`gh workflow run publish-wiki.yml\`).
- [ ] Confirm the Wiki tab shows all 9 pages + sidebar + footer.
- [ ] Edit a word in \`wiki/Home.md\` on \`main\`; confirm the change lands on the published wiki within ~60 s.
- [ ] Rename a page and confirm the old title is removed from the published wiki.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed on success.

---

## Task 14: Post-merge activation (requires the human)

These steps happen **on github.com**, not from the repo, and can only be done by a maintainer of `Actualbug2005/Proxmox`. They're included here as the runbook for whoever merges the PR.

- [ ] **Step 14.1: Enable Wiki in repo settings**

Visit <https://github.com/Actualbug2005/Proxmox/settings>. Scroll to **Features** → check **Wikis**. Save.

- [ ] **Step 14.2: Create a placeholder Home page**

Visit <https://github.com/Actualbug2005/Proxmox/wiki>. Click **Create the first page**. Any content is fine — the workflow's first run will overwrite it.

- [ ] **Step 14.3: Trigger the workflow manually**

```bash
gh workflow run publish-wiki.yml --ref main
gh run watch
```

Expected: green checkmark; workflow completes in under 30 s.

- [ ] **Step 14.4: Confirm the Wiki tab is fully populated**

Open <https://github.com/Actualbug2005/Proxmox/wiki>. The sidebar should list all nine pages plus the footer line. Click through each page and confirm:
- The H1 matches the filename (spaces where hyphens were).
- Internal links (e.g. **[Configuration](Configuration)**) resolve.
- Image references appear as broken-image icons with the alt text visible (expected — screenshots haven't been added yet).

- [ ] **Step 14.5 (optional): Add screenshots**

Drop PNGs into `wiki/images/` on `main` using the filenames listed in the [spec's screenshot checklist](../docs/superpowers/specs/2026-04-19-github-wiki-design.md#screenshot-checklist). Each push re-triggers the sync workflow and the images appear on the wiki automatically.

- [ ] **Step 14.6 (fallback): Switch to a PAT if `GITHUB_TOKEN` gets rejected**

If Step 14.3 fails with a 403 on the final push:
1. Create a fine-grained PAT at <https://github.com/settings/tokens?type=beta> with **Repository access** → `Actualbug2005/Proxmox` and **Wiki: Read and write** permission.
2. Add it as a repo secret named `WIKI_TOKEN` under Settings → Secrets and variables → Actions.
3. Re-run the workflow. It prefers `WIKI_TOKEN` over `GITHUB_TOKEN` automatically.

---

## Done

The wiki is live, kept in sync by CI, and every subsequent edit lands via normal PR review on `main`.
