# Phase C.2 — Service-Account Session Seeding

**Date:** 2026-04-19
**Status:** Approved for implementation
**Ships as:** 0.27.0

## Problem

Four background tickers boot and run on timers but silently no-op because there is no authenticated PVE session available at boot:

- DRS runner (`lib/drs/runner.ts`) — boots with `fetchCluster: async () => ({ resources: [], nodeStatuses: {} })`.
- Guest-agent poll source (`lib/guest-agent/poll-source.ts`) — boots with `getSession: () => undefined`.
- Notification poll source (`lib/notifications/poll-source.ts`) — same pattern.
- Updates checker — works for the GitHub probe (no session needed) but can't actually run the install step.

All four are documented in `server.ts` as "Phase C.2" deferrals. Features that the roadmap says shipped in v0.20.0–v0.23.0 are visible in the UI but their background work never runs.

## Goal

Give the tickers a real PVE session to use, provided by a dedicated PVE API token (service account) that the operator configures through the Nexus UI.

## Scope

### In scope for 0.27.0

- PVE API-token credential storage (encrypted, on disk in `${NEXUS_DATA_DIR}`).
- Session singleton loaded at boot, mutated by a save handler.
- `PVEAuthSession` widened to a discriminated union so existing consumers take either auth shape.
- `pveFetch` extended to handle the token auth header.
- Settings UI at `/dashboard/system/service-account` with quick-setup `pveum` command list, paste form, probe-on-save, and disconnect.
- Dismissible dashboard banner nudging the operator until configured.
- Replacement of the four ticker stubs with calls through `getServiceSession()`.

### Out of scope (future work)

- Username/password service accounts (we chose API tokens only).
- Auto-granting ACLs from the operator's session (operator runs `pveum` commands themselves).
- Token rotation reminders / expiry tracking.
- Multi-cluster service accounts (Tier 6 work — one token per Nexus install for now).
- Per-feature permission enumeration on the settings page (let the individual tickers log their own specific failures).
- Install-script integration (operator configures via UI on first boot).

## Architecture

One new module — `nexus/src/lib/service-account/` — owns the credential lifecycle. A discriminated union on `PVEAuthSession` adds a `{ kind: 'token', ... }` branch. Existing consumers (`pveFetch`, tickers) take the same type; `pveFetch` branches internally on `kind`. A new settings route + page. A small dashboard banner. No new server-side cron, no scheduler changes.

## File structure

**New:**
- `nexus/src/lib/service-account/types.ts` — `ServiceAccountConfig`, session-shape helpers.
- `nexus/src/lib/service-account/store.ts` — encrypted read/write of `${NEXUS_DATA_DIR}/service-account.json`.
- `nexus/src/lib/service-account/session.ts` — `loadServiceAccountAtBoot`, `reloadServiceAccount`, `getServiceSession`, `getServiceAccountStatus`.
- `nexus/src/lib/service-account/probe.ts` — `probeServiceAccount` hits `/access/permissions`.
- `nexus/src/lib/service-account/store.test.ts`
- `nexus/src/lib/service-account/probe.test.ts`
- `nexus/src/lib/service-account/session.test.ts`
- `nexus/src/app/api/system/service-account/route.ts` — GET/PUT/DELETE.
- `nexus/src/app/api/system/service-account/probe/route.ts` — POST (re-verify).
- `nexus/src/app/(app)/dashboard/system/service-account/page.tsx` — settings UI.
- `nexus/src/components/dashboard/service-account-banner.tsx` — dismissible nag.

