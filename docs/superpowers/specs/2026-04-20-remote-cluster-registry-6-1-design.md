# Remote Cluster Registry (Roadmap §6.1, Top-10 #9)

**Date:** 2026-04-20
**Release target:** v0.34.0 (closes the Top-10 list; opens Tier 6 federation)
**Predecessor:** v0.33.0 (8.3 security hardening)
**Status:** design approved, pending implementation plan

## Context

Top-10 #9 is the last unshipped item. All prior Tier 6 work (federated tree,
cross-cluster console, cross-cluster migration, HA pair) depends on §6.1 —
without a registry, there is nothing to federate against.

PDM's documented weakness is that it connects to one specific node per
cluster with no failover. Nexus's registry takes an ordered endpoint list
per cluster and picks the most-recently-successful one.

## Scope

**In scope for v0.34.0:**
1. Encrypted-at-rest registry of remote clusters.
2. Background probe runner computing reachability + quorum + latency.
3. Management UI at `/dashboard/federation` (list, add wizard, rotate
   credentials, remove).
4. Proxy `/api/proxmox/[...path]?cluster=<id>` rewrite that routes to
   registered clusters using API-token auth.

**Out of scope (deferred, documented):**
- Ticket-mode authentication (schema reserves `authMode` but only `'token'`
  is implemented). Requires password-at-rest + 90-min refresh + TFA.
- Federated resource tree aggregation — §6.2.
- Cross-cluster console tunneling — §6.3.
- Cross-cluster live migration — §6.4.
- Redis-backed registry for HA pair — §6.5.
- Per-federation session UI (list + revoke) — §8.6.

**Acknowledged ship-day limitation:** operators can register remote clusters
and route raw API calls via `?cluster=`, but the UI doesn't yet render a
federated view of remote cluster data. That's §6.2's job. Registered
clusters are visible in `/dashboard/federation` but not in the main
resource tree.

## Architecture

New module `nexus/src/lib/federation/` mirrors the existing
`nexus/src/lib/service-account/` module one-to-one. Same at-rest encryption
helper (`notifications/crypto.ts`), same outbound fetch helper
(`pve-fetch.ts`), same probe-tick shape as `drs/runner.ts` and
`guest-agent/poll-source.ts`.

| Layer | File | Responsibility |
|-------|------|---------------|
| Types | `nexus/src/lib/federation/types.ts` | `RegisteredCluster`, `ClusterProbeState`, input DTOs |
| Storage | `nexus/src/lib/federation/store.ts` | CRUD + encrypted persistence on `federation.json` |
| Session | `nexus/src/lib/federation/session.ts` | In-memory map, `loadAtBoot()`, `resolveRegisteredCluster(id)` |
| Probe | `nexus/src/lib/federation/probe.ts` | Pure `probe(endpoints, creds)` → `ProbeResult` |
| Probe runner | `nexus/src/lib/federation/probe-runner.ts` | 60s tick, fan-out, sticky active endpoint |
| Proxy | `nexus/src/app/api/proxmox/[...path]/route.ts` | One new branch on `?cluster=<id>` |
| API | `nexus/src/app/api/federation/clusters/route.ts` + `[id]/route.ts` | GET list, POST add, DELETE, PATCH rotate |
| UI route | `nexus/src/app/(app)/dashboard/federation/page.tsx` | List + empty state |
| UI wizard | `nexus/src/components/federation/add-cluster-dialog.tsx` | Four-step add flow |
| UI misc | `nexus/src/components/federation/cluster-row.tsx`, `rotate-credentials-dialog.tsx` | Table row + rotate action |

**Boot wiring in `server.ts`:** after the existing
`await loadServiceAccountAtBoot()`, call `await loadFederationAtBoot()`.
Start a new 60s `setInterval` calling `runProbeTick()` alongside the DRS /
guest-agent / updates tickers. All ticker handles get `.unref?.()` to match
existing pattern (see v0.33.0 server.ts refactor).

## Data types & persistence

