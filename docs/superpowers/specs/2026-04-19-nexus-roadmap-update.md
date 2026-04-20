# Nexus Roadmap Update — 2026-04-19

**Status:** Supersedes `2026-04-18-nexus-roadmap.md`. Same tier structure; updated ship state verified by grepping the codebase.

**Scope check methodology:** every roadmap item reviewed against the current tree — either the relevant symbol exists and works, or it doesn't. When both, flagged partial with the specific remaining gap.

## What changed since 2026-04-18

### Confirmed shipped since the prior roadmap (verified in tree)

- **Tier 5**
  - 5.1 Notification Rule Engine — v0.13.0–v0.19.0, plus **v0.27.3** (resolved flag wired through dispatch) and **v0.28.0** (per-rule `resolveMessageTemplate` + `{{firingFor}}`).
  - 5.2 Guest-Internal Health — v0.21.0 (disk-pressure + agent-liveness; services-level still deferred).
  - 5.3 Auto-DRS Loop — v0.20.0 (planner + dry-run shipped). **v0.27.0 unblocked live operation** via the service-account session.
- **Tier 7**
  - 7.1 Tag / Folder Resource View — v0.12.0.
  - 7.2 Unit Picker primitive — v0.10.0; extended to edit drawers (v0.25.2) and disk-management dialogs (v0.26.0).
  - 7.4 DnD Widget Customisation — v0.22.0 + v0.23.1 fix.
  - 7.6 Next-Fire + Run History — v0.22.0.
- **Tier 8**
  - 8.1 Audit Log Explorer UI — v0.11.0.
  - 8.3 SSRF Guard + Security Headers — shipped. Full CSP (with scoped allow-lists for jsDelivr + raw.githubusercontent), HSTS 1y + includeSubDomains, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy all in `nexus/next.config.ts`. SSRF allow-listing in the proxy route. **Formerly listed as partial; verified complete.**

### Phase C.2 — NEW, not in the original roadmap

- **v0.27.0** — service-account session seeding: PVE API-token credential store (encrypted), settings page at `/dashboard/system/service-account`, dismissible dashboard banner, ticker wiring. Unblocks DRS, notifications poll, guest-agent probes, and auto-updates on fresh installs.
- **v0.27.1** — probe error-message unwrap (surfaces undici `err.cause` chains).
- **v0.27.2** — switch `pveFetchWithToken` to `undici.fetch` (dodges Node 22.x global-fetch `dispatcher` regression).

### Disk management — NEW, not in the original roadmap

- **v0.26.0** — resize / add / remove (detach-or-delete) for VM disks, CT rootfs, CT mountpoints. New `DisksSection` component, three dialogs, pure-parser library.
- **v0.28.1** — resize success hints now render via the existing `useToast` primitive (completed a TODO from v0.26.0).

### Tier 7.5 Command Palette — partial credit

- **v0.25.1** — palette nav-search fixed (was always hiding the Navigation group); CT console action added. Fuzzy search was always there (via `cmdk`). **Still missing:** recent-pages list, quick-exec shortcuts, schedule search.
- **v0.29.0** — Service Account entry added to the Navigation group so `CMD+K` finds it.

### Service-account discoverability — NEW, not in the original roadmap

- **v0.29.0** — added permanent sidebar entry in the `System` section + command-palette entry for `/dashboard/system/service-account`. Closes the UX trap where dismissing the setup banner left no other path to the setup page. Regression guard in `sidebar.test.ts`.

### Guest-agent services probes — v0.30.0 (closes 5.2)

- **v0.30.0** — `systemctl list-units --state=failed` probe at 1/3 of the disk-pressure cadence. Emits `guest.service.failed` events (edge-triggered, resolve-aware via `__resolve: true`). On-demand via the existing `/api/guests/[node]/[vmid]/agent` route. Surface: new `<GuestAgentCard>` on the VM detail page showing reachability, filesystems, and failed services with per-unit descriptions + "since" timestamps.

### Alert-rule UI on pressure widgets — v0.31.0 (closes 5.4)

- **v0.31.0** — bell-icon affordance on VM-page CPU / Memory / Disk metric cards + `GuestAgentCard` failed-services section. Clicking the bell opens a pre-filled rule editor; saving lands the rule in the existing `/dashboard/notifications` surface. New per-guest metrics (`guest.cpu`, `guest.mem`) emitted by the poll source with `scope: guest:<vmid>`. Rule matcher got a boundary-aware `scopeMatches` helper so numeric vmids don't silently collide (`guest:100` no longer matches `guest:1000`). Primitives (`AlertBell`, `AlertRuleModal`, `useRuleCount`, `countMatchingRules`) are reusable — cluster-wide and node-detail bells are deferred follow-ups.