**Modified:**
- `nexus/src/types/proxmox.ts` — widen `PVEAuthSession` to discriminated union: `{ kind: 'ticket', ... } | { kind: 'token', ... }`. Existing `ticket`/`csrfToken` fields move under the `ticket` branch.
- `nexus/src/lib/pve-fetch.ts` — branch on `session.kind` to produce the right headers.
- `nexus/server.ts` — `await loadServiceAccountAtBoot()` before ticker startup; replace the four stubs with real `getServiceSession()`-backed seams.
- `nexus/src/lib/pve-fetch.test.ts` — extend to cover both branches.
- `nexus/src/app/(app)/dashboard/layout.tsx` (or the component one level below that) — mount `<ServiceAccountBanner />`.
- `nexus/package.json` — version bump to 0.27.0 (release task only).

## Components

### `types.ts`

```ts
export interface ServiceAccountConfig {
  /** Full PVE token id: "user@realm!tokenname" (e.g. "nexus@pve!automation"). */
  tokenId: string;
  /** UUID secret PVE issued when the token was created. */
  secret: string;
  /** PVE host — e.g. "127.0.0.1" when Nexus runs on the PVE node, or the cluster FQDN. */
  proxmoxHost: string;
  /** Epoch ms. */
  savedAt: number;
}
```

The `PVEAuthSession` type in `types/proxmox.ts` widens to:

```ts
export type PVEAuthSession =
  | { kind: 'ticket'; ticket: string; csrfToken: string; proxmoxHost: string; userid: string; /* existing fields */ }
  | { kind: 'token'; tokenId: string; secret: string; proxmoxHost: string };
```

Existing code that destructures `session.ticket` must first narrow with `session.kind === 'ticket'`.

### `store.ts`

```ts
export async function loadConfig(): Promise<ServiceAccountConfig | null>;
export async function saveConfig(config: ServiceAccountConfig): Promise<void>;
export async function deleteConfig(): Promise<void>;
```

- File path: `${NEXUS_DATA_DIR}/service-account.json`.
- Encryption: AES-GCM using the same key derivation `exec-audit` uses for audit-log at-rest encryption (share the helper rather than duplicate it).
- Shape validators:
  - `tokenId` must match `/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+![A-Za-z0-9._-]+$/`.
  - `secret` must be non-empty, length ≤ 256.
  - `proxmoxHost` must be a hostname, IPv4, or bracketed IPv6 — reject anything else.
- Writes go through `writeFile(tmp)` + `rename(tmp, final)` so a crash mid-write never leaves a half-encrypted file.

### `session.ts`

```ts
export async function loadServiceAccountAtBoot(): Promise<void>;
export async function reloadServiceAccount(): Promise<void>;
export function getServiceSession(): PVEAuthSession | null;
export function getServiceAccountStatus(): {
  configured: boolean;
  savedAt: number | null;
  userid: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  lastProbeAt: number | null;
};
```

Internal state: `let current: PVEAuthSession | null = null; let status: ServiceAccountStatus = initial;`. `loadServiceAccountAtBoot` reads the file, constructs a `kind: 'token'` session, runs `probeServiceAccount` with a 5s timeout, updates status. `reloadServiceAccount` is called by the save handler after a successful save; serialises via a `let reloadInFlight: Promise<void> | null` guard so concurrent saves don't race.

### `probe.ts`

```ts
export async function probeServiceAccount(
  session: Extract<PVEAuthSession, { kind: 'token' }>
): Promise<{ ok: true; userid: string } | { ok: false; error: string }>;
```

Calls `GET https://{proxmoxHost}:8006/api2/json/access/permissions` via the widened `pveFetch`. Accepts any 2xx response whose body has a truthy `data` map. Reads the token's userid from the tokenId (everything before `!`). Returns `{ ok: false, error }` on HTTP error, network error, or timeout (5s AbortController).

### `pve-fetch.ts` diff

Replace the current header-construction block with:

```ts
const headers = new Headers(init?.headers);
switch (session.kind) {
  case 'ticket':
    headers.set('Cookie', `PVEAuthCookie=${session.ticket}`);
    if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('CSRFPreventionToken', session.csrfToken);
    }
    break;
  case 'token':
    headers.set('Authorization', `PVEAPIToken=${session.tokenId}=${session.secret}`);
    break;
}
```

