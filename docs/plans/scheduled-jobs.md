# Plan: Scheduled Community Scripts (Tier 5 — Automation, Phase A)

**Goal:** Let users schedule Community Scripts to run on a cadence (cron). Feature spans: PocketBase schedule collection, an in-process tick loop in the Next.js server, three API routes, a "Schedule" button/modal on the scripts page, and a `/dashboard/schedules` list view.

**Strategy:** **Copy from existing patterns, don't invent.** Every phase below cites the exact file and line range to copy. No new npm dependencies.

---

## Phase 0 — Documentation Discovery (COMPLETE)

Record the allowed APIs and anti-patterns surfaced during discovery. Every implementation phase must obey this list.

### Allowed APIs (use these, do not invent alternatives)

| Capability | Symbol / Path | Use for |
|---|---|---|
| Run a script on a node | `runScriptOnNode(node, script, opts)` in `nexus/src/lib/remote-shell.ts:109` | One-shot execution with captured stdout/stderr |
| Stream a script | `spawnScriptStream(node, script)` in `nexus/src/lib/remote-shell.ts` | If you need a ChildProcess to wire logs |
| Register a job | `createJob(input)` in `nexus/src/lib/script-jobs.ts:91` | Get a jobId + log fd |
| Finalize a job | `finaliseJob(id, status, exitCode)` in `nexus/src/lib/script-jobs.ts:135` | On process exit |
| Append job output | `appendTail(id, chunk)` in `nexus/src/lib/script-jobs.ts:124` | Per stdout/stderr chunk |
| Env filter | `sanitiseEnv(raw)` / `buildEnvPreamble(env)` in `nexus/src/lib/script-jobs.ts` | Keep envvar handling identical to manual runs |
| Audit a run | `writeAuditEntry(input)` in `nexus/src/lib/exec-audit.ts` | Every scheduled fire must audit |
| PVE ACL check | `requireNodeSysModify(user, node)` (see usage in `nexus/src/app/api/scripts/run/route.ts:280`) | Permissions on create/update endpoints |
| CSRF + session | `getSessionId()`, `getSession()` (see `api/scripts/run/route.ts:235-241`) | All mutation endpoints |
| Cron UI | `<CronInput value onChange>` in `nexus/src/components/dashboard/cron-input.tsx` | Cadence picker — do not build another |
| Toast | `useToast()` hook (used in `backup-job-editor.tsx:59-67`) | Success/error feedback |
| Query hooks factory pattern | `nexus/src/hooks/use-script-jobs.ts:1-140` | Query + mutation + invalidation |

### Anti-patterns (do NOT do these)

- **Do NOT** add `node-cron`, `bullmq`, `agenda`, or any scheduler dependency. PocketBase + a `setInterval` tick is the chosen approach (verified: no scheduler lib is installed; discovery §C).
- **Do NOT** write to `/etc/systemd/system/` or call `systemctl`. Scheduling stays in-process.
- **Do NOT** bypass the origin whitelist for `scriptUrl`. The raw-URL validator in `api/scripts/run/route.ts:254-278` is the template — reuse it verbatim for schedule create/update.
- **Do NOT** pass the script via argv to SSH. `remote-shell.ts` always pipes script text over stdin (`bash -s`) — preserve this.
- **Do NOT** use `react-hook-form` or `zod` for the scheduler form. Existing job editors use vanilla `useState` (see `backup-job-editor.tsx:23-36`). Match the convention.
- **Do NOT** skip `writeAuditEntry` for scheduled executions. Manual runs audit at `api/scripts/run/route.ts:345-355`; scheduled runs must too, with `endpoint: 'scripts.run'` (reuse the existing enum).
- **Do NOT** invent fields on the PocketBase `script_scripts` collection. Scheduled-job records belong in a new `scheduled_script_jobs` collection — keep concerns separated.
- **Do NOT** run the tick loop in Next.js route handlers or React Server Components. The tick must live in `nexus/server.ts` (custom server, one process).

### Key facts

- Job state is in-memory (`Map` in `script-jobs.ts:72`) with per-job log files in tmpdir, 24h TTL. Scheduled fires reuse this — no DB persistence of per-fire logs needed for now.
- Community scripts are fetched from PocketBase (`community-scripts.ts:152-218`). A scheduled job stores `slug` + `scriptUrl` (snapshot) so a deleted script doesn't orphan the schedule.
- Audit logging is two-tier (SAFE plaintext + SECRET RSA-wrapped AES-GCM). `writeAuditEntry` handles both.
- Dev HMR will re-register the tick; a 60-second granularity absorbs skew.

