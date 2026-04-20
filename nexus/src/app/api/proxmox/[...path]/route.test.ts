/**
 * Tests for the /api/proxmox/[...path] proxy route.
 *
 * Harness notes — read before extending:
 *   • The project ships no `buildProxyRequest` helper and no prior test
 *     file for this route. These cases exercise the route handler the
 *     same way Next.js does: a `NextRequest` plus a params Promise.
 *   • `@/lib/auth` is mocked via `node:test`'s experimental
 *     `mock.module` (Node 22, `--experimental-test-module-mocks`). The
 *     mocks return a synthetic authenticated session so the assertions
 *     can reach the path/allowlist guards without a live PVE or Redis.
 *   • `@/lib/pve-fetch` is mocked to a no-op that never resolves for the
 *     allowed path — we only check that the allowlist guard did NOT
 *     short-circuit with 403; we don't care about the upstream call.
 *   • `process.env.JWT_SECRET` is set before imports because
 *     `csrf.ts`'s first-call derivation reads it.
 */
process.env.JWT_SECRET = 'proxy-route-test-secret-0123456789';
process.env.PROXMOX_HOST = 'localhost';

import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

// Mock auth BEFORE the route loads so the handler sees synthetic session data.
mock.module('@/lib/auth', {
  namedExports: {
    getSessionId: async () => 'test-session-id',
    getSession: async () => ({
      ticket: 'PVE:test@pam:TESTTICKET',
      csrfToken: 'test-csrf',
      username: 'test@pam',
      expiresAt: Date.now() + 60_000,
      issuedAt: Date.now(),
    }),
    refreshPVESessionIfStale: async (_id: string, session: unknown) => session,
    SESSION_COOKIE: 'nexus_session',
    getJwtSecret: () => Buffer.from('proxy-route-test-secret-0123456789'),
  },
});

// Mock csrf so mutating verbs (not used in these cases) would pass; the
// guards under test all sit on GET so this is a safety net.
mock.module('@/lib/csrf', {
  namedExports: {
    validateCsrf: () => true,
    CSRF_HEADER: 'x-csrf-token',
    CSRF_COOKIE: 'nexus_csrf',
    deriveCsrfToken: () => 'test-csrf',
    csrfMatches: () => true,
  },
});