### Tier 9 — **zero items shipped.** Verified: no PBS module, no local script library, no plugin system, no log search, no SR-IOV UI, no FRR wizard, no restore-test automation.

---

## Current state of every original backlog item

### Tier 5 — Intelligence

| # | Item | Status | Notes |
|---|---|---|---|
| 5.1 | Notification Rule Engine | ✅ Done + extended in v0.27.3 + v0.28.0 | |
| 5.2 | Guest-Internal Health | ✅ Done + services probes in v0.30.0 | Disk-pressure + agent-liveness (v0.21.0) + systemd failed-unit probes (v0.30.0) at 1/3 cadence with edge-triggered `guest.service.failed` events and a VM-page `GuestAgentCard` surface. |
| 5.3 | Auto-DRS Loop | ✅ Done + live-unblocked in v0.27.0 | |
| 5.4 | Alerting-Rule UI on pressure widgets | ✅ Done in v0.31.0 | Bell icon on VM page CPU / Memory / Disk cards + GuestAgentCard failed-services section opens a pre-filled rule editor. Per-guest `guest.cpu` / `guest.mem` metrics emitted by the poll source; rule-matcher got a boundary-aware `scopeMatches` so `guest:100` no longer silently matches `guest:1000`. Reusable `AlertBell` + `AlertRuleModal` + `useRuleCount` primitives for future surfaces (cluster-wide + node-detail bells deferred). |
| 5.5 | Predictive Capacity Planner | ◯ Not started | `trend.ts` exists for storage only. Extend to CPU/RAM. |

### Tier 6 — Federation

| # | Item | Status |
|---|---|---|
| 6.1 | Remote Cluster Registry | ◯ Not started |
| 6.2 | Federated Resource Tree | ◯ Not started (blocked on 6.1) |
| 6.3 | Cross-Cluster Console Federation | ◯ Not started (blocked on 6.1) |
| 6.4 | Cross-Cluster Migration | ◯ Not started (blocked on 6.1) |
| 6.5 | Nexus HA Pair | ◯ Not started |

### Tier 7 — UX polish

| # | Item | Status | Notes |
|---|---|---|---|
| 7.1 | Tag / Folder Resource View | ✅ Done | |
| 7.2 | Unit Picker | ✅ Done | |
| 7.3 | Mobile Triage Layout | ◯ Not started | `app-shell.tsx` has `lg:` breakpoints but no triage-specific layout. |
| 7.4 | DnD Widget Customisation | ✅ Done | |
| 7.5 | Command Palette enhancements | ◐ Partial | Fuzzy (cmdk) ✓, CT console ✓, nav search fix ✓. Recent-pages, quick-exec, schedule search still pending. |
| 7.6 | Next-fire + run-history | ✅ Done | |
| 7.7 | Resource-Tree Virtualisation | ◯ Not started | No `react-virtual` / `useVirtualizer` anywhere in the tree. |
| 7.8 | Display-Name Overlay | ◯ Not started | No `displayname` parsing. |

### Tier 8 — Security & hardening

| # | Item | Status | Notes |
|---|---|---|---|
| 8.1 | Audit Log Explorer UI | ✅ Done | |
| 8.2 | WebAuthn / Passkey | ◯ Not started | No SimpleWebAuthn / authenticator code. |
| 8.3 | SSRF Guard + Security Headers | ✅ Done | Verified in `nexus/next.config.ts` + proxy route. |
| 8.4 | Granular Nexus-Only Roles | ◯ Not started | `permissions.ts` is PVE-ACL plumbing only. |
| 8.5 | Scheduled-Job Env Encryption | ◯ Not started | Destinations + service-account are encrypted; scheduled-job env is not. |
| 8.6 | Session-Management UI | ◯ Not started | `/api/auth/session` exists; no list/revoke UI. |

### Tier 9 — Ecosystem

| # | Item | Status |
|---|---|---|
| 9.1 | Local Script Library ("My Scripts") | ◯ Not started |
| 9.2 | Webhook-Based Plugin System | ◯ Not started |
| 9.3 | PBS Companion Widgets | ◯ Not started |
| 9.4 | SR-IOV / CPU-Pinning / Hugepages UI | ◯ Not started |
| 9.5 | FRR / BGP Fabric Wizard | ◯ Not started |
| 9.6 | Log Search Engine | ◯ Not started |
| 9.7 | Backup Restore-Test Automation | ◯ Not started (depends on 5.1) |

---

## Backlog — current state of every untiered item

### Proxy & client

