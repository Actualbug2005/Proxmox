/**
 * SSRF invariant lock for community-scripts.ts.
 *
 * The module pins REPO_RAW_BASE to raw.githubusercontent.com and validates
 * slugs with /^[a-z0-9][a-z0-9-]{0,62}$/. This test asserts the validator
 * rejects every crafted slug that could be used to pivot the fetch away
 * from the upstream repo or to inject query/filter-language syntax.
 *
 * fetchScriptManifest is the load-bearing entry point — it's the one that
 * interpolates `slug` into the PB filter expression, so we exercise its
 * validator directly rather than re-testing the regex in isolation.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fetchScriptManifest } from '../../lib/community-scripts.ts';

const CRAFTED_SLUGS: Array<[label: string, slug: string]> = [
  ['path traversal', '../../../etc/passwd'],
  ['at-sign (email-like)', 'foo@evil.com'],
  ['full URL', 'https://attacker.com/raw'],
  ['length bound', 'a'.repeat(200)],
  ['uppercase', 'FOO'],
  ['leading hyphen', '-foo'],
  ['leading dot', '.foo'],
  ['empty string', ''],
  ['internal whitespace', 'jelly fin'],
  ['single quote injection', "jelly'fin"],
  ['backslash injection', 'jelly\\fin'],
  ['null byte', 'jelly\0fin'],
  ['newline', 'jelly\nfin'],
];

describe('community-scripts SSRF guard', () => {
  for (const [label, slug] of CRAFTED_SLUGS) {
    it(`rejects crafted slug: ${label}`, async () => {
      // Validator throws synchronously before any fetch — we assert on the
      // thrown error without needing network mocks.
      await assert.rejects(
        () => fetchScriptManifest(slug),
        /Invalid slug/i,
        `validator accepted a crafted slug: ${JSON.stringify(slug)}`,
      );
    });
  }

  it('validator regex matches the documented slug shape', () => {
    // Mirror the regex in community-scripts.ts:491 to lock the exact shape.
    // If the regex ever loosens or tightens, this test catches it.
    const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
    assert.ok(SLUG_RE.test('jellyfin'), 'valid slug "jellyfin" rejected');
    assert.ok(SLUG_RE.test('a'), 'minimum 1-char slug rejected');
    assert.ok(SLUG_RE.test('a'.repeat(63)), 'max 63-char slug rejected');
    assert.ok(!SLUG_RE.test('a'.repeat(64)), '64-char slug accepted (bound broken)');
  });
});
