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
mock.module('@/lib/pve-fetch', {
  namedExports: {
    pveFetch: async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
});

// Import AFTER the mocks so the route binds to the stubbed modules.
const { GET } = await import('./route.ts');

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
