/**
 * Round-trip + tamper-rejection tests for the destination-credential
 * encryption. JWT_SECRET must be set before import because the
 * encrypt/decrypt module loads it eagerly through `env.ts`.
 */
process.env.JWT_SECRET = 'notifications-crypto-test-0123456789abcdef';

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

const crypto = await import('./crypto.ts');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a webhook-credentials object unchanged', () => {
    const input = {
      url: 'https://example.com/webhook',
      hmacSecret: 'super-secret-32-char-minimum-str',
    };
    const blob = crypto.encryptSecret(input);
    const back = crypto.decryptSecret(blob);
    assert.deepEqual(back, input);
  });

  it('produces a different blob every call (salt + IV are random)', () => {
    const a = crypto.encryptSecret({ foo: 'bar' });
    const b = crypto.encryptSecret({ foo: 'bar' });
    assert.notEqual(a, b, 'two encrypts of the same plaintext must differ');
  });

  it('rejects a tampered ciphertext (GCM auth tag catches the flip)', () => {
    const blob = crypto.encryptSecret({ foo: 'bar' });
    // Flip one bit deep in the ciphertext region to skip the framing
    // header and hit the encrypted body.
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] ^= 0x01;
    const tampered = buf.toString('base64');
    assert.throws(() => crypto.decryptSecret(tampered));
  });

  it('rejects a truncated blob rather than throwing mid-decrypt', () => {
    assert.throws(() => crypto.decryptSecret(Buffer.from([1, 2, 3]).toString('base64')));
  });

  it('uses the documented framing sizes (stable on-disk shape)', () => {
    // A changed framing layout is a persistence-breaking migration —
    // pin the constants so a refactor notices it has to write one.
    assert.equal(crypto.__FRAMING.SALT_BYTES, 16);
    assert.equal(crypto.__FRAMING.IV_BYTES, 12);
    assert.equal(crypto.__FRAMING.AUTH_TAG_BYTES, 16);
    assert.equal(crypto.__FRAMING.KEY_BYTES, 32);
    assert.equal(crypto.__FRAMING.INFO, 'nexus:notifications:v1');
  });
});
