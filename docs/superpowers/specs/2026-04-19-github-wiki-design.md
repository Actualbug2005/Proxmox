# GitHub Wiki for Nexus

**Date:** 2026-04-19
**Status:** Design approved, ready for plan
**Repo:** `Actualbug2005/Proxmox`
**Primary audience:** Homelab users installing and running Nexus

## Goal

Ship a polished GitHub Wiki at `github.com/Actualbug2005/Proxmox/wiki` as the user-facing front door to Nexus. Developer/contributor docs stay in-repo (`AGENTS.md`, `CLAUDE.md`, `docs/superpowers/`) — the Wiki exists so a person landing on the repo can go from "what is this" to "it's running on my host" without reading source.

The Wiki is authored in-repo at `wiki/`, kept in sync with the `.wiki.git` remote by a GitHub Actions workflow on push to `main`.

## Non-goals

- Developer / contributor documentation — that lives in-repo, PR-reviewed.
- Auto-generated API reference.
- Internationalisation.
- Duplicating the README — the Wiki reframes material for discovery (screenshots, tours, troubleshooting) rather than restating the README verbatim.

## Repo layout

```
wiki/
  Home.md                    # Landing: what is Nexus, screenshot, TOC
  Installation.md            # Quick install + manual steps + LXC walkthrough + uninstall
  Configuration.md           # Env vars (full table), Redis, TLS, data dir, ports
  Feature-Tour.md            # Dashboard, command palette, telemetry, console, alerts
  Community-Scripts.md       # Catalogue, install-methods, env overrides, abort, logs
  Script-Chains.md           # Compose, halt-on-failure, cron, auto-disable after 5 fails
  Bulk-Operations.md         # Selection UX, concurrency=3, progress panel, UPID links
  Upgrading.md               # Release model, installer re-run, data-dir persistence
  FAQ.md                     # Common questions, PVE compat, HA/multi-instance
  _Sidebar.md                # Wiki navigation sidebar (rendered on every page)
  _Footer.md                 # Short "report issues on main repo" footer
  images/
    .gitkeep                 # Placeholder dir; images referenced by pages go here
  README.md                  # Short in-repo explainer pointing at the live wiki
.github/
  workflows/
    publish-wiki.yml         # Sync wiki/ → .wiki.git on push to main
```

GitHub Wiki conventions:
- Filenames become page titles with `-` rendered as a space (`Feature-Tour.md` → "Feature Tour").
- `Home.md`, `_Sidebar.md`, and `_Footer.md` are reserved names with special rendering.

## Per-page content outline

Every page follows the same shape: H1 title → 1–2 sentence intro → sections. Outlines below describe content, not literal copy.

