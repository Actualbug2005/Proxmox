/**
 * probe.test.ts — per-cluster health check (pure function).
 *
 * probeCluster is seam-friendly: it takes a fetch-like function
 * so tests can mock pveFetch without module mocks.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { probeCluster } from './probe.ts';
import type { RegisteredCluster } from './types.ts';

const cluster: RegisteredCluster = {
  id: 'lab',
  name: 'Lab',
  endpoints: ['https://pve-1.lab:8006', 'https://pve-2.lab:8006'],
  authMode: 'token',
  tokenId: 'nexus@pve!probe',
  tokenSecret: 'aaaaaaaaaaaaaaaa',
  savedAt: 0,
  rotatedAt: 0,
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('probeCluster', () => {
  it('succeeds on first endpoint and records active', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4', release: '8.2' } });
      }
      return okResponse({
        data: [
          { type: 'node', name: 'n1', online: 1 },
          { type: 'node', name: 'n2', online: 1 },
        ],
      });
    };
    const result = await probeCluster(cluster, { fetchFn, now: () => 1000 });
    assert.equal(result.reachable, true);
    assert.equal(result.activeEndpoint, 'https://pve-1.lab:8006');
    assert.equal(result.pveVersion, '8.2.4');
    assert.equal(result.quorate, true);
    assert.equal(result.lastError, null);
    // Two calls: /version then /cluster/status.
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('/version'));
    assert.ok(calls[1].includes('/cluster/status'));
  });

  it('tries the next endpoint when the first fails', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('https://pve-1.lab')) {
        throw new Error('connect ECONNREFUSED');
      }
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4' } });
      }
      return okResponse({ data: [{ type: 'node', online: 1 }] });
    };
    const result = await probeCluster(cluster, { fetchFn, now: () => 2000 });
    assert.equal(result.reachable, true);
    assert.equal(result.activeEndpoint, 'https://pve-2.lab:8006');
  });

  it('records reachable=false when all endpoints fail', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error('connect ETIMEDOUT');
    };
    const result = await probeCluster(cluster, { fetchFn, now: () => 3000 });
    assert.equal(result.reachable, false);
    assert.equal(result.activeEndpoint, null);
    assert.match(result.lastError ?? '', /ETIMEDOUT/);
  });

  it('computes quorate=false when fewer than half of nodes are online', async () => {
    const fetchFn: typeof fetch = async (url) => {
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4' } });
      }
      return okResponse({
        data: [
          { type: 'node', online: 0 },
          { type: 'node', online: 0 },
          { type: 'node', online: 1 },
        ],
      });
    };
    const result = await probeCluster(cluster, { fetchFn, now: () => 0 });
    assert.equal(result.quorate, false);
  });

  it('sets quorate=null when status fetch fails but version succeeded', async () => {
    const fetchFn: typeof fetch = async (url) => {
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4' } });
      }
      return new Response('server error', { status: 500 });
    };
    const result = await probeCluster(cluster, { fetchFn, now: () => 0 });
    assert.equal(result.reachable, true);
    assert.equal(result.quorate, null);
  });

  it('sends Authorization PVEAPIToken header, no cookie', async () => {
    let seenHeaders: Headers | null = null;
    const fetchFn: typeof fetch = async (url, init) => {
      seenHeaders = new Headers(init?.headers);
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4' } });
      }
      return okResponse({ data: [] });
    };
    await probeCluster(cluster, { fetchFn, now: () => 0 });
    assert.ok(seenHeaders);
    assert.match(
      seenHeaders!.get('authorization') ?? '',
      /^PVEAPIToken=nexus@pve!probe=aaaaaaaaaaaaaaaa$/,
    );
    assert.equal(seenHeaders!.get('cookie'), null);
  });

  it('tries previous activeEndpoint first when supplied (sticky failover)', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/version')) {
        return okResponse({ data: { version: '8.2.4' } });
      }
      return okResponse({ data: [] });
    };
    await probeCluster(cluster, {
      fetchFn,
      now: () => 0,
      lastActiveEndpoint: 'https://pve-2.lab:8006',
    });
    assert.ok(calls[0].startsWith('https://pve-2.lab'));
  });
});