All other behaviour (fetch call, error handling, status interpretation) is unchanged.

### Settings API routes

- `GET /api/system/service-account` (CSRF-protected, auth required) → `getServiceAccountStatus()`. Never returns `secret` or `tokenId`.
- `PUT /api/system/service-account` (CSRF-protected) → body `{ tokenId, secret, proxmoxHost }`. Validates shapes via `store.ts` validators. Calls `saveConfig` then `reloadServiceAccount` then responds with the fresh status (including probe outcome).
- `DELETE /api/system/service-account` (CSRF-protected) → calls `deleteConfig` + resets singleton. Responds with empty status.
- `POST /api/system/service-account/probe` (CSRF-protected) → calls `probeServiceAccount(current)` without re-saving. Returns the probe result.

All routes use the existing `withAuth` + `withCsrf` HOFs.

### Settings page `/dashboard/system/service-account/page.tsx`

Three top-level states based on `useServiceAccountStatus()`:

**Not configured:** Quick-setup panel with copy-paste `pveum` block:

```
pveum user add nexus@pve
pveum acl modify / -user nexus@pve -role PVEAuditor
pveum acl modify /vms -user nexus@pve -role PVEVMAdmin
pveum user token add nexus@pve automation --privsep 0
```

Plus form: `tokenId`, `secret`, `proxmoxHost` (with placeholder `127.0.0.1` if Nexus runs co-located). Save button disabled until all three fields populated and pattern-valid.

**Configured & healthy:** "Authenticated as `{userid}`, last verified {timeago}" + **Re-verify** + **Disconnect** buttons.

**Configured but failing:** Same as healthy plus a red banner with the last probe error message, and the setup form available to overwrite (pre-filled with existing tokenId, secret blank, proxmoxHost filled).

Uses `useCsrfMutation` for PUT/DELETE/POST; standard inline error surface.

### `service-account-banner.tsx`

Rendered inside the dashboard layout. Query: `['service-account', 'status']` with staleTime 60s. Visible when `configured === false`. Copy:

> Background automation is not running. Configure a service account to enable DRS, auto-updates, and pressure monitoring. [Configure →]

Dismissible via a sessionStorage flag (key `nexus:service-account-banner-dismissed`). Reappears on next tab-load until configured.

### Ticker replacements in `server.ts`

```ts
await loadServiceAccountAtBoot();

// DRS
const drsTimer = setInterval(() => {
  void (async () => {
    const session = getServiceSession();
    await runDrsTick({
      fetchCluster: async () => {
        if (!session) throw new Error('no service account configured');
        return api.cluster.resources(session);  // existing helper, will now accept session of either kind
      },
    });
  })();
}, 60_000);

// Guest-agent
startGuestPollSource({
  getSession: () => getServiceSession(),
  fetchGuests: async () => {
    const session = getServiceSession();
    if (!session) return [];
    const resources = await api.cluster.resources(session);
    return resources.filter(r => r.type === 'qemu' && r.template !== 1).map(toGuestTarget);
  },
});

// Notification poll source: similar shape.
```

Each ticker's existing history entry format already handles the "skipped" case; we don't change the history entry shape, just the reason text (from "fetchCluster failed …" to "no service account configured").

## Data flow

**Boot.** `server.ts` calls `await loadServiceAccountAtBoot()` before any ticker starts. If the file exists and decrypts cleanly, the session is populated and probed (non-blocking). If anything fails, boot still succeeds — the tickers just start in no-op mode.

**Save.** Operator submits the form → `useCsrfMutation` PUT `/api/system/service-account` → handler validates + writes + reloads → response invalidates `['service-account', 'status']` → banner + settings page re-render with fresh status.

**Tick.** Each ticker's tick callback calls `getServiceSession()`. If `null`, records skipped history entry and returns. Otherwise, proceeds with real PVE I/O.

