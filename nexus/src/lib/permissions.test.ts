/**
 * Tests for the PVE privilege-probe helper.
 *
 * permissions.ts MUST fail closed across the entire failure spectrum (HTTP
 * 5xx, transport, parse) so a broken upstream can't silently grant access.
 * It must also distinguish those probe-error kinds from a legitimate
 * 401/403/404 denial so ops can alert specifically on broken-upstream cases.
 */
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  userHasPrivilege,
  getPermissionProbeErrorCount,
} from './permissions.ts';
import type { PVEAuthSession } from '@/types/proxmox';
import type { pveFetch } from '@/lib/pve-fetch';
import { parseSessionTicket, parsePveCsrfToken, parseUserid } from '@/types/brands';

const session: PVEAuthSession = {
  ticket: parseSessionTicket('fake-ticket'),
  csrfToken: parsePveCsrfToken('fake-csrf'),
  username: parseUserid('root@pam'),
  proxmoxHost: 'localhost',
  ticketIssuedAt: Date.now(),
};

// Cast through `unknown` because pveFetch's return type pulls in undici's
// Response, which is structurally identical to DOM Response but not
// type-compatible. The function under test only touches .status, .ok, .json().
type Fetcher = typeof pveFetch;
function fakeResponse(status: number, body: unknown): Awaited<ReturnType<Fetcher>> {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as unknown as Awaited<ReturnType<Fetcher>>;
}

beforeEach(() => {
  globalThis.__nexusPermissionProbeErrors = 0;
});

describe('userHasPrivilege — permission grant', () => {
  it('returns true when PVE returns the privilege bit set', async () => {
    const fetcher = async () =>
      fakeResponse(200, { data: { '/nodes/pve': { 'Sys.Modify': 1 } } });
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, true);
    assert.equal(getPermissionProbeErrorCount(), 0, 'success path must not log');
  });

  it('returns false when the privilege bit is 0', async () => {
    const fetcher = async () =>
      fakeResponse(200, { data: { '/nodes/pve': { 'Sys.Modify': 0 } } });
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 0);
  });

  it('returns false when the bit is missing from the path entry', async () => {
    const fetcher = async () =>
      fakeResponse(200, { data: { '/nodes/pve': { 'Sys.Audit': 1 } } });
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 0);
  });

  it('returns false when the path entry is missing entirely', async () => {
    const fetcher = async () => fakeResponse(200, { data: {} });
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 0);
  });
});

describe('userHasPrivilege — fail-closed error paths', () => {
  it('returns false on HTTP 401 WITHOUT logging a probe error (legitimate denial)', async () => {
    const fetcher = async () => fakeResponse(401, {});
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 0, '4xx is not a probe error');
  });

  it('returns false on HTTP 403 WITHOUT logging a probe error (legitimate denial)', async () => {
    const fetcher = async () => fakeResponse(403, {});
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 0);
  });

  it('returns false AND increments counter on HTTP 5xx (kind=http_5xx)', async () => {
    const fetcher = async () => fakeResponse(503, {});
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 1);
  });

  it('returns false AND increments counter on transport reject (kind=transport)', async () => {
    const fetcher = async () => {
      throw new Error('ECONNREFUSED');
    };
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 1);
  });

  it('returns false AND increments counter on JSON parse failure (kind=parse)', async () => {
    const malformed = {
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      headers: new Headers(),
      text: async () => 'not json',
    } as unknown as Awaited<ReturnType<Fetcher>>;
    const fetcher: Fetcher = async () => malformed;
    const ok = await userHasPrivilege(session, '/nodes/pve', 'Sys.Modify', fetcher);
    assert.equal(ok, false);
    assert.equal(getPermissionProbeErrorCount(), 1);
  });
});