---

## Phase 1 — PocketBase schema + scheduler tick

**What to implement**

1. Create a new PocketBase collection named `scheduled_script_jobs` with fields:
   - `id` (auto)
   - `owner` (text, indexed) — PVE userid, e.g. `root@pam`
   - `slug` (text) — community script slug
   - `scriptUrl` (text) — full `raw.githubusercontent.com` URL (must pass the same validator as manual runs)
   - `scriptName` (text) — display label
   - `node` (text, indexed) — target Proxmox node name
   - `method` (text, optional) — install method type ("default", "alpine", etc.)
   - `env` (json, optional) — sanitized envvars
   - `timeoutMs` (number, optional)
   - `schedule` (text) — cron expression (5-field: minute hour dom month dow)
   - `enabled` (bool, default true, indexed)
   - `lastFiredAt` (number, optional) — epoch ms
   - `lastJobId` (text, optional)
   - `created` / `updated` (auto)

2. Add a cron matcher utility at `nexus/src/lib/cron-match.ts`:
   - Exports `matchesCron(expr: string, date: Date): boolean`
   - Supports the subset already generated by `<CronInput>`: `*`, `N`, `N,N`, `N-M`, `*/N` per field
   - No new dep; ~60 lines. The `cron-input.tsx` `joinCron`/`parseCron` helpers are the reference for supported syntax.

3. Add the tick loop in `nexus/server.ts` (find the block after `app.prepare().then(...)` that starts the HTTP server):
   - Every 60s: fetch `scheduled_script_jobs` where `enabled=true` and (`lastFiredAt=null` or `lastFiredAt < now - 55s`)
   - For each record: if `matchesCron(schedule, new Date())`, fire the script via the **shared executor** introduced in Phase 2 (see below) — do NOT duplicate spawn logic here
   - After fire: update the record with `lastFiredAt = Date.now()` and `lastJobId`
   - Skip silently on fetch errors (log once); do not crash the server

**Documentation references**

- Tick placement: look at the relay GC `setInterval` in `nexus/server.ts` — same lifecycle pattern
- Cron syntax supported: `nexus/src/components/dashboard/cron-input.tsx` (the builder never emits anything outside the documented subset)
- PocketBase client usage: `nexus/src/lib/community-scripts.ts:152-218` (pagination, filter strings)

**Verification**

- `cd nexus && npx tsc --noEmit` passes
- Unit test for `matchesCron`: at least 10 cases covering each operator (`*`, list, range, step); use `vitest` if installed, otherwise a simple `.test.ts` run via `tsx`
- Start dev server, manually insert a row with `schedule = "* * * * *"`, confirm server logs a fire within 60s and `lastFiredAt` updates

**Anti-pattern guards**

- Do NOT fire a second time inside the same minute (use `lastFiredAt` guard: skip if `now - lastFiredAt < 55_000`)
- Do NOT hold PocketBase records in memory between ticks — re-fetch each tick so UI edits take effect immediately
- Do NOT use `node-cron` or any cron parser from npm; keep `matchesCron` local

---

## Phase 2 — Shared executor + API routes

**What to implement**

1. **Extract shared executor.** The manual-run route `nexus/src/app/api/scripts/run/route.ts` currently contains: validation → ACL → rate limit → `createJob` → `spawnDetached` → audit. Refactor lines 254-357 into an exported helper `runScriptJob(ctx)` in a new `nexus/src/lib/run-script-job.ts`, where `ctx` carries: `{ user, node, scriptUrl, slug, scriptName, method, env, timeoutMs }`. Manual route calls it; Phase 1 tick also calls it. Both paths audit via `writeAuditEntry`.

2. **Create API routes** at `nexus/src/app/api/scripts/schedules/`:
   - `route.ts` with `GET` (list schedules for current user) and `POST` (create)
   - `[id]/route.ts` with `PATCH` (toggle enabled, update fields) and `DELETE`

3. **Validation in POST/PATCH:**
   - Reuse the node regex and `scriptUrl` origin/pathname checks from `api/scripts/run/route.ts:254-278` — copy the block, do not re-derive
   - Additionally validate `schedule` with `matchesCron(schedule, new Date())` called as a parse check (wrap in try/catch, reject invalid)
   - Reject if `enabled=true` and cron syntax fails

4. **Auth + CSRF:** every mutation route uses the exact pattern from `api/scripts/run/route.ts:235-241`. GET may skip CSRF but still requires session.

5. **Permissions:** on POST and PATCH when `node` changes, call `requireNodeSysModify(user, node)` — same as manual run.

