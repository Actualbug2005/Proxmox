/**
 * Asymmetric hybrid audit log for remote command execution.
 *
 * Design:
 *   - Two tiers of log, linked by a shared per-entry ULID.
 *   - SAFE tier (exec.jsonl): plaintext forensic metadata — ts, user, node,
 *     cmd hash + length, exit code, duration. Grep/jq-friendly. Every ops
 *     admin can read it.
 *   - SECRET tier (exec-commands.enc.jsonl): envelope-encrypted full command
 *     text. Readable only with the matching private key (kept OFF-box).
 *
 * Envelope encryption:
 *   1. Generate a random AES-256-GCM key (32 B) + IV (12 B) per entry.
 *   2. AES_GCM(cmd_utf8) → ciphertext || authTag.
 *   3. Wrap the AES key with RSA-OAEP using the public key at
 *      NEXUS_AUDIT_PUBKEY_PATH (default /etc/nexus/audit-pubkey.pem).
 *   4. Concatenate and base64: len(wrappedKey)[4B BE] || wrappedKey || iv
 *      || authTag(16B) || ciphertext.
 *
 * Why envelope vs. direct RSA: RSA-4096-OAEP caps at ~470 B per op. Commands
 * longer than that (multi-line shell scripts, long curl | bash lines) would
 * fail. Envelope uses RSA only to wrap a 32-byte AES key.
 *
 * Key lifecycle (operator responsibility — NOT in code):
 *   # One-time, OFF-box (a laptop, never on the LXC):
 *   openssl genrsa -out audit-private.pem 4096
 *   openssl rsa -in audit-private.pem -pubout -out audit-pubkey.pem
 *   # Deploy only the public key:
 *   scp audit-pubkey.pem nexus-lxc:/etc/nexus/audit-pubkey.pem
 *   chmod 0644 /etc/nexus/audit-pubkey.pem
 *   # Store audit-private.pem offline (password manager, yubikey PIV,
 *   # offline USB). NEVER deploy to the running system.
 *
 * Decryption (incident response):
 *   scripts/nexus-audit-decrypt.ts reads the ciphertext line and the
 *   private key, emits plaintext. Runs off-box.
 */

