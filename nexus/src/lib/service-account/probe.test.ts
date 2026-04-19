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

  it('returns error on 403', async () => {
    globalThis.fetch = (async () =>
      new Response('permission denied', { status: 403 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /403|permission/i);
  });

  it('returns error when fetch throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /ECONNREFUSED|Could not reach|refus/i);
  });

  it('returns error on 200 with malformed body', async () => {
    globalThis.fetch = (async () =>
      new Response('not json at all', { status: 200 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
  });

  it('returns error on 200 with empty data map', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
  });
});
