/**
 * Tests for /api/federation/clusters/[id] (DELETE + PATCH).
 *
 * Same harness template as ../route.test.ts. See that file for the
 * rationale on mutable gate state + per-case tmpdir.
 */
process.env.JWT_SECRET = 'federation-id-routes-test-secret-0123456789';

import { strict as assert } from 'node:assert';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    getJwtSecret: () =>
      Buffer.from('federation-id-routes-test-secret-0123456789'),
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

const { DELETE, PATCH } = await import('./route.ts');
const { addCluster, listClusters } = await import('@/lib/federation/store.ts');
const { __resetForTests } = await import('@/lib/federation/session.ts');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-id-routes-'));
  process.env.NEXUS_DATA_DIR = tmp;
  __resetForTests();
  currentSessionId = 'test-session-id';
  csrfOk = true;
  privilegeOk = true;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NEXUS_DATA_DIR;
});

const seed = {
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
  return new Request(`http://localhost/api/federation/clusters/${seed.id}`, init);
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/federation/clusters/[id]', () => {
  it('401 unauthenticated', async () => {
    currentSessionId = null;
    const res = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(res.status, 401);
  });

  it('403 without Sys.Modify', async () => {
    privilegeOk = false;
    const res = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(res.status, 403);
  });

  it('403 missing CSRF', async () => {
    csrfOk = false;
    const res = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /csrf/i);
  });

  it('204 on successful delete', async () => {
    await addCluster(seed);
    const res = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(res.status, 204);
    const remaining = await listClusters();
    assert.equal(remaining.length, 0);
  });

  it('404 on unknown id', async () => {
    const res = await DELETE(buildReq('DELETE') as never, ctx('does-not-exist') as never);
    assert.equal(res.status, 404);
  });

  it('idempotency: second DELETE on same id returns 404', async () => {
    await addCluster(seed);
    const first = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(first.status, 204);
    const second = await DELETE(buildReq('DELETE') as never, ctx(seed.id) as never);
    assert.equal(second.status, 404);
  });
});

describe('PATCH /api/federation/clusters/[id]', () => {
  const rotateBody = {
    tokenId: 'nexus@pve!federate2',
    tokenSecret: 'fresh-rotated-secret-xyz999',
  };

  it('401 unauthenticated', async () => {
    currentSessionId = null;
    const res = await PATCH(buildReq('PATCH', rotateBody) as never, ctx(seed.id) as never);
    assert.equal(res.status, 401);
  });

  it('403 without Sys.Modify', async () => {
    privilegeOk = false;
    const res = await PATCH(buildReq('PATCH', rotateBody) as never, ctx(seed.id) as never);
    assert.equal(res.status, 403);
  });

  it('403 missing CSRF', async () => {
    csrfOk = false;
    const res = await PATCH(buildReq('PATCH', rotateBody) as never, ctx(seed.id) as never);
    assert.equal(res.status, 403);
  });

  it('200 + redacted record on valid rotate', async () => {
    await addCluster(seed);
    const res = await PATCH(buildReq('PATCH', rotateBody) as never, ctx(seed.id) as never);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.id, seed.id);
    assert.equal(body.tokenId, rotateBody.tokenId);
    assert.ok(!('tokenSecret' in body), 'tokenSecret must not appear in response');
    assert.equal(
      JSON.stringify(body).includes(rotateBody.tokenSecret),
      false,
      'rotated tokenSecret must not appear in response body',
    );
  });

  it('400 on malformed tokenId', async () => {
    await addCluster(seed);
    const res = await PATCH(
      buildReq('PATCH', { tokenId: 'not-a-token-id', tokenSecret: 'abcdefgh12' }) as never,
      ctx(seed.id) as never,
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /tokenId/i);
  });

  it('404 on unknown id', async () => {
    const res = await PATCH(
      buildReq('PATCH', rotateBody) as never,
      ctx('does-not-exist') as never,
    );
    assert.equal(res.status, 404);
  });

  it('rotatedAt advances past the prior savedAt', async () => {
    const created = await addCluster(seed);
    // Ensure enough wall-clock separation for Date.now() to tick.
    await new Promise((r) => setTimeout(r, 5));
    const res = await PATCH(buildReq('PATCH', rotateBody) as never, ctx(seed.id) as never);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { rotatedAt: number };
    assert.ok(
      body.rotatedAt > created.savedAt,
      `rotatedAt (${body.rotatedAt}) should exceed pre-rotate savedAt (${created.savedAt})`,
    );
  });
});
