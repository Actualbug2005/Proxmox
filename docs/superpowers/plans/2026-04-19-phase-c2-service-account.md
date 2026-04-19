# Phase C.2 — Service-Account Session Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock the four background tickers (DRS, guest-agent, notifications, updates) by giving them a real PVE session backed by an API-token service account the operator configures through a new settings page. Ships as **0.27.0**.

**Architecture:** New isolated module `nexus/src/lib/service-account/` owns the credential lifecycle. New `ServiceAccountSession` type + `pveFetchWithToken` helper sit alongside existing `PVEAuthSession` + `pveFetch` without touching them — the two auth paths never intersect at a consumer. Tickers read a singleton via `getServiceSession()`. Operators configure via `/dashboard/system/service-account`; a dismissible banner nudges until configured.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, TanStack Query 5, AES-GCM via existing `exec-audit` crypto helper, PVE 8.x API tokens.

**Deliberate template deviation:** TDD applies to Tasks 1–4 (pure library modules — `types`+`pveFetchWithToken`, `store`, `probe`, `session`). Tasks 5–8 (routes, settings page, banner, server boot) are UI/boot glue verified via `tsc`+`lint`+ existing test suite plus a manual checklist. Task 9 (release) is gated on operator signoff of the 4-scenario manual checklist against live PVE.

**Spec:** `docs/superpowers/specs/2026-04-19-phase-c2-service-account-design.md`

---

## File Structure

**New:**
- `nexus/src/lib/service-account/types.ts` — `ServiceAccountConfig`, `ServiceAccountSession`.
- `nexus/src/lib/service-account/store.ts` — encrypted read/write of `${NEXUS_DATA_DIR}/service-account.json`.
- `nexus/src/lib/service-account/probe.ts` — `probeServiceAccount` hits `/access/permissions`.
- `nexus/src/lib/service-account/session.ts` — `loadServiceAccountAtBoot`, `reloadServiceAccount`, `getServiceSession`, `getServiceAccountStatus`.
- `nexus/src/lib/service-account/store.test.ts`
- `nexus/src/lib/service-account/probe.test.ts`
- `nexus/src/lib/service-account/session.test.ts`
- `nexus/src/app/api/system/service-account/route.ts` — GET / PUT / DELETE.
- `nexus/src/app/api/system/service-account/probe/route.ts` — POST (re-verify).
- `nexus/src/app/(app)/dashboard/system/service-account/page.tsx` — settings UI.
- `nexus/src/components/dashboard/service-account-banner.tsx` — dismissible nag.

**Modified:**
- `nexus/src/lib/pve-fetch.ts` — add `pveFetchWithToken` helper.
- `nexus/src/lib/pve-fetch.test.ts` (if absent, create; otherwise extend).
- `nexus/server.ts` — `await loadServiceAccountAtBoot()`; replace the four ticker stubs.
- Three ticker modules (`lib/guest-agent/poll-source.ts`, `lib/drs/runner.ts`, `lib/notifications/poll-source.ts`) — retype the session seam argument from `PVEAuthSession | undefined` to `ServiceAccountSession | null`.
- `nexus/src/app/(app)/dashboard/layout.tsx` (or nearest common ancestor to all dashboard pages) — mount `<ServiceAccountBanner />`.
- `nexus/package.json` — version bump (Task 9 only).

`nexus/src/types/proxmox.ts` is **NOT** modified. `PVEAuthSession` stays exactly as it is.

---

## Phase 0 — Preflight

- [ ] **Step 0.1: Confirm on `main`, working tree clean.**
  `git -C /Users/devlin/Documents/GitHub/Proxmox status`
  Expected: `On branch main`, `nothing to commit, working tree clean`.

- [ ] **Step 0.2: Baseline build.**
  From `nexus/`:
  - `npx tsc --noEmit` → exit 0
  - `npm run lint` → exit 0
  - `npm test` → 418/418 pass (post-0.26.0 baseline)

  If any fails, stop and report.

- [ ] **Step 0.3: Refresh GitNexus index.**
  From repo root: `npx gitnexus analyze --embeddings`.

---

## Task 1 — Types + `pveFetchWithToken` (TDD)

**Files:**
- Create: `nexus/src/lib/service-account/types.ts`
- Modify: `nexus/src/lib/pve-fetch.ts`
- Extend (or create): `nexus/src/lib/pve-fetch.test.ts`

- [ ] **Step 1.1: Create `types.ts`.**

```ts
export interface ServiceAccountConfig {
  /** Full PVE token id: "user@realm!tokenname" (e.g. "nexus@pve!automation"). */
  tokenId: string;
  /** UUID secret PVE issued when the token was created. */
  secret: string;
  /** PVE host — e.g. "127.0.0.1" or a cluster FQDN. */
  proxmoxHost: string;
  /** Epoch ms. */
  savedAt: number;
}

export interface ServiceAccountSession {
  tokenId: string;
  secret: string;
  proxmoxHost: string;
}
```

- [ ] **Step 1.2: Read the existing `pveFetch` to understand its dispatcher/TLS handling.**

