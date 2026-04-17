# Plan: Script Composition (Tier 5 — Automation, Phase E)

**Goal:** Users compose an ordered chain of Community Scripts — "Install Docker → Install Portainer → configure reverse proxy" — name it, optionally schedule it on a cron, and run it ad-hoc. Each step waits for the previous one to finish. On step failure the chain halts (or continues, per policy) and surfaces the exact failure through the existing script-jobs UI.

**Strategy:** Every primitive is in place — `runScriptJob()` is fire-and-forget, `getJob(id).status` is the completion signal, the scheduler already fires single jobs. What's new: a chain store, a server-side step runner that awaits each step, CRUD routes, a parametric scheduler so chains and single-script schedules share one tick, and the UI — composer modal, list page, progress panel.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs (use these)

| Capability | Symbol / Path | Use for |
|---|---|---|
| Fire-and-forget script | `runScriptJob({user, node, scriptUrl, scriptName, slug, method, env, timeoutMs, onClose?})` in `lib/run-script-job.ts` | Start each step |
| Read job status synchronously | `getJob(id)` in `lib/script-jobs.ts` | Poll server-side between steps |
| Validate | `validateScriptUrl`, `validateNodeName` in `lib/run-script-job.ts` | Re-run on every chain-create AND every chain-fire |
| ACL | `requireNodeSysModify(session, node)` in `lib/permissions.ts` | Enforce at chain-create per-step |
| Rate limit | `takeToken(sid, 'scripts.chains', limit, windowMs)` in `lib/rate-limit.ts` | POST /api/scripts/chains, /run |
| Scheduler loop | `startScheduler(fire)` in `lib/scheduler.ts` | Extend to accept a store param; one instance per record type |
| Cron matcher | `matchesCron(expr, date)` in `lib/cron-match.ts` | Re-used verbatim |
| Existing scheduled-job store | `lib/scheduled-jobs-store.ts` | Template for the chain store; don't union the two |
| Scripts index | `GET /api/scripts` → `CommunityScript[]` | Populate the composer's "+ add step" picker |
| Modal shell + step rows | `schedule-job-editor.tsx` | Copy-ready for the ChainEditor |
| List page template | `dashboard/schedules/page.tsx` | Copy-ready for `/dashboard/chains` |
| Step-icon vocabulary | `BulkProgressPanel` icon conventions | Copy the `itemIcon()` function for ChainProgressPanel |

### Anti-patterns (do NOT do these)

- **Do NOT** store chains inside `scheduled-jobs-store.ts` with a `steps[]` field. The single-script shape is stable and a different store keeps the concerns separate.
- **Do NOT** make `runScriptJob` synchronously await completion. It's fire-and-forget for a reason. The chain runner polls `getJob(jobId).status` with a bounded interval + watchdog.
- **Do NOT** skip per-step ACL/validate on chain-create. A chain is effectively a signed "run these scripts as me" token; every step gets the same gate as a direct manual run.
- **Do NOT** run steps in parallel. A chain is ordered by definition; parallelism is what bulk-lifecycle is for.
- **Do NOT** use `react-hook-form`/`zod`. Match the vanilla-useState convention of `schedule-job-editor.tsx`.
- **Do NOT** add a drag-and-drop library. Up/down arrow buttons per step are keyboard-accessible, zero-dep, and fine for v1.
- **Do NOT** toast per step. Toast once per chain run (success summary / first-failure detail). Per-step progress belongs in the floating panel.
- **Do NOT** swallow step errors silently. A failed step halts the chain by default; the record preserves which step failed and why.

### Key facts from discovery

- `runScriptJob` returns `{ jobId, startedAt }` and spawns a detached child. Status lands in `getJob(id).status` via the existing registry.
- `scheduler.ts` currently accepts one `fire` handler that takes a `ScheduledJob`. Phase 2 parameterises it over a store+record type so the same tick code runs both kinds.
- `scheduled-jobs-store.ts` is JSON-file-backed at `NEXUS_DATA_DIR/scheduled-jobs.json`. The chain store will land at `NEXUS_DATA_DIR/scheduled-chains.json`.
- All cloud-init/schedule/chain storage lives under `src/lib/` — already shipped by the CI tarball guard.
- No existing drag lib. Reorder UI uses `↑`/`↓` buttons. Steps limited to 10 per chain (sane ceiling — prevents runaway lists).

