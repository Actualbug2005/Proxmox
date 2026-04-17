# Plan: Global Health (NOC View) + Log Correlation (Tier 5 — Observability)

**Goal:** A single `/dashboard/health` page that surfaces cluster-wide pressure signals (CPU spikes, memory pressure, load, storage exhaustion projections, recent task failures) on one screen. Click a failing task → drawer with the task's own log side-by-side with the host's journal entries from the same time window.

**Strategy:** Two adjacent features, one plan. Every visual primitive the NOC needs is already in the repo (`RRDChart`, `StatusDot`, `Gauge`, `ProgressBar`, `Badge` with emerald/amber/red thresholds). What's missing: a pure pressure-aggregation lib, a storage-RRD wrapper + trendline helper, a clickable task detail drawer, and the page assembly. Log correlation shows up as a drawer opened from the NOC's "Recent failures" panel and from the existing Tasks page.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs (use these)

| Capability | Symbol / Path | Use for |
|---|---|---|
| Cluster pressure snapshot | `useClusterResources()` → 10s poll | NOC "now" view (cpu/mem per node + guests) |
| Per-node RRD | `api.nodes.rrd(node, 'hour'|'day'|'week')` → `NodeRRDData[]` | Mini sparklines per node, trend lines |
| Per-node status | `api.nodes.status(node)` → `NodeStatus` | Parsed `loadavg` tuple for load panel |
| Recent tasks | `useClusterTasks()` → `PVETask[]` | "Recent failures" panel (filter by exitstatus !== 'OK') |
| Task log | `api.tasks.log(node, upid)` → `{n, t}[]` (proxmox-client.ts:847) | Left pane of correlation drawer |
| Node journal | `api.nodes.journal(node, {since?, until?, lastentries?})` → `JournalEntry[]` (raw strings) | Right pane of correlation drawer |
| Storage list | `api.storage.list(node)` → `PVEStoragePublic[]` with {total, used, avail} | Current-state storage |
| Visual language | `StatusDot`, `ProgressBar` (65/85 threshold), `Gauge`, `Badge` (success/warning/danger/info) | NOC health encoding |
| Chart primitive | `RRDChart` (rrd-chart.tsx:103-199) with `SeriesSpec` | Any time-series panel — don't reinvent |
| Journal row parser | logs/page.tsx:13-54 regex parser | Reuse verbatim for the correlation drawer |

### Anti-patterns (do NOT do these)

- **Do NOT** add a charting library. Recharts via `RRDChart` is the convention.
- **Do NOT** reimplement the journal regex parser. Extract it to a shared helper (`lib/journal-parse.ts`) and let both the logs page and the correlation drawer use it.
- **Do NOT** poll journal when the drawer isn't open. `useQuery` with `enabled: open && !!task`.
- **Do NOT** do the "days until full" regression in the UI component. Keep it in a pure, unit-tested helper.
- **Do NOT** use `react-hook-form` or `zod`. The NOC has no forms; the correlation drawer has a time-window range input using plain `useState`.
- **Do NOT** hide the existing Tasks page. The NOC doesn't replace it — it complements it. The correlation drawer is opened from BOTH places.
- **Do NOT** add more than 5 panels in v1. Cluster pressure + top-N offenders + node pressure grid + storage exhaustion + recent failures is already a lot of screen.
- **Do NOT** poll storage RRD at high frequency. The data is per-2.4h / per-20min — refetch every 5 minutes is plenty.

### Key facts from discovery

- No global-health page exists today; Overview (`/dashboard`) is the closest but it's organized by resource type, not by pressure.
- `api.storage.rrd()` is NOT wrapped — Phase 1 adds it. PVE endpoint: `GET /nodes/{node}/storage/{storage}/rrddata?timeframe=week&cf=AVERAGE`.
- `PVETask` carries `starttime` / `endtime` in **seconds epoch**. Journal entries come back as **raw strings** (logs/page.tsx parses them on display).
- `JournalParams.since` / `until` format is unspecified in the Nexus types. Based on PVE's upstream wrapper of `journalctl`, it accepts seconds-since-epoch (integer) as a string. Phase 3 confirms this at the first integration point.
- No existing regression / trendline helper. Phase 1 adds a simple `linearRegression` pure function; no npm dep needed.
- Visual thresholds already consistent: ≤65% emerald, 66-85% amber, >85% red. Reuse.
- Sidebar place: under Core, after Scheduled Jobs. One-line add.

---

## Phase 1 — Storage RRD + trendline + aggregation primitives

**What to implement**