Read `/Users/devlin/Documents/GitHub/Proxmox/nexus/src/lib/pve-fetch.ts`. Identify how the self-signed-cert / `NODE_TLS_REJECT_UNAUTHORIZED=0` dispatcher is wired. If there is a reusable helper you can call from the new token path, use it. If the TLS behaviour is inline in `pveFetch`, duplicate the 3–5 lines into `pveFetchWithToken` rather than refactoring the existing function.

- [ ] **Step 1.3: Write the failing test first.**

Append (or create if absent) `nexus/src/lib/pve-fetch.test.ts` with this case. If the file exists, add the new test block; don't rewrite existing tests.

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pveFetchWithToken } from './pve-fetch.ts';
import type { ServiceAccountSession } from './service-account/types.ts';

describe('pveFetchWithToken', () => {
  it('sets Authorization: PVEAPIToken and does not set Cookie or CSRFPreventionToken', async () => {
    const session: ServiceAccountSession = {
      tokenId: 'nexus@pve!automation',
      secret: 'abc-123-def',
      proxmoxHost: '127.0.0.1',
    };
    const captured: { url: string; init: RequestInit | undefined } = { url: '', init: undefined };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response('{"data":{}}', { status: 200 });
    }) as typeof fetch;
    try {
      await pveFetchWithToken(session, 'https://127.0.0.1:8006/api2/json/access/permissions');
    } finally {
      globalThis.fetch = originalFetch;
    }
    const headers = new Headers(captured.init?.headers);
    assert.equal(headers.get('Authorization'), 'PVEAPIToken=nexus@pve!automation=abc-123-def');
    assert.equal(headers.get('Cookie'), null);
    assert.equal(headers.get('CSRFPreventionToken'), null);
  });
});
```

- [ ] **Step 1.4: Run the test — expect failure because `pveFetchWithToken` doesn't exist.**

From `nexus/`: `node --import tsx --test src/lib/pve-fetch.test.ts`.
Expected: cannot find export `pveFetchWithToken`.

- [ ] **Step 1.5: Add `pveFetchWithToken` to `pve-fetch.ts`.**

At the bottom of the existing file:

```ts
import type { ServiceAccountSession } from './service-account/types.ts';

export async function pveFetchWithToken(
  session: ServiceAccountSession,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `PVEAPIToken=${session.tokenId}=${session.secret}`);
  // Share the TLS / dispatcher handling with pveFetch. If the existing
  // file exposes a helper for that, reuse it. Otherwise duplicate the
  // ≤5 lines here so we don't refactor pveFetch.
  return fetch(url, { ...init, headers });
}
```

If `pveFetch` uses `undici` `Agent` or similar for self-signed certs, pass the same dispatcher through in the fetch call. Don't refactor `pveFetch` itself — just make sure the new helper has equivalent TLS behaviour.

- [ ] **Step 1.6: Run the test — expect PASS.**

From `nexus/`: `node --import tsx --test src/lib/pve-fetch.test.ts`.
Expected: 1 new suite passes.

- [ ] **Step 1.7: Full verify.**
  - `npx tsc --noEmit` → exit 0
  - `npm run lint` → exit 0
  - `npm test` → total count increased by 1 (baseline 418 → 419), zero fail.

- [ ] **Step 1.8: Commit.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/lib/service-account/types.ts \
  nexus/src/lib/pve-fetch.ts \
  nexus/src/lib/pve-fetch.test.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): types + pveFetchWithToken helper

Adds ServiceAccountSession + ServiceAccountConfig types and a sibling
pveFetchWithToken that sends PVE API tokens via the single
Authorization: PVEAPIToken header. The existing pveFetch and its
ticket pathway are untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — `store.ts` (TDD)

**Files:**
- Create: `nexus/src/lib/service-account/store.ts`
- Create: `nexus/src/lib/service-account/store.test.ts`

- [ ] **Step 2.1: Read the existing `exec-audit` encryption helper.**

Find the AES-GCM helper in `nexus/src/lib/exec-audit.ts` (or wherever the audit-log-at-rest encryption actually lives — grep `AES-GCM` or `createCipheriv` from `nexus/src/lib`). Note the exported function names and key-derivation signature. You'll reuse them.

- [ ] **Step 2.2: Write the failing test first.**

Create `nexus/src/lib/service-account/store.test.ts`:

```ts
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, deleteConfig } from './store.ts';
import type { ServiceAccountConfig } from './types.ts';

let dataDir: string;
const origDataDir = process.env.NEXUS_DATA_DIR;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nexus-sa-test-'));
  process.env.NEXUS_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await deleteConfig().catch(() => undefined);
});

