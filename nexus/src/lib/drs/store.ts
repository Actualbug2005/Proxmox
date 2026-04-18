/**
 * JSON-persisted DRS policy + cooldown + history.
 *
 * Single file at ${NEXUS_DATA_DIR}/drs-policy.json. Mirrors the
 * chains-store / notifications-store pattern: serialised mutex, atomic
 * rename on every write, migration-safe reader that falls back to
 * defaults on anything unparseable.
 *
 * Cooldown map is stored alongside the policy so the planner survives
 * a process restart without forgetting which guests just moved.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_POLICY,
  type DrsHistoryEntry,
  type DrsPolicy,
  type DrsState,
} from './types.ts';

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'drs-policy.json');
const HISTORY_CAP = 200;

mkdirSync(DATA_DIR, { recursive: true });

const EMPTY: DrsState = {
  version: 1,
  policy: DEFAULT_POLICY,
  cooldowns: {},
  history: [],
};

async function readFile(): Promise<DrsState> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as DrsState;
    if (parsed.version !== 1) return EMPTY;
    // Defence: merge user-persisted policy onto defaults so a missing
    // field (from an older install) doesn't produce NaN comparisons.
    return {
      version: 1,
      policy: { ...DEFAULT_POLICY, ...parsed.policy },
      cooldowns: parsed.cooldowns ?? {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

async function writeFile(state: DrsState): Promise<void> {
  const tmp = `${FILE}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, FILE);
}

let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function getState(): Promise<DrsState> {
  return serialize(readFile);
}

export async function getPolicy(): Promise<DrsPolicy> {
  return (await getState()).policy;
}

export async function updatePolicy(patch: Partial<DrsPolicy>): Promise<DrsPolicy> {
  return serialize(async () => {
    const state = await readFile();
    state.policy = { ...state.policy, ...patch };
    await writeFile(state);
    return state.policy;
  });
}

/** Record a vmid's move time for the cooldown map. */
export async function noteMigrated(vmid: number, at: number): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    state.cooldowns[String(vmid)] = at;
    // Garbage-collect cooldown entries older than 2× the longest
    // reasonable cooldown (24h) so a long-running install doesn't
    // accumulate an unbounded map of vmid keys.
    const cutoff = at - 24 * 60 * 60_000;
    for (const [k, t] of Object.entries(state.cooldowns)) {
      if (t < cutoff) delete state.cooldowns[k];
    }
    await writeFile(state);
  });
}

export async function appendHistory(entry: DrsHistoryEntry): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    state.history.push(entry);
    // Cap server-side so the file doesn't grow unbounded.
    if (state.history.length > HISTORY_CAP) {
      state.history = state.history.slice(-HISTORY_CAP);
    }
    await writeFile(state);
  });
}

export async function recentHistory(limit = 50): Promise<DrsHistoryEntry[]> {
  const state = await getState();
  return state.history.slice(-limit).reverse();
}

// Test-only helpers — never imported from production code.
export const __testing = {
  async reset(): Promise<void> {
    await serialize(async () => {
      await writeFile({ ...EMPTY });
    });
  },
  dataPath(): string {
    return FILE;
  },
} as const;
