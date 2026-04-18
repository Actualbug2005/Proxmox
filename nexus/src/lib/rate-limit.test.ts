/**
 * Tests for the in-memory token-bucket + concurrency semaphore.
 *
 * REDIS_URL must be unset BEFORE the module is imported so the singleton
 * picks the memory backend. The module caches the backend on globalThis,
 * so a stray prior test could pin it to Redis — explicitly clear.
 */
delete process.env.REDIS_URL;
// Clear any stale backend that a prior test in the same process may have
// installed (e.g. if the session-store's Redis failover test ran first).
delete (globalThis as { __nexusRateLimitBackend?: unknown }).__nexusRateLimitBackend;
delete (globalThis as { __nexusRateLimitTokens?: unknown }).__nexusRateLimitTokens;
delete (globalThis as { __nexusRateLimitSlots?: unknown }).__nexusRateLimitSlots;

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { takeToken, acquireSlot } from './rate-limit.ts';

// Unique endpoint labels per test so stray state from one case can't leak
// into another when running in the same process.
let tick = 0;
const uniq = () => `test-ep-${++tick}`;

beforeEach(() => {
  // Best-effort: the backend module-scopes its Maps. Tests use unique keys
  // so leakage isn't a correctness issue, but clearing makes debugging
  // easier if a future refactor changes key shapes.
  (globalThis as { __nexusRateLimitTokens?: Map<unknown, unknown> }).__nexusRateLimitTokens?.clear();
  (globalThis as { __nexusRateLimitSlots?: Map<unknown, unknown> }).__nexusRateLimitSlots?.clear();
});

describe('takeToken', () => {
  it('grants tokens up to the limit, then refuses with retryAfterMs', async () => {
    const ep = uniq();
    const r1 = await takeToken('u1', ep, 3, 60_000);
    const r2 = await takeToken('u1', ep, 3, 60_000);
    const r3 = await takeToken('u1', ep, 3, 60_000);
    const r4 = await takeToken('u1', ep, 3, 60_000);

    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 2);
    assert.equal(r2.allowed, true);
    assert.equal(r3.allowed, true);
    assert.equal(r3.remaining, 0);
    assert.equal(r4.allowed, false, 'fourth take over limit=3 must refuse');
    assert.ok(r4.retryAfterMs !== undefined && r4.retryAfterMs > 0, 'retryAfterMs must hint >0');
  });

  it('scopes counters per (endpoint, user) pair', async () => {
    const ep = uniq();
    const a1 = await takeToken('userA', ep, 1, 60_000);
    const b1 = await takeToken('userB', ep, 1, 60_000);
    assert.equal(a1.allowed, true);
    assert.equal(b1.allowed, true, 'different users must not share budget');
    const a2 = await takeToken('userA', ep, 1, 60_000);
    assert.equal(a2.allowed, false, 'userA over budget');
  });

  it('grants a fresh budget once the window expires', async () => {
    const ep = uniq();
    const first = await takeToken('u1', ep, 1, 10); // 10ms window
    assert.equal(first.allowed, true);
    const immediately = await takeToken('u1', ep, 1, 10);
    assert.equal(immediately.allowed, false);

    await new Promise((r) => setTimeout(r, 20));
    const afterWindow = await takeToken('u1', ep, 1, 10);
    assert.equal(afterWindow.allowed, true, 'window rolled; new budget should be available');
  });
});

describe('acquireSlot', () => {
  it('grants slots up to max, then returns null', async () => {
    const ep = uniq();
    const s1 = await acquireSlot('u1', ep, 2, 60_000);
    const s2 = await acquireSlot('u1', ep, 2, 60_000);
    const s3 = await acquireSlot('u1', ep, 2, 60_000);
    assert.ok(s1);
    assert.ok(s2);
    assert.equal(s3, null, 'third acquire beyond max=2 must refuse');
    // Clean up so later tests reusing the backend don't inherit slot leaks.
    await s1.release();
    await s2.release();
  });

  it('releases slots so later acquires succeed', async () => {
    const ep = uniq();
    const s1 = await acquireSlot('u1', ep, 1, 60_000);
    assert.ok(s1);
    await s1.release();
    const s2 = await acquireSlot('u1', ep, 1, 60_000);
    assert.ok(s2, 'slot must be available again after release');
    await s2.release();
  });

  it('release is idempotent — calling release() twice does not underflow', async () => {
    const ep = uniq();
    const s = await acquireSlot('u1', ep, 1, 60_000);
    assert.ok(s);
    await s.release();
    await assert.doesNotReject(() => s.release());
    // Counter should still function for new acquires after a double-release.
    const s2 = await acquireSlot('u1', ep, 1, 60_000);
    assert.ok(s2);
    await s2.release();
  });
});