### `Home.md`
- Hero screenshot (`images/dashboard.png`).
- 3-sentence pitch (what Nexus is, why it exists, who it's for).
- **What you get** — short bullet list distilled from README highlights.
- **Start here** — link row → Installation / Feature Tour / FAQ.

### `Installation.md`
Three install paths:
1. **One-liner**: `bash <(curl -fsSL …/install.sh)` from the README, with a note about what the installer does.
2. **Manual**: clone to `/opt/nexus`, write `.env.local`, `npm ci && npm run build`, full `systemd` unit contents.
3. **Inside an LXC**: privileged LXC recipe, Node 22, network advice for reaching PVE from inside a container.

Plus an **Uninstall** section (stop service, remove `/opt/nexus`, close firewall rule).

### `Configuration.md`
- Full env var table — the README table, re-expressed with **When to set**, **Example values**, and **Default**.
- Sub-sections: Redis setup (single-instance vs HA), TLS/self-signed certs (why `NODE_TLS_REJECT_UNAUTHORIZED` is no longer process-wide), persistent data dir (`NEXUS_DATA_DIR`), cookies over plain HTTP (`NEXUS_SECURE_COOKIES=false`), changing the port.

### `Feature-Tour.md`
Screenshot-driven walk. Each subsection: 2–3 sentences + screenshot placeholder + optional "→ see also" link to a deep-dive page.
- Dashboard & widgets
- Command Palette (⌘K)
- Resource tree & cluster view
- VM/CT lifecycle actions
- Live telemetry / RRD charts
- Embedded xterm console
- Alerts & notifications

### `Community-Scripts.md`
- What the catalogue is (tteck / community-scripts.org, PocketBase public API).
- How to browse (two-pane layout).
- Per-script detail: install-method tabs, env overrides, credentials, severity-coloured notes.
- Fire-and-forget execution model (why it exists: Cloudflare Tunnel 100 s cap) → jobId → floating status bar + live-log drawer + Abort button.
- Troubleshooting: "why did my script run in the wrong storage?", "how do I see past runs?".

### `Script-Chains.md`
- What a chain is (ordered sequence of scripts).
- `halt-on-failure` vs `continue-on-failure` semantics.
- Ad-hoc run vs 5-field cron schedule.
- Auto-disable after 5 consecutive failed fires + how to re-enable in the UI.
- Persistence location (`NEXUS_DATA_DIR/scheduled-chains.json`).

### `Bulk-Operations.md`
- Selection UX in VM/CT dashboard tables.
- Supported actions: start / stop / shutdown / reboot / snapshot.
- Fixed concurrency of 3 (why, and that it's not configurable today).
- Floating progress panel.
- Per-item discriminated states: `pending | running | success | failure`.
- UPID deep-links back to PVE's native task log.

### `Upgrading.md`
- Release/version model: SemVer tags, `VERSION` file baked into tarball.
- Re-running the installer vs in-place update.
- What persists (data dir, Redis-backed sessions) vs what doesn't (in-memory sessions on restart).
- Breaking-changes policy.
- Where the changelog lives (GitHub Releases).

### `FAQ.md`
- Does it replace the stock PVE UI? (No, runs alongside.)
- Which Proxmox versions are supported?
- Can I run it without systemd?
- Does it work on a multi-node cluster? (Yes, via `/cluster/resources`.)
- HA / multiple Nexus instances? (Yes, with Redis for shared sessions.)
- Login fails with valid credentials (PAM vs PVE realm troubleshooting).
- Why can't Nexus reach PVE from inside an LXC? (Network/bridge hint.)
- Is my PVE password stored? (No — only the opaque session ticket.)

### `_Sidebar.md`
Two grouped nav sections:
- **Getting Started** — Home, Installation, Configuration, Upgrading.
- **Features** — Feature Tour, Community Scripts, Script Chains, Bulk Operations, FAQ.

### `_Footer.md`
Single line: `Nexus is MIT-licensed · Report wiki issues on the [main repo](https://github.com/Actualbug2005/Proxmox/issues)`.

### `wiki/README.md` (in-repo only, not synced)
Short explainer: this directory is the source for the GitHub Wiki; edits land via PR on `main`; the `publish-wiki.yml` workflow syncs to `.wiki.git`. Points at the live wiki URL.

## Publish workflow — `.github/workflows/publish-wiki.yml`

**Trigger:**
- `push` to `main` with `paths: ['wiki/**']`.
- `workflow_dispatch` for manual runs.

**Permissions:** `contents: write`.

**Job (single runner, `ubuntu-latest`):**
1. Checkout `main` (shallow).
2. Clone `https://github.com/Actualbug2005/Proxmox.wiki.git` into `./wiki-repo`, authenticated via `${{ secrets.WIKI_TOKEN || secrets.GITHUB_TOKEN }}`.
3. `rsync -a --delete --exclude='.git' --exclude='README.md' wiki/ wiki-repo/` — wiki repo mirrors `wiki/` exactly except: `.git/` is excluded so we never clobber the wiki's history, and `wiki/README.md` is excluded because it's an in-repo explainer, not a wiki page.
4. In `wiki-repo`: `git add -A`. If `git diff --cached --quiet` returns 0 (nothing staged), exit successfully.
5. Otherwise commit as `github-actions[bot]` with message `Sync wiki from <short-sha>` and `git push`.

**Token fallback:** `GITHUB_TOKEN` is tried first. If GitHub rejects the push (some repos require a PAT for `.wiki.git`), set `WIKI_TOKEN` (fine-grained PAT with Wiki write scope) as a repo secret and the workflow will prefer it.

**Pre-flight (one-time, manual):** The wiki must be enabled in repo Settings and have at least one page already created, because GitHub refuses to clone `.wiki.git` until the first page exists. The `Upgrading.md` and `wiki/README.md` will both note this as a setup step.

## Error handling

- Clone failure (wiki disabled / no initial page) → job fails with a log pointer to the pre-flight note in `wiki/README.md`.
- Push auth error → retry once; if it still fails, fail the job with a hint to set `WIKI_TOKEN`.
- `rsync --delete` scoped to `wiki/` only; `.git/` and `wiki/README.md` excluded.
- No-op commit detection avoids empty commits on reruns.

## Testing plan

- `workflow_dispatch` manual run once after merge to validate the sync path without waiting on a push.
- Typo test: change `wiki/Home.md`, push, confirm wiki updates within ~60 s.
- Deletion test: rename a page in `wiki/`, confirm the old page is removed from the published wiki.
- No automated tests (pure content + shell workflow). Optional local `npx markdownlint wiki/**/*.md` before commit.

## Build sequencing

1. Add `wiki/` tree + all 9 pages + `_Sidebar.md` + `_Footer.md` + `wiki/README.md`.
2. Add `.github/workflows/publish-wiki.yml`.
3. Commit to a feature branch, open PR, land via squash merge on `main`.
4. **Manual pre-flight** (one-time): enable Wiki in repo Settings → create a throwaway Home page via the UI.
5. `workflow_dispatch` the sync job; confirm Wiki tab populates.
6. Add screenshots to `wiki/images/` over time; each push auto-syncs.

## Screenshot checklist

Pages reference images by path. Drop these into `wiki/images/` to light them up. Alt text is descriptive so missing images degrade gracefully on the wiki.

- [ ] `images/dashboard.png` — Home + Feature Tour hero
- [ ] `images/command-palette.png` — Feature Tour
- [ ] `images/resource-tree.png` — Feature Tour
- [ ] `images/vm-detail.png` — Feature Tour
- [ ] `images/telemetry-chart.png` — Feature Tour
- [ ] `images/console.png` — Feature Tour
- [ ] `images/scripts-catalogue.png` — Community Scripts
- [ ] `images/scripts-detail.png` — Community Scripts
- [ ] `images/scripts-running.png` — Community Scripts
- [ ] `images/chain-editor.png` — Script Chains
- [ ] `images/chain-schedule.png` — Script Chains
- [ ] `images/bulk-progress.png` — Bulk Operations
- [ ] `images/alerts.png` — Feature Tour / FAQ

## Open questions

None at design time. Screenshot capture is deferred — the wiki ships with prose and broken-image alt text until the user supplies files, which is intentional per the chosen screenshot strategy.
