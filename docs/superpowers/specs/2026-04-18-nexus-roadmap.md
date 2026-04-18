# Nexus Roadmap — Tiers 5 → 9 and Backlog

**Date:** 2026-04-18
**Status:** In progress — Top-10 items #1-8 shipped (v0.10.0–v0.22.0)

**Shipped so far (8 of the Top-10):**
- ✅ **#2 — Unit picker primitive (7.2)** → `v0.10.0` (UnitInput in VM/CT create)
- ✅ **#3 — Audit Log Explorer UI (8.1)** → `v0.11.0` (`/dashboard/cluster/audit`)
- ✅ **#1 — Tag/Folder Resource View (7.1)** → `v0.12.0` (`/dashboard/resources` + Segmented toggle)
- ✅ **#4 — Notification Rule Engine (5.1)** → `v0.15.0–v0.19.0` (destinations, rules, dispatcher, poll source)
- ✅ **#5 — Auto-DRS Loop (5.3)** → `v0.20.0` (`/dashboard/cluster/drs` — off/dry-run/enabled with all 3 anti-ping-pong rails)
- ✅ **#8 — Guest-Internal Health (5.2)** → `v0.21.0` (QEMU agent probe: disk pressure + agent liveness; LXC + service-down deferred)
- ✅ **#7 — Drag-and-drop dashboards (7.4)** → `v0.22.0` (native DnD on 4-col grid, per-user JSON prefs)
- ✅ **#6 — Next-fire + run-history (7.6)** → `v0.22.0` (chip list on cron editor, persistent `run-history.jsonl` + inline last-20 table)

**Next up (from the Top-10):** #9 Remote Cluster Registry (4d, unlocks Tier 6), #10 Security hardening pass (2d).
**Source material:** session audit 2026-04-18 covering roadmap completion, feature review, and community-gap research (Proxmox forums, PDM roadmap, SDN threads, VMware-migration commentary).

This document rolls up three analyses from today's session:

1. **Completion audit** of the original "modern management overlay" brainstorm (~13/17 items shipped).
2. **Full feature review** of the current codebase with per-area improvement suggestions.
3. **Community-gap research** — what Proxmox VE and PDM users are asking for that neither Proxmox nor current-day Nexus ships.

Everything below is organized into cohesive tiers. Each item has: rationale, touchpoints in the codebase, rough effort estimate, and community-pull signal (H/M/L). Where an item depends on another, it is marked `→ depends on: X`.

Ship-order recommendations sit at the bottom in **Top-10 next ship**.

---

## Current baseline (what's already shipped — do not rebuild)

These are referenced throughout so later tiers can build on them without re-describing.

- **Auth/session** — `jose` JWT, httpOnly + `nexus_csrf` double-submit, Redis/memory stores (`src/lib/auth.ts`, `session-store.ts`, `csrf.ts`).
- **API proxy** — `api/proxmox/[...path]/route.ts` with `PveBool` codec and typed `proxmox-client.ts`.
- **Cluster-aware resource tree** + floating sidebar + command palette + bento health dashboard.
- **Bulk lifecycle** — `bulk-ops.ts`, `run-bulk-op.ts`, progress panel, cluster-wide API.
- **Smart migrate wizard** — `migration-score.ts` + `migrate-wizard.tsx` (ranked targets).
- **Clone + cloud-init** — `clone-wizard.tsx` + `cloud-init-form.tsx` + `lib/cloud-init.ts`.
- **Community Scripts** — marketplace, execution pipeline (`remote-shell.ts`, `exec-policy.ts`, `exec-audit.ts`), rate-limiter.
- **Chains** — multi-step script composition (`chains-store.ts`, `run-chain.ts`, chain editor + progress).
- **Scheduled jobs** — generic cron scheduler (`scheduler.ts`), schedule store, API, cron input, `humanCron`.
- **Health observability** — pressure summary, top offenders, storage exhaustion (days-until-full), guest trouble, recent failures, node roster.
- **Log correlation** — `journal-parse.ts`, `use-journal-window.ts`, `task-correlation-drawer.tsx`.
- **Theme system** — `next-themes` dark/light Dynamic Glass, severity tokens tuned per WCAG.
- **System tab** — power, network, certificates, updates (with in-place self-update via systemd timer), logs, packages.
- **NAS** — shares, services, file browser sheet, download route, provider registry (native).
- **Console** — xterm.js terminal + noVNC embed with active PVE 9 fix-ups.