| Item | Status |
|---|---|
| Request coalescing (≤500ms window) | ◯ Not started |
| ETag / If-None-Match on `/cluster/resources` | ◯ Not started |
| Circuit breaker when PVE is overloaded | ◯ Not started |
| Per-tunnel metrics surfaced in system tab | ◯ Not started (tunnels status widget exists; no per-tunnel metrics) |

### Resource management

| Item | Status |
|---|---|
| VM reset pre-check (guest-agent ping) | ◯ Not started |
| Storage-content table pagination | ◯ Not started (`storage-content-table.tsx` loads unpaginated) |
| SMART attribute history plotting | ◐ **Partial.** `physical-disks-table.tsx` + `smart-details.tsx` show current SMART values. **No historical plot** — no recharts in these files. |
| Clone: linked-vs-full preview with delta | ◯ Not started (clone-wizard exists, no preview delta) |
| Migration dry-run preview | ◯ Not started (`migratePrecondition` exists but no dry-run button in the wizard) |
| Bulk clone with cloud-init templating (`{{index}}`, `{{hostname}}`) | ◯ Not started |

### Cluster

| Item | Status |
|---|---|
| HA fence-event timeline | ◯ Not started (HA panel exists; no fence timeline) |
| Global quorum warning banner | ◯ Not started |
| Firewall: rule search / test-packet simulator / rule diff | ◯ Not started |
| Access: effective-permissions inspector / ACL templates / role-diff | ◯ Not started |
| Backups: size-trend per guest | ◯ Not started |

### Scripts / chains

| Item | Status |
|---|---|
| Conditional chain steps (`runIfPreviousSucceeded`, tag-based skip) | ◯ Not started |
| Shared env between chain steps | ◯ Not started |
| Visual DAG for chains >3 steps | ◯ Not started |
| SSE output streaming | ◯ Not started |
| Script source pinning by SHA (drift detection) | ◯ Not started |
| **`scripts/page.tsx` split (Phase G)** | ◐ **Partial.** Extracted files exist (`script-picker.tsx`, `schedule-job-editor.tsx`, `chain-progress-panel.tsx`, `script-logo.tsx`) but the page itself is still **883 lines.** Further extraction worthwhile. |
| **Lazy-load recharts (Phase G)** | ◯ **Not started** — no `lazy()` / `dynamic()` wrapping recharts anywhere. |

### Scheduler

| Item | Status |
|---|---|
| Overlap policy (skip / queue / kill-previous) | ◯ Not started |
| Per-job timezone selector | ◯ Not started |

### Observability

| Item | Status |
|---|---|
| Historical bento scrub | ◯ Not started |

### System

| Item | Status |
|---|---|
| Apt changelog surfacing before Apply | ◯ Not started |
| Network-change rollback-on-disconnect (90s reversion) | ◯ Not started |
| Cluster-wide certificate expiry widget | ◯ Not started |
| Self-update signature verification | ◯ Not started |

### Console

| Item | Status |
|---|---|
| Session recording (asciinema-style) | ◯ Not started |
| VNC clipboard passthrough | ◯ Not started |
| Keyboard layout selector | ◯ Not started |

### NAS