**Documentation references**

- Validation block to copy: `nexus/src/app/api/scripts/run/route.ts:254-278`
- Auth pattern: `nexus/src/app/api/scripts/run/route.ts:235-241`
- Rate-limit pattern: `nexus/src/app/api/scripts/run/route.ts:287-310` — apply to POST (create) only, with a lower quota than manual runs
- PocketBase list/create/update/delete: `nexus/src/lib/community-scripts.ts` paginates; do the same for list

**Verification**

- `cd nexus && npx tsc --noEmit` passes
- `curl` the GET endpoint with a session cookie, expect 200 + array
- POST a schedule with an invalid cron — expect 400
- POST with a non-whitelisted `scriptUrl` — expect 400 matching the manual-run behavior
- Manually-run route still works end-to-end after the executor extraction (create a job, see it finish)

**Anti-pattern guards**

- Do NOT duplicate spawn/audit logic in route handlers — everything goes through `runScriptJob`
- Do NOT return other users' schedules in GET; filter by session userid
- Do NOT expose the raw PocketBase record — project to a DTO (`ScheduledJobDto`) so fields stay stable if the collection changes

---

## Phase 3 — UI: Schedule button + modal on the scripts page

**What to implement**

1. **New component** `nexus/src/components/scripts/schedule-job-editor.tsx`. **Copy the structure of** `nexus/src/components/backups/backup-job-editor.tsx:1-232` and replace backup-specific fields (`storage`, `mode`, `compress`) with scheduled-job fields (`node`, `method`, optional `env` JSON textarea, `enabled` checkbox). Keep:
   - Vanilla `useState` for each field (lines 23-36 of the backup editor are the template)
   - `<CronInput value={schedule} onChange={setSchedule} />` for cadence
   - Modal shell: `fixed inset-0 ... studio-card p-6 max-w-lg`
   - `useMutation` with `onSuccess`/`onError` toasts
   - Submit button pattern with `Loader2` spinner

2. **Add a "Schedule" button** on `nexus/src/app/(app)/scripts/page.tsx` next to the existing Run button (around line 555). Use `<Clock />` from lucide-react. Clicking opens the editor pre-populated with the currently selected script + node.

3. **New hooks** in `nexus/src/hooks/use-scheduled-jobs.ts`. Copy the shape of `use-script-jobs.ts:1-140`:
   - `useScheduledJobs()` — query `['scheduled-jobs', 'list']`
   - `useCreateScheduledJob()` — mutation, POST, invalidates list
   - `useUpdateScheduledJob()` / `useDeleteScheduledJob()` — PATCH / DELETE
   - CSRF token from `readCsrfCookie()`, same helper as existing hooks use

**Documentation references**

- Form layout + submit button: `nexus/src/components/backups/backup-job-editor.tsx:91-231`
- CronInput usage: `nexus/src/components/backups/backup-job-editor.tsx:101`
- Scripts page action pattern: `nexus/src/app/(app)/scripts/page.tsx:414-559`
- Hook pattern: `nexus/src/hooks/use-script-jobs.ts`
- Toast pattern: `nexus/src/components/ui/useToast` (as imported in the backup editor)

**Verification**

- Start dev server, open `/scripts`, click a script, click new **Schedule** button, fill form, submit. Toast confirms. Close modal, reopen, confirm persistence.
- Submit with invalid cron — toast shows server validation error.
- `npx tsc --noEmit` passes.

**Anti-pattern guards**

- Do NOT introduce `react-hook-form` or `zod` — match the vanilla `useState` convention.
- Do NOT recreate `<CronInput>` — import and use it.
- Do NOT hardcode `node` options — fetch from the existing cluster hook (see `use-cluster.ts`).
- Do NOT duplicate `studio-card` styles — reuse the class name directly.

---

## Phase 4 — UI: `/dashboard/schedules` list page

**What to implement**

1. **New route** `nexus/src/app/(app)/dashboard/schedules/page.tsx`. Copy the layout pattern of `nexus/src/app/(app)/dashboard/page.tsx`:
   - Header row with title "Scheduled Jobs", subtitle, a "New schedule" button that opens `ScheduleJobEditor` with no script pre-selected (user picks from a searchable list)
   - Summary stats row: total schedules, enabled count, last-fired-within-24h count — three `StatCard` widgets
   - Grid of rows, one per schedule, using `studio-card rounded-lg p-5` per-row pattern from `node-card.tsx`
   - Each row shows: script name + slug, node, human-readable cadence (convert cron → label using the presets in `cron-input.tsx` where possible), last fired timestamp, status dot for enabled/disabled
   - Row actions: toggle enabled (optimistic update), edit (opens editor), delete (confirm dialog — reuse an existing confirm pattern if one exists in the codebase; otherwise a simple `window.confirm`)

