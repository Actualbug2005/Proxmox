/**
 * Persisted auto-update policy.
 *
 * Single file at ${NEXUS_DATA_DIR}/updates-policy.json. Mirrors the
 * drs-store / notifications-store pattern: serialised mutex, atomic
 * rename writes, migration-safe reader that falls back to defaults on
 * anything unparseable.
 */
import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_POLICY, type UpdatePolicy } from './types.ts';

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'updates-policy.json');

mkdirSync(DATA_DIR, { recursive: true });

interface FileShape {
  version: 1;
  policy: UpdatePolicy;
}

async function readFile(): Promise<UpdatePolicy> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (parsed.version !== 1) return { ...DEFAULT_POLICY };
    // Defence: merge onto defaults so a missing field from an older
    // install doesn't produce undefined comparisons.
    return { ...DEFAULT_POLICY, ...parsed.policy };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_POLICY };
    }
    throw err;
  }
}

async function writeFile(policy: UpdatePolicy): Promise<void> {
  const tmp = `${FILE}.tmp.${process.pid}`;
  const body: FileShape = { version: 1, policy };
  await fsp.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8');
  await fsp.rename(tmp, FILE);
}

let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

export async function getPolicy(): Promise<UpdatePolicy> {
  return serialize(readFile);
}

export async function updatePolicy(
  patch: Partial<UpdatePolicy>,
): Promise<UpdatePolicy> {
  return serialize(async () => {
    const curr = await readFile();
    const next: UpdatePolicy = { ...curr, ...patch };
    await writeFile(next);
    return next;
  });
}

/** Convenience writer for the tick — stamps timestamps without forcing
 *  the caller to read-modify-write. */
export async function noteCheck(
  at: number,
  seenTag: string | undefined,
): Promise<void> {
  await serialize(async () => {
    const curr = await readFile();
    await writeFile({ ...curr, lastCheckedAt: at, lastSeenTag: seenTag ?? curr.lastSeenTag });
  });
}

export async function noteAutoInstall(at: number): Promise<void> {
  await serialize(async () => {
    const curr = await readFile();
    await writeFile({ ...curr, lastAutoInstallAt: at });
  });
}

export const __testing = {
  dataPath(): string { return FILE; },
  async reset(): Promise<void> {
    await serialize(async () => writeFile(DEFAULT_POLICY));
  },
} as const;
