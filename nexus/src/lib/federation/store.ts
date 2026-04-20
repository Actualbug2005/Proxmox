/**
 * Encrypted persistence for the federation cluster registry.
 *
 * File: ${NEXUS_DATA_DIR}/federation.json, mode 0600.
 *   - Contents: base64-encoded AES-GCM blob from notifications/crypto.ts
 *     wrapping { version: 1, clusters: RegisteredCluster[] }.
 *   - Atomic writes via writeFile(tmp) + rename(tmp, final).
 *
 * This module mirrors service-account/store.ts; the one difference is
 * list semantics (N records vs 1). validate() is called on every add
 * and before every save so tampered files that somehow pass decrypt
 * still fail shape checks.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from '../notifications/crypto.ts';
import type {
  CreateClusterInput,
  FederationFile,
  RegisteredCluster,
  RotateCredentialsInput,
} from './types.ts';

/** Slug id, 1-32 chars, must start with a-z, safe-regex clean. */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** PVE token id shape: user@realm!tokenname (shared with service-account). */
const TOKEN_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+![A-Za-z0-9._-]+$/;
// `local` would collide with the proxy's default (no ?cluster= = local
// service-account) path. Reserving it here prevents an operator from
// shadowing the local cluster by registering a remote with that id.
const RESERVED_IDS = new Set(['local']);

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  return envDir && envDir.length > 0 ? envDir : '/var/lib/nexus';
}

function filePath(): string {
  return join(resolveDataDir(), 'federation.json');
}

function validateInput(input: CreateClusterInput): void {
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) {
    throw new Error(`Invalid cluster id (expected [a-z][a-z0-9-]{0,31}): ${String(input.id)}`);
  }
  if (RESERVED_IDS.has(input.id)) {
    throw new Error(`Cluster id "${input.id}" is reserved`);
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0 || name.length > 64) {
    throw new Error('name must be a non-empty string of at most 64 chars');
  }
  if (!Array.isArray(input.endpoints) || input.endpoints.length === 0) {
    throw new Error('endpoints must be a non-empty array');
  }
  // Upper bound of 4 endpoints matches real PVE cluster footprints
  // (homelab 3-node HA + one failover VIP is the largest realistic
  // shape). More entries dilute the probe tick's time budget per
  // cluster without gaining reachability insurance.
  if (input.endpoints.length > 4) {
    throw new Error('endpoints may contain at most 4 entries');
  }
  const seen = new Set<string>();
  for (const ep of input.endpoints) {
    if (typeof ep !== 'string' || ep.length === 0) {
      throw new Error('endpoint must be a non-empty https URL');
    }
    let u: URL;
    try {
      u = new URL(ep);
    } catch {
      throw new Error(`endpoint is not a valid URL: ${ep}`);
    }
    if (u.protocol !== 'https:') {
      throw new Error(`endpoint must use https scheme (got ${u.protocol}): ${ep}`);
    }
    if (u.hostname.length === 0) {
      throw new Error(`endpoint host is empty: ${ep}`);
    }
    if (seen.has(ep)) {
      throw new Error(`duplicate endpoint: ${ep}`);
    }
    seen.add(ep);
  }
  if (typeof input.tokenId !== 'string' || !TOKEN_ID_RE.test(input.tokenId)) {
    throw new Error(`Invalid tokenId (expected user@realm!tokenname): ${String(input.tokenId)}`);
  }
  if (
    typeof input.tokenSecret !== 'string' ||
    input.tokenSecret.length < 8 ||
    input.tokenSecret.length > 256
  ) {
    throw new Error('tokenSecret must be a string of 8 to 256 chars');
  }
}

/** Read+decrypt. Returns an empty list on any load failure (missing
 *  file, bad MAC, schema-version mismatch, decrypt failure). A single
 *  critical log line is emitted so operators can find it in journalctl. */
async function loadAll(): Promise<FederationFile> {
  const path = filePath();
  if (!existsSync(path)) return { version: 1, clusters: [] };
  try {
    const blob = await readFile(path, 'utf8');
    const parsed = decryptSecret(blob) as unknown as FederationFile;
    if (parsed == null || typeof parsed !== 'object' || parsed.version !== 1) {
      console.error('[nexus event=federation_schema_mismatch] reason=unknown-version');
      return { version: 1, clusters: [] };
    }
    const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
    return { version: 1, clusters };
  } catch (err) {
    console.error(
      '[nexus event=federation_load_failed] reason=%s',
      err instanceof Error ? err.message : String(err),
    );
    return { version: 1, clusters: [] };
  }
}

async function saveAll(data: FederationFile): Promise<void> {
  const dir = resolveDataDir();
  const path = join(dir, 'federation.json');
  await mkdir(dir, { recursive: true });
  const blob = encryptSecret(data);
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, blob, { mode: 0o600, encoding: 'utf8' });
  await rename(tmp, path);
}

export async function listClusters(): Promise<RegisteredCluster[]> {
  const { clusters } = await loadAll();
  return clusters;
}

export async function getCluster(id: string): Promise<RegisteredCluster | null> {
  const { clusters } = await loadAll();
  return clusters.find((c) => c.id === id) ?? null;
}

export async function addCluster(input: CreateClusterInput): Promise<RegisteredCluster> {
  validateInput(input);
  const data = await loadAll();
  if (data.clusters.some((c) => c.id === input.id)) {
    throw new Error(`Cluster "${input.id}" is already registered`);
  }
  const now = Date.now();
  const record: RegisteredCluster = {
    id: input.id,
    name: input.name.trim(),
    endpoints: [...input.endpoints],
    authMode: 'token',
    tokenId: input.tokenId,
    tokenSecret: input.tokenSecret,
    savedAt: now,
    rotatedAt: now,
  };
  data.clusters.push(record);
  await saveAll(data);
  return record;
}

export async function removeCluster(id: string): Promise<boolean> {
  const data = await loadAll();
  const before = data.clusters.length;
  data.clusters = data.clusters.filter((c) => c.id !== id);
  if (data.clusters.length === before) return false;
  await saveAll(data);
  return true;
}

export async function rotateCredentials(
  id: string,
  creds: RotateCredentialsInput,
): Promise<RegisteredCluster | null> {
  if (typeof creds.tokenId !== 'string' || !TOKEN_ID_RE.test(creds.tokenId)) {
    throw new Error(`Invalid tokenId (expected user@realm!tokenname): ${String(creds.tokenId)}`);
  }
  if (
    typeof creds.tokenSecret !== 'string' ||
    creds.tokenSecret.length < 8 ||
    creds.tokenSecret.length > 256
  ) {
    throw new Error('tokenSecret must be a string of 8 to 256 chars');
  }
  const data = await loadAll();
  const idx = data.clusters.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const prev = data.clusters[idx];
  data.clusters[idx] = {
    ...prev,
    tokenId: creds.tokenId,
    tokenSecret: creds.tokenSecret,
    rotatedAt: Date.now(),
  };
  await saveAll(data);
  return data.clusters[idx];
}