---

## Phase 1 — Chain store + chain runner + tests

**What to implement**

1. **Chain store** `nexus/src/lib/chains-store.ts`, mirroring `scheduled-jobs-store.ts`:
   ```ts
   export type ChainStepPolicy = 'halt-on-failure' | 'continue';
   export interface ChainStep {
     slug?: string;
     scriptUrl: string;
     scriptName: string;
     node: string;
     method?: string;
     env?: Record<string, string>;
     timeoutMs?: number;
   }
   export interface Chain {
     id: string;
     owner: string;
     name: string;
     description?: string;
     steps: ChainStep[];
     policy: ChainStepPolicy;
     /** Optional cron — chains can be scheduled OR run ad-hoc only. */
     schedule?: string;
     enabled: boolean;
     lastFiredAt?: number;
     /** jobIds from the last run, per-step, in order. */
     lastRun?: Array<{ stepIndex: number; jobId?: string; status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'; startedAt?: number; finishedAt?: number; error?: string }>;
     createdAt: number;
     updatedAt: number;
   }
   ```
   Exports: `list()`, `listForUser(user)`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)`, `markRun(id, run)`. Same JSON-file + atomic-rename + mutex pattern as the scheduled-jobs store — 95% code duplication is OK; the shapes are close but different enough that a shared abstraction would leak.

2. **Chain runner** `nexus/src/lib/run-chain.ts`:
   ```ts
   export async function runChain(chain: Chain, user: string): Promise<{ runId: string }>
   ```
   Fire-and-forget. Internally:
   - Stamps `chain.lastFiredAt = Date.now()` and initialises `lastRun[]` with `pending` entries for every step (via `markRun`).
   - For each step in order:
     1. Re-validate `validateScriptUrl(step.scriptUrl)` + `validateNodeName(step.node)`. Skip the step as `failed` with reason on validation error; continue or halt per policy.
     2. `markRun` the step to `running`, call `runScriptJob(...)`.
     3. Poll `getJob(jobId).status` every 2s with 30-min per-step watchdog. When terminal, update lastRun with `success`/`failed` + `finishedAt`.
     4. If failed and policy is `halt-on-failure`, mark remaining steps `skipped` and stop.
   - All writes go through `markRun` so the frontend's poll surfaces progress immediately.

3. **Tests**
   - `chains-store.test.ts`: CRUD, listForUser, ownership isolation (identical to scheduled-jobs-store's test shape).
   - `run-chain.test.ts`: with stubbed `runScriptJob` + `getJob` —
     - happy path: 3 steps all succeed, chain record ends with all `success`
     - fail on step 2 (halt policy): step 3 `skipped`
     - fail on step 2 (continue policy): step 3 still runs
     - timeout on step 1: item marked `failed` with watchdog reason
     - validation failure pre-run: step marked `failed` with "Invalid script URL" reason

**Documentation references**

- Store template: `lib/scheduled-jobs-store.ts:27-248`
- Runner template: `run-bulk-op.ts:orchestrate()` (worker pool → single-threaded sequential here)
- Job status polling shape: `script-jobs.ts:getJob()`
- Validation: `run-script-job.ts:validateScriptUrl`, `validateNodeName`

**Verification**

- `tsc --noEmit` clean; tests green; 110+ total passing

**Anti-pattern guards**

- Do NOT block on the overall chain completion — `runChain` returns after setting up the async loop.
- Do NOT forget to release the halt-on-failure state between runs (reset `lastRun` each fire).
- Do NOT re-use `BulkBatch` shapes. Bulk is about unordered parallelism; chains are about ordered sequence.

---

## Phase 2 — Parametric scheduler + API routes

**What to implement**

1. **Generalize `scheduler.ts`** to take a store+fire pair:
   ```ts
   export interface SchedulerSource<T extends { id: string; schedule?: string; enabled: boolean; lastFiredAt?: number }> {
     list(): Promise<T[]>;
     markFired(id: string, at: number): Promise<void>;
   }
   export function startScheduler<T extends {...}>(source: SchedulerSource<T>, fire: (record: T) => Promise<void>): () => void
   ```
   The current server.ts call stays — but now passes the scheduled-jobs store explicitly. Add a second `startScheduler` call in server.ts for chains.

2. **Chain API routes** under `nexus/src/app/api/scripts/chains/`:
   - `route.ts` — `GET` (list owned) + `POST` (create, validates every step, ACL-checks each unique target node, rate-limits).
   - `[id]/route.ts` — `GET` (detail, 404 on not-yours), `PATCH` (edit), `DELETE`.
   - `[id]/run/route.ts` — `POST` (fire now) → `{ runId }`. Still validates, still ACL-checks.

3. **New rate-limit bucket** `RATE_LIMITS.scriptsChains = { limit: 30, windowMs: 60_000 }` (generous — chain creates are rare; ad-hoc runs may cluster).

4. **Server.ts** gains:
   ```ts
   startScheduler(chainsStore, async (chain) => { await runChain(chain, chain.owner); });
   ```
   Mounted alongside the existing scheduled-jobs scheduler. Both share the 60s tick cadence.

**Documentation references**

- Existing scheduler tick: `scheduler.ts:34-67`
- Existing route conventions: `api/scripts/schedules/route.ts`, `api/scripts/schedules/[id]/route.ts`
- Rate-limit keys: `lib/rate-limit.ts:RATE_LIMITS`

**Verification**

- Two scheduler instances running simultaneously on dev; a manual row in each store fires without interfering with the other
- POST chain with 1 step → row appears in `listForUser`
- POST run on that chain → `lastRun` populates, step status advances through `pending → running → success`
- `tsc --noEmit` clean

**Anti-pattern guards**

- Do NOT share mutable state between scheduler instances (Redis key collisions, shared timers). Each instance gets its own `globalThis.__nexusSchedulerTimer_X` handle or distinct keys — spell it out explicitly.
- Do NOT skip validation on the run-now endpoint. Even for an owner who created the chain, the scriptUrl might have been allow-listed-out since.

---

## Phase 3 — ChainEditor + ScriptPicker + /dashboard/chains

**What to implement**

1. **`ScriptPicker` component** at `nexus/src/components/scripts/script-picker.tsx`: a sub-modal that lists community scripts (`GET /api/scripts`) with search + category filter. Emits a selected `CommunityScript`. Extracted from the left rail of the existing scripts page but standalone so both the ad-hoc run flow and the chain composer can use it.

2. **`ChainEditor`** at `nexus/src/components/chains/chain-editor.tsx`:
   - Same modal shell as `schedule-job-editor.tsx` (responsive, mobile-fullscreen).
   - Top: name + description inputs, optional `<CronInput>` (blank = ad-hoc only).
   - Middle: ordered step list. Each row shows `<step number> <script name>  [node picker] [↑] [↓] [×]`. Adding uses `<ScriptPicker>` in a nested modal.
   - Policy select: Halt on failure (default) / Continue.
   - Enabled checkbox (only meaningful when `schedule` is set).
   - Save / Cancel.

3. **`/dashboard/chains/page.tsx`** — list view copied from `dashboard/schedules/page.tsx`:
   - Summary stats (total, enabled, recent-runs)
   - Row per chain with toggle / edit / delete / run-now
   - "New chain" header button

4. **Sidebar entry**: `{ href: '/dashboard/chains', label: 'Script Chains', icon: Zap }` under Core after "Scheduled Jobs".

**Documentation references**

- Modal shell + form idioms: `schedule-job-editor.tsx`
- List-page template: `dashboard/schedules/page.tsx`
- Script metadata type: `CommunityScript` in `types/proxmox.ts` (or `lib/community-scripts.ts`)
- Hooks + CSRF: `hooks/use-scheduled-jobs.ts` (one-to-one shape match — copy and swap the endpoint)

**Verification**

- Build clean; new hook file `hooks/use-chains.ts` typechecks
- Navigating to /dashboard/chains renders an empty-state card
- Creating a chain with 2 steps persists and appears in the list
- Editing reorder-arrows shuffle steps and save correctly
- Mobile 375px: modal fullscreen, step rows stack readably

**Anti-pattern guards**

- Do NOT preload every script's manifest in the picker. Only the list index from `/api/scripts` is needed.
- Do NOT skip per-step node validation client-side. Regex + required. Server re-validates, but early feedback is cheaper than a 400.
- Do NOT allow saving a chain with zero steps.

---

## Phase 4 — ChainProgressPanel + wiring

**What to implement**

1. **`ChainProgressPanel`** at `nexus/src/components/chains/chain-progress-panel.tsx`:
   - Floating card, bottom-right, sits above `JobStatusBar`.
   - Uses `useChains()` list query to find the chain whose `lastRun` has non-terminal steps.
   - Shows chain name + `N/M steps` + a list of per-step rows with status icon (pending / running / success / failed / skipped) from the existing BulkProgressPanel icon vocabulary.
   - Dismiss = hide until next run; auto-hides 30s after all terminal.

2. **Hook** `nexus/src/hooks/use-chains.ts` — list/detail/create/update/delete/run mutations. Adaptive polling: 2s if any chain has non-terminal lastRun, 30s otherwise.

3. **Wire "Run now"** button on the chains list page + a new button on the scripts page detail section (next to Run and Schedule) that opens the chain editor pre-populated with the current script as step 1 ("Start a chain from this script").

4. **Mount `ChainProgressPanel`** in `(app)/layout.tsx` alongside `JobStatusBar`.

**Documentation references**

- BulkProgressPanel: `components/dashboard/bulk-progress-panel.tsx` (icon + dismiss pattern)
- JobStatusBar positioning: `components/script-jobs/JobStatusBar.tsx` (same bottom-right stack; ChainProgressPanel uses `bottom-[max(1rem,env(safe-area-inset-bottom))] right-4` with a lower z than JobStatusBar so they never occlude each other — stack vertically if both active)

**Verification**

- Fire a chain → panel appears with pending rows → rows transition live → panel turns green on completion → auto-dismisses
- Failing step: that step shows red, remaining show `skipped` under halt policy; toast surfaces the failure summary once
- Mobile 375px: panel fits viewport (the `max-w-[calc(100vw-2rem)]` pattern from JobStatusBar)

**Anti-pattern guards**

- Do NOT mount the panel in every page; parent layout once, auto-detects active runs.
- Do NOT keep polling after all chains have terminal lastRun — stop at 30s idle cadence.

---

## Phase 5 — Verification

**Checks**

1. **Unit tests** pass: Phase 1's chain store + runner.
2. **Type + lint gate**: `tsc --noEmit` clean; `next lint` clean on edited files.
3. **Full test suite**: `npm test` — all existing + new tests pass.
4. **Anti-pattern greps**
   - `rg "react-hook-form|from 'zod'" nexus/src/components/chains` → zero
   - `rg "BulkBatch" nexus/src/lib/chains-store.ts nexus/src/lib/run-chain.ts` → zero (no shape leak)
   - `rg "Promise\\.all\\(" nexus/src/lib/run-chain.ts` → zero (sequential, not parallel)
   - `rg "chains|run-chain|chain-editor" nexus/server.ts` → expect ≥1 (scheduler wire-up) but no deep transitive-typeless imports
5. **Manual smoke matrix**
   | Case | Expected |
   |---|---|
   | Create chain with 3 steps, all same node | Persists; appears in list |
   | Run now | Panel shows live progress; toast on completion |
   | Step 2 fails, halt policy | Step 3 `skipped`; chain record shows which step and error |
   | Step 2 fails, continue policy | Step 3 still runs |
   | Schedule the chain with `*/5 * * * *` | Scheduler fires every 5 min; `lastRun` updates in list |
   | Edit reorder with arrows, save | Re-open shows new order |
   | Delete | Row disappears, scheduler stops firing it |
   | Mobile 375px | Editor modal fullscreen, step rows stack |
6. **Import-graph sanity**: `server.ts` imports only `chains-store`, `run-chain`, `scheduler`. No UI modules reachable.

**Exit criteria**

- Smoke matrix passes on a real Proxmox host
- Existing Scheduled Jobs feature unchanged (regression-free)
- Existing script-jobs status bar still works (ChainProgressPanel sits above, not in place of)

---

## Commit boundaries

- Phase 1 → one commit (chains-store + run-chain + tests)
- Phase 2 → one commit (scheduler generalization + routes + server.ts wire)
- Phase 3 → one commit (ScriptPicker + ChainEditor + /dashboard/chains + sidebar)
- Phase 4 → one commit (ChainProgressPanel + hook + integration)
- Phase 5 → verification-only commit with smoke-matrix notes

All new files land in `src/lib/`, `src/hooks/`, `src/components/chains/`, `src/components/scripts/`, `src/app/(app)/dashboard/chains/`. Tarball already ships `src/lib/**`; no CI changes.