// Mock pve-fetch so the allowed-path case doesn't try to hit localhost:8006.
// It returns a minimal Response; all we care about is that the handler
// reached this call instead of short-circuiting on the allowlist.
// The mock captures the outbound URL + init so federation-routing
// assertions can verify the rewrite targeted the remote endpoint with
// PVEAPIToken auth instead of the local cookie path.
interface PveFetchCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined;
}
const pveFetchCalls: PveFetchCall[] = [];
mock.module('@/lib/pve-fetch', {
  namedExports: {
    pveFetch: async (url: string, init?: PveFetchCall['init']) => {
      pveFetchCalls.push({ url, init });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
});

// Import AFTER the mocks so the route binds to the stubbed modules.
const { GET } = await import('./route.ts');

// Federation modules for the federation-rewrite describe block below.
// Imported at the module top so the inner describe callback doesn't
// need top-level await (node:test rejects that pattern).
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { beforeEach, afterEach } = await import('node:test');
const { addCluster } = await import('@/lib/federation/store.ts');
const { reloadFederation, __resetForTests } = await import(
  '@/lib/federation/session.ts'
);

/**
 * Build a NextRequest-shaped object and a params Promise for the handler.
 * Next.js 16's App Router hands the catch-all route the already-split
 * `path` array — we mirror that contract here.
 */
function buildProxyRequest(pathSegments: string[]) {
  const url = `http://localhost/api/proxmox/${pathSegments.join('/')}`;
  // NextRequest isn't trivially constructable in a unit context; the
  // handler only touches .url, .method, .headers.get, and .text. A
  // plain Request is a structural match for those surfaces.
  const req = new Request(url, { method: 'GET' });
  const params = Promise.resolve({ path: pathSegments });
  return { req, params };
}

describe('proxy route — top-level resource allowlist (8.3)', () => {
  it('accepts allowlisted top-level resources (cluster/resources)', async () => {
    const { req, params } = buildProxyRequest(['cluster', 'resources']);
    const res = await GET(req as never, { params } as never);
    // The allowlist MUST NOT reject this path. 401 (auth not wired) is
    // acceptable; 403 would indicate the allowlist wrongly denied it.
    assert.notEqual(res.status, 403);
  });

  it('rejects non-allowlisted top-level resources with 403', async () => {
    const { req, params } = buildProxyRequest(['evil']);
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(String(body.error), /not proxied/i);
  });

  it('invalid-segment check runs BEFORE allowlist (400 beats 403)', async () => {
    // ".." is an invalid segment; the handler should emit 400 from the
    // path validator before it ever checks the allowlist.
    const { req, params } = buildProxyRequest(['..', 'etc', 'passwd']);
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 400);
  });
});

// ── Federation rewrite (6.1) ──────────────────────────────────────────────
//
// These cases exercise the ?cluster=<id> routing branch. Registry
// persistence is exercised end-to-end via the real federation store
// (encrypted on-disk), so each test gets its own NEXUS_DATA_DIR and the
// in-memory session module is reset between cases.

describe('proxy route — federation rewrite (?cluster=<id>)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-proxy-'));
    process.env.NEXUS_DATA_DIR = tmp;
    pveFetchCalls.length = 0;
    __resetForTests();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.NEXUS_DATA_DIR;
  });

  /** Variant of buildProxyRequest that preserves a real query string.
   *  The handler reads req.url directly for the ?cluster= extraction. */
  function buildWithQuery(pathSegments: string[], query: string) {
    const url = `http://localhost/api/proxmox/${pathSegments.join('/')}${query ? '?' + query : ''}`;
    const req = new Request(url, { method: 'GET' });
    const params = Promise.resolve({ path: pathSegments });
    return { req, params };
  }

  it('400 on malformed cluster id', async () => {
    // URL-encoded space + mixed case — fails the slug regex.
    const { req, params } = buildWithQuery(
      ['cluster', 'resources'],
      'cluster=Not%20A%20Slug',
    );
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(String(body.error), /Invalid cluster id/i);
  });

  it('404 on unknown but well-formed cluster id', async () => {
    const { req, params } = buildWithQuery(
      ['cluster', 'resources'],
      'cluster=nope',
    );
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(String(body.error), /Cluster not registered/i);
  });

  it('routes to registered cluster and uses PVEAPIToken header (not cookie)', async () => {
    await addCluster({
      id: 'lab',
      name: 'Lab',
      endpoints: ['https://pve-lab:8006'],
      tokenId: 'nexus@pve!fed',
      tokenSecret: 'aaaaaaaaaaaa',
    });
    await reloadFederation();

    const { req, params } = buildWithQuery(
      ['cluster', 'resources'],
      'cluster=lab',
    );
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 200);

    assert.equal(pveFetchCalls.length, 1);
    const call = pveFetchCalls[0];
    assert.ok(
      call.url.startsWith('https://pve-lab:8006/api2/json/'),
      `expected remote base, got ${call.url}`,
    );
    const headers = call.init?.headers ?? {};
    assert.equal(
      headers.Authorization,
      'PVEAPIToken=nexus@pve!fed=aaaaaaaaaaaa',
    );
    // Local cookie path MUST NOT leak into the remote request.
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers.CSRFPreventionToken, undefined);
  });

  it('strips the cluster param from the forwarded query string', async () => {
    await addCluster({
      id: 'lab',
      name: 'Lab',
      endpoints: ['https://pve-lab:8006'],
      tokenId: 'nexus@pve!fed',
      tokenSecret: 'aaaaaaaaaaaa',
    });
    await reloadFederation();

    const { req, params } = buildWithQuery(
      ['cluster', 'resources'],
      'cluster=lab&type=vm',
    );
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 200);

    assert.equal(pveFetchCalls.length, 1);
    const outbound = pveFetchCalls[0].url;
    assert.equal(
      outbound,
      'https://pve-lab:8006/api2/json/cluster/resources?type=vm',
      `forwarded URL should drop cluster= and keep type=vm, got ${outbound}`,
    );
  });

  it('allowlist runs before federation — non-allowlisted top-level with a valid cluster id still 403', async () => {
    await addCluster({
      id: 'lab',
      name: 'Lab',
      endpoints: ['https://pve-lab:8006'],
      tokenId: 'nexus@pve!fed',
      tokenSecret: 'aaaaaaaaaaaa',
    });
    await reloadFederation();

    const { req, params } = buildWithQuery(['evil'], 'cluster=lab');
    const res = await GET(req as never, { params } as never);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(String(body.error), /not proxied/i);
    // And crucially: pveFetch was never called.
    assert.equal(pveFetchCalls.length, 0);
  });
});