after(() => {
  if (origDataDir !== undefined) process.env.NEXUS_DATA_DIR = origDataDir;
  else delete process.env.NEXUS_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('service-account store', () => {
  it('returns null when no file exists', async () => {
    assert.equal(await loadConfig(), null);
  });

  it('round-trips a valid config', async () => {
    const cfg: ServiceAccountConfig = {
      tokenId: 'nexus@pve!automation',
      secret: 'abcd-1234-efgh-5678',
      proxmoxHost: '127.0.0.1',
      savedAt: 1700000000000,
    };
    await saveConfig(cfg);
    assert.deepEqual(await loadConfig(), cfg);
  });

  it('rejects malformed tokenId', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'no-bang-here', secret: 'x', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
    await assert.rejects(() =>
      saveConfig({ tokenId: 'only@pve', secret: 'x', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
  });

  it('rejects empty secret', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: '', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
  });

  it('rejects proxmoxHost with scheme or path', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: 'x', proxmoxHost: 'http://foo', savedAt: 0 }),
    );
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: 'x', proxmoxHost: '127.0.0.1/path', savedAt: 0 }),
    );
  });

  it('accepts IPv6 in brackets', async () => {
    const cfg: ServiceAccountConfig = {
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '[::1]',
      savedAt: 0,
    };
    await saveConfig(cfg);
    assert.deepEqual(await loadConfig(), cfg);
  });

  it('deleteConfig removes the file', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 0,
    });
    await deleteConfig();
    assert.equal(await loadConfig(), null);
  });
});
```

- [ ] **Step 2.3: Run the test — expect failure.**

From `nexus/`: `node --import tsx --test src/lib/service-account/store.test.ts`.
Expected: cannot resolve `./store.ts`.

- [ ] **Step 2.4: Implement `store.ts`.**

Create `nexus/src/lib/service-account/store.ts`. Use the existing AES-GCM helper you identified in Step 2.1; replace `encrypt`/`decrypt` below with that helper's real names.

```ts
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ServiceAccountConfig } from './types.ts';
// import { encryptAtRest, decryptAtRest } from '<actual helper path>';

const TOKEN_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+![A-Za-z0-9._-]+$/;
const HOSTNAME_RE = /^[A-Za-z0-9.-]+$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_BRACKETED_RE = /^\[[0-9A-Fa-f:]+\]$/;

function dataDir(): string {
  return process.env.NEXUS_DATA_DIR || '/var/lib/nexus';
}

function filePath(): string {
  return join(dataDir(), 'service-account.json');
}

function validate(config: ServiceAccountConfig): void {
  if (!TOKEN_ID_RE.test(config.tokenId)) {
    throw new Error(`Invalid tokenId (expected user@realm!tokenname): ${config.tokenId}`);
  }
  if (typeof config.secret !== 'string' || config.secret.length === 0 || config.secret.length > 256) {
    throw new Error('secret must be a non-empty string ≤ 256 chars');
  }
  const host = config.proxmoxHost;
  const hostOk = HOSTNAME_RE.test(host) || IPV4_RE.test(host) || IPV6_BRACKETED_RE.test(host);
  if (!hostOk) throw new Error(`Invalid proxmoxHost: ${host}`);
  if (typeof config.savedAt !== 'number' || !Number.isFinite(config.savedAt)) {
    throw new Error('savedAt must be a finite number');
  }
}

