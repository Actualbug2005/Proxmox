# Plan: Bulk Lifecycle Management (Tier 5 — Automation, Phase B)

**Goal:** Multi-select VMs/CTs across nodes in the resource tree and fire one of { start, stop, shutdown, reboot, snapshot } on all of them, staggered to protect pveproxy, with per-item progress.

**Strategy:** Copy the single-action `api.vms.*` / `api.containers.*` mutations wholesale. Invent only: (1) multi-select UI, (2) a server-side batch orchestrator that wraps those same calls with `acquireSlot`-based staggering + UPID tracking, (3) a progress panel that mirrors the existing TaskList icon pattern.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs (use these, do not invent alternatives)

| Capability | Symbol / Path | Use for |
|---|---|---|
| VM lifecycle | `api.vms.{start,stop,shutdown,reboot}(node, vmid)` → `Promise<UPID>` in `nexus/src/lib/proxmox-client.ts:541-594` | Per-item action on a QEMU VM |
| CT lifecycle | `api.containers.{start,stop,shutdown,reboot}(node, vmid)` in same file lines 597-648 | Per-item action on an LXC |
| Snapshot | `api.vms.snapshot.create(node, vmid, {snapname, description?, vmstate?})` → UPID | Create snapshot on any guest |
| Concurrency slot | `acquireSlot(sessionId, opName, maxConcurrent, ttlMs)` in `nexus/src/lib/rate-limit.ts` | Stagger the batch (never fire more than N in flight) |
| Token bucket | `takeToken(sessionId, op, limit, windowMs)` same file | Per-session batch-creation rate limit |
| Task status | `GET /nodes/{node}/tasks/{upid}/status` via the proxy, or `useClusterTasks()` in `nexus/src/hooks/use-cluster.ts:99-105` (polls every 15s) | Resolve UPID → completed? succeeded? |
| Task icon | `TaskStatusIcon` logic in `nexus/src/components/dashboard/task-list.tsx:7-12` | Per-item status indicator |
| Job registry pattern | `nexus/src/lib/script-jobs.ts` (`createJob` / `finaliseJob` / in-memory `Map` with 24h TTL) | Template for the new batch registry — copy the shape, drop the shell-log parts |
| Auth + CSRF | `getSessionId()`, `getSession()`, `validateCsrf(req, sessionId)` — same pattern as all mutation routes | Gate the new API |
| ACL | `requireNodeSysModify(session, node)` in `nexus/src/lib/permissions.ts` | Enforce per-target before enqueuing |
| Proxy | `nexus/src/app/api/proxmox/[...path]/route.ts` auto-injects `CSRFPreventionToken` | Downstream calls in the orchestrator go through this |

### Anti-patterns (do NOT do these)

