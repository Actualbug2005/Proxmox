/**
 * Tests for /api/federation/clusters (GET + POST).
 *
 * Harness follows the proxy route's mock.module template:
 *   • @/lib/auth + @/lib/csrf + @/lib/permissions mocked at module top,
 *     each backed by mutable state so individual test cases can flip
 *     authenticated / CSRF / privileged independently.
 *   • NEXUS_DATA_DIR is a fresh mkdtempSync per case; the federation
 *     session singleton is __resetForTests()'d between cases.
 *   • JWT_SECRET is set before imports because csrf.ts derives on first
 *     call.
 */
process.env.JWT_SECRET = 'federation-routes-test-secret-0123456789';

import { strict as assert } from 'node:assert';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mutable harness state — flipped per test case. ───────────────────────
let currentSessionId: string | null = 'test-session-id';
let csrfOk = true;
let privilegeOk = true;

mock.module('@/lib/auth', {
  namedExports: {
    getSessionId: async () => currentSessionId,
    getSession: async () =>
      currentSessionId
        ? {
            ticket: 'PVE:test@pam:TESTTICKET',
            csrfToken: 'test-csrf',
            username: 'test@pam',
            expiresAt: Date.now() + 60_000,
            issuedAt: Date.now(),
          }
        : null,
    refreshPVESessionIfStale: async (_id: string, session: unknown) => session,
    SESSION_COOKIE: 'nexus_session',
    getJwtSecret: () => Buffer.from('federation-routes-test-secret-0123456789'),
  },
});

mock.module('@/lib/csrf', {
  namedExports: {
    validateCsrf: () => csrfOk,
    CSRF_HEADER: 'x-csrf-token',
    CSRF_COOKIE: 'nexus_csrf',
    deriveCsrfToken: () => 'test-csrf',
    csrfMatches: () => true,
  },
});

mock.module('@/lib/permissions', {
  namedExports: {
    userHasPrivilege: async () => privilegeOk,
    requireRootSysModify: async () => privilegeOk,
  },
});

// Import AFTER mocks. Session module is imported from .ts so the reset
// helper is reachable.
const { GET, POST } = await import('./route.ts');
const { addCluster } = await import('@/lib/federation/store.ts');
const { __resetForTests, __getProbeStates } = await import(
  '@/lib/federation/session.ts'
);

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-routes-'));
  process.env.NEXUS_DATA_DIR = tmp;
  __resetForTests();
  // Reset harness gates to permissive defaults. Each test flips what it needs.
  currentSessionId = 'test-session-id';
  csrfOk = true;
  privilegeOk = true;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NEXUS_DATA_DIR;
});

const validBody = {
  id: 'prod-west',
  name: 'Production West',
  endpoints: ['https://pve-west-1.example.com:8006'],
  tokenId: 'nexus@pve!federate',
  tokenSecret: 'super-secret-token-value-abc123',
};

function buildReq(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request('http://localhost/api/federation/clusters', init);
}

describe('GET /api/federation/clusters', () => {
  it('401 when unauthenticated', async () => {
    currentSessionId = null;
    const res = await GET(buildReq('GET') as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 401);
  });

  it('returns clusters with tokenSecret redacted', async () => {
    await addCluster(validBody);
    const res = await GET(buildReq('GET') as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { clusters: Array<Record<string, unknown>> };
    assert.equal(body.clusters.length, 1);
    const [c] = body.clusters;
    assert.equal(c.id, 'prod-west');
    // Spot-check: the secret value MUST NOT appear anywhere in the
    // serialized response.
    assert.equal(
      JSON.stringify(body).includes(validBody.tokenSecret),
      false,
      'tokenSecret must not appear in response body',
    );
    assert.ok(!('tokenSecret' in c), 'tokenSecret key must be absent');
  });

  it('merges probe state (key present) into each cluster entry', async () => {
    await addCluster(validBody);
    __getProbeStates().set('prod-west', {
      clusterId: 'prod-west',
      reachable: true,
      activeEndpoint: 'https://pve-west-1.example.com:8006',
      latencyMs: 42,
      pveVersion: '8.2.4',
      quorate: true,
      lastProbedAt: Date.now(),
      lastError: null,
    });
    const res = await GET(buildReq('GET') as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { clusters: Array<Record<string, unknown>> };
    assert.equal(body.clusters.length, 1);
    assert.ok('probe' in body.clusters[0], 'probe key must exist');
  });
});

describe('POST /api/federation/clusters', () => {
  it('401 when unauthenticated', async () => {
    currentSessionId = null;
    const res = await POST(buildReq('POST', validBody) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 401);
  });

  it('403 when user lacks Sys.Modify on /', async () => {
    privilegeOk = false;
    const res = await POST(buildReq('POST', validBody) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /forbidden/i);
  });

  it('403 on missing CSRF', async () => {
    csrfOk = false;
    const res = await POST(buildReq('POST', validBody) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /csrf/i);
  });

  it('201 + redacted record on valid input', async () => {
    const res = await POST(buildReq('POST', validBody) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.id, 'prod-west');
    assert.equal(body.authMode, 'token');
    assert.ok(!('tokenSecret' in body), 'tokenSecret key must be absent');
    assert.equal(
      JSON.stringify(body).includes(validBody.tokenSecret),
      false,
      'tokenSecret must not appear in response body',
    );
  });

  it('409 on duplicate id', async () => {
    await addCluster(validBody);
    const res = await POST(buildReq('POST', validBody) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /already registered/i);
  });

  it('400 on validation failure (http:// endpoint)', async () => {
    const bad = { ...validBody, endpoints: ['http://insecure.example.com:8006'] };
    const res = await POST(buildReq('POST', bad) as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /https/i);
  });

  it('400 on malformed JSON body', async () => {
    const res = await POST(buildReq('POST', '{not json') as never, { params: Promise.resolve({}) });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /invalid json/i);
  });
});