export async function loadConfig(): Promise<ServiceAccountConfig | null> {
  const path = filePath();
  if (!existsSync(path)) return null;
  try {
    const buf = await readFile(path);
    const decrypted = decryptAtRest(buf); // replace with real helper
    const parsed = JSON.parse(decrypted.toString('utf8')) as ServiceAccountConfig;
    validate(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConfig(config: ServiceAccountConfig): Promise<void> {
  validate(config);
  const path = filePath();
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${path}.tmp`;
  const encrypted = encryptAtRest(Buffer.from(JSON.stringify(config), 'utf8')); // replace with real helper
  await writeFile(tmp, encrypted, { mode: 0o600 });
  await rename(tmp, path);
}

export async function deleteConfig(): Promise<void> {
  const path = filePath();
  if (existsSync(path)) await unlink(path);
}
```

Replace the `encryptAtRest`/`decryptAtRest` placeholders with the real helper identified in Step 2.1. If the helper takes/returns strings rather than buffers, adjust accordingly.

- [ ] **Step 2.5: Run the test — expect PASS.**

From `nexus/`: `node --import tsx --test src/lib/service-account/store.test.ts`.

- [ ] **Step 2.6: Full verify + commit.**

```
npx tsc --noEmit
npm run lint
npm test

git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/lib/service-account/store.ts \
  nexus/src/lib/service-account/store.test.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): encrypted store with shape validators

Persists ServiceAccountConfig to ${NEXUS_DATA_DIR}/service-account.json
via the exec-audit AES-GCM helper. Shape validators reject malformed
tokenIds, empty secrets, and hosts with schemes/paths. Bracketed IPv6
accepted. Tempfile + rename so a crash mid-write never leaves a
half-encrypted file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `probe.ts` (TDD)

**Files:**
- Create: `nexus/src/lib/service-account/probe.ts`
- Create: `nexus/src/lib/service-account/probe.test.ts`

- [ ] **Step 3.1: Write the failing test first.**

Create `nexus/src/lib/service-account/probe.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { probeServiceAccount } from './probe.ts';
import type { ServiceAccountSession } from './types.ts';

const session: ServiceAccountSession = {
  tokenId: 'nexus@pve!automation',
  secret: 'abc',
  proxmoxHost: '127.0.0.1',
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('probeServiceAccount', () => {
  it('returns ok with userid on 200 with data map', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { '/': { 'Sys.Audit': 1 } } }), { status: 200 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.deepEqual(result, { ok: true, userid: 'nexus@pve!automation' });
  });

  it('returns error on 401', async () => {
    globalThis.fetch = (async () =>
      new Response('authentication failure', { status: 401 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /401|authentication/i);
  });

  it('returns error when fetch throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /ECONNREFUSED|Could not reach/i);
  });

  it('returns error on 200 with malformed body', async () => {
    globalThis.fetch = (async () =>
      new Response('not json at all', { status: 200 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
  });
});
```

- [ ] **Step 3.2: Run the test — expect failure.**

From `nexus/`: `node --import tsx --test src/lib/service-account/probe.test.ts`.

- [ ] **Step 3.3: Implement `probe.ts`.**

```ts
import { pveFetchWithToken } from '../pve-fetch.ts';
import type { ServiceAccountSession } from './types.ts';

const PROBE_TIMEOUT_MS = 5000;

export async function probeServiceAccount(
  session: ServiceAccountSession,
): Promise<{ ok: true; userid: string } | { ok: false; error: string }> {
  const userid = session.tokenId;
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await pveFetchWithToken(session, url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body || res.statusText}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    if (!json || !json.data) {
      return { ok: false, error: 'PVE returned a success response with no data map' };
    }
    return { ok: true, userid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3.4: Run the test — expect PASS.**

- [ ] **Step 3.5: Full verify + commit.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/lib/service-account/probe.ts \
  nexus/src/lib/service-account/probe.test.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): probe against /access/permissions

Five-second timeout via AbortController. Happy path returns
{ ok: true, userid }. 401 / 403 / other non-2xx surface PVE's body.
Network errors and malformed JSON both land on the ok:false branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `session.ts` (TDD)

**Files:**
- Create: `nexus/src/lib/service-account/session.ts`
- Create: `nexus/src/lib/service-account/session.test.ts`

- [ ] **Step 4.1: Write the failing test first.**

Create `nexus/src/lib/service-account/session.test.ts`:

```ts
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig, deleteConfig } from './store.ts';
import {
  loadServiceAccountAtBoot,
  reloadServiceAccount,
  getServiceSession,
  getServiceAccountStatus,
} from './session.ts';

let dataDir: string;
const origDataDir = process.env.NEXUS_DATA_DIR;
let originalFetch: typeof globalThis.fetch;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nexus-sa-session-'));
  process.env.NEXUS_DATA_DIR = dataDir;
  originalFetch = globalThis.fetch;
  // Default: probes succeed.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { '/': { 'Sys.Audit': 1 } } }), { status: 200 })) as typeof fetch;
});

beforeEach(async () => {
  await deleteConfig().catch(() => undefined);
});

after(() => {
  globalThis.fetch = originalFetch;
  if (origDataDir !== undefined) process.env.NEXUS_DATA_DIR = origDataDir;
  else delete process.env.NEXUS_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('service-account session singleton', () => {
  it('boot with no file → null session, status.configured false', async () => {
    await loadServiceAccountAtBoot();
    assert.equal(getServiceSession(), null);
    assert.equal(getServiceAccountStatus().configured, false);
  });

  it('boot with valid file → session populated, status.configured true', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1700000000000,
    });
    await loadServiceAccountAtBoot();
    const s = getServiceSession();
    assert.ok(s);
    assert.equal(s.tokenId, 'nexus@pve!automation');
    assert.equal(getServiceAccountStatus().configured, true);
    assert.equal(getServiceAccountStatus().lastProbeOk, true);
  });

  it('reload after save replaces singleton', async () => {
    await loadServiceAccountAtBoot(); // starts null
    assert.equal(getServiceSession(), null);
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await reloadServiceAccount();
    assert.ok(getServiceSession());
  });

  it('deleteConfig + reload → singleton null again', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await reloadServiceAccount();
    assert.ok(getServiceSession());
    await deleteConfig();
    await reloadServiceAccount();
    assert.equal(getServiceSession(), null);
    assert.equal(getServiceAccountStatus().configured, false);
  });

  it('concurrent reload calls serialise (no corrupt status)', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await Promise.all([reloadServiceAccount(), reloadServiceAccount(), reloadServiceAccount()]);
    assert.equal(getServiceAccountStatus().configured, true);
  });
});
```

- [ ] **Step 4.2: Run the test — expect failure.**

- [ ] **Step 4.3: Implement `session.ts`.**

```ts
import { loadConfig } from './store.ts';
import { probeServiceAccount } from './probe.ts';
import type { ServiceAccountSession } from './types.ts';

interface Status {
  configured: boolean;
  savedAt: number | null;
  userid: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  lastProbeAt: number | null;
}

let current: ServiceAccountSession | null = null;
let status: Status = {
  configured: false,
  savedAt: null,
  userid: null,
  lastProbeOk: null,
  lastProbeError: null,
  lastProbeAt: null,
};
let reloadInFlight: Promise<void> | null = null;

async function doReload(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) {
    current = null;
    status = { configured: false, savedAt: null, userid: null, lastProbeOk: null, lastProbeError: null, lastProbeAt: null };
    return;
  }
  current = { tokenId: cfg.tokenId, secret: cfg.secret, proxmoxHost: cfg.proxmoxHost };
  const probe = await probeServiceAccount(current);
  status = {
    configured: true,
    savedAt: cfg.savedAt,
    userid: probe.ok ? probe.userid : cfg.tokenId,
    lastProbeOk: probe.ok,
    lastProbeError: probe.ok ? null : probe.error,
    lastProbeAt: Date.now(),
  };
}

export async function loadServiceAccountAtBoot(): Promise<void> {
  await reloadServiceAccount();
}

export async function reloadServiceAccount(): Promise<void> {
  if (reloadInFlight) {
    await reloadInFlight;
    return;
  }
  reloadInFlight = doReload().finally(() => {
    reloadInFlight = null;
  });
  await reloadInFlight;
}

export function getServiceSession(): ServiceAccountSession | null {
  return current;
}

export function getServiceAccountStatus(): Status {
  return { ...status };
}
```

- [ ] **Step 4.4: Run the test — expect PASS.**

- [ ] **Step 4.5: Full verify + commit.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/lib/service-account/session.ts \
  nexus/src/lib/service-account/session.test.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): in-memory session singleton + status

loadServiceAccountAtBoot runs once at server start, reads the
encrypted file, probes /access/permissions, sets both the session
singleton and the exposed status. reloadServiceAccount is serialised
so concurrent save-handler calls don't race. Status is the read
surface for the settings page + dashboard banner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — API routes

**Files:**
- Create: `nexus/src/app/api/system/service-account/route.ts`
- Create: `nexus/src/app/api/system/service-account/probe/route.ts`

- [ ] **Step 5.1: Read existing route conventions.**

Open an existing `withAuth` + `withCsrf`-using route — e.g. `nexus/src/app/api/notifications/destinations/route.ts`. Match its import style, error shapes, JSON return format.

- [ ] **Step 5.2: Create the main route.**

Create `nexus/src/app/api/system/service-account/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { withCsrf } from '@/lib/csrf';
import { deleteConfig, saveConfig } from '@/lib/service-account/store';
import { reloadServiceAccount, getServiceAccountStatus } from '@/lib/service-account/session';

export const GET = withAuth(async () => {
  return NextResponse.json(getServiceAccountStatus());
});

export const PUT = withCsrf(withAuth(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'missing body' }, { status: 400 });
  }
  const { tokenId, secret, proxmoxHost } = body as Record<string, unknown>;
  if (typeof tokenId !== 'string' || typeof secret !== 'string' || typeof proxmoxHost !== 'string') {
    return NextResponse.json({ error: 'tokenId, secret, proxmoxHost must all be strings' }, { status: 400 });
  }
  try {
    await saveConfig({ tokenId, secret, proxmoxHost, savedAt: Date.now() });
    await reloadServiceAccount();
    return NextResponse.json(getServiceAccountStatus());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}));

export const DELETE = withCsrf(withAuth(async () => {
  await deleteConfig();
  await reloadServiceAccount();
  return NextResponse.json(getServiceAccountStatus());
}));
```

Adjust the `withAuth`/`withCsrf` import paths and composition order to match the existing pattern you read in Step 5.1. The exact HOF-wrapping shape matters — if the project style is `withAuth(withCsrf(...))` rather than `withCsrf(withAuth(...))`, use that.

- [ ] **Step 5.3: Create the probe route.**

Create `nexus/src/app/api/system/service-account/probe/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { withCsrf } from '@/lib/csrf';
import { getServiceSession } from '@/lib/service-account/session';
import { probeServiceAccount } from '@/lib/service-account/probe';

export const POST = withCsrf(withAuth(async () => {
  const session = getServiceSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'no service account configured' }, { status: 400 });
  }
  const result = await probeServiceAccount(session);
  return NextResponse.json(result);
}));
```

- [ ] **Step 5.4: Verify.**

From `nexus/`: `npx tsc --noEmit`, `npm run lint`, `npm test` — all clean.

- [ ] **Step 5.5: Commit.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/app/api/system/service-account/route.ts \
  nexus/src/app/api/system/service-account/probe/route.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): API routes — GET / PUT / DELETE + POST /probe

GET returns status (never the secret). PUT validates + saves +
reloads + probes, surfaces probe outcome. DELETE clears creds and
resets the singleton. /probe re-runs the probe against the current
singleton without re-saving. All routes go through the existing
withAuth + withCsrf composition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Settings page

**Files:**
- Create: `nexus/src/app/(app)/dashboard/system/service-account/page.tsx`

- [ ] **Step 6.1: Read an existing settings-style page.**

Look at `nexus/src/app/(app)/dashboard/notifications/page.tsx` or `nexus/src/app/(app)/dashboard/system/updates/page.tsx` for the house style: `useQuery` + `useCsrfMutation`, studio-card containers, inline error shapes.

- [ ] **Step 6.2: Create the page.**

Create `nexus/src/app/(app)/dashboard/system/service-account/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';

type Status = {
  configured: boolean;
  savedAt: number | null;
  userid: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  lastProbeAt: number | null;
};

const PVEUM_SETUP = `pveum user add nexus@pve
pveum acl modify / -user nexus@pve -role PVEAuditor
pveum acl modify /vms -user nexus@pve -role PVEVMAdmin
pveum user token add nexus@pve automation --privsep 0`;

export default function ServiceAccountPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery<Status>({
    queryKey: ['service-account', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/system/service-account', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load status: ${res.status}`);
      return res.json();
    },
  });

  const [tokenId, setTokenId] = useState('');
  const [secret, setSecret] = useState('');
  const [proxmoxHost, setProxmoxHost] = useState('127.0.0.1');

  const saveMutation = useCsrfMutation<Status, { tokenId: string; secret: string; proxmoxHost: string }>({
    url: () => '/api/system/service-account',
    method: 'PUT',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const deleteMutation = useCsrfMutation<Status, void>({
    url: () => '/api/system/service-account',
    method: 'DELETE',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const probeMutation = useCsrfMutation<{ ok: boolean; error?: string; userid?: string }, void>({
    url: () => '/api/system/service-account/probe',
    method: 'POST',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const canSubmit = tokenId.length > 0 && secret.length > 0 && proxmoxHost.length > 0;

  function onSave() {
    saveMutation.mutate(
      { tokenId, secret, proxmoxHost },
      {
        onSuccess: () => {
          setSecret('');
          void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
        },
      },
    );
  }

  function onDisconnect() {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setTokenId('');
        setSecret('');
        void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
      },
    });
  }

  function onReVerify() {
    probeMutation.mutate(undefined, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
      },
    });
  }

  if (!status) {
    return <div className="p-6 text-[var(--color-fg-subtle)]">Loading…</div>;
  }

  const configured = status.configured;
  const healthy = configured && status.lastProbeOk === true;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Service Account</h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          A PVE API token Nexus uses for background automation (DRS, auto-updates, pressure monitoring).
        </p>
      </div>

      {!configured && (
        <div className="studio-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Quick setup</h2>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Run these on any PVE node, then paste the generated token below.
          </p>
          <pre className="text-xs bg-[var(--color-overlay)] p-3 rounded-lg overflow-x-auto whitespace-pre text-[var(--color-fg-secondary)]">
{PVEUM_SETUP}
          </pre>
        </div>
      )}

      {configured && healthy && (
        <div className="studio-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-ok)]">Connected</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            Authenticated as <code>{status.userid}</code>
            {status.lastProbeAt && <> · last verified {new Date(status.lastProbeAt).toLocaleString()}</>}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onReVerify}
              disabled={probeMutation.isPending}
              className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50"
            >
              {probeMutation.isPending ? 'Re-verifying…' : 'Re-verify'}
            </button>
            <button
              onClick={onDisconnect}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 bg-[var(--color-err)] text-white text-sm rounded-lg disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {configured && !healthy && (
        <div className="studio-card p-5 space-y-3 border border-[var(--color-err)]/30">
          <h2 className="text-sm font-semibold text-[var(--color-err)]">Connected but failing</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            {status.lastProbeError ?? 'Probe has not run yet.'}
          </p>
          <div className="flex gap-2">
            <button onClick={onReVerify} disabled={probeMutation.isPending} className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50">
              Re-verify
            </button>
            <button onClick={onDisconnect} disabled={deleteMutation.isPending} className="px-4 py-2 bg-[var(--color-err)] text-white text-sm rounded-lg disabled:opacity-50">
              Disconnect
            </button>
          </div>
        </div>
      )}

      <div className="studio-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">
          {configured ? 'Update credentials' : 'Configure'}
        </h2>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Token ID</span>
          <input
            type="text"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="nexus@pve!automation"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Secret</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Proxmox host</span>
          <input
            type="text"
            value={proxmoxHost}
            onChange={(e) => setProxmoxHost(e.target.value)}
            placeholder="127.0.0.1"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        {saveMutation.error && (
          <p className="text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">
            {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
          </p>
        )}
        <button
          onClick={onSave}
          disabled={!canSubmit || saveMutation.isPending}
          className="px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm font-medium rounded-lg transition disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.3: Verify + commit.**

```
npx tsc --noEmit
npm run lint
npm test

git -C /Users/devlin/Documents/GitHub/Proxmox add 'nexus/src/app/(app)/dashboard/system/service-account/page.tsx'
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): settings page at /dashboard/system/service-account

Three visual states: Not configured (shows the pveum setup block and
a paste form), Connected (userid + last-verified timestamp + re-verify
+ disconnect buttons), Connected-but-failing (red card with the last
probe error, same action buttons, overwrite form underneath).

Secret field is type="password" and the page never round-trips the
secret from the server.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Dashboard banner

**Files:**
- Create: `nexus/src/components/dashboard/service-account-banner.tsx`
- Modify: `nexus/src/app/(app)/dashboard/layout.tsx` (or the component it delegates to for the outer shell)

- [ ] **Step 7.1: Create the banner.**

Create `nexus/src/components/dashboard/service-account-banner.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';

const DISMISS_KEY = 'nexus:service-account-banner-dismissed';

export function ServiceAccountBanner() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  const { data } = useQuery<{ configured: boolean }>({
    queryKey: ['service-account', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/system/service-account', { credentials: 'include' });
      if (!res.ok) throw new Error('status fetch failed');
      return res.json();
    },
    staleTime: 60_000,
  });

  if (dismissed || !data || data.configured) return null;

  function onDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[var(--color-warn)]/10 border-b border-[var(--color-warn)]/20 text-sm text-[var(--color-warn)]">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <p className="flex-1">
        Background automation is not running. Configure a service account to enable DRS,
        auto-updates, and pressure monitoring.
      </p>
      <Link
        href="/dashboard/system/service-account"
        className="px-3 py-1 rounded bg-[var(--color-warn)]/20 text-[var(--color-warn)] text-xs"
      >
        Configure →
      </Link>
      <button onClick={onDismiss} aria-label="Dismiss" className="p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 7.2: Mount the banner in the dashboard layout.**

Open `nexus/src/app/(app)/dashboard/layout.tsx`. Add the import:

```ts
import { ServiceAccountBanner } from '@/components/dashboard/service-account-banner';
```

And render `<ServiceAccountBanner />` as the first child inside the main dashboard frame, above the page content, beneath the top nav. The exact placement depends on the layout's current structure — match its pattern.

- [ ] **Step 7.3: Verify + commit.**

```
npx tsc --noEmit
npm run lint
npm test

git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/src/components/dashboard/service-account-banner.tsx \
  'nexus/src/app/(app)/dashboard/layout.tsx'
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): dashboard banner nudges until configured

Dismissible per-session (sessionStorage), reappears on next tab
load until the operator configures. Visible only when the status
query reports configured=false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Wire tickers to the session singleton

**Files:**
- Modify: `nexus/server.ts`
- Modify: `nexus/src/lib/drs/runner.ts` — if its `fetchCluster` seam currently types `PVEAuthSession | undefined`, change it to accept `ServiceAccountSession | null` (or leave it as `() => Promise<ClusterSnapshot>` and do the null-check in server.ts). Pick whichever keeps the change minimal.
- Modify: `nexus/src/lib/guest-agent/poll-source.ts` — change `getSession: () => PVEAuthSession | undefined` to `getSession: () => ServiceAccountSession | null`.
- Modify: `nexus/src/lib/notifications/poll-source.ts` — same pattern if it has a session seam; otherwise leave alone.

- [ ] **Step 8.1: Read the current ticker seam signatures.**

Open each of the three ticker files. Note the exact type of the session-related parameters. The goal in this step is ONLY to read — so the next step's edits are surgical.

- [ ] **Step 8.2: Retype the seams (type-only change).**

Where a ticker file currently takes `PVEAuthSession | undefined`, change to `ServiceAccountSession | null`. Update the import at the top of each file: remove the `PVEAuthSession` import if no longer used, add `import type { ServiceAccountSession } from '@/lib/service-account/types';`.

The actual PVE API calls inside the ticker probably take a session object directly. If those inner calls (e.g. `api.cluster.resources(session)`) expect a `PVEAuthSession`, either:
- (preferred) change those helpers to accept a new `ServiceAccountSession` overload via an `api.cluster.resourcesByToken(session)` sibling; OR
- call PVE directly via `pveFetchWithToken` inline.

If the third path — rewriting every `api.*` helper — looks too large, **stop and report**. We can scope this task smaller by making the tickers call `pveFetchWithToken` directly for just the endpoints they need (`/cluster/resources`, `/nodes/.../agent/exec`).

- [ ] **Step 8.3: Update `server.ts`.**

Read the existing boot block (search for the `startNotificationPollSource`, `runDrsTick`, `startGuestPollSource` invocations — around lines 340–395 based on earlier context).

At the top of `server.ts`, add:
```ts
import { loadServiceAccountAtBoot, getServiceSession } from './src/lib/service-account/session.ts';
```

Before the ticker boot block (i.e. before `startNotificationPollSource`), add:
```ts
await loadServiceAccountAtBoot();
```

Replace each ticker's stub seam. Example for DRS (adjust to match whatever you saw in Step 8.1):

```ts
const drsTimer = setInterval(() => {
  void (async () => {
    try {
      await runDrsTick({
        fetchCluster: async () => {
          const session = getServiceSession();
          if (!session) throw new Error('no service account configured');
          // Call PVE directly with pveFetchWithToken, OR call the api.cluster.resourcesByToken(session) overload.
          const res = await pveFetchWithToken(session, `https://${session.proxmoxHost}:8006/api2/json/cluster/resources`);
          if (!res.ok) throw new Error(`cluster resources ${res.status}`);
          const { data } = (await res.json()) as { data: unknown[] };
          // TODO: also fetch nodeStatuses; fold into the return shape runDrsTick expects.
          return { resources: data as never, nodeStatuses: {} };
        },
      });
    } catch (err) {
      console.error('[nexus event=drs_tick_failed] reason=%s', err instanceof Error ? err.message : String(err));
    }
  })();
}, 60_000);
drsTimer.unref?.();
```

The TODO inside the lambda means: the DRS runner expects a specific `{resources, nodeStatuses}` shape. If fetching nodeStatuses by token requires per-node `/nodes/{node}/status` calls, either do that (fan-out), or have the runner accept a partial nodeStatuses map and log `skipped: nodeStatuses unavailable` when empty. **Whichever is less code; if fan-out is small, do it.**

Do the equivalent rewrite for the guest-agent poll source (replace `getSession: () => undefined` with `getSession: () => getServiceSession()`) and the notification poll source's `fetchState` seam.

If updating `api.*` helpers to accept a token session is cleaner than duplicating fetch calls inline, do that instead — the goal is correctness, not a specific idiom. **Stop and report** if this step expands beyond ~3 edited files.

- [ ] **Step 8.4: Verify.**

From `nexus/`:
```
npx tsc --noEmit
npm run lint
npm test
```

- [ ] **Step 8.5: Impact check before commit.**

`gitnexus_detect_changes({ scope: "unstaged" })`. Expected: MEDIUM risk at most; affected files all in `server.ts`, `src/lib/drs/`, `src/lib/guest-agent/`, `src/lib/notifications/`, `src/lib/service-account/`.

- [ ] **Step 8.6: Commit.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add \
  nexus/server.ts \
  nexus/src/lib/drs/runner.ts \
  nexus/src/lib/guest-agent/poll-source.ts \
  nexus/src/lib/notifications/poll-source.ts
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
feat(service-account): wire tickers to the session singleton

server.ts now awaits loadServiceAccountAtBoot() before any ticker
starts. DRS runner, guest-agent poll source, and notification poll
source all pull their session from getServiceSession() via seams
typed ServiceAccountSession | null. If the operator hasn't
configured a token, tickers log "no service account configured"
and skip the tick — same history-entry shape as before, just
different reason text.

Closes the Phase C.2 gap: features shipped in v0.20.0–v0.23.0 now
actually run on a fresh install once the operator pastes a token.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Release gated on manual verification

Do NOT run this task until the operator has exercised the 4-scenario manual checklist on a live PVE.

**Scenarios:**
1. **Fresh install, no token.** Banner visible → settings page shows "Not configured" → operator runs the `pveum` block → pastes tokenId/secret/host → probe succeeds → banner disappears → wait 60s → `/dashboard/cluster/drs` shows a tick entry with `skipped: 0, evaluated: N`.
2. **Bad token.** Paste wrong secret → save → page surfaces PVE's 401 error → banner stays visible.
3. **Disconnect.** Click Disconnect → settings page resets → banner reappears → next DRS tick logs `no service account configured`.
4. **Guest-agent probes run.** With a VM/CT that has qemu-guest-agent enabled, the pressure widget populates within 2 poll cycles.

- [ ] **Step 9.1: Wait for operator signoff.** If any scenario fails, stop. Fix. Re-test.

- [ ] **Step 9.2: Bump `nexus/package.json` to `"version": "0.27.0"`.**

- [ ] **Step 9.3: Commit the bump.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox add nexus/package.json
git -C /Users/devlin/Documents/GitHub/Proxmox commit -m "$(cat <<'EOF'
chore(release): v0.27.0 — Phase C.2 service-account session seeding

Unblocks the four background tickers (DRS, guest-agent, notifications,
updates) by giving them a real PVE session backed by an operator-
configured API token. New settings page at /dashboard/system/service-
account. Dismissible dashboard banner until configured.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9.4: Tag and push.**

```
git -C /Users/devlin/Documents/GitHub/Proxmox tag -a v0.27.0 -m "v0.27.0 — Phase C.2 service-account session seeding"
git -C /Users/devlin/Documents/GitHub/Proxmox push origin main
git -C /Users/devlin/Documents/GitHub/Proxmox push origin v0.27.0
```

---

## Self-review

**Spec coverage (against `docs/superpowers/specs/2026-04-19-phase-c2-service-account-design.md`):**

- `ServiceAccountConfig` + `ServiceAccountSession` types — Task 1.
- `pveFetchWithToken` additive helper — Task 1.
- Encrypted store + validators — Task 2.
- Probe against `/access/permissions` with 5s timeout — Task 3.
- Singleton with serialised reload — Task 4.
- API routes GET/PUT/DELETE + probe — Task 5.
- Settings page with Not-configured / Healthy / Failing states — Task 6.
- Dismissible dashboard banner — Task 7.
- Ticker boot replacement + `loadServiceAccountAtBoot` — Task 8.
- Release gated on manual verification — Task 9.

**Placeholder scan:** Two deliberate "replace X with the real helper" steps in Task 2.4 and Task 8.3 — they give the implementer a clear marker to substitute (the actual helper name lives in the codebase, which the plan tells them to identify first). No "TBD", no "similar to Task N", no "handle edge cases".

**Type consistency:** `ServiceAccountSession` is defined in Task 1 and consumed unchanged by Tasks 3, 4, 8 (probe signature, singleton return, ticker seams). `ServiceAccountConfig` is defined in Task 1 and consumed by Task 2 (store). `Status` shape in Task 4 is re-consumed verbatim by Tasks 5 and 6. No drift.

**Template deviation** declared: TDD on Tasks 1–4; Tasks 5–8 verified via tsc/lint/existing-tests plus the manual checklist in Task 9.
