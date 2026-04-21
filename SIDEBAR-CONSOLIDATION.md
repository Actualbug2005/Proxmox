# Sidebar & Page Consolidation Review

A walk through every sidebar entry in [nexus/src/components/dashboard/sidebar.tsx](nexus/src/components/dashboard/sidebar.tsx), cross-referenced with the page files in [nexus/src/app/(app)/](nexus/src/app/(app)/), identifying pages that duplicate entry points, belong inside another page as a tab, or should become modal/drawer-launched flows instead of top-level destinations.

The current sidebar has **28 links across 3 sections**. The proposal below lands it at **~13 links across 3 sections**, with everything else reached via in-page tabs, drawers, or contextual actions.

---

## Current Sidebar Snapshot

```
Core            (8) Overview · Tasks · Console · Community Scripts · Scheduled Jobs · Script Chains · Notifications · Health
Infrastructure (11) Resources · Nodes · Virtual Machines · Containers · Storage · HA & Status · Firewall · Federation · Pools · Backups · Auto-DRS
System          (9) Users & ACL · Service Account · Audit Log · Power · Packages · Network · Certificates · Logs · Updates
```

Observations from the code:

- **Console** ([nexus/src/app/(app)/console/page.tsx](nexus/src/app/(app)/console/page.tsx)) is a multi-tab terminal launcher. It is *also* reachable from every VM and CT detail page via a `Terminal` icon button ([nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx](nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx)).
- **Resources** ([nexus/src/app/(app)/dashboard/resources/page.tsx](nexus/src/app/(app)/dashboard/resources/page.tsx)) already documents itself as a zoom-out of Nodes/VMs/CTs/Pools — its own header comment says "the per-type pages remain the place for detail work." So Resources is conceptually the top of that stack, not a peer.
- **Every page under `/dashboard/system/*`** uses `useSystemNode()` ([nexus/src/app/(app)/dashboard/system/node-context.tsx](nexus/src/app/(app)/dashboard/system/node-context.tsx)) — they are already a tab-set over the same node context, just split across nine sidebar entries.
- **Scheduled Jobs, Script Chains and Community Scripts** are three views of the same automation primitive. They each reuse `ScheduleJobEditor` / `ChainEditor` patterns and all live in `/api/scripts/*`.
- **Pools** ([nexus/src/app/(app)/dashboard/cluster/pools/page.tsx](nexus/src/app/(app)/dashboard/cluster/pools/page.tsx)) is an org-grouping primitive already surfaced as a view mode on the Resources page.
- **Auto-DRS, HA & Status, Federation** are all cluster-health / scheduling concepts. Today they're peers.
- **Service Account** ([nexus/src/app/(app)/dashboard/system/service-account/page.tsx](nexus/src/app/(app)/dashboard/system/service-account/page.tsx)) is a credential/auth concern that lives under System but reads as an Access concern.

---

## Proposed Sidebar

```
Core            Overview · Console · Health · Tasks · Automation · Notifications
Infrastructure  Resources · Storage · Cluster · Federation
System          Node Settings · Access · Audit Log · Updates
```

13 top-level items. Everything previously in the sidebar remains reachable, but through tabs, drawers, or deep-links from the owning page.

---

## Section 1 — Core

### ✅ Keep as-is

| Current | Action |
|---|---|
| Overview (`/dashboard`) | Keep. Landing page. |
| Tasks (`/dashboard/tasks`) | Keep. Cluster-wide activity stream. |
| Health (`/dashboard/health`) | Keep. NOC-style summary. |
| Notifications (`/dashboard/notifications`) | Keep. Already internally-tabbed (Destinations · Rules · Recent). |

### 🔀 Merge: Community Scripts + Scheduled Jobs + Script Chains → **Automation**

These three pages are one feature. Fold them into a single `/automation` page (or keep `/scripts` and add tabs) with a `TabBar`:

