/**
 * Per-user preferences store.
 *
 * One file per user under `${NEXUS_DATA_DIR}/user-prefs/<sanitized>.json`.
 * The filename is derived from the PVE username (`root@pam`, `ops@pve`)
 * by replacing any non-safe character with `_` — so two users with
 * lookalike names never collide on the filesystem but the resulting
 * filename remains grep-able for ops.
 *
 * Mirrors the chains/drs store pattern: serialised mutex, atomic rename
 * on every write, migration-safe reader returning EMPTY_PREFS on any
 * error so a corrupt file does not break the UI — operators can delete
 * their prefs file and get back a clean default.
 */
import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EMPTY_PREFS, type UserPrefs } from './types.ts';

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = join(resolveDataDir(), 'user-prefs');
mkdirSync(DATA_DIR, { recursive: true });

/**
 * Reduce a username to a filesystem-safe key. Keeps letters, digits,
 * `.`, `_`, `-` and `@`; maps everything else to `_`. Limits length to
 * 80 chars (PVE usernames are short; the cap defends against pathological
 * inputs). Never produces `..` or `/` and never starts with `.`.
 */
function safeKey(username: string): string {
  const trimmed = username.trim().slice(0, 80);
  const cleaned = trimmed.replace(/[^A-Za-z0-9._@-]/g, '_');
  return cleaned.replace(/^\.+/, '_') || '_anon';
}

function filePath(username: string): string {
  return join(DATA_DIR, `${safeKey(username)}.json`);
}

async function readFile(username: string): Promise<UserPrefs> {
  try {
    const raw = await fsp.readFile(filePath(username), 'utf8');
    const parsed = JSON.parse(raw) as UserPrefs;
    if (parsed.version !== 1) return { ...EMPTY_PREFS };
    return {
      version: 1,
      bentoLayouts: parsed.bentoLayouts ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_PREFS };
    }
    // Corrupted file — log, return defaults. Operator can delete to
    // fully reset if they want.
    console.error(
      '[nexus event=user_prefs_read_failed] user=%s reason=%s',
      username,
      err instanceof Error ? err.message : String(err),
    );
    return { ...EMPTY_PREFS };
  }
}

async function writeFile(username: string, prefs: UserPrefs): Promise<void> {
  const path = filePath(username);
  const tmp = `${path}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(prefs, null, 2), 'utf8');
  await fsp.rename(tmp, path);
}

// Per-user chain so two concurrent writes to the SAME user serialise,
// while writes to DIFFERENT users can proceed in parallel.
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(username: string, task: () => Promise<T>): Promise<T> {
  const key = safeKey(username);
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  chains.set(key, next.catch(() => undefined));
  return next;
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function getPrefs(username: string): Promise<UserPrefs> {
  return serialize(username, () => readFile(username));
}

export async function updatePrefs(
  username: string,
  patch: Partial<UserPrefs>,
): Promise<UserPrefs> {
  return serialize(username, async () => {
    const current = await readFile(username);
    const next: UserPrefs = {
      version: 1,
      bentoLayouts: patch.bentoLayouts ?? current.bentoLayouts,
    };
    await writeFile(username, next);
    return next;
  });
}

export const __testing = {
  safeKey,
  filePath,
} as const;
