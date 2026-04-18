/**
 * Tests for the PVE ticket-renewal back-off in refreshPVESessionIfStale.
 *
 * JWT_SECRET must be set BEFORE auth.ts is transitively imported (via the
 * csrf module). NEXUS_DATA_DIR is scoped to a tmp dir so the in-memory
 * session backend doesn't leak across runs.
 */
process.env.JWT_SECRET = 'phase-d-test-secret-value-0123456789';
delete process.env.REDIS_URL;

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  refreshPVESessionIfStale,
  PVE_TICKET_REFRESH_AFTER_MS,
  PVE_RENEWAL_BACKOFF_MS,
  getRenewalFailureCount,
} from './auth.ts';
import { putSession, getStoredSession } from './session-store.ts';
import type { PVEAuthSession } from '@/types/proxmox';
import type { pveFetch } from '@/lib/pve-fetch';
import { parseSessionTicket, parsePveCsrfToken, parseUserid } from '@/types/brands';

type Fetcher = typeof pveFetch;

// PVE's CSRFPreventionToken format (timestamp:base64sig-ish). Two
// distinct fixtures so the "advance" assertion below verifies the
// field changed across a renewal.
const CSRF_OLD = 'pve-csrf-old';
const CSRF_NEW = 'pve-csrf-new';

function fakeOk(body: unknown): Awaited<ReturnType<Fetcher>> {
  return {
    status: 200,
    statusText: 'OK',
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<Fetcher>>;
}
function fakeFail(status: number): Awaited<ReturnType<Fetcher>> {
  return {
    status,
    statusText: 'Unavailable',
    ok: false,
    json: async () => ({}),
    text: async () => '',
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<Fetcher>>;
}

const baseSession = (): PVEAuthSession => ({
  ticket: parseSessionTicket('ticket-old'),
  csrfToken: parsePveCsrfToken(CSRF_OLD),
  username: parseUserid('root@pam'),
  proxmoxHost: 'pve',
  ticketIssuedAt: Date.now() - PVE_TICKET_REFRESH_AFTER_MS - 1,
});

let counter = 0;
beforeEach(() => {
  counter = getRenewalFailureCount();
});

describe('refreshPVESessionIfStale', () => {
  it('returns the session unchanged when not stale', async () => {
    const fresh: PVEAuthSession = { ...baseSession(), ticketIssuedAt: Date.now() };
    const sid = 'sid-fresh';
    await putSession(sid, fresh);
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return fakeOk({});
    };
    const result = await refreshPVESessionIfStale(sid, fresh, fetcher);
    assert.equal(result, fresh, 'should be the very same object');
    assert.equal(calls, 0, 'fetcher must not be called for a fresh ticket');
  });

  it('renews and persists a fresh ticket on success', async () => {
    const session = baseSession();
    const sid = 'sid-renew-ok';
    await putSession(sid, session);
    const fetcher: Fetcher = async () =>
      fakeOk({ data: { ticket: 'ticket-new', CSRFPreventionToken: CSRF_NEW, username: session.username } });

    const result = await refreshPVESessionIfStale(sid, session, fetcher);
    assert.equal(result.ticket, 'ticket-new');
    assert.equal(result.csrfToken, CSRF_NEW);
    assert.equal(result.lastRenewalAttemptAt, undefined, 'must clear on success');
    assert.ok(result.ticketIssuedAt > session.ticketIssuedAt, 'issuedAt must advance');

    const stored = await getStoredSession(sid);
    assert.equal(stored?.ticket, 'ticket-new', 'persisted to store');
  });

  it('stamps lastRenewalAttemptAt and bumps the counter on renewal failure', async () => {
    const session = baseSession();
    const sid = 'sid-renew-fail';
    await putSession(sid, session);
    const fetcher: Fetcher = async () => fakeFail(503);

    const result = await refreshPVESessionIfStale(sid, session, fetcher);
    assert.equal(result.ticket, 'ticket-old', 'returns stale session unchanged');
    assert.ok(result.lastRenewalAttemptAt, 'lastRenewalAttemptAt must be stamped');
    assert.equal(getRenewalFailureCount(), counter + 1, 'counter must increment');
  });

  it('skips the renewal call inside the back-off window after a recent failure', async () => {
    const session: PVEAuthSession = {
      ...baseSession(),
      lastRenewalAttemptAt: Date.now(), // just failed
    };
    const sid = 'sid-backoff';
    await putSession(sid, session);
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return fakeOk({});
    };

    const result = await refreshPVESessionIfStale(sid, session, fetcher);
    assert.equal(calls, 0, 'fetcher must NOT be called within the back-off window');
    assert.equal(result, session);
  });

  it('attempts again once the back-off window elapses', async () => {
    const session: PVEAuthSession = {
      ...baseSession(),
      lastRenewalAttemptAt: Date.now() - PVE_RENEWAL_BACKOFF_MS - 1,
    };
    const sid = 'sid-postbackoff';
    await putSession(sid, session);
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return fakeOk({ data: { ticket: 'ticket-recovered', CSRFPreventionToken: CSRF_NEW, username: session.username } });
    };

    const result = await refreshPVESessionIfStale(sid, session, fetcher);
    assert.equal(calls, 1, 'fetcher must be called once back-off has elapsed');
    assert.equal(result.ticket, 'ticket-recovered');
  });

  it('treats a malformed ticket from PVE as a renewal failure', async () => {
    // If PVE (or a MITM) ever returns an empty/oversized ticket string,
    // parseSessionTicket throws inside the renewal path. The function
    // must catch it like any other renewal error rather than letting a
    // garbage value land in the session store.
    const session = baseSession();
    const sid = 'sid-garbage-ticket';
    await putSession(sid, session);
    const fetcher: Fetcher = async () =>
      fakeOk({ data: { ticket: '', CSRFPreventionToken: CSRF_NEW, username: session.username } });

    const before = getRenewalFailureCount();
    const result = await refreshPVESessionIfStale(sid, session, fetcher);
    assert.equal(result.ticket, session.ticket, 'returns the stale session unchanged');
    assert.ok(result.lastRenewalAttemptAt, 'stamps back-off');
    assert.equal(getRenewalFailureCount(), before + 1, 'increments failure counter');
  });
});