- **Library** — today's `/scripts` page
- **Scheduled** — today's `/dashboard/schedules`
- **Chains** — today's `/dashboard/chains`
- **History** (optional) — run log / jobs that today live implicitly in Tasks

The page shells are already near-identical (`/dashboard/chains/page.tsx` literally says *"Layout mirrors /dashboard/schedules so operators can switch between…"*). One roof, three tabs, deep-link support via `?tab=`.

**Removes 2 sidebar entries.**

### 🧩 Console — keep, but confirm single entry point

[nexus/src/app/(app)/console/page.tsx](nexus/src/app/(app)/console/page.tsx) is a legitimate multi-tab destination. The per-VM `Terminal` button already deep-links into it via `?node=&vmid=` ([console/page.tsx:28](nexus/src/app/(app)/console/page.tsx#L28)). No change needed — both entry points converge on the same page. Keep the sidebar link.

---

## Section 2 — Infrastructure

### 🔀 Collapse Nodes / VMs / CTs / Pools under **Resources**

[resources/page.tsx](nexus/src/app/(app)/dashboard/resources/page.tsx) already has four view modes (`flat · nodes · tags · pools`). The list pages `/dashboard/nodes`, `/dashboard/vms`, `/dashboard/cts` are redundant as sidebar destinations — Resources can surface them as sub-views.

**Proposal:** Resources becomes the single sidebar entry. Its segmented control gains a `type` axis (All · Nodes · VMs · CTs) on top of the existing `view` axis. Detail routes (`/dashboard/vms/[node]/[vmid]`, `/dashboard/cts/[node]/[vmid]`, `/dashboard/nodes`) stay — they're reached by clicking a row, same as today.

**Pools** ([pools/page.tsx](nexus/src/app/(app)/dashboard/cluster/pools/page.tsx)) becomes a *modal* opened from the Pools view mode's "Manage pools" button. Pool CRUD is rare; it doesn't earn a sidebar slot.

**Removes 4 sidebar entries** (Nodes, VMs, CTs, Pools).

### 🔀 Merge HA & Status + Auto-DRS + Backups + Firewall → **Cluster**

These four are all cluster-scoped policy surfaces. Group under one `/dashboard/cluster` page:

- **Status** — today's HA & Status (already internally tabbed: resources · groups · status)
- **DRS** — today's `/cluster/drs`
- **Backups** — today's `/cluster/backups`
- **Firewall** — today's `/cluster/firewall` (already internally tabbed)

Each becomes a top-level tab. The existing sub-tabs collapse into a second-tier `TabBar` where needed.

**Removes 3 sidebar entries** (HA & Status, Firewall, Auto-DRS, Backups become one).

### ✅ Keep: Storage, Federation

Storage is read heavily and has its own node/[storage] drill-down — it earns a slot.
Federation is cluster-scoped but has a distinct "remote clusters registry" identity that doesn't fit under a single-cluster Cluster page.

---

## Section 3 — System

### 🔀 Collapse `/dashboard/system/*` into **Node Settings**

Every page under `/dashboard/system/*` already shares `useSystemNode()` — they're already a tab-set in disguise, split across nine sidebar rows. Merge them into `/dashboard/system` with a tab bar and a node switcher in the header:

- **Power** — current `/system/power`
- **Network** — current `/system/network`
- **Certificates & Tunnels** — current `/system/certificates` (already tabbed: current · acme · tunnels)
- **Logs** — current `/system/logs`
- **Packages** — current `/system/packages`
- **Updates** — current `/system/updates` *(keep as its own sidebar entry — see below)*

**Updates** is a cross-node, policy-driven flow and the one System page that doesn't use `useSystemNode` as its primary axis. Promote it to the sidebar (or leave inside Node Settings — defensible either way).

**Removes ~6 sidebar entries.**

### 🔀 Merge Service Account into **Access**

[service-account/page.tsx](nexus/src/app/(app)/dashboard/system/service-account/page.tsx) manages a Proxmox user + token. That's an Access concern. Add it as a tab in `/dashboard/cluster/access` (which is already tabbed: Users · Groups · Roles · Realms · ACL → add **Service Account**).

**Removes 1 sidebar entry.**

### ✅ Keep: Audit Log

[cluster/audit/page.tsx](nexus/src/app/(app)/dashboard/cluster/audit/page.tsx) is a forensic read-only surface. Keep it top-level; operators look for it by name during incident response.

---

## Pages That Should Become Modals or Drawers

Not every CRUD surface earns a page. Candidates for promotion to modal/drawer:

| Today's page | Better as | Why |
|---|---|---|
| `/dashboard/cluster/pools` | Modal from Resources (Pools view mode) | Pool CRUD is infrequent; the list is the primary view. |
| `/dashboard/vms/create`, `/dashboard/cts/create` | Already modal-appropriate — verify they're routed, not layered. Consider slide-over wizard pattern to preserve underlying list context. |
| `/dashboard/system/service-account` | Tab inside Access | Not a standalone destination. |
| Federation Add/Rotate/Remove | Already modal dialogs in-page ✅ | No change — mentioned as a positive pattern to replicate. |

---

## Pages/Entries to Delete Outright

None are pure dead code — every route backs real functionality — but these **sidebar entries** go away (the underlying pages either merge into tabs on another page, or become modal-launched):

1. `/dashboard/nodes` — sidebar entry removed; route stays live (hosts per-node metrics chart + detail panel not yet in Resources)
2. `/dashboard/vms` — sidebar entry removed; route stays live (hosts per-row lifecycle actions + sort/search not yet in Resources)
3. `/dashboard/cts` — sidebar entry removed; route stays live (symmetric to VMs)
4. `/dashboard/cluster/pools` — becomes a modal
5. `/dashboard/schedules` — becomes Automation tab
6. `/dashboard/chains` — becomes Automation tab
7. `/dashboard/cluster/ha` — becomes Cluster tab
8. `/dashboard/cluster/drs` — becomes Cluster tab
9. `/dashboard/cluster/backups` — becomes Cluster tab
10. `/dashboard/cluster/firewall` — becomes Cluster tab
11. `/dashboard/system/power` — becomes Node Settings tab
12. `/dashboard/system/network` — becomes Node Settings tab
13. `/dashboard/system/certificates` — becomes Node Settings tab
14. `/dashboard/system/logs` — becomes Node Settings tab
15. `/dashboard/system/packages` — becomes Node Settings tab
16. `/dashboard/system/service-account` — becomes Access tab

**Sidebar goes from 28 → 13 entries.** No functionality is lost; everything is reachable within ≤2 clicks of a section root.

---

## Implementation Notes

- Keep all current routes live during the transition — add tab-routing via `?tab=` so existing bookmarks and deep-links (especially the console's `?node=&vmid=` pattern) keep working. Then redirect the deprecated routes once telemetry confirms no traffic.
- The `TabBar` component is already standardised ([nexus/src/components/dashboard/tab-bar.tsx](nexus/src/components/dashboard/tab-bar.tsx)) and used by Access, HA, Backups, Firewall and Notifications — re-use it for Automation, Cluster, and Node Settings.
- The Command Palette (⌘K) already covers the *"I know the page by name"* escape hatch — shrinking the sidebar makes the palette more valuable, not less.
- Node-scoped pages (System/*) need a persistent node switcher in the page header rather than relying on the implicit default-node pick; otherwise users lose context when tabbing across Power → Logs → Packages on a specific node.

---

## Summary Diff

```
- Core            8 items  →  6 items  (−2)   Automation roll-up + Notifications stays
- Infrastructure 11 items  →  4 items  (−7)   Resources roll-up + Cluster roll-up
- System          9 items  →  3 items  (−6)   Node Settings roll-up + Service Account → Access
────────────────────────────────────────
  Sidebar total:  28 items → 13 items  (−15)
```