| Item | Status |
|---|---|
| Upload via file browser | ✅ **Done in v0.24.0.** |
| Per-share permission editor with quotas | ✅ **Done in v0.24.0.** |
| Additional providers (TrueNAS, Synology) | ◯ Not started |
| Bind-mount NAS share into LXC | ✅ **Done in v0.24.0** (bonus — wasn't in original backlog). |

### Cross-cutting / platform

| Item | Status |
|---|---|
| Playwright e2e suite for wizards | ◯ Not started |
| Service-worker offline shell | ◯ Not started |
| Bundle audit (recharts / cmdk / xterm / noVNC) | ◯ Not started |
| `staleTime` centralisation in POLL_INTERVALS | ◯ Not started — `POLL_INTERVALS` centralises `refetchInterval` only; `staleTime` still ad-hoc across 15 files. |
| Keyboard-only a11y audit | ◯ Not started |
| Chart-animation `prefers-reduced-motion` | ◯ Not started |
| High-contrast theme variant | ◯ Not started |
| `withSession` / `withCsrf` HOFs | ✅ Done (Phase E/Tier 4). |

### Disk management — NEW backlog items from v0.26.0 deferrals

| Item | Status |
|---|---|
| Move disk / move volume to different storage | ◯ Deferred during v0.26.0 brainstorm |
| Reassign bus / change bus | ◯ Deferred |
| Typed-confirmation gate on Delete | ◯ Deferred (radio-gate is the current barrier) |
| Add-disk advanced options (IO thread, cache mode, SSD emulation) | ◯ Deferred |

### Service-account — NEW backlog items from v0.27.0 deferrals

| Item | Status |
|---|---|
| Username/password service account fallback | ◯ Explicit non-goal (API tokens chosen) |
| Auto-grant ACLs from operator session | ◯ Explicit non-goal (operator runs `pveum`) |
| Token rotation reminders / expiry tracking | ◯ Not started |
| Per-feature permission enumeration on settings page | ◯ Not started |
| Install-script integration for first-boot token setup | ◯ Not started |
| Multi-cluster service accounts | ◯ Not started (blocked on 6.1) |

### Notifications — NEW backlog items

| Item | Status |
|---|---|
| Custom resolve templates per-transport | ◯ Explicit non-goal (in v0.28.0 we chose per-rule; per-transport was rejected) |
| Rule templates / catalog (one-click "storage >80%" starter kit) | ◯ Not started |
| Destination test button per-transport | ? To verify |
| Rule-fire dry-run / what-if simulator | ◯ Not started |
| Audit log retention UI | ◯ Not started — log grows unbounded |

### Automation improvements — NEW

| Item | Status |
|---|---|
| DRS fan-out migration (parallel moves per tick, per-node concurrency cap) | ◯ Not started |

---

## Revised Top-10 (ordered)

Replaces the original Top-10 (all 10 of which are resolved or superseded).

1. **6.1 Remote Cluster Registry** — 4d, H. Biggest pull. Unlocks 6.2/6.3/6.4 + sets the shape for 6.5.
2. **Move Disk / Move Volume** — 1d, M. Second-most-requested action on the Disks surface; slots into existing UI.
3. **8.6 Session-Management UI** — 1d, M. List/revoke Nexus sessions; backend mostly exists.
4. **8.5 Scheduled-Job Env Encryption** — 1d, M. Last unencrypted-at-rest surface on disk.
5. **5.4 Alert-Rule UI on pressure widgets** — 2d, M. Close the 5.x loop; bell-icon → prefilled rule.
6. **9.3 PBS Companion Widgets** — 2d, H for homelabbers. Dedupe/GC/chunks/verify cards.
7. **7.3 Mobile Triage Layout** — 2d, M. On-call pain point.
8. **7.8 Display-Name Overlay** — 4h, M. Cheap + universally useful.
9. **8.4 Granular Nexus-Only Roles** — 3d, H. Unlocks safer multi-operator installs.
10. **9.7 Backup Restore-Test Automation** — 2d, H. Compounds the 5.1 alerting work; biggest safety improvement in the ecosystem tier.

## Quick-win candidates (≤ 1 day each)

For sessions where a full Top-10 item feels too long:

- **Global quorum warning banner** — safety-critical, trivial.
- **VM reset pre-check** (guest-agent ping) — easy foot-gun saved.
- **Storage-content pagination** — helps big storage pools.
- **Apt changelog surfacing** — complements v0.23.0 auto-update.
- **Cluster-wide certificate expiry widget** — slots into existing bento.
- **Self-update signature verification** — supply-chain hardening.
- **Script source pinning by SHA** — drift detection for community scripts.
- **`scripts/page.tsx` split finish + lazy-load recharts** — Phase G had two sub-tasks; only the extraction partially shipped. The lazy-load is a 2-hour change with measurable bundle-size win.
- **`staleTime` centralisation in POLL_INTERVALS** — touch 15 files but mechanical.
- **Notification destination "Send test" button** — verify current state first; if missing, ≤ half a day.
- **Audit log retention UI** — an operator ask waiting to happen.

## Deferred-to-upstream (unchanged)

SDN perf regression, SDN UX breaking changes, native Veeam, PVE architecture rewrite, true PVE multitenancy. Nexus surfaces/mitigates where possible, doesn't attempt to fix upstream.

## Dependencies (updated)

- 5.4 → needs nothing (5.1 ✓, 5.2 partial but sufficient).
- 6.2 / 6.3 / 6.4 → all depend on 6.1.
- 6.5 → depends on 6.1 session-sharing model.
- 9.2 → depends on 5.1 event-bus.
- 9.7 → depends on 5.1.
- 8.4 + 8.6 share session/ACL surface; consider building together.
- Multi-cluster service accounts → blocked on 6.1.

## Methodology notes for future roadmap audits

This update was produced after discovering two items the previous session declared "deferred" were already shipped (toast primitive, per-rule resolve policy). To avoid that class of error:

1. **Grep before declaring.** Every roadmap item evaluated against actual tree state, not memory of what was done.
2. **Cite location for confirmed-shipped.** Either the symbol's path or the commit SHA.
3. **Cite evidence for not-started.** A negative grep result ("no files found for `foo`") is the standard.
4. **Accept "partial" explicitly.** Many items shipped halfway. Flag the specific remaining gap.