2. **Wire up the hooks** from Phase 3. Use `qc.invalidateQueries(['scheduled-jobs', 'list'])` after every mutation.

3. **Link from sidebar/nav**: add a nav entry so `/dashboard/schedules` is reachable. Find the sidebar definition by grepping for `/dashboard/nodes` in the navigation config and add a sibling entry.

**Documentation references**

- Page layout: `nexus/src/app/(app)/dashboard/page.tsx:1-112`
- Row visuals: `nexus/src/components/dashboard/node-card.tsx:40-119`
- Status dot: `nexus/src/components/ui/` (as used in `node-card.tsx`)
- StatCard: `nexus/src/components/ui/` (as used throughout dashboard)

**Verification**

- Navigate to `/dashboard/schedules`, see the new page renders without errors
- Create a schedule via the header button — it appears in the list without a manual refresh (query invalidation works)
- Toggle enabled — UI updates immediately and persists after hard refresh
- Delete — row disappears and is absent on reload
- `npx tsc --noEmit` passes
- `npx next lint` passes (or whatever lint is configured in the repo)

**Anti-pattern guards**

- Do NOT build a new table primitive — cards or a minimal `<table>` with existing utility classes is sufficient.
- Do NOT fetch the community-scripts index on this page unless a schedule lacks its cached `scriptName` (the snapshotted `scriptName` should be enough for display).
- Do NOT add client-side cron parsing libraries for the "human-readable" label — use a small inline lookup against the presets in `cron-input.tsx`, falling back to showing the raw expression.

---

## Phase 5 — Verification & Integration

**What to verify (end-to-end)**

1. **Scheduler fires on time**
   - Insert a schedule with `* * * * *` (every minute), `enabled=true`
   - Observe two consecutive fires 60±5 s apart
   - Confirm `lastFiredAt` advances each fire

2. **Audit log captures scheduled fires**
   - After a scheduled fire, tail `/var/log/nexus/exec.jsonl`: new `SafeEntry` with `endpoint: 'scripts.run'`, `user` = the schedule's owner, correct `node`
   - Confirm the matching SECRET entry exists in `/var/log/nexus/exec-commands.enc.jsonl`
   - Decrypt one entry via `scripts/nexus-audit-decrypt.ts`, confirm plaintext matches the expected script URL

3. **Validation parity with manual runs**
   - Attempt to POST a schedule with a `scriptUrl` outside `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/…` → 400
   - Attempt with node regex violation → 400
   - Attempt as a user without `requireNodeSysModify` for the target node → 403

4. **Persistence across restart**
   - Create a schedule, restart the Next.js server
   - Confirm the tick resumes and fires still occur after warm-up

5. **Job visibility**
   - A scheduled fire produces a `jobId` retrievable from `useScriptJobs()` (same existing hook)
   - Logs show up in the existing script-logs panel

6. **Grep for anti-patterns before considering the feature done**
   - `rg "node-cron|bullmq|agenda" nexus/package.json` — must return zero
   - `rg "systemctl|/etc/systemd" nexus/src` — must return zero outside docs
   - `rg "react-hook-form|zod" nexus/src/components/scripts/schedule-job-editor.tsx` — must return zero
   - `rg "exec\\(.*bash.*-c" nexus/src/lib/run-script-job.ts` — must return zero (script must go via stdin)

7. **Type + lint gates**
   - `cd nexus && npx tsc --noEmit` passes
   - `cd nexus && npx next lint` (or configured lint) passes
   - Run `npx gitnexus detect_changes --scope staged` per CLAUDE.md before commit; confirm only expected symbols/flows changed

**Exit criteria for the feature**

- All 7 checks above pass
- Manual "Run once" still works exactly as before (no regression in `api/scripts/run`)
- At least one scheduled job has been created, fired, audited, edited, disabled, re-enabled, and deleted in a manual smoke test

---

## Execution notes

- Each phase is self-contained. A subagent running Phase N in a fresh chat can work from this file plus the referenced source lines.
- If any phase discovers a missing prerequisite (e.g., PocketBase admin access for schema migration), halt that phase and surface it — do NOT improvise a workaround.
- Commit boundary: one commit per phase is fine; Phase 2 may split into two commits (executor extraction, then new routes) for review clarity.