---

## Tier 5 — Intelligence (autonomous behaviour)

**Theme:** turn Nexus from a reactive UI into an active operator. Reuses existing scorer, scheduler, audit log, and notification surface.

### 5.1 Notification Rule Engine **(foundation for 5.2–5.4)** ✅ shipped in v0.15.0–v0.19.0
- **Rationale.** PVE's notification system is CLI-first and hostile. Every alerting feature below depends on having *somewhere* to send the alert.
- **Shape.** `lib/notifications/` module: `destinations` (webhook, Discord, ntfy, email via SMTP, Slack) + `rules` (predicate over an event: `metric`, `threshold`, `duration`, `scope`) + `dispatch` (debounced, templated via logic-less Mustache-style strings — avoid full expression engines to keep injection surface small).
- **Storage.** `${NEXUS_DATA_DIR}/notifications.json` (rules) + per-destination creds encrypted at rest (reuse `exec-audit`'s crypto primitives).
- **UI.** New page `/dashboard/notifications` with two tabs (Destinations, Rules), identical pattern to `/dashboard/schedules`.
- **Touchpoints.** New: `src/lib/notifications/*`, `src/app/api/notifications/**`, `src/app/(app)/dashboard/notifications/page.tsx`, components under `src/components/notifications/`.
- **Effort.** 3–4 days. **Pull.** H.

### 5.2 Guest-Internal Health Monitoring ✅ shipped in v0.21.0 (disk pressure + agent liveness; services deferred)
- **Rationale.** Top VMware-vs-Proxmox complaint: "I can't see when a VM is running low on disk internally." PVE exposes the data via qemu-guest-agent but shows almost none of it.
- **Shape.** New `use-guest-agent.ts` hook polling `nodes/{node}/qemu/{vmid}/agent/get-fsinfo`, `get-memory-block-info`, `get-host-name`, `network-get-interfaces` for VMs with `agent=1`. LXC parity via `pct exec`.
- **Widgets.** `guest-disk-pressure`, `guest-service-health` bento widgets.
- **Integrates with 5.1.** Emits events: `guest.disk.filling`, `guest.service.down`, `guest.agent.unreachable`.
- **Touchpoints.** New: `src/hooks/use-guest-agent.ts`, `src/lib/guest-health.ts`, `src/components/widgets/guest-disk-pressure.tsx`, `src/components/widgets/guest-service-health.tsx`. Registry additions in `src/lib/widgets/register-all.ts`.
- **Effort.** 1 week. **Pull.** H. **Depends on:** 5.1.
- **Shipped scope.** `guest.disk.filling` (edge-triggered, 85% default) + `guest.agent.unreachable` (3 consecutive failures). 60s cluster-wide poll, bounded concurrency 4, in-memory snapshot, on-demand `/api/guests/[node]/[vmid]/agent` route + cluster roll-up `/api/guests/pressure`. LXC and `guest.service.down` deferred to a follow-up.

### 5.3 Auto-DRS Loop ✅ shipped in v0.20.0
- **Rationale.** The most-cited vSphere feature PDM is missing. Nexus already has a migration scorer and a cron scheduler — wiring the loop is ~3 days of work for a headline feature.
- **Shape.** New `lib/drs/` module. A scheduled tick (reuse `scheduler.ts` with a third `SchedulerSource<DrsPolicy>`) reads cluster pressure, picks the most-pressured node, runs `migration-score` for each eligible guest on it, and issues a single migration to the best target if the score delta exceeds a configurable hysteresis (default 0.2, prevents ping-pong).
- **Safety rails.**
  - Off by default.
  - Dry-run mode that only emits events ("would-have-migrated X to Y") via 5.1.
  - Per-tick cap of 1 migration (avoid cascading).
  - Blackout windows (cron expression — reuses `cron-match.ts`).
  - Per-guest opt-out via PVE tag `drs:pinned`.
- **UI.** `/dashboard/cluster/drs` — policy editor + live "next planned move" preview + last-24h action log (reads from `exec-audit`).
- **Touchpoints.** New: `src/lib/drs/policy.ts`, `src/lib/drs/planner.ts` (pure, testable), `src/app/api/cluster/drs/**`, `src/app/(app)/dashboard/cluster/drs/page.tsx`. Server: add DRS source to `server.ts` next to the chain scheduler.
- **Effort.** 3–4 days. **Pull.** Highest. **Depends on:** 5.1 for audit/notification of moves.

### 5.4 Alerting-Rule UI on Existing Pressure Widgets
- **Rationale.** Once 5.1 and 5.2 exist, the health widgets already compute everything — wire a "bell" on each widget that opens a rule pre-filled with the metric + current threshold.
- **Touchpoints.** Edit bento widgets under `src/components/widgets/` + `lib/widgets/registry.ts` to expose an optional `alertableMetrics` descriptor.
- **Effort.** 2 days. **Pull.** M. **Depends on:** 5.1, 5.2.

### 5.5 Predictive Capacity Planner
- **Rationale.** Extends existing `trend.ts` + days-until-full projection beyond storage to CPU/RAM headroom.
- **Shape.** New "Capacity" tab on `/dashboard/health` that runs linear regression on 7-day RRD windows for each node and surfaces "CPU saturation in ~X days at current growth."
- **Effort.** 2 days. **Pull.** M.

---

## Tier 6 — Federation (surpass PDM v1)

**Theme:** multi-cluster parity with Proxmox Datacenter Manager, plus the features PDM v1 lacks.

### 6.1 Remote Cluster Registry
- **Rationale.** Prerequisite for everything else in Tier 6. PDM connects to a single specific node per cluster (its documented weakness); Nexus should connect to a cluster by a list of endpoints and fail over.
- **Shape.** `lib/federation/registry.ts` — `RegisteredCluster { id, name, endpoints: URL[], authMode: 'token'|'ticket', credentials }`. Credentials encrypted at rest.
- **Health probe.** Background probe per cluster, stored quorum state + latency.
- **UI.** `/dashboard/federation` with an add-cluster wizard (paste endpoint + token, Nexus validates `GET /version` + `GET /cluster/status`).
- **Touchpoints.** New module + new API routes + new page. Proxy route `[...path]` gains a `?cluster=<id>` query param that rewrites the upstream target.
- **Effort.** 4 days. **Pull.** H (for multi-cluster users).

### 6.2 Federated Resource Tree
- **Rationale.** Once 6.1 exists, the sidebar's resource tree becomes the federation aggregator. PDM doesn't do this well.
- **Shape.** Top level = clusters; level 2 = nodes; level 3 = guests. Group filtering by tag (overlaps with 7.1).
- **Touchpoints.** `src/components/dashboard/resource-tree.tsx`, `hooks/use-cluster.ts` → new `use-federated-cluster.ts`.
- **Effort.** 3 days. **Pull.** H. **Depends on:** 6.1.

### 6.3 Cross-Cluster Console Federation
- **Rationale.** PDM cannot open consoles into remote-cluster guests. Nexus already proxies VNC/WS (`api/proxmox-ws`) and tunnels (`api/tunnels/status`). Extending the tunnel to pick a cluster target is a small addition.
- **Touchpoints.** `src/app/api/proxmox-ws/route.ts`, `src/components/console/*`, tunnel status route.
- **Effort.** 3 days. **Pull.** H. **Depends on:** 6.1.

### 6.4 Cross-Cluster Migration
- **Rationale.** PDM's flagship feature. Nexus can match by wrapping `qm remote-migrate` / `pct remote-migrate`.
- **Safety.** This is the single most destructive operation; design for dry-run + explicit confirm-phrase input.
- **Touchpoints.** `migrate-wizard.tsx` gets a second mode. New API route `/api/federation/migrate`.
- **Effort.** 1 week. **Pull.** H. **Depends on:** 6.1.

### 6.5 Nexus HA Pair
- **Rationale.** PDM is itself a SPOF — users complain. Nexus can ship a documented two-LXC HA recipe with shared Redis session store (already supported) and a simple DNS-based failover.
- **Deliverable.** Doc + `install.sh --ha-peer=<ip>` + a health endpoint at `/api/health` for upstream load-balancers.
- **Effort.** 2 days. **Pull.** M.

---

## Tier 7 — UX polish

**Theme:** forum-cited frictions that are cheap individually and compound into a much nicer product.

### 7.1 Tag / Folder Resource View ✅ shipped in v0.12.0
- **Rationale.** Bugzilla #4441 ("Tag View") has a prototype upstream but isn't shipped. Forum users keep asking. PVE tags API already exists; client-side grouping is 4h of work.
- **Shape.** New segmented toggle on resource-tree header: `Flat | Nodes | Tags | Pools`. In `Tags` mode, guests group under each of their tag strings (multi-membership allowed); untagged fall into "Untagged". Color chips use PVE's `tag-style-override` palette when present.
- **Touchpoints.** `src/components/dashboard/resource-tree.tsx` only. Tag writes happen via existing PVE config endpoints — no backend changes.
- **Effort.** 4 hours. **Pull.** H.

### 7.2 Unit Picker for Memory / Disk Fields ✅ shipped in v0.10.0
- **Rationale.** Longstanding forum request. Low-effort, high-delight.
- **Shape.** New primitive `src/components/ui/unit-input.tsx` with `unit ∈ {MiB, GiB, TiB}` and coerce-on-submit. Reused in VM create, CT create, disk resize dialogs, storage mapping.
- **Effort.** 2 hours. **Pull.** M.

### 7.3 Mobile "Triage" Layout
- **Rationale.** PVE's mobile experience is read-only-ish. Nexus already has a bento grid that stacks on mobile, but a dedicated "triage" view (reboot stuck VM, read backup status, open VNC) needs explicit design.
- **Shape.** Responsive `<640px` layout that replaces the sidebar with a bottom tab bar and the bento with a card stack sorted by severity.
- **Touchpoints.** `src/app/(app)/layout.tsx`, new components under `src/components/dashboard/mobile/`, CSS container queries in `globals.css`.
- **Effort.** 1 week. **Pull.** M.

### 7.4 Drag-and-Drop Widget Customisation ✅ shipped in v0.22.0
- **Rationale.** Widget registry + presets already exist; only the interaction layer is missing.
- **Shape.** Add `react-grid-layout` (or equivalent lightweight DnD) to `bento-grid.tsx`, persist per-user layout to `${NEXUS_DATA_DIR}/user-prefs/{userid}.json`. Preset switcher remains for quick resets.
- **Effort.** 1 day. **Pull.** M.
- **Shipped scope.** Native HTML5 DnD on the existing 4-col grid (no `react-grid-layout` dep — ~100 LOC); per-user JSON at `${NEXUS_DATA_DIR}/user-prefs/<username>.json`, one override per preset id. Explicit Edit / Reset buttons on the dashboard header.

### 7.5 Command Palette Enhancements
- **Rationale.** CMD+K exists but is action-only. Forum users want quick-jump search.
- **Add:** fuzzy guest search, recent-pages, "run script X on node Y" quick-exec, schedule search.
- **Touchpoints.** `src/components/dashboard/command-palette.tsx`.
- **Effort.** 1 day. **Pull.** M.

### 7.6 Next-Fire Preview + Run History on Schedules ✅ shipped in v0.22.0
- **Rationale.** Current `cron-input.tsx` is textual; users frequently miscount a cron. Proxmox's own schedule editor shows the next few fires. Run-history is absent entirely.
- **Shape.** `cron-input` gains a "Next 5 fires" chip list. Schedule detail drawer shows last-20-runs with stdout/stderr/exit-code.
- **Touchpoints.** `src/components/dashboard/cron-input.tsx`, `src/components/script-jobs/JobDrawer.tsx`, new per-schedule history endpoint.
- **Effort.** 2 days. **Pull.** M.
- **Shipped scope.** `nextFires()` helper added to `cron-match.ts` + chip list on the cron builder. Persistent `run-history.jsonl` (rotating at 2 MB, keyed by `source:sourceId`) appended by the scheduler after every fire; `/api/scripts/schedules/[id]/runs`; inline last-20 table on each row of `/dashboard/schedules`. Chain-scheduler opted into the same store — future chain-detail drawer inherits history for free.

### 7.7 Resource-Tree Virtualisation
- **Rationale.** 100+ guests cause DOM lag.
- **Add:** `@tanstack/react-virtual` to `resource-tree.tsx`.
- **Effort.** 4 hours. **Pull.** L (small clusters unaffected) / H (large clusters).

### 7.8 Display-Name Overlay
- **Rationale.** PVE refuses to allow spaces/special chars in guest names because they're hostnames. Nexus can show a user-friendly name stored in the `displayname=<value>` tag.
- **Touchpoints.** Wherever guest name is rendered — probably a `useGuestDisplayName` hook + tag write UI.
- **Effort.** 4 hours. **Pull.** M.

---

## Tier 8 — Security & hardening

**Theme:** close the gap between "secure enough" and "defensible under audit."

### 8.1 Audit Log Explorer UI ✅ shipped in v0.11.0
- **Rationale.** Backend and decrypt script already exist (`exec-audit.ts`, `scripts/nexus-audit-decrypt.ts`). UI is missing.
- **Shape.** `/dashboard/cluster/audit` with filter by user, action, time, scope. Decrypts in a server-only route that streams decrypted rows to the browser (keys never leave the server).
- **Effort.** 2 days. **Pull.** H (for regulated environments).

### 8.2 WebAuthn / Passkey Layer
- **Rationale.** Strongest available second factor. Layer on top of PVE credentials, do not replace them.
- **Shape.** After successful PVE auth, present WebAuthn challenge. Enforce per-realm or per-role policy. Persist credentials in encrypted-at-rest store keyed by PVE userid.
- **Library.** `@simplewebauthn/server` + `@simplewebauthn/browser` (well-audited, secure-by-default).
- **Effort.** 1 week. **Pull.** H.

### 8.3 Proxy SSRF Guard & Security Headers
- **Rationale.** The `/api/proxmox/[...path]` route forwards arbitrary paths; regression risk is real.
- **Deliverables.**
  - Path allowlist (`/api2/json/…` only).
  - URL validation — no scheme injection via encoded characters.
  - CSP, HSTS, X-Content-Type-Options, Referrer-Policy headers in `server.ts` (Helmet-equivalent; we don't need the full dep, five headers is enough).
  - Verify `react-markdown` has no `rehype-raw` (confirm no HTML injection vector).
  - Audit `cron-match.ts` regexes with `safe-regex` for catastrophic backtracking.
- **Effort.** 2 days. **Pull.** L (invisible) / H (trust).

### 8.4 Granular Nexus-Only Roles
- **Rationale.** Users repeatedly ask for "scripts-only" or "console-only" users without granting full Datacenter access in PVE. PVE's ACL system is node+path based and doesn't model "scripts only."
- **Shape.** Overlay ACL in `permissions.ts` that restricts which Nexus *pages and APIs* are reachable per-role, while PVE itself still enforces PVE-side privileges. Role list configurable in `/dashboard/cluster/access/nexus-roles`.
- **Effort.** 4 days. **Pull.** H.

### 8.5 Scheduled-Job Env Encryption
- **Rationale.** `scheduled-jobs.json` stores env vars (may contain tokens). Audit log is encrypted; schedules aren't.
- **Fix.** Reuse `exec-audit`'s crypto primitives to encrypt env values on write, decrypt on scheduler fire.
- **Effort.** 4 hours. **Pull.** L (invisible) / H (principle of least privilege).

### 8.6 Session-Management UI
- **Rationale.** Users want to see and revoke their active sessions.
- **Shape.** `/dashboard/cluster/access` → new tab "Sessions" listing active session IDs (last-seen IP, UA), with revoke.
- **Effort.** 1 day. **Pull.** M.

---

## Tier 9 — Ecosystem

**Theme:** turn Nexus from a UI into a platform. Biggest long-term moat.

### 9.1 Local Script Library ("My Scripts")
- **Rationale.** Top-community-ask after automation. Scripts tab currently only surfaces upstream `tteck` catalog.
- **Shape.** Upload `.sh` to `${NEXUS_DATA_DIR}/user-scripts/{userid}/`, surfaced as a new "My Scripts" tab under `/scripts`. Same execution pipeline (`exec-policy.ts` gains a `local` source).
- **Effort.** 3 days. **Pull.** H.

### 9.2 Webhook-Based Plugin System
- **Rationale.** PVE forum keeps asking for a plugin API. Nexus can ship one ahead of PVE.
- **Shape.** Plugins register declaratively (`plugin.yaml`): a list of events to subscribe to (same event stream as 5.1), plus a webhook URL that receives a signed payload. Plugins can also publish a bento widget via iframe sandbox + postMessage contract.
- **Effort.** 1 week. **Pull.** M now / H long-term.

### 9.3 PBS Companion Widgets
- **Rationale.** Community is disappointed Veeam has no Proxmox story. If PBS is configured, Nexus can make it feel first-class with dedupe ratio, GC stats, chunk count, last-verify status.
- **Touchpoints.** New widgets, new `lib/pbs/client.ts` (reuses proxy cookie chain).
- **Effort.** 2 days. **Pull.** H.

### 9.4 SR-IOV / CPU-Pinning / Hugepages UI
- **Rationale.** Power-user features that are CLI-only today. Differentiator for homelab hardware tuners.
- **Effort.** 1 week. **Pull.** M.

### 9.5 FRR / BGP Fabric Wizard
- **Rationale.** Forum users say BGP+pfSense integration has no good guide and AI answers are wrong. A guided wizard is a huge moat.
- **Effort.** 1 week+. **Pull.** M (deep niche).

### 9.6 Log Search Engine
- **Rationale.** Journal viewer supports time-correlation but not full-text search with highlighting.
- **Shape.** Add ripgrep-style server-side search over a rolling journal window; stream matches via SSE.
- **Effort.** 3 days. **Pull.** M.

### 9.7 Backup Restore-Test Automation
- **Rationale.** "Untested backups are schrödinger's backups" — popular ops meme for a reason.
- **Shape.** Weekly scheduled job: restore latest backup to a sandbox VMID, boot, wait for heartbeat, destroy. Records pass/fail timeline. Depends on 5.1 for failure notifications.
- **Effort.** 3 days. **Pull.** M.

---

## Backlog (not yet tiered — revisit after Tier 5)

From the full feature review:

### Proxy & client
- Request coalescing (dedupe identical GETs in a ≤500ms window).
- ETag / `If-None-Match` on `/cluster/resources`.
- Circuit breaker when PVE is overloaded.
- Per-tunnel metrics surfaced in system tab.

### Resource management
- Resource tree virtualisation → already Tier 7.7.
- VM reset pre-check (guest-agent ping before unconditional `reset`).
- Storage-content table pagination.
- SMART attribute history plotting.
- Clone: linked vs full preview with delta.
- Migration dry-run preview button.
- Bulk clone with cloud-init templating (`{{index}}`, `{{hostname}}`).

### Cluster
- HA fence-event timeline from `/cluster/ha/status`.
- Global quorum warning banner.
- Firewall: rule search/filter, "test packet" simulator, rule diff view.
- Access: effective-permissions inspector, ACL template library, role-diff view.
- Backups: size-trend per guest, PBS integration already in 9.3.

### Scripts / chains
- Conditional chain steps (`runIfPreviousSucceeded`, tag-based skip).
- Shared env between chain steps.
- Visual DAG when chain >3 steps.
- SSE output streaming (replaces polling for all jobs).
- Script source pinning by SHA — detect upstream drift.

### Scheduler
- Overlap policy (skip/queue/kill-prev).
- Per-job timezone selector.

### Observability
- Alerting rules engine — now Tier 5.1.
- Historical bento scrub ("what did it look like at 03:47?").

### System
- Apt changelog surfacing before Apply.
- Network-change rollback-on-disconnect (90s reversion).
- Cluster-wide certificate expiry widget.
- Self-update signature verification.

### Console
- Session recording (asciinema-style).
- VNC clipboard passthrough.
- Keyboard layout selector.

### NAS
- Upload via file browser.
- Per-share permission editor with quotas.
- Additional providers (TrueNAS, Synology).

### Cross-cutting
- `withSession` / `withCsrf` HOFs to deduplicate route boilerplate.
- Playwright e2e suite for wizards.
- Service-worker offline shell.
- Bundle audit (recharts / cmdk / xterm / noVNC are heavy).
- `staleTime` centralisation in `POLL_INTERVALS`.
- Keyboard-only a11y audit.
- Chart-animation `prefers-reduced-motion` wiring.
- High-contrast theme variant.

---

## Deferred — out of scope for Nexus

Items where the correct fix is in Proxmox or PBS itself:

- SDN performance regression (VXLAN throughput collapse) — kernel/driver level.
- PVE SDN breaking-change UX — upstream bug.
- PBS native Veeam integration — vendor-owned.
- Python/Rust rewrite of PVE backend — upstream architectural.
- Multitenancy at the PVE API level — upstream.

Nexus surfaces or mitigates where possible (warning banners, rollback wrappers, PBS companion widgets), but does not attempt to fix.

---

## Top-10 next ship (cut across tiers by impact × effort)

Ordered by recommended sequencing, not strict priority:

| # | Item | Tier | Effort | Pull | Status | Why this slot |
|---|------|------|--------|------|--------|---------------|
| 1 | **Tag/Folder Resource View** (7.1) | 7 | 4h | H | ✅ v0.12.0 | Cheapest H-pull win in the plan. |
| 2 | **Unit picker primitive** (7.2) | 7 | 2h | M | ✅ v0.10.0 | Ships alongside #1, tiny reusable primitive. |
| 3 | **Audit Log Explorer UI** (8.1) | 8 | 2d | H | ✅ v0.11.0 | Backend already done; pure UI. |
| 4 | **Notification Rule Engine** (5.1) | 5 | 3–4d | H | ✅ v0.15.0–v0.19.0 | Foundation for 5.2–5.4, 9.7. Must land first in Tier 5. |
| 5 | **Auto-DRS Loop** (5.3) | 5 | 3–4d | Highest | ✅ v0.20.0 | Single biggest community-pull feature; scorer already exists. |
| 6 | **Next-fire + run-history on schedules** (7.6) | 7 | 2d | M | ✅ v0.22.0 | Hugely improves existing scheduled-jobs UX. |
| 7 | **Drag-and-drop widget layout** (7.4) | 7 | 1d | M | ✅ v0.22.0 | Registry is ready; 1-day ship. |
| 8 | **Guest-Internal Health Monitoring** (5.2) | 5 | 1w | H | ✅ v0.21.0 (disk + agent; services deferred) | Completes the "intelligence" loop with 5.1 + 5.3. |
| 9 | **Remote Cluster Registry** (6.1) | 6 | 4d | H | pending | Unlocks all of Tier 6. |
| 10 | **Security hardening pass** (8.3) | 8 | 2d | L/H | pending | Bundle SSRF guard + CSP headers + safe-regex audit as one PR. |

After #10, re-evaluate. The federation track (6.2–6.4) is the likely Tier-6 sprint; WebAuthn (8.2) and Granular Nexus Roles (8.4) are the Tier-8 sprint; local scripts (9.1) and PBS widgets (9.3) are the Tier-9 kickoff.

---

## Dependency graph (high-level)

```
5.1 Notifications ──┬─> 5.2 Guest Health ─> 5.4 Alert-Rule UI
                    ├─> 5.3 Auto-DRS
                    └─> 9.7 Restore-test Automation

6.1 Cluster Registry ─> 6.2 Federated Tree
                   ├─> 6.3 Cross-cluster Console
                   └─> 6.4 Cross-cluster Migrate

8.1 Audit UI        (independent — backend done)
8.2 WebAuthn        (independent)
8.3 Hardening pass  (independent)
8.4 Nexus Roles     ──> 8.6 Session UI (soft dep, shared ACL surface)

9.2 Plugin system   ──> depends on 5.1 event stream
```

---

## Open questions (park for later)

- **Plugin sandbox model.** Iframe + postMessage is safe but limits widget power. WASM-in-worker is richer but heavier. Decide at 9.2 design time.
- **Per-user bento layouts** (7.4) vs **shared dashboards** — may want both eventually.
- **DRS across clusters.** Once 6.1 + 5.3 ship, the combination is obvious but non-trivial (cross-cluster live migrate is still experimental upstream). Not in this roadmap.
- **Offline-first shell.** Worth prototyping service worker once bundle audit finishes.
