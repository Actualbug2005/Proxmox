import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { __setPveDispatcherForTests } from '../pve-fetch.ts';
import { probeServiceAccount } from './probe.ts';
import type { ServiceAccountSession } from './types.ts';

// pveFetchWithToken is now built on undici's fetch with a scoped Agent, so
// stubbing `globalThis.fetch` no longer intercepts the request. Route the
// probe through undici's MockAgent via the test-only dispatcher hook
// (`__setPveDispatcherForTests`) instead.

const session: ServiceAccountSession = {
  tokenId: 'nexus@pve!automation',
  secret: 'abc',
  proxmoxHost: '127.0.0.1',
};

let originalDispatcher: Dispatcher;
let mockAgent: MockAgent;

before(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  __setPveDispatcherForTests(mockAgent);
});

after(async () => {
  __setPveDispatcherForTests(null);
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
});

describe('probeServiceAccount', () => {
  it('returns ok with userid on 200 with data map', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(
        200,
        { data: { '/': { 'Sys.Audit': 1 } } },
        { headers: { 'content-type': 'application/json' } },
      );
    const result = await probeServiceAccount(session);
    assert.deepEqual(result, { ok: true, userid: 'nexus@pve!automation' });
  });

  it('returns error on 401', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(401, 'authentication failure', {
        headers: { 'content-type': 'text/plain' },
      });
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /401|authentication/i);
  });

  it('returns error on 403', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(403, 'permission denied', {
        headers: { 'content-type': 'text/plain' },
      });
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /403|permission/i);
  });

  it('returns error when fetch throws', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .replyWithError(new Error('ECONNREFUSED'));
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; error: string }).error,
      /ECONNREFUSED|Could not reach|refus/i,
    );
  });

  it('returns error on 200 with malformed body', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(200, 'not json at all', {
        headers: { 'content-type': 'text/plain' },
      });
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
  });

  it('returns error on 200 with empty data map', async () => {
    const pool = mockAgent.get('https://127.0.0.1:8006');
    pool
      .intercept({ path: '/api2/json/access/permissions', method: 'GET' })
      .reply(
        200,
        {},
        { headers: { 'content-type': 'application/json' } },
      );
    const result = await probeServiceAccount(session);
    assert.equal(result.ok, false);
  });
});
