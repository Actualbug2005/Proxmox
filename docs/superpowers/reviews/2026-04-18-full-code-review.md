# Nexus Full Code Review — 2026-04-18

**Scope:** whole codebase (`nexus/`, `server.ts`, `src/`, tests, installer, docs)
**Method:** layered parallel audit — 6 specialist agents + Semgrep (642 rules across p/typescript, p/security-audit, p/javascript, p/owasp-top-ten, p/command-injection, p/jwt, p/xss, p/nodejs) + GitNexus structural queries + tsc / lint / test / npm audit.
**Baseline at time of review:** commit `9b1bade`, branch `main`, working tree clean, 129/129 tests passing.

---

## Executive summary

Overall the Nexus codebase is in **good structural health** for a 35 KLOC TypeScript system with a non-trivial security model (Proxmox proxy + SSH exec + encrypted audit + CSRF double-submit + JWT sessions). The automated checks are clean — zero runtime vulns from npm audit, tsc clean under strict mode, Semgrep finds one expected warning (`rejectUnauthorized: false` against PVE's self-signed cert, which is isolated to a scoped undici Agent in [pve-fetch.ts](../../nexus/src/lib/pve-fetch.ts)). Tests and code intelligence both indicate disciplined centralization (`cn` → 82 callers, `getSession` → 35, `validateCsrf` → 19, `readCsrfCookie` → 18 — all healthy).

The **top five systemic issues** — drawn from six agents in independent review — converge on:

1. **Silent error propagation.** Many `catch` blocks log to stderr but do not surface failures to operators (audit-write failures, ticket renewal failures, permission probe errors). No `/api/system/health` endpoint exists to make degraded state visible.
2. **Boilerplate duplication at route + hook boundaries.** 26 route handlers and 14 mutation hooks repeat the same auth/CSRF/invalidate/toast dance — ripe for `withCsrf(handler)` HOF and `useCsrfMutation<T>` hook.
3. **Design-token drift.** 40 component files hardcode tailwind zinc/red/emerald/amber palettes that already have `--color-*` tokens. The light "Frosted Glass" theme will invert incorrectly on these surfaces.
4. **Poll-interval single-source-of-truth not enforced.** `POLL_INTERVALS` is honored at 2 sites; 25 sites hardcode their own `refetchInterval`.
5. **Critical security primitives are untested.** `csrf.ts`, `exec-audit.ts`, `permissions.ts`, `auth.ts`, `remote-shell.ts`, `rate-limit.ts` — all trust-boundary code, none have unit tests.

None of these indicate architectural defect — they are pattern drift from a codebase that has been growing fast. The remediation plan at the bottom ranks every finding by impact × effort.

---

## 1. Automated checks

| Check | Result | Notes |
|-------|--------|-------|
| `npm test` | ✅ 129/129 across 27 suites | `node --test`, tsx loader, 586ms |
| `tsc --noEmit` | ✅ exit 0 | Strict mode, no errors |
| `npm audit` (runtime) | ✅ 0 vulnerabilities | info/low/moderate/high/critical all 0 |
| Semgrep (642 rules) | 1 finding | [`pve-fetch.ts:37`](../../nexus/src/lib/pve-fetch.ts) — `rejectUnauthorized: false` inside a *scoped* undici Agent. Intentional and well-documented; a prior security audit specifically removed the process-global `NODE_TLS_REJECT_UNAUTHORIZED` in favor of this. **Accept.** |
| `npm run lint` | ❌ **18 errors**, 19 warnings | See §2 |

### 2. ESLint errors (must-fix)

**10 × `react-hooks/set-state-in-effect`** (cascading render anti-pattern):
- [src/app/(app)/console/page.tsx:33](../../nexus/src/app/(app)/console/page.tsx#L33)
- [src/app/(app)/dashboard/system/layout.tsx:14](../../nexus/src/app/(app)/dashboard/system/layout.tsx#L14)
- [src/app/(app)/scripts/page.tsx:429](../../nexus/src/app/(app)/scripts/page.tsx#L429)
- [src/components/backups/backup-job-editor.tsx:44, 56](../../nexus/src/components/backups/backup-job-editor.tsx)
- [src/components/dashboard/backups-tab.tsx:54](../../nexus/src/components/dashboard/backups-tab.tsx#L54)
- [src/components/dashboard/cron-input.tsx:52](../../nexus/src/components/dashboard/cron-input.tsx#L52)
- [src/components/firewall/firewall-options-tab.tsx:25](../../nexus/src/components/firewall/firewall-options-tab.tsx#L25)
- [src/components/storage/restore-dialog.tsx:39](../../nexus/src/components/storage/restore-dialog.tsx#L39)

**Fix pattern:** replace `useEffect(() => setX(…))` with either a derived `useMemo` value or move the initialization into the state initializer.

**8 × `react-hooks/static-components`** (component created during render):
- [src/app/(app)/dashboard/cts/page.tsx:187–190](../../nexus/src/app/(app)/dashboard/cts/page.tsx#L187) (4×)
- [src/app/(app)/dashboard/vms/page.tsx:191–194](../../nexus/src/app/(app)/dashboard/vms/page.tsx#L191) (4×)

**Fix:** hoist the inner components outside the render body or `React.memo` them.

**1 × `@typescript-eslint/no-explicit-any`**:
- [src/app/api/nas/shares/route.ts:69](../../nexus/src/app/api/nas/shares/route.ts#L69) — `function validateCreatePayload(body: any)`. Replace with `unknown` and narrow.

**19 warnings** — all unused `eslint-disable` directives (legacy `no-var` overrides that are no longer needed) and unused type imports in [proxmox-client.ts](../../nexus/src/lib/proxmox-client.ts) (`BackupJobParams`, `FirewallRuleParams`, `StorageUpdatePayload`, `decodeIPSetEntry`). Fix with `--fix` where applicable.

---

## 3. Silent failures — backend risk surface

Silent-failure-hunter identified **34 findings** across `src/app/api/**`, `src/lib/**`, and `server.ts`. Grouped by severity:

### HIGH (10)

| ID | File:Line | Issue |
|----|-----------|-------|
| H1 | [run-script-job.ts:287](../../nexus/src/lib/run-script-job.ts#L287), [api/exec/route.ts:131](../../nexus/src/app/api/exec/route.ts#L131) | Audit-log write failures are logged to stderr only. Disk-full / pubkey EACCES / NFS dc → exec happens with **no forensic record**. |
| H2 | [auth.ts:111](../../nexus/src/lib/auth.ts#L111) | `refreshPVESessionIfStale` swallows renewal errors and returns stale session. No back-off — every subsequent request retries and pays an extra PVE round-trip. |
| H3 | [run-bulk-op.ts:146](../../nexus/src/lib/run-bulk-op.ts#L146) | Bulk op `pollTask` catch is unqualified. A permanent 403/404 becomes 450 identical stderr lines over 15 minutes, then a generic "timeout" surfaces. |
| H4 | [scheduler.ts:82](../../nexus/src/lib/scheduler.ts#L82) | Scheduler stamps `lastFiredAt` on failure → dedup works, but schedules silently never run again with no UI signal. Need `lastFireError` + `consecutiveFailures` + auto-disable after N. |
| H5 | [permissions.ts:33](../../nexus/src/lib/permissions.ts#L33) | `userHasPrivilege` fails closed on *all* errors — correct for security, catastrophic for UX when PVE schema drifts (every user suddenly gets 403s with one stderr line as the only signal). |
| H6 | [api/scripts/[slug]/route.ts:63](../../nexus/src/app/api/scripts/%5Bslug%5D/route.ts#L63), [community-scripts.ts:464](../../nexus/src/lib/community-scripts.ts#L464) | Malformed PocketBase response collapses into 404 "manifest not found" same as legitimate empty result. Should differentiate parse vs. empty. |
| H7 | [server.ts:137](../../nexus/server.ts#L137) | `proxmox-ws` 8s timeout timer is never cleared on success — late-OPEN fires `terminate()` on a live socket. |
| H8 | [api/proxmox/[...path]/route.ts:170](../../nexus/src/app/api/proxmox/%5B...path%5D/route.ts#L170) | Response uses `res.text()` — binary payloads (noVNC tickets, raw log bytes, vzdump manifests) silently become U+FFFD garbage. Stream the body instead. |
| H9 | [session-store.ts:38](../../nexus/src/lib/session-store.ts#L38) | If `REDIS_URL` is set but Redis is unreachable, every login fails with 500 and the only signal is stderr spam. No auto-fallback to memory backend. |
| H10 | [api/proxmox/[...path]/route.ts:181](../../nexus/src/app/api/proxmox/%5B...path%5D/route.ts#L181) | Any 401 from PVE clears the session cookie — even per-operation permission denials. Produces mysterious random logouts. Should only clear on actual ticket-expiry paths. |

### MEDIUM (18)

Full list in the agent output — key themes:

- **Silent DTO drops:** `sanitiseEnv` rejected keys lost by schedule-create and chain-create paths ([M7](../../nexus/src/app/api/scripts/schedules/route.ts#L122)). Users never learn their `PATH=…` was stripped.
- **Coerce-on-error fallbacks:** `readCurrentVersion` returns `'dev'` on any fs error ([M8](../../nexus/src/app/api/system/version/route.ts#L30)); `readJobLog` returns `job.tail` on any fs error hiding corruption ([M4](../../nexus/src/lib/script-jobs.ts#L168)); `exec` route returns `{exitCode: 1}` with HTTP 200 for both "command ran and failed" and "ssh refused" ([M11](../../nexus/src/app/api/exec/route.ts#L116)).
- **Relay-session cleanup gaps:** GC'd sessions emit no log line ([M16](../../nexus/server.ts#L152)); pveWs `error` event doesn't clean up the map ([M18](../../nexus/server.ts#L119)).
- **GitHub rate-limit burn:** `fetchLatestRelease` caches `null` for 60s on 403, then immediately retries forever without differentiating rate-limit from other errors ([M9](../../nexus/src/app/api/system/version/route.ts#L39)).
- **PB schema drift:** `proxmox-ws` route does `(await res.json()) as ...` without a shape check — uncaught TypeError on partial PVE upgrade ([M12](../../nexus/src/app/api/proxmox-ws/route.ts#L127)).

### LOW (6)

Store-file corrupt-JSON coercions, `smbcontrol reload-config || true` swallowing samba reload failures, stderr.resume() drops in NAS downloadFile, etc. Individually low-impact; collectively worth an audit once.

### Cross-cutting remediation

The single highest-leverage fix is a **`/api/system/health` endpoint** that surfaces error counters: `auditWriteFailures`, `ticketRenewalFailures`, `schedulerFireFailures`, `permissionProbeErrors`, `redisErrorRate`, `relaySessionGcCount`. Most HIGH findings become "visible" with zero other code changes if operators can see these metrics.

---

## 4. Type design

Top recommendations from the type-design analyzer, ranked by leverage:

### 4.1 ID branding (single highest-value change)

Everything that shouldn't be swapped is currently `string` or `number`:
- `VmId`, `NodeName`, `Userid`, `SessionTicket`, `CsrfToken`, `BatchId`, `ShareId`, `AuditId`, `Slug`, `CronExpr`, `SafeRelPath`

Apply as `type VmId = number & { readonly __brand: 'VmId' }` with a single `parseVmId(n)` constructor. Every `as VmId` cast becomes a deliberate trust-boundary marker.

**Ratings (current):**

| File | Encapsulation | Invariants | Usefulness | Enforcement |
|------|---------------|------------|------------|-------------|
| [types/proxmox.ts](../../nexus/src/types/proxmox.ts) | 3/5 | 3/5 | 3/5 | 2/5 |
| [types/nas.ts](../../nexus/src/types/nas.ts) | 4/5 | 3/5 | 3/5 | 2/5 |
| [lib/proxmox-client.ts](../../nexus/src/lib/proxmox-client.ts) | 3/5 | 4/5 | 4/5 | 2/5 |
| [lib/community-scripts.ts](../../nexus/src/lib/community-scripts.ts) | 4/5 | 4/5 | 4/5 | 3/5 |
| [lib/migration-score.ts](../../nexus/src/lib/migration-score.ts) | 4/5 | 3/5 | 4/5 | 3/5 |
| [lib/widgets/registry.ts](../../nexus/src/lib/widgets/registry.ts) | 3/5 | 3/5 | 3/5 | 2/5 |
| [lib/exec-audit.ts](../../nexus/src/lib/exec-audit.ts) | 5/5 | 4/5 | 5/5 | 4/5 |
| [lib/exec-policy.ts](../../nexus/src/lib/exec-policy.ts) | 5/5 | 4/5 | 5/5 | 4/5 |

### 4.2 Discriminated unions instead of loose optionals

- `PVETask` — status/endtime/exitstatus are all optional, so "running with OK result" typechecks. Split by `status`.
- `BulkItem` — `{status: 'success', error: 'x'}` compiles today. Discriminate.
- `ChainStepRun` — `finishedAt` only meaningful when terminal. Discriminate.
- `NasShare` — `status === 'error'` should carry `errorReason: string`.
- `ScoredTarget` — `disqualified === (label === 'not-allowed')` is only implied.
- `UpstreamFetchError` — promote from class-with-runtime-kind to true discriminated union.

### 4.3 `PveBool` read-path leak

[`proxmox-client.ts:60`](../../nexus/src/lib/proxmox-client.ts#L60) does `(v as unknown) === 1 || v === true` — **silently returns `false` for PVE's `'0'`/`'1'` string responses** (which some endpoints emit). Tighten `fromPveBool` to accept all four wire shapes and route every read through it.

### 4.4 Response validation absent

Every `proxmox.get<T>` and PocketBase fetch uses `as T`. A single lightweight parse at the boundary (Zod or hand-rolled) would raise every "Enforcement" score by a full point and prevent the silent-failure class described in M12/H6.

### 4.5 DTO/store duplication

`scheduled-jobs-*` and `chains-*` each hand-maintain three near-identical shapes (store record, update input, DTO). Derive one from the other via `Pick`/`Omit`.

### 4.6 Four `as unknown as` casts

[`proxmox-client.ts:1031, 1040, 1046, 1053`](../../nexus/src/lib/proxmox-client.ts#L1031) on firewall bodies bypass the branded-bool invariant. Add typed firewall-encoder bindings or change the `post` signature to `Record<string, Primitive | PveBool>`.

---

## 5. Architecture — god files & duplication

### 5.1 God files (>500 lines)

| File | Lines | Responsibilities | Action |
|------|-------|------------------|--------|
| [types/proxmox.ts](../../nexus/src/types/proxmox.ts) | 1349 | DTO catalog | OK — single responsibility is catalog |
| [lib/proxmox-client.ts](../../nexus/src/lib/proxmox-client.ts) | 1323 | codec + 10 domain clients | **Split** codec → `proxmox-codecs.ts`, domains → `api/{vms,containers,storage,firewall,…}.ts`, barrel export |
| [app/(app)/scripts/page.tsx](../../nexus/src/app/(app)/scripts/page.tsx) | **1007** | index + search + detail + install + resource grid + node picker + advanced config + error humanization | **Top refactor priority** — extract `LeftRail`, `ScriptDetail`, `InstallMethodPicker`, `ScriptLogo`, `SidebarError`, `humanizeError` into `src/components/scripts/*` |
| [lib/nas/providers/native.ts](../../nexus/src/lib/nas/providers/native.ts) | 647 | shell templates + parser | Split shell templates → `native-scripts.ts` |
| [components/clone/clone-wizard.tsx](../../nexus/src/components/clone/clone-wizard.tsx) | 611 | 3-step wizard + cloud-init | Extract `Step1Identity`, `Step2CloudInit`, `Step3Confirm` subcomponents |
| [app/(app)/dashboard/vms/[node]/[vmid]/page.tsx](../../nexus/src/app/(app)/dashboard/vms/%5Bnode%5D/%5Bvmid%5D/page.tsx) | 601 | detail + lifecycle mutations + dialogs | Extract `useVmLifecycle` hook; dialogs already extracted |
| [components/storage/map-storage-dialog.tsx](../../nexus/src/components/storage/map-storage-dialog.tsx) | 577 | 6-backend form | Extract backend configs → `lib/storage-config.ts` |
| [app/(app)/dashboard/system/certificates/page.tsx](../../nexus/src/app/(app)/dashboard/system/certificates/page.tsx) | 540 | page + embedded shell scripts for TUNNEL_PROVIDERS | Extract `TUNNEL_PROVIDERS` → `lib/tunnel-providers.ts` |
| [lib/community-scripts.ts](../../nexus/src/lib/community-scripts.ts) | 510 | fetcher + DTO mapping | Borderline OK; could split DTO mapping |
| [components/migrate/migrate-wizard.tsx](../../nexus/src/components/migrate/migrate-wizard.tsx) | 509 | 3-step wizard | Borderline OK |

### 5.2 Duplication patterns

**Pattern A — Client-side CSRF mutation (14 hook sites):**
```ts
// repeated in use-bulk-lifecycle, use-chains, use-script-jobs, use-scheduled-jobs, use-migration, ...
const csrf = readCsrfCookie();
const res = await fetch(url, { method: 'POST', headers: { 'X-Nexus-CSRF': csrf ?? '' }, body: JSON.stringify(input) });
if (!res.ok) throw new Error(await readError(res));
return res.json();
```
→ Extract to `lib/create-csrf-mutation.ts` — **saves ~280 LOC**.

**Pattern B — Route-handler preamble (26 sites):**
```ts
const session = await getSession();
if (!session) return NextResponse.json({error:'Unauthorized'}, {status:401});
const sessionId = await getSessionId();
if (!validateCsrf(req, sessionId)) return NextResponse.json({error:'CSRF failed'}, {status:403});
try { … } catch(err) { return NextResponse.json({error:…}, {status:500}); }
```
→ Extract `withAuth` + `withCsrf` + `withErrorHandler` composable HOFs. **Saves ~400 LOC + prevents "forgot to CSRF" regressions.**

**Pattern C — Input class string (18 files):**
`'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm …'` — copy-pasted. Hoist to `lib/input-styles.ts` or a `<TextInput>` primitive.

**Pattern D — Dialog shells (5 dialogs):**
Identical overlay + stop-prop + close button markup in `map-storage-dialog`, `iso-upload-dialog`, `create-share-dialog`, `restore-dialog`, `ha-migrate-dialog`. Extract `<DialogShell title subtitle maxWidth onClose>{children}</DialogShell>`.

**Pattern E — Adaptive polling (3 hooks):**
`use-script-jobs`, `use-bulk-lifecycle`, `use-chains` each independently implement "2s while active, 30s while idle". Extract `useAdaptivePoll(hasActiveWork, activeMs, idleMs)`.

### 5.3 Scattered constants

No `lib/constants.ts`. Timing values live in 7+ files:

| Constant | Sites | Value |
|----------|-------|-------|
| `JOB_TTL_MS` | script-jobs.ts | 24h |
| `BATCH_TTL_MS` | bulk-ops.ts | 1h |
| `GC_INTERVAL_MS` | bulk-ops, session-store | 5min |
| `SCHED_TICK_MS` | scheduler.ts | 60s |
| `CACHE_MS` | api/system/version | 60s |
| `RECENT_WINDOW_MS` | JobStatusBar | 5min |
| `DEFAULT_TIMEOUT_MS` | api/scripts/run | 15min |

→ Consolidate into `lib/constants.ts` with a `TIMINGS` namespace.

### 5.4 Layering

**Mostly clean.** Two minor violations:
- [components/scripts/script-picker.tsx:4](../../nexus/src/components/scripts/script-picker.tsx#L4) imports `GroupedEnvelope` type from `/api/scripts/route` instead of `lib/scripts-dto.ts`
- [app/(app)/scripts/page.tsx:68](../../nexus/src/app/(app)/scripts/page.tsx#L68) defines `ScriptsApiError` class inside a page — belongs in `lib/scripts-error.ts`

### 5.5 Naming inconsistency

Dominant convention: kebab-case files, camelCase exports. Exceptions:
- `components/script-jobs/JobDrawer.tsx` → should be `job-drawer.tsx`
- `components/script-jobs/JobStatusBar.tsx` → should be `job-status-bar.tsx`

---

## 6. Conventions compliance (against CLAUDE.md + nexus/AGENTS.md)

### 6.1 Clean

- **Canonical call site** `api.<resource>.<verb>()` — no direct `fetch('/api/proxmox/...')` violations.
- **CSRF enforcement** on all mutating routes — `validateCsrf(req, sessionId)` present everywhere.
- **Row-button `stopPropagation`** pattern followed at spot-checked sites.
- **No setInterval abuse** — 7 uses audited, all legitimate (server-side GC + UI elapsed-time tickers).

### 6.2 Drift — 25 poll-interval sites bypass `POLL_INTERVALS`

`POLL_INTERVALS` in [use-cluster.ts](../../nexus/src/hooks/use-cluster.ts) is the documented single source. Only 2 sites use it. Hardcoded values (`2_000 | 5_000 | 10_000 | 15_000 | 30_000 | 60_000`) appear in 25 sites across all of `dashboard/vms`, `dashboard/cts`, `dashboard/storage`, `dashboard/system/*`, `dashboard/cluster/*`, several `components/*` tables.

**Fix:** extend the constant:
```ts
export const POLL_INTERVALS = {
  cluster: 10_000, nodeStatus: 10_000, tasks: 15_000, rrd: 30_000,
  guestStatus: 5_000, guestTasks: 10_000, logs: 2_000,
  config: 30_000, disks: 60_000, services: 15_000,
} as const;
```
and migrate the 25 sites.

### 6.3 Drift — lifecycle mutations lack toasts

VM/CT detail pages wire `startM/shutdownM/stopM/rebootM/cloneM/saveConfigM` with `onSuccess: invalidate` but no `onError`. Silent power-op failures are a UX liability on an admin tool. Similarly [use-migration.ts](../../nexus/src/hooks/use-migration.ts) and [use-bulk-lifecycle.ts](../../nexus/src/hooks/use-bulk-lifecycle.ts) leave toast wiring to individual callers.

**Fix:** extract `useOpMutation({ label, mutationFn, invalidateKeys })` that auto-toasts, or add `onError: (e) => toast.error(e.message, label)` to every lifecycle mutation.

### 6.4 Drift — design tokens not applied in 40 files

Repeated "primary-CTA" class chain (`bg-zinc-300 hover:bg-zinc-200 text-zinc-900`) — found in 15+ sites across `components/access/*`, `components/console/terminal.tsx`, `components/nas/create-share-dialog.tsx`, `app/login/page.tsx`, `components/dashboard/confirm-dialog.tsx`. In Frosted Glass light theme this inverts meaninglessly.

Raw severity colors (`emerald-*`, `amber-*`, `red-*`, `blue-*`, `indigo-*`) appear in **198 sites** despite existing `--color-{ok,warn,err,accent}` tokens. Skeleton loaders (`bg-zinc-900/70`) and focus rings (`ring-zinc-300`) likewise bypass tokens.

**Fix:**
1. Add `--color-cta` / `--color-cta-hover` / `--color-cta-fg` tokens that flip for light theme.
2. Either a `<Button variant="primary">` component or a utility class in `globals.css`.
3. Migrate the biggest offenders: `components/access/*`, `confirm-dialog`, VM/CT lifecycle chips, `scripts/page.tsx` (46 occurrences).

### 6.5 Drift — duplicated types

- `TunnelStatus` union defined identically in [api/tunnels/status/route.ts:21](../../nexus/src/app/api/tunnels/status/route.ts#L21) and [dashboard/system/certificates/page.tsx:76](../../nexus/src/app/(app)/dashboard/system/certificates/page.tsx#L76).
- `ValidType` union: [api/proxmox-ws/route.ts:49](../../nexus/src/app/api/proxmox-ws/route.ts#L49) (`qemu|lxc|node`) vs [console/vnc/page.tsx:24](../../nexus/src/app/(app)/console/vnc/page.tsx#L24) (`qemu|lxc`). Different sets, same name.
- `SortKey` duplicated between [dashboard/cts/page.tsx:18](../../nexus/src/app/(app)/dashboard/cts/page.tsx#L18) and [dashboard/vms/page.tsx:19](../../nexus/src/app/(app)/dashboard/vms/page.tsx#L19).

### 6.6 Drift — dead `readCsrfCookie()` calls

[use-migration.ts:184-188](../../nexus/src/hooks/use-migration.ts#L184) and [clone-wizard.tsx:130-132](../../nexus/src/components/clone/clone-wizard.tsx#L130) call `readCsrfCookie()` without assignment, with a comment "Read CSRF defensively". That's a WHAT-comment describing a no-op. Delete both calls and comments.

### 6.7 Drift — one `any`

[api/nas/shares/route.ts:69](../../nexus/src/app/api/nas/shares/route.ts#L69) `function validateCreatePayload(body: any)`. Replace with `unknown` and narrow in the function body.

### 6.8 Bundle

- **`recharts` not lazy-loaded.** [rrd-chart.tsx:20](../../nexus/src/components/dashboard/rrd-chart.tsx#L20) imports synchronously. Wrap consumers (`vm-metrics-chart`, `node-metrics-chart`) with `next/dynamic(() => ..., { ssr: false })`. ~100KB gzipped penalty on every VM/CT/node detail page.
- `cmdk` on every authed page (acceptable — palette is always available).
- `@novnc/novnc` and `@xterm/*` correctly scoped to their routes.

---

## 7. Comment quality

Project rule: comments explain WHY not WHAT; no task references; no multi-paragraph docstrings at function level. Audit across `src/lib/**`, `src/hooks/**`, `src/app/api/**`, `server.ts`:

**4 rot/contradiction issues:**

1. **[lib/exec-policy.ts:33](../../nexus/src/lib/exec-policy.ts#L33)** — `{@link …#acquireConcurrencySlot}` points to nonexistent symbol; actual name is `acquireSlot`. Fix the link.
2. **[lib/cron-match.ts:58-60](../../nexus/src/lib/cron-match.ts#L58)** — JSDoc for `domRestricted`/`dowRestricted` is logically inverted — says "true when `*`", code says the opposite. Fix the comment.
3. **[hooks/use-cluster-health.ts:5-8](../../nexus/src/hooks/use-cluster-health.ts#L5)** — docblock promises "per-node status (…10s)" polling; code sets only `staleTime: 5_000` with no `refetchInterval`. Either add the poll or fix the comment.
4. **[lib/proxmox-client.ts:16-17](../../nexus/src/lib/proxmox-client.ts#L16)** — claims `PveBool` helpers are "not yet wired into request methods; Phase B of the migration will thread them through". Phase B has clearly landed (dozens of codec bindings in the same file). Delete the stale sentence.

**~5 redundant WHAT comments** — low priority (see agent output).

**1 live TODO** — [lib/nas/registry.ts:31](../../nexus/src/lib/nas/registry.ts#L31) `TODO(phase-2b)`. Well-documented, keep.

**No FIXME / XXX / HACK markers.** Impressive baseline.

**Exemplary comments** worth emulating: docblocks in [server.ts:61-79](../../nexus/server.ts#L61), [lib/pve-fetch.ts:1-29](../../nexus/src/lib/pve-fetch.ts#L1), [lib/exec-audit.ts:1-37](../../nexus/src/lib/exec-audit.ts#L1), [api/proxmox-ws/route.ts:161-169](../../nexus/src/app/api/proxmox-ws/route.ts#L161), [lib/rate-limit.ts:64-108](../../nexus/src/lib/rate-limit.ts#L64). Each captures institutional knowledge that would be lost in a PR-description-only workflow.

---

## 8. Test coverage

**Baseline:** 129 tests across 27 suites. 15 test files cover ~14 source modules out of ~50 significant ones in `src/lib`, plus zero coverage of the 27 API routes and 11 hooks.

### Critical untested (rating 9–10/10):

| File | Rating | Why |
|------|--------|-----|
| [lib/csrf.ts](../../nexus/src/lib/csrf.ts) | 10 | `deriveCsrfToken`, `csrfMatches` (timing-safe), `validateCsrf` — ~30 LOC test prevents CSRF disabling regressions |
| [lib/exec-audit.ts](../../nexus/src/lib/exec-audit.ts) | 10 | Envelope encryption + frame layout + dual-tier log ordering. Un-decryptable after-the-fact if bugs slip |
| [lib/permissions.ts](../../nexus/src/lib/permissions.ts) | 10 | The fail-closed contract is load-bearing; regressions are catastrophic |
| [lib/auth.ts](../../nexus/src/lib/auth.ts) | 9 | Session rotation, cookie flag policy, stale-refresh logic all untested |
| [lib/remote-shell.ts](../../nexus/src/lib/remote-shell.ts) | 9 | `NODE_RE` shell-injection defence + stdin/stdout contract |
| [lib/rate-limit.ts](../../nexus/src/lib/rate-limit.ts) | 9 | In-memory token bucket + slot semaphore — no Redis dep needed for tests |
| [lib/session-store.ts](../../nexus/src/lib/session-store.ts) | 8 | TTL eviction, corrupt-JSON eviction |
| Route integration for `/api/auth/login`, `/api/exec`, `/api/scripts/run` | 9 | Six-step auth→CSRF→perm→rate→clamp→audit chain has no regression safety |

### Thin existing coverage

- **[proxmox-client.ts](../../nexus/src/lib/proxmox-client.ts)** (1323 LOC) — only `toPveBool`/`encodeBoolFields` tested. HTTP client, error mapping, 401 refresh, WebSocket wiring all untested.
- **[scheduler.test.ts](../../nexus/src/lib/scheduler.test.ts)** — missing concurrent-tick reentry, clock-skew, `onFired` throwing.
- **[run-script-job.test.ts](../../nexus/src/lib/run-script-job.test.ts)** — only validators tested; orchestration (`rejectedEnvKeys`, abort, timeout clamping, log ring) untested.
- **[bulk-ops.test.ts](../../nexus/src/lib/bulk-ops.test.ts)** — no abort-mid-flight, no `pollTask` timeout test.
- **[run-chain.test.ts](../../nexus/src/lib/run-chain.test.ts)** — excellent DI pattern; missing dedup-lock race and step-timeout propagation.

### Exemplary tests to emulate

- **[run-chain.test.ts](../../nexus/src/lib/run-chain.test.ts)** — dependency-injected `Deps`
- **[run-bulk-op.test.ts](../../nexus/src/lib/run-bulk-op.test.ts)** — peak-concurrency + failure-isolation
- **[scheduler.test.ts](../../nexus/src/lib/scheduler.test.ts)** — `mkdtempSync` + env-before-import pattern for file-backed stores
- **[proxmox-client.test.ts](../../nexus/src/lib/proxmox-client.test.ts)** — `encode ∘ decode = identity` round-trip

### Top-10 tests to add (ROI-ordered)

1. `src/lib/csrf.test.ts` — 30 LOC, rating 10
2. `src/lib/permissions.test.ts` — mock `pveFetch` to return 500/403/malformed; assert all return `false` — rating 10
3. `src/lib/exec-audit.test.ts` — generate RSA keypair in-test, round-trip write+decrypt — rating 10
4. `src/lib/remote-shell.test.ts` — `NODE_RE` table-driven + timeout + maxBuffer — rating 9
5. `src/lib/rate-limit.test.ts` — fake `Date.now()`, window boundary, slot underflow — rating 9
6. `src/lib/auth.test.ts` — session rotation, stale-refresh happy+failure paths — rating 9
7. `src/lib/session-store.test.ts` — TTL eviction, corrupt-JSON path — rating 8
8. `src/app/api/exec/route.test.ts` — integration, full chain — rating 9
9. `src/lib/proxmox-client.test.ts` (extend) — `ProxmoxAPIError` mapping + 401 refresh — rating 8
10. `src/lib/community-scripts.test.ts` — PocketBase fixture → DTO — rating 7

---

## 9. Prioritized action plan

### Tier 1 — Must fix (security, correctness, operator visibility)

1. **Ship `/api/system/health` endpoint** exposing audit-failure / renewal-failure / scheduler-fire-failure / permission-probe-error / Redis-error counters. Unlocks visibility for findings H1, H2, H4, H5, H9. **Effort:** 1 day.
2. **Fix the 18 ESLint errors.** 10× `set-state-in-effect`, 8× `static-components`, 1× `any`. **Effort:** 2–3 hours.
3. **H8 — Stream binary responses** in [api/proxmox/[...path]/route.ts](../../nexus/src/app/api/proxmox/%5B...path%5D/route.ts). Current `res.text()` mangles VNC tickets and raw log bytes. **Effort:** 1 hour.
4. **H10 — Narrow PVE 401 handling** — only clear session cookies on actual ticket-expiry paths, not per-operation 401s. **Effort:** 2 hours.
5. **H2 — Stamp `lastRenewalAttemptAt` + back-off** in `refreshPVESessionIfStale`. **Effort:** 1 hour.
6. **H4 — Scheduler `lastFireError` + `consecutiveFailures`** + auto-disable after N. **Effort:** 4 hours.
7. **H7 — Clear `setTimeout` on `open`** in [server.ts:137](../../nexus/server.ts#L137). **Effort:** 15 minutes.
8. **Add tests for `csrf.ts`, `permissions.ts`, `exec-audit.ts`.** **Effort:** 4 hours each = 1.5 days.

**Tier 1 total: ~1 week.**

### Tier 2 — Systemic quality (boilerplate, tokens, conventions)

9. **Extract `withCsrf(handler)` + `withSession(handler)` HOFs** in `lib/route-middleware.ts`; migrate 26 routes. Saves ~400 LOC and prevents CSRF-check regressions. **Effort:** 4 hours.
10. **Extract `useCsrfMutation<T>(url, method, { invalidateKeys, toastLabel })`** in `lib/create-csrf-mutation.ts`; migrate 14 hooks. Saves ~280 LOC and standardizes toast behaviour. **Effort:** 4 hours.
11. **Add `--color-cta*` tokens + `<Button variant>` primitive + migrate 40 design-token-drift files.** **Effort:** 1.5 days.
12. **Extend `POLL_INTERVALS` + migrate 25 hardcoded `refetchInterval` sites.** **Effort:** 3 hours.
13. **Split [app/(app)/scripts/page.tsx](../../nexus/src/app/(app)/scripts/page.tsx) (1007 lines).** **Effort:** half a day.
14. **Lazy-load recharts** via `next/dynamic`. **Effort:** 30 minutes.
15. **Add tests for `auth.ts`, `remote-shell.ts`, `rate-limit.ts`, `session-store.ts`.** **Effort:** 1 day.

**Tier 2 total: ~4 days.**

### Tier 3 — Type design hardening

16. **ID branding module** — `types/brands.ts` with `VmId`, `NodeName`, `Userid`, `SessionTicket`, `CsrfToken`, `BatchId`, `CronExpr`, `SafeRelPath`, `Slug`. Migrate types gradually. **Effort:** 3 days for core + migration.
17. **Discriminate status-carrying types** — `PVETask`, `BulkItem`, `ChainStepRun`, `NasShare`, `ScoredTarget`, `UpstreamFetchError`. **Effort:** 1 day.
18. **Tighten `fromPveBool`** to accept `'0'`/`'1'` strings + route all reads through it. **Effort:** 2 hours.
19. **Add response validation at PVE boundary** (Zod or hand-rolled). **Effort:** 1 day for core paths.
20. **Collapse DTO/store duplication** in `scheduled-jobs-*` and `chains-*`. **Effort:** 2 hours.

**Tier 3 total: ~5 days.**

### Tier 4 — Low-priority cleanup

- Fix 4 comment rot issues (§7).
- Delete dead `readCsrfCookie()` calls in `use-migration.ts` and `clone-wizard.tsx`.
- Replace `any` in [api/nas/shares/route.ts:69](../../nexus/src/app/api/nas/shares/route.ts#L69).
- Rename `JobDrawer.tsx`/`JobStatusBar.tsx` to kebab-case.
- Hoist `TunnelStatus`, `ValidType`, `SortKey` shared types.
- Consolidate timing constants into `lib/constants.ts`.
- Extract `TUNNEL_PROVIDERS` shell scripts from [certificates/page.tsx](../../nexus/src/app/(app)/dashboard/system/certificates/page.tsx).

**Tier 4 total: ~1 day.**

---

## 10. What's healthy (don't change)

- **Module docblocks** in `server.ts`, `pve-fetch.ts`, `exec-audit.ts`, `rate-limit.ts`, `community-scripts.ts` are exemplary — keep the style.
- **Dependency injection in orchestrator tests** ([run-chain.test.ts](../../nexus/src/lib/run-chain.test.ts), [run-bulk-op.test.ts](../../nexus/src/lib/run-bulk-op.test.ts)) — best pattern in the repo.
- **Scoped undici Agent for TLS bypass** ([pve-fetch.ts](../../nexus/src/lib/pve-fetch.ts)) — the *right* answer to Proxmox self-signed certs; don't regress to `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Double-submit CSRF** in `nexus_csrf` cookie + `X-Nexus-CSRF` header — solid pattern, clean implementation.
- **Branded `PveBool` wire codec** — well designed; just needs the read-path string coverage.
- **Typed `api.<resource>.<verb>()` surface** — adopted consistently across the client.
- **Widget registry + preset system** — clean abstraction, good test coverage, ready for Tier-7 DnD customization.
- **Floating-capsule sidebar + aurora mesh + Liquid Glass design system** — no UX issues flagged; light-theme drift is a tokens-file problem, not a design-system problem.

---

## Appendix A — Tools used

- Semgrep 1.157.0 (p/typescript + p/security-audit + p/javascript + p/owasp-top-ten + p/command-injection + p/jwt + p/xss + p/nodejs — 642 rules)
- GitNexus 1812-symbol / 4836-edge graph on commit `9b1bade`
- pr-review-toolkit: silent-failure-hunter, type-design-analyzer, comment-analyzer, pr-test-analyzer
- superpowers:code-reviewer
- Explore (very thorough)
- Node test runner + TypeScript 5 strict + ESLint 9 + next lint

All agent raw outputs live in `/private/tmp/claude-501/.../tasks/*.output` for this session and will be garbage-collected; the distilled findings in this report are the canonical record.

---

## Appendix B — What was NOT reviewed

- **Frontend components** (`src/components/**/*.tsx`) — only reviewed for architecture, convention, and design-token drift. No accessibility audit, no keyboard-nav audit, no responsive-breakpoint audit.
- **CSS (`globals.css`)** — inspected for token architecture but not full audit.
- **`install.sh`, `deploy/`, `bin/`** — out of scope for this pass.
- **GitHub Actions workflows** — none reviewed.
- **Docs (`docs/`, `README.md`)** — not audited for accuracy.
- **Docker/LXC packaging** — not reviewed.

Suggested follow-ups for a second pass if desired: a11y + keyboard-only audit (via `axe-core`), a Playwright golden-path suite for wizards (clone / migrate / chain editor / firewall rule editor), a bundle-analyzer run to verify recharts lazy-loading and total route payloads, and a review of `install.sh` for root-privilege correctness.
