# Plan: Intelligent Migration Wizard (Tier 5 — Automation, Phase C)

**Goal:** On any VM or CT detail page, click "Migrate" → a wizard that calls PVE's precondition endpoint, scores every eligible target node against the guest's resource needs + current cluster pressure, and surfaces a ranked list. User confirms → migration fires and tracks through the existing UPID polling.

**Strategy:** Every primitive the wizard needs already exists somewhere — cluster.resources + nodes.rrd + vms.migrate + task polling + Badge + modal shell + step-indicator UI from the VM create wizard. The new code is: two thin API wrappers (precondition + per-VM privilege), one pure scoring function, and the wizard assembly. The existing inline MigrateDialog on VM/CT detail pages is the feature's integration point — we replace it.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs (use these, do not invent alternatives)

| Capability | Symbol / Path | Use for |
|---|---|---|
| Cluster pressure snapshot | `useClusterResources()` → 10s poll | "Now" CPU/RAM per node for scoring |
| Per-node live status | `api.nodes.status(node)` → `NodeStatus` | `loadavg` (string tuple — parse) |
| Historical context | `api.nodes.rrd(node, 'hour')` → `NodeRRDData[]` | Stability check over the last N buckets |
| VM migrate | `api.vms.migrate(node, vmid, {target, online?, with_local_disks?})` → Promise<UPID> | Fire QEMU migration |
| CT migrate | `api.containers.migrate(node, vmid, {target, restart?, online?})` → Promise<UPID> | Fire LXC migration |
| Task poll | `GET /nodes/{node}/tasks/{upid}/status` (existing pattern in `run-bulk-op.ts:pollTask`) | Track completion |
| Modal shell | `fixed inset-0 z-50 flex ... studio-card p-6 w-full max-w-lg` | Wizard container |
| Wizard step indicator | Pattern from `dashboard/vms/create/page.tsx:346-367` | Numbered circles + connector lines |
| Ranked badges | `@/components/ui/badge` with variants success/warning/danger/info/outline | Target labels ("recommended", "not allowed") |
| Per-VM privilege check | `userHasPrivilege(session, path, priv)` in `@/lib/permissions.ts` | `VM.Migrate` on `/vms/{vmid}` |

### Anti-patterns (do NOT do these)

- **Do NOT** invent a scoring heuristic in the component. Keep it in a pure, unit-tested lib so future tuning doesn't require UI work.
- **Do NOT** skip the PVE precondition endpoint (`GET /migrate`). A migration that looks fine in Nexus but fails PVE's own checks is a worse UX than refusing up front.
- **Do NOT** allow the wizard to proceed without a `VM.Migrate` ACL check for the source VM.
- **Do NOT** use react-hook-form / zod — match the vanilla-useState convention of every other editor.
- **Do NOT** expose `bwlimit` / `migration_network` / `targetstorage` in the v1 wizard UI. The param types can be extended later; v1 is "pick a target, go."
- **Do NOT** build a separate progress panel — reuse the task-list or inline spinner pattern from the existing MigrateDialog.
- **Do NOT** touch `HAMigrateDialog` (ha-migrate-dialog.tsx). That's HA-resource-specific and has its own UX.

### Key facts from discovery

- `api.vms.migrate` / `api.containers.migrate` already exist (`proxmox-client.ts:572-573` and `:626-627`).
- Existing single-VM MigrateDialog at `dashboard/vms/[node]/[vmid]/page.tsx:109-168` is a minimal dropdown — no preconditions, no scoring. **This is our integration point.**
- PVE's precondition endpoint `GET /nodes/{node}/qemu/{vmid}/migrate` returns `allowed_nodes`, `not_allowed_nodes[].reason`, `local_disks`, `local_resources`. Not wrapped — Phase 1 adds it.
- `NodeStatus.loadavg` is a string tuple `["0.42","0.51","0.48"]`. Parse floats.
- No scoring code exists anywhere in the repo (greenfield).
- `requireVmMigrate(session, vmid)` helper does NOT exist; Phase 1 adds it using the lower-level `userHasPrivilege`.

---

## Phase 1 — Backend primitives: precondition wrapper + permissions + param types

**What to implement**

