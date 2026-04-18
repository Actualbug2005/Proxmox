/**
 * Tests for the double-submit CSRF module.
 *
 * JWT_SECRET must be set BEFORE csrf.ts is imported because the module caches
 * the derived Uint8Array on first call — the top-level import below drives
 * the first derivation during module load in some runner orderings, so the
 * env var is set at the very top of this file via import side-effect.
 */
process.env.JWT_SECRET = 'phase-b-test-secret-value-0123456789';

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { csrfMatches, deriveCsrfToken, validateCsrf, CSRF_HEADER } from './csrf.ts';

describe('deriveCsrfToken', () => {
  it('is deterministic for the same session id', () => {
    const a = deriveCsrfToken('session-abc');
    const b = deriveCsrfToken('session-abc');
    assert.equal(a, b);
  });

  it('produces different tokens for different session ids', () => {
    const a = deriveCsrfToken('session-abc');
    const b = deriveCsrfToken('session-xyz');
    assert.notEqual(a, b);
  });

  it('returns a 64-char hex string (SHA-256 digest)', () => {
    const token = deriveCsrfToken('any-session');
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it('treats every session id as distinct (no silent collision on empty)', () => {
    const empty = deriveCsrfToken('');
    const nonEmpty = deriveCsrfToken('x');
    assert.notEqual(empty, nonEmpty);
  });
});

describe('csrfMatches', () => {
  const expected = deriveCsrfToken('session-abc');

  it('returns true when provided matches expected', () => {
    assert.equal(csrfMatches(expected, expected), true);
  });

  it('returns false when provided is null', () => {
    assert.equal(csrfMatches(expected, null), false);
  });

  it('returns false when provided is undefined', () => {
    assert.equal(csrfMatches(expected, undefined), false);
  });

  it('returns false when provided is empty', () => {
    assert.equal(csrfMatches(expected, ''), false);
  });

  it('returns false when provided has different length WITHOUT throwing', () => {
    // This is the load-bearing guard: timingSafeEqual throws on mismatched
    // lengths in Node, and a buggy refactor that removes the early length
    // check would surface 500s on the proxy. Test locks the behaviour in.
    const shorter = 'abc';
    const longer = expected + 'extra';
    assert.doesNotThrow(() => csrfMatches(expected, shorter));
    assert.doesNotThrow(() => csrfMatches(expected, longer));
    assert.equal(csrfMatches(expected, shorter), false);
    assert.equal(csrfMatches(expected, longer), false);
  });

  it('returns false when provided is same length but different bytes', () => {
    const wrong = 'a'.repeat(expected.length);
    assert.equal(csrfMatches(expected, wrong), false);
  });
});

describe('validateCsrf', () => {
  // Minimal NextRequest stub — validateCsrf only touches .headers.get().
  interface StubReq {
    headers: { get(name: string): string | null };
  }
  const reqWith = (header: string | null): StubReq => ({
    headers: {
      get: (name: string) => (name.toLowerCase() === CSRF_HEADER ? header : null),
    },
  });

  const sessionId = 'session-validate';
  const good = deriveCsrfToken(sessionId);

  it('returns true when header matches derived token', () => {
    // Cast is safe — validateCsrf's Request contract is limited to .headers.get().
    assert.equal(validateCsrf(reqWith(good) as unknown as never, sessionId), true);
  });

  it('returns false when header is absent', () => {
    assert.equal(validateCsrf(reqWith(null) as unknown as never, sessionId), false);
  });

  it('returns false when header is present but wrong', () => {
    assert.equal(validateCsrf(reqWith('wrong-token') as unknown as never, sessionId), false);
  });

  it('returns false when header was derived from a different session id', () => {
    const crossToken = deriveCsrfToken('other-session');
    assert.equal(validateCsrf(reqWith(crossToken) as unknown as never, sessionId), false);
  });
});
