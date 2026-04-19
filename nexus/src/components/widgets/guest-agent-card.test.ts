import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { relativeAge } from './guest-agent-card';

/**
 * Pure helper tests — component rendering isn't part of this repo's test
 * convention (see sidebar.test.ts). Anything visual gets checked by hand.
 */
describe('relativeAge', () => {
  // Fix "now" so the tests are deterministic. 2026-04-19T12:00:00Z.
  const NOW = Date.UTC(2026, 3, 19, 12, 0, 0);

  it('returns empty string when `since` is 0 (probe did not populate it)', () => {
    assert.equal(relativeAge(0, NOW), '');
  });

  it('returns empty string when `since` is falsy', () => {
    // The helper treats any falsy value as "unknown" — guard against NaN
    // leaking into the UI from a malformed probe response.
    assert.equal(relativeAge(Number.NaN, NOW), '');
  });

  it('returns "just now" for deltas under 60s', () => {
    assert.equal(relativeAge(NOW - 30_000, NOW), 'just now');
    assert.equal(relativeAge(NOW - 59_000, NOW), 'just now');
  });

  it('clock-skew: future `since` still renders as "just now"', () => {
    // If the guest clock is ahead of the host, `since` can be in the
    // future. Don't render "-5m ago" — that's gibberish to an operator.
    assert.equal(relativeAge(NOW + 10_000, NOW), 'just now');
  });

  it('returns minutes for deltas under an hour', () => {
    assert.equal(relativeAge(NOW - 5 * 60_000, NOW), '5m ago');
    assert.equal(relativeAge(NOW - 45 * 60_000, NOW), '45m ago');
  });

  it('returns hours for deltas under a day', () => {
    assert.equal(relativeAge(NOW - 2 * 60 * 60_000, NOW), '2h ago');
    assert.equal(relativeAge(NOW - 23 * 60 * 60_000, NOW), '23h ago');
  });

  it('returns days for deltas past 24h', () => {
    assert.equal(relativeAge(NOW - 2 * 24 * 60 * 60_000, NOW), '2d ago');
  });
});