1. **Extend migrate param types** in `nexus/src/types/proxmox.ts`. Add optional `bwlimit?: number`, `migration_network?: string`, `targetstorage?: string`, `force?: boolean` to `MigrateVMParams`; add `timeout?: number` to `MigrateCTParams`. Keep the wizard UI scoped to v1 (target + online/restart), but ship the types so future UX can extend without a second round of backend work.

2. **Precondition client wrappers** in `proxmox-client.ts`, adjacent to the existing migrate methods:
   - `api.vms.migratePrecondition(node, vmid)` → `GET nodes/{node}/qemu/{vmid}/migrate`
   - `api.containers.migratePrecondition(node, vmid)` → `GET nodes/{node}/lxc/{vmid}/migrate`
   Both return a typed `MigratePrecondition` object — defined in types/proxmox.ts:

   ```ts
   export interface MigratePrecondition {
     running: boolean;
     allowed_nodes?: string[];
     not_allowed_nodes?: Array<{ node: string; reason: string }>;
     local_disks?: Array<{ volid: string; referenced_in_config?: string }>;
     local_resources?: string[];
   }
   ```

3. **Per-VM permission helper** in `nexus/src/lib/permissions.ts`:
   - `requireVmMigrate(session, vmid: number)` — returns `Promise<boolean>`. Uses the existing `userHasPrivilege(session, '/vms/' + vmid, 'VM.Migrate')` under the hood. Same shape as `requireNodeSysModify`.

**Documentation references**

- Existing migrate wrappers: `nexus/src/lib/proxmox-client.ts:572-573` (QEMU) and `:626-627` (LXC)
- Existing permissions helpers: `nexus/src/lib/permissions.ts:47-67`
- Existing encode helpers pattern: `encodeMigrateVM` / `encodeMigrateCT` in proxmox-client.ts
- PVE API docs subset: `allowed_nodes` / `not_allowed_nodes` / `local_disks` — verified via existing type definitions

**Verification**

- `npx tsc --noEmit` clean
- `curl` the precondition endpoint on a real VM (user does manually; not a unit test)
- Calling `requireVmMigrate(session, someVmid)` with a root session returns true

**Anti-pattern guards**

- Do NOT alter the existing migrate wrappers' signatures — this is additive only.
- Do NOT inline the precondition parse into `api.vms.migrate`. Keep it a separate method so the wizard can call it independently.

---

## Phase 2 — Scoring library

**What to implement**

1. **New module** `nexus/src/lib/migration-score.ts`. Exports:
   ```ts
   export interface GuestResourceAsk {
     vmid: number;
     cores: number;       // vCPU count (from config.cores * sockets or .config.cpus)
     memoryBytes: number; // RAM assigned (from config.memory)
     sourceNode: string;
   }

   export interface NodeSnapshot {
     name: string;
     online: boolean;
     maxCores: number;
     /** Normalised CPU pressure 0..1 — fraction of cores currently busy. */
     cpu: number;
     maxMemory: number;
     memory: number;
     /** 1-minute load average as a number, or undefined if unavailable. */
     loadavg1?: number;
   }

   export interface ScoredTarget {
     node: string;
     score: number;                  // 0..100
     disqualified: boolean;
     reasons: string[];              // Why disqualified OR why flagged
     fit: {
       cpuHeadroomPct: number;       // (maxCores - used) / maxCores after placing the VM
       memHeadroomPct: number;
     };
     /** Ordering hint — "recommended" only for the top non-disqualified. */
     label: 'recommended' | 'ok' | 'tight' | 'not-allowed';
   }

   export function scoreTargets(
     ask: GuestResourceAsk,
     nodes: NodeSnapshot[],
     preconditionAllowed: Set<string>,
     preconditionNotAllowed: Map<string, string>, // node → reason
   ): ScoredTarget[];
   ```