```ts
// nexus/src/lib/federation/types.ts
export interface RegisteredCluster {
  /** Slug-cased human id: "prod-east", "lab". Used in ?cluster=<id>. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Ordered endpoint list for failover. First reachable wins. Must be
   *  https:// URLs — plain http rejected at validate time. */
  endpoints: string[];
  /** Reserved for future ticket-mode. v0.34.0 always writes 'token'. */
  authMode: 'token';
  /** PVE API token id: user@realm!tokenname. */
  tokenId: string;
  /** UUID secret PVE issued. Only held here; never logged. */
  tokenSecret: string;
  /** Epoch ms; initial creation time. */
  savedAt: number;
  /** Epoch ms; last credential-rotation time (same as savedAt on create). */
  rotatedAt: number;
}

export interface ClusterProbeState {
  clusterId: string;
  reachable: boolean;
  /** URL of the endpoint the last successful probe hit (sticky). */
  activeEndpoint: string | null;
  latencyMs: number | null;
  pveVersion: string | null;
  /** From /cluster/status: true if >50% of nodes online. null when not probed. */
  quorate: boolean | null;
  lastProbedAt: number;
  lastError: string | null;
}

export interface CreateClusterInput {
  id: string;
  name: string;
  endpoints: string[];
  tokenId: string;
  tokenSecret: string;
}

export interface RotateCredentialsInput {
  tokenId: string;
  tokenSecret: string;
}
```

**Storage file:** `${NEXUS_DATA_DIR}/federation.json`, mode `0600`. On-disk
framing identical to `service-account.json`: a base64-encoded AES-GCM blob
(16-byte salt + 12-byte IV + 16-byte auth tag + ciphertext) decrypting to
`{ version: 1, clusters: RegisteredCluster[] }`.

**Atomic writes:** `writeFile(tmp)` + `rename(tmp, final)`, same pattern as
existing stores.

**Probe state:** in-memory only (not persisted). Rebuilt on boot by the
probe runner's first tick (~60s window where operators see "probing…").

**Validation at write time:**
- `id` matches `/^[a-z][a-z0-9-]{0,31}$/` — slug-cased, 1-32 chars, no
  leading hyphen. Safe-regex clean.
- `id` MUST NOT equal `'local'` — reserved to avoid proxy routing ambiguity.
- `name` is a non-empty string, trimmed length 1-64.
- `endpoints`: array of 1-4 entries. Each must parse as a URL with
  `protocol === 'https:'` and a non-empty host. Deduplicate — same URL
  twice rejects.
- `tokenId`: matches `TOKEN_ID_RE` from `service-account/store.ts`
  (`/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+![A-Za-z0-9._-]+$/`).
- `tokenSecret`: length 8-256.
- POST with existing `id` returns 409 Conflict.

## Authorization

| Operation | Required privilege |
|-----------|-------------------|
| `GET /api/federation/clusters` | authenticated session; any user |
| `POST /api/federation/clusters` (add) | `Sys.Modify` on `/` in the **local** cluster |
| `DELETE /api/federation/clusters/[id]` | `Sys.Modify` on `/` in the **local** cluster |
| `PATCH /api/federation/clusters/[id]` (rotate creds) | `Sys.Modify` on `/` in the **local** cluster |
| `/api/proxmox/[...path]?cluster=<id>` | authenticated session; ACL enforced by the remote cluster's own PVE token |

`Sys.Modify` on `/` is the same gate service-account management uses, and
is PVE's "admin-ish" privilege. Nexus never acts as an authority on remote
cluster resources — the registered token's privileges are enforced
server-side by the remote PVE.

## Proxy rewrite logic

One new branch in `nexus/src/app/api/proxmox/[...path]/route.ts`, inserted
immediately after the existing top-level-allowlist block:

```ts
const url = new URL(req.url);
const clusterId = url.searchParams.get('cluster');

let targetBase: string;
let upstreamHeaders: Record<string, string>;

if (clusterId !== null) {
  // Federated path. Never touches local PVE_BASE.
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(clusterId)) {
    return hardenedJson({ error: 'Invalid cluster id' }, { status: 400 });
  }
  const resolved = resolveRegisteredCluster(clusterId);
  if (!resolved) {
    return hardenedJson({ error: 'Cluster not registered' }, { status: 404 });
  }
  const probe = getClusterProbeState(clusterId);
  targetBase = `${probe?.activeEndpoint ?? resolved.endpoints[0]}/api2/json`;
  // PVE's Authorization: PVEAPIToken=<id>=<secret> uses = as the separator
  // between id and secret; tokenId and tokenSecret are both already
  // restricted to URL-safe character classes at write time (TOKEN_ID_RE +
  // UUID secret), so no encoding required. Literal interpolation is safe.
  upstreamHeaders = {
    Authorization: `PVEAPIToken=${resolved.tokenId}=${resolved.tokenSecret}`,
  };
} else {
  // Unchanged local path.
  targetBase = PVE_BASE;
  upstreamHeaders = {
    Cookie: `PVEAuthCookie=${session.ticket}`,
    CSRFPreventionToken: session.csrfToken,
  };
}

// Strip ?cluster= from forwarded query so remote PVE never sees it.
url.searchParams.delete('cluster');
const forwardedQuery = url.searchParams.toString();
const targetUrl = `${targetBase}/${pathStr}${forwardedQuery ? '?' + forwardedQuery : ''}`;
```

