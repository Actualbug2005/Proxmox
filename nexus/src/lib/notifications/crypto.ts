/**
 * Symmetric at-rest encryption for destination credentials.
 *
 * Design decision (2026-04-18):
 *   Destination creds need to be decrypted at dispatch time to POST to
 *   webhooks, so the asymmetric envelope used by `exec-audit.ts` (RSA-
 *   OAEP + AES-GCM with the private key kept off-box) doesn't fit.
 *   Symmetric is correct; deriving the key from JWT_SECRET matches
 *   the existing trust model (rotating JWT_SECRET already invalidates
 *   session tokens and CSRF — adding "and notification credentials"
 *   is a single consistent rotation story).
 *
 * Framing (base64-encoded):
 *   [salt (16B)] [iv (12B)] [authTag (16B)] [ciphertext]
 *
 * Per-record salt means two destinations with the same secret don't
 * share a key, so leaking one ciphertext doesn't simplify the attack
 * on another. IV is per-encrypt (never reused under a given key).
 */

import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
// Relative + explicit `.ts`: this module is reached from server.ts via
// dispatcher.ts → store.ts, under Node's --experimental-strip-types
// loader which has no path-alias resolver. `@/lib/env` works in the
// webpack-built routes but blows up at systemd boot.
import { getJwtSecret } from '../env.ts';

const SALT_BYTES = 16;
const IV_BYTES = 12; // GCM standard
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32; // 256-bit

/**
 * Derive a per-record AES-256 key from the process-wide JWT_SECRET
 * and a record-unique salt. HKDF-SHA256 with an info string scoped
 * to this module — so the same JWT_SECRET producing a session JWT
 * and a notification key can never collide, even if one key was
 * accidentally reused (info strings differ).
 */
function deriveKey(salt: Buffer): Buffer {
  // `getJwtSecret()` returns the already-bytes Uint8Array view used
  // by jose for JWT signing. hkdfSync accepts Uint8Array directly,
  // which sidesteps the text-encoding round-trip entirely.
  const ikm = getJwtSecret();
  // hkdfSync's TypeScript signature in @types/node 20+ returns a
  // `Uint8Array<ArrayBufferLike>`, which isn't directly assignable
  // to Buffer.from's overloads. Copy through a fresh Buffer so the
  // cipher API (which wants Node Buffer specifically) is happy.
  const raw = hkdfSync(
    'sha256',
    ikm,
    salt,
    Buffer.from('nexus:notifications:v1', 'utf8'),
    KEY_BYTES,
  );
  const out = Buffer.alloc(KEY_BYTES);
  out.set(new Uint8Array(raw as ArrayBufferLike));
  return out;
}

/**
 * Encrypt a JSON-serialisable credential object and return a base64
 * blob safe to persist in notifications.json. Accepts any JSON value —
 * the caller decides what to stash (full WebhookDestination, just the
 * URL, etc.).
 */
export function encryptSecret(plain: unknown): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, ciphertext]).toString('base64');
}

/**
 * Reverse of `encryptSecret`. Throws on any framing problem, MAC
 * mismatch, or JSON parse failure — callers should catch and treat as
 * "credential unreadable" rather than trying to fall back to a plain
 * value (a tampered frame shouldn't be silently accepted).
 *
 * Returns `unknown` so callers validate the shape before use; see
 * `store.ts` for the per-kind schema checks.
 */
export function decryptSecret(blob: string): unknown {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < SALT_BYTES + IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new Error('Credential blob truncated');
  }
  const salt = buf.subarray(0, SALT_BYTES);
  const iv = buf.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const authTag = buf.subarray(
    SALT_BYTES + IV_BYTES,
    SALT_BYTES + IV_BYTES + AUTH_TAG_BYTES,
  );
  const ciphertext = buf.subarray(SALT_BYTES + IV_BYTES + AUTH_TAG_BYTES);
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** Exported for tests. Framing sizes are considered stable — changing
 *  them is a persistence-breaking migration, not a refactor. */
export const __FRAMING = {
  SALT_BYTES,
  IV_BYTES,
  AUTH_TAG_BYTES,
  KEY_BYTES,
  INFO: 'nexus:notifications:v1',
} as const;