2. **Scoring heuristic** (document in the module's file header):
   - Start each candidate at 100.
   - Disqualify if: `!online`, `name === ask.sourceNode`, `preconditionNotAllowed.has(name)`, `cpuHeadroomPct < 10%`, or `memHeadroomPct < 10%`. Reason string captures which check tripped.
   - Otherwise subtract: `cpu * 40` + `(memory/maxMemory) * 40` + `min(loadavg1/maxCores, 1) * 20`. Floor at 0.
   - Sort disqualified last, then by score desc.
   - Label: top non-disqualified → `recommended`; `ok` if score ≥ 60; `tight` if score < 60; `not-allowed` if disqualified.

3. **Tests** at `nexus/src/lib/migration-score.test.ts`:
   - Source node always disqualified
   - Offline node always disqualified
   - Precondition-blocked node carries the precondition reason verbatim
   - Higher pressure → lower score, monotonic
   - Top non-disqualified gets `recommended`; others don't
   - CPU headroom < 10% → disqualified
   - Memory headroom < 10% → disqualified
   - Missing loadavg1 is acceptable (no score contribution)

**Documentation references**

- Cluster resource shape: `ClusterResourcePublic` (types/proxmox.ts)
- `NodeStatus.loadavg` parsing: tuple of strings, call `parseFloat(s[0])`
- Pure-function pattern: `cron-match.ts` is the reference (no I/O, no React, 100% testable)

**Verification**

- `npm test` runs 10+ new cases for `scoreTargets`, all green
- Hand-check: for a 2-node cluster where one node is at 80% CPU and the other at 20%, the lower-pressure node scores higher

**Anti-pattern guards**

- Do NOT read from React Query / hooks inside this module. Pure function only.
- Do NOT fetch anything. Inputs are pre-computed; caller is responsible for gathering them.
- Do NOT build in source-node-specific "cost" (e.g., "migrating across WAN") for v1. Scoring is cluster-local.

---

## Phase 3 — Hooks + preconditions wiring

**What to implement**

1. **`useMigratePrecondition(guestType, node, vmid)`** in a new `nexus/src/hooks/use-migration.ts`:
   - Query key `['migrate-precondition', guestType, node, vmid]`
   - Calls `api.vms.migratePrecondition` or `api.containers.migratePrecondition`
   - `enabled` gated on all three params being truthy — the wizard calls with the live guest context
   - `staleTime: 10_000` — preconditions don't change fast; re-fetch only if user reopens the wizard

2. **`useCandidateTargets(guestType, node, vmid, ask)`** in the same file:
   - Composes `useClusterResources()` + one `useNodeStatus(node)` query per online node (`useQueries` if needed) + the precondition from above
   - Returns `{ scored: ScoredTarget[], loading, error }` so the wizard can consume it directly
   - The scoring call happens inside the hook (pure function — no perf concern)

3. **`useMigrateGuest()` mutation** in the same file:
   - Single mutation that dispatches to `api.vms.migrate` OR `api.containers.migrate` based on `guestType`
   - `onSuccess` invalidates `['cluster', 'resources']` + `['cluster', 'tasks']` + the per-guest key
   - Returns `{ upid, sourceNode }` so the wizard can navigate to the source node's tasks view

**Documentation references**

- Hook shape: `use-bulk-lifecycle.ts` is the closest template — query+mutation pairs, CSRF via `readCsrfCookie`, invalidate list on success
- `useQueries` pattern: used nowhere currently; cite TanStack docs in the module header
- `useNodeStatus` + `useNodeRRD` signatures: `use-cluster.ts`

**Verification**

- Build passes, `npx tsc --noEmit` clean
- Dev server: open VM detail, open DevTools Network — hitting the wizard fires exactly one precondition request per open

**Anti-pattern guards**

- Do NOT fire migrations optimistically (no `onMutate` rollback). PVE is the authority.
- Do NOT combine precondition + migrate into one round trip — the precondition shapes the wizard itself.
- Do NOT poll the precondition — it's stable within a wizard session.

---

## Phase 4 — Wizard UI + integration

**What to implement**

1. **New component** `nexus/src/components/migrate/migrate-wizard.tsx`:
   - Same modal shell as the scheduler's editor (`fixed inset-0 ... studio-card p-6 max-w-2xl`). Bigger max-w because the ranked list needs breathing room.
   - Step indicator lifted from `dashboard/vms/create/page.tsx:346-367` — numbered circles + connector lines. Three steps:
     1. **Source** — confirm the guest (icon, name, vmid, source node, running status). Auto-advances.
     2. **Target** — ranked list of `ScoredTarget`s. Each row: node name, score bar, "recommended"/"ok"/"tight" badge, headroom pct (CPU + mem), precondition reason if disqualified (unselectable). Selection preselects the top non-disqualified.
     3. **Confirm** — show source → target summary, live/restart toggle (if running), "Migrate" button.
   - Standard Back / Next / Migrate button row. Disabled states match the existing wizard convention (`canNext()` pattern).

2. **Replace inline `MigrateDialog`** on `dashboard/vms/[node]/[vmid]/page.tsx:109-168` with `<MigrateWizard guestType="qemu" ... />`. Same for `cts/[node]/[vmid]/page.tsx:165-205` with `guestType="lxc"`.

3. **Button wiring**: existing "Migrate" button on each page opens the wizard; no change to the button itself. On migration success, the wizard closes and the page refetches (same as today).

4. **Error handling**: if precondition query fails, show an inline error in step 2 with a Retry button (no disqualification — the whole step fails back). If the final mutation fails, show the PVE error in step 3 without closing.

**Documentation references**

- Step indicator UI markup: `dashboard/vms/create/page.tsx:346-367`
- Modal shell + vanilla useState form: `schedule-job-editor.tsx`, `backup-job-editor.tsx`
- Badge variants + sizes: `@/components/ui/badge`
- Headroom bar: reuse `@/components/ui/progress-bar`
- Task poll hook for post-migration UX: skip — the existing pages already refetch on navigation

**Verification**

- `npx tsc --noEmit` clean; `npx next lint` clean for new files
- Dev server: run against a real (or stubbed) cluster; open a VM, hit Migrate, confirm:
  - Wizard opens and auto-advances to step 2
  - Source node is excluded
  - Offline nodes are disqualified with reason "node offline"
  - The node with the least CPU+mem pressure gets the `recommended` badge
  - Picking a `not-allowed` option is impossible (row is disabled)
  - Confirm → Migrate fires, wizard closes, page refetches

**Anti-pattern guards**

- Do NOT render a `<select>` for the target. The whole point is the ranked list.
- Do NOT surface PVE's raw `local_resources` / `local_disks` JSON — translate to human prose ("requires local disk: local-lvm:vm-100-disk-0").
- Do NOT persist wizard state across mount/unmount. Opening it again re-runs the precondition fetch and re-scores.

---

## Phase 5 — Verification

**What to verify (end-to-end)**

1. **Unit tests** pass: `scoreTargets` cases from Phase 2.
2. **Type + lint gate**: `npx tsc --noEmit` clean, `npx next lint` clean.
3. **Full test suite**: `npm test` — all Scheduled Jobs + Bulk Lifecycle + Migration tests pass together.
4. **Anti-pattern greps**
   - `rg "react-hook-form|from 'zod'" nexus/src/components/migrate/` → zero
   - `rg "onMutate" nexus/src/hooks/use-migration.ts` → zero
   - `rg "api\\.vms\\.migrate\\(.*\\{.*bwlimit" nexus/src/components` → zero (v1 doesn't expose bwlimit)
   - `rg "scoreTargets" nexus/src/components/migrate/` → at least one hit (wizard calls the lib, doesn't reimplement)
5. **Integration smoke matrix** (user runs on the host):
   | Case | Expected |
   |---|---|
   | VM migrate to less-loaded node | Recommended badge on less-loaded; migration succeeds |
   | VM with local disk | Target filtered to nodes with matching storage OR marked not-allowed with reason |
   | Source node is only online node | All targets disqualified; wizard shows "no eligible targets" |
   | Lacking VM.Migrate | Button hidden / 403 on attempt |
   | CT migrate | Wizard works; "restart" toggle in step 3 instead of "online" |
   | Offline target | Disqualified with reason "node offline" |
   | Cancel during step 2 | Wizard closes, no request fired |
6. **Import-graph check** (since the v2026.04.17-f878f58 crash class): `grep -rn "migration-score\\|use-migration\\|migrate-wizard" nexus/server.ts` → zero. These live entirely within the Next.js-bundled graph.

**Exit criteria**

- All 5 smoke-matrix rows pass on a real Proxmox host
- No regression in the single-VM detail page's existing behavior (tabs, metrics, actions)
- Existing `HAMigrateDialog` still works untouched

---

## Commit boundaries

- Phase 1 → one commit (types + wrappers + permission helper)
- Phase 2 → one commit (scoring + tests)
- Phase 3 → one commit (hooks)
- Phase 4 → one commit (wizard + dialog replacement on VM + CT pages)
- Phase 5 → verification-only commit + smoke-matrix notes

All files land in `src/lib/` or `src/components/migrate/` or `src/hooks/` — already shipped by the [d58b721](d58b721) tarball fix. No CI changes needed.