- **Do NOT** call PVE endpoints directly from the orchestrator with raw `fetch`. Go through `api.vms.*` / `api.containers.*` so one code path owns auth + CSRF + error shape.
- **Do NOT** fan out with `Promise.all([...])` unbounded. Use `acquireSlot('bulk-lifecycle', maxConcurrent=3)` per item so pveproxy isn't stampeded.
- **Do NOT** block the POST response while the batch runs. Return `{ batchId }` within ~100ms; the client polls a GET endpoint for progress. (Mirrors `/api/scripts/run`'s fire-and-forget model from Phase A.)
- **Do NOT** use `optimistic` UI (`onMutate`) — the codebase doesn't, and a 15s tasks-poll already reveals real state.
- **Do NOT** put multi-select state inside `ResourceTree`. Lift it to the dashboard page, same as the existing `selected: ClusterResourcePublic | null`.
- **Do NOT** expose `DELETE` / destroy in this feature. Deleting VMs in bulk is a foot-gun deserving its own plan. Scope is intentionally limited to reversible-ish actions.
- **Do NOT** generalize `script-jobs.ts` — keep it script-specific. Create a parallel `bulk-ops.ts` registry. The shapes are similar but the responsibilities differ.

### Key facts

- `ResourceTree` is **single-select** today. VM/CT rows are `<Link>`s — click navigates. Adding a checkbox column is the cleanest way to separate "select for bulk" from "drill in".
- `acquireSlot` is Redis-backed when `REDIS_URL` is set, memory fallback otherwise. Good enough for single-process throttling.
- PVE lifecycle endpoints all return a UPID string. The UPID encodes the node so a per-node task-status fetch is always possible.
- No existing checkbox primitive in the codebase — we'll build a minimal one under `components/ui/`.

---

## Phase 1 — Multi-select state + checkbox UI + action bar

**What to implement**

1. **New component** `nexus/src/components/ui/checkbox.tsx`. ~30 lines, button-based, three states (unchecked / checked / indeterminate), matches the existing Lucide + Tailwind idiom. No external dep.

2. **Extend `ResourceTree`** in `nexus/src/components/dashboard/resource-tree.tsx`:
   - Add optional props `selectedIds?: Set<string>` and `onToggleSelected?: (resource: ClusterResourcePublic) => void`. Both optional — existing callers keep working unchanged.
   - When `selectedIds` is supplied, render a leading checkbox on each VM/CT row. Clicking the checkbox toggles via `onToggleSelected`; clicking the row text still navigates (`<Link>` preserved).
   - A node row shows a **tri-state checkbox** that selects/deselects all of its children.
   - Do NOT render checkboxes for non-guest resources (storage, pool, sdn, network, node itself stays click-to-select).

3. **Lift selection to `nexus/src/app/(app)/dashboard/page.tsx`**:
   - Add `const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())` alongside the existing `selected`.
   - Pass `selectedIds` and a toggle callback into `ResourceTree`.

4. **New `BulkActionBar`** at `nexus/src/components/dashboard/bulk-action-bar.tsx`:
   - Renders above the tree when `selectedIds.size > 0`.
   - Shows count ("3 selected") + five action buttons (Start / Shutdown / Reboot / Stop / Snapshot…) + Clear.
   - Each button opens a confirm dialog (reuse `nexus/src/components/ui/confirm-dialog.tsx`). Snapshot opens a second dialog to collect `snapname` + optional description first.
   - Buttons disabled when the current selection is incompatible (e.g., Start greyed out if every selected guest is already `running`) — compute from the resource list.

**Documentation references**

- Existing single-select `<ResourceTree>` props: `nexus/src/components/dashboard/resource-tree.tsx:16-20`
- Existing confirm dialog: `nexus/src/components/ui/confirm-dialog.tsx:6-45`
- Status-driven disable logic: see the per-VM page at `nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx:200+` for which statuses gate which actions
- Tailwind classes for "selected row" highlight: `resource-tree.tsx:77` (`bg-zinc-800` family)
- Icons: Lucide `Play`, `PowerOff`, `Power`, `RotateCw`, `Camera`, `Check`, `Square`

**Verification**

- `npx tsc --noEmit` clean
- Click the checkbox on a VM row — row gets a selected-state background, tree behavior unchanged
- Click the row text — still navigates to the VM detail page (no regression)
- Tri-state on a node row: check one child ⇒ indeterminate; check all ⇒ checked; uncheck last ⇒ unchecked
- BulkActionBar appears/disappears correctly, Clear wipes the set

**Anti-pattern guards**

- Do NOT replace the existing `onSelect` / `selectedId` props. Multi-select is **additive**.
- Do NOT allow checkbox on rows whose `type` isn't `qemu` or `lxc`. Nodes/storage/pools don't have a lifecycle API the bulk feature targets.
- Do NOT submit anything to the server from Phase 1 — buttons collect intent; Phase 3 wires them up.

---

## Phase 2 — Bulk orchestrator + batch registry (server-only)

**What to implement**

1. **New registry** `nexus/src/lib/bulk-ops.ts`. Shape lifted from `script-jobs.ts` but **minimal** — no log streaming:

   ```ts
   type Op = 'start' | 'stop' | 'shutdown' | 'reboot' | 'snapshot';
   type ItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

   interface BulkItem {
     guestType: 'qemu' | 'lxc';
     node: string;
     vmid: number;
     status: ItemStatus;
     upid?: string;
     error?: string;
     startedAt?: number;
     finishedAt?: number;
   }

   interface BulkBatch {
     id: string;
     user: string;          // PVE userid
     op: Op;
     snapshot?: { snapname: string; description?: string; vmstate?: boolean };
     createdAt: number;
     finishedAt?: number;
     items: BulkItem[];
     maxConcurrent: number;
   }
   ```

   Exports `createBatch`, `getBatch`, `listBatchesForUser`, `updateItem`, plus a GC that drops completed batches after 1 hour (shorter than script-jobs' 24h — lifecycle ops are transient).

2. **New executor** `nexus/src/lib/run-bulk-op.ts`:
   - `runBulkOp(batch: BulkBatch)` — async, doesn't await completion.
   - Iterates items. For each: `await acquireSlot(batchId, 'bulk-lifecycle', batch.maxConcurrent, 5 * 60_000)`, then call the right `api.vms.*` / `api.containers.*` method via the SERVER-SIDE proxy client (see note below). Store the returned UPID on the item. Release the slot in `finally`.
   - Between items in the same "wave", a small jitter (200-500ms) to avoid synchronized starts.
   - A *completion watcher*: once every 10s, for each item with a UPID but no terminal status, fetch `/nodes/{node}/tasks/{upid}/status` and mark `success` / `failed` based on `exitstatus`. Stop once all items terminal or 15 min elapsed.

3. **Server-side PVE client**: the existing `api.vms.*` (`proxmox-client.ts`) is a browser-oriented wrapper that hits `/api/proxmox/...`. The orchestrator runs server-side and needs a direct PVE caller. Options:
   - **Preferred:** use `pveFetch` from `nexus/src/lib/pve-fetch.ts` directly (the proxy route is built on top of it) with a `PVEAuthSession` — no in-process HTTP hop.
   - Build a thin helper `serverLifecycle(session, guestType, op, node, vmid)` that centralises the endpoint table.

   Document the chosen approach in the module header so the next person doesn't try to use the browser client on the server.

**Documentation references**

- Registry shape template: `nexus/src/lib/script-jobs.ts:36-248`
- Slot semantics: `nexus/src/lib/rate-limit.ts` (`acquireSlot`, `Slot.release`)
- PVE fetch: `nexus/src/lib/pve-fetch.ts`
- Endpoint table: the existing `api.vms.*` and `api.containers.*` in `proxmox-client.ts:541-648`
- Session shape + username: `nexus/src/lib/auth.ts:getSession()`

**Verification**

- Unit test `bulk-ops.test.ts`: create a batch, mark items, observe aggregate `finishedAt` is set when all items terminal.
- Unit test `run-bulk-op.test.ts` with a stubbed `serverLifecycle` that resolves a fake UPID: fire a 5-item batch with `maxConcurrent=2`, assert at most 2 are in-flight at any point (mock the slot counter).
- Error path: stub throws on item 3; assert item is marked `failed` with `error` set and the batch continues to items 4/5.

**Anti-pattern guards**

- Do NOT `await Promise.all(items.map(...))` without the slot — that's the exact stampede we're preventing.
- Do NOT use `setInterval` inside `run-bulk-op.ts`. One shared poll loop per-batch, torn down when the batch is terminal or hits the 15-min watchdog.
- Do NOT log raw PVE responses to stdout — they contain UPIDs and node IPs. Use structured logs with `{ batchId, vmid, error: err.message }` (pattern from `run-script-job.ts`).
- Do NOT persist batches to disk — in-memory is correct. A Nexus restart cancels all running batches, which is the safer failure mode for lifecycle ops.

---

## Phase 3 — API routes

**What to implement**

1. `POST /api/cluster/bulk-lifecycle` at `nexus/src/app/api/cluster/bulk-lifecycle/route.ts`:
   - Auth + CSRF + session (same template as every other mutation).
   - Body: `{ op: Op; snapshot?: SnapshotParams; targets: Array<{ guestType, node, vmid }> }`
   - Validate: `op` is one of the five; `targets` is 1-50 items; each target has valid `node` (NODE_RE), `vmid` (positive int), `guestType` in the union. For `op === 'snapshot'`, `snapshot.snapname` is required and passes PVE's name regex.
   - For each unique `node` in targets, `requireNodeSysModify(session, node)`. One-and-done — if any node fails ACL, 403.
   - `takeToken(sessionId, 'cluster.bulkLifecycle', 10, 60_000)` — 10 batches/minute/session.
   - Create the batch, fire `runBulkOp(batch)` *without* awaiting, return `{ batchId, itemCount }` with 202 Accepted.

2. `GET /api/cluster/bulk-lifecycle/[id]` at `nexus/src/app/api/cluster/bulk-lifecycle/[id]/route.ts`:
   - Returns the batch DTO if the caller owns it, else 404.
   - Strip user-only metadata — shape matches the registry's `BulkBatch`.

3. `GET /api/cluster/bulk-lifecycle` (list):
   - Recent batches for the calling user, newest first, capped at 20.

4. `POST /api/cluster/bulk-lifecycle/[id]/cancel` *(optional; include if Phase 2's executor supports an `aborted` flag)*:
   - Flip all `pending` items to `skipped`; `running` items are left alone (PVE tasks can't be cancelled cleanly). Return the updated batch.

**Documentation references**

- Route template: `nexus/src/app/api/scripts/schedules/route.ts` (CSRF + auth + ACL + rate-limit + store call) — copy the skeleton verbatim
- Node regex: `NODE_RE` from `nexus/src/lib/run-script-job.ts`
- ACL usage: `api/scripts/run/route.ts:280`
- Rate-limit names / config: `RATE_LIMITS` in `nexus/src/lib/rate-limit.ts` — add `bulkLifecycle` entry

**Verification**

- `curl -X POST` a 3-item batch — 202 with `batchId`; `curl` the GET — items progress through pending→running→success.
- POST with 51 targets — 400.
- POST with a `vmid: 0` — 400.
- POST as a user without `Sys.Modify` on one of the target nodes — 403.
- POST without CSRF header — 403.
- GET a batchId created by another user — 404 (not 403).

**Anti-pattern guards**

- Do NOT pass the raw `session.ticket` / `csrfToken` into `runBulkOp` — pass the whole `PVEAuthSession` object; the executor calls `pveFetch` which handles it internally.
- Do NOT reuse the `scripts.run` rate bucket. A separate `bulkLifecycle` bucket keeps the two features' budgets independent.
- Do NOT 500 when one target fails ACL mid-validation — collect and return the list of rejected targets so the client can recover.

---

## Phase 4 — UI wiring: progress panel + hooks + action bar integration

**What to implement**

1. **Hooks** at `nexus/src/hooks/use-bulk-lifecycle.ts`:
   - `useBulkBatches()` — query `['bulk-lifecycle', 'list']`, adaptive poll (2s if any batch has non-terminal items, 30s otherwise). Same pattern as `use-script-jobs.ts:useScriptJobs`.
   - `useBulkBatch(id)` — detail poll, 2s while non-terminal, off once all items terminal.
   - `useStartBulkOp()` — POST mutation. Invalidates list on success. Returns `batchId` for the caller to open the panel.
   - `useCancelBulkOp()` — optional DELETE/POST cancel.

2. **BulkProgressPanel** at `nexus/src/components/dashboard/bulk-progress-panel.tsx`:
   - Bottom-right floating card (copy placement of the existing script-jobs status bar if present; otherwise new `fixed bottom-4 right-4 w-96 studio-card`).
   - Header: "Bulk reboot · 3/10 done" + collapse/close.
   - Body: per-item row with `TaskStatusIcon`, "node / vmid / name", and inline error on failure. Reuse the icon logic from `task-list.tsx:7-12`.
   - Shows at most the 3 most-recent non-terminal batches; older ones dismiss via timeout.

3. **Wire `BulkActionBar` (from Phase 1) to `useStartBulkOp`**:
   - Clicking a button opens the confirm dialog, and on confirm calls the mutation with the current `selectedIds` translated to `{ guestType, node, vmid }[]` (pull from the cluster-resources cache).
   - On mutation success, clear the selection and surface the progress panel. The user can keep browsing — the panel tracks itself.

**Documentation references**

- Hook template: `nexus/src/hooks/use-script-jobs.ts:52-133` (query + mutation + adaptive polling + CSRF header)
- Task icon helpers: `nexus/src/components/dashboard/task-list.tsx:7-37`
- Toast on error: `useToast().error(title, detail)` — same as backup editor and scheduler
- Status hints for errors: `hintForTask()` in `nexus/src/lib/task-hints.ts` — call when rendering a failed item's tooltip

**Verification**

- Select 3 running VMs across 2 nodes → Reboot → confirm → panel appears with 3 items, each transitioning pending→running→success over ~60s as PVE completes the tasks.
- Fail one deliberately (e.g., pick a VM that's already stopped and Shutdown it) → that item shows a red dot + error tooltip; the other two still succeed.
- Close the panel; cluster tasks list still reflects all three operations.
- `npx tsc --noEmit` clean
- `npx next lint` clean for new files
- No new `Date.now()`-in-render lint errors

**Anti-pattern guards**

- Do NOT use `react-hook-form` or `zod` in the snapshot name form. Match existing vanilla `useState` convention.
- Do NOT fetch cluster resources a second time for the action bar; read from the existing `useClusterResources()` query cache.
- Do NOT block the page while the batch runs. The confirm dialog closes on mutation success; the panel takes over.

---

## Phase 5 — Verification + integration

1. **Unit tests**
   - `bulk-ops.test.ts`: registry CRUD + GC edge cases
   - `run-bulk-op.test.ts`: concurrency cap, jitter, error isolation, watchdog timeout
   - `cron-match`-style table test for the target-validation helper (`validateTargets(raw): Target[]` throws structured errors)

2. **Manual smoke matrix** (record results in PR description):
   | Op | VM | CT | Mixed | Empty | 51 targets | Wrong ACL |
   |---|---|---|---|---|---|---|
   | start | ✓ | ✓ | ✓ | 400 | 400 | 403 |
   | stop | ✓ | ✓ | ✓ | 400 | 400 | 403 |
   | shutdown | ✓ | ✓ | ✓ | 400 | 400 | 403 |
   | reboot | ✓ | ✓ | ✓ | 400 | 400 | 403 |
   | snapshot | ✓ | ✓ | ✓ | 400 | 400 | 403 |

3. **Anti-pattern greps**
   - `rg "Promise\\.all\\(.*(reboot|shutdown|start|stop|snapshot)" nexus/src` → zero matches (orchestrator must stagger, not fan out)
   - `rg "fetch.*status/(reboot|shutdown|start|stop)" nexus/src` outside `proxmox-client.ts` → zero matches
   - `rg "optimisticUpdate|onMutate" nexus/src/hooks/use-bulk-lifecycle.ts` → zero matches
   - `rg "react-hook-form|zod" nexus/src/components/dashboard/bulk-action-bar.tsx nexus/src/components/dashboard/bulk-progress-panel.tsx` → zero

4. **Type + lint + tests gate**
   - `cd nexus && npx tsc --noEmit`
   - `cd nexus && npx next lint`
   - `cd nexus && npm test`
   - `npx gitnexus detect_changes --scope staged` confirms only expected symbols changed

5. **Exit criteria**
   - All 5 ops tested against real VMs + CTs
   - Manual cancel works (if Phase 2 implemented it)
   - Progress panel survives a browser refresh (the batch keeps running server-side; reopening polls it back)
   - No regression in single-action mutations on VM/CT detail pages

---

## Commit boundaries

- Phase 1 → one commit
- Phase 2 → one commit (lib + tests)
- Phase 3 → one commit (routes + rate-limit entry)
- Phase 4 → one commit (hooks + UI + wiring)
- Phase 5 → verification-only commit + summary in PR description

Tarball / deploy: Phase 2's new lib files land in `src/lib/` — already shipped by the [d58b721](d58b721) workflow fix. No CI changes needed.
