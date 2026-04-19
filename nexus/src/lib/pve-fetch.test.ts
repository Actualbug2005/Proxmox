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