**Important:** the existing top-level allowlist (v0.33.0) runs BEFORE this
block, so `?cluster=<id>` requests to non-allowlisted PVE families are
still rejected. The allowlist applies uniformly to local and federated
traffic.

**Endpoint selection:** if a probe has not yet succeeded, fall back to
`endpoints[0]`. The probe runner updates `activeEndpoint` as endpoints
succeed, so after the first tick the proxy uses the live-best endpoint.

**The `content-type` / body-size / CSRF guards continue to apply
uniformly** — federation doesn't bypass any existing hardening layer.

## Probe runner

60-second `setInterval` tick started from `server.ts` bootstrap. Per
registered cluster:

1. Iterate endpoints in order.
2. For each: `pveFetch(\`${endpoint}/api2/json/version\`, { ... })` with
   `Authorization: PVEAPIToken=...` header, 5-second `AbortSignal.timeout`.
3. First success wins → record `activeEndpoint`, `latencyMs`,
   `pveVersion`.
4. Follow up with `GET /api2/json/cluster/status` on the active endpoint
   → compute `quorate` (majority of `node` entries have `online=1`).
5. If every endpoint times out or 5xx's, record `reachable=false,
   lastError=<last error message>`, keep the previous `activeEndpoint`
   unchanged so the next tick retries the sticky one first (and the proxy
   layer keeps routing there while it's at least recently-good).

**Next-tick iteration order:** the endpoint list is probed in
`[activeEndpoint, ...rest]` order if an `activeEndpoint` exists, else the
raw `endpoints` order. This preserves "last known good" semantics even
after a total outage — when the cluster comes back, the previously-active
endpoint is tried first.

**Single-flight lock:** per cluster. If a tick overlaps (slow network),
the second call returns immediately without re-probing. Prevents pile-ups.

**Concurrency across clusters:** `Promise.all` — bounded by cluster count
which is small.

**Boot behaviour:** first tick fires at t+60s, so operators see
`reachable: null` initially. UI copy says "Probing…".

**Auth for probes:** the registered API token, not a session ticket. Token
auth is stateless so probes can run without any user session present.

**No persistence** — probe state is observational, rebuilt on restart.

## API routes

**`GET /api/federation/clusters`** — returns list of registered clusters
with probe state merged in. Secrets redacted:
```json
{
  "clusters": [
    {
      "id": "prod-east",
      "name": "Production East",
      "endpoints": ["https://pve-east-1.example.com:8006", "..."],
      "authMode": "token",
      "tokenId": "nexus@pve!federate",
      "savedAt": 1747747200000,
      "rotatedAt": 1747747200000,
      "probe": {
        "reachable": true,
        "activeEndpoint": "https://pve-east-1.example.com:8006",
        "latencyMs": 42,
        "pveVersion": "8.2.4",
        "quorate": true,
        "lastProbedAt": 1747750800000,
        "lastError": null
      }
    }
  ]
}
```
`tokenSecret` is NEVER returned.

**`POST /api/federation/clusters`** — add. Body: `CreateClusterInput`.
Validates, encrypts + persists. 201 + the cluster record (minus secret).

**`DELETE /api/federation/clusters/[id]`** — remove. 204 on success, 404
if unknown. In-flight proxy requests against the deleted cluster complete
against their captured-at-request-start creds (see error handling).

**`PATCH /api/federation/clusters/[id]`** — body:
`RotateCredentialsInput`. Replaces `tokenId` + `tokenSecret`, bumps
`rotatedAt`. 200 + redacted record.

All POST/DELETE/PATCH are CSRF-validated via the existing
`validateCsrf(req, sessionId)` guard.

## UI

### `/dashboard/federation` route

Follows the same layout conventions as `/dashboard/cluster/drs` and
`/dashboard/system`.

**Page header:** "Federation" + description + primary "Add cluster" button.

**Empty state** (no registered clusters): centered liquid-glass card.
Copy:
> "Register remote PVE clusters to manage them from a single Nexus. This
> release (v0.34.0) lands the registry + API proxy rewrite. The resource
> tree will aggregate registered clusters in v0.35 (§6.2 Federated
> Resource Tree); cross-cluster console and migration land in later Tier
> 6 releases."

**Populated state:** liquid-glass table. Columns:

| Column | Content |
|--------|---------|
| Status | Dot + text; severity tokens (green = reachable + quorate, amber = reachable + not quorate, red = unreachable, grey = not yet probed). |
| Name | Display name + id in a sub-line. |
| Active endpoint | URL with protocol stripped for readability; tooltip lists all configured endpoints. |
| PVE version | From probe. |
| Latency | Right-aligned, ms. |
| Last probe | Relative time (`12s ago`). |
| Actions | Kebab menu → Rotate credentials / Remove. |

Polling: TanStack Query with a 30-second interval.

### Add-cluster wizard (dialog)

Four steps, single modal that progresses via steps navigation (same
pattern as the existing migrate-wizard.tsx):

**Step 1 — Identity.**
- Name (text input, 1-64 chars).
- Id (text input, auto-populated by slugifying the name; editable).
- Validation inline.

**Step 2 — Endpoints.**
- List of URL inputs with "Add endpoint" button (up to 4).
- Each field validates https:// + host non-empty on blur.
- Reorder handled by up/down buttons.

**Step 3 — API token.**
- Token id (text input).
- Secret (type=password, show/hide toggle).
- Explanation copy: "Create an API token in the remote cluster's UI at
  *Datacenter → Permissions → API Tokens*. Nexus never sees the PVE user
  password."

**Step 4 — Verify.**
- One-shot probe to the first endpoint using the entered creds.
- Success: show pveVersion + quorum state + latency, confirm button enabled.
- Failure: show the error, offer "Try again", "Edit", or "Save anyway"
  (secondary, with warning that the cluster will remain unreachable until
  fixed).
- The probe on this step does NOT persist anything; it's a dry run. Uses
  a throwaway `pveFetch`-style call.

Submit → POST /api/federation/clusters, close dialog, invalidate the list
query.

### Rotate-credentials dialog

Simple modal: tokenId + tokenSecret fields, PATCH to
`/api/federation/clusters/[id]`, invalidate list.

### Remove confirmation

Standard confirm dialog: cluster name printed prominently, confirmation
phrase input requiring the user to type the cluster name before the
Delete button enables. Follows the same UX pattern as bulk destructive
operations. DELETE, close, invalidate.

## Error handling

| Scenario | Response |
|----------|----------|
| Unknown cluster id in `?cluster=` | 404 `{ error: 'Cluster not registered' }` |
| Malformed cluster id in `?cluster=` | 400 `{ error: 'Invalid cluster id' }` |
| Registered cluster, all endpoints unreachable | Proxy returns the upstream error or 502 if every endpoint failed |
| Corrupt `federation.json` at boot (wrong key after JWT_SECRET rotation, or damaged file) | Log critical event, start with empty federation list, local proxy continues unaffected. Operator re-adds clusters. |
| Probe timeout on a single endpoint | Try next endpoint; don't fail the whole probe until every endpoint fails. |
| Operator deletes a cluster while a request is in flight | In-flight request completes against the creds captured at request start (`resolveRegisteredCluster` is called once per request). Future requests return 404. |
| POST with duplicate id | 409 Conflict |
| PATCH with invalid token shape | 400 with validation error |

**Secret-handling invariants:**
- `tokenSecret` is never logged. Not in error messages, not in probe
  failures, not in audit lines.
- `tokenSecret` never leaves the server — never sent to the client in
  any response.
- Requests to `/api/federation/clusters` that somehow try to echo the
  secret back are caught by a serializer that redacts `tokenSecret`
  before `NextResponse.json(...)`.

## Testing

### Unit tests (`nexus/src/lib/federation/*.test.ts`)

**`store.test.ts`:**
- Encrypted roundtrip: create → write → read → decrypt → equal.
- Atomic write: simulate crash mid-write, assert no half-written file.
- Validation rejects: bad id (leading hyphen, uppercase, too long, empty,
  reserved `'local'`), bad URL (http://, no host), bad tokenId (wrong
  shape), bad tokenSecret (too short, too long).
- Dedup: 409 on duplicate id.
- Remove: returns false for unknown id, true for existing.

**`session.test.ts`:**
- `loadAtBoot` with empty / one / many clusters.
- `resolveRegisteredCluster(id)` returns the cluster for known id, null for unknown.
- State survives reload.

**`probe.test.ts`:**
- Mock `pveFetch`: success, 503 on first endpoint then success on second,
  all endpoints timeout, network error.
- `activeEndpoint` stickiness: succeeds on endpoint 2 first, then
  succeeds again next tick — still endpoint 2 (not endpoint 1).
- Auth header is `Authorization: PVEAPIToken=...` not cookie-based.
- `cluster/status` parse: computes `quorate=true` when ≥51% online,
  `false` otherwise, `null` if status fetch fails.

**`probe-runner.test.ts`:**
- Fan-out: 3 clusters probed in parallel, results all recorded.
- Single-flight lock: overlapping tick returns immediately.
- Tick cadence: 60s interval via fake timers.
- Error resilience: one cluster throwing doesn't take down the others.

### Integration tests (extend existing proxy route test)

- `?cluster=<valid-id>` routes to the registered endpoint with token auth
  header; cookie auth header absent.
- `?cluster=<unknown-id>` returns 404.
- `?cluster=<malformed>` returns 400.
- `cluster` param stripped from forwarded query string.
- `?cluster=` + allowlist: request to a non-allowlisted top-level with a
  valid cluster id still returns 403 (allowlist runs first).

### Invariant tests (`nexus/src/tests/security/federation-invariants.test.ts`)

- `federation.json` schema version is `1`; unknown versions rejected at load.
- All registered endpoints are https://.
- `id` value `'local'` is always rejected.
- API responses never echo `tokenSecret`.

### Federation API route tests

`nexus/src/app/api/federation/clusters/route.test.ts`:
- Auth gate: unauthenticated 401.
- ACL gate: authenticated user without `Sys.Modify` on `/` 403 on mutating verbs.
- POST validation (good + bad shapes).
- DELETE idempotency (delete non-existent → 404; two deletes same id →
  first 204, second 404).
- PATCH rotation: new token goes into the store, old token gone.
- CSRF enforcement on POST/DELETE/PATCH.

### UI

No e2e. Nexus convention is to skip e2e for dashboard pages; DRS and
system pages both ship with unit tests only. Follow the precedent.

## Rollout

- Single PR → merge main → tag `v0.34.0` → auto-push (per
  `feedback_auto_ship`).
- **Roadmap update:** mark Top-10 #9 shipped, which closes all 10 Top-10
  items. Update "Next up" to reference Tier 6.2 Federated Resource Tree.
  Release history section gets v0.34.0 entry.
- **Wiki:**
  - New page `wiki/Federation.md` covering: how to add a cluster, how to
    rotate credentials, what's deferred.
  - `wiki/Configuration.md` gets one line noting `federation.json` lives
    in `NEXUS_DATA_DIR` and is encrypted with the JWT_SECRET-derived key.
  - `wiki/FAQ.md` entry: "How do I add a remote cluster?".
- **Serena memory:** `phase_federation_6_1_landed` with commit sequence,
  file footprint, how 6.2/6.3/6.4 plug in.
- **Auto-memory:** `project_federation_6_1.md` + update `MEMORY.md` index.

## Security posture note

Federation introduces new encrypted-at-rest credentials, but no new
credential-in-flight exposure:
- Token auth header travels over TLS to the remote cluster (endpoints are
  https:// only).
- Tokens never appear in client-facing responses.
- Rotation is a single PATCH; the old token becomes unreachable
  immediately (no dual-validity window — the store replaces, doesn't
  append).
- `federation.json` file mode is `0600` — same as `service-account.json`.

The 8.3 hardening pass's proxy top-level allowlist (v0.33.0) continues to
apply uniformly to federated traffic. `?cluster=<id>&` paths that address
non-allowlisted PVE resource families return 403 before the federation
resolution runs.

## Dependencies

None blocking. Building on `service-account/` primitives and the
`notifications/crypto.ts` envelope, both of which are stable. No
downstream changes required outside the files listed in the Architecture
table.

## Open questions

None blocking. Deferred items captured:
- **Ticket-mode auth** — reserved `authMode` field leaves a clean
  retrofit path. Would require password-at-rest + 90-min refresh + TFA
  support; roadmap for v0.35.x if demand exists.
- **Per-cluster file isolation** (approach β in the brainstorm) remains
  available if fan-out storage becomes warranted. Approach α ships
  v0.34.0 with a migration path if operators hit >10 clusters.
- **Redis registry for HA pair** — §6.5 future scope.