import { createHash, publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Exported so the decrypt helper (scripts/nexus-audit-decrypt.ts) imports
// the same canonical frame sizes that encrypt uses.
export const AES_KEY_BYTES = 32; // 256-bit
export const AES_IV_BYTES = 12; // GCM standard
export const AUTH_TAG_BYTES = 16;

// Paths (override via env for testing or non-default deployments).
const SAFE_LOG_PATH =
  process.env.NEXUS_AUDIT_SAFE_LOG ?? '/var/log/nexus/exec.jsonl';
const SECRET_LOG_PATH =
  process.env.NEXUS_AUDIT_SECRET_LOG ?? '/var/log/nexus/exec-commands.enc.jsonl';
const PUBKEY_PATH =
  process.env.NEXUS_AUDIT_PUBKEY_PATH ?? '/etc/nexus/audit-pubkey.pem';

export interface SafeEntry {
  /** ULID — shared with the matching secret-tier entry. */
  id: string;
  /** ISO 8601 with millisecond precision. */
  ts: string;
  /** PVE userid, e.g. "root@pam". */
  user: string;
  /** Target PVE node name. */
  node: string;
  /** Endpoint label — "exec" or "scripts.run". */
  endpoint: 'exec' | 'scripts.run';
  /** SHA-256 of the raw command (hex). */
  cmd_sha256: string;
  /** Length of the command in bytes. */
  cmd_len: number;
  /** Process exit code. `null` when the subprocess was killed by signal / timeout. */
  exitCode: number | null;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ─── Key loading (cached — public key is stable for the process lifetime) ──

let cachedPubKey: Buffer | null = null;
let cachedPubKeyPromise: Promise<Buffer> | null = null;

async function loadPubKey(): Promise<Buffer> {
  if (cachedPubKey) return cachedPubKey;
  if (cachedPubKeyPromise) return cachedPubKeyPromise;
  cachedPubKeyPromise = readFile(PUBKEY_PATH).then((buf) => {
    cachedPubKey = buf;
    return buf;
  });
  return cachedPubKeyPromise;
}

// ─── ULID-ish id (lexicographically sortable, URL-safe) ────────────────────

function ulid(): string {
  // Timestamp (ms, 6 bytes = 12 hex chars) + 10 random bytes (20 hex chars).
  // Not a strict ULID Crockford-base32 — we use hex for no-dependency simplicity.
  // Still monotonic-ish and globally unique per process-tick.
  const ts = Date.now().toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${ts}${rand}`;
}

// ─── Envelope encryption ───────────────────────────────────────────────────

async function encryptCommand(plaintext: string): Promise<string> {
  const pub = await loadPubKey();
  const aesKey = randomBytes(AES_KEY_BYTES);
  const iv = randomBytes(AES_IV_BYTES);

  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const wrappedKey = publicEncrypt(
    {
      key: pub,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  // Frame: [len(wrappedKey) as uint32 BE] [wrappedKey] [iv (12B)] [authTag (16B)] [ciphertext]
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(wrappedKey.length, 0);
  const envelope = Buffer.concat([lenBuf, wrappedKey, iv, authTag, ciphertext]);
  return envelope.toString('base64');
}

// ─── Append helpers ────────────────────────────────────────────────────────

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function appendJsonLine(filePath: string, obj: unknown, mode: number): Promise<void> {
  await ensureDir(filePath);
  await appendFile(filePath, JSON.stringify(obj) + '\n', { mode });
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface AuditInput {
  user: string;
  node: string;
  endpoint: 'exec' | 'scripts.run';
  command: string;
  exitCode: number | null;
  durationMs: number;
}

/**
 * Write one audit entry to both tiers. The safe-tier write is gated on
 * successful encryption — if the public key is missing or malformed, this
 * throws rather than leaving a safe-tier entry with no matching ciphertext.
 * The route caller must decide what to do with the failure (log + 500, or
 * accept the loss in-memory).
 *
 * This is a best-effort append-only sink; a corrupted filesystem or full
 * disk will surface as a rejected promise and the caller can handle it.
 */
export async function writeAuditEntry(input: AuditInput): Promise<SafeEntry> {
  const id = ulid();
  const cmdBuf = Buffer.from(input.command, 'utf8');
  const safe: SafeEntry = {
    id,
    ts: new Date().toISOString(),
    user: input.user,
    node: input.node,
    endpoint: input.endpoint,
    cmd_sha256: createHash('sha256').update(cmdBuf).digest('hex'),
    cmd_len: cmdBuf.length,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
  };

  // Encrypt FIRST. If encryption fails we want to abort without leaving an
  // orphaned safe-tier entry that can never be matched to a cmd record.
  const cipherB64 = await encryptCommand(input.command);

  // Write secret tier with mode 0600 (operator-only readable). Safe tier
  // defaults to 0644 — non-root admins can grep it.
  await appendJsonLine(SECRET_LOG_PATH, { id, cmd_ciphertext: cipherB64 }, 0o600);
  await appendJsonLine(SAFE_LOG_PATH, safe, 0o644);
  return safe;
}

// For tests / health endpoints.
export const AUDIT_PATHS = {
  safe: SAFE_LOG_PATH,
  secret: SECRET_LOG_PATH,
  pubkey: PUBKEY_PATH,
} as const;

// ─── Failure observability (H1) ─────────────────────────────────────────────
//
// Audit writes are best-effort sinks; both call sites (api/exec/route.ts and
// run-script-job.ts) catch failures so an unwritable log doesn't block the
// command itself. That's correct for availability — but a silently-broken
// audit pipeline is a compliance hazard. The counter + structured log line
// surface the failure to operators (tailing journald, grepping for
// `event=audit_write_failed`, or reading /api/system/health).

declare global {
  // eslint-disable-next-line no-var
  var __nexusAuditWriteFailures: number | undefined;
}

export function noteAuditWriteFailure(
  endpoint: string,
  user: string,
  err: unknown,
): void {
  globalThis.__nexusAuditWriteFailures = (globalThis.__nexusAuditWriteFailures ?? 0) + 1;
  const reason = err instanceof Error ? err.message : String(err);
  console.error(
    '[nexus event=audit_write_failed] endpoint=%s user=%s reason=%s',
    endpoint,
    user,
    reason,
  );
}

export function getAuditWriteFailureCount(): number {
  return globalThis.__nexusAuditWriteFailures ?? 0;
}
