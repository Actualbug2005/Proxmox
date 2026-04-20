/**
 * Encrypted persistence for the Nexus service-account credentials.
 *
 * File: ${NEXUS_DATA_DIR}/service-account.json
 *   - Contents: base64-encoded AES-GCM blob from `notifications/crypto.ts`
 *     (single-record reuse of the same at-rest helper used for SMTP /
 *     webhook credentials — same rotation story via JWT_SECRET).
 *   - Mode 0600 so a sibling LXC user can't read it even on a shared
 *     bind-mount.
 *
 * Writes go through writeFile(tmp) + rename(tmp, final) so a crash
 * mid-write never leaves a half-encrypted file. NEXUS_DATA_DIR is
 * resolved per-call (not at module load) so tests can point the store
 * at a fresh tmp dir after the module has already been imported.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from '../notifications/crypto.ts';
import type { ServiceAccountConfig } from './types.ts';

/**
 * Matches "user@realm!tokenname" per PVE's token id syntax. PVE itself
 * is stricter (realm must be pam/pve/ldap/...), but we deliberately
 * accept anything shaped right — the auth call will reject a bogus
 * realm with a clearer error than a regex ever could.
 */
const TOKEN_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+![A-Za-z0-9._-]+$/;
const HOSTNAME_RE = /^[A-Za-z0-9.-]+$/;
// Explicit 4-octet form (not \d{1,3}(\.\d{1,3}){3}) — safe-regex flags
// the shorter form's nested quantifier even though it's bounded.
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_BRACKETED_RE = /^\[[0-9A-Fa-f:]+\]$/;

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return '/var/lib/nexus';
}

function filePath(): string {
  return join(resolveDataDir(), 'service-account.json');
}

function validate(config: ServiceAccountConfig): void {
  if (typeof config.tokenId !== 'string' || !TOKEN_ID_RE.test(config.tokenId)) {
    throw new Error(
      `Invalid tokenId (expected user@realm!tokenname): ${String(config.tokenId)}`,
    );
  }
  if (
    typeof config.secret !== 'string' ||
    config.secret.length === 0 ||
    config.secret.length > 256
  ) {
    throw new Error('secret must be a non-empty string of at most 256 chars');
  }
  const host = config.proxmoxHost;
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error('proxmoxHost must be a non-empty string');
  }
  const hostOk = HOSTNAME_RE.test(host) || IPV4_RE.test(host) || IPV6_BRACKETED_RE.test(host);
  if (!hostOk) {
    throw new Error(`Invalid proxmoxHost (no scheme/path/port, bare host only): ${host}`);
  }
  if (typeof config.savedAt !== 'number' || !Number.isFinite(config.savedAt)) {
    throw new Error('savedAt must be a finite number');
  }
}

/**
 * Returns null if the file doesn't exist, is malformed, has a bad MAC,
 * or the decrypted payload fails validation. Callers treat this as
 * "no service account configured"; they should re-prompt the user
 * rather than trying to recover a tampered file.
 */
export async function loadConfig(): Promise<ServiceAccountConfig | null> {
  const path = filePath();
  if (!existsSync(path)) return null;
  try {
    const blob = await readFile(path, 'utf8');
    const plaintext = decryptSecret(blob);
    const parsed = plaintext as ServiceAccountConfig;
    validate(parsed);
    // Construct a fresh object so we don't leak any extra fields the
    // on-disk JSON may have accumulated from a previous schema version.
    return {
      tokenId: parsed.tokenId,
      secret: parsed.secret,
      proxmoxHost: parsed.proxmoxHost,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Validates, encrypts, writes-to-temp, then atomically renames so a
 * crash mid-write never leaves a half-encrypted file. Throws on any
 * validation failure — the caller surfaces the error to the UI.
 */
export async function saveConfig(config: ServiceAccountConfig): Promise<void> {
  validate(config);
  const dir = resolveDataDir();
  const path = join(dir, 'service-account.json');
  await mkdir(dir, { recursive: true });
  const blob = encryptSecret(config);
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, blob, { mode: 0o600, encoding: 'utf8' });
  await rename(tmp, path);
}

/**
 * Idempotent: no-op if the file is already gone. Does NOT wipe the
 * containing directory (other Nexus state lives there).
 */
export async function deleteConfig(): Promise<void> {
  const path = filePath();
  if (!existsSync(path)) return;
  await unlink(path);
}
