/**
 * Tests for the asymmetric hybrid audit log.
 *
 * Generate an in-test RSA keypair, point exec-audit at it via env vars
 * BEFORE the module is imported (the file paths and pubkey path are
 * read at module load), then write an entry and verify:
 *   1. the safe-tier line is parseable JSON with the expected fields,
 *   2. the secret-tier ciphertext frame decrypts back to the original cmd,
 *   3. noteAuditWriteFailure increments the counter.
 *
 * Reproducing the decrypt logic locally keeps the test self-contained
 * — it doesn't shell out to scripts/nexus-audit-decrypt.ts.
 */
import { strict as assert } from 'node:assert';
import { describe, it, before } from 'node:test';
import {
  generateKeyPairSync,
  privateDecrypt,
  createDecipheriv,
  constants,
} from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'nexus-audit-test-'));
const PRIVATE_PATH = join(TMP, 'private.pem');
const PUBLIC_PATH = join(TMP, 'public.pem');
const SAFE_LOG = join(TMP, 'safe.jsonl');
const SECRET_LOG = join(TMP, 'secret.enc.jsonl');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
writeFileSync(PUBLIC_PATH, publicKey);
writeFileSync(PRIVATE_PATH, privateKey);

process.env.NEXUS_AUDIT_PUBKEY_PATH = PUBLIC_PATH;
process.env.NEXUS_AUDIT_SAFE_LOG = SAFE_LOG;
process.env.NEXUS_AUDIT_SECRET_LOG = SECRET_LOG;

const audit = await import('./exec-audit.ts');

function decryptEnvelope(envelopeB64: string): string {
  const buf = Buffer.from(envelopeB64, 'base64');
  const wrappedKeyLen = buf.readUInt32BE(0);
  let off = 4;
  const wrappedKey = buf.subarray(off, off + wrappedKeyLen);
  off += wrappedKeyLen;
  const iv = buf.subarray(off, off + audit.AES_IV_BYTES);
  off += audit.AES_IV_BYTES;
  const authTag = buf.subarray(off, off + audit.AUTH_TAG_BYTES);
  off += audit.AUTH_TAG_BYTES;
  const ciphertext = buf.subarray(off);

  const aesKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey,
  );
  // Pin the GCM auth-tag length to AUTH_TAG_BYTES so a truncated tag can't
  // pass verification (semgrep CWE-310). The producer in exec-audit.ts uses
  // the same constant.
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv, {
    authTagLength: audit.AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

describe('writeAuditEntry — round-trip', () => {
  before(() => {
    // Reset the counter so noteAuditWriteFailure asserts below are deterministic
    // even if other tests ran first.
    globalThis.__nexusAuditWriteFailures = 0;
  });

  it('appends a parseable safe-tier line and a decryptable secret-tier line', async () => {
    const command = 'echo "hello world" && ls -la';
    const safe = await audit.writeAuditEntry({
      user: 'root@pam',
      node: 'pve',
      endpoint: 'exec',
      command,
      exitCode: 0,
      durationMs: 42,
    });

    // Safe tier — read the most recent line, should equal what was returned.
    const safeLines = readFileSync(SAFE_LOG, 'utf8').trim().split('\n');
    const lastSafe = JSON.parse(safeLines[safeLines.length - 1]);
    assert.equal(lastSafe.id, safe.id);
    assert.equal(lastSafe.user, 'root@pam');
    assert.equal(lastSafe.endpoint, 'exec');
    assert.equal(lastSafe.exitCode, 0);
    assert.equal(lastSafe.cmd_len, Buffer.byteLength(command, 'utf8'));
    // SHA-256 hex of the command — 64 hex chars.
    assert.match(lastSafe.cmd_sha256, /^[0-9a-f]{64}$/);

    // Secret tier — find the entry by id, decrypt, compare.
    const secretLines = readFileSync(SECRET_LOG, 'utf8').trim().split('\n');
    const matched = secretLines
      .map((l) => JSON.parse(l) as { id: string; cmd_ciphertext: string })
      .find((e) => e.id === safe.id);
    assert.ok(matched, 'secret entry must exist for the same id');
    const decrypted = decryptEnvelope(matched.cmd_ciphertext);
    assert.equal(decrypted, command, 'envelope must decrypt to original plaintext');
  });

  it('handles UTF-8 commands without truncation', async () => {
    const command = 'echo "🚀 héllo 你好"';
    const safe = await audit.writeAuditEntry({
      user: 'admin@pve',
      node: 'pve',
      endpoint: 'scripts.run',
      command,
      exitCode: 0,
      durationMs: 1,
    });
    const lines = readFileSync(SECRET_LOG, 'utf8').trim().split('\n');
    const e = lines
      .map((l) => JSON.parse(l) as { id: string; cmd_ciphertext: string })
      .find((x) => x.id === safe.id);
    assert.ok(e);
    assert.equal(decryptEnvelope(e.cmd_ciphertext), command);
  });
});

describe('noteAuditWriteFailure', () => {
  it('increments the counter and accepts both Error and non-Error reasons', () => {
    const before = audit.getAuditWriteFailureCount();
    audit.noteAuditWriteFailure('exec', 'root@pam', new Error('disk full'));
    audit.noteAuditWriteFailure('scripts.run', 'admin@pve', 'string-reason');
    assert.equal(audit.getAuditWriteFailureCount(), before + 2);
  });
});