## Error handling

- Malformed file at boot → logged once, singleton null, status records the decrypt error, banner shows.
- Probe 401/403 on save → error surfaced inline in the settings form. Tickers still try each tick in case PVE recovers.
- Probe network timeout → 5s AbortController → error text is "Could not reach {proxmoxHost}:8006 within 5s".
- Save with bad shape → 400 with specific validator error → inline on form.
- Concurrent saves → serialised via `reloadInFlight` guard.
- Per-ticker permission failures at runtime (e.g. DRS can't `VM.Migrate`) → recorded in that ticker's existing history format. Not surfaced on the service-account page in v1.

## Testing

Following house style (`node --test` + `tsx`, no RTL):

**`lib/service-account/store.test.ts`:**
- Valid round-trip: `saveConfig(c)` → `loadConfig()` returns same values.
- `tokenId` regex: happy `nexus@pve!automation`, plus rejections for missing `!`, missing `@realm`, illegal chars.
- `secret` empty → reject; 256 chars → accept; 257 → reject.
- `proxmoxHost` accepts hostname / IPv4 / `[::1]`; rejects `http://foo` and path segments.
- Missing file → `loadConfig` returns null.
- Corrupt encrypted file → `loadConfig` returns null (no throw).

**`lib/pve-fetch.test.ts` (extend):**
- Token session → outgoing request has `Authorization: PVEAPIToken=...`, NO `Cookie`, NO `CSRFPreventionToken`.
- Ticket session + POST → has both `Cookie` and `CSRFPreventionToken` (regression guard on the discriminant).
- Ticket session + GET → has `Cookie`, no `CSRFPreventionToken`.

**`lib/service-account/probe.test.ts`:**
- Happy path: 200 with permissions map → `{ ok: true, userid: 'nexus@pve!automation' }`.
- 401 → `{ ok: false, error: '<PVE message>' }`.
- Network timeout → `{ ok: false, error: 'Could not reach ...' }`.
- Malformed JSON → `{ ok: false, error: ... }`.

**`lib/service-account/session.test.ts`:**
- Boot with no file → singleton null, status.configured false.
- Boot with valid file → singleton set, status.configured true.
- `reloadServiceAccount` after save → singleton replaced.
- `deleteConfig` + reload → singleton null.
- Concurrent `reloadServiceAccount` calls serialise.

No UI tests. Settings page is thin glue over `useCsrfMutation`.

## Manual verification (for the release gate)

1. **Fresh install, no token** → banner visible → settings page shows Not configured → generate a PVE token via `pveum`, paste → probe succeeds → banner disappears → wait 60s → DRS dashboard shows a tick recorded with `skipped: 0, evaluated: N`.
2. **Bad token** → save a deliberately wrong secret → probe fails with 401 → settings page shows the PVE error → banner stays visible.
3. **Disconnect** → click Disconnect → banner reappears → DRS history next entry reads `skipped: no service account configured`.
4. **Guest-agent probes actually run** → with a CT/VM that has qemu-guest-agent enabled, check that the pressure widget populates within 2 tick cycles.

## Non-goals (explicit)

- No username/password fallback.
- No auto-grant of ACLs.
- No token rotation reminders.
- No per-ticker permission enumeration on the settings page.
- No install-script integration.
- No multi-cluster support.
- No change to the existing `runDrsTick` / poll-source / updates APIs beyond replacing the boot seams.

## Commit plan

1. `types.ts` + `pve-fetch.ts` widening + test — the discriminated-union foundation.
2. `store.ts` + tests.
3. `probe.ts` + tests.
4. `session.ts` + tests.
5. API routes (`/api/system/service-account` and `/probe`).
6. Settings page.
7. Dashboard banner.
8. `server.ts` ticker replacements + `loadServiceAccountAtBoot` call.
9. Release chore (version bump + tag + push, gated on manual verification).
