/**
 * Tests for the branded-primitive parsers in src/types/brands.ts.
 *
 * Each parser is a trust boundary — it's the only sanctioned way to
 * construct a branded value from raw input. Tests pin the accept/reject
 * matrix so a future regex tweak can't silently widen what counts as
 * "trusted".
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseVmId,
  parseNodeName,
  parseUserid,
  parseSessionTicket,
  parseCsrfToken,
  parsePveCsrfToken,
  parseBatchId,
  parseSlug,
  parseSafeRelPath,
  unbrand,
} from './brands.ts';

describe('parseVmId', () => {
  it('accepts valid integers in range', () => {
    for (const n of [1, 100, 999, 999_999_999]) {
      assert.equal(unbrand(parseVmId(n)), n);
    }
  });
  it('rejects non-integers, zero, negatives, and overflow', () => {
    for (const bad of [0, -1, 1_000_000_000, 1.5, NaN, '100', null, undefined]) {
      assert.throws(() => parseVmId(bad), /Invalid VmId/);
    }
  });
});

describe('parseNodeName', () => {
  it('accepts canonical node names', () => {
    for (const s of ['pve', 'pve-1', 'pve.example.com', 'NODE_9']) {
      assert.equal(unbrand(parseNodeName(s)), s);
    }
  });
  it('rejects ssh-flag-injection patterns', () => {
    for (const bad of ['', '-pve', '-oProxyCommand=ssh', 'pve;rm', 'pve nodename', 'pve:80', null]) {
      assert.throws(() => parseNodeName(bad), /Invalid NodeName/);
    }
  });
});

describe('parseUserid', () => {
  it('accepts user@realm form', () => {
    for (const s of ['root@pam', 'admin@pve', 'devops.user@ad', 'a_b@pam']) {
      assert.equal(unbrand(parseUserid(s)), s);
    }
  });
  it('rejects malformed userids', () => {
    for (const bad of ['root', '@pam', 'root@', 'root@PAM', 'root@1pam', '', null]) {
      assert.throws(() => parseUserid(bad), /Invalid Userid/);
    }
  });
});

describe('parseSessionTicket', () => {
  it('accepts opaque non-empty strings up to 4096 chars', () => {
    assert.equal(unbrand(parseSessionTicket('PVE:root@pam:abc123')), 'PVE:root@pam:abc123');
    assert.equal(unbrand(parseSessionTicket('x'.repeat(4096))).length, 4096);
  });
  it('rejects empty + oversized + non-string', () => {
    for (const bad of ['', 'x'.repeat(4097), 0, null, undefined]) {
      assert.throws(() => parseSessionTicket(bad), /Invalid SessionTicket/);
    }
  });
});

describe('parseCsrfToken', () => {
  it('accepts 64-char lowercase hex', () => {
    const token = 'a'.repeat(64);
    assert.equal(unbrand(parseCsrfToken(token)), token);
  });
  it('rejects wrong length, uppercase, non-hex', () => {
    for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), '', null]) {
      assert.throws(() => parseCsrfToken(bad), /Invalid CsrfToken/);
    }
  });
});

describe('parsePveCsrfToken', () => {
  // PVE's CSRFPreventionToken format is version-dependent (PVE 7 used
  // `<hex>:<base64>`, PVE 8+ varies). The parser is intentionally lenient:
  // only reject the things that can't possibly be valid (empty / oversized).
  it('accepts realistic PVE-shaped tokens and arbitrary non-empty strings', () => {
    for (const ok of ['68F1A35B:H0m8P2l4YJbXYN7q', 'pve-csrf-new', 'a', 'A'.repeat(300)]) {
      assert.equal(unbrand(parsePveCsrfToken(ok)), ok);
    }
  });
  it('rejects empty / oversized / non-string input', () => {
    for (const bad of ['', 'a'.repeat(513), 0, null, undefined, {}]) {
      assert.throws(() => parsePveCsrfToken(bad), /Invalid PveCsrfToken/);
    }
  });
});

describe('parseBatchId', () => {
  it('accepts canonical UUIDs (any case)', () => {
    const u = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(unbrand(parseBatchId(u)), u);
    assert.equal(unbrand(parseBatchId(u.toUpperCase())), u.toUpperCase());
  });
  it('rejects non-UUIDs', () => {
    for (const bad of ['', 'not-a-uuid', '550e8400-e29b-41d4-a716', 123, null]) {
      assert.throws(() => parseBatchId(bad), /Invalid BatchId/);
    }
  });
});

describe('parseSlug', () => {
  it('accepts kebab-case lowercase slugs 1..63 chars', () => {
    for (const s of ['x', 'docker-ce', 'a' + '0'.repeat(62)]) {
      assert.equal(unbrand(parseSlug(s)), s);
    }
  });
  it('rejects uppercase, special chars, leading dash, oversized', () => {
    for (const bad of ['', '-foo', 'Docker', 'foo_bar', 'foo bar', 'a' + '0'.repeat(63), null]) {
      assert.throws(() => parseSlug(bad), /Invalid Slug/);
    }
  });
});

describe('parseSafeRelPath', () => {
  it('strips leading slashes and accepts deep paths', () => {
    assert.equal(unbrand(parseSafeRelPath('/foo/bar')), 'foo/bar');
    assert.equal(unbrand(parseSafeRelPath('foo/bar/baz')), 'foo/bar/baz');
  });
  it('rejects path-traversal segments', () => {
    for (const bad of ['..', '../etc/passwd', 'foo/../bar', 'a//b']) {
      assert.throws(() => parseSafeRelPath(bad), /Unsafe path/);
    }
  });
  it('rejects non-strings', () => {
    assert.throws(() => parseSafeRelPath(42), /Invalid SafeRelPath/);
  });
});