1. **Storage RRD wrapper** in `proxmox-client.ts`, adjacent to node/qemu/lxc RRD:
   ```ts
   api.storage.rrd = (node: string, storage: string, timeframe: 'hour'|'day'|'week'|'month' = 'week') =>
     proxmox.get<StorageRRDData[]>(
       `nodes/${node}/storage/${encodeURIComponent(storage)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
     );
   ```
   New type `StorageRRDData { time: number; used?: number; total?: number; avail?: number }` in `types/proxmox.ts`.

2. **Trendline helper** `nexus/src/lib/trend.ts`:
   ```ts
   /** Plain least-squares linear regression on { x, y } points. */
   export function linearRegression(points: Array<[number, number]>):
     | { slope: number; intercept: number }
     | null;

   /** Project the x-value at which y hits `threshold`. Returns null when
    *  slope is zero or negative (no exhaustion — or already past). */
   export function projectToThreshold(
     points: Array<[number, number]>,
     threshold: number,
   ): number | null;

   /** Convenience: days-until-{threshold}% for a storage RRD series.
    *  threshold defaults to 0.95 (95% full). */
   export function daysUntilFull(
     rrd: Array<{ time: number; used?: number; total?: number }>,
     threshold?: number,
   ): number | null;
   ```

3. **Pressure aggregation** `nexus/src/lib/cluster-pressure.ts` — pure. Takes the cluster resources array + per-node status map and returns:
   ```ts
   export interface ClusterPressure {
     nodesOnline: number;
     nodesTotal: number;
     avgCpu: number;       // 0..1 across online nodes
     avgMemory: number;    // 0..1
     peakLoadavg1: number; // 1-min load / maxCores across online nodes
     topGuestsByCpu: Array<{ id: string; name?: string; node?: string; cpu: number; vmid?: number; type: 'qemu'|'lxc' }>;
     topGuestsByMemory: Array<{ id: string; name?: string; node?: string; memPct: number; vmid?: number; type: 'qemu'|'lxc' }>;
     recentFailures: Array<{ upid: string; node: string; type: string; id?: string; exitstatus: string; starttime: number }>;
   }
   export function computePressure(
     resources: ClusterResourcePublic[],
     nodeStatuses: Record<string, NodeStatus | undefined>,
     tasks: PVETask[],
     topN?: number,
   ): ClusterPressure;
   ```

4. **Tests** in `trend.test.ts` + `cluster-pressure.test.ts`:
   - `linearRegression` on a monotonically-increasing series returns positive slope
   - `projectToThreshold` with slope=0 returns null
   - `daysUntilFull` on a series filling by 1GB/day, 100GB capacity, 90GB used → ~9.5 days at threshold 0.95
   - `computePressure` sorts top-N correctly, excludes stopped guests, handles missing `loadavg` gracefully
   - Empty inputs return sensible zero values

**Documentation references**

- Existing RRD wrappers: `proxmox-client.ts:595,651,857` (qemu/lxc/node)
- Existing pure-lib pattern: `cron-match.ts` (no I/O, tested via `node:test`)
- Visual threshold constants: `progress-bar.tsx:18-22` (65 / 85)

**Verification**

- `npx tsc --noEmit` clean
- `npm test` — new cases pass
- Hand-check: series `[[0, 90], [86400*1000, 91]]` (+1GB/day, starting at 90/100 used) returns ≈5 days to reach 95

**Anti-pattern guards**

- Do NOT add `simple-statistics` or `regression` npm packages. The math is 20 lines.
- Do NOT let `computePressure` fetch anything — pure function, callers gather inputs.

---

## Phase 2 — Journal parse helper + `useJournalWindow` hook

**What to implement**

1. **Extract journal parser** from `logs/page.tsx:13-54` to a new shared module `nexus/src/lib/journal-parse.ts`:
   ```ts
   export interface ParsedJournalLine {
     raw: string;
     time?: string;      // "Apr 14 23:06:22" as rendered by journalctl
     host?: string;
     unit?: string;
     message: string;
     priority: 'debug' | 'info' | 'warn' | 'err' | 'crit';
   }
   export function parseJournalLine(raw: string): ParsedJournalLine;
   ```
   Update `logs/page.tsx` to import from here (no behavior change).

2. **Hook** `nexus/src/hooks/use-journal-window.ts`:
   ```ts
   export function useJournalWindow(
     node: string | null,
     since: number | null,   // seconds epoch
     until: number | null,
     opts?: { lastentries?: number; enabled?: boolean },
   ): UseQueryResult<ParsedJournalLine[], Error>;
   ```
   Enforces `lastentries` cap (default 500). Passes `since`/`until` as string epoch to the existing `api.nodes.journal`.

3. **Task log hook** `useTaskLog(node, upid)` in the same file — wraps `api.tasks.log`. Returns the `{n, t}[]` array.

**Documentation references**

- Current regex + priority inference: `logs/page.tsx:13-54`
- Journal endpoint: `proxmox-client.ts:867`
- Hook convention: `use-task-completion.ts` (Phase 2 of cloud-init)

**Verification**

- `npx tsc --noEmit` clean
- Logs page still renders identically after the parser extraction
- Unit test the parser on one example from each priority (5-6 cases)

**Anti-pattern guards**

- Do NOT mutate the shape returned by `api.nodes.journal` at the lib level — parsing is the consumer's concern; hooks can choose to parse or not.
- Do NOT poll journal endpoints. `refetchInterval: false`.

---

## Phase 3 — Task-log correlation drawer

**What to implement**

1. **New component** `nexus/src/components/tasks/task-correlation-drawer.tsx`:
   - Modal shell (same `fixed inset-0 ... studio-card`) but wider (`max-w-5xl`) and taller.
   - Header: task type + id + status Badge + "From <starttime> to <endtime>".
   - Two panes:
     - **Left (1fr)**: task log — flat text rendering of `useTaskLog(node, upid)`, monospace, scroll.
     - **Right (1fr)**: journal window — scrollable list of `ParsedJournalLine` rows from `useJournalWindow(node, starttime - pad, endtime + pad)`. Each row shows the parsed time + unit + colored priority pip + message.
   - Top-right controls: window-pad stepper (±30s / ±2m / ±5m), priority filter (show all / warnings+ / errors+).
   - Footer: "Open full journal" deep-link to `/dashboard/system/logs?node=<n>&since=<t>&until=<t>` (follow the logs page's existing query-param contract if present; otherwise skip).

2. **Open from the existing Tasks page** (`nexus/src/app/(app)/dashboard/tasks/page.tsx`): add a click handler on each task row that opens the drawer. Existing non-clickable rows get `onClick` + cursor-pointer styling.

3. **Open from `TaskList` (dashboard widget)**: same — rows become clickable and open the drawer at the app level. Since `TaskList` is rendered in multiple places (dashboard + Phase 4 NOC), hoist the drawer state into a small context or accept an `onTaskClick` prop.

**Documentation references**

- Modal shell convention: all existing editors (`backup-job-editor.tsx`, `schedule-job-editor.tsx`, `migrate-wizard.tsx`)
- Priority colors: Badge variants (`ui/badge.tsx:11-18`)
- Task row styling: `task-list.tsx:32-51`
- Logs page query params (if any): `dashboard/system/logs/page.tsx`

**Verification**

- `tsc --noEmit` clean
- Clicking any task in the Tasks page opens the drawer
- A failed task (exitstatus !== 'OK') shows non-trivial journal entries in the window
- Changing the pad stepper re-queries the journal with the new range

**Anti-pattern guards**

- Do NOT eagerly mount the drawer when no task is selected.
- Do NOT fetch journal with an empty `since/until`.
- Do NOT render more than N (say 500) entries; virtualize if needed (browser handles 500 rows fine — don't over-engineer).

---

## Phase 4 — NOC page + hooks + sidebar entry

**What to implement**

1. **New route** `nexus/src/app/(app)/dashboard/health/page.tsx`. Panels:
   - **Top summary row** (4 StatCards): Nodes Online (x/y), Running Guests, Avg CPU%, Avg Memory%
   - **Node pressure grid** (2-col on xl): one `NodeCard`-like row per node with sparklines (CPU / memused) via `RRDChart` in a small size — reuse `SeriesSpec` config
   - **Top offenders** (2-col): "Hottest VMs (CPU)" list and "Heaviest VMs (Memory)" list — 5 entries each, rendered as `ProgressBar` rows with links to the VM detail
   - **Storage exhaustion**: table of storages sorted ascending by `daysUntilFull`. Columns: storage name, node, %full (ProgressBar, red at >85%), used/total bytes, projected days-to-full (Badge: danger <30, warning <90, info ≥90, muted "no trend" when null)
   - **Recent failures**: 8 most recent tasks with `exitstatus !== 'OK'`; click opens the correlation drawer from Phase 3

2. **Composed hook** `nexus/src/hooks/use-cluster-health.ts`:
   ```ts
   export function useClusterHealth(): {
     pressure: ClusterPressure | null;
     storage: Array<{ storage: string; node: string; usedFraction: number; daysUntilFull: number | null; used: number; total: number }>;
     loading: boolean;
     error: Error | null;
   }
   ```
   Composes `useClusterResources` + one `useNodeStatus` per online node (via `useQueries`, same pattern as `use-migration.ts`'s `useCandidateTargets`) + one `useStorageRrd` per unique storage. Storage RRD fetches are throttled (5-min refetch) so the page's 10s cadence doesn't hammer PVE.

3. **Sidebar entry** in `sidebar.tsx`: add under Core, after Scheduled Jobs:
   ```ts
   { href: '/dashboard/health', label: 'Health', icon: HeartPulse },
   ```
   (`HeartPulse` is already imported for HA & Status; reuse or pick a different lucide icon like `Activity`.)

**Documentation references**

- Dashboard page structure: `dashboard/page.tsx` (header + stats grid + main grid pattern)
- StatCard component: `components/ui/stat-card.tsx` (inferred location; check and adjust)
- Chart primitive: `rrd-chart.tsx:103-199` with `SeriesSpec`
- ProgressBar thresholds: `progress-bar.tsx:18-22`
- Sidebar structure: `components/dashboard/sidebar.tsx:42-77`
- Scheduled-jobs page pattern: `dashboard/schedules/page.tsx` (header + summary row + card list)

**Verification**

- `npx tsc --noEmit` clean, `next lint` clean
- Dev: Health page renders at `/dashboard/health`; panels populate; Recent failures click opens the drawer
- Storage exhaustion panel shows "no trend" when the RRD data is monotonically decreasing or flat (no exhaustion)
- Navigating to the page and back doesn't leak a dangling drawer

**Anti-pattern guards**

- Do NOT `useQueries` with a dynamically-changing length; compute the node list once, memoize.
- Do NOT use `Date.now()` at the top level of the component body — it trips `react-hooks/purity`. Compute derived values inside helpers.
- Do NOT render all storages; cap at the 10 worst to keep the page breathable.

---

## Phase 5 — Verification

**Checks**

1. **Unit tests** pass: `trend.test.ts` + `cluster-pressure.test.ts` + `journal-parse.test.ts` (if added).
2. **Type + lint gate**: `tsc --noEmit` clean; `next lint` clean on new files.
3. **Full test suite**: `npm test` — all existing + new tests pass.
4. **Anti-pattern greps**
   - `rg "react-hook-form|from 'zod'" nexus/src/components/tasks nexus/src/app/\(app\)/dashboard/health` → zero
   - `rg "import (Recharts|recharts)" nexus/src/components/tasks` → zero (drawer is text-only)
   - `rg "simple-statistics|regression" nexus/package.json` → zero (no new deps)
   - `rg "Date\\.now\\(\\)" nexus/src/app/\(app\)/dashboard/health/page.tsx` → zero in the component body (helpers only)
   - `rg "noc-view|health|journal-parse|trend" nexus/server.ts` → zero (no strip-types tarball regression)
5. **Import-graph sanity**: all new modules live under `src/lib/`, `src/hooks/`, `src/components/`, `src/app/(app)/dashboard/health/`. Nothing reaches `server.ts`.
6. **Manual smoke matrix**
   | Case | Expected |
   |---|---|
   | All nodes online, healthy | Summary row reads green; no red badges on storage |
   | One node at 90% CPU | Shows in top summary, node pressure grid row is amber/red |
   | Storage at 95% and growing | "days until full" badge is red; ranked at top of exhaustion panel |
   | Storage shrinking (deletes) | "no trend" label; not ranked high |
   | Click a failed task in Recent failures | Drawer opens with task log + journal window; priority filter works |
   | Task with no journal (e.g., logs rotated out) | Drawer shows "no entries in window" cleanly |

**Exit criteria**

- Smoke matrix passes on a real Proxmox host
- No regression on Overview, Tasks page, logs page, or the scheduler
- Existing storage page unchanged

---

## Commit boundaries

- Phase 1 → one commit (types + storage RRD + trend lib + pressure lib + tests)
- Phase 2 → one commit (journal parser extraction + hooks; logs page unchanged behaviorally)
- Phase 3 → one commit (correlation drawer + task row click-through on Tasks page + TaskList)
- Phase 4 → one commit (Health page + composed hook + sidebar entry)
- Phase 5 → verification-only commit + smoke-matrix notes

All new files sit under `src/lib/`, `src/hooks/`, `src/components/tasks/`, `src/app/(app)/dashboard/health/`. No CI changes.
