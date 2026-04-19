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

One new module — `nexus/src/lib/service-account/` — owns the credential lifecycle. A separate `ServiceAccountSession` type + new `pveFetchWithToken` helper live alongside the existing `PVEAuthSession` / `pveFetch` pair without touching them, because the two auth paths don't intersect at any consumer: operator-facing routes always take a ticket session; background tickers always take a token session. No existing code is rewritten. A new settings route + page. A small dashboard banner. No new server-side cron, no scheduler changes.

**Why separate types over a discriminated union:** the union would force `if (session.kind === 'ticket')` narrowing in ~10 unrelated call-sites that only ever see a ticket session, for a theoretical uniformity win that no consumer today actually benefits from. Separate types keep the diff surgical and the two auth modes legibly distinct.

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
- `nexus/src/lib/pve-fetch.ts` — add new `pveFetchWithToken(session, url, init)` helper alongside existing `pveFetch`. Existing `pveFetch` stays untouched.
- `nexus/server.ts` — `await loadServiceAccountAtBoot()` before ticker startup; replace the four stubs with `getServiceSession()`-backed seams.
- Three ticker signatures that currently take `PVEAuthSession | undefined` (guest-agent poll source, DRS runner helper, notification poll source helper) — change their type to `ServiceAccountSession | null`. Local to those three files.
- `nexus/src/app/(app)/dashboard/layout.tsx` (or the component one level below that) — mount `<ServiceAccountBanner />`.
- `nexus/package.json` — version bump to 0.27.0 (release task only).

No changes to `nexus/src/types/proxmox.ts`. `PVEAuthSession` and its `ticket`/`csrfToken` fields stay exactly as they are.

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

A new `ServiceAccountSession` type lives in `lib/service-account/types.ts`:

```ts
export interface ServiceAccountSession {
  tokenId: string;
  secret: string;
  proxmoxHost: string;
}
```

`PVEAuthSession` is unchanged. The two types never mix — operator routes pass `PVEAuthSession` to `pveFetch`; tickers pass `ServiceAccountSession` to `pveFetchWithToken`.

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
export function getServiceSession(): ServiceAccountSession | null;
export function getServiceAccountStatus(): {
  configured: boolean;
  savedAt: number | null;
  userid: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  lastProbeAt: number | null;
};
```

Internal state: `let current: ServiceAccountSession | null = null; let status: ServiceAccountStatus = initial;`. `loadServiceAccountAtBoot` reads the file, constructs a `ServiceAccountSession`, runs `probeServiceAccount` with a 5s timeout, updates status. `reloadServiceAccount` is called by the save handler after a successful save; serialises via a `let reloadInFlight: Promise<void> | null` guard so concurrent saves don't race.

### `probe.ts`

```ts
export async function probeServiceAccount(
  session: ServiceAccountSession
): Promise<{ ok: true; userid: string } | { ok: false; error: string }>;
```

Calls `GET https://{proxmoxHost}:8006/api2/json/access/permissions` via `pveFetchWithToken`. Accepts any 2xx response whose body has a truthy `data` map. Reads the token's userid from the tokenId (everything before `!`). Returns `{ ok: false, error }` on HTTP error, network error, or timeout (5s AbortController).

### `pve-fetch.ts` diff — add new `pveFetchWithToken`

Existing `pveFetch(url, init)` and its ticket-auth pathway stay exactly as they are.

Add a sibling helper:

```ts
export async function pveFetchWithToken(
  session: ServiceAccountSession,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `PVEAPIToken=${session.tokenId}=${session.secret}`);
  return fetch(url, { ...init, headers, /* existing dispatcher for self-signed certs etc. */ });
}
```

The self-signed-cert dispatcher and any other behaviour shared with `pveFetch` should be factored into a shared private helper if trivial; otherwise duplicate the ~5 lines. Don't refactor `pveFetch` to consume the shared helper — keep this change purely additive.

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
- `pveFetchWithToken` → outgoing request has `Authorization: PVEAPIToken=...`, NO `Cookie`, NO `CSRFPreventionToken`.
- Existing `pveFetch` tests stay as they are — regression guard that the new helper didn't accidentally rewrite the old one.

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

1. `service-account/types.ts` + `pve-fetch.ts` `pveFetchWithToken` addition + tests.
2. `service-account/store.ts` + tests.
3. `service-account/probe.ts` + tests.
4. `service-account/session.ts` + tests.
5. API routes (`/api/system/service-account` and `/probe`).
6. Settings page.
7. Dashboard banner.
8. `server.ts` ticker replacements + `loadServiceAccountAtBoot` call; retype ticker seams that currently accept `PVEAuthSession | undefined` to `ServiceAccountSession | null`.
9. Release chore (version bump + tag + push, gated on manual verification).
