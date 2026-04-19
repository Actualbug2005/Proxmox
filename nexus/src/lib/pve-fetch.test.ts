import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent } from 'undici';
import { pveFetchWithToken } from './pve-fetch.ts';
import type { ServiceAccountSession } from './service-account/types.ts';

// pveFetchWithToken uses undici's fetch with a scoped Agent. Tests pass
// their own MockAgent pool via the `dispatcher` option in init, which the
// helper respects (caller-supplied dispatcher wins over the default).

describe('pveFetchWithToken', () => {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();

  after(async () => {
    await mockAgent.close();
  });

  it('sets Authorization: PVEAPIToken and does not set Cookie or CSRFPreventionToken', async () => {
    const session: ServiceAccountSession = {
      tokenId: 'nexus@pve!automation',
      secret: 'abc-123-def',
      proxmoxHost: '127.0.0.1',
    };

    const pool = mockAgent.get('https://127.0.0.1:8006');
    const captured: { headers?: Record<string, string | string[]> } = {};

    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(200, (opts) => {
        captured.headers = opts.headers as Record<string, string | string[]>;
        return { data: {} };
      });

    const res = await pveFetchWithToken(
      session,
      'https://127.0.0.1:8006/api2/json/access/permissions',
      { dispatcher: pool },
    );
    assert.equal(res.status, 200);

    const h = captured.headers ?? {};
    const get = (name: string): string | undefined => {
      const v = h[name.toLowerCase()] ?? h[name];
      return Array.isArray(v) ? v[0] : v;
    };

    assert.equal(get('Authorization'), 'PVEAPIToken=nexus@pve!automation=abc-123-def');
    assert.equal(get('Cookie'), undefined);
    assert.equal(get('CSRFPreventionToken'), undefined);
  });
});
